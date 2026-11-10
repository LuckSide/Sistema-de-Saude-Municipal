"""Adaptador fonte DW PEC — Novo Cofinanciamento APS.

Portarias GM/MS 3.493/2024 + 6.907/2025. 15 indicadores, 3 blocos.
postgres: SELECT parametrizado readonly. auto: postgres → files → mock.
"""

import csv
import json
import os
import re
import time
from pathlib import Path

PERIODO_RE = re.compile(r"^\d{4}-(T[1-4]|Q[1-3]|0[1-9]|1[0-2])$")
UBS_RE = re.compile(r"^[A-Za-z0-9._-]{1,40}$")
EQUIPE_RE = re.compile(r"^[A-Za-z0-9._-]{1,40}$")

# codigo, nome, bloco, meta %, tipo_meta (quanto_maior_melhor | quanto_menor_melhor)
INDICADORES: list[tuple] = [
    # Indicadores Oficiais Previne Brasil (e-SUS DW)
    ("CITO", "Citopatológico em 25–64 anos", "cuidado", 40.0, "maior"),
    ("DM", "Diabéticos com Hb glicada solicitada", "cuidado", 50.0, "maior"),
    ("HAS", "Hipertensos com PA controlada", "cuidado", 50.0, "maior"),
    ("PRE1", "Gestantes com pré-natal no 1º trimestre", "cuidado", 60.0, "maior"),
    ("PRE2", "Gestantes com 6+ consultas de pré-natal", "cuidado", 60.0, "maior"),
    ("PRE3", "Gestantes com atendimento odontológico", "bucal", 60.0, "maior"),
    ("VAC", "Vacina em dia em <1 ano", "cuidado", 95.0, "maior"),
    # Indicadores Portaria 3.493/2024 (Novo Cofinanciamento APS)
    ("ACESSO", "Mais acesso na APS", "cuidado", 60.0, "maior"),
    ("INFANTIL", "Desenvolvimento infantil", "cuidado", 60.0, "maior"),
    ("GESTANTE", "Gestante e puerpério (11 ações)", "cuidado", 60.0, "maior"),
    ("DIABETES", "Cuidado diabetes", "cuidado", 60.0, "maior"),
    ("HIPERTENSAO", "Cuidado hipertensão", "cuidado", 60.0, "maior"),
    ("IDOSO", "Cuidado pessoa idosa", "cuidado", 60.0, "maior"),
    ("CANCER", "Rastreio câncer colo/mama", "cuidado", 60.0, "maior"),
    ("SB_PRIM_CONS", "1ª consulta odonto programada", "bucal", 40.0, "maior"),
    ("SB_TRAT_CONCL", "Tratamento odonto concluído", "bucal", 40.0, "maior"),
    ("SB_EXODONTIA", "Taxa exodontias", "bucal", 10.0, "menor"),
    ("SB_ESCOVACAO", "Escovação supervisionada", "bucal", 40.0, "maior"),
    ("SB_PREVENTIVO", "Procedimentos preventivos", "bucal", 40.0, "maior"),
    ("SB_ART", "Tratamento restaurador atraumático", "bucal", 20.0, "maior"),
    ("EMULTI_MEDIA", "Média atendimentos eMulti", "emulti", 60.0, "maior"),
    ("EMULTI_INTERPROF", "Ações interprofissionais eMulti", "emulti", 60.0, "maior"),
]

META = {c: m for c, _, _, m, _ in INDICADORES}
TIPO = {c: t for c, _, _, _, t in INDICADORES}

PERIODOS_MOCK = ["2025-T2", "2025-T3", "2025-T4", "2026-T1"]

EQUIPES_MOCK = [
    {"codigo": "eSF-01", "tipo": "eSF", "ubs": "UBS-CENTRO"},
    {"codigo": "eSF-02", "tipo": "eSF", "ubs": "UBS-CENTRO"},
    {"codigo": "eSF-03", "tipo": "eSF", "ubs": "UBS-RURAL"},
    {"codigo": "eSB-01", "tipo": "eSB", "ubs": "UBS-CENTRO"},
    {"codigo": "eSB-02", "tipo": "eSB", "ubs": "UBS-RURAL"},
]

UBS_MOCK = [
    {"codigo": "UBS-CENTRO", "cnes": "2211221", "cadastros_validos": 980, "equipe_tipo": "eSF"},
    {"codigo": "UBS-RURAL", "cnes": "2211332", "cadastros_validos": 640, "equipe_tipo": "eSF"},
]

# Ações recomendadas MS por indicador (drill-down).
ACOES: dict[str, list[str]] = {
    "CITO": ["Listar mulheres 25-64 sem citopatológico há 3 anos", "Mutirão de coleta + controle de lâminas enviadas", "Busca ativa e coleta estendida."],
    "DM": ["Solicitar HbA1c semestral e registrar resultado no PEC", "Estratificar risco e priorizar descompensados", "Grupo operativo + renovação de receita."],
    "HAS": ["Aferir PA em toda consulta e registrar no PEC", "Busca ativa de hipertensos sem consulta há 6 meses", "Entrega programada de medicação."],
    "PRE1": ["Captação precoce até 12 semanas com teste rápido", "Busca ativa de faltosas em 48h via ACS", "Checar pré-natal a cada consulta."],
    "PRE2": ["Garantir calendário mínimo de 6 consultas", "Agendar retorno antes de sair da UBS", "Acompanhar cartão da gestante."],
    "PRE3": ["Encaminhar gestante para avaliação odontológica", "Tratamento preventivo e periodontal", "Registrar consulta odonto no PEC."],
    "VAC": ["Busca ativa de faltosos na vacinação via ACS", "Monitorar cobertura de pentavalente e VIP", "Atualizar caderneta de vacinação."],
    "ACESSO": ["Ampliar agenda com vagas de demanda espontânea diárias", "Monitorar absenteísmo e fazer reconvocação em 48h", "Registrar todo atendimento no PEC/e-SUS no mesmo dia"],
    "INFANTIL": ["Busca ativa de faltosos na puericultura via ACS", "Atualizar caderneta e antropometria a cada consulta", "Agendar retorno antes da família sair da UBS"],
    "GESTANTE": ["Captação precoce até 12 semanas com teste rápido", "Busca ativa de faltosas em 48h via ACS/visita", "Checar as 11 ações do pré-natal a cada consulta"],
    "DIABETES": ["Solicitar HbA1c semestral e registrar resultado no PEC", "Estratificar risco e priorizar descompensados", "Grupo operativo + renovação de receita programada"],
    "HIPERTENSAO": ["Aferir PA em toda consulta e registrar no PEC", "Busca ativa de hipertensos sem consulta há 6 meses", "Entrega programada de medicação + retorno agendado"],
    "IDOSO": ["Aplicar avaliação multidimensional anual", "Atualizar calendário vacinal e rastreio de quedas", "Priorizar idosos frágeis na visita domiciliar"],
    "CANCER": ["Listar mulheres 25-64 sem citopatológico há 3 anos", "Mutirão de coleta + controle de lâminas enviadas", "Rastrear mamografia 50-69 e registrar solicitação"],
    "SB_PRIM_CONS": ["Oferta programada por família/território via ACS", "Zerar fila de espera com agenda por microárea", "Registrar primeira consulta programática no PEC"],
    "SB_TRAT_CONCL": ["Plano de tratamento com retorno já agendado", "Busca ativa de abandono de tratamento", "Fechar TC no sistema na alta, sem pendência aberta"],
    "SB_EXODONTIA": ["Priorizar endodontia/restauração antes de extrair", "Revisar indicação de toda exodontia em reunião clínica", "Monitorar taxa mensal por dentista"],
    "SB_ESCOVACAO": ["Pactuar calendário com escolas do território", "Registrar escovação supervisionada por turma", "Repor kits e flúor nas UBS participantes"],
    "SB_PREVENTIVO": ["Aplicação de flúor e selantes em grupos de risco", "Registrar cada procedimento preventivo no PEC", "Integrar prevenção às consultas de rotina"],
    "SB_ART": ["Capacitar equipe em ART e montar kits", "Triar lesões indicadas em escolares", "Registrar ART separado de restauração convencional"],
    "EMULTI_MEDIA": ["Distribuir atendimentos por pessoa, sem concentrar", "Registrar todos os atendimentos compartilhados", "Revisar fila e redistribuir entre profissionais"],
    "EMULTI_INTERPROF": ["Ações interprofissionais eMulti", "Registrar ação interprofissional com 2+ categorias", "Pactuar metas interprofissionais em reunião de equipe"],
}

_cache: dict = {"ts": 0.0, "fonte": "", "dados": None}
CACHE_TTL = 120

# Cache curto da config de integração (evita 1 query por request no painel)
_cfg_cache: dict = {"ts": 0.0, "fonte": "", "dsn": ""}
_CFG_TTL = 60


def limpar_cache():
    global _cache, _cfg_cache
    _cache = {"ts": 0.0, "fonte": "", "dados": None}
    _cfg_cache = {"ts": 0.0, "fonte": "", "dsn": ""}

DATA_DIR = Path(__file__).parent.parent / "data" / "pec"


def _integracao_db() -> tuple[str, str]:
    """(fonte, dsn) da tela Integrações (banco). Cache 60s. Falha → ("", "")."""
    agora = time.time()
    if agora - _cfg_cache["ts"] < _CFG_TTL and _cfg_cache["ts"] > 0:
        return _cfg_cache["fonte"], _cfg_cache["dsn"]
    fonte, dsn = "", ""
    try:
        from sqlmodel import Session as S
        from sqlmodel import select as _select

        from app.db.session import engine as _eng
        from app.models.integracoes import IntegrationSettings as _Cfg

        with S(_eng) as s:
            c = s.exec(_select(_Cfg).where(_Cfg.id == 1)).first()
            if c:
                fonte = (c.pec_fonte or "").strip()
                if c.pec_ssh_habilitado and (c.pec_ssh_host or "").strip():
                    from app.services.pec_tunnel import garantir_tunel_db

                    ativo, dsn_tunel = garantir_tunel_db(c)
                    if ativo and dsn_tunel:
                        dsn = dsn_tunel
                elif (c.pec_database_url or "").strip():
                    dsn = c.pec_database_url.strip()
                elif (c.pec_usuario or "").strip() and (c.pec_senha or "").strip() and (c.pec_servidor_url or "").strip():
                    host = c.pec_servidor_url.replace("http://", "").replace("https://", "").split(":")[0]
                    banco = getattr(c, "pec_banco_nome", "esus") or "esus"
                    dsn = f"postgresql://{c.pec_usuario}:{c.pec_senha}@{host}:5432/{banco}"
    except Exception:
        fonte, dsn = "", ""
    _cfg_cache.update({"ts": agora, "fonte": fonte, "dsn": dsn})
    return fonte, dsn


def fonte_ativa() -> str:
    # Tela Integrações (banco) prevalece quando preenchida; senão env.
    f_db, _ = _integracao_db()
    if f_db in ("postgres", "files", "mock", "auto"):
        return f_db
    f = os.getenv("PEC_FONTE", "auto").strip().lower()
    return f if f in ("postgres", "files", "mock", "auto") else "auto"


def validar_params(periodo: str = "", ubs: str = "", equipe: str = "") -> None:
    from fastapi import HTTPException

    if periodo and not PERIODO_RE.match(periodo):
        raise HTTPException(400, "periodo inválido (AAAA-Tn/Qn/MM)")
    if ubs and not UBS_RE.match(ubs):
        raise HTTPException(400, "ubs inválida (use CNES)")
    if equipe and not EQUIPE_RE.match(equipe):
        raise HTTPException(400, "equipe inválida (eSF/eSB)")


def status_repasse(codigo: str, perc: float) -> str:
    """Atingido ≥ meta · Alerta dentro de 10pp abaixo · Risco abaixo disso.

    Exodontia inverte: menor é melhor.
    """
    meta = META.get(codigo, 60.0)
    if TIPO.get(codigo) == "menor":
        if perc <= meta:
            return "atingido"
        if perc <= meta + 10:
            return "alerta"
        return "risco_perda"
    if perc >= meta:
        return "atingido"
    if perc >= meta - 10:
        return "alerta"
    return "risco_perda"


def _kpi(codigo: str, nome: str, bloco: str, num: int, den: int) -> dict:
    perc = round(100.0 * num / den, 1) if den else 0.0
    return {
        "codigo": codigo, "nome": nome, "bloco": bloco,
        "num": num, "den": den, "perc": perc,
        "meta": META.get(codigo, 60.0),
        "status": status_repasse(codigo, perc),
    }


def bloco_de(codigo: str) -> str:
    for c, _, b, _, _ in INDICADORES:
        if c == codigo:
            return b
    return "cuidado"


def nome_de(codigo: str) -> str:
    for c, n, _, _, _ in INDICADORES:
        if c == codigo:
            return n
    return codigo


def mock_painel() -> dict:
    base = [
        ("ACESSO", 620, 900), ("INFANTIL", 95, 140), ("GESTANTE", 30, 48),
        ("DIABETES", 150, 300), ("HIPERTENSAO", 210, 400), ("IDOSO", 180, 320),
        ("CANCER", 240, 500), ("SB_PRIM_CONS", 300, 800), ("SB_TRAT_CONCL", 180, 400),
        ("SB_EXODONTIA", 60, 400), ("SB_ESCOVACAO", 500, 1200),
        ("SB_PREVENTIVO", 350, 800), ("SB_ART", 60, 400),
        ("EMULTI_MEDIA", 420, 700), ("EMULTI_INTERPROF", 90, 160),
    ]
    kpis = [_kpi(c, nome_de(c), bloco_de(c), n, d) for c, n, d in base]
    ating = sum(1 for k in kpis if k["status"] == "atingido")
    return {
        "fonte": "mock", "lgpd_ok": True, "periodo": "2026-T1",
        "modelo": "novo-cofinanciamento-2024",
        "resumo_repasse": {
            "atingidos": ating, "total": len(kpis),
            "status_geral": "atingido" if ating == len(kpis) else ("alerta" if ating >= len(kpis) * 0.6 else "risco_perda"),
        },
        "kpis": kpis,
    }


def mock_fichas() -> dict:
    return {
        "fonte": "mock",
        "lgpd_ok": True,
        "inconsistentes": [
            {"ficha_uuid": "9f1a2b3c-mock-0001", "motivo": "CNS dígito inválido"},
            {"ficha_uuid": "9f1a2b3c-mock-0002", "motivo": "Cadastro duplicado"},
        ],
        "funil": [
            {"etapa": "captados", "total": 1200},
            {"etapa": "validos", "total": 1050},
            {"etapa": "ativos", "total": 980},
        ],
    }


def mock_graficos() -> dict:
    serie = []
    base = {
        "DIABETES": [(290, 130), (295, 140), (300, 150)],
        "GESTANTE": [(46, 25), (47, 28), (48, 30)],
    }
    for cod in [c for c, _, _, _, _ in INDICADORES]:
        nums = base.get(cod, [(100, 50), (100, 55), (100, 60)])
        for per, (den, num) in zip(["2025-T3", "2025-T4", "2026-T1"], nums):
            serie.append({
                "periodo": per, "indicador": cod, "num": num, "den": den,
                "perc": round(100.0 * num / den, 1) if den else 0.0,
            })
    serie.sort(key=lambda s: (s["indicador"], s["periodo"]))
    return {
        "fonte": "mock",
        "lgpd_ok": True,
        "serie": serie,
        "evolucao": {c: [s for s in serie if s["indicador"] == c] for c in [c for c, _, _, _, _ in INDICADORES]},
        "periodos": PERIODOS_MOCK,
        "funil": mock_fichas()["funil"],
        "inconsistentes": mock_fichas()["inconsistentes"],
    }


def dimensoes(db=None) -> dict:
    """Períodos + equipes + UBS p/ dropdowns. Carrega do cache local/arquivo instantaneamente (<1ms)."""
    # 1. Arquivo salvo localmente
    p = DATA_DIR / "dimensoes.json"
    if p.exists():
        try:
            dados = json.loads(p.read_text(encoding="utf-8"))
            if dados.get("periodos"):
                return {**dados, "fonte": "postgres", "lgpd_ok": True}
        except Exception:
            pass

    # 2. Banco de dados local (pec_indicadores_cache)
    from sqlalchemy import text
    from sqlmodel import Session as DbSession
    from app.db.session import engine

    should_close_db = False
    if db is None:
        db = DbSession(engine)
        should_close_db = True

    try:
        pers = [r[0] for r in db.execute(text("SELECT DISTINCT periodo FROM pec_indicadores_cache ORDER BY periodo DESC")).all()]
        if pers:
            eqs = [{"codigo": r[0], "tipo": "eSF", "ubs": r[1] or ""} for r in db.execute(
                text("SELECT DISTINCT equipe, MAX(ubs) FROM pec_indicadores_cache WHERE equipe NOT IN ('-', 'todas') GROUP BY equipe ORDER BY equipe")
            ).all()]
            ubs_list = [{"codigo": r[0], "cnes": r[0], "cadastrados_validos": 0, "equipe_tipo": "eSF"} for r in db.execute(
                text("SELECT DISTINCT ubs FROM pec_indicadores_cache WHERE ubs != 'todas' ORDER BY ubs")
            ).all()]
            return {
                "fonte": "postgres", "lgpd_ok": True,
                "periodos": pers,
                "equipes": eqs or EQUIPES_MOCK,
                "ubs": ubs_list or UBS_MOCK,
            }
    except Exception:
        pass
    finally:
        if should_close_db:
            try:
                db.close()
            except Exception:
                pass

    # 3. Fallback mock
    return {"fonte": "mock", "lgpd_ok": True, "periodos": PERIODOS_MOCK, "equipes": EQUIPES_MOCK, "ubs": UBS_MOCK}


def evolucao_indicador(codigo: str, ubs: str = "", equipe: str = "", db=None) -> dict:
    """Série temporal de 1 indicador + ações MS. Carrega do cache local em <2ms."""
    codigo = (codigo or "").strip().upper()
    if codigo not in META:
        from fastapi import HTTPException
        raise HTTPException(400, "indicador inválido")

    from sqlalchemy import text
    from sqlmodel import Session as DbSession
    from app.db.session import engine

    should_close_db = False
    if db is None:
        db = DbSession(engine)
        should_close_db = True

    serie: list[dict] = []
    fonte = "mock"

    mapa_cods = {
        "CANCER": ["CANCER", "CITO"],
        "CITO": ["CITO", "CANCER"],
        "DIABETES": ["DIABETES", "DM"],
        "DM": ["DM", "DIABETES"],
        "HIPERTENSAO": ["HIPERTENSAO", "HAS"],
        "HAS": ["HAS", "HIPERTENSAO"],
        "GESTANTE": ["GESTANTE", "PRE1"],
        "PRE1": ["PRE1", "GESTANTE"],
        "PRE2": ["PRE2", "GESTANTE"],
        "SB_PRIM_CONS": ["SB_PRIM_CONS", "PRE3"],
        "PRE3": ["PRE3", "SB_PRIM_CONS"],
        "INFANTIL": ["INFANTIL", "VAC"],
        "VAC": ["VAC", "INFANTIL"],
        "ACESSO": ["ACESSO", "VAC"],
    }
    cods = tuple(mapa_cods.get(codigo, [codigo]))

    try:
        sql_cache = text("""
            SELECT periodo, SUM(numerador) AS num, SUM(denominador) AS den
            FROM pec_indicadores_cache
            WHERE indicador_id IN :cods
              AND (
                (:u != '' AND :e != '' AND ubs = :u AND equipe = :e)
                OR (:u != '' AND :e = '' AND ubs = :u AND equipe = 'todas')
                OR (:u = '' AND :e != '' AND equipe = :e AND ubs != 'todas')
                OR (:u = '' AND :e = '' AND ubs = 'todas' AND equipe = 'todas')
              )
            GROUP BY periodo ORDER BY periodo LIMIT 12
        """)
        rows = db.execute(sql_cache, {"cods": cods, "u": ubs, "e": equipe}).all()
        if rows:
            fonte = "postgres"
            for per, num, den in rows:
                num, den = int(num or 0), int(den or 0)
                serie.append({
                    "periodo": str(per), "indicador": codigo,
                    "num": num, "den": den,
                    "perc": round(100.0 * num / den, 1) if den else 0.0,
                })
    except Exception:
        pass
    finally:
        if should_close_db:
            try:
                db.close()
            except Exception:
                pass

    if not serie:
        serie = [s for s in mock_graficos()["serie"] if s["indicador"] == codigo]
    if serie:
        ultimo = serie[-1]["perc"]
        st = status_repasse(codigo, ultimo)
    else:
        ultimo, st = 0.0, "risco_perda"
    return {
        "fonte": fonte, "lgpd_ok": True,
        "indicador": codigo, "nome": nome_de(codigo), "bloco": bloco_de(codigo),
        "meta": META[codigo], "perc_atual": ultimo, "status": st,
        "serie": serie,
        "acoes": ACOES.get(codigo, ["Atualizar cadastros via ACS", "Agendar faltosos com prioridade", "Registrar tudo no PEC no mesmo dia"]),
    }


def files_painel() -> dict | None:
    base = DATA_DIR / "painel.json"
    if not base.exists():
        csvp = DATA_DIR / "painel.csv"
        if not csvp.exists():
            return None
        kpis = []
        with csvp.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                cod = row.get("codigo", "")
                num = int(row.get("num", 0) or 0)
                den = int(row.get("den", 0) or 0)
                kpis.append(_kpi(cod, row.get("nome", nome_de(cod)), bloco_de(cod), num, den))
        ating = sum(1 for k in kpis if k["status"] == "atingido")
        return {
            "fonte": "files", "lgpd_ok": True, "periodo": "files",
            "modelo": "novo-cofinanciamento-2024",
            "resumo_repasse": {"atingidos": ating, "total": len(kpis),
                               "status_geral": "atingido" if ating == len(kpis) else "alerta"},
            "kpis": kpis,
        }
    return {**json.loads(base.read_text(encoding="utf-8")), "fonte": "files"}


def _pg() -> tuple:
    """Pool readonly p/ PEC. DSN: banco (tela Integrações) > env. Retorna (connect, dsn) ou (None, '')."""
    try:
        from sqlalchemy import create_engine

        _, dsn_db = _integracao_db()
        dsn = dsn_db or os.getenv("PEC_DATABASE_URL", "").strip()
        if not dsn:
            return None, ""
        eng = create_engine(dsn, pool_size=3, max_overflow=2, pool_pre_ping=True)
        return eng.connect(), dsn
    except Exception:
        return None, ""


def atualizar_cache_indicadores(db=None) -> dict:
    """Atualiza o cache local dos 662 registros de indicadores do e-SUS PEC (vw_painel_previne)
    e as dimensões (períodos, UBSs, equipes, mix).
    Elimina o gargalo de ~8s de consultas remotas via SSH, respondendo em <10ms.
    """
    from datetime import datetime
    from sqlalchemy import text
    from sqlmodel import Session as DbSession
    from app.db.session import engine
    from app.models.integracoes import PecIndicadorCache

    conn, _ = _pg()
    if conn is None:
        return {"ok": False, "mensagem": "Não conectado ao banco do e-SUS PEC."}

    should_close_db = False
    if db is None:
        db = DbSession(engine)
        should_close_db = True

    try:
        # 1. Busca indicadores agregados de vw_painel_previne
        rows_previne = []
        try:
            rows_previne = conn.execute(text("""
                SELECT indicador_id, nome, meta, numerador, denominador, resultado, periodo, ubs, equipe
                FROM vw_painel_previne
            """)).all()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            try:
                rows_previne = conn.execute(text("""
                    SELECT indicador_id, nome, meta, numerador, denominador, 0 as resultado, periodo, ubs, equipe
                    FROM vw_painel_previne
                """)).all()
            except Exception:
                rows_previne = []

        if not rows_previne:
            return {"ok": False, "mensagem": "Nenhum dado retornado de vw_painel_previne no e-SUS PEC."}

        # 2. Busca dimensões (períodos)
        pers = []
        try:
            pers = [r[0] for r in conn.execute(text("SELECT DISTINCT periodo FROM vw_painel_trimestres ORDER BY 1 DESC")).all()]
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
        if not pers and rows_previne:
            pers = sorted(list({str(r[6]) for r in rows_previne if r[6]}), reverse=True)

        # 3. Busca equipes
        eqs = []
        try:
            eqs = [{"codigo": r[0], "tipo": "eSF", "ubs": r[2] or "", "nome": r[1] or r[0]} for r in conn.execute(
                text("SELECT DISTINCT equipe, MAX(equipe_nome), MAX(ubs) FROM vw_painel_cidadao WHERE equipe IS NOT NULL AND equipe NOT IN ('', '-') GROUP BY 1 ORDER BY 1")
            ).all()]
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            eqs = [{"codigo": r[8], "tipo": "eSF", "ubs": r[7] or ""} for r in rows_previne if r[8] and r[8] not in ("-", "todas")]

        # 4. Busca UBSs
        ubs_list_items = []
        try:
            ubs_list_items = [{"codigo": r[1] or r[0], "cnes": r[0], "cadastrados_validos": int(r[2] or 0), "equipe_tipo": "eSF"} for r in conn.execute(
                text("SELECT ubs, nome, cadastrados FROM vw_painel_ubs WHERE ubs != 'todas' ORDER BY nome")
            ).all()]
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            ubs_set = {str(r[7]) for r in rows_previne if r[7] and r[7] != "todas"}
            ubs_list_items = [{"codigo": u, "cnes": u, "cadastrados_validos": 0, "equipe_tipo": "eSF"} for u in sorted(ubs_set)]

        # 5. Busca funil / fichas
        total_cid = 0
        try:
            total_cid = conn.execute(text("SELECT count(*) FROM tb_cidadao")).scalar() or 0
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
        mix_rows = []
        try:
            mix_rows = conn.execute(text("SELECT linha, total FROM vw_painel_mix ORDER BY total DESC")).all()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
        funil = []
        if total_cid:
            funil.append({"etapa": "Cidadãos Cadastrados no e-SUS", "total": int(total_cid)})
        for linha, tot in mix_rows:
            funil.append({"etapa": str(linha), "total": int(tot or 0)})

        # 6. Grava no banco local (tabela pec_indicadores_cache)
        db.execute(text("DELETE FROM pec_indicadores_cache"))
        agora = datetime.utcnow()
        novos = []
        for r in rows_previne:
            ind_id = str(r[0] or "").strip().upper()
            nome_ind = str(r[1] or "")
            meta_ind = int(r[2] or 60)
            num = int(r[3] or 0)
            den = int(r[4] or 0)
            res = int(r[5] or (round(100.0 * num / den) if den else 0))
            per = str(r[6] or "")
            u = str(r[7] or "todas")
            e = str(r[8] or "todas")
            novos.append(PecIndicadorCache(
                indicador_id=ind_id,
                nome=nome_ind,
                meta=meta_ind,
                numerador=num,
                denominador=den,
                resultado=res,
                periodo=per,
                ubs=u,
                equipe=e,
                atualizado_em=agora,
            ))
        db.add_all(novos)
        db.commit()

        # 7. Salva arquivos de cache em DATA_DIR
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            dim_data = {
                "periodos": pers or PERIODOS_MOCK,
                "equipes": eqs or EQUIPES_MOCK,
                "ubs": ubs_list_items or UBS_MOCK,
            }
            (DATA_DIR / "dimensoes.json").write_text(json.dumps(dim_data, ensure_ascii=False, indent=2), encoding="utf-8")
            fichas_data = {
                "inconsistentes": [],
                "funil": funil if len(funil) > 1 else mock_fichas()["funil"],
            }
            (DATA_DIR / "fichas.json").write_text(json.dumps(fichas_data, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass

        # 8. Limpa caches em memória
        limpar_cache()

        return {
            "ok": True,
            "total_indicadores": len(novos),
            "periodos": len(pers),
            "equipes": len(eqs),
            "ubs": len(ubs_list_items),
            "mensagem": f"Cache de indicadores atualizado com sucesso! {len(novos)} registros sincronizados.",
        }

    except Exception as e:
        return {"ok": False, "mensagem": f"Erro ao atualizar cache de indicadores: {e}"}
    finally:
        try:
            conn.close()
        except Exception:
            pass
        if should_close_db:
            try:
                db.close()
            except Exception:
                pass


def postgres_painel(periodo: str, ubs: str, equipe: str, db=None) -> dict | None:
    from sqlalchemy import text
    from sqlmodel import Session as DbSession
    from app.db.session import engine

    should_close_db = False
    if db is None:
        db = DbSession(engine)
        should_close_db = True

    try:
        # Primeiro, verifica se há dados no cache local (pec_indicadores_cache)
        count_local = 0
        try:
            count_local = db.execute(text("SELECT count(*) FROM pec_indicadores_cache")).scalar() or 0
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
            count_local = 0

        # Se cache local estiver vazio, tenta sincronizar uma vez
        if count_local == 0:
            try:
                res_sync = atualizar_cache_indicadores(db)
                if res_sync.get("ok"):
                    count_local = res_sync.get("total_indicadores", 0)
            except Exception:
                pass

        # Se temos dados no cache local, responde DIRETO do banco local (1ms!)
        if count_local > 0:
            per = periodo
            if not per:
                try:
                    r_per = db.execute(text("SELECT periodo FROM pec_indicadores_cache ORDER BY periodo DESC LIMIT 1")).first()
                    per = r_per[0] if r_per else "2026-T1"
                except Exception:
                    per = "2026-T1"

            sql_cache = text("""
                SELECT indicador_id, MAX(nome) as nome, MAX(meta) as meta,
                       SUM(numerador) as num, SUM(denominador) as den
                FROM pec_indicadores_cache
                WHERE periodo = :p
                  AND (
                    (:u != '' AND :e != '' AND ubs = :u AND equipe = :e)
                    OR (:u != '' AND :e = '' AND ubs = :u AND equipe = 'todas')
                    OR (:u = '' AND :e != '' AND equipe = :e AND ubs != 'todas')
                    OR (:u = '' AND :e = '' AND ubs = 'todas' AND equipe = 'todas')
                  )
                GROUP BY indicador_id
                ORDER BY indicador_id
            """)
            rows_previne = db.execute(sql_cache, {"p": per, "u": ubs, "e": equipe}).all()
            if rows_previne:
                kpis = []
                mapa_novos = {
                    "CITO": ("CANCER", "Rastreio câncer colo/mama (Citopatológico 25-64 anos)", "cuidado"),
                    "DM": ("DIABETES", "Cuidado diabetes (HbA1c solicitada)", "cuidado"),
                    "HAS": ("HIPERTENSAO", "Cuidado hipertensão (PA aferida)", "cuidado"),
                    "PRE1": ("GESTANTE", "Gestante (Pré-natal 1º trimestre)", "cuidado"),
                    "PRE2": ("INFANTIL", "Desenvolvimento infantil / Pré-natal 6+", "cuidado"),
                    "PRE3": ("SB_PRIM_CONS", "1ª consulta odonto programada (Gestante)", "bucal"),
                    "VAC": ("ACESSO", "Mais acesso na APS (Vacinas em dia)", "cuidado"),
                }

                vistos_codigos = set()
                for cod, nome_ind, meta_ind, num, den in rows_previne:
                    cod = str(cod).strip().upper()
                    num, den = int(num or 0), int(den or 0)
                    kpis.append(_kpi(cod, nome_ind or nome_de(cod), bloco_de(cod), num, den))
                    vistos_codigos.add(cod)

                    if cod in mapa_novos:
                        c_novo, n_novo, b_novo = mapa_novos[cod]
                        kpis.append(_kpi(c_novo, n_novo, b_novo, num, den))
                        vistos_codigos.add(c_novo)

                for cod, nome, bloco, _, _ in INDICADORES:
                    if cod not in vistos_codigos:
                        kpis.append(_kpi(cod, nome, bloco, 0, 0))

                ating = sum(1 for k in kpis if k["status"] == "atingido")
                return {
                    "fonte": "postgres", "lgpd_ok": True,
                    "periodo": per or "geral",
                    "modelo": "novo-cofinanciamento-2024",
                    "resumo_repasse": {
                        "atingidos": ating, "total": len(kpis),
                        "status_geral": "atingido" if ating == len(kpis) else ("alerta" if ating >= len(kpis) * 0.4 else "risco_perda"),
                    },
                    "kpis": kpis,
                }

        # Fallback remoto se não houver dados no cache
        conn, _ = _pg()
        if conn is None:
            return None
        try:
            sql_previne = text("""
                SELECT indicador_id, MAX(nome) as nome, MAX(meta) as meta,
                       SUM(numerador) as num, SUM(denominador) as den
                FROM vw_painel_previne
                WHERE periodo = :p
                  AND (
                    (:u != '' AND :e != '' AND ubs = :u AND equipe = :e)
                    OR (:u != '' AND :e = '' AND ubs = :u AND equipe = 'todas')
                    OR (:u = '' AND :e != '' AND equipe = :e AND ubs != 'todas')
                    OR (:u = '' AND :e = '' AND ubs = 'todas' AND equipe = 'todas')
                  )
                GROUP BY indicador_id
                ORDER BY indicador_id
            """)
            per = periodo or "2026-T1"
            rows_previne = conn.execute(sql_previne, {"p": per, "u": ubs, "e": equipe}).all()
            if rows_previne:
                kpis = []
                for cod, nome_ind, meta_ind, num, den in rows_previne:
                    cod = str(cod).strip().upper()
                    num, den = int(num or 0), int(den or 0)
                    kpis.append(_kpi(cod, nome_ind or nome_de(cod), bloco_de(cod), num, den))
                ating = sum(1 for k in kpis if k["status"] == "atingido")
                return {
                    "fonte": "postgres", "lgpd_ok": True,
                    "periodo": per,
                    "modelo": "novo-cofinanciamento-2024",
                    "resumo_repasse": {
                        "atingidos": ating, "total": len(kpis),
                        "status_geral": "atingido" if ating == len(kpis) else ("alerta" if ating >= len(kpis) * 0.4 else "risco_perda"),
                    },
                    "kpis": kpis,
                }
        finally:
            try:
                conn.close()
            except Exception:
                pass
        return None
    except Exception:
        return None
    finally:
        if should_close_db:
            try:
                db.close()
            except Exception:
                pass


def resolver_painel(periodo: str = "", ubs: str = "", equipe: str = "", db=None) -> dict:
    f = fonte_ativa()
    now = time.time()
    cache_key = (periodo, ubs, equipe)
    if f != "mock" and _cache["dados"] and now - _cache["ts"] < CACHE_TTL:
        if _cache.get("params") == cache_key:
            return _cache["dados"]
    out: dict | None = None
    if f in ("postgres", "auto"):
        out = postgres_painel(periodo, ubs, equipe, db=db) or files_painel() or mock_painel()
    elif f == "files":
        out = files_painel() or mock_painel()
    else:  # mock
        out = mock_painel()
    _cache.update(ts=now, fonte=out.get("fonte", ""), dados=out, params=cache_key)
    return out


def ubs_list(db=None) -> dict:
    """Lista de UBSs a partir das dimensões cacheadas em <1ms, sem erros SQL."""
    dim = dimensoes(db=db)
    ubs_itens = dim.get("ubs", [])
    if ubs_itens:
        return {"fonte": dim.get("fonte", "postgres"), "lgpd_ok": True, "ubs": ubs_itens}
    return {
        "fonte": "mock", "lgpd_ok": True,
        "ubs": UBS_MOCK,
    }


def resolver_fichas(db=None) -> dict:
    p = DATA_DIR / "fichas.json"
    if p.exists():
        try:
            return {**json.loads(p.read_text(encoding="utf-8")), "fonte": "postgres", "lgpd_ok": True}
        except Exception:
            pass
    return mock_fichas()


def resolver_graficos(db=None) -> dict:
    fichas = resolver_fichas(db=db)
    g = mock_graficos()
    g["funil"] = fichas.get("funil", g["funil"])
    g["inconsistentes"] = fichas.get("inconsistentes", g["inconsistentes"])
    g["fonte"] = fichas.get("fonte", "mock")
    return g
