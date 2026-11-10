import pytest
from datetime import date, timedelta
from httpx import AsyncClient
from sqlmodel import Session, select
from app.models.tfd import Paciente, Viagem, ViagemPaciente, Destino, Faturamento
from app.models.cadastros_saude import Medico
from app.models.apac import SolicitacaoAPAC, FaixaNumeracaoAPAC


@pytest.mark.anyio
async def test_faturamento_deslocamento_caminho_feliz_e_idempotencia(client: AsyncClient, admin_headers: dict, db: Session):
    """(a. feliz & c. repetição): faturar deslocamento gera lançamentos SIGTAP e chamadas repetidas são idempotentes."""
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None

    # Garante destino com código SIGTAP de deslocamento configurado
    dest = db.exec(select(Destino).where(Destino.codigo_desloc_pac != None)).first()
    assert dest is not None, "Banco de testes deve possuir ao menos 1 destino com código SIGTAP"

    data_v = date.today() - timedelta(days=2)
    res_v = await client.post(
        "/api/tfd/viagens",
        json={"destino": dest.nome_destino, "data_viagem": data_v.isoformat()},
        headers=admin_headers,
    )
    assert res_v.status_code == 201
    vid = res_v.json()["id"]

    # Aloca paciente
    await client.post(f"/api/tfd/viagens/{vid}/passageiros", json={"paciente_id": paciente.id}, headers=admin_headers)

    # 1º Faturamento de deslocamento: cria lançamentos
    res_fat1 = await client.post(f"/api/tfd/viagens/{vid}/faturar-deslocamento", headers=admin_headers)
    assert res_fat1.status_code == 200
    data_fat1 = res_fat1.json()
    assert data_fat1.get("criados", 0) >= 1

    # 2ª Chamada (repetição): deve ser idempotente (0 criados, itens pulados)
    res_fat2 = await client.post(f"/api/tfd/viagens/{vid}/faturar-deslocamento", headers=admin_headers)
    assert res_fat2.status_code == 200
    data_fat2 = res_fat2.json()
    assert data_fat2.get("criados", 0) == 0

    # Cleanup
    await client.delete(f"/api/tfd/viagens/{vid}", headers=admin_headers)


@pytest.mark.anyio
async def test_faturamento_valor_negativo_erro_esperado(client: AsyncClient, admin_headers: dict, db: Session):
    """(b. erro esperado): lançamento manual de faturamento com valor negativo é rejeitado com 422/400."""
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None

    payload_negativo = {
        "paciente_id": paciente.id,
        "procedimento": "Consulta Médica Especializada",
        "codigo_sigtap": "0301010072",
        "competencia": "2026-10",
        "quantidade": 1,
        "valor": -150.00,  # Valor negativo proibido
        "tipo": "BPA",
    }
    res = await client.post("/api/tfd/faturamento", json=payload_negativo, headers=admin_headers)
    assert res.status_code in (400, 422)


@pytest.mark.anyio
async def test_faturamento_apac_incompatibilidade_solicitante_autorizador_erro_esperado(client: AsyncClient, admin_headers: dict, db: Session):
    """(b. erro esperado): médico solicitante tentando autorizar a própria APAC retorna 400."""
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None
    medico = db.exec(select(Medico).where(Medico.ativo == True)).first()
    assert medico is not None

    # Cria solicitação de APAC com médico solicitante = medico.id (carater_atendimento="01" e paciente_nome preenchido)
    sol = SolicitacaoAPAC(
        paciente_id=paciente.id,
        paciente_nome=paciente.nome,
        procedimento_principal_codigo="0304010383",
        procedimento_principal_nome="ONCOLOGIA - QUIMIOTERAPIA",
        carater_atendimento="01",
        solicitante_tipo="MEDICO",
        medico_solicitante_id=medico.id,
        medico_solicitante_nome=medico.nome,
        status="PENDENTE",
        cid_principal_codigo="C50",
    )
    db.add(sol)
    db.commit()
    db.refresh(sol)

    # Tenta autorizar com o mesmo médico solicitante
    payload_aut = {
        "medico_autorizador_id": medico.id,
        "parecer": "Autorizado pelo próprio solicitante (irregular)",
    }
    res = await client.post(f"/api/apac/regulacao/{sol.id}/autorizar", json=payload_aut, headers=admin_headers)
    assert res.status_code == 400
    assert "incompatibilidade" in res.json().get("detail", "").lower()

    # Cleanup
    db.delete(sol)
    db.commit()


@pytest.mark.anyio
async def test_faturamento_apac_limite_faixa_esgotada(client: AsyncClient, admin_headers: dict, db: Session):
    """(d. limites): autorização de APAC sem faixa ativa disponível com saldo falha com 400."""
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None
    medicos = db.exec(select(Medico).where(Medico.ativo == True)).fetchmany(2)
    assert len(medicos) >= 2
    med_solic, med_autoriz = medicos[0], medicos[1]

    # Inativa temporariamente todas as faixas ativas para simular faixa esgotada
    faixas_ativas = db.exec(select(FaixaNumeracaoAPAC).where(FaixaNumeracaoAPAC.ativo == True)).all()
    for f in faixas_ativas:
        f.ativo = False
        db.add(f)
    db.commit()

    try:
        sol = SolicitacaoAPAC(
            paciente_id=paciente.id,
            paciente_nome=paciente.nome,
            procedimento_principal_codigo="0304010383",
            procedimento_principal_nome="ONCOLOGIA",
            carater_atendimento="01",
            solicitante_tipo="MEDICO",
            medico_solicitante_id=med_solic.id,
            medico_solicitante_nome=med_solic.nome,
            status="PENDENTE",
            cid_principal_codigo="C50",
        )
        db.add(sol)
        db.commit()
        db.refresh(sol)

        payload_aut = {
            "medico_autorizador_id": med_autoriz.id,
            "parecer": "Autorização técnica sem faixa disponível",
        }
        res = await client.post(f"/api/apac/regulacao/{sol.id}/autorizar", json=payload_aut, headers=admin_headers)
        assert res.status_code == 400
        assert "faixa" in res.json().get("detail", "").lower() or "saldo" in res.json().get("detail", "").lower()

        db.delete(sol)
        db.commit()
    finally:
        # Restaura as faixas
        for f in faixas_ativas:
            f.ativo = True
            db.add(f)
        db.commit()


@pytest.mark.anyio
async def test_faturamento_acesso_indevido_sem_permissao(client: AsyncClient, create_test_user, db: Session):
    """(e. acesso indevido): usuário sem permissão de faturamento recebe 403."""
    _, op_headers = create_test_user("user_sem_faturamento", "Senha123@", telas="dashboard")
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None

    payload = {
        "paciente_id": paciente.id,
        "procedimento": "Procedimento Teste",
        "competencia": "2026-10",
        "quantidade": 1,
        "valor": 50.0,
    }
    res = await client.post("/api/tfd/faturamento", json=payload, headers=op_headers)
    assert res.status_code == 403
