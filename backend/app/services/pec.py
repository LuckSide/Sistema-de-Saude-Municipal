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
    "EMULTI_INTERPROF": ["Agendar PTS e consultas compartilhadas semanais", "Registrar ação interprofissional com 2+ categorias", "Pactuar metas interprofissionais em reunião de equipe"],
}

_cache: dict = {"ts": 0.0, "fonte": "", "dados": None}
CACHE_TTL = 120

# Cache curto da config de integração (evita 1 query por request no painel)
_cfg_cache: dict = {"ts": 0.0, "fonte": "", "dsn": ""}
_CFG_TTL = 60

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
                dsn = (c.pec_database_url or "").strip()
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


def dimensoes() -> dict:
    """Períodos + equipes + UBS p/ dropdowns. Postgres quando há, senão mock."""
    f = fonte_ativa()
    if f in ("postgres", "auto"):
        conn, _ = _pg()
        if conn is not None:
            try:
                from sqlalchemy import text

                pers = [r[0] for r in conn.execute(
                    text("SELECT DISTINCT periodo FROM vw_painel_aps_novo ORDER BY 1")).all()]
                eqs = [{"codigo": r[0], "tipo": r[1] or "", "ubs": r[2] or ""} for r in conn.execute(
                    text("SELECT DISTINCT equipe_codigo, MAX(equipe_tipo), MAX(ubs_cnes) FROM vw_ubs_equipes GROUP BY 1 ORDER BY 1")).all()]
                if pers or eqs:
                    return {
                        "fonte": "postgres", "lgpd_ok": True,
                        "periodos": pers or PERIODOS_MOCK,
                        "equipes": eqs or EQUIPES_MOCK,
                        "ubs": UBS_MOCK,
                    }
            except Exception:
                pass
            finally:
                try:
                    conn.close()
                except Exception:
                    pass
    if f in ("files", "auto"):
        p = DATA_DIR / "dimensoes.json"
        if p.exists():
            return {**json.loads(p.read_text(encoding="utf-8")), "fonte": "files"}
    return {"fonte": "mock", "lgpd_ok": True, "periodos": PERIODOS_MOCK, "equipes": EQUIPES_MOCK, "ubs": UBS_MOCK}


def evolucao_indicador(codigo: str, ubs: str = "", equipe: str = "") -> dict:
    """Série temporal de 1 indicador + ações MS. Agregado, sem PII."""
    codigo = (codigo or "").strip().upper()
    if codigo not in META:
        from fastapi import HTTPException

        raise HTTPException(400, "indicador inválido")
    f = fonte_ativa()
    serie: list[dict] = []
    fonte = "mock"
    if f in ("postgres", "auto"):
        conn, _ = _pg()
        if conn is not None:
            try:
                from sqlalchemy import text

                rows = conn.execute(text("""
                    SELECT periodo, SUM(num) AS num, SUM(den) AS den
                    FROM vw_painel_aps_novo WHERE indicador = :c
                      AND (:u = '' OR ubs_cnes = :u) AND (:e = '' OR equipe_codigo = :e)
                    GROUP BY 1 ORDER BY 1 LIMIT 12
                """), {"c": codigo, "u": ubs, "e": equipe}).all()
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
                serie = []
            finally:
                try:
                    conn.close()
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


def postgres_painel(periodo: str, ubs: str, equipe: str) -> dict | None:
    conn, _ = _pg()
    if conn is None:
        return None
    try:
        # Agregados da view unificada — sem PII, consulta parametrizada.
        sql = """
        SELECT indicador, SUM(num) AS num, SUM(den) AS den
        FROM vw_painel_aps_novo
        WHERE (:p = '' OR periodo = :p) AND (:u = '' OR ubs_cnes = :u)
          AND (:e = '' OR equipe_codigo = :e)
        GROUP BY 1
        """
        from sqlalchemy import text

        rows = conn.execute(text(sql), {"p": periodo, "u": ubs, "e": equipe}).all()
        if not rows:
            return None
        kpis = []
        for cod, num, den in rows:
            cod = str(cod)
            kpis.append(_kpi(cod, nome_de(cod), bloco_de(cod), int(num or 0), int(den or 0)))
        # Completa indicadores ausentes com zero p/ painel estável
        vistos = {k["codigo"] for k in kpis}
        for cod, nome, bloco, _, _ in INDICADORES:
            if cod not in vistos:
                kpis.append(_kpi(cod, nome, bloco, 0, 0))
        kpis.sort(key=lambda k: [c for c, _, _, _, _ in INDICADORES].index(k["codigo"]))
        ating = sum(1 for k in kpis if k["status"] == "atingido")
        return {
            "fonte": "postgres", "lgpd_ok": True,
            "periodo": periodo or "geral",
            "modelo": "novo-cofinanciamento-2024",
            "resumo_repasse": {
                "atingidos": ating, "total": len(kpis),
                "status_geral": "atingido" if ating == len(kpis) else ("alerta" if ating >= len(kpis) * 0.6 else "risco_perda"),
            },
            "kpis": kpis,
        }
    except Exception:
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass


def resolver_painel(periodo: str = "", ubs: str = "", equipe: str = "") -> dict:
    f = fonte_ativa()
    now = time.time()
    if f != "mock" and _cache["dados"] and now - _cache["ts"] < CACHE_TTL:
        return _cache["dados"]
    out: dict | None = None
    if f == "postgres":
        out = postgres_painel(periodo, ubs, equipe) or {**mock_painel(), "fonte": "mock"}
    elif f == "files":
        out = files_painel() or {**mock_painel(), "fonte": "mock"}
    elif f == "mock":
        out = mock_painel()
    else:  # auto
        out = postgres_painel(periodo, ubs, equipe) or files_painel() or mock_painel()
    _cache.update(ts=now, fonte=out.get("fonte", ""), dados=out)
    return out


def resolver_fichas() -> dict:
    f = fonte_ativa()
    if f in ("postgres", "auto"):
        conn, _ = _pg()
        if conn is not None:
            try:
                from sqlalchemy import text

                rows = conn.execute(
                    text("SELECT ficha_uuid, motivo FROM vw_graficos_fichas_inconsistentes")
                ).all()
                funil = conn.execute(text("SELECT etapa, total FROM vw_graficos_funil_cadastro")).all()
                return {
                    "fonte": "postgres", "lgpd_ok": True,
                    "inconsistentes": [{"ficha_uuid": r[0], "motivo": r[1]} for r in rows],
                    "funil": [{"etapa": r[0], "total": int(r[1])} for r in funil],
                }
            except Exception:
                pass
            finally:
                try:
                    conn.close()
                except Exception:
                    pass
    if f in ("files", "auto"):
        p = DATA_DIR / "fichas.json"
        if p.exists():
            return {**json.loads(p.read_text(encoding="utf-8")), "fonte": "files"}
    return mock_fichas()


def resolver_graficos() -> dict:
    fichas = resolver_fichas()
    g = mock_graficos()
    g["funil"] = fichas.get("funil", g["funil"])
    g["inconsistentes"] = fichas.get("inconsistentes", g["inconsistentes"])
    g["fonte"] = fichas.get("fonte", "mock")
    return g
