import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.user import User
from app.models.dashboard_prefs import UserDashboardPrefs
from app.models import tfd  # noqa: F401
from app.limpar_usuarios import deve_manter_usuario, USUARIOS_AUTORIZADOS


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


def test_deve_manter_usuario_regras():
    casos = [
        ("admin", "Administrador", True),
        ("daniel", "Daniel", True),
        ("juliana", "Juliana", True),
        ("marcio.rodrigues", "Márcio Henrique Rodrigues", True),
        ("jessica.faria", "Jéssica Aguiar Faria", True),
        ("bruno.azevedo", "Bruno Perez Azevedo", True),
        ("bruno.azevvedo", "Bruno Perez Azevvedo", True),
        ("elton.neves", "Elton Neves", True),
        ("henrique.tavares", "Henrique Pieve Tavares", True),
        ("dalcyone", "Dalcyone Fraga", True),
        # Casos que devem ser removidos (outros médicos/contas):
        ("carlos.alberto", "Carlos Alberto Souza", False),
        ("medico_pediatra", "Pediatra Plantonista", False),
        ("joao.silva", "João da Silva", False),
    ]

    for username, nome, esperado in casos:
        u = User(username=username, nome=nome, password_hash="hash")
        manter, motivo = deve_manter_usuario(u)
        assert manter is esperado, f"Falha para {username} / {nome}: esperado {esperado}, obteve {manter} ({motivo})"


def test_execucao_limpeza_banco(session, monkeypatch):
    from app.limpar_usuarios import processar_limpeza

    # Cria usuários no banco
    u_admin = User(username="admin", nome="Administrador", password_hash="h")
    u_daniel = User(username="daniel", nome="Daniel", password_hash="h")
    u_juliana = User(username="juliana", nome="Juliana", password_hash="h")
    u_marcio = User(username="marcio", nome="Márcio Henrique Rodrigues", password_hash="h")
    u_jessica = User(username="jessica", nome="Jéssica Aguiar Faria", password_hash="h")
    u_bruno = User(username="bruno", nome="Bruno Perez Azevedo", password_hash="h")
    u_elton = User(username="elton", nome="Elton Neves", password_hash="h")
    u_henrique = User(username="henrique", nome="Henrique Pieve Tavares", password_hash="h")
    u_dalcyone = User(username="dalcyone", nome="Dalcyone Fraga", password_hash="h")

    # Usuários extras que devem ser removidos
    u_extra1 = User(username="medico1", nome="Dr. Estranho", password_hash="h")
    u_extra2 = User(username="medico2", nome="Dra. Meredith Grey", password_hash="h")

    session.add_all([
        u_admin, u_daniel, u_juliana, u_marcio, u_jessica,
        u_bruno, u_elton, u_henrique, u_dalcyone, u_extra1, u_extra2
    ])
    session.commit()

    total_antes = len(session.exec(select(User)).all())
    assert total_antes == 11

    # Monkeypatch engine para usar o banco em memória da fixture
    monkeypatch.setattr("app.limpar_usuarios.engine", session.get_bind())

    # 1. Simulação (não remove)
    processar_limpeza(executar=False)
    assert len(session.exec(select(User)).all()) == 11

    # 2. Execução (remove u_extra1 e u_extra2)
    processar_limpeza(executar=True)
    restantes = session.exec(select(User)).all()
    assert len(restantes) == 9

    usernames_restantes = {u.username for u in restantes}
    assert "admin" in usernames_restantes
    assert "daniel" in usernames_restantes
    assert "juliana" in usernames_restantes
    assert "marcio" in usernames_restantes
    assert "jessica" in usernames_restantes
    assert "bruno" in usernames_restantes
    assert "elton" in usernames_restantes
    assert "henrique" in usernames_restantes
    assert "dalcyone" in usernames_restantes
    assert "medico1" not in usernames_restantes
    assert "medico2" not in usernames_restantes
