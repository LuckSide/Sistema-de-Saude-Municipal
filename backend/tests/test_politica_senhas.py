from fastapi.testclient import TestClient
import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.deps import get_db, require_superuser
from app.core.security import create_access_token, hash_password, validar_forca_senha
from app.main import app
from app.models.user import User
from app.schemas import UserCreate
from app.services.users import (
    create_user,
    ensure_first_superuser,
    gerar_temporaria,
    primeira_troca,
    trocar_senha,
)


@pytest.fixture(name="session")
def session_fixture():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        yield db


@pytest.fixture(name="client")
def client_fixture(session: Session):
    app.dependency_overrides[get_db] = lambda: session
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize(
    "senha_fraca",
    [
        "",
        "   ",
        "Ab1@xyz",
        "123456",
        "12345678",
        "00000000",
        "11111111",
        "aaaaaaaa",
        "@@@@@@@@",
        "20252026",
        "98765432",
        "senha123",
        "Senha 123",
        "PASSWORD123",
        "admin123",
        "guape123",
        "mudar123",
        "trocar123",
        "qwerty123",
        "abc12345",
        "1q2w3e4r",
        "saude123",
        "senhaforte",
        "Abcd@2026",
        "Dcba@2026",
        "Senha1234!",
        "Teste4321@",
        "Qwer@2026",
        "Asdf@9876",
    ],
)
def test_validar_forca_senha_rejeita_senhas_fracas(senha_fraca: str):
    with pytest.raises(ValueError) as exc:
        validar_forca_senha(senha_fraca, username="operador.tfd")
    assert str(exc.value).strip() != ""


def test_validar_forca_senha_rejeita_senha_igual_ou_baseada_em_username():
    with pytest.raises(ValueError, match="usuário"):
        validar_forca_senha("maria.silva", username="maria.silva")
    with pytest.raises(ValueError, match="usuário"):
        validar_forca_senha("Maria.Silva@2026", username="maria.silva")
    with pytest.raises(ValueError, match="usuário"):
        validar_forca_senha("operador99", username="operador")


@pytest.mark.parametrize(
    "senha_forte",
    [
        "Guape#2026",
        "Clinica!94",
        "NovaSenha123@",
        "Saude@k7m2p",
        "MinhaFraseSegura!8",
    ],
)
def test_validar_forca_senha_aceita_senhas_fortes(senha_forte: str):
    validar_forca_senha(senha_forte, username="operador.tfd")


def test_gerar_temporaria_sempre_atende_politica_de_senhas():
    for _ in range(50):
        temp = gerar_temporaria()
        assert len(temp) >= 8
        validar_forca_senha(temp)


def test_create_user_valida_senha_explicita_e_aceita_forte(session: Session):
    with pytest.raises(ValueError):
        create_user(
            session,
            UserCreate(
                username="op_fraco",
                password="senha123",
                gerar_temporaria=False,
                telas=["dashboard"],
            ),
        )

    user, temp = create_user(
        session,
        UserCreate(
            username="op_forte",
            password="Guape#2026",
            gerar_temporaria=False,
            telas=["dashboard"],
        ),
    )
    assert user.id is not None
    assert temp is None


def test_trocar_e_primeira_troca_bloqueiam_senhas_fracas_no_servico(session: Session):
    user = User(
        username="maria.saude",
        password_hash=hash_password("Saude@x7k9m"),
        is_active=True,
        must_change_password=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    for fraca in ("123456", "00000000", "guape123", "Qwer@2026", "maria.saude@99"):
        with pytest.raises(ValueError):
            primeira_troca(session, user, "Saude@x7k9m", fraca, fraca)
        assert user.must_change_password is True

    primeira_troca(session, user, "Saude@x7k9m", "Guape#2026", "Guape#2026")
    assert user.must_change_password is False

    versao_antes = user.token_version
    with pytest.raises(ValueError):
        trocar_senha(session, user, "Guape#2026", "20252026")

    trocar_senha(session, user, "Guape#2026", "Clinica!94")
    assert user.token_version == versao_antes + 1


def test_ensure_first_superuser_mantem_compatibilidade_bootstrap(session: Session):
    ensure_first_superuser(session, "admin", "admin123")
    admin = session.exec(select(User).where(User.username == "admin")).first()
    assert admin is not None
    assert admin.is_superuser is True


def test_post_usuarios_com_senha_fraca_explicita_retorna_400(
    client: TestClient, session: Session
):
    admin = User(
        username="admin_criador",
        password_hash=hash_password("Guape#2026"),
        is_superuser=True,
        is_active=True,
        must_change_password=False,
    )
    session.add(admin)
    session.commit()
    session.refresh(admin)

    app.dependency_overrides[require_superuser] = lambda: admin
    res = client.post(
        "/api/usuarios/",
        json={
            "username": "novo_op_fraco",
            "password": "password123",
            "gerar_temporaria": False,
            "telas": ["dashboard"],
        },
    )
    assert res.status_code == 400
    assert "comum" in res.json()["detail"].lower()


def test_endpoints_senha_retornam_400_com_detalhe_claro_e_403_enquanto_pendente(
    client: TestClient, session: Session
):
    user = User(
        username="tec.enfermagem",
        password_hash=hash_password("Saude@k7m2p"),
        telas="dashboard,tfd",
        is_superuser=False,
        is_active=True,
        must_change_password=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    token = create_access_token(user.username, token_version=user.token_version)
    headers = {"Authorization": f"Bearer {token}"}

    # Enquanto must_change_password=True, rota protegida continua bloqueada com 403
    res_bloqueado = client.get("/api/tfd/pacientes", headers=headers)
    assert res_bloqueado.status_code == 403

    # Primeira troca com senha fraca retorna 400 com detalhe claro (nunca 500)
    res_fraca = client.put(
        "/api/usuarios/me/primeira-troca",
        json={
            "senha_atual": "Saude@k7m2p",
            "nova_senha": "senha123",
            "confirmar_senha": "senha123",
        },
        headers=headers,
    )
    assert res_fraca.status_code == 400
    assert "comum" in res_fraca.json()["detail"].lower()

    # Primeira troca com senha forte libera o usuário
    res_ok = client.put(
        "/api/usuarios/me/primeira-troca",
        json={
            "senha_atual": "Saude@k7m2p",
            "nova_senha": "Guape#2026",
            "confirmar_senha": "Guape#2026",
        },
        headers=headers,
    )
    assert res_ok.status_code == 200

    # Troca posterior com senha sequencial retorna 400
    res_seq = client.put(
        "/api/usuarios/me/senha",
        json={"senha_atual": "Guape#2026", "nova_senha": "Abcd@2026"},
        headers=headers,
    )
    assert res_seq.status_code == 400
    assert "sequências" in res_seq.json()["detail"].lower()

    # Troca posterior com senha forte retorna 200
    res_troca_ok = client.put(
        "/api/usuarios/me/senha",
        json={"senha_atual": "Guape#2026", "nova_senha": "Clinica!94"},
        headers=headers,
    )
    assert res_troca_ok.status_code == 200
