from datetime import date, timedelta

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.core.deps import get_current_user_senha_ok, get_db
from app.main import app
from app.models.cadastros_saude import Medico, UnidadeSaude
from app.models.tfd import Paciente, TipoFila
from app.models.user import User


@pytest.fixture(name="session")
def session_fixture():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        u1 = UnidadeSaude(
            id=1,
            nome="PSF CENTRO",
            cnes="2145678",
            endereco="Rua Direita",
            numero="100",
            bairro="Centro",
            municipio="Guapé",
            ativo=True,
        )
        u2 = UnidadeSaude(
            id=2,
            nome="PSF PONTAL",
            cnes="2145699",
            endereco="Av Beira Lago",
            numero="50",
            bairro="Pontal",
            municipio="Guapé",
            ativo=True,
        )
        med = Medico(
            id=1,
            nome="Dr. Joao Regulator",
            crm="MG-12345",
            cbo_codigo="225125",
            ativo=True,
        )
        p1 = Paciente(
            id=1,
            nome="MARIA APARECIDA SANTOS",
            cpf="11122233344",
            cns="700000000000001",
            codigo_prontuario="PR-10001",
            nascimento=date(1980, 3, 15),
            endereco="Rua das Flores",
            endereco_numero="123",
            bairro="Centro",
            municipio="Guapé",
            unidade_saude_id=1,
            unidade_nome="PSF CENTRO",
            unidade_cnes="2145678",
        )
        p2 = Paciente(
            id=2,
            nome="MARIA EDUARDA COSTA",
            cpf="22233344455",
            cns="700000000000002",
            codigo_prontuario="PR-10002",
            nascimento=date(1992, 11, 20),
            endereco="Av Brasil",
            endereco_numero="45",
            bairro="Bela Vista",
            municipio="Guapé",
            unidade_saude_id=2,
            unidade_nome="",
            unidade_cnes="",
        )
        p3 = Paciente(
            id=3,
            nome="CARLOS HENRIQUE LIMA",
            cpf="33150319800",
            cns="700000000000003",
            codigo_prontuario="PR-15031980",
            nascimento=date(1970, 1, 5),
            endereco="Rua Sete",
            endereco_numero="88",
            bairro="Vila Nova",
            municipio="Guapé",
        )
        tf_geral = TipoFila(
            codigo="USG",
            nome="ULTRASSONOGRAFIA",
            tipo_fila="REGULACAO_GERAL",
            ativo=True,
        )
        tf_lab = TipoFila(
            codigo="EXPSF",
            nome="EX. LAB. PSF ROTINA",
            tipo_fila="EXAME_LABORATORIAL",
            ativo=True,
        )
        tf_inativa = TipoFila(
            codigo="ANTIGA",
            nome="FILA DESATIVADA",
            tipo_fila="REGULACAO_GERAL",
            ativo=False,
        )
        db.add_all([u1, u2, med, p1, p2, p3, tf_geral, tf_lab, tf_inativa])
        db.commit()
        yield db


def _criar_usuario(
    telas: str,
    *,
    is_superuser: bool = False,
    acoes: str = "{}",
    medico_id: int | None = None,
    unidade_saude_id: int | None = None,
) -> User:
    return User(
        id=99,
        username="operador_teste",
        password_hash="hash",
        nome="Operador Teste",
        telas=telas,
        acoes=acoes,
        medico_id=medico_id,
        unidade_saude_id=unidade_saude_id,
        is_superuser=is_superuser,
        is_active=True,
        must_change_password=False,
    )


def test_busca_paciente_por_data_nascimento_e_campos_endereco_unidade(session: Session):
    ator = _criar_usuario("tfd,tfd_exames,tfd_pacientes")
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_current_user_senha_ok] = lambda: ator
    try:
        client = TestClient(app)

        # 1. Busca isolada DD/MM/AAAA em /pacientes e /pacientes/buscar
        r1 = client.get("/api/tfd/pacientes", params={"q": "15/03/1980"})
        assert r1.status_code == 200
        d1 = r1.json()["data"]
        assert len(d1) == 1
        assert d1[0]["id"] == 1
        assert d1[0]["unidade_nome"] == "PSF CENTRO"
        assert d1[0]["unidade_cnes"] == "2145678"
        assert d1[0]["endereco"] == "Rua das Flores"
        assert d1[0]["endereco_numero"] == "123"
        assert d1[0]["bairro"] == "Centro"
        assert d1[0]["municipio"] == "Guapé"

        rb1 = client.get("/api/tfd/pacientes/buscar", params={"termo": "15/03/1980"})
        assert rb1.status_code == 200
        res_b1 = rb1.json()["resultados"]
        assert len(res_b1) == 1
        assert res_b1[0]["id"] == 1
        assert res_b1[0]["unidade_nome"] == "PSF CENTRO"
        assert res_b1[0]["unidade_cnes"] == "2145678"
        assert res_b1[0]["endereco"] == "Rua das Flores"
        assert res_b1[0]["endereco_numero"] == "123"
        assert res_b1[0]["bairro"] == "Centro"
        assert res_b1[0]["municipio"] == "Guapé"

        # 2. Busca sem barra DDMMAAAA mantém prontuário/CPF parcial E encontra por data de nascimento
        r2 = client.get("/api/tfd/pacientes", params={"q": "15031980"})
        assert r2.status_code == 200
        ids_r2 = {x["id"] for x in r2.json()["data"]}
        assert 1 in ids_r2  # nasceu em 15/03/1980
        assert 3 in ids_r2  # CPF / prontuário contém 15031980

        rb2 = client.get("/api/tfd/pacientes/buscar", params={"termo": "15031980"})
        assert rb2.status_code == 200
        ids_rb2 = {x["id"] for x in rb2.json()["resultados"]}
        assert 1 in ids_rb2
        assert 3 in ids_rb2

        # 3. Busca combinada Nome + Data (com e sem barra)
        r_comb1 = client.get("/api/tfd/pacientes", params={"q": "Maria 15/03/1980"})
        assert r_comb1.status_code == 200
        assert [x["id"] for x in r_comb1.json()["data"]] == [1]

        r_comb2 = client.get("/api/tfd/pacientes", params={"q": "Maria 15031980"})
        assert r_comb2.status_code == 200
        assert [x["id"] for x in r_comb2.json()["data"]] == [1]

        rb_comb = client.get("/api/tfd/pacientes/buscar", params={"termo": "Maria 15/03/1980"})
        assert rb_comb.status_code == 200
        assert [x["id"] for x in rb_comb.json()["resultados"]] == [1]

        # 4. Data inválida não gera erro 500 e fallback de UnidadeSaude preenche unidade_nome/cnes
        r_inv = client.get("/api/tfd/pacientes", params={"q": "31/02/1980"})
        assert r_inv.status_code == 200
        assert r_inv.json()["data"] == []

        r_fallback_unid = client.get("/api/tfd/pacientes", params={"q": "20/11/1992"})
        assert r_fallback_unid.status_code == 200
        d2 = r_fallback_unid.json()["data"]
        assert len(d2) == 1
        assert d2[0]["id"] == 2
        assert d2[0]["unidade_nome"] == "PSF PONTAL"
        assert d2[0]["unidade_cnes"] == "2145699"

        rb_fallback = client.get("/api/tfd/pacientes/buscar", params={"termo": "20111992"})
        assert rb_fallback.status_code == 200
        res_b2 = rb_fallback.json()["resultados"]
        assert len(res_b2) == 1
        assert res_b2[0]["unidade_nome"] == "PSF PONTAL"
        assert res_b2[0]["unidade_cnes"] == "2145699"
        assert res_b2[0]["endereco"] == "Av Brasil"
        assert res_b2[0]["endereco_numero"] == "45"
        assert res_b2[0]["bairro"] == "Bela Vista"
        assert res_b2[0]["municipio"] == "Guapé"
    finally:
        app.dependency_overrides.clear()


def test_rbac_agendamento_direto_e_prioridade_filas(session: Session):
    app.dependency_overrides[get_db] = lambda: session
    try:
        client = TestClient(app)
        hoje = date.today().isoformat()
        amanha = (date.today() + timedelta(days=1)).isoformat()

        # 1. Operador sem permissão de agenda (apenas tfd_exames) pode incluir na fila, mas é bloqueado ao agendar direto
        op_sem_agenda = _criar_usuario("tfd_exames")
        app.dependency_overrides[get_current_user_senha_ok] = lambda: op_sem_agenda

        res_fila = client.post(
            "/api/tfd/exames",
            json={
                "paciente_id": 1,
                "exame": "ULTRASSONOGRAFIA ABDOMINAL",
                "especialidade": "Ultrassonografia",
                "tipo_fila": "ULTRASSONOGRAFIA",
                "prioridade": "rotina",
                "justificativa": "Dor abdominal em hipocondrio direito ha 30 dias",
                "data_pedido": hoje,
                "unidade_saude_id": 1,
                "medico_id": 1,
            },
        )
        assert res_fila.status_code == 201
        assert res_fila.json()["status"] == "aguardando"

        res_ag_negado = client.post(
            "/api/tfd/exames",
            json={
                "paciente_id": 1,
                "exame": "ULTRASSONOGRAFIA ABDOMINAL",
                "especialidade": "Ultrassonografia",
                "tipo_fila": "ULTRASSONOGRAFIA",
                "prioridade": "rotina",
                "justificativa": "Dor abdominal em hipocondrio direito ha 30 dias",
                "data_pedido": hoje,
                "data_agendada": amanha,
                "hora_agendada": "08:00",
                "unidade_saude_id": 1,
                "medico_id": 1,
            },
        )
        assert res_ag_negado.status_code == 403

        res_lote_negado = client.post(
            "/api/tfd/exames/lote",
            json={
                "tipo_fila": "ULTRASSONOGRAFIA",
                "exame": "ULTRASSONOGRAFIA ABDOMINAL",
                "especialidade": "Ultrassonografia",
                "unidade_saude_id": 1,
                "medico_id": 1,
                "justificativa_padrao": "Investigacao diagnostica em lote ambulatorial",
                "agendamento_direto": True,
                "data_agendada": amanha,
                "hora_agendada": "09:00",
                "itens": [{"paciente_id": 1}],
            },
        )
        assert res_lote_negado.status_code == 403

        # 2. Operador com tfd_agenda apenas leitura (acoes=["ver"]) também é bloqueado ao agendar direto
        op_agenda_leitura = _criar_usuario(
            "tfd_exames,tfd_agenda",
            acoes='{"tfd_agenda": ["ver"]}',
        )
        app.dependency_overrides[get_current_user_senha_ok] = lambda: op_agenda_leitura
        res_ag_readonly = client.post(
            "/api/tfd/exames",
            json={
                "paciente_id": 1,
                "exame": "ULTRASSONOGRAFIA ABDOMINAL",
                "especialidade": "Ultrassonografia",
                "tipo_fila": "ULTRASSONOGRAFIA",
                "prioridade": "rotina",
                "justificativa": "Dor abdominal em hipocondrio direito ha 30 dias",
                "data_pedido": hoje,
                "data_agendada": amanha,
                "unidade_saude_id": 1,
                "medico_id": 1,
            },
        )
        assert res_ag_readonly.status_code == 403

        # 3. Operador com tfd_agenda:criar consegue agendar direto
        op_com_agenda = _criar_usuario(
            "tfd_exames,tfd_agenda",
            acoes='{"tfd_agenda": ["ver", "criar"]}',
        )
        app.dependency_overrides[get_current_user_senha_ok] = lambda: op_com_agenda
        res_ag_ok = client.post(
            "/api/tfd/exames",
            json={
                "paciente_id": 1,
                "exame": "ULTRASSONOGRAFIA ABDOMINAL",
                "especialidade": "Ultrassonografia",
                "tipo_fila": "ULTRASSONOGRAFIA",
                "prioridade": "rotina",
                "justificativa": "Dor abdominal em hipocondrio direito ha 30 dias",
                "data_pedido": hoje,
                "data_agendada": amanha,
                "hora_agendada": "10:00",
                "unidade_saude_id": 1,
                "medico_id": 1,
            },
        )
        assert res_ag_ok.status_code == 201
        assert res_ag_ok.json()["status"] == "agendado"

        # 4. Perfil lançamento restrito não pode definir prioridade urgente
        op_restrito = _criar_usuario("tfd_fila_lancamento", unidade_saude_id=1)
        app.dependency_overrides[get_current_user_senha_ok] = lambda: op_restrito
        res_urg_negado = client.post(
            "/api/tfd/exames",
            json={
                "paciente_id": 1,
                "exame": "ULTRASSONOGRAFIA ABDOMINAL",
                "especialidade": "Ultrassonografia",
                "tipo_fila": "ULTRASSONOGRAFIA",
                "prioridade": "urgente",
                "justificativa": "Dor abdominal em hipocondrio direito ha 30 dias",
                "data_pedido": hoje,
                "unidade_saude_id": 1,
                "medico_id": 1,
            },
        )
        assert res_urg_negado.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_listagem_dinamica_tipos_fila(session: Session):
    ator = _criar_usuario("tfd_exames")
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_current_user_senha_ok] = lambda: ator
    try:
        client = TestClient(app)
        res = client.get("/api/tfd/tipos", params={"ativos": True})
        assert res.status_code == 200
        itens = res.json()["data"]
        nomes = {x["nome"] for x in itens}
        assert "ULTRASSONOGRAFIA" in nomes
        assert "EX. LAB. PSF ROTINA" in nomes
        assert "FILA DESATIVADA" not in nomes
    finally:
        app.dependency_overrides.clear()
