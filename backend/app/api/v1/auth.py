from collections import defaultdict, deque
import json
import threading
import time

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session

from app.core.audit import parse_device_from_ua
from app.core.deps import get_current_user, get_db
from app.core.security import create_access_token
from app.core.version import APP_VERSION
from app.models.audit import AuditLog
from app.models.user import User
from app.schemas import TokenOut
from app.services.users import authenticate, to_out

router = APIRouter()

_LOGIN_FALHAS: dict[str, deque[float]] = defaultdict(deque)
_LOGIN_LOCK = threading.Lock()
_LOGIN_JANELA_S = 300.0
_LOGIN_MAX_FALHAS = 10


def _registrar_auditoria_login(db: Session, request: Request, username: str, sucesso: bool, user: User | None = None) -> None:
    try:
        ua = request.headers.get("user-agent", "") if request else ""
        ip = request.client.host if (request and request.client) else ""
        db.add(AuditLog(
            user_id=user.id if user else None,
            user_name=((user.nome or user.username) if user else username or "anon")[:120],
            action="LOGIN_SUCCESS" if sucesso else "LOGIN_FAILED",
            entity="AUTH",
            entity_id=user.id if user else None,
            device=parse_device_from_ua(ua)[:150],
            details=json.dumps({"username": (username or "")[:60], "ip": ip[:45], "ok": sucesso}, ensure_ascii=False),
        ))
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


@router.post("/token/", response_model=TokenOut)
@router.post("/auth/token", response_model=TokenOut)
def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    ip = request.client.host if (request and request.client) else "local"
    chave = f"{ip}:{(form.username or '').strip().lower()[:60]}"
    agora = time.monotonic()
    with _LOGIN_LOCK:
        fila = _LOGIN_FALHAS[chave]
        while fila and agora - fila[0] > _LOGIN_JANELA_S:
            fila.popleft()
        if len(fila) >= _LOGIN_MAX_FALHAS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Muitas tentativas de login inválidas. Aguarde alguns minutos e tente novamente.",
            )

    user = authenticate(db, form.username, form.password)
    if not user:
        with _LOGIN_LOCK:
            _LOGIN_FALHAS[chave].append(time.monotonic())
        _registrar_auditoria_login(db, request, form.username, sucesso=False)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário ou senha inválidos",
        )
    with _LOGIN_LOCK:
        _LOGIN_FALHAS.pop(chave, None)
    _registrar_auditoria_login(db, request, form.username, sucesso=True, user=user)
    token = create_access_token(
        subject=user.username,
        token_version=int(getattr(user, "token_version", 1) or 1),
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "must_change_password": bool(getattr(user, "must_change_password", False)),
        "versao": APP_VERSION,
        "tem_atualizacao": False,
        "update_enabled": False,
    }


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return to_out(user, db)
