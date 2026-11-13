import json
from datetime import date, timedelta
from decimal import Decimal

try:
    import pytest
except ImportError:
    class _DummyPytest:
        @staticmethod
        def fixture(func=None, name=None):
            def decorator(f):
                return f
            return decorator(func) if func else decorator

        class raises:
            def __init__(self, expected_exc):
                self.expected_exc = expected_exc
                self.value = None

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_val, exc_tb):
                if exc_type is None:
                    raise AssertionError(f"Expected {self.expected_exc} was not raised")
                if not issubclass(exc_type, self.expected_exc):
                    return False
                self.value = exc_val
                return True

    pytest = _DummyPytest()
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.v1.auth import get_current_user
from app.core.deps import get_db
from app.main import app
from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import (
    FilaPsf,
    ItemSolic,
    Laboratorio,
    LabLoteArtefato,
    LabLoteItem,
    LabLoteLiberacao,
    LabOrcamentoMensal,
    SolicitacaoMestre,
    VagaLab,
)
from app.models.tfd import Paciente
from app.models.user import User
from app.schemas.lab_fase6 import (
    LabLoteConsolidarIn,
    LabLotePreviaIn,
    LabOrcamentoIn,
)
from app.services.lab_lote_service import (
    calcular_previa_lote,
    consolidar_lote_atomico,
    definir_orcamento_mensal,
    listar_lotes_liberacao,
    listar_orcamentos,
    obter_artefato_lote,
    obter_lote_detalhe,
    obter_orcamento_competencia,
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
        # Seed Laboratório
        lab = Laboratorio(nome="Laboratório Central de Guapé", ativo=True)
        session.add(lab)
        session.flush()

        # Seed Procedimentos SIGTAP
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
        p3 = SigtapProcedimento(
            codigo="0202010287",
            descricao="DOSAGEM DE COLESTEROL TOTAL",
            instrumento="BPA-C",
            valor_sa=3.50,
        )
        p4 = SigtapProcedimento(
            codigo="0202010317",
            descricao="DOSAGEM DE CREATININA",
            instrumento="BPA-C",
            valor_sa=2.10,
        )
        session.add_all([p1, p2, p3, p4])
        session.flush()

        # Seed Pacientes
        pac1 = Paciente(
            nome="Maria Silva",
            cpf="111.111.111-11",
            cns="700000000000001",
            codigo_prontuario="PR-00001",
            endereco="Rua Central, 100",
            bairro="Centro",
        )
        pac2 = Paciente(
            nome="João Santos",
            cpf="222.222.222-22",
            cns="700000000000002",
            codigo_prontuario="PR-00002",
            endereco="Av. Brasil, 200",
            bairro="Centro",
        )
        pac3 = Paciente(
            nome="Ana Oliveira",
            cpf="333.333.333-33",
            cns="700000000000003",
            codigo_prontuario="PR-00003",
            endereco="Rua das Flores, 50",
            bairro="Vila Nova",
        )
        session.add_all([pac1, pac2, pac3])
        session.commit()
        yield session


@pytest.fixture(name="client")
def client_fixture(db_session: Session):
    def _override_get_db():
        yield db_session

    admin_user = User(
        id=1,
        username="admin_lab",
        nome="Administrador Laboratório",
        is_superuser=True,
        telas="lab,lab_orcamento,lab_marcacao",
    )

    def _override_get_current_user():
        return admin_user

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_get_current_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ==============================================================================
# TESTES DE SERVIÇO E REGRAS DE NEGÓCIO
# ==============================================================================

def test_definir_e_obter_orcamento_mensal(db_session: Session):
    comp = "2026-11"
    dados = LabOrcamentoIn(competencia=comp, teto_mensal=5000.0, observacoes="Teto Novembro")
    orc = definir_orcamento_mensal(db_session, dados, usuario_nome="Secretário Saúde")

    assert orc.competencia == comp
    assert orc.teto_mensal == 5000.0
    assert orc.valor_consumido == 0.0
    assert orc.saldo_disponivel == 5000.0

    consultado = obter_orcamento_competencia(db_session, comp)
    assert consultado is not None
    assert consultado.id == orc.id
    assert consultado.teto_mensal == 5000.0


def test_calcular_previa_com_prioridade_e_limite_orcamento(db_session: Session):
    comp = "2026-11"
    definir_orcamento_mensal(db_session, LabOrcamentoIn(competencia=comp, teto_mensal=2000.0))

    lab = db_session.exec(select(Laboratorio)).first()
    pacs = db_session.exec(select(Paciente)).all()
    procs = db_session.exec(select(SigtapProcedimento)).all()
    proc_ids = [p.id for p in procs[:2]]  # 4.11 + 1.85 = 5.96

    # Cria 3 itens na fila com prioridades diferentes
    hoje = date.today()
    f1 = FilaPsf(
        paciente_id=pacs[0].id,
        unidade_psf="PSF Centro",
        data_solicitacao=hoje - timedelta(days=5),
        status="na_fila",
        prioridade="rotina",
        sigtap_ids_json=json.dumps(proc_ids),
    )
    f2 = FilaPsf(
        paciente_id=pacs[1].id,
        unidade_psf="PSF Centro",
        data_solicitacao=hoje - timedelta(days=2),
        status="na_fila",
        prioridade="urgente",
        sigtap_ids_json=json.dumps(proc_ids),
    )
    f3 = FilaPsf(
        paciente_id=pacs[2].id,
        unidade_psf="PSF Centro",
        data_solicitacao=hoje - timedelta(days=1),
        status="na_fila",
        prioridade="alta",
        sigtap_ids_json=json.dumps(proc_ids),
    )
    db_session.add_all([f1, f2, f3])
    db_session.commit()

    # Cria vagas no laboratório para 2 dias
    d1 = hoje + timedelta(days=2)
    d2 = hoje + timedelta(days=3)
    db_session.add(VagaLab(laboratorio_id=lab.id, data=d1, vagas_totais=10, vagas_ocupadas=0))
    db_session.add(VagaLab(laboratorio_id=lab.id, data=d2, vagas_totais=10, vagas_ocupadas=0))
    db_session.commit()

    previa = calcular_previa_lote(
        db_session,
        LabLotePreviaIn(
            competencia=comp,
            laboratorio_id=lab.id,
            valor_limite=100.0,
            datas_agendamento=[d1, d2],
        ),
    )

    assert previa.bloqueado is False
    assert previa.tem_deficit_vagas is False
    assert previa.total_pacientes_contemplados == 3
    assert len(previa.pacientes) == 3

    # Ordenação por prioridade clínica: urgente (f2) primeiro, alta (f3) em segundo, rotina (f1) em terceiro
    assert previa.pacientes[0].fila_id == f2.id
    assert previa.pacientes[0].prioridade == "urgente"
    assert previa.pacientes[1].fila_id == f3.id
    assert previa.pacientes[1].prioridade == "alta"
    assert previa.pacientes[2].fila_id == f1.id
    assert previa.pacientes[2].prioridade == "rotina"


def test_calcular_previa_bloqueia_quando_faltam_vagas(db_session: Session):
    comp = "2026-11"
    definir_orcamento_mensal(db_session, LabOrcamentoIn(competencia=comp, teto_mensal=2000.0))

    lab = db_session.exec(select(Laboratorio)).first()
    pacs = db_session.exec(select(Paciente)).all()
    procs = db_session.exec(select(SigtapProcedimento)).all()
    proc_ids = [p.id for p in procs[:2]]

    hoje = date.today()
    for pac in pacs:
        db_session.add(
            FilaPsf(
                paciente_id=pac.id,
                unidade_psf="PSF Centro",
                data_solicitacao=hoje,
                status="na_fila",
                sigtap_ids_json=json.dumps(proc_ids),
            )
        )
    db_session.commit()

    d1 = hoje + timedelta(days=2)
    # Vaga com capacidade para apenas 1 paciente (mas temos 3 pacientes na fila)
    db_session.add(VagaLab(laboratorio_id=lab.id, data=d1, vagas_totais=1, vagas_ocupadas=0))
    db_session.commit()

    previa = calcular_previa_lote(
        db_session,
        LabLotePreviaIn(
            competencia=comp,
            laboratorio_id=lab.id,
            valor_limite=100.0,
            datas_agendamento=[d1],
        ),
    )

    assert previa.bloqueado is True
    assert previa.tem_deficit_vagas is True
    assert previa.deficit_total_vagas == 2
    assert any("Faltam vagas" in m for m in previa.motivos_bloqueio)


def test_consolidar_lote_atomico_com_sucesso_e_artefatos(db_session: Session):
    comp = "2026-11"
    definir_orcamento_mensal(db_session, LabOrcamentoIn(competencia=comp, teto_mensal=1000.0))

    lab = db_session.exec(select(Laboratorio)).first()
    pac = db_session.exec(select(Paciente)).first()
    procs = db_session.exec(select(SigtapProcedimento)).all()
    proc_ids = [procs[0].id, procs[1].id]  # 4.11 + 1.85 = 5.96

    hoje = date.today()
    fila = FilaPsf(
        paciente_id=pac.id,
        unidade_psf="PSF Rural",
        data_solicitacao=hoje,
        status="na_fila",
        prioridade="alta",
        sigtap_ids_json=json.dumps(proc_ids),
    )
    db_session.add(fila)
    db_session.commit()

    dt_agendada = hoje + timedelta(days=2)
    db_session.add(VagaLab(laboratorio_id=lab.id, data=dt_agendada, vagas_totais=5, vagas_ocupadas=0))
    db_session.commit()

    lote = consolidar_lote_atomico(
        db_session,
        LabLoteConsolidarIn(
            competencia=comp,
            laboratorio_id=lab.id,
            valor_solicitado=50.0,
            datas_agendamento=[dt_agendada],
            hora_padrao="07:15",
            observacoes="Primeiro lote de testes",
        ),
        usuario_nome="Dr. Coordenador",
    )

    assert lote.id is not None
    assert lote.codigo_lote.startswith("LOTE-")
    assert lote.qtd_pacientes == 1
    assert lote.qtd_exames == 2
    assert lote.valor_consumido == 5.96
    assert lote.status == "consolidado"

    # Verifica atualização da FilaPsf
    db_session.refresh(fila)
    assert fila.status == "agendado"
    assert fila.lote_id == lote.id

    # Verifica agendamento mestre criado
    mestre = db_session.exec(
        select(SolicitacaoMestre).where(SolicitacaoMestre.lote_id == lote.id)
    ).first()
    assert mestre is not None
    assert mestre.paciente_id == pac.id
    assert mestre.laboratorio_id == lab.id
    assert mestre.data_agendada == dt_agendada
    assert mestre.hora_agendada == "07:15"
    assert mestre.status == "agendado"

    # Verifica consumo na VagaLab
    vaga_atualizada = db_session.exec(
        select(VagaLab).where(VagaLab.laboratorio_id == lab.id, VagaLab.data == dt_agendada)
    ).first()
    assert vaga_atualizada.vagas_ocupadas == 1

    # Verifica consumo no Orçamento
    orc = db_session.exec(
        select(LabOrcamentoMensal).where(LabOrcamentoMensal.competencia == comp)
    ).first()
    assert orc.valor_consumido == 5.96

    # Verifica geração e download dos artefatos
    artefato_zip, nome_zip, mime_zip = obter_artefato_lote(db_session, lote.id, "comprovantes_zip")
    assert mime_zip == "application/zip"
    assert len(artefato_zip) > 0
    assert nome_zip.endswith(".zip")

    artefato_xlsx, nome_xlsx, mime_xlsx = obter_artefato_lote(db_session, lote.id, "relatorio_xlsx")
    assert "openxmlformats" in mime_xlsx
    assert len(artefato_xlsx) > 0
    assert nome_xlsx.endswith(".xlsx")


def test_consolidar_lote_rejeita_e_faz_rollback_quando_vagas_insuficientes(db_session: Session):
    comp = "2026-11"
    definir_orcamento_mensal(db_session, LabOrcamentoIn(competencia=comp, teto_mensal=1000.0))

    lab = db_session.exec(select(Laboratorio)).first()
    pacs = db_session.exec(select(Paciente)).all()
    procs = db_session.exec(select(SigtapProcedimento)).all()
    proc_ids = [procs[0].id]

    hoje = date.today()
    filas = []
    for pac in pacs:
        f = FilaPsf(
            paciente_id=pac.id,
            unidade_psf="PSF Central",
            data_solicitacao=hoje,
            status="na_fila",
            sigtap_ids_json=json.dumps(proc_ids),
        )
        db_session.add(f)
        filas.append(f)
    db_session.commit()

    # Vaga com total 1 e já ocupada 1 (livres: 0)
    dt_agendada = hoje + timedelta(days=4)
    db_session.add(VagaLab(laboratorio_id=lab.id, data=dt_agendada, vagas_totais=1, vagas_ocupadas=1))
    db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        consolidar_lote_atomico(
            db_session,
            LabLoteConsolidarIn(
                competencia=comp,
                laboratorio_id=lab.id,
                valor_solicitado=100.0,
                datas_agendamento=[dt_agendada],
            ),
            usuario_nome="Operador",
        )
    assert exc_info.value.status_code == 400
    assert "Vagas insuficientes" in exc_info.value.detail

    # Garante que nenhum lote ou agendamento foi salvo (Rollback ACID)
    lotes = db_session.exec(select(LabLoteLiberacao)).all()
    assert len(lotes) == 0

    mestres = db_session.exec(select(SolicitacaoMestre)).all()
    assert len(mestres) == 0

    for f in filas:
        db_session.refresh(f)
        assert f.status == "na_fila"
        assert f.lote_id is None


def test_consolidar_lote_rejeita_quando_teto_orcamento_estourado(db_session: Session):
    comp = "2026-11"
    # Teto orçamentário mensal de R$ 10,00
    definir_orcamento_mensal(db_session, LabOrcamentoIn(competencia=comp, teto_mensal=10.0))

    lab = db_session.exec(select(Laboratorio)).first()
    hoje = date.today()
    dt_agendada = hoje + timedelta(days=2)
    db_session.add(VagaLab(laboratorio_id=lab.id, data=dt_agendada, vagas_totais=10, vagas_ocupadas=0))
    db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        consolidar_lote_atomico(
            db_session,
            LabLoteConsolidarIn(
                competencia=comp,
                laboratorio_id=lab.id,
                valor_solicitado=50.0,  # 50.0 > 10.0
                datas_agendamento=[dt_agendada],
            ),
            usuario_nome="Operador",
        )
    assert exc_info.value.status_code == 400
    assert "Saldo orçamentário insuficiente" in exc_info.value.detail


# ==============================================================================
# TESTES DE INTEGRAÇÃO COM ENDPOINTS FASTAPI (HTTP CLIENT)
# ==============================================================================

def test_api_rotas_orcamento_e_lote(client: TestClient, db_session: Session):
    # 1. POST /api/lab/orcamentos
    res_orc = client.post(
        "/api/lab/orcamentos",
        json={"competencia": "2026-11", "teto_mensal": 3500.0, "observacoes": "Teto teste API"},
    )
    assert res_orc.status_code == 201
    assert res_orc.json()["teto_mensal"] == 3500.0

    # 2. GET /api/lab/orcamentos
    res_lista_orc = client.get("/api/lab/orcamentos?ano=2026")
    assert res_lista_orc.status_code == 200
    assert len(res_lista_orc.json()) >= 1

    # 3. GET /api/lab/orcamentos/2026-11
    res_get_orc = client.get("/api/lab/orcamentos/2026-11")
    assert res_get_orc.status_code == 200
    assert res_get_orc.json()["saldo_disponivel"] == 3500.0

    # 4. Cria fila e vagas no banco
    lab = db_session.exec(select(Laboratorio)).first()
    pac = db_session.exec(select(Paciente)).first()
    proc = db_session.exec(select(SigtapProcedimento)).first()
    hoje = date.today()
    dt_agendada = hoje + timedelta(days=3)

    db_session.add(
        FilaPsf(
            paciente_id=pac.id,
            unidade_psf="PSF Central",
            data_solicitacao=hoje,
            status="na_fila",
            prioridade="rotina",
            sigtap_ids_json=json.dumps([proc.id]),
        )
    )
    db_session.add(VagaLab(laboratorio_id=lab.id, data=dt_agendada, vagas_totais=5, vagas_ocupadas=0))
    db_session.commit()

    # 5. POST /api/lab/lotes/previa
    res_previa = client.post(
        "/api/lab/lotes/previa",
        json={
            "competencia": "2026-11",
            "laboratorio_id": lab.id,
            "valor_limite": 50.0,
            "datas_agendamento": [dt_agendada.isoformat()],
        },
    )
    assert res_previa.status_code == 200
    data_previa = res_previa.json()
    assert data_previa["bloqueado"] is False
    assert data_previa["total_pacientes_contemplados"] == 1

    # 6. POST /api/lab/lotes/consolidar
    res_cons = client.post(
        "/api/lab/lotes/consolidar",
        json={
            "competencia": "2026-11",
            "laboratorio_id": lab.id,
            "valor_solicitado": 50.0,
            "datas_agendamento": [dt_agendada.isoformat()],
            "observacoes": "Consolidação via API",
        },
    )
    assert res_cons.status_code == 201
    lote_data = res_cons.json()
    lote_id = lote_data["id"]
    assert lote_id > 0
    assert lote_data["qtd_pacientes"] == 1

    # 7. GET /api/lab/lotes
    res_lotes = client.get("/api/lab/lotes?competencia=2026-11")
    assert res_lotes.status_code == 200
    assert len(res_lotes.json()) >= 1

    # 8. GET /api/lab/lotes/{id}
    res_det = client.get(f"/api/lab/lotes/{lote_id}")
    assert res_det.status_code == 200
    assert len(res_det.json()["itens"]) == 1

    # 9. GET /api/lab/lotes/{id}/artefatos/relatorio_xlsx
    res_down_xlsx = client.get(f"/api/lab/lotes/{lote_id}/artefatos/relatorio_xlsx")
    assert res_down_xlsx.status_code == 200
    assert len(res_down_xlsx.content) > 0

    # 10. GET /api/lab/lotes/{id}/artefatos/comprovantes_zip
    res_down_zip = client.get(f"/api/lab/lotes/{lote_id}/artefatos/comprovantes_zip")
    assert res_down_zip.status_code == 200
    assert len(res_down_zip.content) > 0
