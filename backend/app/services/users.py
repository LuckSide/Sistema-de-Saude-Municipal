import json
import secrets

from sqlmodel import Session, select

from app.core.security import hash_password, verify_password
from app.models.user import User
from app.schemas import UserCreate, UserUpdate
from app.services.permissoes import TODAS_TELAS, acoes_map, validar_acoes

TELAS_VALIDAS = set(TODAS_TELAS)

SENHA_MIN = 6


def telas_to_str(telas: list[str]) -> str:
    limpas = sorted({t.strip() for t in telas if t.strip()})
    desconhecidas = [t for t in limpas if t not in TELAS_VALIDAS]
    if desconhecidas:
        raise ValueError(f"tela desconhecida: {', '.join(desconhecidas)}")
    return ",".join(limpas)


def telas_to_list(raw: str) -> list[str]:
    return [t for t in (raw or "").split(",") if t]


def to_out(user: User, db: Session | None = None) -> dict:
    uid = getattr(user, "unidade_saude_id", None)
    unidade_nome = None
    if uid and db:
        try:
            from app.models.cadastros_saude import UnidadeSaude
            u = db.get(UnidadeSaude, uid)
            if u:
                unidade_nome = u.nome
        except Exception:
            pass
    lid = getattr(user, "laboratorio_id", None)
    lab_nome = None
    if lid and db:
        try:
            from app.models.lab_fase6 import Laboratorio
            l = db.get(Laboratorio, lid)
            if l:
                lab_nome = l.nome
        except Exception:
            pass
    return {
        "id": user.id,
        "username": user.username,
        "nome": user.nome,
        "area": user.area,
        "telas": telas_to_list(user.telas),
        "acoes": acoes_map(user),
        "medico_id": getattr(user, "medico_id", None),
        "unidade_saude_id": uid,
        "unidade_saude_nome": unidade_nome,
        "laboratorio_id": lid,
        "laboratorio_nome": lab_nome,
        "permite_retroativo": bool(getattr(user, "permite_retroativo", True)),
        "is_superuser": user.is_superuser,
        "is_active": user.is_active,
        "must_change_password": bool(getattr(user, "must_change_password", False)),
    }


def gerar_temporaria(tamanho: int = 5) -> str:
    """Senha temporária curta e ditável: minúsculas + dígitos, sem ambíguos.
    Uso único com troca obrigatória no 1º login (nunca reutilizada)."""
    alfabeto = "abcdefghijkmnpqrstuvwxyz23456789"
    base = "".join(secrets.choice(alfabeto) for _ in range(tamanho))
    return f"Saude@{base}"


def _validar_medico_id(db: Session, medico_id) -> int | None:
    if medico_id is None:
        return None
    from app.models.cadastros_saude import Medico

    if not db.get(Medico, medico_id):
        raise ValueError("médico vinculado não encontrado")
    return medico_id


def _validar_unidade_id(db: Session, unidade_id) -> int | None:
    if unidade_id is None or unidade_id == "" or unidade_id == 0:
        return None
    from app.models.cadastros_saude import UnidadeSaude

    uid = int(unidade_id)
    if not db.get(UnidadeSaude, uid):
        raise ValueError("unidade de saúde vinculada não encontrada")
    return uid


def _validar_laboratorio_id(db: Session, lab_id) -> int | None:
    if lab_id is None or lab_id == "" or lab_id == 0:
        return None
    from app.models.lab_fase6 import Laboratorio

    lid = int(lab_id)
    if not db.get(Laboratorio, lid):
        raise ValueError("laboratório vinculado não encontrado")
    return lid


def get_by_username(db: Session, username: str) -> User | None:
    return db.exec(select(User).where(User.username == username)).first()


def authenticate(db: Session, username: str, password: str) -> User | None:
    u_clean = username.strip().lower()
    user = get_by_username(db, u_clean)
    if not user:
        # Se for CPF com pontuação (ex: 123.456.789-00), busca pelos dígitos
        digits = "".join(c for c in u_clean if c.isdigit())
        if digits and len(digits) == 11:
            user = get_by_username(db, digits)
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
        acoes=json.dumps(validar_acoes(data.acoes or {})),
        medico_id=_validar_medico_id(db, data.medico_id),
        unidade_saude_id=_validar_unidade_id(db, data.unidade_saude_id),
        laboratorio_id=_validar_laboratorio_id(db, data.laboratorio_id),
        permite_retroativo=data.permite_retroativo,
        is_superuser=data.is_superuser,
        is_active=data.is_active,
        must_change_password=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    try:
        from app.services.dashboard_default import criar_dashboard_padrao_se_ausente
        criar_dashboard_padrao_se_ausente(db, user)
    except Exception:
        pass
    return user, temporaria


def update_user(db: Session, user: User, data: UserUpdate) -> User:
    # Privacidade: admin NÃO define senha por aqui — só via reset (gera temporária).
    patch = data.model_dump(exclude_unset=True)
    patch.pop("password", None)
    if "telas" in patch and patch["telas"] is not None:
        user.telas = telas_to_str(patch.pop("telas"))
    if "medico_id" in patch:
        user.medico_id = _validar_medico_id(db, patch.pop("medico_id"))
    if "unidade_saude_id" in patch:
        user.unidade_saude_id = _validar_unidade_id(db, patch.pop("unidade_saude_id"))
    if "laboratorio_id" in patch:
        user.laboratorio_id = _validar_laboratorio_id(db, patch.pop("laboratorio_id"))
    if "acoes" in patch and patch["acoes"] is not None:
        try:
            user.acoes = json.dumps(validar_acoes(patch.pop("acoes")))
        except ValueError as e:
            raise ValueError("Erro de validação ao processar as ações.")
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
