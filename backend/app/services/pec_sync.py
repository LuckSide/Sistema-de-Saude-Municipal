import json as _json
import logging
import re
import threading
import time
import unicodedata
from datetime import date, datetime
from difflib import SequenceMatcher
from typing import Optional

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import text
from sqlmodel import Session, select

from app.models.audit import AuditLog
from app.models.cadastros_saude import UnidadeSaude
from app.models.integracoes import IntegrationSettings, PecSyncLog
from app.models.settings import SystemSettings
from app.models.tfd import ExameFila, Paciente, PacienteHistorico, ViagemFila
from app.services.geradores import gerar_prontuario_aleatorio
from app.services.pec_tunnel import garantir_tunel_db

logger = logging.getLogger(__name__)

ADVISORY_LOCK_SYNC = 847291992
_SYNC_LOCK = threading.Lock()
_SYNC_RUNNING = False

_PREPOSICOES_NOME = frozenset({"DE", "DA", "DO", "DOS", "DAS", "E"})
_PLACEHOLDERS_MAE = frozenset({
    "NAO INFORMADO",
    "NAO INFORMADA",
    "NAO DECLARADO",
    "NAO DECLARADA",
    "DESCONHECIDO",
    "DESCONHECIDA",
    "IGNORADO",
    "IGNORADA",
    "SEM DECLARACAO",
    "NAO CONSTA",
    "NI",
    "N I",
    "NDA",
    "SEM MAE",
    "MAE DESCONHECIDA",
    "NAO SABE",
    "NAO POSSUI",
    "SEM INFORMACAO",
})
_NOMES_INVALIDOS = frozenset({
    "NAO IDENTIFICADO",
    "NAO IDENTIFICADA",
    "DESCONHECIDO",
    "DESCONHECIDA",
    "PACIENTE TESTE",
    "TESTE",
    "SEM NOME",
    "INDIGENTE",
    "IGNORADO",
})
_MUNICIPIOS_IGNORADOS = frozenset({
    "NAO INFORMADO",
    "IGNORADO",
    "SEM INFORMACAO",
    "NAO DECLARADO",
})

# Todas as tabelas com FK/referência direta a tfd_pacientes.id
_REFERENCIAS_SIMPLES_PACIENTE: tuple[tuple[str, str], ...] = (
    ("tfd_exames_fila", "paciente_id"),
    ("tfd_viagem_pacientes", "acompanhante_id"),
    ("tfd_viagem_fila", "paciente_id"),
    ("tfd_viagem_fila", "acompanhante_id"),
    ("tfd_pacientes_historico", "paciente_id"),
    ("usuarios", "paciente_id"),
    ("oxigenio_emprestimos", "paciente_id"),
    ("oxigenio_trocas_historico", "paciente_id"),
    ("oxigenio_cilindros_vazios", "paciente_id"),
    ("lab_fila_psf", "paciente_id"),
    ("lab_solic_mestre", "paciente_id"),
    ("lab_solicitacoes", "paciente_id"),
    ("whatsapp_logs", "paciente_id"),
    ("apac_solicitacoes", "paciente_id"),
)


def is_sync_running() -> bool:
    return _SYNC_RUNNING


def limpar_cpf(cpf: Optional[str]) -> str:
    if not cpf:
        return ""
    digits = re.sub(r"\D", "", str(cpf))
    if len(digits) != 11:
        return ""
    # Rejeita CPFs com todos os dígitos iguais
    if digits == digits[0] * 11:
        return ""
    return digits


def limpar_cns(cns: Optional[str]) -> str:
    if not cns:
        return ""
    digits = re.sub(r"\D", "", str(cns))
    if len(digits) != 15:
        return ""
    if digits == digits[0] * 15:
        return ""
    return digits


def normalizar_nome(texto: Optional[str]) -> str:
    if not texto:
        return ""
    n = unicodedata.normalize("NFKD", str(texto)).encode("ASCII", "ignore").decode("ASCII")
    n = re.sub(r"[^A-Za-z0-9\s]", " ", n)
    return re.sub(r"\s+", " ", n).strip().upper()


def normalizar_nome_sem_prep(texto: Optional[str]) -> str:
    tokens = [t for t in normalizar_nome(texto).split() if t and t not in _PREPOSICOES_NOME]
    return " ".join(tokens)


def limpar_nome_mae(mae: Optional[str]) -> str:
    n = normalizar_nome(mae)
    if not n or len(n) <= 1 or n in _PLACEHOLDERS_MAE:
        return ""
    return n


def comparar_nomes_mae(mae1: Optional[str], mae2: Optional[str]) -> bool:
    """Verifica compatibilidade entre nomes de mãe.

    Ignora placeholders ("NAO INFORMADO", "IGNORADA", etc.). Quando ambos são válidos,
    aceita igualdade, equivalência sem preposições, mesmo primeiro nome ou alta
    similaridade ortográfica.
    """
    n1 = limpar_nome_mae(mae1)
    n2 = limpar_nome_mae(mae2)
    if not n1 or not n2:
        return True
    if n1 == n2:
        return True
    s1 = normalizar_nome_sem_prep(n1)
    s2 = normalizar_nome_sem_prep(n2)
    if s1 == s2:
        return True
    t1 = s1.split()
    t2 = s2.split()
    if t1 and t2 and t1[0] == t2[0]:
        return True
    return SequenceMatcher(None, s1, s2).ratio() >= 0.86


def nomes_sao_compativeis(nome1: Optional[str], nome2: Optional[str]) -> bool:
    """Compara dois nomes completos de cidadão tolerando preposições e sobrenome de casado,
    sem confundir gêmeos ou irmãos (ex: MARIA CLARA SILVA vs MARIA PAULA SILVA -> False).
    """
    s1 = normalizar_nome_sem_prep(nome1)
    s2 = normalizar_nome_sem_prep(nome2)
    if not s1 or not s2:
        return False
    if s1 == s2:
        return True
    t1 = s1.split()
    t2 = s2.split()
    if len(t1) < 2 or len(t2) < 2:
        return False
    if t1[0] != t2[0]:
        return False
    curto, longo = (t1, t2) if len(t1) <= len(t2) else (t2, t1)
    idx = 0
    for tok in curto:
        achou = False
        while idx < len(longo):
            if longo[idx] == tok:
                achou = True
                idx += 1
                break
            idx += 1
        if not achou:
            return False
    return True


def calcular_completude_endereco(logr: str, num: str, comp: str, bairro: str, cep: str) -> int:
    """Calcula score de completude e qualidade do endereço para priorização contra duplicatas."""
    score = 0
    l_clean = (logr or "").strip().upper()
    if l_clean and len(l_clean) > 3 and not any(x in l_clean for x in ("SEM NOME", "NAO INFORMADO", "NÃO INFORMADO", "IGNORADO", "SN", "S/N")):
        score += 4
    n_clean = (num or "").strip().upper()
    if n_clean and n_clean not in ("S/N", "SN", "0", "SEM NUMERO", "SEM NÚMERO", "NAO INFORMADO", "NÃO INFORMADO"):
        score += 3
    b_clean = (bairro or "").strip().upper()
    if b_clean and len(b_clean) > 2 and not any(x in b_clean for x in ("NAO INFORMADO", "NÃO INFORMADO", "IGNORADO")):
        score += 2
    c_clean = "".join(c for c in (cep or "") if c.isdigit())
    if len(c_clean) == 8:
        score += 2
    if comp and comp.strip():
        score += 1
    return score


def _eh_verdadeiro(val) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return int(val) == 1
    s = normalizar_nome(str(val or ""))
    return s in ("1", "TRUE", "T", "S", "SIM", "YES")


def _eh_explicitamente_falso(val) -> bool:
    if val is None:
        return False
    if isinstance(val, bool):
        return val is False
    if isinstance(val, (int, float)):
        return int(val) == 0
    s = normalizar_nome(str(val))
    if not s:
        return False
    return s in ("0", "FALSE", "F", "N", "NAO", "NO")


def _parse_data_opcional(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    s = str(val).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except Exception:
            continue
    return None


def _eh_cadastro_valido_pec(row_map: dict, cpf: str, cns: str, dt_nasc: date | None) -> bool:
    """Rejeita registros incompletos sem nenhum identificador civil ou nomes genéricos."""
    nome_norm = normalizar_nome(row_map.get("no_cidadao"))
    if not nome_norm or len(nome_norm) < 3 or nome_norm in _NOMES_INVALIDOS:
        return False
    return bool(cpf or cns or dt_nasc)


def classificar_situacao_pec(row_map: dict, municipio_sede: str = "Guapé") -> tuple[str, str, date | None]:
    """Identifica se o registro do e-SUS PEC indica Óbito, Mudança/Outro Município, Inativo ou Ativo.

    Retorna `(situacao, detalhe, data_obito)` onde `situacao` é `'obito'`,
    `'mudanca_municipio'`, `'inativo'` ou `'ativo'`.
    """
    st_faleceu = any(
        _eh_verdadeiro(row_map.get(k))
        for k in ("st_faleceu_pec", "st_faleceu", "faleceu", "c_st_faleceu", "f_st_faleceu", "st_faleceu_fci")
    ) or _eh_explicitamente_falso(row_map.get("st_vivo_pec") if "st_vivo_pec" in row_map else row_map.get("st_vivo"))

    dt_obito = None
    for k in ("dt_obito_pec", "dt_obito", "dt_obito_fci"):
        dt_obito = _parse_data_opcional(row_map.get(k))
        if dt_obito:
            break

    ds_saida = normalizar_nome(
        row_map.get("ds_tipo_saida_pec") or row_map.get("ds_tipo_saida") or ""
    )
    co_saida = row_map.get("co_tipo_saida_pec") or row_map.get("co_dim_tipo_saida_cadastro") or row_map.get("co_tipo_saida_fci")
    try:
        co_saida_int = int(co_saida) if co_saida is not None and str(co_saida).strip().isdigit() else None
    except Exception:
        co_saida_int = None

    if st_faleceu or dt_obito is not None or "OBITO" in ds_saida or co_saida_int == 1:
        dt_str = f" em {dt_obito.strftime('%d/%m/%Y')}" if dt_obito else ""
        return "obito", f"Óbito identificado no e-SUS PEC{dt_str}.", dt_obito

    st_mudanca = any(
        _eh_verdadeiro(row_map.get(k))
        for k in (
            "st_mudanca_pec",
            "st_mudanca_territorio",
            "st_mudanca_municipio",
            "st_mudanca",
            "st_mudanca_fci",
            "st_fora_area_pec",
            "st_fora_area",
        )
    )
    muni_raw = str(
        row_map.get("no_municipio_raw")
        or row_map.get("no_municipio_domicilio")
        or row_map.get("no_municipio_tb_cidadao")
        or row_map.get("no_municipio_cad")
        or row_map.get("no_municipio")
        or ""
    ).strip()
    muni_norm = normalizar_nome(muni_raw)
    sede_norm = normalizar_nome(municipio_sede or "Guapé") or "GUAPE"

    mudanca_por_saida = (
        st_mudanca
        or "MUDANCA" in ds_saida
        or "OUTRO MUNICIPIO" in ds_saida
        or "FORA DE AREA" in ds_saida
        or co_saida_int == 2
    )
    mudanca_por_cidade = (
        bool(muni_norm)
        and len(muni_norm) >= 3
        and muni_norm not in _MUNICIPIOS_IGNORADOS
        and sede_norm not in muni_norm
    )

    if mudanca_por_saida or mudanca_por_cidade:
        detalhe = (
            f"Residente fora do município ({muni_raw}) / Mudança identificada no e-SUS PEC."
            if mudanca_por_cidade
            else "Mudança de Município / Território registrada no e-SUS PEC."
        )
        return "mudanca_municipio", detalhe, None

    # Inativação / unificação interna no próprio PEC
    inativo_pec = (
        _eh_explicitamente_falso(row_map.get("st_ativo"))
        or _eh_explicitamente_falso(row_map.get("st_ativo_para_exibicao"))
        or _eh_verdadeiro(row_map.get("st_unificado_pec"))
        or bool(str(row_map.get("co_cidadao_master_pec") or "").strip())
    )
    if not inativo_pec and _eh_verdadeiro(row_map.get("st_ficha_inativa_fci")) and not _eh_verdadeiro(row_map.get("tem_vinculo_v")):
        inativo_pec = True

    if inativo_pec:
        return "inativo", "Cadastro inativo ou unificado no e-SUS PEC.", None

    return "ativo", "", None


def aplicar_baixa_automatica_paciente(
    db: Session,
    paciente: Paciente,
    situacao: str,
    detalhe: str,
    data_obito: date | None = None,
    origem: str = "e-SUS PEC",
    agora: datetime | None = None,
) -> int:
    """Remove automaticamente o paciente da fila de espera ativa e registra histórico no prontuário."""
    if situacao not in ("obito", "mudanca_municipio") or not paciente.id:
        return 0

    agora = agora or datetime.utcnow()
    rotulo = "Óbito" if situacao == "obito" else "Mudança de Município"
    situacao_anterior = (getattr(paciente, "situacao_cadastral", None) or "ativo").strip().lower()

    paciente.situacao_cadastral = situacao
    paciente.motivo_situacao = (detalhe or rotulo)[:255]
    paciente.situacao_atualizada_em = agora
    if situacao == "obito" and data_obito is not None:
        paciente.data_obito = data_obito

    motivo_fila = f"Baixa automática ({rotulo}) via {origem}: {detalhe}".strip()[:500]
    itens_ativos = list(
        db.exec(
            select(ExameFila).where(
                ExameFila.paciente_id == paciente.id,
                ExameFila.ativo == True,  # noqa: E712
                ExameFila.status.in_(["aguardando", "agendado"]),
            )
        ).all()
    )

    ids_baixados: list[int] = []
    for ex in itens_ativos:
        ex.status_anterior = ex.status or ""
        ex.status = "cancelado"
        ex.ativo = False
        ex.motivo_remocao = motivo_fila
        ex.removido_em = agora
        ex.removido_por = f"Sincronização {origem}"[:120]
        db.add(ex)
        if ex.id:
            ids_baixados.append(ex.id)
        db.add(
            AuditLog(
                user_id=None,
                user_name=f"Sincronização {origem}"[:120],
                action="EXAM_REMOVE_AUTO",
                entity="EXAM",
                entity_id=ex.id,
                details=_json.dumps(
                    {
                        "situacao": situacao,
                        "motivo": motivo_fila,
                        "paciente_id": paciente.id,
                    },
                    ensure_ascii=False,
                ),
            )
        )

    viagens_ativas = list(
        db.exec(
            select(ViagemFila).where(
                ViagemFila.paciente_id == paciente.id,
                ViagemFila.status.in_(["aguardando", "alocado"]),
            )
        ).all()
    )
    for vf in viagens_ativas:
        vf.status = "cancelado"
        obs_atual = (vf.observacoes or "").strip()
        if motivo_fila not in obs_atual:
            vf.observacoes = f"{obs_atual} | {motivo_fila}"[:500] if obs_atual else motivo_fila
        db.add(vf)

    mudou_situacao = situacao_anterior != situacao
    if ids_baixados or mudou_situacao:
        tipo_ev = "OBITO_PEC" if situacao == "obito" else "MUDANCA_MUNICIPIO_PEC"
        resumo_hist = (
            f"{detalhe} {len(ids_baixados)} solicitação(ões) removida(s) automaticamente da fila ativa."
            if ids_baixados
            else f"{detalhe} Nenhuma solicitação ativa pendente na fila."
        )[:500]
        db.add(
            PacienteHistorico(
                paciente_id=paciente.id,
                tipo_evento=tipo_ev,
                motivo=rotulo,
                descricao=resumo_hist,
                origem=origem[:50],
                exames_baixados_qtd=len(ids_baixados),
                exames_baixados_ids=",".join(str(x) for x in ids_baixados)[:500],
                registrado_por=f"Sincronização {origem}"[:120],
                registrado_em=agora,
            )
        )
        carimbo_obs = f"[{agora.strftime('%d/%m/%Y')}] {rotulo} ({origem}): {detalhe}"
        obs_pac = (paciente.observacoes or "").strip()
        if carimbo_obs not in obs_pac:
            paciente.observacoes = f"{obs_pac}\n{carimbo_obs}"[-500:] if obs_pac else carimbo_obs[:500]

    db.add(paciente)
    return len(ids_baixados)


def _inspecionar_colunas_pec(pec_conn) -> dict[str, set[str]]:
    """Descobre colunas existentes nas tabelas do e-SUS PEC para compatibilidade entre versões."""
    mapa: dict[str, set[str]] = {}
    try:
        rows = pec_conn.execute(
            text(
                """
                SELECT table_name, column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name IN (
                      'tb_cidadao',
                      'tb_acomp_cidadaos_vinculados',
                      'tb_fat_cidadao_pec',
                      'tb_dim_tipo_saida_cadastro',
                      'tb_localidade',
                      'tb_municipio',
                      'tb_dim_municipio',
                      'tb_cds_cad_individual'
                  )
                """
            )
        ).all()
        for tname, cname in rows:
            mapa.setdefault(str(tname), set()).add(str(cname))
    except Exception:
        pass
    return mapa


def _construir_query_pec(cols_pec: dict[str, set[str]]) -> str:
    """Constrói SELECT deduplicado por `co_seq_cidadao` adaptando-se às colunas da versão do e-SUS PEC."""
    c_cols = cols_pec.get("tb_cidadao", set())
    v_cols = cols_pec.get("tb_acomp_cidadaos_vinculados", set())
    f_cols = cols_pec.get("tb_fat_cidadao_pec", set())
    ts_cols = cols_pec.get("tb_dim_tipo_saida_cadastro", set())
    loc_cols = cols_pec.get("tb_localidade", set())
    mun_cols = cols_pec.get("tb_municipio", set())
    dm_cols = cols_pec.get("tb_dim_municipio", set())
    fci_cols = cols_pec.get("tb_cds_cad_individual", set())

    # Join de localidade -> município real de residência
    join_loc = ""
    mun_loc_expr = None
    if "co_localidade_endereco" in c_cols and "co_localidade" in loc_cols:
        join_loc = "LEFT JOIN tb_localidade loc ON loc.co_localidade = c.co_localidade_endereco"
        if "co_municipio" in loc_cols and "co_municipio" in mun_cols and "no_municipio" in mun_cols:
            join_loc += " LEFT JOIN tb_municipio mun ON mun.co_municipio = loc.co_municipio"
            mun_loc_expr = "NULLIF(TRIM(mun.no_municipio), '')"
    elif "co_municipio_endereco" in c_cols and "co_municipio" in mun_cols and "no_municipio" in mun_cols:
        join_loc = "LEFT JOIN tb_municipio mun ON mun.co_municipio = c.co_municipio_endereco"
        mun_loc_expr = "NULLIF(TRIM(mun.no_municipio), '')"

    join_dm = ""
    dm_expr = None
    if "co_dim_municipio" in f_cols and "co_seq_dim_municipio" in dm_cols and "no_municipio" in dm_cols:
        join_dm = "LEFT JOIN tb_dim_municipio dm ON dm.co_seq_dim_municipio = f.co_dim_municipio"
        dm_expr = "NULLIF(TRIM(dm.no_municipio), '')"

    # Join lateral na FCI mais recente (quando existir) sem multiplicar linhas
    join_fci = ""
    if "co_cidadao" in fci_cols:
        fci_order = []
        if "st_versao_atual" in fci_cols:
            fci_order.append("st_versao_atual DESC NULLS LAST")
        if "dt_cad_individual" in fci_cols:
            fci_order.append("dt_cad_individual DESC NULLS LAST")
        if "co_seq_cds_cad_individual" in fci_cols:
            fci_order.append("co_seq_cds_cad_individual DESC")
        order_fci_sql = ", ".join(fci_order) or "1"
        fci_sel = [
            col
            for col in (
                "st_ficha_inativa",
                "st_mudanca",
                "st_fora_area",
                "dt_obito",
                "tp_cds_origem",
                "st_faleceu",
                "co_tipo_saida",
                "tp_saida_cadastro",
                "co_cds_tipo_saida",
                "tp_cds_tipo_saida",
                "co_dim_tipo_saida_cadastro",
            )
            if col in fci_cols
        ]
        if fci_sel:
            join_fci = (
                f"LEFT JOIN LATERAL ("
                f"SELECT {', '.join(fci_sel)} FROM tb_cds_cad_individual fci_sub "
                f"WHERE fci_sub.co_cidadao = c.co_seq_cidadao "
                f"ORDER BY {order_fci_sql} LIMIT 1"
                f") fci ON TRUE"
            )

    faleceu_exprs = []
    if "st_faleceu" in c_cols:
        faleceu_exprs.append("NULLIF(TRIM(c.st_faleceu::text), '')")
    if "st_faleceu" in f_cols:
        faleceu_exprs.append("NULLIF(TRIM(f.st_faleceu::text), '')")
    if join_fci and "st_faleceu" in fci_cols:
        faleceu_exprs.append("NULLIF(TRIM(fci.st_faleceu::text), '')")
    sel_faleceu = f"COALESCE({', '.join(faleceu_exprs)}, '') AS st_faleceu_pec" if faleceu_exprs else "'' AS st_faleceu_pec"

    sel_st_vivo = "c.st_vivo::text AS st_vivo_pec" if "st_vivo" in c_cols else "'' AS st_vivo_pec"
    dt_obito_exprs = []
    if "dt_obito" in c_cols:
        dt_obito_exprs.append("c.dt_obito::date")
    if join_fci and "dt_obito" in fci_cols:
        dt_obito_exprs.append("fci.dt_obito::date")
    sel_dt_obito = (
        f"COALESCE({', '.join(dt_obito_exprs)}) AS dt_obito_pec"
        if dt_obito_exprs
        else "NULL::date AS dt_obito_pec"
    )

    mudanca_exprs = []
    if "st_mudanca_territorio" in v_cols:
        mudanca_exprs.append("NULLIF(TRIM(v.st_mudanca_territorio::text), '')")
    if "st_mudanca" in c_cols:
        mudanca_exprs.append("NULLIF(TRIM(c.st_mudanca::text), '')")
    if "st_mudou_se" in f_cols:
        mudanca_exprs.append("NULLIF(TRIM(f.st_mudou_se::text), '')")
    if join_fci and "st_mudanca" in fci_cols:
        mudanca_exprs.append("NULLIF(TRIM(fci.st_mudanca::text), '')")
    sel_mudanca = f"COALESCE({', '.join(mudanca_exprs)}, '') AS st_mudanca_pec" if mudanca_exprs else "'' AS st_mudanca_pec"

    sel_fora_area = (
        "COALESCE(fci.st_fora_area::text, '') AS st_fora_area_pec"
        if join_fci and "st_fora_area" in fci_cols
        else "'' AS st_fora_area_pec"
    )
    sel_ficha_inativa = (
        "COALESCE(fci.st_ficha_inativa::text, '') AS st_ficha_inativa_fci"
        if join_fci and "st_ficha_inativa" in fci_cols
        else "'' AS st_ficha_inativa_fci"
    )

    co_saida_exprs = []
    if "co_dim_tipo_saida_cadastro" in f_cols:
        co_saida_exprs.append("NULLIF(TRIM(f.co_dim_tipo_saida_cadastro::text), '')")
    if join_fci:
        for fc in ("co_tipo_saida", "tp_saida_cadastro", "co_cds_tipo_saida", "tp_cds_tipo_saida", "co_dim_tipo_saida_cadastro"):
            if fc in fci_cols:
                co_saida_exprs.append(f"NULLIF(TRIM(fci.{fc}::text), '')")
    sel_co_saida = (
        f"COALESCE({', '.join(co_saida_exprs)}, '') AS co_tipo_saida_pec"
        if co_saida_exprs
        else "'' AS co_tipo_saida_pec"
    )

    if "co_dim_tipo_saida_cadastro" in f_cols and ts_cols and "ds_tipo_saida" in ts_cols:
        join_saida = "LEFT JOIN tb_dim_tipo_saida_cadastro ts ON ts.co_seq_dim_tipo_saida_cadastro = f.co_dim_tipo_saida_cadastro"
        sel_ds_saida = "COALESCE(ts.ds_tipo_saida, '') AS ds_tipo_saida_pec"
    else:
        join_saida = ""
        sel_ds_saida = "'' AS ds_tipo_saida_pec"

    sel_exibicao = "c.st_ativo_para_exibicao::text AS st_ativo_para_exibicao" if "st_ativo_para_exibicao" in c_cols else "'' AS st_ativo_para_exibicao"
    sel_unificado = "c.st_unificado::text AS st_unificado_pec" if "st_unificado" in c_cols else "'' AS st_unificado_pec"
    master_col = "co_cidadao_master" if "co_cidadao_master" in c_cols else ("co_unico_cidadao_master" if "co_unico_cidadao_master" in c_cols else "")
    sel_master = f"c.{master_col}::text AS co_cidadao_master_pec" if master_col else "'' AS co_cidadao_master_pec"

    muni_exprs = [
        "NULLIF(TRIM(v.no_municipio_domicilio), '')",
        "NULLIF(TRIM(v.no_municipio_tb_cidadao), '')",
    ]
    if mun_loc_expr:
        muni_exprs.append(mun_loc_expr)
    if dm_expr:
        muni_exprs.append(dm_expr)
    if "no_municipio" in c_cols:
        muni_exprs.append("NULLIF(TRIM(c.no_municipio), '')")
    co_muni_sql = f"COALESCE({', '.join(muni_exprs)}, '')"

    inner_order = ["c.co_seq_cidadao DESC", "(v.co_cidadao IS NOT NULL) DESC"]
    if "co_dim_tipo_saida_cadastro" in f_cols:
        inner_order.append("(f.co_dim_tipo_saida_cadastro IS NOT NULL) DESC")
    if "co_seq_fat_cidadao_pec" in f_cols:
        inner_order.append("f.co_seq_fat_cidadao_pec DESC NULLS LAST")
    inner_order_sql = ", ".join(inner_order)

    return f"""
        SELECT * FROM (
            SELECT DISTINCT ON (c.co_seq_cidadao)
                c.co_seq_cidadao,
                c.no_cidadao,
                c.no_social,
                c.nu_cpf,
                c.nu_cns,
                c.dt_nascimento,
                c.no_sexo,
                c.no_mae,
                c.nu_telefone_celular,
                c.nu_telefone_contato,
                c.nu_telefone_residencial,
                COALESCE(NULLIF(TRIM(v.ds_logradouro_domicilio), ''), NULLIF(TRIM(v.ds_logradouro_tb_cidadao), ''), c.ds_logradouro) AS ds_logradouro,
                COALESCE(NULLIF(TRIM(v.nu_numero_domicilio), ''), NULLIF(TRIM(v.nu_numero_tb_cidadao), ''), c.nu_numero) AS nu_numero,
                COALESCE(NULLIF(TRIM(v.ds_complemento_domicilio), ''), NULLIF(TRIM(v.ds_complemento_tb_cidadao), ''), c.ds_complemento) AS ds_complemento,
                COALESCE(NULLIF(TRIM(v.no_bairro_domicilio), ''), NULLIF(TRIM(v.no_bairro_tb_cidadao), ''), c.no_bairro) AS no_bairro,
                COALESCE(NULLIF(TRIM(v.ds_cep_domicilio), ''), NULLIF(TRIM(v.ds_cep_tb_cidadao), ''), c.ds_cep) AS ds_cep,
                c.ds_ponto_referencia,
                COALESCE(NULLIF(TRIM(v.nu_micro_area_domicilio), ''), NULLIF(TRIM(v.nu_micro_area_tb_cidadao), ''), c.nu_micro_area) AS nu_micro_area,
                {co_muni_sql} AS no_municipio,
                {co_muni_sql} AS no_municipio_raw,
                {sel_faleceu},
                {sel_st_vivo},
                {sel_dt_obito},
                {sel_mudanca},
                {sel_fora_area},
                {sel_ficha_inativa},
                {sel_co_saida},
                {sel_ds_saida},
                {sel_exibicao},
                {sel_unificado},
                {sel_master},
                CASE WHEN v.co_cidadao IS NOT NULL THEN 1 ELSE 0 END AS tem_vinculo_v,
                c.dt_atualizado,
                c.st_ativo,
                COALESCE(NULLIF(TRIM(v.nu_cnes_vinc_equipe), ''), u.nu_cnes) AS nu_cnes,
                u.no_unidade_saude,
                COALESCE(NULLIF(TRIM(v.nu_ine_vinc_equipe), ''), e.nu_ine) AS nu_ine,
                COALESCE(NULLIF(TRIM(v.no_equipe_vinc_equipe), ''), e.no_equipe) AS no_equipe
            FROM tb_cidadao c
            LEFT JOIN tb_acomp_cidadaos_vinculados v ON v.co_cidadao = c.co_seq_cidadao
            LEFT JOIN tb_fat_cidadao_pec f ON f.co_cidadao = c.co_seq_cidadao
            {join_loc}
            {join_dm}
            {join_saida}
            {join_fci}
            LEFT JOIN tb_dim_unidade_saude u ON u.co_seq_dim_unidade_saude = f.co_dim_unidade_saude_vinc
            LEFT JOIN tb_dim_equipe e ON e.co_seq_dim_equipe = f.co_dim_equipe_vinc
            ORDER BY {inner_order_sql}
        ) sub_pec
        ORDER BY CASE WHEN COALESCE(sub_pec.st_ativo::text, '1') IN ('1', 'true', 't', 'TRUE') THEN 0 ELSE 1 END,
                 sub_pec.dt_atualizado DESC NULLS LAST,
                 sub_pec.co_seq_cidadao DESC;
    """


def _tabelas_existentes(db: Session) -> set[str]:
    try:
        bind = db.get_bind()
        if bind is None:
            return set()
        return set(sa_inspect(bind).get_table_names())
    except Exception:
        return set()


def _coletar_ids_com_vinculo(
    db: Session,
    tabelas: set[str] | None = None,
    com_mapa_tabelas: bool = False,
):
    """Retorna `(ids_com_vinculo, ids_usuario)` (ou também `tabela_ids_map` por tabela/coluna)."""
    tabs = tabelas if tabelas is not None else _tabelas_existentes(db)
    vinculados: set[int] = set()
    usuarios_pac: set[int] = set()
    tabela_ids_map: dict[tuple[str, str], set[int]] = {}

    for tabela, col in _REFERENCIAS_SIMPLES_PACIENTE + (("tfd_viagem_pacientes", "paciente_id"), ("tfd_faturamento", "paciente_id")):
        if tabela not in tabs:
            continue
        try:
            rows = db.execute(text(f"SELECT DISTINCT {col} FROM {tabela} WHERE {col} IS NOT NULL")).all()
            ids_t = {int(pid) for (pid,) in rows if pid is not None}
            tabela_ids_map[(tabela, col)] = ids_t
            if tabela == "tfd_pacientes_historico":
                continue
            vinculados.update(ids_t)
            if tabela == "usuarios":
                usuarios_pac.update(ids_t)
        except Exception:
            continue

    if com_mapa_tabelas:
        return vinculados, usuarios_pac, tabela_ids_map
    return vinculados, usuarios_pac


def _registros_compatíveis_para_mescla(p1: Paciente, p2: Paciente) -> bool:
    """Confirma que dois cadastros locais podem ser da mesma pessoa sem conflito rígido."""
    cpf1, cpf2 = limpar_cpf(p1.cpf), limpar_cpf(p2.cpf)
    if cpf1 and cpf2 and cpf1 != cpf2:
        return False
    cns1, cns2 = limpar_cns(p1.cns), limpar_cns(p2.cns)
    if cns1 and cns2 and cns1 != cns2 and not (cpf1 and cpf1 == cpf2):
        return False
    if p1.nascimento and p2.nascimento and p1.nascimento != p2.nascimento:
        if not (cpf1 and cpf1 == cpf2):
            return False
    if not comparar_nomes_mae(p1.nome_mae, p2.nome_mae):
        if not (cpf1 and cpf1 == cpf2):
            return False
    return True


def _score_paciente_master(
    p: Paciente,
    ids_vinculo: set[int],
    ids_usuario: set[int],
) -> tuple:
    """Quanto maior a tupla, melhor candidato para permanecer como registro principal (`PR-...`)."""
    pid = p.id or 0
    sit = (getattr(p, "situacao_cadastral", None) or "ativo").strip().lower()
    cpf = limpar_cpf(p.cpf)
    cns = limpar_cns(p.cns)
    return (
        1 if pid in ids_usuario else 0,
        1 if pid in ids_vinculo else 0,
        1 if sit == "ativo" else 0,
        1 if cpf else 0,
        1 if cns else 0,
        1 if p.nascimento is not None else 0,
        1 if p.co_seq_cidadao_pec is not None else 0,
        calcular_completude_endereco(
            p.endereco or "",
            p.endereco_numero or "",
            p.complemento or "",
            p.bairro or "",
            p.cep or "",
        ),
        1 if limpar_nome_mae(p.nome_mae) else 0,
        1 if (p.telefone or "").strip() else 0,
        -pid,
    )


def _consolidar_campos_master_em_memoria(
    master: Paciente,
    dup: Paciente,
    ids_vinculo: set[int],
    ids_usuario: set[int],
) -> None:
    """Enriquece `master` com os dados mais completos de `dup` sem emitir SQL individual."""
    if not master.id or not dup.id:
        return
    mid, did = int(master.id), int(dup.id)

    if not limpar_cpf(master.cpf) and limpar_cpf(dup.cpf):
        master.cpf = limpar_cpf(dup.cpf)
    if not limpar_cns(master.cns) and limpar_cns(dup.cns):
        master.cns = limpar_cns(dup.cns)
    if not master.nascimento and dup.nascimento:
        master.nascimento = dup.nascimento
    if not master.nome_social and dup.nome_social:
        master.nome_social = dup.nome_social
    if not limpar_nome_mae(master.nome_mae) and limpar_nome_mae(dup.nome_mae):
        master.nome_mae = dup.nome_mae
    if not master.sexo and dup.sexo:
        master.sexo = dup.sexo
    if not master.telefone and dup.telefone:
        master.telefone = dup.telefone
    if not master.codigo_prontuario and dup.codigo_prontuario:
        master.codigo_prontuario = dup.codigo_prontuario
    if not master.co_seq_cidadao_pec and dup.co_seq_cidadao_pec:
        master.co_seq_cidadao_pec = dup.co_seq_cidadao_pec

    score_m = calcular_completude_endereco(
        master.endereco or "",
        master.endereco_numero or "",
        master.complemento or "",
        master.bairro or "",
        master.cep or "",
    )
    score_d = calcular_completude_endereco(
        dup.endereco or "",
        dup.endereco_numero or "",
        dup.complemento or "",
        dup.bairro or "",
        dup.cep or "",
    )
    if score_d > score_m:
        for campo in ("endereco", "endereco_numero", "complemento", "bairro", "municipio", "cep", "ponto_referencia"):
            val_d = getattr(dup, campo, "")
            if val_d:
                setattr(master, campo, val_d)
    else:
        for campo in ("endereco", "endereco_numero", "complemento", "bairro", "municipio", "cep", "ponto_referencia"):
            if not getattr(master, campo, "") and getattr(dup, campo, ""):
                setattr(master, campo, getattr(dup, campo))

    if not master.unidade_saude_id and dup.unidade_saude_id:
        master.unidade_saude_id = dup.unidade_saude_id
    if not master.unidade_cnes and dup.unidade_cnes:
        master.unidade_cnes = dup.unidade_cnes
        master.unidade_nome = dup.unidade_nome
    if not master.equipe_ine and dup.equipe_ine:
        master.equipe_ine = dup.equipe_ine
        master.equipe_esf = dup.equipe_esf
    if not master.microarea and dup.microarea:
        master.microarea = dup.microarea

    sit_m = (getattr(master, "situacao_cadastral", None) or "ativo").lower()
    sit_d = (getattr(dup, "situacao_cadastral", None) or "ativo").lower()
    if sit_m != "ativo" and sit_d == "ativo":
        master.situacao_cadastral = "ativo"
        master.motivo_situacao = ""
        master.data_obito = None
    elif sit_m == "ativo" and sit_d in ("obito", "mudanca_municipio"):
        if dup.sincronizado_em and (not master.sincronizado_em or dup.sincronizado_em > master.sincronizado_em):
            master.situacao_cadastral = sit_d
            master.motivo_situacao = dup.motivo_situacao
            if dup.data_obito and not master.data_obito:
                master.data_obito = dup.data_obito

    if did in ids_vinculo:
        ids_vinculo.add(mid)
    if did in ids_usuario:
        ids_usuario.add(mid)
    master.updated_at = datetime.utcnow()


def _mesclar_pacientes(
    db: Session,
    master: Paciente,
    dup: Paciente,
    tabelas: set[str],
    ids_vinculo: set[int],
    ids_usuario: set[int],
) -> int:
    """Transfere todas as referências de `dup` para `master`, consolida campos e remove `dup`."""
    if not master.id or not dup.id or master.id == dup.id:
        return 0

    mid, did = int(master.id), int(dup.id)
    migrados = 0

    # Trata constraints únicas ANTES do UPDATE
    if "tfd_viagem_pacientes" in tabelas:
        db.execute(
            text(
                "DELETE FROM tfd_viagem_pacientes "
                "WHERE paciente_id = :did "
                "AND viagem_id IN (SELECT viagem_id FROM tfd_viagem_pacientes WHERE paciente_id = :mid)"
            ),
            {"did": did, "mid": mid},
        )
        res = db.execute(
            text("UPDATE tfd_viagem_pacientes SET paciente_id = :mid WHERE paciente_id = :did"),
            {"did": did, "mid": mid},
        )
        migrados += getattr(res, "rowcount", 0) or 0

    if "tfd_faturamento" in tabelas:
        conflitos = db.execute(
            text(
                "SELECT f_dup.id FROM tfd_faturamento f_dup "
                "JOIN tfd_faturamento f_mas ON f_mas.paciente_id = :mid "
                "AND ((f_mas.viagem_id IS NULL AND f_dup.viagem_id IS NULL) OR f_mas.viagem_id = f_dup.viagem_id) "
                "AND f_mas.codigo_sigtap = f_dup.codigo_sigtap "
                "WHERE f_dup.paciente_id = :did"
            ),
            {"did": did, "mid": mid},
        ).all()
        if conflitos:
            for (cid,) in conflitos:
                db.execute(text("DELETE FROM tfd_faturamento WHERE id = :cid"), {"cid": int(cid)})
        res = db.execute(
            text("UPDATE tfd_faturamento SET paciente_id = :mid WHERE paciente_id = :did"),
            {"did": did, "mid": mid},
        )
        migrados += getattr(res, "rowcount", 0) or 0

    for tabela, col in _REFERENCIAS_SIMPLES_PACIENTE:
        if tabela not in tabelas:
            continue
        res = db.execute(
            text(f"UPDATE {tabela} SET {col} = :mid WHERE {col} = :did"),
            {"mid": mid, "did": did},
        )
        migrados += getattr(res, "rowcount", 0) or 0

    _consolidar_campos_master_em_memoria(master, dup, ids_vinculo, ids_usuario)
    db.add(master)
    db.flush()
    db.delete(dup)
    db.flush()
    return migrados


def _executar_lote_updates_fk(
    db: Session,
    tabela: str,
    col: str,
    pares: list[tuple[int, int]],
    chunk_size: int = 200,
) -> int:
    """Atualiza FK em lotes de `chunk_size` via `CASE` parametrizado (compatível PostgreSQL e SQLite)."""
    migrados = 0
    for ini in range(0, len(pares), chunk_size):
        bloco = pares[ini : ini + chunk_size]
        cases = " ".join(f"WHEN :d{i} THEN :m{i}" for i in range(len(bloco)))
        in_clause = ", ".join(f":d{i}" for i in range(len(bloco)))
        params = {}
        for i, (did, mid) in enumerate(bloco):
            params[f"d{i}"] = did
            params[f"m{i}"] = mid
        res = db.execute(
            text(f"UPDATE {tabela} SET {col} = CASE {col} {cases} END WHERE {col} IN ({in_clause})"),
            params,
        )
        migrados += getattr(res, "rowcount", 0) or 0
    return migrados


def _deletar_ids_em_lote(db: Session, tabela: str, col: str, ids: list[int], chunk_size: int = 500) -> None:
    for ini in range(0, len(ids), chunk_size):
        bloco = ids[ini : ini + chunk_size]
        in_clause = ", ".join(f":x{i}" for i in range(len(bloco)))
        params = {f"x{i}": v for i, v in enumerate(bloco)}
        db.execute(text(f"DELETE FROM {tabela} WHERE {col} IN ({in_clause})"), params)


def consolidar_pacientes_duplicados(
    db: Session,
    remover_inelegiveis_sem_vinculo: bool = True,
) -> dict:
    """Unifica cidadãos duplicados em `tfd_pacientes` (CPF, CNS, Nome+Nascimento+Mãe) em lote
    de alta velocidade e remove cadastros oriundos do PEC sem vínculos que estejam em óbito,
    mudança de município ou inativos.
    """
    tabelas = _tabelas_existentes(db)
    ids_vinculo, ids_usuario, tabela_ids_map = _coletar_ids_com_vinculo(db, tabelas, com_mapa_tabelas=True)
    pacientes = list(db.exec(select(Paciente).order_by(Paciente.id.asc())).all())
    total_antes = len(pacientes)
    por_id: dict[int, Paciente] = {p.id: p for p in pacientes if p.id}
    removidos_ids: set[int] = set()
    dup_to_master: dict[int, int] = {}
    masters_sujos: set[int] = set()
    duplicados_mesclados = 0
    referencias_migradas = 0
    inelegiveis_removidos = 0

    def _mesclar_grupo_mem(grupo_ids: list[int], apenas_ancora_unica: bool = False) -> Optional[Paciente]:
        nonlocal duplicados_mesclados
        vivos = [por_id[pid] for pid in grupo_ids if pid in por_id and pid not in removidos_ids]
        if len(vivos) <= 1:
            return vivos[0] if vivos else None
        if apenas_ancora_unica:
            ancoras = [p for p in vivos if p.nascimento is not None or limpar_cpf(p.cpf) or limpar_cns(p.cns)]
            sem_nasc = [p for p in vivos if p.nascimento is None and not limpar_cpf(p.cpf) and not limpar_cns(p.cns)]
            if len(ancoras) != 1 or not sem_nasc:
                return None
            master = ancoras[0]
            alvos_dup = sem_nasc
        else:
            vivos.sort(key=lambda p: _score_paciente_master(p, ids_vinculo, ids_usuario), reverse=True)
            master = vivos[0]
            alvos_dup = vivos[1:]

        if not master.id:
            return None
        for dup in alvos_dup:
            if not dup.id or dup.id == master.id or dup.id in removidos_ids:
                continue
            if not _registros_compatíveis_para_mescla(master, dup):
                continue
            _consolidar_campos_master_em_memoria(master, dup, ids_vinculo, ids_usuario)
            masters_sujos.add(int(master.id))
            dup_to_master[int(dup.id)] = int(master.id)
            removidos_ids.add(int(dup.id))
            duplicados_mesclados += 1
        return master

    # 1. Agrupa por CPF limpo
    por_cpf: dict[str, list[int]] = {}
    for pid, p in por_id.items():
        if pid in removidos_ids:
            continue
        c = limpar_cpf(p.cpf)
        if c:
            por_cpf.setdefault(c, []).append(pid)
    for grupo in por_cpf.values():
        if len(grupo) > 1:
            _mesclar_grupo_mem(grupo)

    # 2. Agrupa por CNS limpo
    por_cns: dict[str, list[int]] = {}
    for pid, p in por_id.items():
        if pid in removidos_ids:
            continue
        cns = limpar_cns(p.cns)
        if cns:
            por_cns.setdefault(cns, []).append(pid)
    for grupo in por_cns.values():
        if len(grupo) > 1:
            _mesclar_grupo_mem(grupo)

    # 3. Agrupa por Nome (sem preposições) + Data de Nascimento
    por_nn: dict[tuple[str, str], list[int]] = {}
    por_nome_so: dict[str, list[int]] = {}
    for pid, p in por_id.items():
        if pid in removidos_ids:
            continue
        nome_sp = normalizar_nome_sem_prep(p.nome)
        if not nome_sp:
            continue
        por_nome_so.setdefault(nome_sp, []).append(pid)
        if p.nascimento:
            por_nn.setdefault((nome_sp, str(p.nascimento)), []).append(pid)

    for grupo in por_nn.values():
        if len(grupo) > 1:
            _mesclar_grupo_mem(grupo)

    # 3b. Mesma data de nascimento + nome da mãe não vazio idêntico/forte + sobrenome de casado ou erro leve de digitação
    por_nasc: dict[str, list[int]] = {}
    for pid, p in por_id.items():
        if pid in removidos_ids or not p.nascimento:
            continue
        if limpar_nome_mae(p.nome_mae):
            por_nasc.setdefault(str(p.nascimento), []).append(pid)
    for g_ids in por_nasc.values():
        if len(g_ids) <= 1 or len(g_ids) > 50:
            continue
        for idx_a in range(len(g_ids)):
            pid_a = g_ids[idx_a]
            if pid_a in removidos_ids:
                continue
            pa = por_id.get(pid_a)
            if not pa:
                continue
            mae_a = normalizar_nome_sem_prep(limpar_nome_mae(pa.nome_mae))
            if len(mae_a.split()) < 2:
                continue
            nome_a = normalizar_nome_sem_prep(pa.nome)
            toks_a = nome_a.split()
            if len(toks_a) < 2:
                continue
            cluster = [pid_a]
            for idx_b in range(idx_a + 1, len(g_ids)):
                pid_b = g_ids[idx_b]
                if pid_b in removidos_ids:
                    continue
                pb = por_id.get(pid_b)
                if not pb or not _registros_compatíveis_para_mescla(pa, pb):
                    continue
                mae_b = normalizar_nome_sem_prep(limpar_nome_mae(pb.nome_mae))
                if SequenceMatcher(None, mae_a, mae_b).ratio() < 0.90:
                    continue
                nome_b = normalizar_nome_sem_prep(pb.nome)
                toks_b = nome_b.split()
                if not toks_b or toks_a[0] != toks_b[0]:
                    continue
                mesmo_com_typo = len(toks_a) == len(toks_b) and SequenceMatcher(None, nome_a, nome_b).ratio() >= 0.92
                if nomes_sao_compativeis(nome_a, nome_b) or mesmo_com_typo:
                    cluster.append(pid_b)
            if len(cluster) > 1:
                _mesclar_grupo_mem(cluster)

    # 4. Registros legados sem data de nascimento e sem CPF/CNS com âncora única pelo nome completo
    for nome_sp, g_ids in por_nome_so.items():
        if len(g_ids) > 1 and len(nome_sp.split()) >= 2:
            _mesclar_grupo_mem(g_ids, apenas_ancora_unica=True)

    # Compressão de caminho transitiva (A -> B -> C passa a ser A -> C)
    if dup_to_master:
        for did in list(dup_to_master.keys()):
            alvo = dup_to_master[did]
            vistos_c = {did}
            while alvo in dup_to_master and alvo not in vistos_c:
                vistos_c.add(alvo)
                alvo = dup_to_master[alvo]
            dup_to_master[did] = alvo

        # Persiste enriquecimento dos registros sobreviventes antes de migrar FKs e deletar duplicados
        for mid in sorted(masters_sujos):
            if mid not in removidos_ids and mid in por_id:
                db.add(por_id[mid])
        db.flush()

        # Trata constraints únicas apenas quando há colisões nessas duas tabelas
        vp_ids = tabela_ids_map.get(("tfd_viagem_pacientes", "paciente_id"), set())
        for did in [d for d in dup_to_master if d in vp_ids]:
            mid = dup_to_master[did]
            db.execute(
                text(
                    "DELETE FROM tfd_viagem_pacientes "
                    "WHERE paciente_id = :did "
                    "AND viagem_id IN (SELECT viagem_id FROM tfd_viagem_pacientes WHERE paciente_id = :mid)"
                ),
                {"did": did, "mid": mid},
            )
            db.execute(
                text("UPDATE tfd_viagem_pacientes SET paciente_id = :mid WHERE paciente_id = :did"),
                {"did": did, "mid": mid},
            )
            referencias_migradas += 1

        fat_ids = tabela_ids_map.get(("tfd_faturamento", "paciente_id"), set())
        for did in [d for d in dup_to_master if d in fat_ids]:
            mid = dup_to_master[did]
            conflitos = db.execute(
                text(
                    "SELECT f_dup.id FROM tfd_faturamento f_dup "
                    "JOIN tfd_faturamento f_mas ON f_mas.paciente_id = :mid "
                    "AND ((f_mas.viagem_id IS NULL AND f_dup.viagem_id IS NULL) OR f_mas.viagem_id = f_dup.viagem_id) "
                    "AND f_mas.codigo_sigtap = f_dup.codigo_sigtap "
                    "WHERE f_dup.paciente_id = :did"
                ),
                {"did": did, "mid": mid},
            ).all()
            if conflitos:
                _deletar_ids_em_lote(db, "tfd_faturamento", "id", [int(r[0]) for r in conflitos])
            res = db.execute(
                text("UPDATE tfd_faturamento SET paciente_id = :mid WHERE paciente_id = :did"),
                {"did": did, "mid": mid},
            )
            referencias_migradas += getattr(res, "rowcount", 0) or 0

        # Migração em lote apenas nas tabelas que realmente apontam para algum `dup_id`
        for tabela, col in _REFERENCIAS_SIMPLES_PACIENTE:
            ids_tab = tabela_ids_map.get((tabela, col))
            if not ids_tab:
                continue
            pares = [(did, mid) for did, mid in dup_to_master.items() if did in ids_tab]
            if pares:
                referencias_migradas += _executar_lote_updates_fk(db, tabela, col, pares)

    # 5. Remove apenas cadastros PEC inelegíveis (óbito, mudança de município, inativo) sem nenhum vínculo clínico/usuário
    ghost_ids: list[int] = []
    if remover_inelegiveis_sem_vinculo:
        for pid, p in por_id.items():
            if pid in removidos_ids:
                continue
            sit = (getattr(p, "situacao_cadastral", None) or "ativo").strip().lower()
            if sit not in ("obito", "mudanca_municipio", "inativo"):
                continue
            if p.co_seq_cidadao_pec is None:
                continue
            if pid in ids_vinculo:
                continue
            ghost_ids.append(pid)
            removidos_ids.add(pid)
            inelegiveis_removidos += 1

    todos_excluir = sorted(removidos_ids)
    if todos_excluir:
        for pid in todos_excluir:
            obj = por_id.get(pid)
            if obj is not None:
                try:
                    db.expunge(obj)
                except Exception:
                    pass
        if ghost_ids and "tfd_pacientes_historico" in tabelas:
            _deletar_ids_em_lote(db, "tfd_pacientes_historico", "paciente_id", ghost_ids)
        _deletar_ids_em_lote(db, "tfd_pacientes", "id", todos_excluir)

    db.commit()
    total_depois = len(db.exec(select(Paciente.id)).all())
    return {
        "ok": True,
        "total_antes": total_antes,
        "total_depois": total_depois,
        "duplicados_mesclados": duplicados_mesclados,
        "referencias_migradas": referencias_migradas,
        "inelegiveis_removidos": inelegiveis_removidos,
    }


def encontrar_paciente_duplicado(
    db: Session,
    nome: str = "",
    cpf: str = "",
    cns: str = "",
    nascimento: date | None = None,
    nome_mae: str = "",
    exclude_id: int | None = None,
) -> Paciente | None:
    """Localiza cadastro existente equivalente em `tfd_pacientes` antes de criar/editar manualmente."""
    cpf_c = limpar_cpf(cpf)
    cns_c = limpar_cns(cns)
    nome_sp = normalizar_nome_sem_prep(nome)

    candidatos: list[Paciente] = []
    if cpf_c or cns_c or (nome_sp and nascimento):
        candidatos = list(db.exec(select(Paciente)).all())

    for p in candidatos:
        if exclude_id and p.id == exclude_id:
            continue
        p_cpf = limpar_cpf(p.cpf)
        p_cns = limpar_cns(p.cns)
        if cpf_c and p_cpf and cpf_c == p_cpf:
            return p
        if cns_c and p_cns and cns_c == p_cns:
            return p
        if nome_sp and nascimento and p.nascimento == nascimento:
            if nomes_sao_compativeis(nome, p.nome) and comparar_nomes_mae(nome_mae, p.nome_mae):
                if not (cpf_c and p_cpf and cpf_c != p_cpf):
                    return p
    return None


def sincronizar_pacientes_pec(db: Session, origem: str = "manual") -> PecSyncLog:
    """Executa a rotina completa de importação e upsert com desduplicação
    dos cidadãos do e-SUS PEC para `tfd_pacientes`.
    Filtra automaticamente óbitos, mudanças de município/residentes externos e
    cadastros inativos/unificados, e garante zero duplicidades.
    """
    global _SYNC_RUNNING

    # 1. Trava em memória no processo atual
    if not _SYNC_LOCK.acquire(blocking=False):
        log_ativo = db.exec(
            select(PecSyncLog).where(PecSyncLog.status == "EM_EXECUCAO").order_by(PecSyncLog.iniciado_em.desc())
        ).first()
        return log_ativo or PecSyncLog(
            status="EM_EXECUCAO",
            mensagem="Sincronização já está em execução em segundo plano neste processo.",
            origem=origem,
        )

    # 2. Trava distribuída no PostgreSQL (evita conflito entre múltiplos workers Gunicorn)
    is_pg_locked = False
    try:
        res = db.execute(text(f"SELECT pg_try_advisory_lock({ADVISORY_LOCK_SYNC})")).scalar()
        if res is False:
            _SYNC_LOCK.release()
            log_ativo = db.exec(
                select(PecSyncLog).where(PecSyncLog.status == "EM_EXECUCAO").order_by(PecSyncLog.iniciado_em.desc())
            ).first()
            return log_ativo or PecSyncLog(
                status="EM_EXECUCAO",
                mensagem="Sincronização já em execução em outro processo do servidor.",
                origem=origem,
            )
        if res is True:
            is_pg_locked = True
    except Exception:
        pass

    _SYNC_RUNNING = True
    t0 = time.time()

    log = PecSyncLog(
        iniciado_em=datetime.utcnow(),
        status="EM_EXECUCAO",
        origem=origem,
        mensagem="Iniciando sincronização inteligente com e-SUS PEC...",
    )
    db.add(log)
    try:
        cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
        if cfg:
            cfg.pec_sync_ultimo_status = "EM_EXECUCAO"
            db.add(cfg)
        db.commit()
        db.refresh(log)
    except Exception:
        db.rollback()

    try:
        cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
        conectado, dsn = garantir_tunel_db(cfg)
        if not conectado or not dsn:
            raise RuntimeError(
                "Não foi possível conectar ao e-SUS PEC. Verifique se o Túnel SSH ou os parâmetros do PostgreSQL estão configurados."
            )

        # Carrega e indexa todas as Unidades de Saúde locais por CNES
        unidades_locais = db.exec(select(UnidadeSaude)).all()
        unidades_map: dict[str, int] = {}
        for u in unidades_locais:
            if u.cnes and u.id:
                unidades_map[u.cnes.strip()] = u.id

        def obter_ou_criar_unidade(cnes: str, nome_unidade: str) -> Optional[int]:
            cnes = (cnes or "").strip()
            if not cnes:
                return None
            if cnes in unidades_map:
                return unidades_map[cnes]
            nome_limpo = (nome_unidade or f"UBS {cnes}").strip()
            nova_u = UnidadeSaude(
                nome=nome_limpo[:150],
                cnes=cnes[:20],
                tipo="UBS",
                ativo=True,
            )
            db.add(nova_u)
            db.flush()
            unidades_map[cnes] = nova_u.id
            return nova_u.id

        # Pré-consolida duplicatas locais existentes antes de indexar em memória
        pre_limp = consolidar_pacientes_duplicados(db, remover_inelegiveis_sem_vinculo=False)
        tabelas = _tabelas_existentes(db)
        ids_vinculo, ids_usuario = _coletar_ids_com_vinculo(db, tabelas)

        pacientes_locais = db.exec(select(Paciente).order_by(Paciente.id.asc())).all()
        pacientes_cache: dict[int, Paciente] = {}
        cpf_map: dict[str, list[int]] = {}
        cns_map: dict[str, list[int]] = {}
        nome_nasc_map: dict[tuple[str, str], list[int]] = {}
        nome_sp_nasc_map: dict[tuple[str, str], list[int]] = {}
        nome_sp_sem_nasc_map: dict[str, list[int]] = {}
        pec_id_map: dict[int, int] = {}

        def _indexar_paciente(p: Paciente) -> None:
            if not p.id:
                return
            pid = p.id
            pacientes_cache[pid] = p
            cpf_p = limpar_cpf(p.cpf)
            if cpf_p:
                lst = cpf_map.setdefault(cpf_p, [])
                if pid not in lst:
                    lst.append(pid)
            cns_p = limpar_cns(p.cns)
            if cns_p:
                lst = cns_map.setdefault(cns_p, [])
                if pid not in lst:
                    lst.append(pid)
            n_norm = normalizar_nome(p.nome)
            n_sp = normalizar_nome_sem_prep(p.nome)
            dt_s = str(p.nascimento) if p.nascimento else ""
            if n_norm and dt_s:
                lst = nome_nasc_map.setdefault((n_norm, dt_s), [])
                if pid not in lst:
                    lst.append(pid)
            if n_sp and dt_s:
                lst = nome_sp_nasc_map.setdefault((n_sp, dt_s), [])
                if pid not in lst:
                    lst.append(pid)
            if n_sp and not dt_s and not cpf_p and not cns_p:
                lst = nome_sp_sem_nasc_map.setdefault(n_sp, [])
                if pid not in lst:
                    lst.append(pid)
            if p.co_seq_cidadao_pec:
                pec_id_map[int(p.co_seq_cidadao_pec)] = pid

        for p in pacientes_locais:
            _indexar_paciente(p)

        from sqlalchemy import create_engine
        pec_engine = create_engine(dsn, pool_pre_ping=True, connect_args={"connect_timeout": 8})

        sys_cfg = db.exec(select(SystemSettings).where(SystemSettings.id == 1)).first()
        municipio_sede = (getattr(sys_cfg, "cidade", None) or "Guapé").strip() or "Guapé"

        total_lidos = 0
        total_inseridos = 0
        total_atualizados = 0
        total_duplicados_mesclados = pre_limp["duplicados_mesclados"]
        total_baixas_fila = 0
        total_ignorados_pec = 0
        total_removidos_inativos = 0
        total_erros = 0
        pacientes_processados_nesta_execucao: set[int] = set()
        pacientes_ativos_nesta_execucao: set[int] = set()
        pec_ids_lidos: set[int] = set()

        with pec_engine.connect() as pec_conn:
            cols_pec = _inspecionar_colunas_pec(pec_conn)
            query_pec = text(_construir_query_pec(cols_pec))
            result = pec_conn.execute(query_pec)
            batch_count = 0

            for row_map in result.mappings():
                total_lidos += 1
                try:
                    with db.begin_nested():
                        pec_id = int(row_map["co_seq_cidadao"])
                        pec_ids_lidos.add(pec_id)
                        nome_raw = row_map.get("no_cidadao")
                        if not nome_raw or not str(nome_raw).strip():
                            total_ignorados_pec += 1
                            continue

                        nome = str(nome_raw).strip()[:150]
                        nome_norm = normalizar_nome(nome)
                        nome_sp = normalizar_nome_sem_prep(nome)
                        cpf = limpar_cpf(row_map.get("nu_cpf"))
                        cns = limpar_cns(row_map.get("nu_cns"))
                        dt_nasc = _parse_data_opcional(row_map.get("dt_nascimento"))
                        dt_nasc_str = str(dt_nasc) if dt_nasc else ""
                        nome_mae_raw = row_map.get("no_mae")

                        situacao_pec, detalhe_pec, dt_obito_pec = classificar_situacao_pec(row_map, municipio_sede)

                        # Busca multi-nível retornando TODOS candidatos compatíveis para eliminar duplicidades
                        candidatos_ids: list[int] = []
                        for cid in cpf_map.get(cpf, []) if cpf else []:
                            cand = pacientes_cache.get(cid)
                            if cand and (not cand.nascimento or not dt_nasc or cand.nascimento == dt_nasc):
                                if cid not in candidatos_ids:
                                    candidatos_ids.append(cid)

                        for cid in cns_map.get(cns, []) if cns else []:
                            cand = pacientes_cache.get(cid)
                            if not cand:
                                continue
                            cpf_c = limpar_cpf(cand.cpf)
                            if cpf and cpf_c and cpf != cpf_c:
                                continue
                            if dt_nasc and cand.nascimento and dt_nasc != cand.nascimento:
                                continue
                            if cid not in candidatos_ids:
                                candidatos_ids.append(cid)

                        if nome_norm and dt_nasc_str:
                            for cid in (nome_nasc_map.get((nome_norm, dt_nasc_str), []) + nome_sp_nasc_map.get((nome_sp, dt_nasc_str), [])):
                                if cid in candidatos_ids:
                                    continue
                                cand = pacientes_cache.get(cid)
                                if not cand:
                                    continue
                                cpf_c = limpar_cpf(cand.cpf)
                                if cpf and cpf_c and cpf != cpf_c:
                                    continue
                                if not comparar_nomes_mae(cand.nome_mae, nome_mae_raw):
                                    continue
                                candidatos_ids.append(cid)

                        # Legado sem nascimento e sem CPF/CNS com nome idêntico e mãe compatível
                        if nome_sp and len(nome_sp.split()) >= 2:
                            for cid in nome_sp_sem_nasc_map.get(nome_sp, []):
                                if cid in candidatos_ids:
                                    continue
                                cand = pacientes_cache.get(cid)
                                if cand and comparar_nomes_mae(cand.nome_mae, nome_mae_raw):
                                    candidatos_ids.append(cid)

                        if pec_id in pec_id_map:
                            cid_p = pec_id_map[pec_id]
                            cand = pacientes_cache.get(cid_p)
                            if cand and cid_p not in candidatos_ids:
                                cpf_c = limpar_cpf(cand.cpf)
                                if not (cpf and cpf_c and cpf != cpf_c):
                                    candidatos_ids.append(cid_p)

                        # Se mais de 1 registro local corresponde ao mesmo cidadão, mescla imediatamente no master
                        paciente_id: Optional[int] = None
                        if len(candidatos_ids) > 1:
                            cands_objs = [pacientes_cache[cid] for cid in candidatos_ids if cid in pacientes_cache]
                            cands_objs.sort(key=lambda cp: _score_paciente_master(cp, ids_vinculo, ids_usuario), reverse=True)
                            master_p = cands_objs[0]
                            for dup_p in cands_objs[1:]:
                                if master_p.id and dup_p.id and master_p.id != dup_p.id and _registros_compatíveis_para_mescla(master_p, dup_p):
                                    _mesclar_pacientes(db, master_p, dup_p, tabelas, ids_vinculo, ids_usuario)
                                    pacientes_cache.pop(dup_p.id, None)
                                    total_duplicados_mesclados += 1
                            paciente_id = master_p.id
                        elif len(candidatos_ids) == 1:
                            paciente_id = candidatos_ids[0]

                        # Se o cidadão NÃO está no banco local e é óbito / mudança / inativo / inválido: NÃO IMPORTAR!
                        if not paciente_id:
                            if situacao_pec in ("obito", "mudanca_municipio", "inativo") or not _eh_cadastro_valido_pec(
                                row_map, cpf, cns, dt_nasc
                            ):
                                total_ignorados_pec += 1
                                continue

                            tel = (
                                row_map.get("nu_telefone_celular")
                                or row_map.get("nu_telefone_contato")
                                or row_map.get("nu_telefone_residencial")
                                or ""
                            )
                            tel_limpo = str(tel).strip()[:50]
                            cnes_raw = str(row_map.get("nu_cnes") or "").strip()
                            unidade_nome_raw = str(row_map.get("no_unidade_saude") or "").strip()
                            uid = obter_ou_criar_unidade(cnes_raw, unidade_nome_raw) if cnes_raw else None
                            agora = datetime.utcnow()

                            novo_p = Paciente(
                                nome=nome,
                                nome_social=str(row_map.get("no_social") or "").strip()[:150],
                                cpf=cpf,
                                cns=cns,
                                nascimento=dt_nasc,
                                sexo=str(row_map.get("no_sexo") or "").strip()[:20],
                                nome_mae=str(nome_mae_raw or "").strip()[:150] if limpar_nome_mae(nome_mae_raw) else "",
                                telefone=tel_limpo,
                                endereco=str(row_map.get("ds_logradouro") or "").strip()[:255],
                                endereco_numero=str(row_map.get("nu_numero") or "").strip()[:20],
                                complemento=str(row_map.get("ds_complemento") or "").strip()[:100],
                                bairro=str(row_map.get("no_bairro") or "").strip()[:100],
                                municipio=str(row_map.get("no_municipio") or municipio_sede).strip()[:100],
                                cep=str(row_map.get("ds_cep") or "").strip()[:10],
                                ponto_referencia=str(row_map.get("ds_ponto_referencia") or "").strip()[:150],
                                unidade_saude_id=uid,
                                unidade_cnes=cnes_raw[:20],
                                unidade_nome=unidade_nome_raw[:150],
                                equipe_ine=str(row_map.get("nu_ine") or "").strip()[:20],
                                equipe_esf=str(row_map.get("no_equipe") or "").strip()[:80],
                                microarea=str(row_map.get("nu_micro_area") or "").strip()[:20],
                                co_seq_cidadao_pec=pec_id,
                                situacao_cadastral="ativo",
                                sincronizado_em=agora,
                                created_at=agora,
                                updated_at=agora,
                            )
                            db.add(novo_p)
                            db.flush()
                            if novo_p.id and not novo_p.codigo_prontuario:
                                novo_p.codigo_prontuario = gerar_prontuario_aleatorio(db, novo_p.id)
                                db.add(novo_p)

                            _indexar_paciente(novo_p)
                            if novo_p.id:
                                pacientes_processados_nesta_execucao.add(novo_p.id)
                                pacientes_ativos_nesta_execucao.add(novo_p.id)
                            total_inseridos += 1
                        else:
                            p = pacientes_cache.get(paciente_id)
                            if not p:
                                continue

                            # Se uma ficha ativa desse mesmo cidadão já foi processada neste ciclo (outro co_seq_cidadao),
                            # não sobrescreve com ficha secundária antiga inativa ou de endereço anterior (óbito sempre prevalece).
                            if (
                                situacao_pec in ("inativo", "mudanca_municipio")
                                and p.id in pacientes_ativos_nesta_execucao
                                and p.co_seq_cidadao_pec
                                and int(p.co_seq_cidadao_pec) != pec_id
                            ):
                                total_duplicados_mesclados += 1
                                pec_id_map[pec_id] = p.id
                                continue

                            if p.id in pacientes_processados_nesta_execucao or (
                                p.co_seq_cidadao_pec and int(p.co_seq_cidadao_pec) != pec_id
                            ):
                                total_duplicados_mesclados += 1
                            else:
                                total_atualizados += 1

                            agora = datetime.utcnow()
                            tel = (
                                row_map.get("nu_telefone_celular")
                                or row_map.get("nu_telefone_contato")
                                or row_map.get("nu_telefone_residencial")
                                or ""
                            )
                            tel_limpo = str(tel).strip()[:50]
                            cnes_raw = str(row_map.get("nu_cnes") or "").strip()
                            unidade_nome_raw = str(row_map.get("no_unidade_saude") or "").strip()
                            uid = obter_ou_criar_unidade(cnes_raw, unidade_nome_raw) if cnes_raw else None

                            if not limpar_cpf(p.cpf) and cpf:
                                p.cpf = cpf
                            if not limpar_cns(p.cns) and cns:
                                p.cns = cns
                            if not p.nome_social and row_map.get("no_social"):
                                p.nome_social = str(row_map.get("no_social")).strip()[:150]
                            if not limpar_nome_mae(p.nome_mae) and limpar_nome_mae(nome_mae_raw):
                                p.nome_mae = str(nome_mae_raw).strip()[:150]
                            if not p.sexo and row_map.get("no_sexo"):
                                p.sexo = str(row_map.get("no_sexo")).strip()[:20]
                            if not p.nascimento and dt_nasc:
                                p.nascimento = dt_nasc
                            if not p.telefone and tel_limpo:
                                p.telefone = tel_limpo

                            logr_p = str(row_map.get("ds_logradouro") or "").strip()
                            num_p = str(row_map.get("nu_numero") or "").strip()
                            comp_p = str(row_map.get("ds_complemento") or "").strip()
                            bairro_p = str(row_map.get("no_bairro") or "").strip()
                            cep_p = str(row_map.get("ds_cep") or "").strip()
                            muni_p = str(row_map.get("no_municipio") or "").strip()
                            pt_ref_p = str(row_map.get("ds_ponto_referencia") or "").strip()

                            score_novo = calcular_completude_endereco(logr_p, num_p, comp_p, bairro_p, cep_p)
                            score_atual = calcular_completude_endereco(
                                p.endereco or "", p.endereco_numero or "", p.complemento or "", p.bairro or "", p.cep or ""
                            )
                            if score_novo >= score_atual and (logr_p or bairro_p):
                                if logr_p:
                                    p.endereco = logr_p[:255]
                                if num_p:
                                    p.endereco_numero = num_p[:20]
                                if comp_p:
                                    p.complemento = comp_p[:100]
                                if bairro_p:
                                    p.bairro = bairro_p[:100]
                                if cep_p:
                                    p.cep = cep_p[:10]
                                if muni_p:
                                    p.municipio = muni_p[:100]
                                if pt_ref_p:
                                    p.ponto_referencia = pt_ref_p[:150]
                            else:
                                if not p.endereco and logr_p:
                                    p.endereco = logr_p[:255]
                                if not p.endereco_numero and num_p:
                                    p.endereco_numero = num_p[:20]
                                if not p.complemento and comp_p:
                                    p.complemento = comp_p[:100]
                                if not p.bairro and bairro_p:
                                    p.bairro = bairro_p[:100]
                                if not p.cep and cep_p:
                                    p.cep = cep_p[:10]
                                if not p.municipio and muni_p:
                                    p.municipio = muni_p[:100]
                                if not p.ponto_referencia and pt_ref_p:
                                    p.ponto_referencia = pt_ref_p[:150]

                            if cnes_raw:
                                p.unidade_cnes = cnes_raw[:20]
                                p.unidade_nome = unidade_nome_raw[:150]
                                if uid:
                                    p.unidade_saude_id = uid
                            if str(row_map.get("nu_ine") or "").strip():
                                p.equipe_ine = str(row_map.get("nu_ine")).strip()[:20]
                                p.equipe_esf = str(row_map.get("no_equipe") or "").strip()[:80]
                            if str(row_map.get("nu_micro_area") or "").strip():
                                p.microarea = str(row_map.get("nu_micro_area")).strip()[:20]

                            if situacao_pec == "ativo":
                                p.co_seq_cidadao_pec = pec_id
                                p.situacao_cadastral = "ativo"
                                p.motivo_situacao = ""
                                p.data_obito = None
                                if p.id:
                                    pacientes_ativos_nesta_execucao.add(p.id)

                            p.sincronizado_em = agora
                            p.updated_at = agora
                            db.add(p)
                            db.flush()

                            if situacao_pec in ("obito", "mudanca_municipio"):
                                if p.id and p.id in ids_vinculo:
                                    total_baixas_fila += aplicar_baixa_automatica_paciente(
                                        db,
                                        p,
                                        situacao_pec,
                                        detalhe_pec,
                                        data_obito=dt_obito_pec,
                                        origem="e-SUS PEC",
                                        agora=agora,
                                    )
                                else:
                                    p.situacao_cadastral = situacao_pec
                                    p.motivo_situacao = (detalhe_pec or situacao_pec)[:255]
                                    p.situacao_atualizada_em = agora
                                    if dt_obito_pec is not None:
                                        p.data_obito = dt_obito_pec
                                    db.add(p)
                            elif situacao_pec == "inativo" and (getattr(p, "situacao_cadastral", "ativo") == "ativo"):
                                p.situacao_cadastral = "inativo"
                                p.motivo_situacao = detalhe_pec[:255]
                                p.situacao_atualizada_em = agora
                                db.add(p)

                            _indexar_paciente(p)
                            if p.id:
                                pacientes_processados_nesta_execucao.add(p.id)
                            pec_id_map[pec_id] = p.id

                        batch_count += 1
                        if batch_count >= 500:
                            db.commit()
                            batch_count = 0

                except Exception as row_exc:
                    logger.debug(f"Erro ao processar registro PEC: {row_exc}")
                    total_erros += 1

            db.commit()

        # Em sincronizações completas reais (>=100 lidos), marca como inativos os registros PEC órfãos que não existem mais no PEC
        if total_lidos >= 100 and pec_ids_lidos:
            for orphan in db.exec(select(Paciente).where(Paciente.co_seq_cidadao_pec.isnot(None))).all():
                if orphan.co_seq_cidadao_pec and int(orphan.co_seq_cidadao_pec) not in pec_ids_lidos:
                    if (getattr(orphan, "situacao_cadastral", "ativo") or "ativo") == "ativo":
                        orphan.situacao_cadastral = "inativo"
                        orphan.motivo_situacao = "Cadastro não localizado / removido no e-SUS PEC."
                        db.add(orphan)
            db.commit()

        # Passagem final garante unificação de eventuais duplicatas e expurgo seguro de fantasmas PEC inelegíveis sem vínculo
        pos_limp = consolidar_pacientes_duplicados(db, remover_inelegiveis_sem_vinculo=True)
        total_duplicados_mesclados += pos_limp["duplicados_mesclados"]
        total_removidos_inativos = pos_limp["inelegiveis_removidos"]
        total_ativos_base = len(
            db.exec(
                select(Paciente.id).where(Paciente.situacao_cadastral == "ativo")
            ).all()
        )

        duracao = round(time.time() - t0, 2)
        log.finalizado_em = datetime.utcnow()
        log.status = "SUCESSO"
        log.total_lidos = total_lidos
        log.total_inseridos = total_inseridos
        log.total_atualizados = total_atualizados
        log.total_duplicados_mesclados = total_duplicados_mesclados
        log.total_baixas_fila = total_baixas_fila
        log.total_ignorados_pec = total_ignorados_pec
        log.total_removidos_inativos = total_removidos_inativos
        log.total_erros = total_erros
        log.duracao_segundos = duracao
        log.mensagem = (
            f"Sincronização concluída em {duracao}s: {total_lidos} cidadãos lidos do e-SUS PEC, "
            f"{total_inseridos} novos cadastros, {total_atualizados} atualizados, "
            f"{total_ignorados_pec} ignorados (óbitos/mudanças/inativos), "
            f"{total_duplicados_mesclados} duplicados unificados, "
            f"{total_removidos_inativos} fantasmas inativos limpos e "
            f"{total_baixas_fila} baixa(s) na fila. Ativos no município: {total_ativos_base}."
        )

        cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
        if cfg:
            cfg.pec_sync_ultima_execucao = datetime.utcnow()
            cfg.pec_sync_ultimo_status = "SUCESSO"
            cfg.pec_sync_total_pacientes = total_ativos_base
            db.add(cfg)

        db.add(log)
        db.commit()
        db.refresh(log)
        return log

    except Exception as e:
        logger.error(f"Erro na sincronização e-SUS PEC: {e}", exc_info=True)
        duracao = round(time.time() - t0, 2)
        err_msg = "Ocorreu um erro interno durante a sincronizacao."
        try:
            db.rollback()
        except Exception:
            pass

        log.finalizado_em = datetime.utcnow()
        log.status = "ERRO"
        log.duracao_segundos = duracao
        log.mensagem = f"Falha na sincronização: {err_msg}"
        log.detalhes = str(e)[:2000]

        try:
            cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
            if cfg:
                cfg.pec_sync_ultima_execucao = datetime.utcnow()
                cfg.pec_sync_ultimo_status = "ERRO"
                db.add(cfg)
            db.add(log)
            db.commit()
            db.refresh(log)
        except Exception:
            pass
        return log

    finally:
        if is_pg_locked:
            try:
                db.execute(text(f"SELECT pg_advisory_unlock({ADVISORY_LOCK_SYNC})"))
            except Exception:
                pass
        _SYNC_RUNNING = False
        _SYNC_LOCK.release()


def atualizar_enderecos_pacientes_pec(db: Session) -> dict:
    """Sincroniza e atualiza os endereços dos pacientes locais ativos
    a partir das fichas territoriais e domiciliares do e-SUS PEC.
    """
    cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
    conectado, dsn = garantir_tunel_db(cfg)
    if not conectado or not dsn:
        return {"ok": False, "mensagem": "Não conectado ao e-SUS PEC."}

    from sqlalchemy import create_engine
    pec_engine = create_engine(dsn, pool_pre_ping=True, connect_args={"connect_timeout": 8})

    query = text("""
        SELECT DISTINCT ON (c.co_seq_cidadao)
            c.co_seq_cidadao,
            c.nu_cpf,
            c.nu_cns,
            c.no_cidadao,
            c.dt_nascimento,
            COALESCE(NULLIF(TRIM(v.ds_logradouro_domicilio), ''), NULLIF(TRIM(v.ds_logradouro_tb_cidadao), ''), c.ds_logradouro) as logradouro,
            COALESCE(NULLIF(TRIM(v.nu_numero_domicilio), ''), NULLIF(TRIM(v.nu_numero_tb_cidadao), ''), c.nu_numero) as numero,
            COALESCE(NULLIF(TRIM(v.ds_complemento_domicilio), ''), NULLIF(TRIM(v.ds_complemento_tb_cidadao), ''), c.ds_complemento) as complemento,
            COALESCE(NULLIF(TRIM(v.no_bairro_domicilio), ''), NULLIF(TRIM(v.no_bairro_tb_cidadao), ''), c.no_bairro) as bairro,
            COALESCE(NULLIF(TRIM(v.ds_cep_domicilio), ''), NULLIF(TRIM(v.ds_cep_tb_cidadao), ''), c.ds_cep) as cep,
            COALESCE(NULLIF(TRIM(v.no_municipio_domicilio), ''), NULLIF(TRIM(v.no_municipio_tb_cidadao), ''), 'Guapé') as municipio,
            c.ds_ponto_referencia as ponto_ref,
            COALESCE(NULLIF(TRIM(v.nu_micro_area_domicilio), ''), NULLIF(TRIM(v.nu_micro_area_tb_cidadao), ''), c.nu_micro_area) as microarea
        FROM tb_cidadao c
        LEFT JOIN tb_acomp_cidadaos_vinculados v ON v.co_cidadao = c.co_seq_cidadao
        WHERE COALESCE(c.st_ativo::text, '1') IN ('1', 'true', 't', 'TRUE')
          AND (
              COALESCE(NULLIF(TRIM(v.ds_logradouro_domicilio), ''), NULLIF(TRIM(v.ds_logradouro_tb_cidadao), ''), c.ds_logradouro) IS NOT NULL
              OR COALESCE(NULLIF(TRIM(v.no_bairro_domicilio), ''), NULLIF(TRIM(v.no_bairro_tb_cidadao), ''), c.no_bairro) IS NOT NULL
          )
        ORDER BY c.co_seq_cidadao DESC, (v.co_cidadao IS NOT NULL) DESC
    """)

    with pec_engine.connect() as pec_conn:
        pec_rows = pec_conn.execute(query).mappings().all()

    pec_by_co_seq: dict[int, dict] = {}
    pec_by_cpf: dict[str, dict] = {}
    pec_by_cns: dict[str, dict] = {}
    pec_by_nn: dict[tuple[str, str], dict] = {}

    for r in pec_rows:
        cid = int(r["co_seq_cidadao"])
        pec_by_co_seq[cid] = r
        cpf = limpar_cpf(r["nu_cpf"])
        if cpf:
            pec_by_cpf[cpf] = r
        cns = limpar_cns(r["nu_cns"])
        if cns:
            pec_by_cns[cns] = r
        nome_n = normalizar_nome(r["no_cidadao"])
        dt_s = str(r["dt_nascimento"]) if r["dt_nascimento"] else ""
        if nome_n and dt_s:
            pec_by_nn[(nome_n, dt_s)] = r

    pacientes = db.exec(select(Paciente)).all()
    total_analisados = len(pacientes)
    total_atualizados = 0
    agora = datetime.utcnow()

    for p in pacientes:
        m: Optional[dict] = None
        if p.co_seq_cidadao_pec and p.co_seq_cidadao_pec in pec_by_co_seq:
            m = pec_by_co_seq[p.co_seq_cidadao_pec]
        if not m and p.cpf:
            cpf_p = limpar_cpf(p.cpf)
            if cpf_p and cpf_p in pec_by_cpf:
                m = pec_by_cpf[cpf_p]
        if not m and p.cns:
            cns_p = limpar_cns(p.cns)
            if cns_p and cns_p in pec_by_cns:
                m = pec_by_cns[cns_p]
        if not m and p.nome and p.nascimento:
            chave = (normalizar_nome(p.nome), str(p.nascimento))
            if chave in pec_by_nn:
                m = pec_by_nn[chave]

        if m:
            alterou = False
            logr = (m["logradouro"] or "").strip()
            num = (m["numero"] or "").strip()
            compl = (m["complemento"] or "").strip()
            bairro = (m["bairro"] or "").strip()
            cep = (m["cep"] or "").strip()
            muni = (m["municipio"] or "Guapé").strip()
            ponto = (m["ponto_ref"] or "").strip()
            micro = (m["microarea"] or "").strip()

            if logr and p.endereco != logr[:255]:
                p.endereco = logr[:255]
                alterou = True
            if num and p.endereco_numero != num[:20]:
                p.endereco_numero = num[:20]
                alterou = True
            if compl and p.complemento != compl[:100]:
                p.complemento = compl[:100]
                alterou = True
            if bairro and p.bairro != bairro[:100]:
                p.bairro = bairro[:100]
                alterou = True
            if cep and p.cep != cep[:10]:
                p.cep = cep[:10]
                alterou = True
            if muni and (not p.municipio or p.municipio != muni[:100]):
                p.municipio = muni[:100]
                alterou = True
            if ponto and not p.ponto_referencia:
                p.ponto_referencia = ponto[:150]
                alterou = True
            if micro and not p.microarea:
                p.microarea = micro[:20]
                alterou = True
            if not p.co_seq_cidadao_pec and m["co_seq_cidadao"]:
                p.co_seq_cidadao_pec = int(m["co_seq_cidadao"])
                alterou = True

            if alterou:
                p.updated_at = agora
                db.add(p)
                total_atualizados += 1

    db.commit()
    return {
        "ok": True,
        "total_analisados": total_analisados,
        "total_atualizados": total_atualizados,
        "mensagem": f"{total_atualizados} cadastros de pacientes atualizados com seus endereços do e-SUS PEC!",
    }
