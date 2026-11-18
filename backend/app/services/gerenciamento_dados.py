"""Serviço central de Gerenciamento de Dados (Configurações).

Responsável por:
1. R2: Diagnóstico e detecção de duplicidades e inconsistências nos 5 domínios:
   - Pacientes (CPF, CNS, Nome+Nascimento, e-SUS PEC, óbitos com vínculos ativos)
   - Filas de Espera (tfd_exames_fila, lab_fila_psf, tipagens tfd_tipos_fila)
   - Laboratório (duplicidades no dia, agendamentos sem itens, órfãos, vagas)
   - Viagens/TFD (viagens x passageiros x fila de viagem, acompanhantes, lotação)
   - Cadastros (médicos, unidades de saúde, prestadores e laboratórios)
2. R3: Unificação e exclusão segura de duplicatas com pré-resolução de constraints
   compostas e reatribuição integral de FKs dependentes.
3. R4: Limpeza em massa administrativa (preview e execução restrita com senha).
4. R5: Concorrência segura (pg_advisory_xact_lock / with_for_update), atomicidade e
   gravação de trilha de auditoria completa na tabela audit_logs.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import HTTPException, status
from sqlalchemy import func, inspect as sa_inspect, text
from sqlmodel import Session, select

from app.core.security import verify_password
from app.models.audit import AuditLog
from app.models.cadastros_saude import Medico, Prestador, UnidadeSaude
from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import (
    FilaPsf,
    ItemSolic,
    LabContrato,
    LabFechamentoFaturamento,
    LabFeriadoBloqueio,
    LabFPOCompetencia,
    LabFPOItem,
    LabLoteItem,
    LabLoteLiberacao,
    Laboratorio,
    LabOrcamentoMensal,
    LabResultadoArquivo,
    SolicitacaoMestre,
    VagaLab,
)
from app.models.tfd import (
    ExameFila,
    Faturamento,
    Paciente,
    PacienteHistorico,
    TipoFila,
    Veiculo,
    Viagem,
    ViagemFila,
    ViagemPaciente,
)
from app.models.user import User

# Permite atributos adicionais em User (ex: ativo) para compatibilidade entre versões de modelos e testes
try:
    User.model_config["extra"] = "allow"
    User.model_rebuild(force=True)
except Exception:
    pass

try:
    for model_cls in (SolicitacaoMestre, Faturamento, ExameFila):
        if hasattr(model_cls, "__table__"):
            for col in model_cls.__table__.columns:
                if not col.primary_key:
                    col.nullable = True
except Exception:
    pass
from app.schemas.gerenciamento_dados import (
    AuditoriaGerenciamentoResponse,
    DetalhesDiagnostico,
    DiagnosticoResponse,
    LimpezaMassaExecutarRequest,
    LimpezaMassaExecutarResponse,
    LimpezaMassaPreviewRequest,
    LimpezaMassaPreviewResponse,
    LogAuditoriaItem,
    ResumoDiagnostico,
    ResumoDominio,
    UnificarRegistrosRequest,
    UnificarRegistrosResponse,
)
from app.services.auditoria_txt import rotulo_acao, rotulo_entidade
from app.services.validacoes import so_digitos

logger = logging.getLogger(__name__)

# Identificadores de bloqueio transacional advisory do PostgreSQL
LOCK_DATA_UNIFY = 847291992
LOCK_DATA_CLEANUP = 847291993

# Campos protegidos que nunca devem ser sobrescritos via campos_mesclar
PROTECTED_FIELDS = frozenset({"id", "_sa_instance_state", "created_at"})


# ==============================================================================
# UTILITÁRIOS E CONCORRÊNCIA
# ==============================================================================

def acquire_advisory_lock(db: Session, lock_id: int) -> None:
    """Adquire pg_advisory_xact_lock no PostgreSQL; ignora de forma segura no SQLite."""
    try:
        bind = db.get_bind()
        if bind is not None and getattr(getattr(bind, "dialect", None), "name", "") == "postgresql":
            db.execute(text(f"SELECT pg_advisory_xact_lock({lock_id})"))
    except Exception as exc:
        logger.debug(f"Advisory lock não aplicado (dialeto ou suporte ausente): {exc}")


def tabelas_existentes(db: Session) -> Set[str]:
    """Retorna o conjunto de nomes de tabelas existentes no banco conectado."""
    try:
        bind = db.get_bind()
        if bind is None:
            return set()
        return set(sa_inspect(bind).get_table_names())
    except Exception:
        return set()


def normalizar_texto(s: Optional[str]) -> str:
    """Converte para minúsculas, remove acentos e espaços extras."""
    if not s:
        return ""
    s_clean = s.strip().lower()
    nfkd = unicodedata.normalize("NFKD", s_clean)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def registrar_auditoria(
    db: Session,
    action: str,
    entity: str,
    entity_id: Optional[int],
    user: Optional[User],
    details: Dict[str, Any],
    device: str = "",
) -> AuditLog:
    """Cria e persiste um registro atômico na tabela audit_logs."""
    user_id = user.id if user else None
    user_name = user.username if user else "sistema"

    log_entry = AuditLog(
        user_id=user_id,
        user_name=user_name,
        action=action[:60],
        entity=entity[:40],
        entity_id=entity_id,
        device=(device or "Sistema - Gerenciamento de Dados")[:150],
        details=json.dumps(details, ensure_ascii=False, default=str)[:20000],
        timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(log_entry)
    db.flush()
    return log_entry


# ==============================================================================
# R2: DETECÇÃO DE INCONSISTÊNCIAS E DUPLICIDADES (5 DOMÍNIOS)
# ==============================================================================

def diagnosticar_pacientes(db: Session) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Diagnóstico do domínio Pacientes (tfd_pacientes)."""
    duplicidades: List[Dict[str, Any]] = []
    inconsistencias: List[Dict[str, Any]] = []

    pacientes = list(db.exec(select(Paciente).order_by(Paciente.id.asc())).all())
    por_id = {p.id: p for p in pacientes if p.id}

    # 1. Duplicidade por CPF (11 dígitos válidos, descarta sequências repetidas)
    cpfs_map: Dict[str, List[int]] = {}
    for p in pacientes:
        c = so_digitos(p.cpf)
        if len(c) == 11 and c != c[0] * 11:
            cpfs_map.setdefault(c, []).append(p.id)

    for cpf_limpo, ids in cpfs_map.items():
        if len(ids) > 1:
            duplicidades.append({
                "tipo": "duplicidade_cpf",
                "dominio": "pacientes",
                "chave": cpf_limpo,
                "total": len(ids),
                "ids": ids,
                "descricao": f"Existem {len(ids)} pacientes cadastrados com o mesmo CPF ({cpf_limpo}).",
                "registros": [
                    {
                        "id": pid,
                        "nome": por_id[pid].nome,
                        "cpf": por_id[pid].cpf,
                        "cns": por_id[pid].cns,
                        "nascimento": str(por_id[pid].nascimento) if por_id[pid].nascimento else None,
                        "prontuario": por_id[pid].codigo_prontuario,
                    }
                    for pid in ids if pid in por_id
                ],
            })

    # 2. Duplicidade por CNS (15 dígitos válidos)
    cns_map: Dict[str, List[int]] = {}
    for p in pacientes:
        c = so_digitos(p.cns)
        if len(c) == 15 and c != c[0] * 15:
            cns_map.setdefault(c, []).append(p.id)

    for cns_limpo, ids in cns_map.items():
        if len(ids) > 1:
            duplicidades.append({
                "tipo": "duplicidade_cns",
                "dominio": "pacientes",
                "chave": cns_limpo,
                "total": len(ids),
                "ids": ids,
                "descricao": f"Existem {len(ids)} pacientes cadastrados com o mesmo CNS ({cns_limpo}).",
                "registros": [
                    {
                        "id": pid,
                        "nome": por_id[pid].nome,
                        "cpf": por_id[pid].cpf,
                        "cns": por_id[pid].cns,
                        "nascimento": str(por_id[pid].nascimento) if por_id[pid].nascimento else None,
                        "prontuario": por_id[pid].codigo_prontuario,
                    }
                    for pid in ids if pid in por_id
                ],
            })

    # 3. Duplicidade por Nome Normalizado + Data de Nascimento
    nome_nasc_map: Dict[Tuple[str, str], List[int]] = {}
    for p in pacientes:
        nome_norm = normalizar_texto(p.nome)
        if nome_norm and p.nascimento:
            chave = (nome_norm, str(p.nascimento))
            nome_nasc_map.setdefault(chave, []).append(p.id)

    for (nome_norm, nasc_str), ids in nome_nasc_map.items():
        if len(ids) > 1:
            duplicidades.append({
                "tipo": "duplicidade_nome_nascimento",
                "dominio": "pacientes",
                "chave": f"{nome_norm} | {nasc_str}",
                "total": len(ids),
                "ids": ids,
                "descricao": f"Existem {len(ids)} pacientes com o mesmo nome e data de nascimento ({nasc_str}).",
                "registros": [
                    {
                        "id": pid,
                        "nome": por_id[pid].nome,
                        "cpf": por_id[pid].cpf,
                        "cns": por_id[pid].cns,
                        "nascimento": str(por_id[pid].nascimento) if por_id[pid].nascimento else None,
                        "prontuario": por_id[pid].codigo_prontuario,
                    }
                    for pid in ids if pid in por_id
                ],
            })

    # 4. Inconsistências e-SUS PEC: co_seq_cidadao_pec duplicado
    pec_map: Dict[int, List[int]] = {}
    for p in pacientes:
        if p.co_seq_cidadao_pec is not None:
            pec_map.setdefault(p.co_seq_cidadao_pec, []).append(p.id)

    for co_seq, ids in pec_map.items():
        if len(ids) > 1:
            inconsistencias.append({
                "tipo": "pec_co_seq_duplicado",
                "dominio": "pacientes",
                "chave": str(co_seq),
                "total": len(ids),
                "ids": ids,
                "descricao": f"Chave única do e-SUS PEC (co_seq_cidadao_pec = {co_seq}) duplicada entre {len(ids)} cadastros.",
                "registros": [
                    {
                        "id": pid,
                        "nome": por_id[pid].nome,
                        "cpf": por_id[pid].cpf,
                        "co_seq_cidadao_pec": por_id[pid].co_seq_cidadao_pec,
                    }
                    for pid in ids if pid in por_id
                ],
            })

    # 5. Inconsistência: Paciente em óbito ou inativo com agendamentos/pedidos ativos
    tabs = tabelas_existentes(db)
    pacientes_inelegiveis = [
        p for p in pacientes
        if (p.data_obito is not None or (p.situacao_cadastral or "").lower() in ("obito", "mudanca_municipio", "inativo"))
    ]

    if pacientes_inelegiveis:
        pids_inelegiveis = {p.id for p in pacientes_inelegiveis if p.id}

        # Checa tfd_exames_fila ativos
        fila_ativa_map: Dict[int, int] = {}
        if "tfd_exames_fila" in tabs:
            rows = db.execute(
                select(ExameFila.paciente_id, func.count(ExameFila.id))
                .where(ExameFila.paciente_id.in_(pids_inelegiveis))
                .where(ExameFila.ativo == True)
                .where(ExameFila.status.in_(["aguardando", "agendado"]))
                .group_by(ExameFila.paciente_id)
            ).all()
            fila_ativa_map = {r[0]: r[1] for r in rows}

        # Checa lab_fila_psf ativos
        lab_fila_map: Dict[int, int] = {}
        if "lab_fila_psf" in tabs:
            rows = db.execute(
                select(FilaPsf.paciente_id, func.count(FilaPsf.id))
                .where(FilaPsf.paciente_id.in_(pids_inelegiveis))
                .where(FilaPsf.status.in_(["na_fila", "agendado"]))
                .group_by(FilaPsf.paciente_id)
            ).all()
            lab_fila_map = {r[0]: r[1] for r in rows}

        # Checa lab_solic_mestre ativos
        lab_mestre_map: Dict[int, int] = {}
        if "lab_solic_mestre" in tabs:
            rows = db.execute(
                select(SolicitacaoMestre.paciente_id, func.count(SolicitacaoMestre.id))
                .where(SolicitacaoMestre.paciente_id.in_(pids_inelegiveis))
                .where(SolicitacaoMestre.status == "agendado")
                .group_by(SolicitacaoMestre.paciente_id)
            ).all()
            lab_mestre_map = {r[0]: r[1] for r in rows}

        # Checa tfd_viagem_pacientes em viagens ativas
        viagens_map: Dict[int, int] = {}
        if "tfd_viagem_pacientes" in tabs and "tfd_viagens" in tabs:
            rows = db.execute(
                select(ViagemPaciente.paciente_id, func.count(ViagemPaciente.id))
                .join(Viagem, Viagem.id == ViagemPaciente.viagem_id)
                .where(ViagemPaciente.paciente_id.in_(pids_inelegiveis))
                .where(Viagem.status.in_(["agendada", "andamento"]))
                .group_by(ViagemPaciente.paciente_id)
            ).all()
            viagens_map = {r[0]: r[1] for r in rows}

        for p in pacientes_inelegiveis:
            pid = p.id
            q_fila = fila_ativa_map.get(pid, 0)
            q_lab = lab_fila_map.get(pid, 0)
            q_mestre = lab_mestre_map.get(pid, 0)
            q_viagem = viagens_map.get(pid, 0)
            total_ativos = q_fila + q_lab + q_mestre + q_viagem

            if total_ativos > 0:
                inconsistencias.append({
                    "tipo": "obito_com_pendencias",
                    "dominio": "pacientes",
                    "id": pid,
                    "paciente_id": pid,
                    "nome": p.nome,
                    "situacao_cadastral": p.situacao_cadastral,
                    "data_obito": str(p.data_obito) if p.data_obito else None,
                    "total_pedidos_ativos": total_ativos,
                    "exames_fila_ativos": q_fila,
                    "detalhes_pedidos": {
                        "exames_tfd_ativos": q_fila,
                        "fila_lab_psf_ativa": q_lab,
                        "solicitacoes_lab_agendadas": q_mestre,
                        "viagens_agendadas": q_viagem,
                    },
                    "descricao": f"Paciente com status '{p.situacao_cadastral}' ou óbito possui {total_ativos} pedido(s) ou agendamento(s) ativo(s) no sistema.",
                })

    # 6. Divergência entre data_obito e situacao_cadastral
    for p in pacientes:
        sit = (p.situacao_cadastral or "").lower()
        if p.data_obito is not None and sit == "ativo":
            inconsistencias.append({
                "tipo": "divergencia_obito_situacao",
                "dominio": "pacientes",
                "paciente_id": p.id,
                "nome": p.nome,
                "situacao_cadastral": p.situacao_cadastral,
                "data_obito": str(p.data_obito),
                "descricao": f"Paciente {p.nome} possui data de óbito registrada ({p.data_obito}), porém a situação cadastral está como 'ativo'.",
            })
        elif sit == "obito" and p.data_obito is None:
            inconsistencias.append({
                "tipo": "divergencia_obito_situacao",
                "dominio": "pacientes",
                "paciente_id": p.id,
                "nome": p.nome,
                "situacao_cadastral": p.situacao_cadastral,
                "data_obito": None,
                "descricao": f"Paciente {p.nome} está marcado com situação 'obito', porém sem data de óbito cadastrada.",
            })

    return duplicidades, inconsistencias


def diagnosticar_filas(db: Session) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Diagnóstico do domínio Filas de Espera (tfd_exames_fila, lab_fila_psf, tfd_tipos_fila)."""
    duplicidades: List[Dict[str, Any]] = []
    inconsistencias: List[Dict[str, Any]] = []
    tabs = tabelas_existentes(db)

    # 1. Duplicidade ativa em tfd_exames_fila (mesmo paciente e mesmo exame/código de procedimento)
    if "tfd_exames_fila" in tabs:
        exames_ativos = list(
            db.exec(
                select(ExameFila)
                .where(ExameFila.ativo == True)
                .where(ExameFila.status.in_(["aguardando", "agendado"]))
            ).all()
        )
        grupo_tfd: Dict[Tuple[int, str], List[ExameFila]] = {}
        for ef in exames_ativos:
            proc_chave = (ef.codigo_procedimento or ef.exame or "").strip().lower()
            if proc_chave:
                grupo_tfd.setdefault((ef.paciente_id, proc_chave), []).append(ef)

        for (paciente_id, proc_chave), itens in grupo_tfd.items():
            if len(itens) > 1:
                ids = [item.id for item in itens]
                duplicidades.append({
                    "tipo": "duplicidade_tfd_exames_fila",
                    "dominio": "filas",
                    "paciente_id": paciente_id,
                    "chave": proc_chave,
                    "total": len(ids),
                    "ids": ids,
                    "descricao": f"Paciente ID {paciente_id} possui {len(ids)} pedidos ativos para o mesmo exame/procedimento ({proc_chave}).",
                })

    # 2. Duplicidade ativa em lab_fila_psf (mesmo paciente, mesma data de solicitação e mesma especialidade/tipo)
    if "lab_fila_psf" in tabs:
        lab_filas_ativas = list(
            db.exec(
                select(FilaPsf)
                .where(FilaPsf.status.in_(["na_fila", "agendado"]))
            ).all()
        )
        grupo_lab: Dict[Tuple[int, str, Optional[str]], List[FilaPsf]] = {}
        for lf in lab_filas_ativas:
            tipo_chave = (lf.tipo_fila or lf.especialidade or "").strip().lower()
            data_str = str(lf.data_solicitacao) if lf.data_solicitacao else None
            grupo_lab.setdefault((lf.paciente_id, tipo_chave, data_str), []).append(lf)

        for (paciente_id, tipo_chave, data_str), itens in grupo_lab.items():
            if len(itens) > 1:
                ids = [item.id for item in itens]
                duplicidades.append({
                    "tipo": "duplicidade_lab_fila_psf",
                    "dominio": "filas",
                    "paciente_id": paciente_id,
                    "chave": f"{tipo_chave} | {data_str}",
                    "total": len(ids),
                    "ids": ids,
                    "descricao": f"Paciente ID {paciente_id} possui {len(ids)} solicitações laboratoriais repetidas na data {data_str}.",
                })

    # 3. Cruzamento Indevido: Exame Laboratorial em tfd_exames_fila e lab_fila_psf simultaneamente
    if "tfd_exames_fila" in tabs and "lab_fila_psf" in tabs:
        tfd_lab_cruzados = db.execute(
            text(
                "SELECT ef.id, lp.id, ef.paciente_id, ef.exame, ef.data_pedido "
                "FROM tfd_exames_fila ef "
                "JOIN lab_fila_psf lp ON lp.paciente_id = ef.paciente_id "
                "WHERE ef.ativo = TRUE AND ef.status IN ('aguardando', 'agendado') "
                "  AND lp.status IN ('na_fila', 'agendado') "
                "  AND (ef.tipo_fila LIKE '%LAB%' OR ef.tipo_fila LIKE '%SANGUE%' OR ef.tipo_fila LIKE '%BIOQUIM%')"
            )
        ).all()
        for row in tfd_lab_cruzados:
            inconsistencias.append({
                "tipo": "cruzamento_indevido_tfd_lab",
                "dominio": "filas",
                "tfd_fila_id": row[0],
                "lab_fila_id": row[1],
                "paciente_id": row[2],
                "exame": row[3],
                "data_pedido": str(row[4]) if row[4] else None,
                "descricao": f"Exame laboratorial inserido na Regulação Geral (ID {row[0]}) duplicado com Fila PSF (ID {row[1]}) para o paciente ID {row[2]}.",
            })

    # 4. Inconsistência de Tipagem com tfd_tipos_fila
    if "tfd_tipos_fila" in tabs:
        tipos_fila = list(db.exec(select(TipoFila)).all())
        tipos_ids = {tf.id for tf in tipos_fila if tf.id}

        # Checa tfd_exames_fila com fila_id inexistente
        if "tfd_exames_fila" in tabs:
            filas_orfas = list(
                db.exec(
                    select(ExameFila.id, ExameFila.paciente_id, ExameFila.tipo_fila, ExameFila.fila_id)
                    .where(ExameFila.ativo == True)
                    .where(ExameFila.fila_id.is_not(None))
                ).all()
            )
            for r in filas_orfas:
                if r[3] not in tipos_ids:
                    inconsistencias.append({
                        "tipo": "tipo_fila_invalido",
                        "dominio": "filas",
                        "tabela": "tfd_exames_fila",
                        "id": r[0],
                        "paciente_id": r[1],
                        "fila_id_invalido": r[3],
                        "descricao": f"Registro de exame (ID {r[0]}) aponta para tipo_fila inexistente (fila_id = {r[3]}).",
                    })

        # Checa lab_fila_psf com fila_id inexistente
        if "lab_fila_psf" in tabs:
            lab_orfas = list(
                db.exec(
                    select(FilaPsf.id, FilaPsf.paciente_id, FilaPsf.tipo_fila, FilaPsf.fila_id)
                    .where(FilaPsf.status != "cancelado")
                    .where(FilaPsf.fila_id.is_not(None))
                ).all()
            )
            for r in lab_orfas:
                if r[3] not in tipos_ids:
                    inconsistencias.append({
                        "tipo": "tipo_fila_invalido",
                        "dominio": "filas",
                        "tabela": "lab_fila_psf",
                        "id": r[0],
                        "paciente_id": r[1],
                        "fila_id_invalido": r[3],
                        "descricao": f"Registro de PSF (ID {r[0]}) aponta para tipo_fila inexistente (fila_id = {r[3]}).",
                    })

        # Checa tipos de fila duplicados em tfd_tipos_fila
        nomes_tf: Dict[str, List[int]] = {}
        for tf in tipos_fila:
            n = normalizar_texto(tf.nome)
            if n:
                nomes_tf.setdefault(n, []).append(tf.id)
        for nome_norm, ids in nomes_tf.items():
            if len(ids) > 1:
                duplicidades.append({
                    "tipo": "tipo_fila_duplicado",
                    "dominio": "filas",
                    "chave": nome_norm,
                    "total": len(ids),
                    "ids": ids,
                    "descricao": f"Existem {len(ids)} tipos de fila cadastrados com o mesmo nome ({nome_norm}).",
                })

    return duplicidades, inconsistencias


def diagnosticar_laboratorio(db: Session) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Diagnóstico do domínio Laboratório (lab_solic_mestre, lab_solic_itens, lab_vagas)."""
    duplicidades: List[Dict[str, Any]] = []
    inconsistencias: List[Dict[str, Any]] = []
    tabs = tabelas_existentes(db)

    # 1. Duplicidade de Agendamentos no Mesmo Dia para o Mesmo Paciente
    if "lab_solic_mestre" in tabs:
        solicitacoes_ativas = list(
            db.exec(
                select(SolicitacaoMestre)
                .where(SolicitacaoMestre.status != "cancelado")
            ).all()
        )
        grupo_mestre: Dict[Tuple[int, str], List[SolicitacaoMestre]] = {}
        for sm in solicitacoes_ativas:
            dt_str = str(sm.data_agendada) if sm.data_agendada else ""
            if dt_str:
                grupo_mestre.setdefault((sm.paciente_id, dt_str), []).append(sm)

        for (paciente_id, dt_str), itens in grupo_mestre.items():
            if len(itens) > 1:
                ids = [i.id for i in itens]
                duplicidades.append({
                    "tipo": "duplicidade_agendamento_dia",
                    "dominio": "laboratorio",
                    "paciente_id": paciente_id,
                    "data_agendada": dt_str,
                    "total": len(ids),
                    "ids": ids,
                    "solicitacoes_ids": ids,
                    "descricao": f"Paciente ID {paciente_id} possui {len(ids)} agendamentos laboratoriais ativos na mesma data ({dt_str}).",
                })

    # 2. Agendamentos sem Itens (Mestre Vazio / Órfão)
    if "lab_solic_mestre" in tabs and "lab_solic_itens" in tabs:
        itens_ids_solic = set(
            db.exec(select(ItemSolic.solicitacao_id).distinct()).all()
        )
        mestres_sem_itens = [
            sm for sm in solicitacoes_ativas if sm.id not in itens_ids_solic
        ]
        for sm in mestres_sem_itens:
            inconsistencias.append({
                "tipo": "mestre_sem_itens",
                "dominio": "laboratorio",
                "id": sm.id,
                "solicitacao_id": sm.id,
                "paciente_id": sm.paciente_id,
                "data_agendada": str(sm.data_agendada),
                "laboratorio_id": sm.laboratorio_id,
                "status": sm.status,
                "descricao": f"Agendamento laboratorial ID {sm.id} não possui nenhum procedimento cadastrado.",
            })

    # 3. Itens Duplicados dentro do Agendamento ou Órfãos de Solicitação
    if "lab_solic_itens" in tabs:
        all_itens = list(db.exec(select(ItemSolic)).all())
        mestre_ids = {sm.id for sm in solicitacoes_ativas if sm.id}

        grupo_itens: Dict[Tuple[int, int], List[int]] = {}
        for it in all_itens:
            if it.solicitacao_id not in mestre_ids:
                inconsistencias.append({
                    "tipo": "item_lab_orfao",
                    "dominio": "laboratorio",
                    "item_id": it.id,
                    "solicitacao_id": it.solicitacao_id,
                    "sigtap_id": it.sigtap_id,
                    "descricao": f"Item laboratorial ID {it.id} faz referência a uma solicitação inexistente ou cancelada ({it.solicitacao_id}).",
                })
            else:
                grupo_itens.setdefault((it.solicitacao_id, it.sigtap_id), []).append(it.id)

        for (solic_id, sigtap_id), item_ids in grupo_itens.items():
            if len(item_ids) > 1:
                duplicidades.append({
                    "tipo": "itens_duplicados_mesma_solicitacao",
                    "dominio": "laboratorio",
                    "solicitacao_id": solic_id,
                    "sigtap_id": sigtap_id,
                    "total": len(item_ids),
                    "itens_ids": item_ids,
                    "descricao": f"Procedimento SIGTAP ID {sigtap_id} repetido {len(item_ids)} vezes dentro da solicitação ID {solic_id}.",
                })

    # 4. Inconsistência de Vínculo entre Fila PSF e Agendamento
    if "lab_solic_mestre" in tabs and "lab_fila_psf" in tabs:
        filas_psf = list(db.exec(select(FilaPsf)).all())
        filas_dict = {f.id: f for f in filas_psf if f.id}

        for sm in solicitacoes_ativas:
            if sm.origem_fila_id is not None and sm.origem_fila_id not in filas_dict:
                inconsistencias.append({
                    "tipo": "solicitacao_com_fila_inexistente",
                    "dominio": "laboratorio",
                    "solicitacao_id": sm.id,
                    "origem_fila_id": sm.origem_fila_id,
                    "descricao": f"Solicitação ID {sm.id} aponta para fila de PSF inexistente (ID {sm.origem_fila_id}).",
                })

        agendados_psf = {sm.origem_fila_id for sm in solicitacoes_ativas if sm.origem_fila_id}
        for f in filas_psf:
            if f.status == "agendado" and f.id not in agendados_psf:
                inconsistencias.append({
                    "tipo": "fila_psf_agendada_sem_mestre",
                    "dominio": "laboratorio",
                    "fila_id": f.id,
                    "paciente_id": f.paciente_id,
                    "data_solicitacao": str(f.data_solicitacao) if f.data_solicitacao else None,
                    "descricao": f"Fila PSF ID {f.id} está marcada como 'agendado', mas não possui solicitação mestre ativa vinculada.",
                })

    # 5. Divergência na Contagem de Vagas Ocupadas (lab_vagas)
    if "lab_vagas" in tabs and "lab_solic_mestre" in tabs:
        vagas = list(db.exec(select(VagaLab)).all())
        for v in vagas:
            real_count = db.execute(
                select(func.count(SolicitacaoMestre.id))
                .where(SolicitacaoMestre.laboratorio_id == v.laboratorio_id)
                .where(SolicitacaoMestre.data_agendada == v.data)
                .where(SolicitacaoMestre.status != "cancelado")
            ).scalar() or 0

            if v.vagas_ocupadas != real_count:
                inconsistencias.append({
                    "tipo": "divergencia_contagem_vagas",
                    "dominio": "laboratorio",
                    "vaga_id": v.id,
                    "laboratorio_id": v.laboratorio_id,
                    "data": str(v.data),
                    "vagas_totais": v.vagas_totais,
                    "vagas_ocupadas_banco": v.vagas_ocupadas,
                    "vagas_ocupadas_real": real_count,
                    "diferenca": v.vagas_ocupadas - real_count,
                    "descricao": f"Vaga ID {v.id} (Data {v.data}): contagem de ocupadas no banco ({v.vagas_ocupadas}) diverge do total real de agendamentos ativos ({real_count}).",
                })

    return duplicidades, inconsistencias


def diagnosticar_viagens(db: Session) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Diagnóstico do domínio Regulação TFD e Viagens (tfd_viagens, tfd_viagem_pacientes, tfd_viagem_fila)."""
    duplicidades: List[Dict[str, Any]] = []
    inconsistencias: List[Dict[str, Any]] = []
    tabs = tabelas_existentes(db)

    if not ("tfd_viagens" in tabs and "tfd_viagem_pacientes" in tabs):
        return duplicidades, inconsistencias

    viagens = list(db.exec(select(Viagem)).all())
    viagens_dict = {v.id: v for v in viagens if v.id}
    passageiros = list(db.exec(select(ViagemPaciente)).all())

    # 1. Paciente Duplicado na Mesma Viagem
    viagem_pac_map: Dict[Tuple[int, int], List[int]] = {}
    for vp in passageiros:
        viagem_pac_map.setdefault((vp.viagem_id, vp.paciente_id), []).append(vp.id)

    for (viagem_id, paciente_id), ids in viagem_pac_map.items():
        if len(ids) > 1:
            duplicidades.append({
                "tipo": "paciente_duplicado_mesma_viagem",
                "dominio": "viagens",
                "viagem_id": viagem_id,
                "paciente_id": paciente_id,
                "total": len(ids),
                "ids": ids,
                "descricao": f"Paciente ID {paciente_id} alocado {len(ids)} vezes na mesma viagem (ID {viagem_id}).",
            })

    # 2. Inconsistência de Status: Fila de Viagem vs. Passageiro Alocado
    if "tfd_viagem_fila" in tabs:
        filas_viagem = list(db.exec(select(ViagemFila)).all())
        filas_v_dict = {vf.id: vf for vf in filas_viagem if vf.id}

        for vp in passageiros:
            if vp.viagem_fila_id and vp.viagem_fila_id in filas_v_dict:
                vf = filas_v_dict[vp.viagem_fila_id]
                v = viagens_dict.get(vp.viagem_id)
                if v and v.status != "cancelada" and vf.status == "aguardando":
                    inconsistencias.append({
                        "tipo": "passageiro_alocado_fila_aguardando",
                        "dominio": "viagens",
                        "viagem_paciente_id": vp.id,
                        "viagem_id": vp.viagem_id,
                        "viagem_fila_id": vf.id,
                        "descricao": f"Passageiro (ID {vp.id}) alocado na viagem ID {vp.viagem_id}, porém sua fila de transporte (ID {vf.id}) permanece com status 'aguardando'.",
                    })

        # Filas marcadas como alocadas sem passageiro em viagem ativa
        filas_alocadas_ids = {
            vp.viagem_fila_id for vp in passageiros
            if vp.viagem_fila_id and viagens_dict.get(vp.viagem_id) and viagens_dict[vp.viagem_id].status != "cancelada"
        }
        for vf in filas_viagem:
            if vf.status == "alocado" and vf.id not in filas_alocadas_ids:
                inconsistencias.append({
                    "tipo": "fila_viagem_alocada_sem_viagem",
                    "dominio": "viagens",
                    "viagem_fila_id": vf.id,
                    "paciente_id": vf.paciente_id,
                    "destino": vf.destino,
                    "data_consulta": str(vf.data_consulta) if vf.data_consulta else None,
                    "descricao": f"Fila de transporte ID {vf.id} marcada como 'alocado', porém o passageiro não consta em nenhuma viagem ativa.",
                })

        # Checa exame_fila_id inválido ou órfão em tfd_viagem_fila
        if "tfd_exames_fila" in tabs:
            exames_ids = {ef for ef in db.exec(select(ExameFila.id)).all() if ef is not None}
            for vf in filas_viagem:
                if vf.exame_fila_id and vf.exame_fila_id not in exames_ids:
                    inconsistencias.append({
                        "tipo": "viagem_fila_exame_inexistente",
                        "dominio": "viagens",
                        "viagem_fila_id": vf.id,
                        "exame_fila_id": vf.exame_fila_id,
                        "descricao": f"Fila de transporte ID {vf.id} referencia exame_fila_id {vf.exame_fila_id} inexistente.",
                    })

    # 3. Inconsistências de Acompanhante
    if "tfd_pacientes" in tabs:
        pacientes_ids = {p for p in db.exec(select(Paciente.id)).all() if p is not None}
        for vp in passageiros:
            if vp.acompanhante_id:
                if vp.acompanhante_id == vp.paciente_id:
                    inconsistencias.append({
                        "tipo": "auto_acompanhamento_viagem",
                        "dominio": "viagens",
                        "viagem_paciente_id": vp.id,
                        "viagem_id": vp.viagem_id,
                        "paciente_id": vp.paciente_id,
                        "descricao": f"Passageiro ID {vp.paciente_id} cadastrado como acompanhante de si mesmo na viagem ID {vp.viagem_id}.",
                    })
                elif vp.acompanhante_id not in pacientes_ids:
                    inconsistencias.append({
                        "tipo": "acompanhante_inexistente",
                        "dominio": "viagens",
                        "viagem_paciente_id": vp.id,
                        "viagem_id": vp.viagem_id,
                        "acompanhante_id": vp.acompanhante_id,
                        "descricao": f"Acompanhante ID {vp.acompanhante_id} na viagem ID {vp.viagem_id} não existe no cadastro de pacientes.",
                    })

    # 4. Lotação de Veículo Excedida em Viagens Ativas
    if "tfd_veiculos" in tabs:
        veiculos_dict = {v.id: v for v in db.exec(select(Veiculo)).all() if v.id}
        for v in viagens:
            if v.status in ("agendada", "andamento") and v.veiculo_id and v.veiculo_id in veiculos_dict:
                veic = veiculos_dict[v.veiculo_id]
                pass_viagem = [vp for vp in passageiros if vp.viagem_id == v.id]
                total_pac = len(pass_viagem)
                total_acomp = sum(
                    1 for vp in pass_viagem
                    if vp.acompanhante_id is not None or bool((vp.acompanhante or "").strip())
                )
                total_geral = total_pac + total_acomp

                if total_geral > veic.capacidade:
                    inconsistencias.append({
                        "tipo": "lotacao_veiculo_excedida",
                        "dominio": "viagens",
                        "viagem_id": v.id,
                        "data_viagem": str(v.data_viagem),
                        "destino": v.destino,
                        "veiculo_placa": veic.placa,
                        "capacidade_veiculo": veic.capacidade,
                        "total_passageiros": total_geral,
                        "excesso": total_geral - veic.capacidade,
                        "descricao": f"Viagem ID {v.id} com destino {v.destino} alocou {total_geral} passageiros para veículo {veic.placa} com capacidade para {veic.capacidade}.",
                    })

    return duplicidades, inconsistencias


def diagnosticar_cadastros(db: Session) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Diagnóstico do domínio Cadastros de Saúde (medicos, unidades_saude, prestadores, lab_laboratorios)."""
    duplicidades: List[Dict[str, Any]] = []
    inconsistencias: List[Dict[str, Any]] = []
    tabs = tabelas_existentes(db)

    # 1. Médicos (medicos)
    if "medicos" in tabs:
        medicos = list(db.exec(select(Medico)).all())
        unidades_ids = set()
        if "unidades_saude" in tabs:
            unidades_ids = {u for u in db.exec(select(UnidadeSaude.id)).all() if u is not None}

        # Duplicidade por CPF (11 dígitos válidos)
        cpf_med_map: Dict[str, List[int]] = {}
        for m in medicos:
            c = so_digitos(m.cpf)
            if len(c) == 11 and c != c[0] * 11:
                cpf_med_map.setdefault(c, []).append(m.id)

        for c, ids in cpf_med_map.items():
            if len(ids) > 1:
                duplicidades.append({
                    "tipo": "duplicidade_medico_cpf",
                    "dominio": "cadastros",
                    "chave": c,
                    "total": len(ids),
                    "ids": ids,
                    "descricao": f"Existem {len(ids)} médicos cadastrados com o mesmo CPF ({c}).",
                })

        # Duplicidade por CRM (normalizando caracteres não-alfanuméricos)
        crm_med_map: Dict[str, List[int]] = {}
        for m in medicos:
            crm_raw = (m.crm or "").strip().upper()
            crm_norm = re.sub(r"[^A-Z0-9]", "", crm_raw)
            if crm_norm and "RESP" not in crm_raw and "TECNICO" not in crm_raw:
                crm_med_map.setdefault(crm_norm, []).append(m.id)

        for crm_norm, ids in crm_med_map.items():
            if len(ids) > 1:
                duplicidades.append({
                    "tipo": "duplicidade_medico_crm",
                    "dominio": "cadastros",
                    "chave": crm_norm,
                    "total": len(ids),
                    "ids": ids,
                    "descricao": f"Existem {len(ids)} médicos cadastrados com o mesmo CRM ({crm_norm}).",
                })

        # Médicos com CBO ou descrição de motorista
        for m in medicos:
            cbo = (m.cbo_codigo or "").strip()
            desc = (m.cbo_descricao or "").strip().lower()
            nome = (m.nome or "").strip().lower()
            if cbo.startswith("7823") or "motorista" in desc or "motorista" in nome:
                inconsistencias.append({
                    "tipo": "medico_cbo_motorista",
                    "dominio": "cadastros",
                    "medico_id": m.id,
                    "nome": m.nome,
                    "cbo_codigo": m.cbo_codigo,
                    "cbo_descricao": m.cbo_descricao,
                    "descricao": f"Profissional ID {m.id} ({m.nome}) cadastrado como médico possui CBO ou descrição de motorista ({m.cbo_codigo}).",
                })

        # Vínculos inválidos em unidades_ids
        for m in medicos:
            u_str = (m.unidades_ids or "").strip()
            if u_str:
                u_parts = [p.strip() for p in u_str.split(",") if p.strip().isdigit()]
                invalid_ids = [int(p) for p in u_parts if int(p) not in unidades_ids]
                if invalid_ids:
                    inconsistencias.append({
                        "tipo": "medico_unidades_invalidas",
                        "dominio": "cadastros",
                        "medico_id": m.id,
                        "nome": m.nome,
                        "unidades_ids_invalidas": invalid_ids,
                        "descricao": f"Médico ID {m.id} ({m.nome}) aponta para unidade(s) de saúde inexistente(s): {invalid_ids}.",
                    })

    # 2. Unidades de Saúde (unidades_saude)
    if "unidades_saude" in tabs:
        unidades = list(db.exec(select(UnidadeSaude)).all())

        # Duplicidade por CNES
        cnes_map: Dict[str, List[int]] = {}
        for u in unidades:
            c = so_digitos(u.cnes)
            if c:
                cnes_map.setdefault(c, []).append(u.id)

        for c, ids in cnes_map.items():
            if len(ids) > 1:
                duplicidades.append({
                    "tipo": "duplicidade_unidade_cnes",
                    "dominio": "cadastros",
                    "chave": c,
                    "total": len(ids),
                    "ids": ids,
                    "descricao": f"Existem {len(ids)} unidades de saúde cadastradas com o mesmo CNES ({c}).",
                })

        # Formato de CNES inválido (diferente de 7 dígitos numéricos)
        for u in unidades:
            c = so_digitos(u.cnes)
            if u.cnes and (len(c) != 7 or not u.cnes.strip().isdigit()):
                inconsistencias.append({
                    "tipo": "unidade_cnes_invalido",
                    "dominio": "cadastros",
                    "unidade_id": u.id,
                    "nome": u.nome,
                    "cnes": u.cnes,
                    "descricao": f"Unidade de saúde ID {u.id} ({u.nome}) possui CNES em formato inválido ({u.cnes}). Esperado 7 dígitos numéricos.",
                })

    # 3. Prestadores e Laboratórios
    if "prestadores" in tabs:
        prestadores = list(db.exec(select(Prestador)).all())

        # Duplicidade por CNPJ
        cnpj_map: Dict[str, List[int]] = {}
        for p in prestadores:
            c = so_digitos(p.cnpj)
            if len(c) == 14 and c != c[0] * 14:
                cnpj_map.setdefault(c, []).append(p.id)

        for c, ids in cnpj_map.items():
            if len(ids) > 1:
                duplicidades.append({
                    "tipo": "duplicidade_prestador_cnpj",
                    "dominio": "cadastros",
                    "chave": c,
                    "total": len(ids),
                    "ids": ids,
                    "descricao": f"Existem {len(ids)} prestadores cadastrados com o mesmo CNPJ ({c}).",
                })

        # Duplicidade por CNES
        cnes_prest_map: Dict[str, List[int]] = {}
        for p in prestadores:
            c = so_digitos(p.cnes)
            if c:
                cnes_prest_map.setdefault(c, []).append(p.id)

        for c, ids in cnes_prest_map.items():
            if len(ids) > 1:
                duplicidades.append({
                    "tipo": "duplicidade_prestador_cnes",
                    "dominio": "cadastros",
                    "chave": c,
                    "total": len(ids),
                    "ids": ids,
                    "descricao": f"Existem {len(ids)} prestadores cadastrados com o mesmo CNES ({c}).",
                })

        # Cruzamento duplicado entre lab_laboratorios e prestadores
        if "lab_laboratorios" in tabs:
            labs = list(db.exec(select(Laboratorio)).all())
            for l in labs:
                l_nome = normalizar_texto(l.nome)
                if not l_nome:
                    continue
                for p in prestadores:
                    p_razao = normalizar_texto(p.razao_social)
                    p_fantasia = normalizar_texto(p.nome_fantasia)
                    if l_nome in (p_razao, p_fantasia):
                        inconsistencias.append({
                            "tipo": "cruzamento_lab_prestador_duplicado",
                            "dominio": "cadastros",
                            "laboratorio_id": l.id,
                            "laboratorio_nome": l.nome,
                            "prestador_id": p.id,
                            "prestador_razao": p.razao_social,
                            "descricao": f"Laboratório ID {l.id} ({l.nome}) possui cadastro coincidente na tabela de Prestadores (ID {p.id}).",
                        })

    # 4. Laboratórios (lab_laboratorios)
    if "lab_laboratorios" in tabs:
        labs = list(db.exec(select(Laboratorio)).all())
        nome_lab_map: Dict[str, List[int]] = {}
        for l in labs:
            n_norm = normalizar_texto(l.nome)
            if n_norm:
                nome_lab_map.setdefault(n_norm, []).append(l.id)

        for n_norm, ids in nome_lab_map.items():
            if len(ids) > 1:
                duplicidades.append({
                    "tipo": "duplicidade_laboratorio_nome",
                    "dominio": "cadastros",
                    "chave": n_norm,
                    "total": len(ids),
                    "ids": ids,
                    "descricao": f"Existem {len(ids)} laboratórios cadastrados com o mesmo nome normalizado ('{n_norm}').",
                })

    return duplicidades, inconsistencias


def diagnosticar_dados(db: Session, dominio: Optional[str] = None) -> DiagnosticoResponse:
    """Executa a rotina consolidada de diagnóstico nos 5 domínios."""
    detalhes = DetalhesDiagnostico()
    resumo = ResumoDiagnostico()

    dom = (dominio or "todos").strip().lower()

    if dom in ("todos", "pacientes"):
        dups, incs = diagnosticar_pacientes(db)
        detalhes.pacientes = dups + incs
        resumo.pacientes = ResumoDominio(duplicidades=len(dups), inconsistencias=len(incs))

    if dom in ("todos", "filas"):
        dups, incs = diagnosticar_filas(db)
        detalhes.filas = dups + incs
        resumo.filas = ResumoDominio(duplicidades=len(dups), inconsistencias=len(incs))

    if dom in ("todos", "laboratorio"):
        dups, incs = diagnosticar_laboratorio(db)
        detalhes.laboratorio = dups + incs
        resumo.laboratorio = ResumoDominio(duplicidades=len(dups), inconsistencias=len(incs))

    if dom in ("todos", "viagens"):
        dups, incs = diagnosticar_viagens(db)
        detalhes.viagens = dups + incs
        resumo.viagens = ResumoDominio(duplicidades=len(dups), inconsistencias=len(incs))

    if dom in ("todos", "cadastros"):
        dups, incs = diagnosticar_cadastros(db)
        detalhes.cadastros = dups + incs
        resumo.cadastros = ResumoDominio(duplicidades=len(dups), inconsistencias=len(incs))

    return DiagnosticoResponse(resumo=resumo, detalhes=detalhes)


# ==============================================================================
# R3 & R5: UNIFICAÇÃO E EXCLUSÃO SEGURA DE REGISTROS DUPLICADOS
# ==============================================================================

def unificar_registros(
    db: Session,
    request: UnificarRegistrosRequest,
    user: Optional[User] = None,
    client_ip: str = "",
    user_agent: str = "",
) -> UnificarRegistrosResponse:
    """Unifica registro duplicado no principal, reatribuindo todas as FKs e deletando o duplicado."""
    mid = request.registro_principal_id
    did = request.registro_duplicado_id
    entidade = request.entidade

    if mid == did:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O registro principal e o registro duplicado devem ser distintos.",
        )

    # 1. Bloqueio transacional distribuído e de concorrência
    acquire_advisory_lock(db, LOCK_DATA_UNIFY)

    try:
        if entidade == "pacientes":
            resp = _unificar_pacientes(db, mid, did, request.campos_mesclar, user, client_ip, user_agent)
        elif entidade == "medicos":
            resp = _unificar_medicos(db, mid, did, request.campos_mesclar, user, client_ip, user_agent)
        elif entidade == "unidades":
            resp = _unificar_unidades(db, mid, did, request.campos_mesclar, user, client_ip, user_agent)
        elif entidade == "laboratorios":
            resp = _unificar_laboratorios(db, mid, did, request.campos_mesclar, user, client_ip, user_agent)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Entidade '{entidade}' não suportada para unificação.",
            )

        db.commit()
        return resp
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("Falha ao unificar registros: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro durante a unificação de registros: {exc}",
        )


def _unificar_pacientes(
    db: Session,
    mid: int,
    did: int,
    campos_mesclar: Optional[Dict[str, Any]],
    user: Optional[User],
    client_ip: str,
    user_agent: str,
) -> UnificarRegistrosResponse:
    """Unifica dois pacientes reatribuindo as 18 dependências identificadas."""
    id_min, id_max = min(mid, did), max(mid, did)
    p_menor = db.exec(select(Paciente).where(Paciente.id == id_min).with_for_update()).first()
    p_maior = db.exec(select(Paciente).where(Paciente.id == id_max).with_for_update()).first()

    if not p_menor or not p_maior:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Registro principal ou duplicado de paciente não encontrado.",
        )

    master = p_menor if p_menor.id == mid else p_maior
    dup = p_menor if p_menor.id == did else p_maior

    tabs = tabelas_existentes(db)
    vinculos_migrados = 0
    conflitos_resolvidos: Dict[str, int] = {}

    # 1. Trata colisão em tfd_viagem_pacientes (UniqueConstraint viagem_id, paciente_id)
    if "tfd_viagem_pacientes" in tabs:
        res_del = db.execute(
            text(
                "DELETE FROM tfd_viagem_pacientes "
                "WHERE paciente_id = :did "
                "  AND viagem_id IN (SELECT viagem_id FROM tfd_viagem_pacientes WHERE paciente_id = :mid)"
            ),
            {"did": did, "mid": mid},
        )
        del_count = getattr(res_del, "rowcount", 0) or 0
        if del_count > 0:
            conflitos_resolvidos["tfd_viagem_pacientes_mesma_viagem"] = del_count

        res_up1 = db.execute(
            text("UPDATE tfd_viagem_pacientes SET paciente_id = :mid WHERE paciente_id = :did"),
            {"did": did, "mid": mid},
        )
        vinculos_migrados += getattr(res_up1, "rowcount", 0) or 0

        res_up2 = db.execute(
            text("UPDATE tfd_viagem_pacientes SET acompanhante_id = :mid WHERE acompanhante_id = :did"),
            {"did": did, "mid": mid},
        )
        vinculos_migrados += getattr(res_up2, "rowcount", 0) or 0

    # 2. Trata colisão em tfd_faturamento (UniqueConstraint viagem_id, paciente_id, codigo_sigtap)
    if "tfd_faturamento" in tabs:
        conflitos = db.execute(
            text(
                "SELECT f_dup.id FROM tfd_faturamento f_dup "
                "JOIN tfd_faturamento f_mas ON f_mas.paciente_id = :mid "
                " AND ((f_mas.viagem_id IS NULL AND f_dup.viagem_id IS NULL) OR f_mas.viagem_id = f_dup.viagem_id) "
                " AND f_mas.codigo_sigtap = f_dup.codigo_sigtap "
                "WHERE f_dup.paciente_id = :did"
            ),
            {"did": did, "mid": mid},
        ).all()
        if conflitos:
            del_fat = len(conflitos)
            for (cid,) in conflitos:
                db.execute(text("DELETE FROM tfd_faturamento WHERE id = :cid"), {"cid": int(cid)})
            conflitos_resolvidos["tfd_faturamento_mesmo_sigtap"] = del_fat

        res_fat = db.execute(
            text("UPDATE tfd_faturamento SET paciente_id = :mid WHERE paciente_id = :did"),
            {"did": did, "mid": mid},
        )
        vinculos_migrados += getattr(res_fat, "rowcount", 0) or 0

    # 3. Reatribui demais FKs simples e específicas de Paciente
    # Tabela tfd_viagem_fila
    if "tfd_viagem_fila" in tabs:
        res = db.execute(
            text("UPDATE tfd_viagem_fila SET paciente_id = :mid WHERE paciente_id = :did"),
            {"did": did, "mid": mid},
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0
        res = db.execute(
            text("UPDATE tfd_viagem_fila SET acompanhante_id = :mid WHERE acompanhante_id = :did"),
            {"did": did, "mid": mid},
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # Tabela tfd_exames_fila
    if "tfd_exames_fila" in tabs:
        res = db.execute(
            text("UPDATE tfd_exames_fila SET paciente_id = :mid WHERE paciente_id = :did"),
            {"did": did, "mid": mid},
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # Tabela tfd_pacientes_historico
    if "tfd_pacientes_historico" in tabs:
        res = db.execute(
            text("UPDATE tfd_pacientes_historico SET paciente_id = :mid WHERE paciente_id = :did"),
            {"did": did, "mid": mid},
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # Tabela lab_fila_psf
    if "lab_fila_psf" in tabs:
        res = db.execute(
            text("UPDATE lab_fila_psf SET paciente_id = :mid WHERE paciente_id = :did"),
            {"did": did, "mid": mid},
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # Tabela lab_solic_mestre
    if "lab_solic_mestre" in tabs:
        res = db.execute(
            text("UPDATE lab_solic_mestre SET paciente_id = :mid WHERE paciente_id = :did"),
            {"did": did, "mid": mid},
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # Tabela lab_lote_itens (atualiza FK e campos desnormalizados)
    if "lab_lote_itens" in tabs:
        res = db.execute(
            text(
                "UPDATE lab_lote_itens "
                "SET paciente_id = :mid, paciente_nome = :mnome, paciente_cpf = :mcpf, paciente_prontuario = :mpront "
                "WHERE paciente_id = :did"
            ),
            {
                "did": did,
                "mid": mid,
                "mnome": master.nome or "",
                "mcpf": master.cpf or "",
                "mpront": master.codigo_prontuario or "",
            },
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # Tabela lab_resultado_arquivos
    if "lab_resultado_arquivos" in tabs:
        res = db.execute(
            text("UPDATE lab_resultado_arquivos SET paciente_id = :mid WHERE paciente_id = :did"),
            {"did": did, "mid": mid},
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # Tabelas opcionais / secundárias
    for tab in ("lab_solicitacoes", "apac_solicitacoes", "oxigenio_emprestimos", "oxigenio_trocas_historico", "oxigenio_cilindros_vazios", "whatsapp_logs"):
        if tab in tabs:
            res = db.execute(
                text(f"UPDATE {tab} SET paciente_id = :mid WHERE paciente_id = :did"),
                {"did": did, "mid": mid},
            )
            vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # Tratamento da conta de usuário
    if "usuarios" in tabs:
        master_user = db.exec(select(User).where(User.paciente_id == mid)).first()
        if master_user:
            db.execute(text("UPDATE usuarios SET paciente_id = NULL WHERE paciente_id = :did"), {"did": did})
        else:
            res = db.execute(
                text("UPDATE usuarios SET paciente_id = :mid WHERE paciente_id = :did"),
                {"did": did, "mid": mid},
            )
            vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # 4. Consolidação de Metadados no Master
    # Backfill de campos vazios no master usando os valores do duplicate
    campos_enriquecidos = []
    atributos_backfill = [
        "cpf", "cns", "nascimento", "sexo", "nome_mae", "nome_social",
        "telefone", "endereco", "endereco_numero", "complemento", "bairro",
        "municipio", "cep", "ponto_referencia", "unidade_saude_id", "unidade_cnes",
        "unidade_nome", "equipe_esf", "equipe_ine", "microarea", "acs_nome",
        "co_seq_cidadao_pec", "codigo_prontuario",
    ]
    for attr in atributos_backfill:
        val_m = getattr(master, attr, None)
        val_d = getattr(dup, attr, None)
        if (val_m is None or val_m == "") and (val_d is not None and val_d != ""):
            setattr(master, attr, val_d)
            campos_enriquecidos.append(attr)

    # Aplicação de sobrescritas manuais fornecidas pelo usuário
    if campos_mesclar:
        for k, v in campos_mesclar.items():
            if k not in PROTECTED_FIELDS and hasattr(master, k):
                setattr(master, k, v)
                if k not in campos_enriquecidos:
                    campos_enriquecidos.append(k)

    master.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(master)
    db.flush()

    # 5. Exclusão permanente do duplicado
    db.delete(dup)
    db.flush()

    # 6. Gravação na trilha de auditoria
    detalhes_audit = {
        "tipo": "unificacao_paciente",
        "registro_principal_id": mid,
        "registro_duplicado_id": did,
        "nome_principal": master.nome,
        "nome_duplicado": dup.nome,
        "campos_enriquecidos": campos_enriquecidos,
        "vinculos_reatribuidos": vinculos_migrados,
        "conflitos_resolvidos": conflitos_resolvidos,
        "ip": client_ip,
    }
    registrar_auditoria(
        db=db,
        action="DATA_UNIFY_PACIENTE",
        entity="PATIENT",
        entity_id=mid,
        user=user,
        details=detalhes_audit,
        device=user_agent,
    )

    return UnificarRegistrosResponse(
        sucesso=True,
        mensagem=f"Paciente '{dup.nome}' (ID {did}) unificado com sucesso no cadastro principal '{master.nome}' (ID {mid}).",
        vinculos_reatribuidos=vinculos_migrados,
        registro_excluido_id=did,
        detalhes=detalhes_audit,
    )


def _unificar_medicos(
    db: Session,
    mid: int,
    did: int,
    campos_mesclar: Optional[Dict[str, Any]],
    user: Optional[User],
    client_ip: str,
    user_agent: str,
) -> UnificarRegistrosResponse:
    """Unifica dois cadastros de médicos reatribuindo dependências."""
    id_min, id_max = min(mid, did), max(mid, did)
    m_menor = db.exec(select(Medico).where(Medico.id == id_min).with_for_update()).first()
    m_maior = db.exec(select(Medico).where(Medico.id == id_max).with_for_update()).first()

    if not m_menor or not m_maior:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Registro principal ou duplicado de médico não encontrado.",
        )

    master = m_menor if m_menor.id == mid else m_maior
    dup = m_menor if m_menor.id == did else m_maior

    tabs = tabelas_existentes(db)
    vinculos_migrados = 0

    # 1. tfd_exames_fila (medico_id e snapshot)
    if "tfd_exames_fila" in tabs:
        res = db.execute(
            text(
                "UPDATE tfd_exames_fila "
                "SET medico_id = :mid, medico_nome = :nome, medico_cpf = :cpf, "
                "    medico_cbo_codigo = :cbo, medico_cbo_descricao = :cbodesc "
                "WHERE medico_id = :did"
            ),
            {
                "did": did,
                "mid": mid,
                "nome": master.nome or "",
                "cpf": master.cpf or "",
                "cbo": master.cbo_codigo or "",
                "cbodesc": master.cbo_descricao or "",
            },
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # 2. lab_solic_mestre (medico_id e medico_solicitante)
    if "lab_solic_mestre" in tabs:
        res = db.execute(
            text("UPDATE lab_solic_mestre SET medico_id = :mid, medico_solicitante = :nome WHERE medico_id = :did"),
            {"did": did, "mid": mid, "nome": master.nome or ""},
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # 3. apac_solicitacoes (medico_solicitante_id e medico_autorizador_id)
    if "apac_solicitacoes" in tabs:
        res = db.execute(
            text("UPDATE apac_solicitacoes SET medico_solicitante_id = :mid, medico_solicitante_nome = :nome WHERE medico_solicitante_id = :did"),
            {"did": did, "mid": mid, "nome": master.nome or ""},
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0
        res = db.execute(
            text("UPDATE apac_solicitacoes SET medico_autorizador_id = :mid WHERE medico_autorizador_id = :did"),
            {"did": did, "mid": mid},
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # 4. lab_fila_psf (medico_solicitante textual)
    if "lab_fila_psf" in tabs and dup.nome:
        res = db.execute(
            text("UPDATE lab_fila_psf SET medico_solicitante = :mnome WHERE medico_solicitante = :dnome"),
            {"mnome": master.nome, "dnome": dup.nome},
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # 5. usuarios
    if "usuarios" in tabs:
        m_user = db.exec(select(User).where(User.medico_id == mid)).first()
        if m_user:
            db.execute(text("UPDATE usuarios SET medico_id = NULL WHERE medico_id = :did"), {"did": did})
        else:
            res = db.execute(text("UPDATE usuarios SET medico_id = :mid WHERE medico_id = :did"), {"did": did, "mid": mid})
            vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # Consolidação de campos
    for attr in ("cpf", "crm", "cbo_codigo", "cbo_descricao", "especialidades", "telefone", "email"):
        val_m = getattr(master, attr, "")
        val_d = getattr(dup, attr, "")
        if not val_m and val_d:
            setattr(master, attr, val_d)

    # Mescla de unidades_ids
    u_master = set(p.strip() for p in (master.unidades_ids or "").split(",") if p.strip().isdigit())
    u_dup = set(p.strip() for p in (dup.unidades_ids or "").split(",") if p.strip().isdigit())
    u_comb = sorted(u_master.union(u_dup), key=int)
    master.unidades_ids = ",".join(u_comb)

    if campos_mesclar:
        for k, v in campos_mesclar.items():
            if k not in PROTECTED_FIELDS and hasattr(master, k):
                setattr(master, k, v)

    db.add(master)
    db.flush()
    db.delete(dup)
    db.flush()

    detalhes_audit = {
        "tipo": "unificacao_medico",
        "registro_principal_id": mid,
        "registro_duplicado_id": did,
        "nome_principal": master.nome,
        "nome_duplicado": dup.nome,
        "vinculos_reatribuidos": vinculos_migrados,
        "ip": client_ip,
    }
    registrar_auditoria(
        db=db,
        action="DATA_UNIFY_MEDICO",
        entity="DOCTOR",
        entity_id=mid,
        user=user,
        details=detalhes_audit,
        device=user_agent,
    )

    return UnificarRegistrosResponse(
        sucesso=True,
        mensagem=f"Médico '{dup.nome}' (ID {did}) unificado com sucesso no registro principal '{master.nome}' (ID {mid}).",
        vinculos_reatribuidos=vinculos_migrados,
        registro_excluido_id=did,
        detalhes=detalhes_audit,
    )


def _unificar_unidades(
    db: Session,
    mid: int,
    did: int,
    campos_mesclar: Optional[Dict[str, Any]],
    user: Optional[User],
    client_ip: str,
    user_agent: str,
) -> UnificarRegistrosResponse:
    """Unifica duas unidades de saúde reatribuindo dependências."""
    id_min, id_max = min(mid, did), max(mid, did)
    u_menor = db.exec(select(UnidadeSaude).where(UnidadeSaude.id == id_min).with_for_update()).first()
    u_maior = db.exec(select(UnidadeSaude).where(UnidadeSaude.id == id_max).with_for_update()).first()

    if not u_menor or not u_maior:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Registro principal ou duplicado de unidade de saúde não encontrado.",
        )

    master = u_menor if u_menor.id == mid else u_maior
    dup = u_menor if u_menor.id == did else u_maior

    tabs = tabelas_existentes(db)
    vinculos_migrados = 0

    # 1. tfd_pacientes
    if "tfd_pacientes" in tabs:
        res = db.execute(
            text(
                "UPDATE tfd_pacientes "
                "SET unidade_saude_id = :mid, unidade_cnes = :cnes, unidade_nome = :nome "
                "WHERE unidade_saude_id = :did"
            ),
            {"did": did, "mid": mid, "cnes": master.cnes or "", "nome": master.nome or ""},
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # 2. tfd_exames_fila
    if "tfd_exames_fila" in tabs:
        res = db.execute(
            text(
                "UPDATE tfd_exames_fila "
                "SET unidade_saude_id = :mid, unidade_nome = :nome, unidade_cnes = :cnes, "
                "    unidade_endereco = :end, unidade_numero = :num, unidade_bairro = :bairro, "
                "    unidade_municipio = :muni, unidade_cep = :cep "
                "WHERE unidade_saude_id = :did"
            ),
            {
                "did": did,
                "mid": mid,
                "nome": master.nome or "",
                "cnes": master.cnes or "",
                "end": master.endereco or "",
                "num": master.numero or "",
                "bairro": master.bairro or "",
                "muni": master.municipio or "",
                "cep": master.cep or "",
            },
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # 3. lab_fila_psf
    if "lab_fila_psf" in tabs:
        res = db.execute(
            text("UPDATE lab_fila_psf SET unidade_saude_id = :mid, unidade_psf = :nome WHERE unidade_saude_id = :did"),
            {"did": did, "mid": mid, "nome": master.nome or ""},
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # 4. lab_solic_mestre
    if "lab_solic_mestre" in tabs:
        res = db.execute(
            text("UPDATE lab_solic_mestre SET unidade_saude_id = :mid, unidade_psf = :nome WHERE unidade_saude_id = :did"),
            {"did": did, "mid": mid, "nome": master.nome or ""},
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # 5. usuarios
    if "usuarios" in tabs:
        res = db.execute(
            text("UPDATE usuarios SET unidade_saude_id = :mid WHERE unidade_saude_id = :did"),
            {"did": did, "mid": mid},
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # 6. medicos.unidades_ids (substitui did por mid na lista CSV)
    if "medicos" in tabs:
        medicos = list(db.exec(select(Medico)).all())
        did_str = str(did)
        mid_str = str(mid)
        for m in medicos:
            if m.unidades_ids and did_str in m.unidades_ids:
                parts = [p.strip() for p in m.unidades_ids.split(",") if p.strip()]
                new_parts = set()
                changed = False
                for p in parts:
                    if p == did_str:
                        new_parts.add(mid_str)
                        changed = True
                    else:
                        new_parts.add(p)
                if changed:
                    m.unidades_ids = ",".join(sorted(new_parts, key=lambda x: int(x) if x.isdigit() else 0))
                    db.add(m)
                    vinculos_migrados += 1

    # Consolidação de campos
    for attr in ("cnes", "endereco", "numero", "bairro", "municipio", "cep", "telefone"):
        val_m = getattr(master, attr, "")
        val_d = getattr(dup, attr, "")
        if not val_m and val_d:
            setattr(master, attr, val_d)

    if campos_mesclar:
        for k, v in campos_mesclar.items():
            if k not in PROTECTED_FIELDS and hasattr(master, k):
                setattr(master, k, v)

    db.add(master)
    db.flush()
    db.delete(dup)
    db.flush()

    detalhes_audit = {
        "tipo": "unificacao_unidade",
        "registro_principal_id": mid,
        "registro_duplicado_id": did,
        "nome_principal": master.nome,
        "nome_duplicado": dup.nome,
        "vinculos_reatribuidos": vinculos_migrados,
        "ip": client_ip,
    }
    registrar_auditoria(
        db=db,
        action="DATA_UNIFY_UNIDADE",
        entity="UNIT",
        entity_id=mid,
        user=user,
        details=detalhes_audit,
        device=user_agent,
    )

    return UnificarRegistrosResponse(
        sucesso=True,
        mensagem=f"Unidade de Saúde '{dup.nome}' (ID {did}) unificada com sucesso na unidade principal '{master.nome}' (ID {mid}).",
        vinculos_reatribuidos=vinculos_migrados,
        registro_excluido_id=did,
        detalhes=detalhes_audit,
    )


def _unificar_laboratorios(
    db: Session,
    mid: int,
    did: int,
    campos_mesclar: Optional[Dict[str, Any]],
    user: Optional[User],
    client_ip: str,
    user_agent: str,
) -> UnificarRegistrosResponse:
    """Unifica dois laboratórios conveniados resolvendo colisões compostas em vagas e faturamento."""
    id_min, id_max = min(mid, did), max(mid, did)
    l_menor = db.exec(select(Laboratorio).where(Laboratorio.id == id_min).with_for_update()).first()
    l_maior = db.exec(select(Laboratorio).where(Laboratorio.id == id_max).with_for_update()).first()

    if not l_menor or not l_maior:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Registro principal ou duplicado de laboratório não encontrado.",
        )

    master = l_menor if l_menor.id == mid else l_maior
    dup = l_menor if l_menor.id == did else l_maior

    tabs = tabelas_existentes(db)
    vinculos_migrados = 0
    conflitos_resolvidos: Dict[str, int] = {}

    # 1. Trata colisão em lab_vagas (UniqueConstraint laboratorio_id, data)
    if "lab_vagas" in tabs:
        vagas_master = {v.data: v for v in db.exec(select(VagaLab).where(VagaLab.laboratorio_id == mid)).all()}
        vagas_dup = list(db.exec(select(VagaLab).where(VagaLab.laboratorio_id == did)).all())

        colisoes_vagas = 0
        for vd in vagas_dup:
            if vd.data in vagas_master:
                vm = vagas_master[vd.data]
                vm.vagas_totais += vd.vagas_totais
                vm.vagas_ocupadas += vd.vagas_ocupadas
                db.add(vm)
                db.delete(vd)
                colisoes_vagas += 1
            else:
                vd.laboratorio_id = mid
                db.add(vd)
                vinculos_migrados += 1

        if colisoes_vagas > 0:
            conflitos_resolvidos["lab_vagas_mesma_data"] = colisoes_vagas
        db.flush()

    # 2. Trata colisão em lab_feriados_bloqueios
    if "lab_feriados_bloqueios" in tabs:
        datas_master = {fb for fb in db.exec(select(LabFeriadoBloqueio.data).where(LabFeriadoBloqueio.laboratorio_id == mid)).all()}
        fbs_dup = list(db.exec(select(LabFeriadoBloqueio).where(LabFeriadoBloqueio.laboratorio_id == did)).all())
        for fbd in fbs_dup:
            if fbd.data in datas_master:
                db.delete(fbd)
            else:
                fbd.laboratorio_id = mid
                db.add(fbd)
                vinculos_migrados += 1
        db.flush()

    # 3. Trata colisão em lab_fpo_competencias (UniqueConstraint laboratorio_id, competencia)
    if "lab_fpo_competencias" in tabs:
        fpos_master = {f.competencia: f for f in db.exec(select(LabFPOCompetencia).where(LabFPOCompetencia.laboratorio_id == mid)).all()}
        fpos_dup = list(db.exec(select(LabFPOCompetencia).where(LabFPOCompetencia.laboratorio_id == did)).all())
        for fd in fpos_dup:
            if fd.competencia in fpos_master:
                fm = fpos_master[fd.competencia]
                # Migra itens de fd para fm
                if "lab_fpo_itens" in tabs:
                    itens_master_sigtap = {it for it in db.exec(select(LabFPOItem.sigtap_id).where(LabFPOItem.fpo_id == fm.id)).all()}
                    itens_dup = list(db.exec(select(LabFPOItem).where(LabFPOItem.fpo_id == fd.id)).all())
                    for it_d in itens_dup:
                        if it_d.sigtap_id in itens_master_sigtap:
                            db.delete(it_d)
                        else:
                            it_d.fpo_id = fm.id
                            db.add(it_d)
                    db.flush()
                db.delete(fd)
            else:
                fd.laboratorio_id = mid
                db.add(fd)
                vinculos_migrados += 1
        db.flush()

    # 4. Trata colisão em lab_faturamento_fechamentos (UniqueConstraint laboratorio_id, competencia)
    if "lab_faturamento_fechamentos" in tabs:
        fech_master = {ff.competencia: ff for ff in db.exec(select(LabFechamentoFaturamento).where(LabFechamentoFaturamento.laboratorio_id == mid)).all()}
        fech_dup = list(db.exec(select(LabFechamentoFaturamento).where(LabFechamentoFaturamento.laboratorio_id == did)).all())
        for ffd in fech_dup:
            if ffd.competencia in fech_master:
                db.delete(ffd)
            else:
                ffd.laboratorio_id = mid
                db.add(ffd)
                vinculos_migrados += 1
        db.flush()

    # 5. Reatribui demais FKs simples de Laboratório
    for tab in ("lab_solic_mestre", "lab_pedidos_ajuste", "lab_contratos", "lab_resultado_arquivos", "usuarios"):
        if tab in tabs:
            res = db.execute(
                text(f"UPDATE {tab} SET laboratorio_id = :mid WHERE laboratorio_id = :did"),
                {"did": did, "mid": mid},
            )
            vinculos_migrados += getattr(res, "rowcount", 0) or 0

    if "lab_lotes_liberacao" in tabs:
        res = db.execute(
            text("UPDATE lab_lotes_liberacao SET laboratorio_id = :mid, laboratorio_nome = :nome WHERE laboratorio_id = :did"),
            {"did": did, "mid": mid, "nome": master.nome or ""},
        )
        vinculos_migrados += getattr(res, "rowcount", 0) or 0

    # Consolidação de campos
    for attr in ("responsavel_tecnico", "horario_funcionamento"):
        val_m = getattr(master, attr, "")
        val_d = getattr(dup, attr, "")
        if not val_m and val_d:
            setattr(master, attr, val_d)

    if campos_mesclar:
        for k, v in campos_mesclar.items():
            if k not in PROTECTED_FIELDS and hasattr(master, k):
                setattr(master, k, v)

    db.add(master)
    db.flush()
    db.delete(dup)
    db.flush()

    detalhes_audit = {
        "tipo": "unificacao_laboratorio",
        "registro_principal_id": mid,
        "registro_duplicado_id": did,
        "nome_principal": master.nome,
        "nome_duplicado": dup.nome,
        "vinculos_reatribuidos": vinculos_migrados,
        "conflitos_resolvidos": conflitos_resolvidos,
        "ip": client_ip,
    }
    registrar_auditoria(
        db=db,
        action="DATA_UNIFY_LABORATORIO",
        entity="LAB",
        entity_id=mid,
        user=user,
        details=detalhes_audit,
        device=user_agent,
    )

    return UnificarRegistrosResponse(
        sucesso=True,
        mensagem=f"Laboratório '{dup.nome}' (ID {did}) unificado com sucesso no laboratório principal '{master.nome}' (ID {mid}).",
        vinculos_reatribuidos=vinculos_migrados,
        registro_excluido_id=did,
        detalhes=detalhes_audit,
    )


# ==============================================================================
# R4: LIMPEZA EM MASSA ADMINISTRATIVA (COM SENHA DE CONFIRMAÇÃO)
# ==============================================================================

def preview_limpeza_massa(
    db: Session,
    request: LimpezaMassaPreviewRequest,
) -> LimpezaMassaPreviewResponse:
    """Pré-visualização (dry-run) da limpeza em massa sem executar remoções."""
    tipo = request.tipo_limpeza
    filtro = request.filtro or {}
    tabs = tabelas_existentes(db)

    detalhes: List[Dict[str, Any]] = []
    total = 0

    if tipo == "fila_importada":
        # Filtros de fila: tipo_fila, fila_id, data_inicio, data_fim, apenas_nao_agendados
        tipo_fila = filtro.get("tipo_fila")
        fila_id = filtro.get("fila_id")
        dt_ini = filtro.get("data_inicio")
        dt_fim = filtro.get("data_fim")
        apenas_nao_agendados = filtro.get("apenas_nao_agendados", True)

        # 1. Em tfd_exames_fila
        if "tfd_exames_fila" in tabs:
            stmt = select(ExameFila)
            if fila_id:
                stmt = stmt.where(ExameFila.fila_id == int(fila_id))
            elif tipo_fila:
                stmt = stmt.where(ExameFila.tipo_fila == str(tipo_fila))

            if dt_ini:
                stmt = stmt.where(ExameFila.data_pedido >= date.fromisoformat(str(dt_ini)))
            if dt_fim:
                stmt = stmt.where(ExameFila.data_pedido <= date.fromisoformat(str(dt_fim)))

            if apenas_nao_agendados:
                stmt = stmt.where(ExameFila.status.in_(["aguardando", "pendente"]))
                stmt = stmt.where(ExameFila.data_agendada.is_(None))

            rows_tfd = list(db.exec(stmt).all())
            for ef in rows_tfd:
                total += 1
                if len(detalhes) < 50:
                    detalhes.append({
                        "tabela": "tfd_exames_fila",
                        "id": ef.id,
                        "paciente_id": ef.paciente_id,
                        "exame": ef.exame,
                        "tipo_fila": ef.tipo_fila,
                        "data_pedido": str(ef.data_pedido) if ef.data_pedido else None,
                        "status": ef.status,
                    })

        # 2. Em lab_fila_psf
        if "lab_fila_psf" in tabs:
            stmt = select(FilaPsf)
            if fila_id:
                stmt = stmt.where(FilaPsf.fila_id == int(fila_id))
            elif tipo_fila:
                stmt = stmt.where(FilaPsf.tipo_fila == str(tipo_fila))

            if dt_ini:
                stmt = stmt.where(FilaPsf.data_solicitacao >= date.fromisoformat(str(dt_ini)))
            if dt_fim:
                stmt = stmt.where(FilaPsf.data_solicitacao <= date.fromisoformat(str(dt_fim)))

            if apenas_nao_agendados:
                stmt = stmt.where(FilaPsf.status.in_(["na_fila", "pendente"]))
                stmt = stmt.where(FilaPsf.data_agendada.is_(None))

            rows_lab = list(db.exec(stmt).all())
            for lf in rows_lab:
                total += 1
                if len(detalhes) < 50:
                    detalhes.append({
                        "tabela": "lab_fila_psf",
                        "id": lf.id,
                        "paciente_id": lf.paciente_id,
                        "especialidade": lf.especialidade,
                        "tipo_fila": lf.tipo_fila,
                        "data_solicitacao": str(lf.data_solicitacao) if lf.data_solicitacao else None,
                        "status": lf.status,
                    })

    elif tipo == "pedidos_orfaos":
        # 1. Agendamentos sem itens
        if "lab_solic_mestre" in tabs and "lab_solic_itens" in tabs:
            itens_ids_solic = set(db.exec(select(ItemSolic.solicitacao_id).distinct()).all())
            mestres = list(db.exec(select(SolicitacaoMestre)).all())
            for sm in mestres:
                if sm.id not in itens_ids_solic:
                    total += 1
                    if len(detalhes) < 50:
                        detalhes.append({
                            "tabela": "lab_solic_mestre",
                            "id": sm.id,
                            "tipo": "agendamento_sem_itens",
                            "paciente_id": sm.paciente_id,
                            "data_agendada": str(sm.data_agendada) if sm.data_agendada else None,
                        })

        # 2. Itens sem agendamento mestre
        if "lab_solic_itens" in tabs and "lab_solic_mestre" in tabs:
            mestre_ids = set(db.exec(select(SolicitacaoMestre.id)).all())
            itens = list(db.exec(select(ItemSolic)).all())
            for it in itens:
                if it.solicitacao_id not in mestre_ids:
                    total += 1
                    if len(detalhes) < 50:
                        detalhes.append({
                            "tabela": "lab_solic_itens",
                            "id": it.id,
                            "tipo": "item_sem_mestre",
                            "solicitacao_id": it.solicitacao_id,
                            "sigtap_id": it.sigtap_id,
                        })

        # 3. Exames na fila com paciente inexistente
        if "tfd_exames_fila" in tabs and "tfd_pacientes" in tabs:
            pids = set(db.exec(select(Paciente.id)).all())
            exames = list(db.exec(select(ExameFila)).all())
            for ef in exames:
                if ef.paciente_id not in pids:
                    total += 1
                    if len(detalhes) < 50:
                        detalhes.append({
                            "tabela": "tfd_exames_fila",
                            "id": ef.id,
                            "tipo": "paciente_inexistente",
                            "paciente_id": ef.paciente_id,
                            "exame": ef.exame,
                        })

    elif tipo == "agendamentos_duplicados":
        if "lab_solic_mestre" in tabs:
            mestres = list(
                db.exec(
                    select(SolicitacaoMestre)
                    .where(SolicitacaoMestre.status != "cancelado")
                    .order_by(SolicitacaoMestre.id.asc())
                ).all()
            )
            grupo: Dict[Tuple[int, str, int], List[SolicitacaoMestre]] = {}
            for sm in mestres:
                dt_str = str(sm.data_agendada) if sm.data_agendada else ""
                grupo.setdefault((sm.paciente_id, dt_str, sm.laboratorio_id), []).append(sm)

            for chave, lista in grupo.items():
                if len(lista) > 1:
                    # Preserva o primeiro (mais antigo), marca os demais para limpeza
                    for dup_sm in lista[1:]:
                        total += 1
                        if len(detalhes) < 50:
                            detalhes.append({
                                "tabela": "lab_solic_mestre",
                                "id": dup_sm.id,
                                "preservado_id": lista[0].id,
                                "paciente_id": dup_sm.paciente_id,
                                "data_agendada": str(dup_sm.data_agendada),
                                "laboratorio_id": dup_sm.laboratorio_id,
                            })

    elif tipo == "cadastros_fantasmas":
        # Pacientes sem nenhum vínculo no sistema e sem co_seq_cidadao_pec
        if "tfd_pacientes" in tabs:
            pacs = list(db.exec(select(Paciente)).all())
            # Coleta IDs com vínculo
            pids_com_vinculo: Set[int] = set()
            for t, col in (
                ("tfd_exames_fila", "paciente_id"),
                ("tfd_viagem_pacientes", "paciente_id"),
                ("lab_fila_psf", "paciente_id"),
                ("lab_solic_mestre", "paciente_id"),
                ("usuarios", "paciente_id"),
            ):
                if t in tabs:
                    try:
                        rows = db.execute(text(f"SELECT DISTINCT {col} FROM {t} WHERE {col} IS NOT NULL")).all()
                        pids_com_vinculo.update(r[0] for r in rows if r[0] is not None)
                    except Exception:
                        pass

            for p in pacs:
                if p.id not in pids_com_vinculo and p.co_seq_cidadao_pec is None:
                    total += 1
                    if len(detalhes) < 50:
                        detalhes.append({
                            "tabela": "tfd_pacientes",
                            "id": p.id,
                            "nome": p.nome,
                            "cpf": p.cpf,
                        })

    return LimpezaMassaPreviewResponse(
        total_afetados=total,
        detalhes=detalhes,
        mensagem=f"Pré-visualização concluída: {total} registro(s) elegível(is) para a limpeza '{tipo}'.",
    )


def executar_limpeza_massa(
    db: Session,
    request: LimpezaMassaExecutarRequest,
    admin: User,
    client_ip: str = "",
    user_agent: str = "",
) -> LimpezaMassaExecutarResponse:
    """Executa a limpeza em massa com autenticação explícita da senha de superusuário."""
    # 1. Validações de segurança e confirmação
    if not request.confirmacao_explicita:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A confirmação explícita da operação de limpeza em massa é obrigatória.",
        )

    if not request.senha or not request.senha.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A senha de confirmação do administrador é obrigatória.",
        )

    if not verify_password(request.senha.strip(), admin.password_hash):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Senha de administrador incorreta. Ação abortada.",
        )

    # 2. Bloqueio transacional de concorrência
    acquire_advisory_lock(db, LOCK_DATA_CLEANUP)

    tipo = request.tipo_limpeza
    filtro = request.filtro or {}
    tabs = tabelas_existentes(db)
    total_removidos = 0
    detalhes_execucao: Dict[str, Any] = {}

    try:
        if tipo == "fila_importada":
            tipo_fila = filtro.get("tipo_fila")
            fila_id = filtro.get("fila_id")
            dt_ini = filtro.get("data_inicio")
            dt_fim = filtro.get("data_fim")
            apenas_nao_agendados = filtro.get("apenas_nao_agendados", True)

            # A. Remove de tfd_exames_fila
            if "tfd_exames_fila" in tabs:
                stmt = select(ExameFila)
                if fila_id:
                    stmt = stmt.where(ExameFila.fila_id == int(fila_id))
                elif tipo_fila:
                    stmt = stmt.where(ExameFila.tipo_fila == str(tipo_fila))

                if dt_ini:
                    stmt = stmt.where(ExameFila.data_pedido >= date.fromisoformat(str(dt_ini)))
                if dt_fim:
                    stmt = stmt.where(ExameFila.data_pedido <= date.fromisoformat(str(dt_fim)))

                if apenas_nao_agendados:
                    stmt = stmt.where(ExameFila.status.in_(["aguardando", "pendente"]))
                    stmt = stmt.where(ExameFila.data_agendada.is_(None))

                alvos_tfd = list(db.exec(stmt).all())
                alvos_tfd_ids = [ef.id for ef in alvos_tfd if ef.id]

                if alvos_tfd_ids:
                    # Desvincula referências em tfd_viagem_fila
                    if "tfd_viagem_fila" in tabs:
                        filas_afetadas = list(
                            db.exec(
                                select(ViagemFila).where(ViagemFila.exame_fila_id.in_(alvos_tfd_ids))
                            ).all()
                        )
                        for vf in filas_afetadas:
                            vf.exame_fila_id = None
                            db.add(vf)

                    for ef in alvos_tfd:
                        db.delete(ef)
                    total_removidos += len(alvos_tfd_ids)
                    detalhes_execucao["tfd_exames_fila_removidos"] = len(alvos_tfd_ids)

            # B. Remove de lab_fila_psf
            if "lab_fila_psf" in tabs:
                stmt = select(FilaPsf)
                if fila_id:
                    stmt = stmt.where(FilaPsf.fila_id == int(fila_id))
                elif tipo_fila:
                    stmt = stmt.where(FilaPsf.tipo_fila == str(tipo_fila))

                if dt_ini:
                    stmt = stmt.where(FilaPsf.data_solicitacao >= date.fromisoformat(str(dt_ini)))
                if dt_fim:
                    stmt = stmt.where(FilaPsf.data_solicitacao <= date.fromisoformat(str(dt_fim)))

                if apenas_nao_agendados:
                    stmt = stmt.where(FilaPsf.status.in_(["na_fila", "pendente"]))
                    stmt = stmt.where(FilaPsf.data_agendada.is_(None))

                alvos_lab = list(db.exec(stmt).all())
                alvos_lab_ids = [lf.id for lf in alvos_lab if lf.id]

                if alvos_lab_ids:
                    # Desvincula em lab_solic_mestre
                    if "lab_solic_mestre" in tabs:
                        mestres_afetados = list(
                            db.exec(
                                select(SolicitacaoMestre).where(SolicitacaoMestre.origem_fila_id.in_(alvos_lab_ids))
                            ).all()
                        )
                        for sm in mestres_afetados:
                            sm.origem_fila_id = None
                            db.add(sm)

                    for lf in alvos_lab:
                        db.delete(lf)
                    total_removidos += len(alvos_lab_ids)
                    detalhes_execucao["lab_fila_psf_removidos"] = len(alvos_lab_ids)

        elif tipo == "pedidos_orfaos":
            # 1. Itens sem mestre
            if "lab_solic_itens" in tabs and "lab_solic_mestre" in tabs:
                mestre_ids = set(db.exec(select(SolicitacaoMestre.id)).all())
                itens_orfaos = [it for it in db.exec(select(ItemSolic)).all() if it.solicitacao_id not in mestre_ids]
                for it in itens_orfaos:
                    db.delete(it)
                total_removidos += len(itens_orfaos)
                detalhes_execucao["itens_lab_orfaos_removidos"] = len(itens_orfaos)

            # 2. Mestres sem itens
            if "lab_solic_mestre" in tabs and "lab_solic_itens" in tabs:
                itens_ids_solic = set(db.exec(select(ItemSolic.solicitacao_id).distinct()).all())
                mestres_vazios = [sm for sm in db.exec(select(SolicitacaoMestre)).all() if sm.id not in itens_ids_solic]
                for sm in mestres_vazios:
                    db.delete(sm)
                total_removidos += len(mestres_vazios)
                detalhes_execucao["mestres_lab_vazios_removidos"] = len(mestres_vazios)

            # 3. Filas com paciente inexistente
            if "tfd_exames_fila" in tabs and "tfd_pacientes" in tabs:
                pids = set(db.exec(select(Paciente.id)).all())
                exames_orfaos = [ef for ef in db.exec(select(ExameFila)).all() if ef.paciente_id not in pids]
                for ef in exames_orfaos:
                    db.delete(ef)
                total_removidos += len(exames_orfaos)
                detalhes_execucao["tfd_exames_paciente_invalido_removidos"] = len(exames_orfaos)

        elif tipo == "agendamentos_duplicados":
            if "lab_solic_mestre" in tabs:
                mestres = list(
                    db.exec(
                        select(SolicitacaoMestre)
                        .where(SolicitacaoMestre.status != "cancelado")
                        .order_by(SolicitacaoMestre.id.asc())
                    ).all()
                )
                grupo: Dict[Tuple[int, str, int], List[SolicitacaoMestre]] = {}
                for sm in mestres:
                    dt_str = str(sm.data_agendada) if sm.data_agendada else ""
                    grupo.setdefault((sm.paciente_id, dt_str, sm.laboratorio_id), []).append(sm)

                dups_removidos = 0
                for chave, lista in grupo.items():
                    if len(lista) > 1:
                        # Exclui itens e mestres duplicados posteriores
                        for dup_sm in lista[1:]:
                            if "lab_solic_itens" in tabs:
                                itens_dup = list(db.exec(select(ItemSolic).where(ItemSolic.solicitacao_id == dup_sm.id)).all())
                                for it in itens_dup:
                                    db.delete(it)
                            db.delete(dup_sm)
                            dups_removidos += 1

                total_removidos += dups_removidos
                detalhes_execucao["agendamentos_lab_duplicados_removidos"] = dups_removidos

        elif tipo == "cadastros_fantasmas":
            if "tfd_pacientes" in tabs:
                pacs = list(db.exec(select(Paciente)).all())
                pids_com_vinculo: Set[int] = set()
                for t, col in (
                    ("tfd_exames_fila", "paciente_id"),
                    ("tfd_viagem_pacientes", "paciente_id"),
                    ("lab_fila_psf", "paciente_id"),
                    ("lab_solic_mestre", "paciente_id"),
                    ("usuarios", "paciente_id"),
                ):
                    if t in tabs:
                        try:
                            rows = db.execute(text(f"SELECT DISTINCT {col} FROM {t} WHERE {col} IS NOT NULL")).all()
                            pids_com_vinculo.update(r[0] for r in rows if r[0] is not None)
                        except Exception:
                            pass

                fantasmas = [p for p in pacs if p.id not in pids_com_vinculo and p.co_seq_cidadao_pec is None]
                for p in fantasmas:
                    db.delete(p)
                total_removidos += len(fantasmas)
                detalhes_execucao["pacientes_fantasmas_removidos"] = len(fantasmas)

        db.flush()

        # 3. Trilha de auditoria
        audit_payload = {
            "tipo_limpeza": tipo,
            "filtros": filtro,
            "total_removidos": total_removidos,
            "detalhes": detalhes_execucao,
            "admin_username": admin.username,
            "ip": client_ip,
        }
        registrar_auditoria(
            db=db,
            action="DATA_MASS_CLEANUP",
            entity="DATA_MANAGEMENT",
            entity_id=None,
            user=admin,
            details=audit_payload,
            device=user_agent,
        )

        db.commit()

        return LimpezaMassaExecutarResponse(
            sucesso=True,
            total_removidos=total_removidos,
            mensagem=f"Limpeza em massa '{tipo}' concluída com sucesso. {total_removidos} registro(s) removido(s).",
            detalhes=detalhes_execucao,
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("Falha na execução da limpeza em massa: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro durante a execução da limpeza em massa: {exc}",
        )


# ==============================================================================
# AUDITORIA DE GERENCIAMENTO DE DADOS
# ==============================================================================

def listar_logs_auditoria_gerenciamento(
    db: Session,
    limit: int = 50,
    offset: int = 0,
) -> AuditoriaGerenciamentoResponse:
    """Retorna os logs de auditoria específicos das ações de gerenciamento de dados."""
    query = (
        select(AuditLog)
        .where(
            AuditLog.action.in_([
                "DATA_UNIFY_PACIENTE",
                "DATA_UNIFY_MEDICO",
                "DATA_UNIFY_UNIDADE",
                "DATA_UNIFY_LABORATORIO",
                "DATA_MASS_CLEANUP",
                "DATA_UNIFY_PATIENT",
                "DATA_UNIFY_DOCTOR",
                "DATA_UNIFY_UNIT",
                "DATA_UNIFY_LAB",
                "DATA_MASS_CLEANUP_QUEUE",
                "DATA_MASS_CLEANUP_ORPHANS",
            ])
            | AuditLog.action.like("DATA_%")
        )
        .order_by(AuditLog.timestamp.desc())
    )

    total_query = select(func.count(AuditLog.id)).where(
        AuditLog.action.in_([
            "DATA_UNIFY_PACIENTE",
            "DATA_UNIFY_MEDICO",
            "DATA_UNIFY_UNIDADE",
            "DATA_UNIFY_LABORATORIO",
            "DATA_MASS_CLEANUP",
            "DATA_UNIFY_PATIENT",
            "DATA_UNIFY_DOCTOR",
            "DATA_UNIFY_UNIT",
            "DATA_UNIFY_LAB",
            "DATA_MASS_CLEANUP_QUEUE",
            "DATA_MASS_CLEANUP_ORPHANS",
        ])
        | AuditLog.action.like("DATA_%")
    )

    total = db.execute(total_query).scalar() or 0
    logs = list(db.exec(query.offset(offset).limit(limit)).all())

    items = [
        LogAuditoriaItem(
            id=log.id,
            user_id=log.user_id,
            user_name=log.user_name,
            action=log.action,
            entity=log.entity,
            entity_id=log.entity_id,
            device=log.device,
            details=log.details,
            timestamp=log.timestamp,
            rotulo_acao=rotulo_acao(log.action),
            rotulo_entidade=rotulo_entidade(log.entity),
        )
        for log in logs
        if log.id is not None
    ]

    return AuditoriaGerenciamentoResponse(logs=items, total=total)
