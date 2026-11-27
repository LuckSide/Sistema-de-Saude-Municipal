"""Testes para Fila de Exames de Sangue (FilaPsf):
- Comprovante de inclusão na fila (não agendado) via serviço e rota GET /api/exames/fila-psf/{fid}/comprovante
- Numeração única de pedidos (codigo_solicitacao / numero_pedido) e backfill idempotente
- Busca por codigo_solicitacao e filtro por prioridade em GET /api/exames/fila-psf
"""

import json
from datetime import date

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.deps import get_current_user_senha_ok, get_db
from app.main import app
from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import FilaPsf, ItemSolic, Laboratorio, SolicitacaoMestre
from app.models.tfd import ExameFila, Paciente
from app.models.user import User
from app.api.v1.tfd import gerar_dados_comprovante_tfd
from app.services.lab_fase6 import (
    backfill_codigos_fila_psf,
    gerar_comprovante_agendamento,
    gerar_comprovante_fila_psf,
)


@pytest.fixture(name="db_session")
def db_session_fixture():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        lab = Laboratorio(nome="Labcon Análises Clínicas", ativo=True)
        p1 = SigtapProcedimento(
            codigo="0202010473",
            descricao="HEMOGRAMA COMPLETO",
            instrumento="BPA-C",
            valor_sa=4.11,
        )
        p2 = SigtapProcedimento(
            codigo="0202010295",
            descricao="DOSAGEM DE GLICOSE",
            instrumento="BPA-C",
            valor_sa=1.85,
        )
        pac = Paciente(
            nome="Maria das Dores Souza",
            cpf="123.456.789-00",
            cns="700000000000099",
            nascimento=date(1982, 4, 15),
            endereco="Rua Bahia",
            endereco_numero="120",
            bairro="Centro",
            municipio="Guapé",
            codigo_prontuario="PR-554433",
        )
        session.add_all([lab, p1, p2, pac])
        session.commit()
        session.refresh(lab)
        session.refresh(p1)
        session.refresh(p2)
        session.refresh(pac)
        yield session


@pytest.fixture(name="client")
def client_fixture(db_session: Session):
    admin_user = User(
        id=99,
        username="coord_psf",
        nome="Coordenação Saúde",
        password_hash="x",
        is_superuser=True,
        is_active=True,
        telas="lab,lab_fila,lab_marcacao",
    )

    def _override_db():
        yield db_session

    def _override_user():
        return admin_user

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user_senha_ok] = _override_user
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_comprovante_inclusao_fila_psf_nao_e_agendamento(db_session: Session, client: TestClient):
    pac = db_session.exec(select(Paciente)).first()
    procs = list(db_session.exec(select(SigtapProcedimento)).all())

    # Cria pedido via API POST /api/exames/fila-psf
    resp_create = client.post(
        "/api/exames/fila-psf",
        json={
            "paciente_id": pac.id,
            "especialidade": "Clínica Geral",
            "unidade_psf": "PSF Central Guapé",
            "medico_solicitante": "Dra. Ana Paula",
            "data_solicitacao": "2026-11-20",
            "data_pedido": "2026-11-20",
            "prioridade": "urgente",
            "justificativa": "Investigação clínica de anemia ferropriva persistente",
            "sigtap_ids": [procs[0].id, procs[0].id, procs[1].id],
            "tipo_fila": "EX. LAB. PSF ROTINA",
            "unidade_saude_id": 1,
        },
    )
    assert resp_create.status_code == 201, resp_create.text
    criado = resp_create.json()
    assert criado["codigo_solicitacao"].startswith("SL-")
    assert criado["numero_pedido"] == criado["codigo_solicitacao"]
    assert criado["paciente_endereco"] == "Rua Bahia"
    assert criado["paciente_bairro"] == "Centro"

    # Chama GET /api/exames/fila-psf/{fid}/comprovante
    resp_comp = client.get(f"/api/exames/fila-psf/{criado['id']}/comprovante")
    assert resp_comp.status_code == 200, resp_comp.text
    comp = resp_comp.json()

    # Deve representar inclusão na fila (NÃO agendamento/coleta)
    assert comp["tipo_comprovante"] == "inclusao_fila"
    assert comp["status"] == "na_fila"
    assert comp["data_agendada"] == ""
    assert comp["hora_agendada"] == ""
    assert comp["data_pedido"] == "2026-11-20"
    assert comp["data_solicitacao"] == "2026-11-20"
    assert comp["laboratorio_nome"] == "A definir no agendamento / Fila Municipal"
    assert comp["codigo_solicitacao"] == criado["codigo_solicitacao"]
    assert comp["numero_pedido"] == criado["codigo_solicitacao"]
    assert comp["protocolo"] == criado["codigo_solicitacao"]
    assert comp["qr_code_url"]
    assert comp["exige_preparo"] is False
    assert comp["paciente_nome"] == pac.nome
    assert comp["paciente_cpf"] == pac.cpf
    assert comp["paciente_prontuario"] == "PR-554433"
    assert comp["justificativa"] == "Investigação clínica de anemia ferropriva persistente"
    assert len(comp["orientacoes_gerais"]) >= 3

    # Quantidades dos procedimentos agregadas corretamente (2x Hemograma, 1x Glicose)
    assert len(comp["itens"]) == 2
    qtd_by_cod = {it["procedimento_codigo"]: it["quantidade"] for it in comp["itens"]}
    assert qtd_by_cod["0202010473"] == 2
    assert qtd_by_cod["0202010295"] == 1


def test_comprovante_fila_psf_404_e_geracao_codigo_legado(db_session: Session):
    with pytest.raises(HTTPException) as exc:
        gerar_comprovante_fila_psf(db_session, 999999)
    assert exc.value.status_code == 404

    pac = db_session.exec(select(Paciente)).first()
    proc = db_session.exec(select(SigtapProcedimento)).first()
    legado = FilaPsf(
        codigo_solicitacao="",
        paciente_id=pac.id,
        especialidade="Pediatria",
        unidade_psf="PSF Rural",
        medico_solicitante="Dr. João",
        data_solicitacao=date(2026, 10, 5),
        data_pedido=date(2026, 10, 5),
        status="na_fila",
        justificativa="Solicitação legada sem protocolo preenchido",
        sigtap_ids_json=json.dumps([proc.id]),
    )
    db_session.add(legado)
    db_session.commit()
    db_session.refresh(legado)

    comp = gerar_comprovante_fila_psf(db_session, legado.id)
    db_session.refresh(legado)
    assert legado.codigo_solicitacao.startswith("SL-")
    assert comp["codigo_solicitacao"] == legado.codigo_solicitacao
    assert comp["tipo_comprovante"] == "inclusao_fila"


def test_backfill_codigos_fila_psf_idempotente_e_unico(db_session: Session):
    pac = db_session.exec(select(Paciente)).first()
    lab = db_session.exec(select(Laboratorio)).first()

    # Código já existente em SolicitacaoMestre e em um registro da FilaPsf
    mestre = SolicitacaoMestre(
        codigo_solicitacao="SL-2611-111111",
        paciente_id=pac.id,
        data_agendada=date(2026, 11, 10),
        laboratorio_id=lab.id,
        status="agendado",
    )
    f_com_codigo = FilaPsf(
        codigo_solicitacao="SL-2611-222222",
        paciente_id=pac.id,
        especialidade="Rotina",
        unidade_psf="PSF Centro",
        medico_solicitante="Dr. Teste",
        data_solicitacao=date(2026, 11, 1),
        status="na_fila",
    )
    f_sem_codigo_1 = FilaPsf(
        codigo_solicitacao="",
        paciente_id=pac.id,
        especialidade="Rotina",
        unidade_psf="PSF Centro",
        medico_solicitante="Dr. Teste",
        data_solicitacao=date(2026, 11, 2),
        data_pedido=date(2026, 11, 2),
        status="na_fila",
    )
    f_sem_codigo_2 = FilaPsf(
        codigo_solicitacao="   ",
        paciente_id=pac.id,
        especialidade="Hiperdia",
        unidade_psf="PSF Bairro",
        medico_solicitante="Dra. Maria",
        data_solicitacao=date(2026, 11, 3),
        status="na_fila",
    )
    db_session.add_all([mestre, f_com_codigo, f_sem_codigo_1, f_sem_codigo_2])
    db_session.commit()

    # Primeira execução: preenche apenas os 2 registros sem código válido
    atualizados_1 = backfill_codigos_fila_psf(db_session)
    assert atualizados_1 == 2

    db_session.refresh(f_com_codigo)
    db_session.refresh(f_sem_codigo_1)
    db_session.refresh(f_sem_codigo_2)

    assert f_com_codigo.codigo_solicitacao == "SL-2611-222222"
    assert f_sem_codigo_1.codigo_solicitacao.startswith("SL-")
    assert f_sem_codigo_2.codigo_solicitacao.startswith("SL-")
    codigos = {
        mestre.codigo_solicitacao,
        f_com_codigo.codigo_solicitacao,
        f_sem_codigo_1.codigo_solicitacao,
        f_sem_codigo_2.codigo_solicitacao,
    }
    assert len(codigos) == 4

    # Segunda execução: 100% idempotente (0 atualizações)
    atualizados_2 = backfill_codigos_fila_psf(db_session)
    assert atualizados_2 == 0

    # Também funciona passando SQLAlchemy Connection diretamente (como no init_db)
    f_sem_codigo_3 = FilaPsf(
        codigo_solicitacao="",
        paciente_id=pac.id,
        especialidade="Pré-Natal",
        unidade_psf="PSF Sul",
        medico_solicitante="Dr. Lucas",
        data_solicitacao=date(2026, 11, 4),
        status="na_fila",
    )
    db_session.add(f_sem_codigo_3)
    db_session.commit()

    with db_session.get_bind().begin() as conn:
        atualizados_conn = backfill_codigos_fila_psf(conn)
        assert atualizados_conn == 1
        assert backfill_codigos_fila_psf(conn) == 0
    db_session.expire_all()
    db_session.refresh(f_sem_codigo_3)
    assert f_sem_codigo_3.codigo_solicitacao.startswith("SL-")


def test_busca_por_codigo_solicitacao_e_filtro_prioridade(db_session: Session, client: TestClient):
    pac = db_session.exec(select(Paciente)).first()
    f_urgente = FilaPsf(
        codigo_solicitacao="SL-2611-889900",
        paciente_id=pac.id,
        especialidade="Cardiologia",
        unidade_psf="PSF Central",
        medico_solicitante="Dr. Marcos",
        data_solicitacao=date(2026, 11, 15),
        data_pedido=date(2026, 11, 15),
        prioridade="urgente",
        status="na_fila",
        justificativa="Dor torácica em investigação urgente",
    )
    f_rotina = FilaPsf(
        codigo_solicitacao="SL-2611-776655",
        paciente_id=pac.id,
        especialidade="Clínica Geral",
        unidade_psf="PSF Central",
        medico_solicitante="Dra. Paula",
        data_solicitacao=date(2026, 11, 14),
        data_pedido=date(2026, 11, 14),
        prioridade="rotina",
        status="na_fila",
        justificativa="Checkup anual de rotina clínica",
    )
    db_session.add_all([f_urgente, f_rotina])
    db_session.commit()

    # Busca por número do pedido (codigo_solicitacao)
    r_cod = client.get("/api/exames/fila-psf", params={"q": "889900"})
    assert r_cod.status_code == 200
    d_cod = r_cod.json()
    assert d_cod["total"] == 1
    assert d_cod["data"][0]["codigo_solicitacao"] == "SL-2611-889900"
    assert d_cod["data"][0]["numero_pedido"] == "SL-2611-889900"

    # Filtro por prioridade = urgente
    r_urg = client.get("/api/exames/fila-psf", params={"prioridade": "urgente"})
    assert r_urg.status_code == 200
    d_urg = r_urg.json()
    assert d_urg["total"] == 1
    assert d_urg["data"][0]["prioridade"] == "urgente"

    # Filtro por prioridade = rotina
    r_rot = client.get("/api/exames/fila-psf", params={"prioridade": "rotina"})
    assert r_rot.status_code == 200
    d_rot = r_rot.json()
    assert d_rot["total"] == 1
    assert d_rot["data"][0]["prioridade"] == "rotina"


def test_comprovante_exame_cancelado_nao_exibe_data_ou_jejum(db_session: Session):
    pac = db_session.exec(select(Paciente)).first()
    lab = db_session.exec(select(Laboratorio)).first()
    proc = db_session.exec(select(SigtapProcedimento)).first()

    mestre = SolicitacaoMestre(
        codigo_solicitacao="SL-2611-653198",
        paciente_id=pac.id,
        data_agendada=date(2026, 11, 25),
        hora_agendada="07:00",
        laboratorio_id=lab.id,
        status="cancelado",
        observacao_laboratorio="Paciente desistiu da coleta",
    )
    db_session.add(mestre)
    db_session.commit()
    db_session.refresh(mestre)

    item = ItemSolic(
        solicitacao_id=mestre.id,
        sigtap_id=proc.id,
        quantidade=1,
    )
    db_session.add(item)
    db_session.commit()

    comp = gerar_comprovante_agendamento(db_session, mestre.id)
    assert comp["tipo_comprovante"] == "cancelado"
    assert comp["origem_modulo"] == "laboratorio"
    assert comp["data_agendada"] == ""
    assert comp["hora_agendada"] == ""
    assert comp["jejum_horas"] == ""
    assert comp["preparo_instrucoes"] == []
    assert comp["orientacoes_gerais"] == []
    assert comp["exige_preparo"] is False
    assert comp["motivo_cancelamento"] == "Paciente desistiu da coleta"
    assert "T" not in comp["emitido_em"]


def test_comprovante_solicitacao_tfd_distinto_e_sem_data_quando_na_fila_ou_cancelado(db_session: Session):
    pac = db_session.exec(select(Paciente)).first()

    # 1) Solicitação aguardando na fila: não pode vazar data_pedido como data_agendada nem hora padrão 07:30
    ex_fila = ExameFila(
        paciente_id=pac.id,
        exame="ULTRASSONOGRAFIA DE ABDOMEN TOTAL",
        especialidade="Radiologia",
        nome_especialidade="Radiologia",
        tipo_fila="ULTRASSONOGRAFIA",
        codigo_procedimento="0205020046",
        status="aguardando",
        prioridade="urgente",
        data_pedido=date(2026, 11, 20),
        unidade_nome="ESF Aparecida",
        medico_nome="Dra. Helena",
        justificativa="Dor abdominal recorrente",
        numero_pedido="SL-2611-165256",
    )
    # 2) Solicitação cancelada: sem data agendada, sem hora e sem jejum/preparo
    ex_canc = ExameFila(
        paciente_id=pac.id,
        exame="HEMOGRAMA COMPLETO",
        especialidade="Clínica Médica",
        tipo_fila="EXAMES LABORATORIAIS",
        codigo_procedimento="0202010473",
        status="cancelado",
        prioridade="rotina",
        data_pedido=date(2026, 11, 18),
        data_agendada=date(2026, 11, 25),
        hora_agendada="07:00",
        motivo_remocao="Solicitação duplicada",
        numero_pedido="SL-2611-653199",
    )
    # 3) Solicitação agendada (não-sangue)
    ex_agendada = ExameFila(
        paciente_id=pac.id,
        exame="CONSULTA EM CARDIOLOGIA",
        especialidade="Cardiologia",
        nome_especialidade="Cardiologia",
        tipo_fila="CONSULTAS ESPECIALIZADAS",
        status="agendado",
        prioridade="alta",
        data_pedido=date(2026, 11, 10),
        data_agendada=date(2026, 12, 5),
        hora_agendada="09:30",
        destino="Policlínica Regional",
        unidade_nome="ESF Centro",
        numero_pedido="SL-2611-777888",
    )
    db_session.add_all([ex_fila, ex_canc, ex_agendada])
    db_session.commit()
    db_session.refresh(ex_fila)
    db_session.refresh(ex_canc)
    db_session.refresh(ex_agendada)

    c_fila = gerar_dados_comprovante_tfd(db_session, ex_fila)
    assert c_fila["origem_modulo"] == "solicitacao"
    assert c_fila["tipo_comprovante"] == "inclusao_fila"
    assert c_fila["data_agendada"] == ""
    assert c_fila["hora_agendada"] == ""
    assert c_fila["data_pedido"] == "2026-11-20"
    assert c_fila["exige_preparo"] is False
    assert c_fila["jejum_horas"] == ""
    assert c_fila["tipo_fila"] == "ULTRASSONOGRAFIA"
    assert c_fila["prioridade"] == "urgente"

    c_canc = gerar_dados_comprovante_tfd(db_session, ex_canc)
    assert c_canc["origem_modulo"] == "solicitacao"
    assert c_canc["tipo_comprovante"] == "cancelado"
    assert c_canc["data_agendada"] == ""
    assert c_canc["hora_agendada"] == ""
    assert c_canc["jejum_horas"] == ""
    assert c_canc["preparo_instrucoes"] == []
    assert c_canc["exige_preparo"] is False
    assert c_canc["motivo_cancelamento"] == "Solicitação duplicada"

    c_ag = gerar_dados_comprovante_tfd(db_session, ex_agendada)
    assert c_ag["origem_modulo"] == "solicitacao"
    assert c_ag["tipo_comprovante"] == "agendamento"
    assert c_ag["data_agendada"] == "2026-12-05"
    assert c_ag["hora_agendada"] == "09:30"
    assert c_ag["destino"] == "Policlínica Regional"
    assert c_ag["exige_preparo"] is False
