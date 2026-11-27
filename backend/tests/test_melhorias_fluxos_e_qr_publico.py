"""Testes de regressão para:
- Médico executante digitado livremente (sem cadastro prévio) no agendamento individual e em lote
- Liberação de médicos e unidades por tipo de fila de exame de sangue (TipoFila)
- Códigos compactos de exames de sangue (SL-XXXXXX) + diagnóstico/resolução de conflitos nas configurações
- QR Codes públicos (/acompanhar/{token}) para Solicitações, Fila PSF e Marcação Lab sem exposição de PII/sistema
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.v1.tfd import gerar_dados_comprovante_tfd
from app.core.deps import get_current_user_senha_ok, get_db
from app.main import app
from app.models.cadastros_saude import Medico, UnidadeSaude
from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import FilaPsf, ItemSolic, Laboratorio, SolicitacaoMestre
from app.models.tfd import ExameFila, Paciente, TipoFila
from app.models.user import User
from app.services.conflitos_codigos import analisar_e_resolver_codigos
from app.services.geradores import gerar_protocolo_lab_aleatorio
from app.services.lab_fase6 import gerar_comprovante_agendamento, gerar_comprovante_fila_psf


@pytest.fixture(name="db_session")
def db_session_fixture():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        u1 = UnidadeSaude(nome="PSF Central", cnes="2146479", ativo=True)
        u2 = UnidadeSaude(nome="PSF Rural", cnes="2147092", ativo=True)
        m1 = Medico(
            nome="Dr. Carlos Eduardo",
            crm="MG-11223",
            cbo_codigo="225120",
            cbo_descricao="Médico cardiologista",
            especialidade="Cardiologia",
            especialidades="Cardiologia, Clínica Médica",
            ativo=True,
        )
        m2 = Medico(
            nome="Dra. Fernanda Lima",
            crm="MG-44556",
            cbo_codigo="225124",
            cbo_descricao="Médico pediatra",
            especialidade="Pediatria",
            ativo=True,
        )
        lab = Laboratorio(nome="Laboratório Municipal Guapé", ativo=True)
        p1 = SigtapProcedimento(
            codigo="0202010473",
            descricao="HEMOGRAMA COMPLETO",
            instrumento="BPA-C",
            valor_sa=4.11,
        )
        pac = Paciente(
            nome="João Batista Ferreira",
            cpf="999.888.777-66",
            cns="700000000000111",
            nascimento=date(1975, 8, 20),
            codigo_prontuario="PR-123456",
        )
        session.add_all([u1, u2, m1, m2, lab, p1, pac])
        session.commit()
        for obj in (u1, u2, m1, m2, lab, p1, pac):
            session.refresh(obj)
        yield session


@pytest.fixture(name="client")
def client_fixture(db_session: Session):
    admin_user = User(
        id=1,
        username="admin_teste",
        nome="Admin SMS",
        password_hash="x",
        is_superuser=True,
        is_active=True,
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


def test_agendar_com_medico_executante_digitado_livre(db_session: Session, client: TestClient):
    pac = db_session.exec(select(Paciente)).first()
    uni = db_session.exec(select(UnidadeSaude)).first()
    ex1 = ExameFila(
        paciente_id=pac.id,
        exame="ULTRASSONOGRAFIA ABDOMINAL",
        especialidade="Radiologia",
        tipo_fila="ULTRASSONOGRAFIA",
        status="aguardando",
        prioridade="rotina",
        data_pedido=date(2026, 11, 10),
        justificativa="Investigação de dor abdominal persistente",
        codigo_curto="SL-110022",
        numero_pedido="SL-110022",
        public_token="tok_tfd_exec_1",
    )
    ex2 = ExameFila(
        paciente_id=pac.id,
        exame="ECOCARDIOGRAMA TRANSTORACICO",
        especialidade="Cardiologia",
        tipo_fila="EXAMES CARDIOLOGICOS",
        status="aguardando",
        prioridade="rotina",
        data_pedido=date(2026, 11, 11),
        justificativa="Avaliação cardiológica pré-operatória",
        codigo_curto="SL-110023",
        numero_pedido="SL-110023",
        public_token="tok_tfd_exec_2",
    )
    db_session.add_all([ex1, ex2])
    db_session.commit()
    db_session.refresh(ex1)
    db_session.refresh(ex2)

    # Individual com nome digitado livremente (medico_id=None)
    r_ind = client.put(
        f"/api/tfd/exames/{ex1.id}",
        json={
            "paciente_id": pac.id,
            "exame": ex1.exame,
            "especialidade": ex1.especialidade,
            "tipo_fila": ex1.tipo_fila,
            "prioridade": "rotina",
            "justificativa": ex1.justificativa,
            "status": "agendado",
            "data_pedido": "2026-11-10",
            "data_agendada": "2026-12-20",
            "hora_agendada": "09:15",
            "medico_id": None,
            "medico_nome": "Dr. Marcos Externo (Convênio BH)",
            "unidade_saude_id": uni.id,
        },
    )
    assert r_ind.status_code == 200, r_ind.text
    db_session.refresh(ex1)
    assert ex1.status == "agendado"
    assert ex1.medico_id is None
    assert ex1.medico_nome == "Dr. Marcos Externo (Convênio BH)"

    # Em lote com nome digitado livremente
    r_lote = client.put(
        "/api/tfd/exames/lote",
        json={
            "ids": [ex2.id],
            "status": "agendado",
            "data_agendada": "2026-12-22",
            "hora_agendada": "14:00",
            "medico_id": None,
            "medico_nome": "Dra. Paula Executante Externa",
            "unidade_saude_id": uni.id,
            "enviar_whatsapp": False,
        },
    )
    assert r_lote.status_code == 200, r_lote.text
    db_session.refresh(ex2)
    assert ex2.status == "agendado"
    assert ex2.medico_id is None
    assert ex2.medico_nome == "Dra. Paula Executante Externa"


def test_fila_sangue_restringe_unidades_e_medicos_liberados(db_session: Session, client: TestClient):
    unidades = list(db_session.exec(select(UnidadeSaude).order_by(UnidadeSaude.id)).all())
    medicos = list(db_session.exec(select(Medico).order_by(Medico.id)).all())
    proc = db_session.exec(select(SigtapProcedimento)).first()
    pac = db_session.exec(select(Paciente)).first()

    u_liberada, u_bloqueada = unidades[0], unidades[1]
    m_liberado, m_bloqueado = medicos[0], medicos[1]

    r_tf = client.post(
        "/api/tfd/tipos",
        json={
            "codigo": "LABROT",
            "nome": "EX. LAB. PSF ROTINA",
            "tipo_fila": "EXAME_LABORATORIAL",
            "ativo": True,
            "medicos_permitidos": f"[{m_liberado.id}]",
            "unidades_permitidas": f"[{u_liberada.id}]",
        },
    )
    assert r_tf.status_code == 201, r_tf.text
    fila_cfg = r_tf.json()
    assert fila_cfg["medicos_permitidos"] == f"[{m_liberado.id}]"
    assert fila_cfg["unidades_permitidas"] == f"[{u_liberada.id}]"

    # Unidade não liberada -> erro 400
    r_bad_u = client.post(
        "/api/exames/fila-psf",
        json={
            "paciente_id": pac.id,
            "especialidade": "Clínica Médica",
            "unidade_psf": u_bloqueada.nome,
            "unidade_saude_id": u_bloqueada.id,
            "medico_id": m_liberado.id,
            "medico_solicitante": m_liberado.nome,
            "justificativa": "Exame laboratorial de rotina anual para acompanhamento",
            "sigtap_ids": [proc.id],
            "fila_id": fila_cfg["id"],
            "tipo_fila": "EX. LAB. PSF ROTINA",
        },
    )
    assert r_bad_u.status_code == 400

    # Médico não liberado -> erro 400
    r_bad_m = client.post(
        "/api/exames/fila-psf",
        json={
            "paciente_id": pac.id,
            "especialidade": "Pediatria",
            "unidade_psf": u_liberada.nome,
            "unidade_saude_id": u_liberada.id,
            "medico_id": m_bloqueado.id,
            "medico_solicitante": m_bloqueado.nome,
            "justificativa": "Exame laboratorial de rotina anual para acompanhamento",
            "sigtap_ids": [proc.id],
            "fila_id": fila_cfg["id"],
            "tipo_fila": "EX. LAB. PSF ROTINA",
        },
    )
    assert r_bad_m.status_code == 400

    # Unidade e médico liberados -> 201 com código compacto SL-XXXXXX
    r_ok = client.post(
        "/api/exames/fila-psf",
        json={
            "paciente_id": pac.id,
            "especialidade": "Cardiologia",
            "unidade_psf": u_liberada.nome,
            "unidade_saude_id": u_liberada.id,
            "medico_id": m_liberado.id,
            "medico_solicitante": m_liberado.nome,
            "justificativa": "Exame laboratorial de rotina anual para acompanhamento",
            "sigtap_ids": [proc.id],
            "fila_id": fila_cfg["id"],
            "tipo_fila": "EX. LAB. PSF ROTINA",
        },
    )
    assert r_ok.status_code == 201, r_ok.text
    criado = r_ok.json()
    assert len(criado["codigo_solicitacao"]) <= 10
    assert criado["codigo_solicitacao"].startswith("SL-")


def test_codigos_sangue_compactos_e_resolucao_conflitos(db_session: Session, client: TestClient):
    pac = db_session.exec(select(Paciente)).first()
    lab = db_session.exec(select(Laboratorio)).first()

    # Gerador novo gera código compacto SL-XXXXXX (~9 chars)
    novos = [gerar_protocolo_lab_aleatorio(db=db_session) for _ in range(10)]
    assert all(c.startswith("SL-") and 9 <= len(c) <= 10 for c in novos)

    # Cria conflitos e código longo legado
    ex_tfd = ExameFila(
        paciente_id=pac.id,
        exame="TOMOGRAFIA DE CRANIO",
        especialidade="Radiologia",
        tipo_fila="TOMOGRAFIA",
        status="aguardando",
        data_pedido=date(2026, 11, 5),
        codigo_curto="SL-999111",
        numero_pedido="SL-999111",
    )
    f_colisao = FilaPsf(
        codigo_solicitacao="SL-999111",  # colide com TFD
        paciente_id=pac.id,
        especialidade="Rotina",
        unidade_psf="PSF Central",
        medico_solicitante="Dr. Carlos",
        data_solicitacao=date(2026, 11, 5),
        status="agendado",
    )
    f_longo = FilaPsf(
        codigo_solicitacao="LAB-20261105-987654",  # legado longo
        paciente_id=pac.id,
        especialidade="Rotina",
        unidade_psf="PSF Central",
        medico_solicitante="Dr. Carlos",
        data_solicitacao=date(2026, 11, 6),
        status="agendado",
    )
    db_session.add_all([ex_tfd, f_colisao, f_longo])
    db_session.commit()
    db_session.refresh(f_colisao)
    db_session.refresh(f_longo)

    m_vinc = SolicitacaoMestre(
        codigo_solicitacao="LAB-20261105-987654",
        paciente_id=pac.id,
        data_agendada=date(2026, 11, 20),
        laboratorio_id=lab.id,
        origem_fila_id=f_longo.id,
        status="agendado",
    )
    db_session.add(m_vinc)
    db_session.commit()
    db_session.refresh(m_vinc)

    r_diag = client.get("/api/settings/conflitos-codigos")
    assert r_diag.status_code == 200
    diag = r_diag.json()
    assert diag["total_pendencias"] >= 2

    r_res = client.post("/api/settings/resolver-conflitos-codigos")
    assert r_res.status_code == 200
    res = r_res.json()
    assert res["aplicado"] is True
    assert res["total_atualizados"] >= 3

    db_session.refresh(ex_tfd)
    db_session.refresh(f_colisao)
    db_session.refresh(f_longo)
    db_session.refresh(m_vinc)

    assert ex_tfd.codigo_curto == "SL-999111"
    assert f_colisao.codigo_solicitacao != "SL-999111"
    assert len(f_longo.codigo_solicitacao) <= 10
    assert m_vinc.codigo_solicitacao == f_longo.codigo_solicitacao

    # Idempotência
    assert analisar_e_resolver_codigos(db_session, aplicar=False)["total_pendencias"] == 0


def test_qr_comprovantes_apontam_para_acompanhamento_publico_sem_pii(db_session: Session, client: TestClient):
    pac = db_session.exec(select(Paciente)).first()
    lab = db_session.exec(select(Laboratorio)).first()
    proc = db_session.exec(select(SigtapProcedimento)).first()

    ex = ExameFila(
        paciente_id=pac.id,
        exame="CONSULTA EM CARDIOLOGIA",
        especialidade="Cardiologia",
        tipo_fila="CONSULTAS ESPECIALIZADAS",
        status="agendado",
        prioridade="rotina",
        data_pedido=date(2026, 11, 10),
        data_agendada=date(2026, 12, 15),
        hora_agendada="10:30",
        destino="Policlínica Regional",
        codigo_curto="SL-332211",
        numero_pedido="SL-332211",
    )
    fila = FilaPsf(
        codigo_solicitacao="SL-445566",
        paciente_id=pac.id,
        especialidade="Clínica Médica",
        unidade_psf="PSF Central",
        medico_solicitante="Dr. Carlos",
        data_solicitacao=date(2026, 11, 12),
        data_pedido=date(2026, 11, 12),
        status="na_fila",
        sigtap_ids_json=f"[{proc.id}]",
    )
    mestre = SolicitacaoMestre(
        codigo_solicitacao="SL-778899",
        paciente_id=pac.id,
        data_agendada=date(2026, 12, 18),
        hora_agendada="07:30",
        laboratorio_id=lab.id,
        status="agendado",
    )
    db_session.add_all([ex, fila, mestre])
    db_session.commit()
    db_session.refresh(ex)
    db_session.refresh(fila)
    db_session.refresh(mestre)

    db_session.add(ItemSolic(solicitacao_id=mestre.id, sigtap_id=proc.id, quantidade=1))
    db_session.commit()

    c_tfd = gerar_dados_comprovante_tfd(db_session, ex)
    c_fila = gerar_comprovante_fila_psf(db_session, fila.id)
    c_lab = gerar_comprovante_agendamento(db_session, mestre.id)

    for comp in (c_tfd, c_fila, c_lab):
        assert comp["public_token"]
        assert comp["acompanhar_path"] == f"/acompanhar/{comp['public_token']}"
        assert comp["qr_code_url"].startswith("/acompanhar/")

        # Consulta pública sem autenticação
        r_pub = client.get(f"/api/tfd/public/exames/{comp['public_token']}")
        assert r_pub.status_code == 200, r_pub.text
        pub = r_pub.json()
        assert pub["paciente_iniciais"] == "JF"
        assert pac.cpf not in r_pub.text
        assert pac.cns not in r_pub.text
        assert pac.nome not in r_pub.text

        # Leitura interna por QR Code continua funcionando usando a URL do portal
        r_qr = client.get(
            "/api/tfd/leitura-rapida",
            params={"codigo": f"https://sigsm.duckdns.org/acompanhar/{comp['public_token']}"},
        )
        assert r_qr.status_code == 200, r_qr.text
        assert r_qr.json()["encontrado"] is True


def test_contagem_filas_separa_exames_por_procedimento_e_consultas_por_especialidade(client, db_session):
    """Garante que exames diagnósticos (ex.: Endoscopia e Colonoscopia) não se misturem
    entre si nem com consultas especializadas do mesmo CBO (ex.: Gastroenterologista).
    """
    from app.models.tfd import ExameFila, Paciente

    p1 = Paciente(nome="Paciente Um", cpf="111.000.000-01", municipio="Guapé")
    p2 = Paciente(nome="Paciente Dois", cpf="111.000.000-02", municipio="Guapé")
    p3 = Paciente(nome="Paciente Tres", cpf="111.000.000-03", municipio="Guapé")
    p4 = Paciente(nome="Paciente Quatro", cpf="111.000.000-04", municipio="Guapé")
    db_session.add_all([p1, p2, p3, p4])
    db_session.commit()
    for p in (p1, p2, p3, p4):
        db_session.refresh(p)

    # 2 Endoscopias (uma com CBO 225165 e outra com CBO 225310),
    # 1 Colonoscopia (CBO 225165), e 1 Consulta Gastro (CBO 225165)
    endo1 = ExameFila(
        paciente_id=p1.id,
        exame="9999990005 - ENDOSCOPIA",
        codigo_procedimento="9999990005",
        tipo_fila="EXAMES GASTROENTEROLOGIA",
        especialidade="EXAMES GASTROENTEROLOGIA",
        codigo_especialidade="225165",
        nome_especialidade="Médico gastroenterologista",
        status="aguardando",
        prioridade="rotina",
        data_pedido=date(2026, 11, 1),
    )
    endo2 = ExameFila(
        paciente_id=p2.id,
        exame="9999990005 - ENDOSCOPIA",
        codigo_procedimento="9999990005",
        tipo_fila="EXAMES GASTROENTEROLOGIA",
        especialidade="EXAMES GASTROENTEROLOGIA",
        codigo_especialidade="225310",
        nome_especialidade="Médico em endoscopia",
        status="aguardando",
        prioridade="rotina",
        data_pedido=date(2026, 11, 2),
    )
    colono = ExameFila(
        paciente_id=p3.id,
        exame="0209010029 - COLONOSCOPIA (COLOSCOPIA)",
        codigo_procedimento="0209010029",
        tipo_fila="EXAMES GASTROENTEROLOGIA",
        especialidade="EXAMES GASTROENTEROLOGIA",
        codigo_especialidade="225165",
        nome_especialidade="Médico gastroenterologista",
        status="aguardando",
        prioridade="rotina",
        data_pedido=date(2026, 11, 3),
    )
    cons_gastro = ExameFila(
        paciente_id=p4.id,
        exame="0301010072 - CONSULTA MEDICA EM ATENÇÃO ESPECIALIZADA",
        codigo_procedimento="0301010072",
        tipo_fila="CONSULTAS ESPECIALIZADAS",
        especialidade="CONSULTAS ESPECIALIZADAS",
        codigo_especialidade="225165",
        nome_especialidade="Médico gastroenterologista",
        status="aguardando",
        prioridade="rotina",
        data_pedido=date(2026, 11, 4),
    )
    db_session.add_all([endo1, endo2, colono, cons_gastro])
    db_session.commit()

    # Lista filtrada por ENDOSCOPIA -> deve contar 2 na fila específica, 3 no tipo EXAMES GASTROENTEROLOGIA
    r_endo = client.get("/api/tfd/exames", params={"status": "aguardando", "procedimento": "ENDOSCOPIA"})
    assert r_endo.status_code == 200, r_endo.text
    d_endo = r_endo.json()
    assert d_endo["total"] == 2
    assert len(d_endo["data"]) == 2
    for row in d_endo["data"]:
        assert row["total_especialidade"] == 2
        assert row["total_fila"] == 2
        assert row["total_tipo"] == 3
        assert row["grupo_tipo"] == "EXAMES GASTROENTEROLOGIA"

    # Lista filtrada por COLONOSCOPIA -> deve contar 1 (não 4!)
    r_col = client.get("/api/tfd/exames", params={"status": "aguardando", "procedimento": "COLONOSCOPIA"})
    assert r_col.status_code == 200, r_col.text
    d_col = r_col.json()
    assert d_col["total"] == 1
    assert d_col["data"][0]["total_especialidade"] == 1
    assert d_col["data"][0]["total_fila"] == 1
    assert d_col["data"][0]["total_tipo"] == 3

    # Lista sem filtro -> consulta Gastro fica com total_especialidade == 1 e total_tipo == 1 (não 4!)
    r_all = client.get("/api/tfd/exames", params={"status": "aguardando"})
    assert r_all.status_code == 200, r_all.text
    por_id = {x["id"]: x for x in r_all.json()["data"]}
    assert por_id[cons_gastro.id]["total_especialidade"] == 1
    assert por_id[cons_gastro.id]["total_tipo"] == 1
    assert por_id[endo1.id]["total_especialidade"] == 2
    assert por_id[colono.id]["total_especialidade"] == 1
