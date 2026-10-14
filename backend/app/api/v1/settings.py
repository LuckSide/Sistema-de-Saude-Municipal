"""Settings globais (cidade/favicon/título) — leitura pública p/ título, escrita só admin."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.core.deps import get_current_user_senha_ok as get_user_ok, get_db, require_superuser
from app.db.session import engine
from app.models.settings import SystemSettings
from app.models.user import User

router = APIRouter()


class SettingsOut(BaseModel):
    cidade: str = "Guapé"
    uf: str = "MG"
    subtitulo: str = "Secretaria Municipal"


class SettingsIn(BaseModel):
    cidade: str = Field(min_length=2, max_length=80)
    uf: str = Field(default="MG", min_length=2, max_length=2)
    subtitulo: str = Field(default="Secretaria Municipal", max_length=120)


def get_settings(db: Session) -> SystemSettings:
    obj = db.exec(select(SystemSettings).where(SystemSettings.id == 1)).first()
    if not obj:
        obj = SystemSettings(id=1, cidade="Guapé", uf="MG", subtitulo="Secretaria Municipal")
        db.add(obj)
        db.commit()
        db.refresh(obj)
    return obj


@router.get("/settings", response_model=SettingsOut)
def ler_settings(db: Session = Depends(get_db), _=Depends(get_user_ok)):
    s = get_settings(db)
    return SettingsOut(cidade=s.cidade, uf=s.uf, subtitulo=s.subtitulo)


@router.get("/settings/public", response_model=SettingsOut)
def ler_settings_public():
    """Sem login: só nome cidade p/ título/login. Sem PII."""
    from sqlmodel import Session as S

    with S(engine) as db:
        s = get_settings(db)
        return SettingsOut(cidade=s.cidade, uf=s.uf, subtitulo=s.subtitulo)


@router.put("/settings", response_model=SettingsOut)
def salvar_settings(
    data: SettingsIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_superuser),
):
    _ = user
    # require_superuser não checa troca pendente — bloqueia admin c/ temporária aqui.
    if bool(getattr(user, "must_change_password", False)):
        raise HTTPException(status_code=403, detail="Troca de senha obrigatória")
    try:
        s = get_settings(db)
        s.cidade = data.cidade.strip()
        s.uf = data.uf.strip().upper()
        s.subtitulo = data.subtitulo.strip() or "Secretaria Municipal"
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
    return SettingsOut(cidade=s.cidade, uf=s.uf, subtitulo=s.subtitulo)
