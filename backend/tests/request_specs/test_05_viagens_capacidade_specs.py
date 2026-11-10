import asyncio
from datetime import date, timedelta
import pytest
from httpx import AsyncClient
from sqlmodel import Session, select
from app.models.tfd import Paciente, Veiculo, Motorista, Viagem, ViagemPaciente


@pytest.mark.anyio
async def test_viagens_alocar_passageiro_caminho_feliz(client: AsyncClient, admin_headers: dict, db: Session):
    """(a. feliz): cria viagem e aloca passageiro gerando token de confirmação e vínculo."""
    pacientes = db.exec(select(Paciente)).fetchmany(2)
    assert len(pacientes) >= 2
    paciente1, paciente2 = pacientes[0], pacientes[1]

    data_viagem = date.today() + timedelta(days=5)

    # Cria viagem de teste
    payload_viagem = {
        "destino": "Passos - Hospital Regional",
        "data_viagem": data_viagem.isoformat(),
        "hora_saida": "05:30",
        "status": "agendada",
    }
    res_v = await client.post("/api/tfd/viagens", json=payload_viagem, headers=admin_headers)
    assert res_v.status_code == 201
    vid = res_v.json()["id"]

    # Aloca passageiro
    payload_pass = {
        "paciente_id": paciente1.id,
        "tratamento": "Oncologia",
        "unidade": "Hospital Regional do Câncer",
        "hora_consulta": "08:00",
    }
    res_p = await client.post(f"/api/tfd/viagens/{vid}/passageiros", json=payload_pass, headers=admin_headers)
    assert res_p.status_code == 201
    data_p = res_p.json()
    assert data_p["id"] > 0
    assert data_p["paciente_id"] == paciente1.id
    assert data_p["token_confirmacao"] is not None

    # Cleanup
    await client.delete(f"/api/tfd/viagens/{vid}", headers=admin_headers)


@pytest.mark.anyio
async def test_viagens_duplicidade_mesmo_paciente_erro_esperado(client: AsyncClient, admin_headers: dict, db: Session):
    """(b. erro esperado): tentar alocar o mesmo paciente 2 vezes na mesma viagem retorna 400."""
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None

    res_v = await client.post("/api/tfd/viagens", json={"destino": "Alfenas", "data_viagem": (date.today() + timedelta(days=6)).isoformat()}, headers=admin_headers)
    assert res_v.status_code == 201
    vid = res_v.json()["id"]

    payload_pass = {"paciente_id": paciente.id, "tratamento": "Consulta Especializada"}
    # 1ª alocação: ok
    res1 = await client.post(f"/api/tfd/viagens/{vid}/passageiros", json=payload_pass, headers=admin_headers)
    assert res1.status_code == 201

    # 2ª alocação com o mesmo paciente: 400
    res2 = await client.post(f"/api/tfd/viagens/{vid}/passageiros", json=payload_pass, headers=admin_headers)
    assert res2.status_code == 400
    assert "já está nesta viagem" in res2.json().get("detail", "").lower()

    # Cleanup
    await client.delete(f"/api/tfd/viagens/{vid}", headers=admin_headers)


@pytest.mark.anyio
async def test_viagens_acompanhante_proprio_paciente_erro_esperado(client: AsyncClient, admin_headers: dict, db: Session):
    """(b. erro esperado): acompanhante informado sendo o próprio paciente retorna 400."""
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None

    res_v = await client.post("/api/tfd/viagens", json={"destino": "Varginha", "data_viagem": (date.today() + timedelta(days=7)).isoformat()}, headers=admin_headers)
    vid = res_v.json()["id"]

    payload_pass = {
        "paciente_id": paciente.id,
        "acompanhante_id": paciente.id,  # Inválido
        "tratamento": "Consulta",
    }
    res = await client.post(f"/api/tfd/viagens/{vid}/passageiros", json=payload_pass, headers=admin_headers)
    assert res.status_code == 400
    assert "próprio paciente" in res.json().get("detail", "").lower()

    # Cleanup
    await client.delete(f"/api/tfd/viagens/{vid}", headers=admin_headers)


@pytest.mark.anyio
async def test_viagens_concorrencia_disputa_ultimo_assento(client: AsyncClient, admin_headers: dict, db: Session):
    """(c. repetição / concorrência): 2 requisições disputando 1 assento em veículo com lotação 1: apenas 1 vence."""
    pacientes = db.exec(select(Paciente)).fetchmany(2)
    assert len(pacientes) >= 2
    pac1, pac2 = pacientes[0], pacientes[1]

    # Reutiliza ou cria veículo com capacidade = 1
    veic = db.exec(select(Veiculo).where(Veiculo.placa == "RAC1A99")).first()
    if not veic:
        veic = Veiculo(placa="RAC1A99", modelo="Carro Teste Concorrência", capacidade=1, ativo=True)
        db.add(veic)
        db.commit()
        db.refresh(veic)
    elif veic.capacidade != 1:
        veic.capacidade = 1
        db.add(veic)
        db.commit()

    # Data futura sem viagens conflitantes
    data_futura = date.today() + timedelta(days=45)
    # Remove qualquer viagem existente nesta data futura com este veículo se houver
    viagens_antigas = db.exec(select(Viagem).where(Viagem.veiculo_id == veic.id, Viagem.data_viagem == data_futura)).all()
    for v_antiga in viagens_antigas:
        await client.delete(f"/api/tfd/viagens/{v_antiga.id}", headers=admin_headers)

    res_v = await client.post(
        "/api/tfd/viagens",
        json={"destino": "Pouso Alegre", "data_viagem": data_futura.isoformat(), "veiculo_id": veic.id},
        headers=admin_headers,
    )
    assert res_v.status_code == 201, f"Falha ao criar viagem de teste: {res_v.json()}"
    vid = res_v.json()["id"]

    # Dispara alocação simultânea dos dois pacientes
    req1 = client.post(f"/api/tfd/viagens/{vid}/passageiros", json={"paciente_id": pac1.id}, headers=admin_headers)
    req2 = client.post(f"/api/tfd/viagens/{vid}/passageiros", json={"paciente_id": pac2.id}, headers=admin_headers)
    res1, res2 = await asyncio.gather(req1, req2)

    status_codes = sorted([res1.status_code, res2.status_code])
    assert status_codes == [201, 400], f"Esperado [201, 400] na disputa de assento, obteve {status_codes}"

    # Confirma mensagem de capacidade excedida
    err_res = res1 if res1.status_code == 400 else res2
    assert "capacidade" in err_res.json().get("detail", "").lower()

    # Confirma no banco que existe apenas 1 passageiro alocado
    db.expire_all()
    passageiros = db.exec(select(ViagemPaciente).where(ViagemPaciente.viagem_id == vid)).all()
    assert len(passageiros) == 1

    # Cleanup
    await client.delete(f"/api/tfd/viagens/{vid}", headers=admin_headers)


@pytest.mark.anyio
async def test_viagens_limite_viagem_passada_sem_permissao_exclusiva(client: AsyncClient, create_test_user, admin_headers: dict, db: Session):
    """(d. limites): viagem passada é bloqueada para edição para usuário sem permissão tfd_viagens_passadas."""
    _, op_headers = create_test_user("op_sem_retroativo", "Senha123@", telas="tfd,tfd_viagens")
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None

    # Cria viagem no passado pelo admin
    data_passada = date.today() - timedelta(days=5)
    res_v = await client.post(
        "/api/tfd/viagens",
        json={"destino": "Passos", "data_viagem": data_passada.isoformat()},
        headers=admin_headers,
    )
    vid = res_v.json()["id"]

    # Operador comum tenta adicionar passageiro na viagem que já ocorreu
    res_add = await client.post(
        f"/api/tfd/viagens/{vid}/passageiros",
        json={"paciente_id": paciente.id},
        headers=op_headers,
    )
    assert res_add.status_code == 403
    assert "passada" in res_add.json().get("detail", "").lower() or "retroativ" in res_add.json().get("detail", "").lower()

    # Cleanup
    await client.delete(f"/api/tfd/viagens/{vid}", headers=admin_headers)
