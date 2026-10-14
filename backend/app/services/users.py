import secrets
import string

from sqlmodel import Session, select

from app.core.security import hash_password, verify_password
from app.models.user import User
from app.schemas import UserCreate, UserUpdate

TELAS_VALIDAS = {"dashboard", "tfd", "aps", "usuarios", "integracoes", "lab", "lab_fila", "lab_agenda", "lab_vagas", "lab_audit"}

SENHA_MIN = 6


def telas_to_str(telas: list[str]) -> str:
    validas = sorted({t for t in telas if t in TELAS_VALIDAS})
    return ",".join(validas)


def telas_to_list(raw: str) -> list[str]:
    return [t for t in (raw or "").split(",") if t]


def to_out(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "nome": user.nome,
        "area": user.area,
        "telas": telas_to_list(user.telas),
        "is_superuser": user.is_superuser,
        "is_active": user.is_active,
        "must_change_password": bool(getattr(user, "must_change_password", False)),
    }


def gerar_temporaria(tamanho: int = 10) -> str:
    """Senha temporária legível: letras + dígitos, sem ambíguos."""
    alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
    base = "".join(secrets.choice(alfabeto) for _ in range(tamanho))
    return f"Guape@{base}"


def get_by_username(db: Session, username: str) -> User | None:
    return db.exec(select(User).where(User.username == username)).first()


def authenticate(db: Session, username: str, password: str) -> User | None:
    user = get_by_username(db, username.strip().lower())
    if not user or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def create_user(db: Session, data: UserCreate) -> tuple[User, str | None]:
    """Cria usuário com flag de troca obrigatória. Retorna (user, temporária ou None)."""
    username = data.username.strip().lower()
    if get_by_username(db, username):
        raise ValueError("username já existe")
    temporaria: str | None = None
    if data.gerar_temporaria or not (data.password or "").strip():
        temporaria = gerar_temporaria()
        pwd_hash = hash_password(temporaria)
    else:
        if len(data.password) < SENHA_MIN:
            raise ValueError(f"Senha deve ter ao menos {SENHA_MIN} caracteres")
        pwd_hash = hash_password(data.password)
    user = User(
        username=username,
        password_hash=pwd_hash,
        nome=data.nome.strip(),
        area=data.area,
        telas=telas_to_str(data.telas),
        is_superuser=data.is_superuser,
        is_active=data.is_active,
        must_change_password=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user, temporaria


def update_user(db: Session, user: User, data: UserUpdate) -> User:
    # Privacidade: admin NÃO define senha por aqui — só via reset (gera temporária).
    patch = data.model_dump(exclude_unset=True)
    patch.pop("password", None)
    if "telas" in patch and patch["telas"] is not None:
        user.telas = telas_to_str(patch.pop("telas"))
    for k, v in patch.items():
        if v is not None and hasattr(user, k):
            setattr(user, k, v.strip() if isinstance(v, str) else v)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def list_users(db: Session) -> list[User]:
    return list(db.exec(select(User).order_by(User.id)).all())


def _validar_nova(atual: str, nova: str, confirmar: str | None = None) -> None:
    if len(nova) < SENHA_MIN:
        raise ValueError(f"Nova senha deve ter ao menos {SENHA_MIN} caracteres")
    if nova == atual:
        raise ValueError("Nova senha deve ser diferente da atual")
    if confirmar is not None and nova != confirmar:
        raise ValueError("Nova senha e confirmação não conferem")


def trocar_senha(db: Session, user: User, senha_atual: str, nova_senha: str) -> None:
    if not verify_password(senha_atual, user.password_hash):
        raise ValueError("Senha atual incorreta")
    _validar_nova(senha_atual, nova_senha)
    user.password_hash = hash_password(nova_senha)
    user.must_change_password = False
    db.add(user)
    db.commit()


def primeira_troca(db: Session, user: User, senha_atual: str, nova: str, confirmar: str) -> None:
    """Troca do primeiro acesso: exige atual (temporária) + nova pessoal."""
    if not verify_password(senha_atual, user.password_hash):
        raise ValueError("Senha atual (temporária) incorreta")
    _validar_nova(senha_atual, nova, confirmar)
    user.password_hash = hash_password(nova)
    user.must_change_password = False
    db.add(user)
    db.commit()


def reset_senha(db: Session, user: User) -> str:
    """Gera nova temporária (hash) e reativa troca obrigatória. Retorna temporária em claro (exibir 1 vez)."""
    temporaria = gerar_temporaria()
    user.password_hash = hash_password(temporaria)
    user.must_change_password = True
    db.add(user)
    db.commit()
    return temporaria


def ensure_first_superuser(db: Session, username: str, password: str) -> None:
    if db.exec(select(User)).first():
        return
    if len(password) < SENHA_MIN:
        raise ValueError(f"FIRST_SUPERUSER_PASSWORD deve ter ao menos {SENHA_MIN} caracteres")
    user = User(
        username=username.strip().lower(),
        password_hash=hash_password(password),
        nome="Administrador",
        area="ferramentas",
        telas="aps,dashboard,integracoes,tfd,usuarios",
        is_superuser=True,
        is_active=True,
        must_change_password=False,
    )
    db.add(user)
    db.commit()
