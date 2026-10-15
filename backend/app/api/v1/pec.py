from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlmodel import Session, select

from app.core.deps import get_current_user_senha_ok as get_current_user, get_db
from app.services.permissoes import need_perm
from app.services.pec import (
    EQUIPE_RE,
    PERIODO_RE,
    UBS_RE,
    resolver_fichas,
    resolver_graficos,
    resolver_painel,
    validar_params,
)


router = APIRouter()


def need_aps():
    return need_perm("aps")


def _no_store(res: Response):
    res.headers["Cache-Control"] = "no-store"


@router.get("/painel")
def painel(
    res: Response,
    periodo: str = Query(default=""),
    ubs: str = Query(default=""),
    equipe: str = Query(default=""),
    fonte: str = Query(default=""),
    _=Depends(need_aps()),
):
    _no_store(res)
    if fonte and fonte not in ("postgres", "files", "mock", "auto"):
        raise HTTPException(400, "fonte inválida")
    validar_params(periodo, ubs, equipe)
    out = resolver_painel(periodo, ubs, equipe)
    if fonte:
        # força fonte p/ debug sem quebrar whitelist
        out = {**out, "fonte_solicitada": fonte}
    try:
        from app.services.pec import dimensoes as resolver_dim

        dim = resolver_dim()
        out = {**out, "periodos": dim.get("periodos", []), "equipes": dim.get("equipes", [])}
    except Exception:
        pass
    return out


@router.get("/fichas")
def fichas(res: Response, _=Depends(need_aps())):
    _no_store(res)
    return resolver_fichas()


@router.get("/ubs")
def ubs(res: Response, db: Session = Depends(get_db), _=Depends(need_aps())):
    _no_store(res)
    # Agregado por UBS — sem PII.
    try:
        from sqlalchemy import text

        import os

        from app.services.pec import _pg

        conn, _ = _pg()
        if conn is not None:
            try:
                rows = conn.execute(
                    text("SELECT ubs_codigo, COUNT(*) FROM pec_cadastro_individual WHERE valido GROUP BY 1")
                ).all()
                return {"fonte": "postgres", "lgpd_ok": True, "ubs": [{"codigo": r[0], "cadastros_validos": int(r[1])} for r in rows]}
            finally:
                try:
                    conn.close()
                except Exception:
                    pass
    except Exception:
        pass
    return {
        "fonte": "mock", "lgpd_ok": True,
        "ubs": [
            {"codigo": "UBS-CENTRO", "cadastros_validos": 980},
            {"codigo": "UBS-RURAL", "cadastros_validos": 640},
        ],
    }


    return {
        "fonte": "mock", "lgpd_ok": True,
        "ubs": [
            {"codigo": "UBS-CENTRO", "cnes": "2211221", "cadastros_validos": 980, "equipe_tipo": "eSF"},
            {"codigo": "UBS-RURAL", "cnes": "2211332", "cadastros_validos": 640, "equipe_tipo": "eSF"},
        ],
    }


@router.get("/dimensoes")
def dimensoes(res: Response, _=Depends(need_aps())):
    _no_store(res)
    from app.services.pec import dimensoes as resolver_dim

    return resolver_dim()


@router.get("/indicador/{codigo}")
def indicador_detalhe(
    codigo: str,
    res: Response,
    ubs: str = Query(default=""),
    equipe: str = Query(default=""),
    _=Depends(need_aps()),
):
    _no_store(res)
    validar_params("", ubs, equipe)
    from app.services.pec import evolucao_indicador

    return evolucao_indicador(codigo, ubs, equipe)


@router.get("/graficos")
def graficos(res: Response, _=Depends(need_aps())):
    _no_store(res)
    out = resolver_graficos()
    try:
        from app.services.pec import dimensoes as resolver_dim

        dim = resolver_dim()
        out = {**out, "periodos": dim.get("periodos", []), "equipes": dim.get("equipes", [])}
    except Exception:
        pass
    return out


@router.get("/relatorio")
def relatorio(
    res: Response,
    periodo: str = Query(default=""),
    ubs: str = Query(default=""),
    equipe: str = Query(default=""),
    _=Depends(need_aps()),
):
    _no_store(res)
    validar_params(periodo, ubs, equipe)
    painel = resolver_painel(periodo, ubs, equipe)
    fichas = resolver_fichas()
    linhas = ["codigo;bloco;num;den;perc;meta;status"]
    for k in painel.get("kpis", []):
        linhas.append(f"{k['codigo']};{k.get('bloco','')};{k['num']};{k['den']};{k['perc']};{k['meta']};{k.get('status','')}")
    linhas.append("")
    linhas.append("ficha_uuid;motivo")
    for f in fichas.get("inconsistentes", []):
        linhas.append(f"{f['ficha_uuid']};{f['motivo']}")
    return {
        "fonte": painel.get("fonte", "mock"),
        "lgpd_ok": True,
        "modelo": "novo-cofinanciamento-2024",
        "periodo": periodo or painel.get("periodo", ""),
        "resumo_repasse": painel.get("resumo_repasse", {}),
        "csv": "\n".join(linhas),
    }


# Reexport p/ checagem whitelist
__all__ = ["router", "PERIODO_RE", "UBS_RE", "EQUIPE_RE"]
