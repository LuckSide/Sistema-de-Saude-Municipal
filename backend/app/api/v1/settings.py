"""Settings globais (cidade/favicon/título) — leitura pública p/ título, escrita só admin."""

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.core.deps import get_current_user_senha_ok as get_user_ok, get_db
from app.db.session import engine
from app.models.settings import SystemSettings
from app.models.user import User
from app.services.permissoes import need_perm

router = APIRouter()

URL_MARCA_RE = re.compile(r"^(https?://|data:image/)")


def validar_url_marca(v: str, campo: str) -> str:
    v = (v or "").strip()
    if v and not URL_MARCA_RE.match(v):
        raise HTTPException(status_code=400, detail=f"{campo} deve ser https://… ou data:image/…")
    return v


class SettingsOut(BaseModel):
    cidade: str = "Guapé"
    uf: str = "MG"
    subtitulo: str = "Secretaria Municipal"
    brasao_url: str = ""
    icone_url: str = ""


class SettingsIn(BaseModel):
    cidade: str = Field(min_length=2, max_length=80)
    uf: str = Field(default="MG", min_length=2, max_length=2)
    subtitulo: str = Field(default="Secretaria Municipal", max_length=120)
    brasao_url: str = Field(default="", max_length=500)
    icone_url: str = Field(default="", max_length=500)


def get_settings(db: Session) -> SystemSettings:
    obj = db.exec(select(SystemSettings).where(SystemSettings.id == 1)).first()
    if not obj:
        obj = SystemSettings(id=1, cidade="Guapé", uf="MG", subtitulo="Secretaria Municipal")
        db.add(obj)
        db.commit()
        db.refresh(obj)
    return obj


def to_out(s: SystemSettings) -> SettingsOut:
    return SettingsOut(
        cidade=s.cidade, uf=s.uf, subtitulo=s.subtitulo,
        brasao_url=s.brasao_url or "", icone_url=s.icone_url or "",
    )


@router.get("/settings", response_model=SettingsOut)
def ler_settings(db: Session = Depends(get_db), _=Depends(get_user_ok)):
    return to_out(get_settings(db))


@router.get("/settings/public", response_model=SettingsOut)
def ler_settings_public():
    """Sem login: só nome cidade p/ título/login. Sem PII."""
    from sqlmodel import Session as S

    with S(engine) as db:
        return to_out(get_settings(db))


@router.put("/settings", response_model=SettingsOut)
def salvar_settings(
    data: SettingsIn,
    db: Session = Depends(get_db),
    # Cidade/marca: superuser ou cfg_geral+editar (need_perm já bloqueia troca pendente).
    user: User = Depends(need_perm("cfg_geral", "editar")),
):
    _ = user
    try:
        s = get_settings(db)
        s.cidade = data.cidade.strip()
        s.uf = data.uf.strip().upper()
        s.subtitulo = data.subtitulo.strip() or "Secretaria Municipal"
        s.brasao_url = validar_url_marca(data.brasao_url, "Brasão")
        s.icone_url = validar_url_marca(data.icone_url, "Ícone")
        if len(s.cidade) < 2:
            raise HTTPException(status_code=400, detail="Cidade inválida")
        db.add(s)
        db.commit()
        db.refresh(s)
    except HTTPException:
        raise
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Falha ao salvar configurações")
    return to_out(s)


# ---------- Gestão de Procedimentos / Exames Permitidos (SIGTAP) ----------
class ExamesPermitidosIn(BaseModel):
    codigos: list[str] = Field(default_factory=list)


@router.get("/settings/exames-permitidos")
def obter_exames_permitidos(
    db: Session = Depends(get_db),
    _user: User = Depends(get_user_ok),
):
    from app.models.lab_exames import SigtapProcedimento

    s = get_settings(db)
    raw = getattr(s, "exames_habilitados_sigtap", "") or ""
    codigos_habilitados = [c.strip() for c in raw.split(",") if c.strip()]

    # Procedimentos laboratoriais da tabela SIGTAP (Grupo 02, Subgrupo 02 - Diagnóstico Laboratorial Clínico / Sangue)
    procs = db.exec(
        select(SigtapProcedimento)
        .where(SigtapProcedimento.codigo.like("0202%"))
        .order_by(SigtapProcedimento.descricao)
    ).all()

    lista_sigtap = [
        {
            "id": p.id,
            "codigo": p.codigo,
            "descricao": p.descricao,
            "instrumento": p.instrumento or "BPA-C",
        }
        for p in procs
    ]

    return {
        "codigos_habilitados": codigos_habilitados,
        "total_habilitados": len(codigos_habilitados),
        "procedimentos_sigtap": lista_sigtap,
    }


@router.put("/settings/exames-permitidos")
def salvar_exames_permitidos(
    data: ExamesPermitidosIn,
    db: Session = Depends(get_db),
    _user: User = Depends(need_perm("cfg_geral", "editar")),
):
    s = get_settings(db)
    limpos = sorted({c.strip() for c in data.codigos if c.strip()})
    s.exames_habilitados_sigtap = ",".join(limpos)
    db.add(s)
    db.commit()
    db.refresh(s)
    return {
        "ok": True,
        "total_habilitados": len(limpos),
        "codigos_habilitados": limpos,
    }

