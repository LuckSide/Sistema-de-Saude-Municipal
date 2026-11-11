from datetime import date, timedelta

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.core.deps import get_current_user_senha_ok, get_db
from app.main import app
from app.models.cadastros_saude import Medico, UnidadeSaude
from app.models.lab_exames import SigtapProcedimento
from app.models.tfd import Paciente, ProcedimentoCatalogo
from app.models.user import User
from app.services.sigtap_hierarquia import normalizar_tipo_fila


@pytest.fixture(name="session")
def session_fixture():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        uni = UnidadeSaude(id=1, nome="Policlínica Municipal", cnes="1234567", ativo=True)
        med = Medico(id=1, nome="Médico da Unidade / Responsável Técnico", crm="RESP. TÉCNICO", cbo_codigo="225125", ativo=True)
        pac = Paciente(id=1, nome="Maria da Silva", cpf="11122233344", municipio="Guapé")
        # Banco sem todas as filas carregadas para validar fallback + acentuação + ordenação
        proc_acento = ProcedimentoCatalogo(
            id=1,
            codigo="0409030031",
            nome="RESSECCAO ENDOSCOPICA DA PRÓSTATA",
            tipo_fila="CIRURGIAS",
            codigo_curto="CIR",
            ativo=True,
        )
        sig = SigtapProcedimento(
            codigo="0204030188",
            descricao="RADIOGRAFIA DE TORAX (PA E PERFIL)",
            complexidade="Média Complexidade",
            instrumento="BPA-C",
        )
        db.add_all([uni, med, pac, proc_acento, sig])
        db.commit()
        yield db


def _usuario(telas: str, *, unidade_id: int | None = None, permite_retroativo: bool = True) -> User:
    return User(
        id=50,
        username="op_teste",
        password_hash="hash",
        nome="Operador Teste",
        telas=telas,
        unidade_saude_id=unidade_id,
        permite_retroativo=permite_retroativo,
        is_superuser=False,
        is_active=True,
        must_change_password=False,
    )


def test_catalogo_procedimentos_cirurgias_fallback_acentos_e_retorno(session: Session):
    operador = _usuario("tfd_exames")
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_current_user_senha_ok] = lambda: operador
    try:
        client = TestClient(app)

        # 1. Busca sem acento encontra procedimento acentuado ("PRÓSTATA")
        res_acento = client.get("/api/tfd/exames/catalogo", params={"q": "prostata", "tipo_fila": "CIRURGIAS"})
        assert res_acento.status_code == 200
        assert any("PRÓSTATA" in item["nome_procedimento"] for item in res_acento.json())

        # 2. Fila ausente no banco local (ex: BIOPSIA) usa fallback do CSV oficial do Vivver
        res_biopsia = client.get("/api/tfd/exames/catalogo", params={"tipo_fila": "BIOPSIA"})
        assert res_biopsia.status_code == 200
        assert len(res_biopsia.json()) >= 5
        assert any("BIOPSIA" in item["nome_procedimento"] or "BIÓPSIA" in item["nome_procedimento"] for item in res_biopsia.json())

        # 3. Busca com acento ("tórax") encontra SIGTAP sem acento ("TORAX")
        res_sig = client.get("/api/tfd/exames/catalogo", params={"q": "tórax", "tipo_fila": "EXAME RADIOLOGICO CONTRASTADO E TFD"})
        assert res_sig.status_code == 200
        assert any(item["codigo_procedimento"] == "0204030188" for item in res_sig.json())

        # 4. RETORNO CONSULTA ESPECIALIZADA não colapsa para CONSULTAS ESPECIALIZADAS
        assert normalizar_tipo_fila("RETORNO CONSULTA ESPECIALIZADA") == ("RETORNO CONSULTA ESPECIALIZADA", "RCES")
    finally:
        app.dependency_overrides.clear()


def test_retroativo_permitido_nao_conflita_com_unidade_nem_com_tfd_exames(session: Session):
    ontem = (date.today() - timedelta(days=3)).isoformat()
    app.dependency_overrides[get_db] = lambda: session
    try:
        client = TestClient(app)

        # 1. Operador com unidade vinculada + tfd_exames + permite_retroativo=True consegue lançar retroativo (individual e lote)
        op_com_unidade = _usuario("tfd_exames", unidade_id=1, permite_retroativo=True)
        app.dependency_overrides[get_current_user_senha_ok] = lambda: op_com_unidade
        res_ind = client.post(
            "/api/tfd/exames",
            json={
                "paciente_id": 1,
                "exame": "ULTRASSONOGRAFIA ABDOMINAL TOTAL",
                "tipo_fila": "ULTRASSONOGRAFIA",
                "data_pedido": ontem,
                "justificativa": "Investigação clínica retroativa solicitada em unidade",
                "unidade_saude_id": 1,
                "medico_id": 1,
            },
        )
        assert res_ind.status_code == 201, res_ind.text
        assert res_ind.json()["data_pedido"] == ontem

        res_lote = client.post(
            "/api/tfd/exames/lote",
            json={
                "tipo_fila": "CIRURGIAS",
                "exame": "HERNIORRAFIA INGUINAL",
                "data_pedido": ontem,
                "justificativa_padrao": "Cadastro retroativo em lote autorizado para operador",
                "unidade_saude_id": 1,
                "medico_id": 1,
                "itens": [{"paciente_id": 1}],
            },
        )
        assert res_lote.status_code == 201, res_lote.text

        # 2. Operador que marcou módulo TFD completo (incluindo tfd_fila_lancamento) + permite_retroativo=True também lança retroativo
        op_tudo = _usuario("tfd,tfd_exames,tfd_fila_lancamento", unidade_id=1, permite_retroativo=True)
        app.dependency_overrides[get_current_user_senha_ok] = lambda: op_tudo
        res_tudo = client.post(
            "/api/tfd/exames",
            json={
                "paciente_id": 1,
                "exame": "ELETROCARDIOGRAMA",
                "tipo_fila": "EXAMES CARDIOLOGICOS",
                "data_pedido": ontem,
                "justificativa": "Pedido retroativo com permissão completa de fila",
                "unidade_saude_id": 1,
                "medico_id": 1,
            },
        )
        assert res_tudo.status_code == 201, res_tudo.text

        # 3. Operador sem permissão retroativa (permite_retroativo=False) é bloqueado tanto no individual quanto no lote
        op_bloqueado = _usuario("tfd_exames", unidade_id=1, permite_retroativo=False)
        app.dependency_overrides[get_current_user_senha_ok] = lambda: op_bloqueado
        assert client.post(
            "/api/tfd/exames",
            json={
                "paciente_id": 1,
                "exame": "ELETROCARDIOGRAMA",
                "tipo_fila": "EXAMES CARDIOLOGICOS",
                "data_pedido": ontem,
                "justificativa": "Tentativa sem permissão retroativa individual",
                "unidade_saude_id": 1,
                "medico_id": 1,
            },
        ).status_code == 403
        assert client.post(
            "/api/tfd/exames/lote",
            json={
                "tipo_fila": "CIRURGIAS",
                "exame": "HERNIORRAFIA INGUINAL",
                "data_pedido": ontem,
                "justificativa_padrao": "Tentativa sem permissão retroativa em lote",
                "unidade_saude_id": 1,
                "medico_id": 1,
                "itens": [{"paciente_id": 1}],
            },
        ).status_code == 403
    finally:
        app.dependency_overrides.clear()
