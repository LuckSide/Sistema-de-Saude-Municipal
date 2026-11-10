from datetime import date, timedelta
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.v1.auth import get_current_user
from app.api.v1.farmacia import get_db
from app.main import app
from app.models.farmacia import (
    Medicamento,
    MovimentacaoMedicamento,
    InsumoInterno,
    MovimentacaoInsumo,
    FarmaciaLinkPublico,
)
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
    with Session(engine) as db:
        yield db


@pytest.fixture(name="client")
def client_fixture(session: Session):
    admin = User(
        username="admin",
        nome="Farmacêutico Responsável",
        is_superuser=True,
        ativo=True,
        must_change_password=False,
        password_hash="mock",
        telas="farmacia,farmacia_estoque,farmacia_validade,farmacia_links,farmacia_insumos",
    )

    def get_db_override():
        yield session

    def get_current_user_override():
        return admin

    app.dependency_overrides[get_db] = get_db_override
    app.dependency_overrides[get_current_user] = get_current_user_override

    yield TestClient(app)

    app.dependency_overrides.clear()


def test_fluxo_completo_farmacia(client: TestClient, session: Session):
    hoje = date.today()

    # 1. Resumo inicial (cria automaticamente dados iniciais se vazio)
    res = client.get("/api/farmacia/resumo")
    assert res.status_code == 200
    resumo = res.json()
    assert resumo["total_medicamentos"] >= 6
    assert resumo["total_insumos"] >= 5

    # 2. Cadastro de Medicamento Novo
    payload_med = {
        "codigo": "MED-TEST-99",
        "nome": "Ibuprofeno Gotas 100mg/ml",
        "principio_ativo": "Ibuprofeno",
        "dosagem": "100 mg/ml",
        "forma_farmaceutica": "Suspensão Oral",
        "unidade_medida": "frasco",
        "categoria": "Básico / Atenção Primária",
        "fabricante": "EMS",
        "lote": "L-TEST99",
        "validade": (hoje + timedelta(days=15)).isoformat(),  # < 30 dias -> PROXIMO_VENCIMENTO
        "estoque_atual": 50,
        "estoque_minimo": 20,
        "requer_receita": False,
        "controlado": False,
        "localizacao_prateleira": "Prateleira C · Frascos",
        "observacoes": "Uso pediátrico e adulto",
        "ativo": True,
    }
    res_cad = client.post("/api/farmacia/medicamentos", json=payload_med)
    assert res_cad.status_code == 200
    med_criado = res_cad.json()
    med_id = med_criado["id"]
    assert med_criado["status_validade"] == "PROXIMO_VENCIMENTO"
    assert "Faltam 15 dias" in med_criado["contagem_regressiva_texto"]

    # 3. Listagem com busca inteligente
    res_list = client.get("/api/farmacia/medicamentos?q=ibuprofeno")
    assert res_list.status_code == 200
    itens = res_list.json()
    assert len(itens) == 1
    assert itens[0]["nome"] == "Ibuprofeno Gotas 100mg/ml"

    # 4. Movimentação de Saída / Dispensação para Paciente
    payload_saida = {
        "medicamento_id": med_id,
        "tipo": "SAIDA_DISPENSACAO",
        "quantidade": 10,
        "lote": "L-TEST99",
        "documento_referencia": "REC-2026-9988",
        "paciente_nome": "João da Silva",
        "paciente_cpf": "123.456.789-00",
        "prescritor_nome": "Dra. Maria Pediátrica",
        "prescritor_crm": "12345/MG",
    }
    res_mov = client.post("/api/farmacia/medicamentos/movimentar", json=payload_saida)
    assert res_mov.status_code == 200
    mov_data = res_mov.json()
    assert mov_data["saldo_anterior"] == 50
    assert mov_data["saldo_posterior"] == 40

    # 5. Validação de bloqueio quando saldo é insuficiente
    payload_excessivo = {
        "medicamento_id": med_id,
        "tipo": "SAIDA_DISPENSACAO",
        "quantidade": 100,  # tem apenas 40
    }
    res_erro = client.post("/api/farmacia/medicamentos/movimentar", json=payload_excessivo)
    assert res_erro.status_code == 400
    assert "insuficiente" in res_erro.json()["detail"].lower()

    # 6. Painel de Validade com Alertas e Contagem Regressiva
    res_val = client.get("/api/farmacia/validade?apenas_atencao=true")
    assert res_val.status_code == 200
    itens_val = res_val.json()
    assert len(itens_val) >= 2
    # Confere que os status são VENCIDO ou PROXIMO_VENCIMENTO
    for item in itens_val:
        assert item["status_validade"] in ("VENCIDO", "PROXIMO_VENCIMENTO")
        assert len(item["contagem_regressiva_texto"]) > 0

    # 7. Insumos Internos (Material de Consumo)
    payload_insumo = {
        "codigo": "INS-TEST-01",
        "nome": "Atadura de Crepom 15cm x 1,8m",
        "categoria": "Curativos",
        "unidade_medida": "unidade",
        "lote": "AT-2026",
        "validade": (hoje + timedelta(days=365)).isoformat(),
        "estoque_atual": 100,
        "estoque_minimo": 30,
        "local_armazenamento": "Almoxarifado Central · Corredor 2",
        "ativo": True,
    }
    res_ins = client.post("/api/farmacia/insumos", json=payload_insumo)
    assert res_ins.status_code == 200
    ins_criado = res_ins.json()
    ins_id = ins_criado["id"]

    # Movimentação de saída para PSF
    payload_saida_ins = {
        "insumo_id": ins_id,
        "tipo": "SAIDA_PSF",
        "quantidade": 25,
        "unidade_destino": "PSF Rural Santo Antônio",
        "responsavel_recebimento": "Enfermeira Chefe Carla",
        "documento_referencia": "REQUISICAO-PSF-42",
    }
    res_mov_ins = client.post("/api/farmacia/insumos/movimentar", json=payload_saida_ins)
    assert res_mov_ins.status_code == 200
    assert res_mov_ins.json()["saldo_posterior"] == 75

    # 8. Criação de Link Público e Consulta Externa
    # Modo Paciente: Quantidade DEVE ser omitida (segurança)
    payload_link_paciente = {
        "titulo": "Disponibilidade de Medicamentos Básicos - Cidadão",
        "tipo_perfil": "paciente",
        "mostrar_quantidade": False,
        "filtro_tipo": "todos",
    }
    res_link_p = client.post("/api/farmacia/links", json=payload_link_paciente)
    assert res_link_p.status_code == 200
    token_p = res_link_p.json()["token"]

    # Consulta pública do link paciente (sem autenticação)
    res_pub_p = client.get(f"/api/farmacia/publico/{token_p}")
    assert res_pub_p.status_code == 200
    data_pub_p = res_pub_p.json()
    assert data_pub_p["tipo_perfil"] == "paciente"
    assert len(data_pub_p["itens"]) > 0
    for it in data_pub_p["itens"]:
        # Segurança do Modo Paciente: quantidade NUNCA deve ser exposta
        assert it["quantidade_disponivel"] is None
        assert it["status_rotulo"] in ("Disponível", "Indisponível (Em Falta)")

    # Modo TV: Quantidade configurável (pode ser True)
    payload_link_tv = {
        "titulo": "Painel Sala de Espera - Recepção Farmácia",
        "tipo_perfil": "tv",
        "mostrar_quantidade": True,
        "filtro_tipo": "todos",
        "tempo_atualizacao_segundos": 45,
    }
    res_link_tv = client.post("/api/farmacia/links", json=payload_link_tv)
    assert res_link_tv.status_code == 200
    token_tv = res_link_tv.json()["token"]

    # Consulta pública do link TV
    res_pub_tv = client.get(f"/api/farmacia/publico/{token_tv}")
    assert res_pub_tv.status_code == 200
    data_pub_tv = res_pub_tv.json()
    assert data_pub_tv["tipo_perfil"] == "tv"
    assert data_pub_tv["mostrar_quantidade"] is True
    assert data_pub_tv["tempo_atualizacao_segundos"] == 45
    # Na TV com mostrar_quantidade=True, a quantidade numérica é enviada
    for it in data_pub_tv["itens"]:
        assert it["quantidade_disponivel"] is not None
