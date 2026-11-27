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
from app.schemas.gerenciamento_dados import (
    AuditoriaGerenciamentoResponse,
    DetalhesDiagnostico,
    DiagnosticoResponse,
    FilaResumoLimpeza,
    LimpezaMassaExecutarRequest,
    LimpezaMassaExecutarResponse,
    LimpezaMassaPreviewRequest,
    LimpezaMassaPreviewResponse,
    LogAuditoriaItem,
    ResolverInconsistenciaItem,
    ResolverInconsistenciaResultado,
    ResolverLoteRequest,
    ResolverLoteResponse,
    ResumoDiagnostico,
    ResumoDominio,
    ResumoLimpezaManualResponse,
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

_CAMPOS_MESCLAR_PACIENTE = frozenset({
    "nome", "cpf", "cns", "nascimento", "sexo", "nome_mae", "nome_pai", "nome_social",
    "telefone", "endereco", "endereco_numero", "complemento", "bairro",
    "municipio", "cep", "ponto_referencia", "unidade_saude_id", "unidade_cnes",
    "unidade_nome", "equipe_esf", "equipe_ine", "microarea", "acs_nome",
    "co_seq_cidadao_pec", "codigo_prontuario",
})
_CAMPOS_MESCLAR_MEDICO = frozenset({
    "nome", "cpf", "crm", "cbo_codigo", "cbo_descricao", "especialidades",
    "telefone", "email", "unidades_ids", "ativo",
})
_CAMPOS_MESCLAR_UNIDADE = frozenset({
    "nome", "cnes", "endereco", "numero", "bairro", "municipio", "cep", "telefone", "ativo",
})
_CAMPOS_MESCLAR_LABORATORIO = frozenset({
    "nome", "responsavel_tecnico", "horario_funcionamento", "cnpj", "cnes",
    "telefone", "endereco", "ativo",
})
_CAMPOS_MESCLAR_PRESTADOR = frozenset({
    "razao_social", "nome_fantasia", "cnpj", "cnes", "tipo_entidade",
    "responsavel_nome", "responsavel_telefone", "email", "telefone",
    "endereco", "municipio", "observacoes", "ativo",
})


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
    """Retorna o conjunto de nomes de tabelas existentes usando a conexão ativa da sessão."""
    try:
        conn = db.connection()
        return set(sa_inspect(conn).get_table_names())
    except Exception:
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

    # 1. Duplicidade ativa em tfd_exames_fila (mesmo paciente e mesmo exame/código de procedimento;
    #    para consultas/retornos como 0301010072, distingue também pela especialidade/CBO solicitada)
    if "tfd_exames_fila" in tabs:
        exames_ativos = list(
            db.exec(
                select(ExameFila)
                .where(ExameFila.ativo == True)
                .where(ExameFila.status.in_(["aguardando", "agendado"]))
            ).all()
        )
        grupo_tfd: Dict[Tuple[int, str, str], List[ExameFila]] = {}
        for ef in exames_ativos:
            cod_proc = (ef.codigo_procedimento or "").strip().lower()
            exame_norm = normalizar_texto(ef.exame)
            proc_chave = cod_proc or exame_norm
            if not proc_chave:
                continue

            tipo_fila_norm = normalizar_texto(ef.tipo_fila)
            eh_consulta = (
                cod_proc in ("0301010072", "9999990001")
                or "consulta" in tipo_fila_norm
                or "consulta" in exame_norm
                or "retorno" in tipo_fila_norm
                or "retorno" in exame_norm
            )
            esp_chave = ""
            if eh_consulta:
                esp_chave = (
                    normalizar_texto(ef.nome_especialidade)
                    or (ef.codigo_especialidade or "").strip()
                    or normalizar_texto(ef.especialidade)
                    or tipo_fila_norm
                )
            grupo_tfd.setdefault((ef.paciente_id, proc_chave, esp_chave), []).append(ef)

        for (paciente_id, proc_chave, esp_chave), itens in grupo_tfd.items():
            if len(itens) > 1:
                ids = [item.id for item in itens]
                rotulo_esp = (itens[0].nome_especialidade or itens[0].especialidade or itens[0].codigo_especialidade or "").strip()
                rotulo_proc = f"{proc_chave} · {rotulo_esp}" if (esp_chave and rotulo_esp) else proc_chave
                duplicidades.append({
                    "tipo": "duplicidade_tfd_exames_fila",
                    "dominio": "filas",
                    "paciente_id": paciente_id,
                    "chave": rotulo_proc,
                    "total": len(ids),
                    "ids": ids,
                    "descricao": f"Paciente ID {paciente_id} possui {len(ids)} pedidos ativos para o mesmo exame/procedimento ({rotulo_proc}).",
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

        # Médicos com CBO ou descrição de motorista (apenas ativos)
        for m in medicos:
            if not m.ativo:
                continue
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

        # Cruzamento duplicado entre lab_laboratorios e prestadores (apenas ativos)
        if "lab_laboratorios" in tabs:
            labs = list(db.exec(select(Laboratorio)).all())
            for l in labs:
                if not l.ativo:
                    continue
                l_nome = normalizar_texto(l.nome)
                if not l_nome:
                    continue
                for p in prestadores:
                    if not p.ativo:
                        continue
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


_CACHE_CHAVE_TODOS = "todos"

_METADADOS_CORRECAO: Dict[str, Tuple[str, str, Optional[str]]] = {
    # Pacientes
    "duplicidade_cpf": (
        "Unificar pacientes",
        "Preserva o cadastro mais completo/antigo, reatribui todas as 18 tabelas vinculadas e exclui os duplicados.",
        "pacientes",
    ),
    "duplicidade_cns": (
        "Unificar pacientes",
        "Preserva o cadastro mais completo/antigo, reatribui vínculos e exclui os duplicados.",
        "pacientes",
    ),
    "duplicidade_nome_nascimento": (
        "Unificar pacientes",
        "Preserva o cadastro mais completo/antigo, reatribui vínculos e exclui os duplicados.",
        "pacientes",
    ),
    "pec_co_seq_duplicado": (
        "Unificar cadastros PEC",
        "Consolida os cadastros com a mesma chave co_seq_cidadao_pec no registro principal.",
        "pacientes",
    ),
    "obito_com_pendencias": (
        "Cancelar pendências ativas",
        "Cancela exames em fila, solicitações laboratoriais agendadas e remove alocações em viagens ativas do paciente.",
        None,
    ),
    "divergencia_obito_situacao": (
        "Sincronizar situação/óbito",
        "Alinha a situação cadastral com a data de óbito (marca 'obito' se houver data ou registra a data faltante).",
        None,
    ),
    # Filas
    "duplicidade_tfd_exames_fila": (
        "Cancelar pedidos duplicados",
        "Mantém o pedido mais avançado/antigo na fila TFD e cancela os pedidos repetidos.",
        None,
    ),
    "duplicidade_lab_fila_psf": (
        "Cancelar solicitações duplicadas",
        "Mantém a solicitação mais avançada/antiga na fila PSF e cancela as repetidas.",
        None,
    ),
    "cruzamento_indevido_tfd_lab": (
        "Remover da fila TFD",
        "Cancela o pedido redundante da Regulação Geral, mantendo o exame apenas na fila de laboratório (PSF).",
        None,
    ),
    "tipo_fila_invalido": (
        "Corrigir vínculo de fila",
        "Tenta revincular ao tipo de fila correspondente pelo nome ou limpa a referência inválida (fila_id).",
        None,
    ),
    "tipo_fila_duplicado": (
        "Unificar tipos de fila",
        "Reatribui os exames e filas PSF para o tipo de fila principal e exclui os cadastros duplicados.",
        None,
    ),
    # Laboratório
    "duplicidade_agendamento_dia": (
        "Consolidar agendamentos",
        "Move os procedimentos únicos para o agendamento principal, cancela os repetidos e recalcula as vagas.",
        None,
    ),
    "mestre_sem_itens": (
        "Cancelar agendamento vazio",
        "Cancela a solicitação sem procedimentos, devolve a fila PSF para 'na_fila' e atualiza as vagas.",
        None,
    ),
    "item_lab_orfao": (
        "Excluir item órfão",
        "Remove o item de exame vinculado a uma solicitação inexistente ou cancelada.",
        None,
    ),
    "itens_duplicados_mesma_solicitacao": (
        "Remover itens duplicados",
        "Mantém apenas um registro do procedimento SIGTAP na solicitação e exclui as cópias.",
        None,
    ),
    "solicitacao_com_fila_inexistente": (
        "Limpar vínculo de fila",
        "Remove o ponteiro quebrado origem_fila_id da solicitação laboratorial.",
        None,
    ),
    "fila_psf_agendada_sem_mestre": (
        "Devolver à fila PSF",
        "Retorna o status da fila PSF de 'agendado' para 'na_fila' para permitir novo agendamento.",
        None,
    ),
    "divergencia_contagem_vagas": (
        "Sincronizar contagem de vagas",
        "Atualiza vagas_ocupadas no banco com o número real de agendamentos ativos naquela data.",
        None,
    ),
    # Viagens
    "paciente_duplicado_mesma_viagem": (
        "Remover alocação duplicada",
        "Mantém apenas uma alocação do paciente na viagem e exclui os registros excedentes.",
        None,
    ),
    "passageiro_alocado_fila_aguardando": (
        "Sincronizar fila p/ alocado",
        "Atualiza o status da fila de transporte para 'alocado', refletindo a viagem ativa.",
        None,
    ),
    "fila_viagem_alocada_sem_viagem": (
        "Devolver à fila de viagem",
        "Retorna o status da fila de transporte para 'aguardando', pois não há viagem ativa vinculada.",
        None,
    ),
    "viagem_fila_exame_inexistente": (
        "Limpar vínculo de exame",
        "Remove a referência quebrada exame_fila_id da fila de transporte.",
        None,
    ),
    "auto_acompanhamento_viagem": (
        "Remover auto-acompanhante",
        "Limpa o campo acompanhante_id inválido onde o paciente acompanhava a si mesmo.",
        None,
    ),
    "acompanhante_inexistente": (
        "Limpar acompanhante inválido",
        "Remove o ponteiro acompanhante_id que referencia um paciente inexistente.",
        None,
    ),
    "lotacao_veiculo_excedida": (
        "Ajustar lotação do veículo",
        "Desaloca os últimos passageiros excedentes da viagem e os devolve à fila de transporte como 'aguardando'.",
        None,
    ),
    # Cadastros
    "duplicidade_medico_cpf": (
        "Unificar médicos",
        "Preserva o cadastro principal do médico, reatribui solicitações/filas e exclui os duplicados.",
        "medicos",
    ),
    "duplicidade_medico_crm": (
        "Unificar médicos",
        "Preserva o cadastro principal do médico, reatribui solicitações/filas e exclui os duplicados.",
        "medicos",
    ),
    "medico_cbo_motorista": (
        "Inativar cadastro indevido",
        "Inativa o profissional cadastrado incorretamente como médico com CBO/descrição de motorista.",
        None,
    ),
    "medico_unidades_invalidas": (
        "Limpar unidades inválidas",
        "Remove os IDs de unidades de saúde inexistentes do cadastro do médico.",
        None,
    ),
    "duplicidade_unidade_cnes": (
        "Unificar unidades",
        "Preserva a unidade principal, reatribui vínculos e exclui as unidades duplicadas.",
        "unidades",
    ),
    "unidade_cnes_invalido": (
        "Normalizar CNES",
        "Formata o CNES para 7 dígitos numéricos (ou limpa o campo se não houver dígitos aproveitáveis).",
        None,
    ),
    "duplicidade_prestador_cnpj": (
        "Unificar prestadores",
        "Preserva o prestador principal, mescla dados complementares e remove os duplicados.",
        "prestadores",
    ),
    "duplicidade_prestador_cnes": (
        "Unificar prestadores",
        "Preserva o prestador principal, mescla dados complementares e remove os duplicados.",
        "prestadores",
    ),
    "cruzamento_lab_prestador_duplicado": (
        "Inativar prestador redundante",
        "Inativa o registro coincidente na tabela de Prestadores, mantendo ativo o cadastro em Laboratórios.",
        None,
    ),
    "duplicidade_laboratorio_nome": (
        "Unificar laboratórios",
        "Preserva o laboratório principal, reatribui contratos/vagas/agendamentos e exclui os duplicados.",
        "laboratorios",
    ),
}


def _gerar_chave_unica_item(item: Dict[str, Any]) -> str:
    """Gera identificador estável e determinístico para cada ocorrência do diagnóstico."""
    dominio = str(item.get("dominio") or "geral")
    tipo = str(item.get("tipo") or "desconhecido")
    partes: List[str] = [dominio, tipo]

    for campo in (
        "chave",
        "tabela",
        "id",
        "paciente_id",
        "tfd_fila_id",
        "lab_fila_id",
        "solicitacao_id",
        "item_id",
        "sigtap_id",
        "fila_id",
        "vaga_id",
        "viagem_id",
        "viagem_paciente_id",
        "viagem_fila_id",
        "medico_id",
        "unidade_id",
        "laboratorio_id",
        "prestador_id",
        "data_agendada",
    ):
        val = item.get(campo)
        if val is not None and val != "":
            partes.append(f"{campo}={val}")

    for lista_campo in ("ids", "itens_ids", "solicitacoes_ids"):
        lst = item.get(lista_campo)
        if isinstance(lst, list) and lst:
            partes.append(f"{lista_campo}={','.join(str(x) for x in sorted(lst))}")

    return "|".join(partes)


def _enriquecer_item_diagnostico(item: Dict[str, Any]) -> Dict[str, Any]:
    """Adiciona chave_unica e metadados de correção a qualquer ocorrência do diagnóstico."""
    tipo = str(item.get("tipo") or "")
    acao, desc_corr, entidade_unif = _METADADOS_CORRECAO.get(
        tipo,
        ("Corrigir inconsistência", "Aplica a correção automatizada para esta ocorrência.", None),
    )
    enriquecido = dict(item)
    enriquecido["chave_unica"] = _gerar_chave_unica_item(enriquecido)
    enriquecido["corrigivel"] = True
    enriquecido["acao_sugerida"] = acao
    enriquecido["descricao_correcao"] = desc_corr
    if entidade_unif is not None:
        enriquecido["entidade_unificavel"] = entidade_unif
    return enriquecido


def _eh_postgres(db: Session) -> bool:
    try:
        bind = db.get_bind()
        return getattr(getattr(bind, "dialect", None), "name", "") == "postgresql"
    except Exception:
        return False


def _garantir_tabela_cache(db: Session) -> None:
    """Garante existência da tabela gerenciamento_dados_cache em PostgreSQL e SQLite."""
    ddl = text(
        "CREATE TABLE IF NOT EXISTS gerenciamento_dados_cache ("
        "chave VARCHAR(40) PRIMARY KEY, "
        "payload_json TEXT NOT NULL, "
        "atualizado_em TIMESTAMP NOT NULL)"
    )
    try:
        if _eh_postgres(db):
            with db.begin_nested():
                db.execute(ddl)
        else:
            db.execute(ddl)
    except Exception as exc:
        logger.debug("Tabela gerenciamento_dados_cache já existente ou indisponível: %s", exc)


def _ler_cache_diagnostico(db: Session) -> Optional[DiagnosticoResponse]:
    """Lê o diagnóstico em cache persistido no banco (compartilhado entre workers Gunicorn)."""
    try:
        _garantir_tabela_cache(db)
        row = db.execute(
            text(
                "SELECT payload_json, atualizado_em FROM gerenciamento_dados_cache "
                "WHERE chave = :chave"
            ),
            {"chave": _CACHE_CHAVE_TODOS},
        ).first()
        if not row:
            return None
        payload_raw, atualizado_em = row[0], row[1]
        data = json.loads(payload_raw)
        resp = DiagnosticoResponse.model_validate(data)
        resp.cache_hit = True
        if isinstance(atualizado_em, str):
            try:
                resp.gerado_em = datetime.fromisoformat(atualizado_em)
            except ValueError:
                resp.gerado_em = None
        else:
            resp.gerado_em = atualizado_em
        return resp
    except Exception as exc:
        logger.debug("Falha ao ler cache de diagnóstico (será recalculado): %s", exc)
        return None


def _gravar_cache_diagnostico(db: Session, resp: DiagnosticoResponse, agora: datetime) -> None:
    """Persiste o diagnóstico completo no cache do banco."""
    try:
        _garantir_tabela_cache(db)
        payload_str = resp.model_dump_json()
        params_del = {"chave": _CACHE_CHAVE_TODOS}
        params_ins = {
            "chave": _CACHE_CHAVE_TODOS,
            "payload_json": payload_str,
            "atualizado_em": agora,
        }
        sql_del = text("DELETE FROM gerenciamento_dados_cache WHERE chave = :chave")
        sql_ins = text(
            "INSERT INTO gerenciamento_dados_cache (chave, payload_json, atualizado_em) "
            "VALUES (:chave, :payload_json, :atualizado_em)"
        )
        if _eh_postgres(db):
            with db.begin_nested():
                db.execute(sql_del, params_del)
                db.execute(sql_ins, params_ins)
        else:
            db.execute(sql_del, params_del)
            db.execute(sql_ins, params_ins)
        db.commit()
    except Exception as exc:
        logger.debug("Falha ao gravar cache de diagnóstico: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass


def invalidar_cache_diagnostico(db: Session) -> None:
    """Invalida o cache de diagnóstico dentro da transação atual após qualquer alteração."""
    sql_del = text("DELETE FROM gerenciamento_dados_cache WHERE chave = :chave")
    try:
        if _eh_postgres(db):
            with db.begin_nested():
                db.execute(sql_del, {"chave": _CACHE_CHAVE_TODOS})
        else:
            if "gerenciamento_dados_cache" in tabelas_existentes(db):
                db.execute(sql_del, {"chave": _CACHE_CHAVE_TODOS})
    except Exception as exc:
        logger.debug("Cache de diagnóstico não invalidado (tabela ainda não criada): %s", exc)


def _filtrar_resposta_dominio(resp: DiagnosticoResponse, dom: str) -> DiagnosticoResponse:
    """Retorna visão filtrada por domínio mantendo os metadados de cache."""
    if dom == "todos":
        return resp
    detalhes = DetalhesDiagnostico()
    resumo = ResumoDiagnostico()
    if dom == "pacientes":
        detalhes.pacientes = resp.detalhes.pacientes
        resumo.pacientes = resp.resumo.pacientes
    elif dom == "filas":
        detalhes.filas = resp.detalhes.filas
        resumo.filas = resp.resumo.filas
    elif dom == "laboratorio":
        detalhes.laboratorio = resp.detalhes.laboratorio
        resumo.laboratorio = resp.resumo.laboratorio
    elif dom == "viagens":
        detalhes.viagens = resp.detalhes.viagens
        resumo.viagens = resp.resumo.viagens
    elif dom == "cadastros":
        detalhes.cadastros = resp.detalhes.cadastros
        resumo.cadastros = resp.resumo.cadastros
    return DiagnosticoResponse(
        resumo=resumo,
        detalhes=detalhes,
        cache_hit=resp.cache_hit,
        gerado_em=resp.gerado_em,
    )


def diagnosticar_dados(
    db: Session,
    dominio: Optional[str] = None,
    forcar: bool = False,
    usar_cache: bool = True,
) -> DiagnosticoResponse:
    """Executa a rotina consolidada de diagnóstico nos 5 domínios com cache persistente."""
    dom = (dominio or "todos").strip().lower()

    if usar_cache and not forcar:
        cached = _ler_cache_diagnostico(db)
        if cached is not None:
            return _filtrar_resposta_dominio(cached, dom)

    detalhes = DetalhesDiagnostico()
    resumo = ResumoDiagnostico()

    # Quando cache está habilitado, sempre computa todos os domínios para preencher o cache completo
    computar_todos = usar_cache or dom == "todos"

    if computar_todos or dom == "pacientes":
        dups, incs = diagnosticar_pacientes(db)
        detalhes.pacientes = [_enriquecer_item_diagnostico(i) for i in (dups + incs)]
        resumo.pacientes = ResumoDominio(duplicidades=len(dups), inconsistencias=len(incs))

    if computar_todos or dom == "filas":
        dups, incs = diagnosticar_filas(db)
        detalhes.filas = [_enriquecer_item_diagnostico(i) for i in (dups + incs)]
        resumo.filas = ResumoDominio(duplicidades=len(dups), inconsistencias=len(incs))

    if computar_todos or dom == "laboratorio":
        dups, incs = diagnosticar_laboratorio(db)
        detalhes.laboratorio = [_enriquecer_item_diagnostico(i) for i in (dups + incs)]
        resumo.laboratorio = ResumoDominio(duplicidades=len(dups), inconsistencias=len(incs))

    if computar_todos or dom == "viagens":
        dups, incs = diagnosticar_viagens(db)
        detalhes.viagens = [_enriquecer_item_diagnostico(i) for i in (dups + incs)]
        resumo.viagens = ResumoDominio(duplicidades=len(dups), inconsistencias=len(incs))

    if computar_todos or dom == "cadastros":
        dups, incs = diagnosticar_cadastros(db)
        detalhes.cadastros = [_enriquecer_item_diagnostico(i) for i in (dups + incs)]
        resumo.cadastros = ResumoDominio(duplicidades=len(dups), inconsistencias=len(incs))

    agora = datetime.now(timezone.utc).replace(tzinfo=None)
    resp_completa = DiagnosticoResponse(
        resumo=resumo,
        detalhes=detalhes,
        cache_hit=False,
        gerado_em=agora,
    )

    if usar_cache:
        _gravar_cache_diagnostico(db, resp_completa, agora)

    return _filtrar_resposta_dominio(resp_completa, dom)


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
        elif entidade == "prestadores":
            resp = _unificar_prestadores(db, mid, did, request.campos_mesclar, user, client_ip, user_agent)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Entidade '{entidade}' não suportada para unificação.",
            )

        invalidar_cache_diagnostico(db)
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
        "cpf", "cns", "nascimento", "sexo", "nome_mae", "nome_pai", "nome_social",
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
            if k in _CAMPOS_MESCLAR_PACIENTE and hasattr(master, k):
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
            if k in _CAMPOS_MESCLAR_MEDICO and hasattr(master, k):
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
            if k in _CAMPOS_MESCLAR_UNIDADE and hasattr(master, k):
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
            if k in _CAMPOS_MESCLAR_LABORATORIO and hasattr(master, k):
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
# R4: LIMPEZA EM MASSA ADMINISTRATIVA E LIMPEZA MANUAL POR ÁREA
# ==============================================================================

TABELAS_LIMPEZA_PERMITIDAS: frozenset[str] = frozenset({
    # Filas e TFD
    "tfd_exames_fila",
    "tfd_viagem_fila",
    "tfd_viagem_pacientes",
    "tfd_faturamento",
    "tfd_viagens",
    "tfd_veiculos",
    "tfd_motoristas",
    "tfd_destinos",
    "tfd_pacientes_historico",
    # Laboratório
    "lab_inconsistencias_justificativas",
    "lab_conferencias_automaticas",
    "lab_resultado_arquivos",
    "lab_pedidos_ajuste",
    "lab_lote_itens",
    "lab_lote_artefatos",
    "lab_solic_itens",
    "lab_solic_mestre",
    "lab_fila_psf",
    "lab_lotes_liberacao",
    "lab_solicitacoes",
    "lab_feriados_bloqueios",
    "lab_vagas",
    "lab_faturamento_fechamentos",
    "lab_fpo_itens",
    "lab_fpo_competencias",
    "lab_orcamentos_mensais",
    # Oxigênio
    "oxigenio_trocas_historico",
    "oxigenio_emprestimo_itens",
    "oxigenio_cilindros_vazios",
    "oxigenio_emprestimos",
    "oxigenio_comodato_movimentacoes",
    "oxigenio_compras",
    "oxigenio_equipamentos",
    "oxigenio_licitacoes",
    "oxigenio_empresas",
    # APAC
    "apac_anexos",
    "apac_procedimentos_secundarios",
    "apac_solicitacoes",
    "apac_lotes",
    "apac_faixas",
    # Farmácia
    "farmacia_movimentacoes",
    "farmacia_movimentacoes_insumos",
    "farmacia_links_publicos",
    "farmacia_medicamentos",
    "farmacia_insumos",
})

TIPOS_LIMPEZA_VALIDOS: frozenset[str] = frozenset({
    "fila_importada",
    "pedidos_orfaos",
    "agendamentos_duplicados",
    "cadastros_fantasmas",
    "limpar_filas_manual",
    "limpar_laboratorio_completo",
    "limpar_oxigenio",
    "limpar_tfd_viagens",
    "limpar_apac",
    "limpar_farmacia",
    "limpar_pacientes_manual",
})


def _contar_tabela(db: Session, tabs: Set[str], tabela: str) -> int:
    if tabela not in tabs or tabela not in TABELAS_LIMPEZA_PERMITIDAS:
        return 0
    try:
        return int(db.execute(text(f"SELECT COUNT(*) FROM {tabela}")).scalar() or 0)
    except Exception:
        return 0


def _deletar_tabela_inteira(db: Session, tabs: Set[str], tabela: str) -> int:
    if tabela not in tabs or tabela not in TABELAS_LIMPEZA_PERMITIDAS:
        return 0
    qtd = _contar_tabela(db, tabs, tabela)
    if qtd > 0:
        db.execute(text(f"DELETE FROM {tabela}"))
    return qtd


def _coletar_pacientes_vinculados_todos_modulos(db: Session, tabs: Set[str]) -> Set[int]:
    """Coleta todos os IDs de tfd_pacientes referenciados em qualquer módulo do sistema."""
    pids: Set[int] = set()
    referencias = (
        ("tfd_exames_fila", "paciente_id"),
        ("tfd_viagem_pacientes", "paciente_id"),
        ("tfd_viagem_pacientes", "acompanhante_id"),
        ("tfd_viagem_fila", "paciente_id"),
        ("tfd_viagem_fila", "acompanhante_id"),
        ("tfd_faturamento", "paciente_id"),
        ("lab_fila_psf", "paciente_id"),
        ("lab_solic_mestre", "paciente_id"),
        ("lab_lote_itens", "paciente_id"),
        ("lab_resultado_arquivos", "paciente_id"),
        ("lab_solicitacoes", "paciente_id"),
        ("oxigenio_emprestimos", "paciente_id"),
        ("oxigenio_trocas_historico", "paciente_id"),
        ("oxigenio_cilindros_vazios", "paciente_id"),
        ("apac_solicitacoes", "paciente_id"),
        ("usuarios", "paciente_id"),
    )
    for t, col in referencias:
        if t in tabs:
            try:
                rows = db.execute(text(f"SELECT DISTINCT {col} FROM {t} WHERE {col} IS NOT NULL")).all()
                pids.update(int(r[0]) for r in rows if r[0] is not None)
            except Exception:
                pass
    return pids


def _contar_sigtap_manual_removivel(db: Session, tabs: Set[str]) -> List[int]:
    """Retorna IDs de SigtapProcedimento criados manualmente (origem_manual=True) sem vínculos."""
    if "sigtap_procedimentos" not in tabs:
        return []
    manuais = list(
        db.exec(
            select(SigtapProcedimento.id).where(SigtapProcedimento.origem_manual == True)  # noqa: E712
        ).all()
    )
    manuais_ids = {int(x) for x in manuais if x is not None}
    if not manuais_ids:
        return []
    em_uso: Set[int] = set()
    for t, col in (
        ("lab_solic_itens", "sigtap_id"),
        ("lab_contratos_precos", "sigtap_id"),
        ("lab_fpo_itens", "sigtap_id"),
        ("lab_solicitacoes", "sigtap_id"),
    ):
        if t in tabs:
            try:
                rows = db.execute(text(f"SELECT DISTINCT {col} FROM {t} WHERE {col} IS NOT NULL")).all()
                em_uso.update(int(r[0]) for r in rows if r[0] is not None)
            except Exception:
                pass
    return sorted(manuais_ids - em_uso)


def _consultar_alvos_filas_manual(
    db: Session,
    tabs: Set[str],
    filtro: Dict[str, Any],
) -> Tuple[List[ExameFila], List[FilaPsf], List[SolicitacaoMestre]]:
    """Seleciona registros de filas (TFD e/ou Lab) e agendamentos vinculados conforme filtro manual."""
    from sqlmodel import or_

    origem = str(filtro.get("origem") or "todas").strip().lower()
    fila_id_raw = filtro.get("fila_id")
    tipo_fila_txt = str(filtro.get("tipo_fila") or "").strip()
    dt_ini = filtro.get("data_inicio")
    dt_fim = filtro.get("data_fim")
    incluir_agendados = bool(filtro.get("incluir_agendados", True))
    incluir_agendamentos_lab = bool(filtro.get("incluir_agendamentos_lab_vinculados", False))

    tf_obj: Optional[TipoFila] = None
    filtrar_sem_vinculo = False
    if str(fila_id_raw or "").strip().lower() == "sem_vinculo":
        filtrar_sem_vinculo = True
    elif fila_id_raw not in (None, "", "todas", "todos"):
        try:
            tf_obj = db.get(TipoFila, int(fila_id_raw))
        except (TypeError, ValueError):
            tf_obj = None

    alvos_tfd: List[ExameFila] = []
    alvos_lab: List[FilaPsf] = []
    alvos_solic: List[SolicitacaoMestre] = []

    if origem in ("todas", "apenas_tfd") and "tfd_exames_fila" in tabs:
        stmt = select(ExameFila)
        if filtrar_sem_vinculo:
            stmt = stmt.where(ExameFila.fila_id.is_(None))
        elif tf_obj is not None:
            nome_u = (tf_obj.nome or "").strip().upper()
            if nome_u:
                stmt = stmt.where(
                    or_(
                        ExameFila.fila_id == tf_obj.id,
                        (ExameFila.fila_id.is_(None) & (func.upper(ExameFila.tipo_fila) == nome_u)),
                    )
                )
            else:
                stmt = stmt.where(ExameFila.fila_id == tf_obj.id)
        elif tipo_fila_txt:
            stmt = stmt.where(func.upper(ExameFila.tipo_fila) == tipo_fila_txt.upper())

        if dt_ini:
            stmt = stmt.where(ExameFila.data_pedido >= date.fromisoformat(str(dt_ini)))
        if dt_fim:
            stmt = stmt.where(ExameFila.data_pedido <= date.fromisoformat(str(dt_fim)))
        if not incluir_agendados:
            stmt = stmt.where(ExameFila.status.in_(["aguardando", "pendente"]))
            stmt = stmt.where(ExameFila.data_agendada.is_(None))
        alvos_tfd = list(db.exec(stmt).all())

    if origem in ("todas", "apenas_lab") and "lab_fila_psf" in tabs:
        stmt = select(FilaPsf)
        if filtrar_sem_vinculo:
            stmt = stmt.where(FilaPsf.fila_id.is_(None))
        elif tf_obj is not None:
            nome_u = (tf_obj.nome or "").strip().upper()
            if nome_u:
                stmt = stmt.where(
                    or_(
                        FilaPsf.fila_id == tf_obj.id,
                        (
                            FilaPsf.fila_id.is_(None)
                            & or_(
                                func.upper(FilaPsf.tipo_fila) == nome_u,
                                func.upper(FilaPsf.especialidade) == nome_u,
                            )
                        ),
                    )
                )
            else:
                stmt = stmt.where(FilaPsf.fila_id == tf_obj.id)
        elif tipo_fila_txt:
            tf_u = tipo_fila_txt.upper()
            stmt = stmt.where(
                or_(
                    func.upper(FilaPsf.tipo_fila) == tf_u,
                    func.upper(FilaPsf.especialidade) == tf_u,
                )
            )

        if dt_ini:
            stmt = stmt.where(FilaPsf.data_solicitacao >= date.fromisoformat(str(dt_ini)))
        if dt_fim:
            stmt = stmt.where(FilaPsf.data_solicitacao <= date.fromisoformat(str(dt_fim)))
        if not incluir_agendados:
            stmt = stmt.where(FilaPsf.status.in_(["na_fila", "pendente"]))
            stmt = stmt.where(FilaPsf.data_agendada.is_(None))
        alvos_lab = list(db.exec(stmt).all())

    if incluir_agendamentos_lab and alvos_lab and "lab_solic_mestre" in tabs:
        lab_ids = [lf.id for lf in alvos_lab if lf.id]
        if lab_ids:
            alvos_solic = list(
                db.exec(
                    select(SolicitacaoMestre).where(SolicitacaoMestre.origem_fila_id.in_(lab_ids))
                ).all()
            )

    return alvos_tfd, alvos_lab, alvos_solic


def obter_resumo_limpeza_manual(db: Session) -> ResumoLimpezaManualResponse:
    """Retorna contagens atuais por fila e por módulo principal para o painel de limpeza manual."""
    tabs = tabelas_existentes(db)

    tfd_por_fila: Dict[int, int] = {}
    lab_por_fila: Dict[int, int] = {}
    tfd_sem_fila = 0
    lab_sem_fila = 0

    if "tfd_exames_fila" in tabs:
        for fid, cnt in db.execute(
            text("SELECT fila_id, COUNT(*) FROM tfd_exames_fila GROUP BY fila_id")
        ).all():
            if fid is None:
                tfd_sem_fila = int(cnt or 0)
            else:
                tfd_por_fila[int(fid)] = int(cnt or 0)

    if "lab_fila_psf" in tabs:
        for fid, cnt in db.execute(
            text("SELECT fila_id, COUNT(*) FROM lab_fila_psf GROUP BY fila_id")
        ).all():
            if fid is None:
                lab_sem_fila = int(cnt or 0)
            else:
                lab_por_fila[int(fid)] = int(cnt or 0)

    filas_out: List[FilaResumoLimpeza] = []
    if "tfd_tipos_fila" in tabs:
        tipos = list(db.exec(select(TipoFila).order_by(TipoFila.nome.asc())).all())
        for tf in tipos:
            if not tf.id:
                continue
            q_tfd = tfd_por_fila.get(tf.id, 0)
            q_lab = lab_por_fila.get(tf.id, 0)
            filas_out.append(
                FilaResumoLimpeza(
                    id=tf.id,
                    nome=tf.nome or f"Fila #{tf.id}",
                    codigo=tf.codigo or "",
                    tipo_fila=getattr(tf, "tipo_fila", None) or "REGULACAO_GERAL",
                    qtd_tfd=q_tfd,
                    qtd_lab=q_lab,
                    total=q_tfd + q_lab,
                )
            )

    pac_total = 0
    pac_sem_pec = 0
    if "tfd_pacientes" in tabs:
        pac_total = int(db.execute(text("SELECT COUNT(*) FROM tfd_pacientes")).scalar() or 0)
        pac_sem_pec = int(
            db.execute(text("SELECT COUNT(*) FROM tfd_pacientes WHERE co_seq_cidadao_pec IS NULL")).scalar() or 0
        )

    sigtap_manual = 0
    if "sigtap_procedimentos" in tabs:
        try:
            sigtap_manual = int(
                db.exec(
                    select(func.count(SigtapProcedimento.id)).where(
                        SigtapProcedimento.origem_manual == True  # noqa: E712
                    )
                ).one()
                or 0
            )
        except Exception:
            sigtap_manual = 0

    areas: Dict[str, int] = {
        "filas_tfd": _contar_tabela(db, tabs, "tfd_exames_fila"),
        "filas_lab": _contar_tabela(db, tabs, "lab_fila_psf"),
        "lab_agendamentos": _contar_tabela(db, tabs, "lab_solic_mestre") + _contar_tabela(db, tabs, "lab_solicitacoes"),
        "lab_itens": _contar_tabela(db, tabs, "lab_solic_itens"),
        "lab_vagas": _contar_tabela(db, tabs, "lab_vagas"),
        "lab_lotes": _contar_tabela(db, tabs, "lab_lotes_liberacao"),
        "lab_faturamento": (
            _contar_tabela(db, tabs, "lab_faturamento_fechamentos")
            + _contar_tabela(db, tabs, "lab_fpo_competencias")
            + _contar_tabela(db, tabs, "lab_orcamentos_mensais")
        ),
        "lab_sigtap_manual": sigtap_manual,
        "oxigenio_operacional": (
            _contar_tabela(db, tabs, "oxigenio_emprestimos")
            + _contar_tabela(db, tabs, "oxigenio_trocas_historico")
            + _contar_tabela(db, tabs, "oxigenio_cilindros_vazios")
            + _contar_tabela(db, tabs, "oxigenio_compras")
            + _contar_tabela(db, tabs, "oxigenio_comodato_movimentacoes")
        ),
        "oxigenio_equipamentos": _contar_tabela(db, tabs, "oxigenio_equipamentos"),
        "oxigenio_empresas": _contar_tabela(db, tabs, "oxigenio_empresas") + _contar_tabela(db, tabs, "oxigenio_licitacoes"),
        "tfd_viagens": _contar_tabela(db, tabs, "tfd_viagens"),
        "tfd_viagem_fila": _contar_tabela(db, tabs, "tfd_viagem_fila"),
        "tfd_faturamento": _contar_tabela(db, tabs, "tfd_faturamento"),
        "tfd_frota": (
            _contar_tabela(db, tabs, "tfd_veiculos")
            + _contar_tabela(db, tabs, "tfd_motoristas")
            + _contar_tabela(db, tabs, "tfd_destinos")
        ),
        "apac_solicitacoes": _contar_tabela(db, tabs, "apac_solicitacoes") + _contar_tabela(db, tabs, "apac_lotes"),
        "apac_faixas": _contar_tabela(db, tabs, "apac_faixas"),
        "farmacia_movimentacoes": (
            _contar_tabela(db, tabs, "farmacia_movimentacoes")
            + _contar_tabela(db, tabs, "farmacia_movimentacoes_insumos")
            + _contar_tabela(db, tabs, "farmacia_links_publicos")
        ),
        "farmacia_catalogo": _contar_tabela(db, tabs, "farmacia_medicamentos") + _contar_tabela(db, tabs, "farmacia_insumos"),
        "pacientes_total": pac_total,
        "pacientes_sem_pec": pac_sem_pec,
    }

    return ResumoLimpezaManualResponse(
        filas=filas_out,
        filas_sem_vinculo_tfd=tfd_sem_fila,
        filas_sem_vinculo_lab=lab_sem_fila,
        areas=areas,
    )


def _registrar_tabelas_preview(
    db: Session,
    tabs: Set[str],
    tabelas: List[str],
    resumo_tabelas: Dict[str, int],
    detalhes: List[Dict[str, Any]],
) -> int:
    sub = 0
    for t in tabelas:
        qtd = _contar_tabela(db, tabs, t)
        if qtd > 0:
            resumo_tabelas[t] = resumo_tabelas.get(t, 0) + qtd
            sub += qtd
            if len(detalhes) < 50:
                detalhes.append({
                    "tabela": t,
                    "id": "-",
                    "tipo": "limpeza_area",
                    "exame": f"{qtd} registro(s) na tabela {t}",
                })
    return sub


def preview_limpeza_massa(
    db: Session,
    request: LimpezaMassaPreviewRequest,
) -> LimpezaMassaPreviewResponse:
    """Pré-visualização (dry-run) da limpeza em massa sem executar remoções."""
    tipo = request.tipo_limpeza
    if tipo not in TIPOS_LIMPEZA_VALIDOS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tipo de limpeza inválido: '{tipo}'.",
        )
    filtro = request.filtro or {}
    tabs = tabelas_existentes(db)

    detalhes: List[Dict[str, Any]] = []
    resumo_tabelas: Dict[str, int] = {}
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

    elif tipo == "limpar_filas_manual":
        alvos_tfd, alvos_lab, alvos_solic = _consultar_alvos_filas_manual(db, tabs, filtro)
        if alvos_tfd:
            resumo_tabelas["tfd_exames_fila"] = len(alvos_tfd)
            total += len(alvos_tfd)
            for ef in alvos_tfd[:25]:
                detalhes.append({
                    "tabela": "tfd_exames_fila",
                    "id": ef.id,
                    "paciente_id": ef.paciente_id,
                    "exame": ef.exame,
                    "tipo_fila": ef.tipo_fila,
                    "data_pedido": str(ef.data_pedido) if ef.data_pedido else None,
                    "status": ef.status,
                })
        if alvos_lab:
            resumo_tabelas["lab_fila_psf"] = len(alvos_lab)
            total += len(alvos_lab)
            for lf in alvos_lab[:25]:
                detalhes.append({
                    "tabela": "lab_fila_psf",
                    "id": lf.id,
                    "paciente_id": lf.paciente_id,
                    "especialidade": lf.especialidade,
                    "tipo_fila": lf.tipo_fila,
                    "data_solicitacao": str(lf.data_solicitacao) if lf.data_solicitacao else None,
                    "status": lf.status,
                })
        if alvos_solic:
            solic_ids = [s.id for s in alvos_solic if s.id]
            resumo_tabelas["lab_solic_mestre"] = len(solic_ids)
            total += len(solic_ids)
            if solic_ids and "lab_solic_itens" in tabs:
                qtd_it = int(
                    db.exec(
                        select(func.count(ItemSolic.id)).where(ItemSolic.solicitacao_id.in_(solic_ids))
                    ).one()
                    or 0
                )
                if qtd_it:
                    resumo_tabelas["lab_solic_itens"] = qtd_it
                    total += qtd_it

    elif tipo == "limpar_laboratorio_completo":
        incluir_fila = bool(filtro.get("incluir_fila", True))
        incluir_agendamentos = bool(filtro.get("incluir_agendamentos", True))
        incluir_vagas = bool(filtro.get("incluir_vagas", False))
        incluir_faturamento = bool(filtro.get("incluir_faturamento", False))
        incluir_sigtap_manual = bool(filtro.get("incluir_sigtap_manual", False))

        tabelas_alvo: List[str] = []
        if incluir_agendamentos:
            tabelas_alvo.extend([
                "lab_inconsistencias_justificativas",
                "lab_conferencias_automaticas",
                "lab_resultado_arquivos",
                "lab_pedidos_ajuste",
                "lab_lote_itens",
                "lab_lote_artefatos",
                "lab_solic_itens",
                "lab_solic_mestre",
                "lab_lotes_liberacao",
                "lab_solicitacoes",
            ])
        if incluir_fila:
            if not incluir_agendamentos and "lab_lote_itens" not in tabelas_alvo:
                tabelas_alvo.append("lab_lote_itens")
            tabelas_alvo.append("lab_fila_psf")
        if incluir_vagas:
            tabelas_alvo.extend(["lab_feriados_bloqueios", "lab_vagas"])
        if incluir_faturamento:
            tabelas_alvo.extend([
                "lab_faturamento_fechamentos",
                "lab_fpo_itens",
                "lab_fpo_competencias",
                "lab_orcamentos_mensais",
            ])

        total += _registrar_tabelas_preview(db, tabs, tabelas_alvo, resumo_tabelas, detalhes)

        if incluir_sigtap_manual:
            if incluir_agendamentos and incluir_faturamento:
                qtd_sm = int(
                    db.exec(
                        select(func.count(SigtapProcedimento.id)).where(
                            SigtapProcedimento.origem_manual == True  # noqa: E712
                        )
                    ).one()
                    or 0
                ) if "sigtap_procedimentos" in tabs else 0
            else:
                qtd_sm = len(_contar_sigtap_manual_removivel(db, tabs))
            if qtd_sm > 0:
                resumo_tabelas["sigtap_procedimentos (manuais)"] = qtd_sm
                total += qtd_sm
                detalhes.append({
                    "tabela": "sigtap_procedimentos",
                    "id": "-",
                    "tipo": "sigtap_manual",
                    "exame": f"{qtd_sm} procedimento(s) criado(s) manualmente",
                })

    elif tipo == "limpar_oxigenio":
        incluir_cadastros = bool(filtro.get("incluir_cadastros_empresas", False))
        incluir_equipamentos = bool(filtro.get("incluir_equipamentos", False)) or incluir_cadastros
        incluir_operacional = bool(filtro.get("incluir_operacional", True)) or incluir_equipamentos

        tabelas_alvo = []
        if incluir_operacional:
            tabelas_alvo.extend([
                "oxigenio_trocas_historico",
                "oxigenio_emprestimo_itens",
                "oxigenio_cilindros_vazios",
                "oxigenio_emprestimos",
                "oxigenio_comodato_movimentacoes",
                "oxigenio_compras",
            ])
        if incluir_equipamentos:
            tabelas_alvo.append("oxigenio_equipamentos")
        if incluir_cadastros:
            tabelas_alvo.extend(["oxigenio_licitacoes", "oxigenio_empresas"])

        total += _registrar_tabelas_preview(db, tabs, tabelas_alvo, resumo_tabelas, detalhes)

    elif tipo == "limpar_tfd_viagens":
        incluir_viagens = bool(filtro.get("incluir_viagens", True))
        incluir_exames_fila = bool(filtro.get("incluir_exames_fila", False))
        incluir_frota = bool(filtro.get("incluir_cadastros_frota", False))

        tabelas_alvo = []
        if incluir_viagens:
            tabelas_alvo.extend([
                "tfd_faturamento",
                "tfd_viagem_pacientes",
                "tfd_viagem_fila",
                "tfd_viagens",
            ])
        if incluir_exames_fila:
            tabelas_alvo.append("tfd_exames_fila")
        if incluir_frota:
            tabelas_alvo.extend(["tfd_veiculos", "tfd_motoristas", "tfd_destinos"])

        total += _registrar_tabelas_preview(db, tabs, tabelas_alvo, resumo_tabelas, detalhes)

    elif tipo == "limpar_apac":
        incluir_solic = bool(filtro.get("incluir_solicitacoes", True))
        incluir_faixas = bool(filtro.get("incluir_faixas", False))

        tabelas_alvo = []
        if incluir_solic:
            tabelas_alvo.extend([
                "apac_anexos",
                "apac_procedimentos_secundarios",
                "apac_solicitacoes",
                "apac_lotes",
            ])
        if incluir_faixas:
            tabelas_alvo.append("apac_faixas")

        total += _registrar_tabelas_preview(db, tabs, tabelas_alvo, resumo_tabelas, detalhes)

    elif tipo == "limpar_farmacia":
        incluir_catalogo = bool(filtro.get("incluir_catalogo", False))
        incluir_mov = bool(filtro.get("incluir_movimentacoes", True)) or incluir_catalogo

        tabelas_alvo = []
        if incluir_mov:
            tabelas_alvo.extend([
                "farmacia_movimentacoes",
                "farmacia_movimentacoes_insumos",
                "farmacia_links_publicos",
            ])
        if incluir_catalogo:
            tabelas_alvo.extend([
                "farmacia_medicamentos",
                "farmacia_insumos",
            ])

        total += _registrar_tabelas_preview(db, tabs, tabelas_alvo, resumo_tabelas, detalhes)

    elif tipo == "limpar_pacientes_manual":
        modo = str(filtro.get("modo") or "sem_vinculos_nao_pec").strip().lower()
        if "tfd_pacientes" in tabs:
            pids_vinc = _coletar_pacientes_vinculados_todos_modulos(db, tabs)
            pacs = list(db.exec(select(Paciente)).all())
            for p in pacs:
                if p.id in pids_vinc:
                    continue
                if modo == "sem_vinculos_nao_pec" and p.co_seq_cidadao_pec is not None:
                    continue
                total += 1
                if len(detalhes) < 50:
                    detalhes.append({
                        "tabela": "tfd_pacientes",
                        "id": p.id,
                        "nome": p.nome,
                        "cpf": p.cpf,
                        "tipo": "sem_pec" if p.co_seq_cidadao_pec is None else "pec_sem_vinculo",
                    })
            if total > 0:
                resumo_tabelas["tfd_pacientes"] = total

    return LimpezaMassaPreviewResponse(
        total_afetados=total,
        detalhes=detalhes,
        resumo_tabelas=resumo_tabelas or None,
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

    if request.tipo_limpeza not in TIPOS_LIMPEZA_VALIDOS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tipo de limpeza inválido: '{request.tipo_limpeza}'.",
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

        elif tipo == "limpar_filas_manual":
            alvos_tfd, alvos_lab, alvos_solic = _consultar_alvos_filas_manual(db, tabs, filtro)
            vagas_recalc: Set[Tuple[int, date]] = set()

            # 1. Remove agendamentos laboratoriais vinculados (se solicitado) em ordem segura de FK
            if alvos_solic:
                solic_ids = [s.id for s in alvos_solic if s.id]
                if solic_ids:
                    for sm in alvos_solic:
                        if sm.laboratorio_id and sm.data_agendada:
                            vagas_recalc.add((int(sm.laboratorio_id), sm.data_agendada))
                    for tab_dep, col_dep in (
                        ("lab_inconsistencias_justificativas", "solicitacao_id"),
                        ("lab_conferencias_automaticas", "solicitacao_id"),
                        ("lab_resultado_arquivos", "solicitacao_id"),
                        ("lab_pedidos_ajuste", "solicitacao_id"),
                        ("lab_lote_itens", "solicitacao_mestre_id"),
                        ("lab_solic_itens", "solicitacao_id"),
                    ):
                        if tab_dep in tabs:
                            for idx_chunk in range(0, len(solic_ids), 500):
                                chunk = solic_ids[idx_chunk: idx_chunk + 500]
                                ph = ",".join(str(int(x)) for x in chunk)
                                res_del = db.execute(text(f"DELETE FROM {tab_dep} WHERE {col_dep} IN ({ph})"))
                                if res_del.rowcount and res_del.rowcount > 0:
                                    detalhes_execucao[tab_dep] = detalhes_execucao.get(tab_dep, 0) + int(res_del.rowcount)
                                    total_removidos += int(res_del.rowcount)
                    for sm in alvos_solic:
                        db.delete(sm)
                    detalhes_execucao["lab_solic_mestre"] = len(solic_ids)
                    total_removidos += len(solic_ids)

            # 2. Remove lab_fila_psf
            if alvos_lab:
                lab_ids = [lf.id for lf in alvos_lab if lf.id]
                if lab_ids:
                    if "lab_solic_mestre" in tabs:
                        for idx_chunk in range(0, len(lab_ids), 500):
                            chunk = lab_ids[idx_chunk: idx_chunk + 500]
                            ph = ",".join(str(int(x)) for x in chunk)
                            db.execute(text(f"UPDATE lab_solic_mestre SET origem_fila_id = NULL WHERE origem_fila_id IN ({ph})"))
                    if "lab_lote_itens" in tabs:
                        for idx_chunk in range(0, len(lab_ids), 500):
                            chunk = lab_ids[idx_chunk: idx_chunk + 500]
                            ph = ",".join(str(int(x)) for x in chunk)
                            db.execute(text(f"DELETE FROM lab_lote_itens WHERE fila_psf_id IN ({ph})"))
                    for lf in alvos_lab:
                        db.delete(lf)
                    detalhes_execucao["lab_fila_psf"] = len(lab_ids)
                    total_removidos += len(lab_ids)

            # 3. Remove tfd_exames_fila
            if alvos_tfd:
                tfd_ids = [ef.id for ef in alvos_tfd if ef.id]
                if tfd_ids:
                    if "tfd_viagem_fila" in tabs:
                        for idx_chunk in range(0, len(tfd_ids), 500):
                            chunk = tfd_ids[idx_chunk: idx_chunk + 500]
                            ph = ",".join(str(int(x)) for x in chunk)
                            db.execute(text(f"UPDATE tfd_viagem_fila SET exame_fila_id = NULL WHERE exame_fila_id IN ({ph})"))
                    for ef in alvos_tfd:
                        db.delete(ef)
                    detalhes_execucao["tfd_exames_fila"] = len(tfd_ids)
                    total_removidos += len(tfd_ids)

            # 4. Recalcula lab_vagas.vagas_ocupadas se algum agendamento foi removido
            if vagas_recalc and "lab_vagas" in tabs and "lab_solic_mestre" in tabs:
                db.flush()
                for lab_id_v, dt_v in vagas_recalc:
                    vaga = db.exec(
                        select(VagaLab).where(VagaLab.laboratorio_id == lab_id_v, VagaLab.data == dt_v)
                    ).first()
                    if vaga:
                        real_cnt = int(
                            db.exec(
                                select(func.count(SolicitacaoMestre.id)).where(
                                    SolicitacaoMestre.laboratorio_id == lab_id_v,
                                    SolicitacaoMestre.data_agendada == dt_v,
                                    SolicitacaoMestre.status != "cancelado",
                                )
                            ).one()
                            or 0
                        )
                        vaga.vagas_ocupadas = real_cnt
                        db.add(vaga)

        elif tipo == "limpar_laboratorio_completo":
            incluir_fila = bool(filtro.get("incluir_fila", True))
            incluir_agendamentos = bool(filtro.get("incluir_agendamentos", True))
            incluir_vagas = bool(filtro.get("incluir_vagas", False))
            incluir_faturamento = bool(filtro.get("incluir_faturamento", False))
            incluir_sigtap_manual = bool(filtro.get("incluir_sigtap_manual", False))

            if incluir_agendamentos:
                for tab in (
                    "lab_inconsistencias_justificativas",
                    "lab_conferencias_automaticas",
                    "lab_resultado_arquivos",
                    "lab_pedidos_ajuste",
                    "lab_lote_itens",
                    "lab_lote_artefatos",
                    "lab_solic_itens",
                    "lab_solic_mestre",
                    "lab_solicitacoes",
                ):
                    q = _deletar_tabela_inteira(db, tabs, tab)
                    if q:
                        detalhes_execucao[tab] = q
                        total_removidos += q
                if "lab_fila_psf" in tabs and not incluir_fila:
                    db.execute(text("UPDATE lab_fila_psf SET lote_id = NULL WHERE lote_id IS NOT NULL"))
                if incluir_fila:
                    q_fila = _deletar_tabela_inteira(db, tabs, "lab_fila_psf")
                    if q_fila:
                        detalhes_execucao["lab_fila_psf"] = q_fila
                        total_removidos += q_fila
                q_lotes = _deletar_tabela_inteira(db, tabs, "lab_lotes_liberacao")
                if q_lotes:
                    detalhes_execucao["lab_lotes_liberacao"] = q_lotes
                    total_removidos += q_lotes
                if "lab_vagas" in tabs and not incluir_vagas:
                    db.execute(text("UPDATE lab_vagas SET vagas_ocupadas = 0 WHERE vagas_ocupadas != 0"))
                if "lab_orcamentos_mensais" in tabs and not incluir_faturamento:
                    db.execute(text("UPDATE lab_orcamentos_mensais SET valor_consumido = 0 WHERE valor_consumido != 0"))
            elif incluir_fila:
                if "lab_solic_mestre" in tabs:
                    db.execute(text("UPDATE lab_solic_mestre SET origem_fila_id = NULL WHERE origem_fila_id IS NOT NULL"))
                q_li = _deletar_tabela_inteira(db, tabs, "lab_lote_itens")
                if q_li:
                    detalhes_execucao["lab_lote_itens"] = q_li
                    total_removidos += q_li
                q_fila = _deletar_tabela_inteira(db, tabs, "lab_fila_psf")
                if q_fila:
                    detalhes_execucao["lab_fila_psf"] = q_fila
                    total_removidos += q_fila

            if incluir_vagas:
                for tab in ("lab_feriados_bloqueios", "lab_vagas"):
                    q = _deletar_tabela_inteira(db, tabs, tab)
                    if q:
                        detalhes_execucao[tab] = q
                        total_removidos += q

            if incluir_faturamento:
                if "lab_lotes_liberacao" in tabs:
                    db.execute(text("UPDATE lab_lotes_liberacao SET orcamento_id = NULL WHERE orcamento_id IS NOT NULL"))
                for tab in (
                    "lab_faturamento_fechamentos",
                    "lab_fpo_itens",
                    "lab_fpo_competencias",
                    "lab_orcamentos_mensais",
                ):
                    q = _deletar_tabela_inteira(db, tabs, tab)
                    if q:
                        detalhes_execucao[tab] = q
                        total_removidos += q

            if incluir_sigtap_manual and "sigtap_procedimentos" in tabs:
                db.flush()
                ids_manuais = _contar_sigtap_manual_removivel(db, tabs)
                if ids_manuais:
                    for idx_chunk in range(0, len(ids_manuais), 500):
                        chunk = ids_manuais[idx_chunk: idx_chunk + 500]
                        ph = ",".join(str(int(x)) for x in chunk)
                        db.execute(text(f"DELETE FROM sigtap_procedimentos WHERE id IN ({ph})"))
                    detalhes_execucao["sigtap_procedimentos_manuais"] = len(ids_manuais)
                    total_removidos += len(ids_manuais)

        elif tipo == "limpar_oxigenio":
            incluir_cadastros = bool(filtro.get("incluir_cadastros_empresas", False))
            incluir_equipamentos = bool(filtro.get("incluir_equipamentos", False)) or incluir_cadastros
            incluir_operacional = bool(filtro.get("incluir_operacional", True)) or incluir_equipamentos

            if incluir_operacional:
                for tab in (
                    "oxigenio_trocas_historico",
                    "oxigenio_emprestimo_itens",
                    "oxigenio_cilindros_vazios",
                    "oxigenio_emprestimos",
                    "oxigenio_comodato_movimentacoes",
                    "oxigenio_compras",
                ):
                    q = _deletar_tabela_inteira(db, tabs, tab)
                    if q:
                        detalhes_execucao[tab] = q
                        total_removidos += q
                if "oxigenio_equipamentos" in tabs and not incluir_equipamentos:
                    try:
                        db.execute(text("UPDATE oxigenio_equipamentos SET status = 'DISPONIVEL' WHERE UPPER(status) IN ('EM_USO', 'EMPRESTADO')"))
                    except Exception:
                        pass
            if incluir_equipamentos:
                q = _deletar_tabela_inteira(db, tabs, "oxigenio_equipamentos")
                if q:
                    detalhes_execucao["oxigenio_equipamentos"] = q
                    total_removidos += q
            if incluir_cadastros:
                for tab in ("oxigenio_licitacoes", "oxigenio_empresas"):
                    q = _deletar_tabela_inteira(db, tabs, tab)
                    if q:
                        detalhes_execucao[tab] = q
                        total_removidos += q

        elif tipo == "limpar_tfd_viagens":
            incluir_viagens = bool(filtro.get("incluir_viagens", True))
            incluir_exames_fila = bool(filtro.get("incluir_exames_fila", False))
            incluir_frota = bool(filtro.get("incluir_cadastros_frota", False))

            if incluir_viagens:
                for tab in (
                    "tfd_faturamento",
                    "tfd_viagem_pacientes",
                    "tfd_viagem_fila",
                    "tfd_viagens",
                ):
                    q = _deletar_tabela_inteira(db, tabs, tab)
                    if q:
                        detalhes_execucao[tab] = q
                        total_removidos += q
            if incluir_exames_fila:
                if "tfd_viagem_fila" in tabs and not incluir_viagens:
                    db.execute(text("UPDATE tfd_viagem_fila SET exame_fila_id = NULL WHERE exame_fila_id IS NOT NULL"))
                q = _deletar_tabela_inteira(db, tabs, "tfd_exames_fila")
                if q:
                    detalhes_execucao["tfd_exames_fila"] = q
                    total_removidos += q
            if incluir_frota:
                if "tfd_viagens" in tabs and not incluir_viagens:
                    db.execute(text("UPDATE tfd_viagens SET veiculo_id = NULL, motorista_id = NULL"))
                for tab in ("tfd_veiculos", "tfd_motoristas", "tfd_destinos"):
                    q = _deletar_tabela_inteira(db, tabs, tab)
                    if q:
                        detalhes_execucao[tab] = q
                        total_removidos += q

        elif tipo == "limpar_apac":
            incluir_solic = bool(filtro.get("incluir_solicitacoes", True))
            incluir_faixas = bool(filtro.get("incluir_faixas", False))

            if incluir_solic:
                for tab in (
                    "apac_anexos",
                    "apac_procedimentos_secundarios",
                    "apac_solicitacoes",
                    "apac_lotes",
                ):
                    q = _deletar_tabela_inteira(db, tabs, tab)
                    if q:
                        detalhes_execucao[tab] = q
                        total_removidos += q
            if incluir_faixas:
                q = _deletar_tabela_inteira(db, tabs, "apac_faixas")
                if q:
                    detalhes_execucao["apac_faixas"] = q
                    total_removidos += q

        elif tipo == "limpar_farmacia":
            incluir_catalogo = bool(filtro.get("incluir_catalogo", False))
            incluir_mov = bool(filtro.get("incluir_movimentacoes", True)) or incluir_catalogo

            if incluir_mov:
                for tab in (
                    "farmacia_movimentacoes",
                    "farmacia_movimentacoes_insumos",
                    "farmacia_links_publicos",
                ):
                    q = _deletar_tabela_inteira(db, tabs, tab)
                    if q:
                        detalhes_execucao[tab] = q
                        total_removidos += q
            if incluir_catalogo:
                for tab in ("farmacia_medicamentos", "farmacia_insumos"):
                    q = _deletar_tabela_inteira(db, tabs, tab)
                    if q:
                        detalhes_execucao[tab] = q
                        total_removidos += q

        elif tipo == "limpar_pacientes_manual":
            modo = str(filtro.get("modo") or "sem_vinculos_nao_pec").strip().lower()
            if "tfd_pacientes" in tabs:
                pids_vinc = _coletar_pacientes_vinculados_todos_modulos(db, tabs)
                pacs = list(db.exec(select(Paciente)).all())
                alvos_pac_ids: List[int] = []
                for p in pacs:
                    if not p.id or p.id in pids_vinc:
                        continue
                    if modo == "sem_vinculos_nao_pec" and p.co_seq_cidadao_pec is not None:
                        continue
                    alvos_pac_ids.append(int(p.id))

                if alvos_pac_ids:
                    if "tfd_pacientes_historico" in tabs:
                        for idx_chunk in range(0, len(alvos_pac_ids), 500):
                            chunk = alvos_pac_ids[idx_chunk: idx_chunk + 500]
                            ph = ",".join(str(x) for x in chunk)
                            db.execute(text(f"DELETE FROM tfd_pacientes_historico WHERE paciente_id IN ({ph})"))
                    for idx_chunk in range(0, len(alvos_pac_ids), 500):
                        chunk = alvos_pac_ids[idx_chunk: idx_chunk + 500]
                        ph = ",".join(str(x) for x in chunk)
                        db.execute(text(f"DELETE FROM tfd_pacientes WHERE id IN ({ph})"))
                    detalhes_execucao["tfd_pacientes"] = len(alvos_pac_ids)
                    total_removidos += len(alvos_pac_ids)

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

        invalidar_cache_diagnostico(db)
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
# UNIFICAÇÃO DE PRESTADORES + RESOLUÇÃO INDIVIDUAL E EM LOTE (TODOS OS DOMÍNIOS)
# ==============================================================================

def _unificar_prestadores(
    db: Session,
    mid: int,
    did: int,
    campos_mesclar: Optional[Dict[str, Any]],
    user: Optional[User],
    client_ip: str,
    user_agent: str,
) -> UnificarRegistrosResponse:
    """Unifica dois cadastros de Prestador preservando o principal e excluindo o duplicado."""
    p_master = db.get(Prestador, mid)
    p_dup = db.get(Prestador, did)
    if not p_master:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prestador principal ID {mid} não encontrado.",
        )
    if not p_dup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prestador duplicado ID {did} não encontrado.",
        )

    for campo in (
        "nome_fantasia",
        "cnpj",
        "cnes",
        "responsavel_nome",
        "responsavel_telefone",
        "email",
        "telefone",
        "endereco",
        "municipio",
        "observacoes",
    ):
        val_m = getattr(p_master, campo, None)
        val_d = getattr(p_dup, campo, None)
        if not val_m and val_d:
            setattr(p_master, campo, val_d)

    if campos_mesclar:
        for k, v in campos_mesclar.items():
            if k not in _CAMPOS_MESCLAR_PRESTADOR or not hasattr(p_master, k):
                continue
            setattr(p_master, k, v)

    razao_dup = p_dup.razao_social
    db.add(p_master)
    db.delete(p_dup)
    db.flush()

    registrar_auditoria(
        db=db,
        action="DATA_UNIFY_PRESTADOR",
        entity="PRESTADOR",
        entity_id=mid,
        user=user,
        details={
            "principal_id": mid,
            "duplicado_id": did,
            "razao_social_duplicado": razao_dup,
            "ip": client_ip,
        },
        device=user_agent,
    )

    return UnificarRegistrosResponse(
        sucesso=True,
        mensagem=f"Prestador #{did} ({razao_dup}) unificado no prestador #{mid} ({p_master.razao_social}).",
        vinculos_reatribuidos=0,
        registro_excluido_id=did,
        detalhes={"principal_id": mid, "duplicado_id": did},
    )


def _recalcular_vagas_lab(db: Session, pares_lab_data: Set[Tuple[int, date]]) -> int:
    """Sincroniza lab_vagas.vagas_ocupadas para todos os pares (laboratorio_id, data) informados."""
    if not pares_lab_data:
        return 0
    tabs = tabelas_existentes(db)
    if "lab_vagas" not in tabs or "lab_solic_mestre" not in tabs:
        return 0
    atualizadas = 0
    for lab_id, dt in pares_lab_data:
        if lab_id is None or dt is None:
            continue
        vaga = db.exec(
            select(VagaLab)
            .where(VagaLab.laboratorio_id == lab_id)
            .where(VagaLab.data == dt)
        ).first()
        if not vaga:
            continue
        real_count = db.execute(
            select(func.count(SolicitacaoMestre.id))
            .where(SolicitacaoMestre.laboratorio_id == lab_id)
            .where(SolicitacaoMestre.data_agendada == dt)
            .where(SolicitacaoMestre.status != "cancelado")
        ).scalar() or 0
        if vaga.vagas_ocupadas != real_count:
            vaga.vagas_ocupadas = int(real_count)
            db.add(vaga)
            atualizadas += 1
    db.flush()
    return atualizadas


def _escolher_principal_paciente(db: Session, ids: List[int]) -> Tuple[Optional[int], List[int]]:
    """Seleciona o melhor cadastro de paciente como principal e retorna (principal_id, duplicados_ids)."""
    existentes: List[Paciente] = []
    for pid in dict.fromkeys(int(x) for x in ids if x is not None):
        p = db.get(Paciente, pid)
        if p is not None and p.id is not None:
            existentes.append(p)
    if len(existentes) < 2:
        return (existentes[0].id if existentes else None), []

    def _score(p: Paciente) -> Tuple[int, int]:
        pts = 0
        sit = (p.situacao_cadastral or "").lower()
        if p.data_obito is None and sit in ("ativo", "unificado", ""):
            pts += 10
        if p.co_seq_cidadao_pec is not None:
            pts += 5
        c_cpf = so_digitos(p.cpf)
        if len(c_cpf) == 11 and c_cpf != c_cpf[0] * 11:
            pts += 3
        c_cns = so_digitos(p.cns)
        if len(c_cns) == 15 and c_cns != c_cns[0] * 15:
            pts += 2
        if p.codigo_prontuario:
            pts += 1
        # Maior pontuação primeiro; desempate pelo menor ID
        return (-pts, p.id or 0)

    existentes.sort(key=_score)
    principal = existentes[0].id
    duplicados = [p.id for p in existentes[1:] if p.id is not None]
    return principal, duplicados


def _extrair_ids(dados: Dict[str, Any], *chaves: str) -> List[int]:
    for ch in chaves:
        val = dados.get(ch)
        if isinstance(val, list) and val:
            out: List[int] = []
            for x in val:
                try:
                    out.append(int(x))
                except (TypeError, ValueError):
                    pass
            if out:
                return list(dict.fromkeys(out))
    return []


def _resolver_item_interno(
    db: Session,
    item: ResolverInconsistenciaItem,
    user: Optional[User],
    client_ip: str,
    user_agent: str,
) -> ResolverInconsistenciaResultado:
    """Executa a correção atômica para qualquer um dos 35 tipos de diagnóstico."""
    tipo = (item.tipo or "").strip()
    dominio = (item.dominio or "").strip().lower()
    dados = item.dados or {}
    params = item.parametros or {}
    tabs = tabelas_existentes(db)

    def _ok(msg: str, afetados: int = 1) -> ResolverInconsistenciaResultado:
        return ResolverInconsistenciaResultado(
            chave_unica=item.chave_unica,
            tipo=tipo,
            dominio=dominio,
            sucesso=True,
            mensagem=msg,
            registros_afetados=afetados,
        )

    def _erro(msg: str) -> ResolverInconsistenciaResultado:
        return ResolverInconsistenciaResultado(
            chave_unica=item.chave_unica,
            tipo=tipo,
            dominio=dominio,
            sucesso=False,
            mensagem=msg,
            registros_afetados=0,
        )

    # ------------------------------------------------------------------
    # DOMÍNIO 1: PACIENTES
    # ------------------------------------------------------------------
    if tipo in ("duplicidade_cpf", "duplicidade_cns", "duplicidade_nome_nascimento", "pec_co_seq_duplicado"):
        ids = _extrair_ids(dados, "ids")
        principal_override = params.get("registro_principal_id")
        if principal_override:
            mid = int(principal_override)
            existentes_ids = [i for i in ids if db.get(Paciente, i) is not None]
            if mid not in existentes_ids or len(existentes_ids) < 2:
                return _ok("Duplicidade de pacientes já resolvida anteriormente.", 0)
            dups = [i for i in existentes_ids if i != mid]
        else:
            mid, dups = _escolher_principal_paciente(db, ids)
            if not mid or not dups:
                return _ok("Duplicidade de pacientes já resolvida anteriormente.", 0)

        total_vinculos = 0
        for did in dups:
            if db.get(Paciente, did) is None:
                continue
            r = _unificar_pacientes(db, mid, did, None, user, client_ip, user_agent)
            total_vinculos += r.vinculos_reatribuidos
        return _ok(
            f"{len(dups)} cadastro(s) duplicado(s) unificado(s) no paciente #{mid} ({total_vinculos} vínculo(s) reatribuído(s)).",
            len(dups),
        )

    if tipo == "obito_com_pendencias":
        pid = dados.get("paciente_id") or dados.get("id")
        if not pid:
            return _erro("paciente_id não informado para encerrar pendências.")
        pid = int(pid)
        pac = db.get(Paciente, pid)
        if not pac:
            return _ok(f"Paciente #{pid} não existe mais na base.", 0)

        encerrados = 0
        pares_vagas: Set[Tuple[int, date]] = set()

        if "tfd_exames_fila" in tabs:
            exames = list(
                db.exec(
                    select(ExameFila)
                    .where(ExameFila.paciente_id == pid)
                    .where(ExameFila.ativo == True)
                    .where(ExameFila.status.in_(["aguardando", "agendado"]))
                ).all()
            )
            for ef in exames:
                ef.status = "cancelado"
                ef.ativo = False
                db.add(ef)
                encerrados += 1

        if "lab_fila_psf" in tabs:
            filas = list(
                db.exec(
                    select(FilaPsf)
                    .where(FilaPsf.paciente_id == pid)
                    .where(FilaPsf.status.in_(["na_fila", "agendado"]))
                ).all()
            )
            for lf in filas:
                lf.status = "cancelado"
                db.add(lf)
                encerrados += 1

        if "lab_solic_mestre" in tabs:
            mestres = list(
                db.exec(
                    select(SolicitacaoMestre)
                    .where(SolicitacaoMestre.paciente_id == pid)
                    .where(SolicitacaoMestre.status == "agendado")
                ).all()
            )
            for sm in mestres:
                sm.status = "cancelado"
                db.add(sm)
                if sm.laboratorio_id and sm.data_agendada:
                    pares_vagas.add((sm.laboratorio_id, sm.data_agendada))
                encerrados += 1

        if "tfd_viagem_pacientes" in tabs and "tfd_viagens" in tabs:
            vps = list(
                db.exec(
                    select(ViagemPaciente)
                    .join(Viagem, Viagem.id == ViagemPaciente.viagem_id)
                    .where(ViagemPaciente.paciente_id == pid)
                    .where(Viagem.status.in_(["agendada", "andamento"]))
                ).all()
            )
            for vp in vps:
                if vp.viagem_fila_id and "tfd_viagem_fila" in tabs:
                    vf = db.get(ViagemFila, vp.viagem_fila_id)
                    if vf:
                        vf.status = "cancelado"
                        db.add(vf)
                db.delete(vp)
                encerrados += 1

        db.flush()
        _recalcular_vagas_lab(db, pares_vagas)
        return _ok(
            f"{encerrados} pendência(s) ativa(s) cancelada(s) para o paciente #{pid} ({pac.nome}).",
            encerrados,
        )

    if tipo == "divergencia_obito_situacao":
        pid = dados.get("paciente_id") or dados.get("id")
        if not pid:
            return _erro("paciente_id não informado para sincronizar situação/óbito.")
        pac = db.get(Paciente, int(pid))
        if not pac:
            return _ok(f"Paciente #{pid} não encontrado (possivelmente unificado).", 0)

        sit = (pac.situacao_cadastral or "").lower()
        if pac.data_obito is not None and sit == "ativo":
            pac.situacao_cadastral = "obito"
            db.add(pac)
            db.flush()
            return _ok(f"Situação cadastral do paciente #{pac.id} atualizada para 'obito' conforme data de óbito ({pac.data_obito}).", 1)
        if sit == "obito" and pac.data_obito is None:
            if params.get("reativar"):
                pac.situacao_cadastral = "ativo"
                db.add(pac)
                db.flush()
                return _ok(f"Situação cadastral do paciente #{pac.id} revertida para 'ativo'.", 1)
            pac.data_obito = date.today()
            db.add(pac)
            db.flush()
            return _ok(f"Data de óbito do paciente #{pac.id} preenchida com {pac.data_obito} para consistência cadastral.", 1)
        return _ok(f"Divergência do paciente #{pac.id} já estava sincronizada.", 0)

    # ------------------------------------------------------------------
    # DOMÍNIO 2: FILAS DE ESPERA
    # ------------------------------------------------------------------
    if tipo == "duplicidade_tfd_exames_fila":
        ids = _extrair_ids(dados, "ids")
        registros = [
            ef for ef in (db.get(ExameFila, i) for i in ids)
            if ef is not None and ef.ativo and ef.status in ("aguardando", "agendado")
        ]
        if len(registros) < 2:
            return _ok("Duplicidade na fila TFD já resolvida anteriormente.", 0)
        registros.sort(key=lambda ef: (0 if ef.status == "agendado" else 1, ef.id or 0))
        mantido = registros[0]
        cancelados = 0
        for dup in registros[1:]:
            dup.status = "cancelado"
            dup.ativo = False
            db.add(dup)
            cancelados += 1
        db.flush()
        return _ok(
            f"Mantido pedido #{mantido.id} na fila TFD e cancelado(s) {cancelados} pedido(s) duplicado(s).",
            cancelados,
        )

    if tipo == "duplicidade_lab_fila_psf":
        ids = _extrair_ids(dados, "ids")
        registros = [
            lf for lf in (db.get(FilaPsf, i) for i in ids)
            if lf is not None and lf.status in ("na_fila", "agendado")
        ]
        if len(registros) < 2:
            return _ok("Duplicidade na fila PSF já resolvida anteriormente.", 0)
        registros.sort(key=lambda lf: (0 if lf.status == "agendado" else 1, lf.id or 0))
        mantido = registros[0]
        cancelados = 0
        for dup in registros[1:]:
            if "lab_solic_mestre" in tabs and dup.id is not None:
                mestres_dup = list(
                    db.exec(select(SolicitacaoMestre).where(SolicitacaoMestre.origem_fila_id == dup.id)).all()
                )
                for sm in mestres_dup:
                    sm.origem_fila_id = mantido.id
                    db.add(sm)
            dup.status = "cancelado"
            db.add(dup)
            cancelados += 1
        db.flush()
        return _ok(
            f"Mantida solicitação PSF #{mantido.id} e cancelada(s) {cancelados} duplicata(s).",
            cancelados,
        )

    if tipo == "cruzamento_indevido_tfd_lab":
        tfd_id = dados.get("tfd_fila_id")
        if not tfd_id:
            return _erro("tfd_fila_id não informado.")
        ef = db.get(ExameFila, int(tfd_id))
        if not ef or not ef.ativo or ef.status == "cancelado":
            return _ok(f"Pedido TFD #{tfd_id} já estava inativo/cancelado.", 0)
        ef.ativo = False
        ef.status = "cancelado"
        db.add(ef)
        db.flush()
        return _ok(
            f"Pedido laboratorial redundante #{ef.id} removido da Regulação Geral (mantido na Fila PSF).",
            1,
        )

    if tipo == "tipo_fila_invalido":
        tabela = str(dados.get("tabela") or "")
        reg_id = dados.get("id")
        if not reg_id:
            return _erro("ID do registro não informado para corrigir tipo_fila_invalido.")
        tipos_existentes = list(db.exec(select(TipoFila)).all()) if "tfd_tipos_fila" in tabs else []
        mapa_nome = {normalizar_texto(tf.nome): tf.id for tf in tipos_existentes if tf.id and tf.nome}
        mapa_ids = {tf.id for tf in tipos_existentes if tf.id}

        if tabela == "tfd_exames_fila":
            reg = db.get(ExameFila, int(reg_id))
            if not reg:
                return _ok(f"Registro tfd_exames_fila #{reg_id} não existe mais.", 0)
            if reg.fila_id in mapa_ids or reg.fila_id is None:
                return _ok(f"Vínculo fila_id do exame #{reg_id} já está regular.", 0)
            novo_id = mapa_nome.get(normalizar_texto(reg.tipo_fila))
            reg.fila_id = novo_id
            db.add(reg)
            db.flush()
            return _ok(
                f"Exame #{reg.id} atualizado: fila_id definido para {novo_id if novo_id else 'nulo (referência inválida removida)'}.",
                1,
            )
        if tabela == "lab_fila_psf":
            reg_psf = db.get(FilaPsf, int(reg_id))
            if not reg_psf:
                return _ok(f"Registro lab_fila_psf #{reg_id} não existe mais.", 0)
            if reg_psf.fila_id in mapa_ids or reg_psf.fila_id is None:
                return _ok(f"Vínculo fila_id da fila PSF #{reg_id} já está regular.", 0)
            novo_id = mapa_nome.get(normalizar_texto(reg_psf.tipo_fila))
            reg_psf.fila_id = novo_id
            db.add(reg_psf)
            db.flush()
            return _ok(
                f"Fila PSF #{reg_psf.id} atualizada: fila_id definido para {novo_id if novo_id else 'nulo (referência inválida removida)'}.",
                1,
            )
        return _erro(f"Tabela '{tabela}' não suportada para tipo_fila_invalido.")

    if tipo == "tipo_fila_duplicado":
        ids = sorted(_extrair_ids(dados, "ids"))
        existentes = [tf for tf in (db.get(TipoFila, i) for i in ids) if tf is not None and tf.id is not None]
        if len(existentes) < 2:
            return _ok("Duplicidade de tipos de fila já resolvida anteriormente.", 0)
        principal = existentes[0]
        removidos = 0
        for dup in existentes[1:]:
            if "tfd_exames_fila" in tabs:
                db.execute(
                    text("UPDATE tfd_exames_fila SET fila_id = :mid WHERE fila_id = :did"),
                    {"mid": principal.id, "did": dup.id},
                )
            if "lab_fila_psf" in tabs:
                db.execute(
                    text("UPDATE lab_fila_psf SET fila_id = :mid WHERE fila_id = :did"),
                    {"mid": principal.id, "did": dup.id},
                )
            db.delete(dup)
            removidos += 1
        db.flush()
        return _ok(
            f"{removidos} tipo(s) de fila duplicado(s) unificado(s) no TipoFila #{principal.id} ({principal.nome}).",
            removidos,
        )

    # ------------------------------------------------------------------
    # DOMÍNIO 3: LABORATÓRIO
    # ------------------------------------------------------------------
    if tipo == "duplicidade_agendamento_dia":
        ids = _extrair_ids(dados, "ids", "solicitacoes_ids")
        mestres = [
            sm for sm in (db.get(SolicitacaoMestre, i) for i in ids)
            if sm is not None and sm.status != "cancelado"
        ]
        if len(mestres) < 2:
            return _ok("Duplicidade de agendamentos no dia já resolvida anteriormente.", 0)

        status_prio = {"realizado": 0, "coletado": 1, "agendado": 2}
        contagem_itens: Dict[int, int] = {}
        if "lab_solic_itens" in tabs:
            for sm in mestres:
                cnt = db.execute(
                    select(func.count(ItemSolic.id)).where(ItemSolic.solicitacao_id == sm.id)
                ).scalar() or 0
                contagem_itens[sm.id] = int(cnt)

        mestres.sort(key=lambda sm: (status_prio.get(sm.status, 3), -contagem_itens.get(sm.id, 0), sm.id or 0))
        principal = mestres[0]
        pares_vagas: Set[Tuple[int, date]] = set()
        if principal.laboratorio_id and principal.data_agendada:
            pares_vagas.add((principal.laboratorio_id, principal.data_agendada))

        sigtap_principal: Set[int] = set()
        if "lab_solic_itens" in tabs:
            sigtap_principal = {
                it.sigtap_id
                for it in db.exec(select(ItemSolic).where(ItemSolic.solicitacao_id == principal.id)).all()
            }

        cancelados = 0
        for dup in mestres[1:]:
            if dup.laboratorio_id and dup.data_agendada:
                pares_vagas.add((dup.laboratorio_id, dup.data_agendada))
            if "lab_solic_itens" in tabs:
                itens_dup = list(db.exec(select(ItemSolic).where(ItemSolic.solicitacao_id == dup.id)).all())
                for it in itens_dup:
                    if it.sigtap_id not in sigtap_principal:
                        it.solicitacao_id = principal.id
                        db.add(it)
                        sigtap_principal.add(it.sigtap_id)
                    else:
                        db.delete(it)
            if "lab_resultados_arquivos" in tabs:
                arqs = list(db.exec(select(LabResultadoArquivo).where(LabResultadoArquivo.solicitacao_id == dup.id)).all())
                for arq in arqs:
                    arq.solicitacao_id = principal.id
                    db.add(arq)
            if "lab_lotes_itens" in tabs:
                lotes = list(db.exec(select(LabLoteItem).where(LabLoteItem.solicitacao_id == dup.id)).all())
                for li in lotes:
                    li.solicitacao_id = principal.id
                    db.add(li)
            dup.status = "cancelado"
            db.add(dup)
            cancelados += 1

        db.flush()
        _recalcular_vagas_lab(db, pares_vagas)
        return _ok(
            f"{cancelados} agendamento(s) duplicado(s) consolidado(s) na solicitação #{principal.id} e vagas recalculadas.",
            cancelados,
        )

    if tipo == "mestre_sem_itens":
        solic_id = dados.get("solicitacao_id") or dados.get("id")
        if not solic_id:
            return _erro("solicitacao_id não informado.")
        sm = db.get(SolicitacaoMestre, int(solic_id))
        if not sm or sm.status == "cancelado":
            return _ok(f"Solicitação #{solic_id} já estava cancelada ou removida.", 0)
        if "lab_solic_itens" in tabs:
            tem_itens = db.execute(
                select(func.count(ItemSolic.id)).where(ItemSolic.solicitacao_id == sm.id)
            ).scalar() or 0
            if tem_itens > 0:
                return _ok(f"Solicitação #{sm.id} já possui {tem_itens} procedimento(s).", 0)
        pares_vagas: Set[Tuple[int, date]] = set()
        if sm.laboratorio_id and sm.data_agendada:
            pares_vagas.add((sm.laboratorio_id, sm.data_agendada))
        if sm.origem_fila_id and "lab_fila_psf" in tabs:
            fp = db.get(FilaPsf, sm.origem_fila_id)
            if fp and fp.status == "agendado":
                fp.status = "na_fila"
                fp.data_agendada = None
                fp.hora_agendada = ""
                db.add(fp)
        sm.status = "cancelado"
        db.add(sm)
        db.flush()
        _recalcular_vagas_lab(db, pares_vagas)
        return _ok(f"Agendamento vazio #{sm.id} cancelado e fila/vagas atualizadas.", 1)

    if tipo == "item_lab_orfao":
        item_id = dados.get("item_id") or dados.get("id")
        if not item_id:
            return _erro("item_id não informado.")
        it = db.get(ItemSolic, int(item_id))
        if not it:
            return _ok(f"Item laboratorial #{item_id} já removido.", 0)
        db.delete(it)
        db.flush()
        return _ok(f"Item laboratorial órfão #{item_id} excluído com sucesso.", 1)

    if tipo == "itens_duplicados_mesma_solicitacao":
        itens_ids = sorted(_extrair_ids(dados, "itens_ids", "ids"))
        existentes = [it for it in (db.get(ItemSolic, i) for i in itens_ids) if it is not None]
        if len(existentes) < 2:
            return _ok("Duplicidade de itens na solicitação já resolvida.", 0)
        mantido = existentes[0]
        removidos = 0
        for dup in existentes[1:]:
            db.delete(dup)
            removidos += 1
        db.flush()
        return _ok(
            f"Mantido item #{mantido.id} e excluído(s) {removidos} item(ns) duplicado(s) da solicitação #{mantido.solicitacao_id}.",
            removidos,
        )

    if tipo == "solicitacao_com_fila_inexistente":
        solic_id = dados.get("solicitacao_id") or dados.get("id")
        if not solic_id:
            return _erro("solicitacao_id não informado.")
        sm = db.get(SolicitacaoMestre, int(solic_id))
        if not sm:
            return _ok(f"Solicitação #{solic_id} não encontrada.", 0)
        sm.origem_fila_id = None
        db.add(sm)
        db.flush()
        return _ok(f"Referência quebrada origem_fila_id removida da solicitação #{sm.id}.", 1)

    if tipo == "fila_psf_agendada_sem_mestre":
        fila_id = dados.get("fila_id") or dados.get("id")
        if not fila_id:
            return _erro("fila_id não informado.")
        fp = db.get(FilaPsf, int(fila_id))
        if not fp:
            return _ok(f"Fila PSF #{fila_id} não encontrada.", 0)
        if fp.status != "agendado":
            return _ok(f"Fila PSF #{fp.id} já está com status '{fp.status}'.", 0)
        fp.status = "na_fila"
        fp.data_agendada = None
        fp.hora_agendada = ""
        db.add(fp)
        db.flush()
        return _ok(f"Fila PSF #{fp.id} retornada para status 'na_fila'.", 1)

    if tipo == "divergencia_contagem_vagas":
        vaga_id = dados.get("vaga_id") or dados.get("id")
        if not vaga_id:
            return _erro("vaga_id não informado.")
        vaga = db.get(VagaLab, int(vaga_id))
        if not vaga:
            return _ok(f"Vaga #{vaga_id} não encontrada.", 0)
        anterior = vaga.vagas_ocupadas
        real_count = db.execute(
            select(func.count(SolicitacaoMestre.id))
            .where(SolicitacaoMestre.laboratorio_id == vaga.laboratorio_id)
            .where(SolicitacaoMestre.data_agendada == vaga.data)
            .where(SolicitacaoMestre.status != "cancelado")
        ).scalar() or 0
        vaga.vagas_ocupadas = int(real_count)
        db.add(vaga)
        db.flush()
        return _ok(
            f"Vaga #{vaga.id} ({vaga.data}) sincronizada: {anterior} → {real_count} ocupada(s).",
            1,
        )

    # ------------------------------------------------------------------
    # DOMÍNIO 4: VIAGENS E TFD
    # ------------------------------------------------------------------
    if tipo == "paciente_duplicado_mesma_viagem":
        ids = _extrair_ids(dados, "ids")
        vps = [vp for vp in (db.get(ViagemPaciente, i) for i in ids) if vp is not None]
        if len(vps) < 2:
            return _ok("Duplicidade de passageiro na viagem já resolvida.", 0)
        vps.sort(key=lambda vp: (0 if vp.viagem_fila_id else 1, 0 if vp.acompanhante_id else 1, vp.id or 0))
        mantido = vps[0]
        removidos = 0
        for dup in vps[1:]:
            db.delete(dup)
            removidos += 1
        db.flush()
        return _ok(
            f"Mantida alocação #{mantido.id} na viagem #{mantido.viagem_id} e removida(s) {removidos} duplicata(s).",
            removidos,
        )

    if tipo == "passageiro_alocado_fila_aguardando":
        vf_id = dados.get("viagem_fila_id")
        if not vf_id:
            return _erro("viagem_fila_id não informado.")
        vf = db.get(ViagemFila, int(vf_id))
        if not vf:
            return _ok(f"Fila de viagem #{vf_id} não encontrada.", 0)
        vf.status = "alocado"
        db.add(vf)
        db.flush()
        return _ok(f"Fila de transporte #{vf.id} atualizada para 'alocado'.", 1)

    if tipo == "fila_viagem_alocada_sem_viagem":
        vf_id = dados.get("viagem_fila_id")
        if not vf_id:
            return _erro("viagem_fila_id não informado.")
        vf = db.get(ViagemFila, int(vf_id))
        if not vf:
            return _ok(f"Fila de viagem #{vf_id} não encontrada.", 0)
        vf.status = "aguardando"
        db.add(vf)
        db.flush()
        return _ok(f"Fila de transporte #{vf.id} devolvida para 'aguardando'.", 1)

    if tipo == "viagem_fila_exame_inexistente":
        vf_id = dados.get("viagem_fila_id")
        if not vf_id:
            return _erro("viagem_fila_id não informado.")
        vf = db.get(ViagemFila, int(vf_id))
        if not vf:
            return _ok(f"Fila de viagem #{vf_id} não encontrada.", 0)
        vf.exame_fila_id = None
        db.add(vf)
        db.flush()
        return _ok(f"Referência quebrada exame_fila_id limpa na fila de viagem #{vf.id}.", 1)

    if tipo in ("auto_acompanhamento_viagem", "acompanhante_inexistente"):
        vp_id = dados.get("viagem_paciente_id")
        if not vp_id:
            return _erro("viagem_paciente_id não informado.")
        vp = db.get(ViagemPaciente, int(vp_id))
        if not vp:
            return _ok(f"Alocação de viagem #{vp_id} não encontrada.", 0)
        vp.acompanhante_id = None
        db.add(vp)
        db.flush()
        return _ok(f"Acompanhante inválido removido da alocação #{vp.id} (viagem #{vp.viagem_id}).", 1)

    if tipo == "lotacao_veiculo_excedida":
        viagem_id = dados.get("viagem_id")
        if not viagem_id:
            return _erro("viagem_id não informado.")
        v = db.get(Viagem, int(viagem_id))
        if not v or not v.veiculo_id:
            return _ok(f"Viagem #{viagem_id} não encontrada ou sem veículo.", 0)
        veic = db.get(Veiculo, v.veiculo_id)
        if not veic:
            return _ok(f"Veículo da viagem #{viagem_id} não encontrado.", 0)

        pass_viagem = list(
            db.exec(
                select(ViagemPaciente)
                .where(ViagemPaciente.viagem_id == v.id)
                .order_by(ViagemPaciente.id.desc())
            ).all()
        )

        def _ocupacao(lista: List[ViagemPaciente]) -> int:
            return len(lista) + sum(
                1 for vp in lista if vp.acompanhante_id is not None or bool((vp.acompanhante or "").strip())
            )

        desalocados = 0
        while pass_viagem and _ocupacao(pass_viagem) > veic.capacidade:
            vp = pass_viagem.pop(0)
            if vp.viagem_fila_id and "tfd_viagem_fila" in tabs:
                vf = db.get(ViagemFila, vp.viagem_fila_id)
                if vf:
                    vf.status = "aguardando"
                    db.add(vf)
            db.delete(vp)
            desalocados += 1

        db.flush()
        return _ok(
            f"{desalocados} passageiro(s) excedente(s) desalocado(s) da viagem #{v.id} e devolvido(s) à fila (capacidade {veic.capacidade}).",
            desalocados,
        )

    # ------------------------------------------------------------------
    # DOMÍNIO 5: CADASTROS DE SAÚDE
    # ------------------------------------------------------------------
    if tipo in ("duplicidade_medico_cpf", "duplicidade_medico_crm"):
        ids = sorted(_extrair_ids(dados, "ids"))
        existentes = [i for i in ids if db.get(Medico, i) is not None]
        if len(existentes) < 2:
            return _ok("Duplicidade de médicos já resolvida anteriormente.", 0)
        mid = int(params.get("registro_principal_id") or existentes[0])
        if mid not in existentes:
            mid = existentes[0]
        dups = [i for i in existentes if i != mid]
        for did in dups:
            _unificar_medicos(db, mid, did, None, user, client_ip, user_agent)
        return _ok(f"{len(dups)} médico(s) duplicado(s) unificado(s) no médico #{mid}.", len(dups))

    if tipo == "medico_cbo_motorista":
        med_id = dados.get("medico_id") or dados.get("id")
        if not med_id:
            return _erro("medico_id não informado.")
        med = db.get(Medico, int(med_id))
        if not med:
            return _ok(f"Médico #{med_id} não encontrado.", 0)
        if not med.ativo:
            return _ok(f"Cadastro #{med.id} já estava inativo.", 0)
        med.ativo = False
        db.add(med)
        db.flush()
        return _ok(f"Cadastro indevido #{med.id} ({med.nome}) inativado na tabela de médicos.", 1)

    if tipo == "medico_unidades_invalidas":
        med_id = dados.get("medico_id") or dados.get("id")
        if not med_id:
            return _erro("medico_id não informado.")
        med = db.get(Medico, int(med_id))
        if not med:
            return _ok(f"Médico #{med_id} não encontrado.", 0)
        unidades_validas = (
            {u for u in db.exec(select(UnidadeSaude.id)).all() if u is not None}
            if "unidades_saude" in tabs
            else set()
        )
        partes = [p.strip() for p in (med.unidades_ids or "").split(",") if p.strip().isdigit()]
        limpas = [p for p in partes if int(p) in unidades_validas]
        med.unidades_ids = ",".join(limpas)
        db.add(med)
        db.flush()
        return _ok(
            f"Unidades inválidas removidas do médico #{med.id} ({med.nome}).",
            1,
        )

    if tipo == "duplicidade_unidade_cnes":
        ids = sorted(_extrair_ids(dados, "ids"))
        existentes = [i for i in ids if db.get(UnidadeSaude, i) is not None]
        if len(existentes) < 2:
            return _ok("Duplicidade de unidades de saúde já resolvida anteriormente.", 0)
        mid = int(params.get("registro_principal_id") or existentes[0])
        if mid not in existentes:
            mid = existentes[0]
        dups = [i for i in existentes if i != mid]
        for did in dups:
            _unificar_unidades(db, mid, did, None, user, client_ip, user_agent)
        return _ok(f"{len(dups)} unidade(s) duplicada(s) unificada(s) na unidade #{mid}.", len(dups))

    if tipo == "unidade_cnes_invalido":
        un_id = dados.get("unidade_id") or dados.get("id")
        if not un_id:
            return _erro("unidade_id não informado.")
        un = db.get(UnidadeSaude, int(un_id))
        if not un:
            return _ok(f"Unidade #{un_id} não encontrada.", 0)
        anterior = un.cnes
        digitos = so_digitos(un.cnes)
        if 0 < len(digitos) <= 7:
            un.cnes = digitos.zfill(7)
        else:
            un.cnes = ""
        db.add(un)
        db.flush()
        return _ok(
            f"CNES da unidade #{un.id} ({un.nome}) normalizado: '{anterior}' → '{un.cnes or '(vazio)'}'.",
            1,
        )

    if tipo in ("duplicidade_prestador_cnpj", "duplicidade_prestador_cnes"):
        ids = sorted(_extrair_ids(dados, "ids"))
        existentes = [i for i in ids if db.get(Prestador, i) is not None]
        if len(existentes) < 2:
            return _ok("Duplicidade de prestadores já resolvida anteriormente.", 0)
        mid = int(params.get("registro_principal_id") or existentes[0])
        if mid not in existentes:
            mid = existentes[0]
        dups = [i for i in existentes if i != mid]
        for did in dups:
            _unificar_prestadores(db, mid, did, None, user, client_ip, user_agent)
        return _ok(f"{len(dups)} prestador(es) duplicado(s) unificado(s) no prestador #{mid}.", len(dups))

    if tipo == "cruzamento_lab_prestador_duplicado":
        prest_id = dados.get("prestador_id")
        lab_id = dados.get("laboratorio_id")
        if not prest_id:
            return _erro("prestador_id não informado.")
        prest = db.get(Prestador, int(prest_id))
        if not prest:
            return _ok(f"Prestador #{prest_id} não encontrado.", 0)
        if not prest.ativo:
            return _ok(f"Prestador #{prest.id} já estava inativo.", 0)
        prest.ativo = False
        nota = f"Inativado por duplicidade com Laboratório #{lab_id}."
        prest.observacoes = f"{prest.observacoes} | {nota}".strip(" |")[:500]
        db.add(prest)
        db.flush()
        return _ok(
            f"Prestador redundante #{prest.id} ({prest.razao_social}) inativado, mantendo Laboratório #{lab_id} ativo.",
            1,
        )

    if tipo == "duplicidade_laboratorio_nome":
        ids = sorted(_extrair_ids(dados, "ids"))
        existentes = [i for i in ids if db.get(Laboratorio, i) is not None]
        if len(existentes) < 2:
            return _ok("Duplicidade de laboratórios já resolvida anteriormente.", 0)
        mid = int(params.get("registro_principal_id") or existentes[0])
        if mid not in existentes:
            mid = existentes[0]
        dups = [i for i in existentes if i != mid]
        for did in dups:
            _unificar_laboratorios(db, mid, did, None, user, client_ip, user_agent)
        return _ok(f"{len(dups)} laboratório(s) duplicado(s) unificado(s) no laboratório #{mid}.", len(dups))

    return _erro(f"Tipo de inconsistência '{tipo}' não possui rotina de correção cadastrada.")


def resolver_inconsistencia(
    db: Session,
    item: ResolverInconsistenciaItem,
    user: Optional[User] = None,
    client_ip: str = "",
    user_agent: str = "",
) -> ResolverInconsistenciaResultado:
    """Corrige uma única ocorrência de diagnóstico de forma atômica, auditada e invalidando o cache."""
    acquire_advisory_lock(db, LOCK_DATA_UNIFY)
    try:
        resultado = _resolver_item_interno(db, item, user, client_ip, user_agent)
        if not resultado.sucesso:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=resultado.mensagem,
            )

        registrar_auditoria(
            db=db,
            action="DATA_RESOLVE_INCONSISTENCY",
            entity="DATA_MANAGEMENT",
            entity_id=None,
            user=user,
            details={
                "tipo": item.tipo,
                "dominio": item.dominio,
                "chave_unica": item.chave_unica,
                "registros_afetados": resultado.registros_afetados,
                "mensagem": resultado.mensagem,
                "ip": client_ip,
            },
            device=user_agent,
        )
        invalidar_cache_diagnostico(db)
        db.commit()
        return resultado
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("Falha ao resolver inconsistência '%s': %s", item.tipo, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao corrigir inconsistência: {exc}",
        )


def resolver_inconsistencias_lote(
    db: Session,
    request: ResolverLoteRequest,
    user: Optional[User] = None,
    client_ip: str = "",
    user_agent: str = "",
) -> ResolverLoteResponse:
    """Corrige em lote as ocorrências selecionadas, usando savepoints isolados por item."""
    acquire_advisory_lock(db, LOCK_DATA_UNIFY)
    resultados: List[ResolverInconsistenciaResultado] = []
    resolvidos = 0
    falhas = 0
    usar_savepoint = _eh_postgres(db)

    try:
        for item in request.itens:
            try:
                if usar_savepoint:
                    with db.begin_nested():
                        res = _resolver_item_interno(db, item, user, client_ip, user_agent)
                        if not res.sucesso:
                            raise ValueError(res.mensagem)
                else:
                    res = _resolver_item_interno(db, item, user, client_ip, user_agent)
                    if not res.sucesso:
                        db.rollback()
                        raise ValueError(res.mensagem)
                    db.commit()
                resultados.append(res)
                resolvidos += 1
            except HTTPException as http_exc:
                if not usar_savepoint:
                    db.rollback()
                falhas += 1
                resultados.append(
                    ResolverInconsistenciaResultado(
                        chave_unica=item.chave_unica,
                        tipo=item.tipo,
                        dominio=item.dominio,
                        sucesso=False,
                        mensagem=str(http_exc.detail),
                        registros_afetados=0,
                    )
                )
            except Exception as item_exc:
                if not usar_savepoint:
                    db.rollback()
                falhas += 1
                resultados.append(
                    ResolverInconsistenciaResultado(
                        chave_unica=item.chave_unica,
                        tipo=item.tipo,
                        dominio=item.dominio,
                        sucesso=False,
                        mensagem=str(item_exc),
                        registros_afetados=0,
                    )
                )

        if resolvidos > 0:
            registrar_auditoria(
                db=db,
                action="DATA_RESOLVE_BATCH",
                entity="DATA_MANAGEMENT",
                entity_id=None,
                user=user,
                details={
                    "total_solicitados": len(request.itens),
                    "total_resolvidos": resolvidos,
                    "total_falhas": falhas,
                    "tipos": sorted({i.tipo for i in request.itens}),
                    "ip": client_ip,
                },
                device=user_agent,
            )
            invalidar_cache_diagnostico(db)

        db.commit()

        msg = (
            f"Correção em lote concluída: {resolvidos} de {len(request.itens)} problema(s) corrigido(s)."
            if falhas == 0
            else f"Correção em lote finalizada com avisos: {resolvidos} corrigido(s) e {falhas} falha(s)."
        )
        return ResolverLoteResponse(
            sucesso=falhas == 0,
            total_solicitados=len(request.itens),
            total_resolvidos=resolvidos,
            total_falhas=falhas,
            mensagem=msg,
            resultados=resultados,
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("Falha na correção em lote de inconsistências: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro durante a correção em lote: {exc}",
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
