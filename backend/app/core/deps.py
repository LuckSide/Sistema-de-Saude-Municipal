from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session

from app.core.security import decode_token
from app.db.session import engine
from app.models.user import User
from app.services.users import get_by_username

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/token/")


def get_db():
    with Session(engine) as session:
        yield session


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    username = decode_token(token)
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido ou expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = get_by_username(db, username)
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário inativo ou inexistente",
        )
    return user


def get_current_user_senha_ok(
    user: User = Depends(get_current_user),
) -> User:
    """Guard padrão pós-login: bloqueia tudo com troca pendente."""
    if bool(getattr(user, "must_change_password", False)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Troca de senha obrigatória",
        )
    return user


def require_superuser(user: User = Depends(get_current_user)) -> User:
    if not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Apenas superusers",
        )
    return user


def require_senha_ok(user: User = Depends(get_current_user)) -> User:
    """Bloqueia tudo enquanto troca inicial pendente."""
    if bool(getattr(user, "must_change_password", False)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Troca de senha obrigatória",
        )
    return user
