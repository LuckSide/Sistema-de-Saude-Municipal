import asyncio
from datetime import date
import pytest
from httpx import AsyncClient
from sqlmodel import Session, select
from app.models.tfd import Paciente, ExameFila
from app.models.cadastros_saude import Medico, UnidadeSaude


@pytest.mark.anyio
async def test_regulacao_fila_caminho_feliz(client: AsyncClient, admin_headers: dict, db: Session):
    """(a. feliz): cria exame na fila, agenda com CID e recepciona com sucesso."""
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None, "Banco de testes deve possuir ao menos 1 paciente cadastrado"
    medico = db.exec(select(Medico).where(Medico.ativo == True)).first()
    unidade = db.exec(select(UnidadeSaude).where(UnidadeSaude.ativo == True)).first()

    payload_exame = {
        "paciente_id": paciente.id,
        "data_pedido": date.today().isoformat(),
        "exame": "Ultrassonografia de Abdome Total Teste",
        "especialidade": "Ultrassonografia",
        "tipo_fila": "exame",
        "prioridade": "rotina",
        "justificativa": "Paciente apresenta dor crônica em hipocôndrio direito há 3 meses",
        "destino": "Guapé - Policlínica Municipal",
        "status": "aguardando",
        "cid_codigo": "R10",
        "cid_descricao": "Dor abdominal e pélvica",
    }
    # Criação na fila
    res_criacao = await client.post("/api/tfd/exames", json=payload_exame, headers=admin_headers)
    assert res_criacao.status_code == 201
    data_criado = res_criacao.json()
    assert data_criado["id"] > 0
    assert data_criado["public_token"] is not None
    assert len(data_criado["public_token"]) >= 10
    exame_id = data_criado["id"]

    # Agendamento para permitir recepção
    payload_agendamento = {
        **data_criado,
        "status": "agendado",
        "data_agendada": date.today().isoformat(),
        "hora_agendada": "08:00",
        "medico_id": medico.id if medico else None,
        "unidade_saude_id": unidade.id if unidade else None,
        "justificativa": "Paciente apresenta dor crônica em hipocôndrio direito há 3 meses",
    }
    res_agendado = await client.put(f"/api/tfd/exames/{exame_id}", json=payload_agendamento, headers=admin_headers)
    assert res_agendado.status_code == 200

    # Recepção do exame com preenchimento obrigatório de CID
    payload_recepcao = {"cid_codigo": "R10", "cid_descricao": "Dor abdominal e pélvica"}
    res_recepcao = await client.post(f"/api/tfd/exames/{exame_id}/recepcionar", json=payload_recepcao, headers=admin_headers)
    assert res_recepcao.status_code == 200
    assert res_recepcao.json().get("status") == "recepcionado"

    # Cleanup: soft-delete com justificativa válida
    await client.request(
        "DELETE",
        f"/api/tfd/exames/{exame_id}",
        json={"justificativa": "Exclusão de teste de integração automatizado realizada com sucesso"},
        headers=admin_headers,
    )


@pytest.mark.anyio
async def test_regulacao_justificativa_curta_erro_esperado(client: AsyncClient, admin_headers: dict, db: Session):
    """(b. erro esperado): justificativa com menos de 12 caracteres retorna erro de validação (400/422)."""
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None

    payload_invalido = {
        "paciente_id": paciente.id,
        "data_pedido": date.today().isoformat(),
        "exame": "Eletrocardiograma Teste",
        "tipo_fila": "exame",
        "prioridade": "rotina",
        "justificativa": "Dor peito",  # 9 caracteres (< 12)
    }
    res = await client.post("/api/tfd/exames", json=payload_invalido, headers=admin_headers)
    assert res.status_code in (400, 422)
    detail = str(res.json().get("detail", "")).lower()
    assert "12" in detail or "justificativa" in detail


@pytest.mark.anyio
async def test_regulacao_exclusao_sem_justificativa_erro_esperado(client: AsyncClient, admin_headers: dict, db: Session):
    """(b. erro esperado): tentar excluir exame sem justificativa retorna 400."""
    exame = db.exec(select(ExameFila).where(ExameFila.ativo == True)).first()
    assert exame is not None

    res = await client.request(
        "DELETE",
        f"/api/tfd/exames/{exame.id}",
        json={"justificativa": ""},
        headers=admin_headers,
    )
    assert res.status_code == 400
    detail = res.json().get("detail", "").lower()
    assert "justificativa" in detail or "motivo" in detail


@pytest.mark.anyio
async def test_regulacao_concorrencia_recepcao_simultanea(client: AsyncClient, admin_headers: dict, db: Session):
    """(c. repetição / concorrência): duas requisições recepcionando o mesmo exame mantêm integridade."""
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None
    medico = db.exec(select(Medico).where(Medico.ativo == True)).first()
    unidade = db.exec(select(UnidadeSaude).where(UnidadeSaude.ativo == True)).first()

    payload_exame = {
        "paciente_id": paciente.id,
        "data_pedido": date.today().isoformat(),
        "data_agendada": date.today().isoformat(),
        "hora_agendada": "09:00",
        "medico_id": medico.id if medico else None,
        "unidade_saude_id": unidade.id if unidade else None,
        "exame": "Raio-X de Tórax Concorrente",
        "tipo_fila": "exame",
        "prioridade": "rotina",
        "justificativa": "Tosse produtiva persistente e febre vespertina há 15 dias",
        "status": "agendado",
        "cid_codigo": "R05",
        "cid_descricao": "Tosse",
    }
    res_criado = await client.post("/api/tfd/exames", json=payload_exame, headers=admin_headers)
    assert res_criado.status_code == 201
    eid = res_criado.json()["id"]

    # Dispara recepção simultânea
    payload_recepcao = {"cid_codigo": "R05", "cid_descricao": "Tosse"}
    req1 = client.post(f"/api/tfd/exames/{eid}/recepcionar", json=payload_recepcao, headers=admin_headers)
    req2 = client.post(f"/api/tfd/exames/{eid}/recepcionar", json=payload_recepcao, headers=admin_headers)
    res1, res2 = await asyncio.gather(req1, req2)

    # Ambas devem concluir sem 500 e o status final deve ser recepcionado
    assert res1.status_code in (200, 400)
    assert res2.status_code in (200, 400)
    
    db.expire_all()
    exame_final = db.get(ExameFila, eid)
    assert exame_final.status == "recepcionado"

    # Cleanup
    await client.request(
        "DELETE",
        f"/api/tfd/exames/{eid}",
        json={"justificativa": "Cleanup do teste de concorrência com mais de doze caracteres"},
        headers=admin_headers,
    )


@pytest.mark.anyio
async def test_regulacao_limite_lote_excedido(client: AsyncClient, admin_headers: dict):
    """(d. limites): envio em lote com mais de 200 IDs deve falhar com erro de validação (422/400)."""
    ids_excedentes = list(range(1, 205))  # 204 itens
    payload = {
        "ids": ids_excedentes,
        "status": "agendado",
    }
    res = await client.put("/api/tfd/exames/lote", json=payload, headers=admin_headers)
    assert res.status_code in (400, 422)


@pytest.mark.anyio
async def test_regulacao_acesso_indevido_prioridade_sem_perfil_medico(client: AsyncClient, create_test_user, db: Session):
    """(e. acesso indevido): operador comum sem perfil tfd_medico não pode alterar prioridade médica."""
    _, op_headers = create_test_user("operador_nao_medico", "Senha123@", telas="tfd,tfd_exames")
    exame = db.exec(select(ExameFila).where(ExameFila.ativo == True)).first()
    assert exame is not None

    payload_prio = {
        "prioridade": "urgente",
        "justificativa": "Suspeita de malignidade em rápida progressão clínica",
    }
    res = await client.put(f"/api/tfd/exames/{exame.id}/prioridade", json=payload_prio, headers=op_headers)
    assert res.status_code == 403
    assert "médico" in res.json().get("detail", "").lower()
