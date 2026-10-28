import pytest
from datetime import date, timedelta
from httpx import AsyncClient
from sqlmodel import Session, select
from app.models.tfd import Paciente, ExameFila, Viagem, ViagemPaciente


@pytest.mark.anyio
async def test_portal_publico_caminho_feliz_e_lgpd(client: AsyncClient, admin_headers: dict, db: Session):
    """(a. feliz & e. isolamento LGPD): acesso sem login via token retorna status sem vazar CPF ou telefone."""
    exame = db.exec(select(ExameFila).where(ExameFila.ativo == True, ExameFila.public_token != None)).first()
    assert exame is not None, "Banco de testes deve possuir exame com public_token"

    # Chamada pública via rota montada em /api/tfd/public/exames/{token}
    res = await client.get(f"/api/tfd/public/exames/{exame.public_token}")
    assert res.status_code == 200
    data = res.json()
    assert "status" in data
    assert "paciente_iniciais" in data
    assert "cpf" not in data, "LGPD: CPF não pode ser exposto publicamente"
    assert "telefone" not in data, "LGPD: Telefone não pode ser exposto publicamente"


@pytest.mark.anyio
async def test_portal_publico_confirmar_viagem_caminho_feliz(client: AsyncClient, admin_headers: dict, db: Session):
    """(a. feliz): paciente confirma presença em viagem via token recebido por WhatsApp."""
    paciente = db.exec(select(Paciente)).first()
    assert paciente is not None

    res_v = await client.post(
        "/api/tfd/viagens",
        json={"destino": "Passos", "data_viagem": (date.today() + timedelta(days=4)).isoformat()},
        headers=admin_headers,
    )
    vid = res_v.json()["id"]

    res_p = await client.post(f"/api/tfd/viagens/{vid}/passageiros", json={"paciente_id": paciente.id}, headers=admin_headers)
    token_conf = res_p.json()["token_confirmacao"]
    assert token_conf is not None

    # Confirmação pública
    payload = {"acao": "confirmar"}
    res_conf = await client.post(f"/api/tfd/public/viagens/confirmar/{token_conf}", json=payload)
    assert res_conf.status_code == 200
    assert res_conf.json().get("status_confirmacao") == "confirmado"

    # Valida no banco
    db.expire_all()
    vp = db.exec(select(ViagemPaciente).where(ViagemPaciente.token_confirmacao == token_conf)).first()
    assert vp.status_confirmacao == "confirmado"
    assert vp.presente is True

    # Cleanup
    await client.delete(f"/api/tfd/viagens/{vid}", headers=admin_headers)


@pytest.mark.anyio
async def test_portal_publico_token_invalido_erro_esperado(client: AsyncClient):
    """(b. erro esperado): token público inexistente retorna 404."""
    res = await client.get("/api/tfd/public/exames/token_inexistente_completamente_falso_123")
    assert res.status_code == 404
    assert "não encontrado" in res.json().get("detail", "").lower()


@pytest.mark.anyio
async def test_portal_publico_acao_invalida_erro_esperado(client: AsyncClient, admin_headers: dict, db: Session):
    """(b. erro esperado): ação diferente de confirmar ou desistir retorna 400."""
    paciente = db.exec(select(Paciente)).first()
    res_v = await client.post(
        "/api/tfd/viagens",
        json={"destino": "Alfenas", "data_viagem": (date.today() + timedelta(days=9)).isoformat()},
        headers=admin_headers,
    )
    vid = res_v.json()["id"]
    res_p = await client.post(f"/api/tfd/viagens/{vid}/passageiros", json={"paciente_id": paciente.id}, headers=admin_headers)
    token = res_p.json()["token_confirmacao"]

    res_bad = await client.post(f"/api/tfd/public/viagens/confirmar/{token}", json={"acao": "acao_invalida_xyz"})
    assert res_bad.status_code in (400, 422)

    # Cleanup
    await client.delete(f"/api/tfd/viagens/{vid}", headers=admin_headers)


@pytest.mark.anyio
async def test_portal_publico_repeticao_clicar_duas_vezes_confirmar(client: AsyncClient, admin_headers: dict, db: Session):
    """(c. repetição): paciente clica 2 vezes em confirmar presença; ambas retornam 200 e mantêm estado."""
    paciente = db.exec(select(Paciente)).first()
    res_v = await client.post(
        "/api/tfd/viagens",
        json={"destino": "Varginha", "data_viagem": (date.today() + timedelta(days=10)).isoformat()},
        headers=admin_headers,
    )
    vid = res_v.json()["id"]
    res_p = await client.post(f"/api/tfd/viagens/{vid}/passageiros", json={"paciente_id": paciente.id}, headers=admin_headers)
    token = res_p.json()["token_confirmacao"]

    # 1º clique
    res1 = await client.post(f"/api/tfd/public/viagens/confirmar/{token}", json={"acao": "confirmar"})
    assert res1.status_code == 200
    assert res1.json().get("status_confirmacao") == "confirmado"

    # 2º clique
    res2 = await client.post(f"/api/tfd/public/viagens/confirmar/{token}", json={"acao": "confirmar"})
    assert res2.status_code == 200
    assert res2.json().get("status_confirmacao") == "confirmado"

    # Cleanup
    await client.delete(f"/api/tfd/viagens/{vid}", headers=admin_headers)


@pytest.mark.anyio
async def test_portal_publico_limite_token_longo(client: AsyncClient):
    """(d. limites): token com mais de 64 caracteres é rejeitado com 404."""
    token_gigante = "a" * 70
    res = await client.get(f"/api/tfd/public/exames/{token_gigante}")
    assert res.status_code == 404
