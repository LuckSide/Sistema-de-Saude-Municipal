from datetime import date, datetime
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.v1.auth import get_current_user
from app.api.v1.tfd import get_db as get_db_tfd
from app.api.v1.lab_fase6 import get_db as get_db_lab
from app.core.deps import get_db as get_db_core, get_current_user_senha_ok
from app.main import app
from app.models.tfd import Paciente, ExameFila
from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import Laboratorio, SolicitacaoMestre, ItemSolic, FilaPsf
from app.models.user import User


@pytest.fixture(name="session")
def session_fixture():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _sqlite_funcs(dbapi_connection, connection_record):
        if hasattr(dbapi_connection, "create_function"):
            def sqlite_to_char(val, fmt):
                if not val:
                    return ""
                s = str(val)
                if fmt == "YYYY-MM":
                    return s[:7]
                elif fmt == "YYYY-MM-DD":
                    return s[:10]
                elif fmt == "YYYY":
                    return s[:4]
                return s
            dbapi_connection.create_function("to_char", 2, sqlite_to_char)

    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture(name="client")
def client_fixture(session: Session):
    admin = User(
        id=1,
        username="admin_test",
        nome="Admin Teste",
        is_active=True,
        is_superuser=True,
        must_change_password=False,
        telas="tfd,tfd_exames,tfd_fila_lancamento,tfd_medico,tfd_agenda,lab,lab_marcacao,lab_agenda,lab_fila,usuarios",
    )

    def get_db_override():
        yield session

    def get_user_override():
        return admin

    app.dependency_overrides[get_db_core] = get_db_override
    app.dependency_overrides[get_db_tfd] = get_db_override
    app.dependency_overrides[get_db_lab] = get_db_override
    app.dependency_overrides[get_current_user] = get_user_override
    app.dependency_overrides[get_current_user_senha_ok] = get_user_override

    yield TestClient(app)

    app.dependency_overrides.clear()


def test_duplicidade_tfd(session: Session, client: TestClient):
    # 1. Cria paciente
    pac = Paciente(
        id=10,
        nome="Paciente Teste Duplicidade",
        cpf="12345678900",
        cns="700000000000001",
        nascimento=date(1990, 1, 1),
        telefone="35999990001",
        endereco="Rua Teste, 100",
        endereco_numero="100",
        bairro="Centro",
        cep="37177000",
        observacoes="",
    )
    session.add(pac)
    session.commit()

    # 2. Sem pedidos prévios -> Não duplicado
    res = client.get("/api/tfd/exames/verificar-duplicidade", params={
        "paciente_id": pac.id,
        "codigo_procedimento": "0205020186",
        "procedimento_nome": "ULTRASSONOGRAFIA ABDOMEN TOTAL",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["duplicado"] is False
    assert data["pedido"] is None

    # 3. Adiciona pedido ativo de Ultrassonografia
    exame_ativo = ExameFila(
        paciente_id=pac.id,
        exame="ULTRASSONOGRAFIA ABDOMEN TOTAL",
        codigo_procedimento="0205020186",
        tipo_fila="ULTRASSONOGRAFIA",
        status="aguardando",
        data_pedido=date(2026, 11, 1),
        medico_nome="Dr. Radiologista",
        unidade_nome="PSF Bela Vista",
        codigo_curto="EX-000123",
        ativo=True,
    )
    session.add(exame_ativo)
    session.commit()

    # 4. Consulta mesmo procedimento -> Detecta duplicidade
    res2 = client.get("/api/tfd/exames/verificar-duplicidade", params={
        "paciente_id": pac.id,
        "codigo_procedimento": "0205020186",
    })
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["duplicado"] is True
    assert data2["pedido"]["id"] == exame_ativo.id
    assert data2["pedido"]["codigo_curto"] == "EX-000123"
    assert data2["pedido"]["status"] == "aguardando"
    assert data2["pedido"]["profissional"] == "Dr. Radiologista"
    assert data2["pedido"]["unidade"] == "PSF Bela Vista"

    # 5. Consulta procedimento diferente (ex: Raio-X) -> Não duplicado
    res3 = client.get("/api/tfd/exames/verificar-duplicidade", params={
        "paciente_id": pac.id,
        "codigo_procedimento": "0204010170",
        "procedimento_nome": "RADIOGRAFIA DE TORAX",
    })
    assert res3.status_code == 200
    assert res3.json()["duplicado"] is False

    # 6. Teste de Consultas Especializadas (mesmo CBO 225120 Cardiologia)
    consulta_cardio = ExameFila(
        paciente_id=pac.id,
        exame="CONSULTA MEDICA EM ATENCAO ESPECIALIZADA",
        codigo_procedimento="0301010072",
        codigo_especialidade="225120",
        nome_especialidade="MEDICO CARDIOLOGISTA",
        especialidade="CARDIOLOGIA",
        tipo_fila="CONSULTAS ESPECIALIZADAS",
        status="aguardando",
        data_pedido=date(2026, 11, 2),
        medico_nome="Dra. Cardiologista",
        unidade_nome="PSF Centro",
        codigo_curto="EX-000124",
        ativo=True,
    )
    session.add(consulta_cardio)
    session.commit()

    # Nova tentativa de Cardiologia (mesmo CBO) -> Detecta duplicidade
    res_cardio = client.get("/api/tfd/exames/verificar-duplicidade", params={
        "paciente_id": pac.id,
        "codigo_procedimento": "0301010072",
        "codigo_especialidade": "225120",
        "tipo_fila": "CONSULTAS ESPECIALIZADAS",
    })
    assert res_cardio.status_code == 200
    assert res_cardio.json()["duplicado"] is True
    assert res_cardio.json()["pedido"]["codigo_curto"] == "EX-000124"

    # Nova tentativa de Dermatologia (CBO diferente 225135) -> Não duplicado!
    res_dermato = client.get("/api/tfd/exames/verificar-duplicidade", params={
        "paciente_id": pac.id,
        "codigo_procedimento": "0301010072",
        "codigo_especialidade": "225135",
        "especialidade_nome": "DERMATOLOGIA",
        "tipo_fila": "CONSULTAS ESPECIALIZADAS",
    })
    assert res_dermato.status_code == 200
    assert res_dermato.json()["duplicado"] is False


def test_duplicidade_lab(session: Session, client: TestClient):
    # 1. Cria paciente e laboratório
    pac = Paciente(
        id=20,
        nome="Paciente Teste Lab Duplicado",
        cpf="98765432100",
        cns="700000000000002",
        nascimento=date(1985, 5, 20),
        telefone="35999990002",
        endereco="Rua das Flores, 50",
        endereco_numero="50",
        bairro="Aparecida",
        cep="37177000",
        observacoes="",
    )
    session.add(pac)

    lab = Laboratorio(
        id=1,
        nome="Laboratório Central de Guapé",
        ativo=True,
    )
    session.add(lab)

    proc_hemo = SigtapProcedimento(
        id=50,
        codigo="0202010180",
        descricao="HEMOGRAMA COMPLETO",
        complexidade="AB",
        sexo="I",
        valor_sa=4.11,
        valor_sp=0.0,
        valor_sh=0.0,
        financiamento="01",
    )
    session.add(proc_hemo)
    session.commit()

    # 2. Inicialmente sem pedido -> Não duplicado
    res = client.get("/api/exames/verificar-duplicidade", params={
        "paciente_id": pac.id,
        "sigtap_id": proc_hemo.id,
    })
    assert res.status_code == 200
    assert res.json()["duplicado"] is False

    # 3. Cria agendamento em SolicitacaoMestre com ItemSolic
    solic = SolicitacaoMestre(
        id=101,
        paciente_id=pac.id,
        data_agendada=date(2026, 11, 10),
        hora_agendada="07:30",
        laboratorio_id=lab.id,
        status="agendado",
        medico_solicitante="Dr. Clinico Geral",
        unidade_psf="PSF Centro",
    )
    session.add(solic)
    session.flush()

    item = ItemSolic(
        solicitacao_id=solic.id,
        sigtap_id=proc_hemo.id,
        quantidade=1,
    )
    session.add(item)
    session.commit()

    # 4. Verifica duplicidade por sigtap_id -> Detecta duplicidade
    res2 = client.get("/api/exames/verificar-duplicidade", params={
        "paciente_id": pac.id,
        "sigtap_id": proc_hemo.id,
    })
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["duplicado"] is True
    assert data2["pedido"]["id"] == 101
    assert data2["pedido"]["tipo"] == "agendamento"
    assert "HEMOGRAMA" in data2["pedido"]["procedimento"]
    assert data2["pedido"]["profissional"] == "Dr. Clinico Geral"
    assert data2["pedido"]["unidade"] == "PSF Centro"

    # 5. Testa Fila PSF: paciente 30 na fila
    pac3 = Paciente(
        id=30,
        nome="Paciente Fila PSF",
        cpf="11122233344",
        cns="700000000000003",
        nascimento=date(1995, 3, 15),
        telefone="35999990003",
        endereco="Av Central, 200",
        endereco_numero="200",
        bairro="Centro",
        cep="37177000",
        observacoes="",
    )
    session.add(pac3)
    session.flush()

    fila_psf = FilaPsf(
        paciente_id=pac3.id,
        unidade_psf="PSF Bela Vista",
        medico_solicitante="Dra. Medica PSF",
        data_solicitacao=date(2026, 11, 3),
        status="na_fila",
        observacoes=f"Exames: HEMOGRAMA COMPLETO | SIGTAP_IDS:[{proc_hemo.id}]",
    )
    session.add(fila_psf)
    session.commit()

    res_fila = client.get("/api/exames/verificar-duplicidade", params={
        "paciente_id": pac3.id,
        "sigtap_id": proc_hemo.id,
    })
    assert res_fila.status_code == 200
    data_fila = res_fila.json()
    assert data_fila["duplicado"] is True
    assert data_fila["pedido"]["tipo"] == "fila_psf"
    assert data_fila["pedido"]["id"] == fila_psf.id
    assert "Na Fila de Espera PSF" in data_fila["pedido"]["status_rotulo"]
