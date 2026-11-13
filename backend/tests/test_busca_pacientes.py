from datetime import date
from types import SimpleNamespace

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.core.deps import get_current_user_senha_ok, get_db
from app.main import app
from app.models.tfd import Paciente
from app.models.user import User
from app.services.tfd import coluna_sem_acento


@pytest.fixture(name="session")
def session_fixture():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        p1 = Paciente(
            id=1,
            nome="MARIA CONCEICAO DA SILVA",
            cpf="11122233344",
            cns="700000000000001",
            codigo_prontuario="PR-10001",
            nascimento=date(1975, 4, 12),
        )
        p2 = Paciente(
            id=2,
            nome="JOSE ANTONIO OLIVEIRA",
            cpf="555.666.777-88",
            cns="700000000000002",
            codigo_prontuario="PR-10002",
            nascimento=date(1980, 9, 1),
        )
        db.add_all([p1, p2])
        db.commit()
        yield db


def _criar_usuario(telas: str, is_superuser: bool = False) -> User:
    return User(
        id=99,
        username="operador_teste",
        password_hash="hash",
        nome="Operador Teste",
        telas=telas,
        is_superuser=is_superuser,
        is_active=True,
        must_change_password=False,
    )


def test_busca_pacientes_local_endpoints_e_permissoes(session: Session):
    operador_ox = _criar_usuario("oxigenio_emprestimos")
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_current_user_senha_ok] = lambda: operador_ox
    try:
        client = TestClient(app)

        # Termo vazio -> Busca Sob Demanda retorna vazio sem erro
        res_vazio = client.get("/api/tfd/pacientes")
        assert res_vazio.status_code == 200
        assert res_vazio.json()["data"] == []

        res_buscar_vazio = client.get("/api/tfd/pacientes/buscar")
        assert res_buscar_vazio.status_code == 200
        assert res_buscar_vazio.json()["resultados"] == []

        # Busca por nome em /api/tfd/pacientes e /api/tfd/pacientes/buscar (com usuário de Oxigênio)
        res_nome = client.get("/api/tfd/pacientes", params={"q": "MARIA SILVA"})
        assert res_nome.status_code == 200
        assert res_nome.json()["total"] == 1
        assert res_nome.json()["data"][0]["nome"] == "MARIA CONCEICAO DA SILVA"

        res_buscar_nome = client.get("/api/tfd/pacientes/buscar", params={"termo": "MARIA"})
        assert res_buscar_nome.status_code == 200
        body_buscar = res_buscar_nome.json()
        assert body_buscar["fonte"] == "local"
        assert len(body_buscar["resultados"]) == 1
        assert body_buscar["resultados"][0]["id"] == 1

        # Busca parcial por CPF numérico mesmo quando armazenado com máscara (555.666.777-88)
        res_cpf_parcial = client.get("/api/tfd/pacientes", params={"q": "555666"})
        assert res_cpf_parcial.status_code == 200
        assert res_cpf_parcial.json()["total"] == 1
        assert res_cpf_parcial.json()["data"][0]["id"] == 2

        # Busca com usuário APAC também deve ter permissão
        app.dependency_overrides[get_current_user_senha_ok] = lambda: _criar_usuario("apac_solicitacao")
        res_apac = client.get("/api/tfd/pacientes", params={"q": "JOSE"})
        assert res_apac.status_code == 200
        assert res_apac.json()["total"] == 1

        # Usuário sem tela clínica relacionada continua bloqueado com 403
        app.dependency_overrides[get_current_user_senha_ok] = lambda: _criar_usuario("cfg_backup")
        res_negado = client.get("/api/tfd/pacientes", params={"q": "MARIA"})
        assert res_negado.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_coluna_sem_acento_fallback_sem_unaccent_postgresql():
    class FakeResult:
        def __init__(self, val):
            self._val = val

        def scalar(self):
            return self._val

    class FakeSession:
        def __init__(self, tem_ext: bool):
            self._bind = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
            self._tem_ext = tem_ext

        def get_bind(self):
            return self._bind

        def execute(self, *_args, **_kwargs):
            return FakeResult(self._tem_ext)

    expr_sem_ext = coluna_sem_acento(FakeSession(False), Paciente.nome)
    sql_sem_ext = str(expr_sem_ext.compile(dialect=postgresql.dialect()))
    assert "translate(" in sql_sem_ext
    assert "unaccent(" not in sql_sem_ext

    expr_com_ext = coluna_sem_acento(FakeSession(True), Paciente.nome)
    sql_com_ext = str(expr_com_ext.compile(dialect=postgresql.dialect()))
    assert "unaccent(" in sql_com_ext
