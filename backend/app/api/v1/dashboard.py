"""Dashboard customizável: layout próprio de cada usuário (atalhos + widgets).

GET/PUT /api/user/dashboard — só o dono (qualquer logado com senha OK).
Refs validadas contra a matriz RBAC + concessão atual do usuário.
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.core.deps import get_current_user_senha_ok as get_user_ok, get_db
from app.models.dashboard_prefs import UserDashboardPrefs
from app.models.user import User
from app.schemas import DashboardIn, DashboardOut, QuadroFiltrosIn, QuadroFiltrosOut
from app.services.permissoes import TODAS_TELAS, tem_tela

router = APIRouter()

# Widgets fixos do catálogo (espelha frontend/src/widgets.tsx)
WIDGETS: dict[str, list[str]] = {
    "resumo-tfd": ["tfd_resumo"],
    "fila-especialidade": ["tfd_exames"],
    "agenda-semana": ["lab_agenda", "lab_vagas"],
    "painel-aps": ["aps"],
}


def validar_items(items, user: User) -> list[dict]:
    vistos: set[str] = set()
    out: list[dict] = []
    for it in items:
        if it.id in vistos:
            raise HTTPException(status_code=400, detail=f"item duplicado: {it.id}")
        vistos.add(it.id)
        if it.tipo == "atalho":
            if it.ref not in TODAS_TELAS:
                raise HTTPException(status_code=400, detail=f"atalho desconhecido: {it.ref}")
            if not tem_tela(user, it.ref):
                raise HTTPException(status_code=403, detail=f"sem permissão p/ atalho {it.ref}")
        else:
            telas = WIDGETS.get(it.ref)
            if not telas:
                raise HTTPException(status_code=400, detail=f"widget desconhecido: {it.ref}")
            if not any(tem_tela(user, t) for t in telas):
                raise HTTPException(status_code=403, detail=f"sem permissão p/ widget {it.ref}")
        out.append({"id": it.id, "tipo": it.tipo, "ref": it.ref})
    return out


def ler_layout(row: UserDashboardPrefs | None) -> list[dict]:
    if not row or not (row.layout or "").strip():
        return []
    try:
        data = json.loads(row.layout)
        return data if isinstance(data, list) else []
    except Exception:
        return []


@router.get("/user/dashboard", response_model=DashboardOut)
def obter_dashboard(db: Session = Depends(get_db), user: User = Depends(get_user_ok)):
    row = db.get(UserDashboardPrefs, user.id)
    return DashboardOut(items=ler_layout(row))


@router.put("/user/dashboard", response_model=DashboardOut)
def salvar_dashboard(data: DashboardIn, db: Session = Depends(get_db), user: User = Depends(get_user_ok)):
    items = validar_items(data.items, user)
    row = db.get(UserDashboardPrefs, user.id)
    if not row:
        row = UserDashboardPrefs(user_id=user.id, layout="[]")
    row.layout = json.dumps(items)
    db.add(row)
    db.commit()
    db.refresh(row)
    return DashboardOut(items=items)


def _ler_quadro(row: UserDashboardPrefs | None) -> dict:
    if not row or not (getattr(row, "quadro_filtros", "") or "").strip():
        return {"data": "", "destino": "", "psf": "", "agrupamento": "destino"}
    try:
        d = json.loads(row.quadro_filtros)
        if not isinstance(d, dict):
            return {"data": "", "destino": "", "psf": "", "agrupamento": "destino"}
        data = str(d.get("data") or "")
        dest = str(d.get("destino") or "")[:120]
        psf = str(d.get("psf") or "")[:150]
        agrup = str(d.get("agrupamento") or "destino")
        import re as _re

        if data and not _re.fullmatch(r"\d{4}-\d{2}-\d{2}", data):
            data = ""
        if agrup not in ("destino", "data"):
            agrup = "destino"
        return {"data": data, "destino": dest, "psf": psf, "agrupamento": agrup}
    except Exception:
        return {"data": "", "destino": "", "psf": "", "agrupamento": "destino"}


@router.get("/user/quadro-viagens", response_model=QuadroFiltrosOut)
def obter_quadro(db: Session = Depends(get_db), user: User = Depends(get_user_ok)):
    return QuadroFiltrosOut(**_ler_quadro(db.get(UserDashboardPrefs, user.id)))


@router.put("/user/quadro-viagens", response_model=QuadroFiltrosOut)
def salvar_quadro(data: QuadroFiltrosIn, db: Session = Depends(get_db), user: User = Depends(get_user_ok)):
    import re as _re

    if data.data and not _re.fullmatch(r"\d{4}-\d{2}-\d{2}", data.data):
        raise HTTPException(status_code=400, detail="Data inválida (AAAA-MM-DD)")
    row = db.get(UserDashboardPrefs, user.id)
    if not row:
        row = UserDashboardPrefs(user_id=user.id, layout="[]")
    row.quadro_filtros = json.dumps({
        "data": data.data,
        "destino": (data.destino or "")[:120],
        "psf": (data.psf or "")[:150],
        "agrupamento": data.agrupamento or "destino",
    })
    db.add(row)
    db.commit()
    return QuadroFiltrosOut(**_ler_quadro(row))
