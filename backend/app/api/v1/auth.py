from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session

from app.core.deps import get_current_user, get_db
from app.core.security import create_access_token
from app.core.version import APP_VERSION
from app.models.user import User
from app.schemas import TokenOut
from app.services.update import verificar_atualizacoes
from app.services.users import authenticate, to_out

router = APIRouter()


@router.post("/token/", response_model=TokenOut)
@router.post("/auth/token", response_model=TokenOut)
def login(
    form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)
):
    user = authenticate(db, form.username, form.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário ou senha inválidos",
        )
    token = create_access_token(subject=user.username)
    info: dict = {}
    try:
        # Só consulta GitHub no login p/ superuser (admin) — demais veem false.
        info = verificar_atualizacoes() if user.is_superuser else {}
    except Exception:
        info = {}
    return {
        "access_token": token,
        "token_type": "bearer",
        "must_change_password": bool(getattr(user, "must_change_password", False)),
        "versao": APP_VERSION,
        "tem_atualizacao": bool(info.get("tem_atualizacao", False)),
        "update_enabled": bool(info.get("update_enabled", True)),
    }


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return to_out(user, db)
