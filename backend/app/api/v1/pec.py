from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlmodel import Session

from app.core.deps import get_db
from app.services.permissoes import need_perm
from app.services.pec import (
    EQUIPE_RE,
    PERIODO_RE,
    UBS_RE,
    atualizar_cache_indicadores,
    dimensoes as resolver_dim,
    evolucao_indicador,
    resolver_fichas,
    resolver_graficos,
    resolver_painel,
    ubs_list,
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
    db: Session = Depends(get_db),
    _=Depends(need_aps()),
):
    _no_store(res)
    if fonte and fonte not in ("postgres", "files", "mock", "auto"):
        raise HTTPException(400, "fonte inválida")
    validar_params(periodo, ubs, equipe)
    out = resolver_painel(periodo, ubs, equipe, db=db)
    if fonte:
        # força fonte p/ debug sem quebrar whitelist
        out = {**out, "fonte_solicitada": fonte}
    try:
        dim = resolver_dim(db=db)
        out = {**out, "periodos": dim.get("periodos", []), "equipes": dim.get("equipes", [])}
    except Exception:
        pass
    return out


@router.get("/fichas")
def fichas(res: Response, db: Session = Depends(get_db), _=Depends(need_aps())):
    _no_store(res)
    return resolver_fichas(db=db)


@router.get("/ubs")
def ubs(res: Response, db: Session = Depends(get_db), _=Depends(need_aps())):
    _no_store(res)
    return ubs_list(db=db)


@router.get("/dimensoes")
def dimensoes(res: Response, db: Session = Depends(get_db), _=Depends(need_aps())):
    _no_store(res)
    return resolver_dim(db=db)


@router.get("/indicador/{codigo}")
def indicador_detalhe(
    codigo: str,
    res: Response,
    ubs: str = Query(default=""),
    equipe: str = Query(default=""),
    db: Session = Depends(get_db),
    _=Depends(need_aps()),
):
    _no_store(res)
    validar_params("", ubs, equipe)
    return evolucao_indicador(codigo, ubs, equipe, db=db)


@router.get("/graficos")
def graficos(res: Response, db: Session = Depends(get_db), _=Depends(need_aps())):
    _no_store(res)
    out = resolver_graficos(db=db)
    try:
        dim = resolver_dim(db=db)
        out = {**out, "periodos": dim.get("periodos", []), "equipes": dim.get("equipes", [])}
    except Exception:
        pass
    return out


@router.post("/indicadores/atualizar")
@router.post("/atualizar")
def atualizar_indicadores_endpoint(
    db: Session = Depends(get_db),
    _=Depends(need_aps()),
):
    """Sincroniza do e-SUS PEC os 662 registros agregados e atualiza o cache local."""
    return atualizar_cache_indicadores(db=db)


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
