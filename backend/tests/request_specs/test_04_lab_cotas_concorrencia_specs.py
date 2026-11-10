import asyncio
from datetime import date, timedelta
import pytest
from httpx import AsyncClient
from sqlmodel import Session, select
from app.models.tfd import Paciente
from app.models.lab_fase6 import Laboratorio, VagaLab
from app.models.lab_exames import SigtapProcedimento


@pytest.mark.anyio
async def test_lab_agendamento_caminho_feliz(client: AsyncClient, admin_headers: dict, db: Session):
    """(a. feliz): agendamento de exame com cota disponível abate 1 vaga e retorna 201."""
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None
    lab = db.exec(select(Laboratorio).where(Laboratorio.ativo == True)).first()
    assert lab is not None
    proc = db.exec(select(SigtapProcedimento)).first()
    assert proc is not None

    data_teste = date.today() + timedelta(days=20)

    # Garante vaga aberta com 5 vagas livres
    vaga_existente = db.exec(
        select(VagaLab).where(VagaLab.laboratorio_id == lab.id, VagaLab.data == data_teste)
    ).first()
    if vaga_existente:
        vaga_existente.vagas_totais = 5
        vaga_existente.vagas_ocupadas = 0
        db.add(vaga_existente)
        db.commit()
    else:
        nova_vaga = VagaLab(laboratorio_id=lab.id, data=data_teste, vagas_totais=5, vagas_ocupadas=0)
        db.add(nova_vaga)
        db.commit()

    payload = {
        "paciente_id": paciente.id,
        "data_agendada": data_teste.isoformat(),
        "laboratorio_id": lab.id,
        "itens": [{"sigtap_id": proc.id, "quantidade": 1}],
        "justificativa": "Acompanhamento clínico de rotina para paciente em monitoramento",
    }
    res = await client.post("/api/exames/solicitacoes", json=payload, headers=admin_headers)
    assert res.status_code == 201
    data_res = res.json()
    assert data_res["id"] > 0
    assert data_res["paciente_id"] == paciente.id

    # Verifica no banco se abateu exatamente 1 vaga
    db.expire_all()
    vaga_depois = db.exec(
        select(VagaLab).where(VagaLab.laboratorio_id == lab.id, VagaLab.data == data_teste)
    ).first()
    assert vaga_depois.vagas_ocupadas == 1


@pytest.mark.anyio
async def test_lab_data_passada_erro_esperado(client: AsyncClient, admin_headers: dict, db: Session):
    """(b. erro esperado): tentar agendar para uma data passada retorna 400."""
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None
    lab = db.exec(select(Laboratorio).where(Laboratorio.ativo == True)).first()
    assert lab is not None
    proc = db.exec(select(SigtapProcedimento)).first()
    assert proc is not None

    data_ontem = date.today() - timedelta(days=1)
    payload = {
        "paciente_id": paciente.id,
        "data_agendada": data_ontem.isoformat(),
        "laboratorio_id": lab.id,
        "itens": [{"sigtap_id": proc.id, "quantidade": 1}],
        "justificativa": "Tentativa de agendamento retroativo não autorizada",
    }
    res = await client.post("/api/exames/solicitacoes", json=payload, headers=admin_headers)
    assert res.status_code == 400
    assert "passado" in res.json().get("detail", "").lower() or "vagas" in res.json().get("detail", "").lower()


@pytest.mark.anyio
async def test_lab_concorrencia_disputa_ultima_vaga(client: AsyncClient, admin_headers: dict, db: Session):
    """(c. repetição e concorrência crítica): exatamente 1 vaga livre, 2 requisições simultâneas: apenas 1 passa."""
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None
    lab = db.exec(select(Laboratorio).where(Laboratorio.ativo == True)).first()
    assert lab is not None
    proc = db.exec(select(SigtapProcedimento)).first()
    assert proc is not None

    data_concorrente = date.today() + timedelta(days=25)

    # Configura cota com exatamente 1 vaga total e 0 ocupadas
    vaga = db.exec(
        select(VagaLab).where(VagaLab.laboratorio_id == lab.id, VagaLab.data == data_concorrente)
    ).first()
    if vaga:
        vaga.vagas_totais = 1
        vaga.vagas_ocupadas = 0
        db.add(vaga)
        db.commit()
    else:
        vaga = VagaLab(laboratorio_id=lab.id, data=data_concorrente, vagas_totais=1, vagas_ocupadas=0)
        db.add(vaga)
        db.commit()

    payload = {
        "paciente_id": paciente.id,
        "data_agendada": data_concorrente.isoformat(),
        "laboratorio_id": lab.id,
        "itens": [{"sigtap_id": proc.id, "quantidade": 1}],
        "justificativa": "Disputa de cota em condição de corrida de laboratório",
    }

    # Dispara 2 requisições no mesmo milissegundo
    req1 = client.post("/api/exames/solicitacoes", json=payload, headers=admin_headers)
    req2 = client.post("/api/exames/solicitacoes", json=payload, headers=admin_headers)
    res1, res2 = await asyncio.gather(req1, req2)

    status_codes = sorted([res1.status_code, res2.status_code])
    assert status_codes == [201, 400], f"Esperado [201, 400] na disputa da última vaga, obteve {status_codes}"

    # Validação do erro
    erro_res = res1 if res1.status_code == 400 else res2
    assert "livre" in erro_res.json().get("detail", "").lower() or "vaga" in erro_res.json().get("detail", "").lower()

    # Confirma que no banco de teste a ocupação não estourou o limite de 1
    db.expire_all()
    vaga_final = db.exec(
        select(VagaLab).where(VagaLab.laboratorio_id == lab.id, VagaLab.data == data_concorrente)
    ).first()
    assert vaga_final.vagas_ocupadas == 1
    assert vaga_final.vagas_ocupadas <= vaga_final.vagas_totais


@pytest.mark.anyio
async def test_lab_limite_cota_zerada(client: AsyncClient, admin_headers: dict, db: Session):
    """(d. limites): cota zerada (vagas ocupadas >= totais) rejeita agendamento imediatamente com 400."""
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None
    lab = db.exec(select(Laboratorio).where(Laboratorio.ativo == True)).first()
    assert lab is not None
    proc = db.exec(select(SigtapProcedimento)).first()
    assert proc is not None

    data_esgotada = date.today() + timedelta(days=26)
    vaga = db.exec(
        select(VagaLab).where(VagaLab.laboratorio_id == lab.id, VagaLab.data == data_esgotada)
    ).first()
    if vaga:
        vaga.vagas_totais = 2
        vaga.vagas_ocupadas = 2
        db.add(vaga)
        db.commit()
    else:
        vaga = VagaLab(laboratorio_id=lab.id, data=data_esgotada, vagas_totais=2, vagas_ocupadas=2)
        db.add(vaga)
        db.commit()

    payload = {
        "paciente_id": paciente.id,
        "data_agendada": data_esgotada.isoformat(),
        "laboratorio_id": lab.id,
        "itens": [{"sigtap_id": proc.id, "quantidade": 1}],
        "justificativa": "Tentativa de agendamento em data com cotas esgotadas",
    }
    res = await client.post("/api/exames/solicitacoes", json=payload, headers=admin_headers)
    assert res.status_code == 400
    assert "livre" in res.json().get("detail", "").lower() or "sem vaga" in res.json().get("detail", "").lower()


@pytest.mark.anyio
async def test_lab_acesso_indevido_sem_permissao_marcacao(client: AsyncClient, create_test_user, db: Session):
    """(e. acesso indevido): usuário sem permissão lab_marcacao recebe 403."""
    _, op_headers = create_test_user("user_sem_lab", "Senha123@", telas="tfd")
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None
    lab = db.exec(select(Laboratorio).where(Laboratorio.ativo == True)).first()
    assert lab is not None

    data_teste = date.today() + timedelta(days=27)
    payload = {
        "paciente_id": paciente.id,
        "data_agendada": data_teste.isoformat(),
        "laboratorio_id": lab.id,
        "itens": [{"sigtap_id": 1, "quantidade": 1}],
        "justificativa": "Tentativa indevida de marcação sem permissão",
    }
    res = await client.post("/api/exames/solicitacoes", json=payload, headers=op_headers)
    assert res.status_code == 403
