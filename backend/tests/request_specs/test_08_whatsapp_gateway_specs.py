import io
import urllib.error
from unittest.mock import patch, MagicMock
import pytest
from httpx import AsyncClient
from sqlmodel import Session, select
from app.models.tfd import Paciente, ExameFila
from app.models.integracoes import IntegrationSettings, WhatsAppLog


@pytest.mark.anyio
async def test_whatsapp_envio_caminho_feliz_com_gateway_mockado(client: AsyncClient, admin_headers: dict, db: Session):
    """(a. feliz): disparo de WhatsApp com gateway externo mockado grava log de sucesso e retorna 200."""
    exame = db.exec(select(ExameFila).where(ExameFila.ativo == True)).first()
    assert exame is not None
    paciente = db.get(Paciente, exame.paciente_id)
    assert paciente is not None

    # Habilita WhatsApp nas configurações
    c = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
    if not c:
        c = IntegrationSettings(id=1)
    c.whatsapp_habilitado = True
    c.whatsapp_provedor = "webhook_generico"
    c.whatsapp_api_url = "https://mock-gateway-whatsapp.local/send"
    c.whatsapp_api_token = "token_teste_123"
    db.add(c)
    db.commit()

    # Mock apenas do serviço externo (urllib.request.urlopen)
    fake_response = MagicMock()
    fake_response.status = 200
    fake_response.getcode.return_value = 200
    fake_response.read.return_value = b'{"success": true, "message_id": "msg_mock_999"}'
    fake_response.__enter__.return_value = fake_response

    with patch("app.services.whatsapp.urllib.request.urlopen", return_value=fake_response):
        payload = {
            "exame_id": exame.id,
            "tipo": "auto",
            "telefone_customizado": "35999998888",
        }
        res = await client.post("/api/whatsapp/enviar", json=payload, headers=admin_headers)
        assert res.status_code == 200
        data = res.json()
        assert data.get("sucesso") is True

        # Verifica persistência real no banco de teste (WhatsAppLog)
        db.expire_all()
        log = db.exec(
            select(WhatsAppLog)
            .where(WhatsAppLog.exame_id == exame.id)
            .order_by(WhatsAppLog.id.desc())
        ).first()
        assert log is not None
        assert log.status == "ENVIADO"
        assert log.sucesso is True


@pytest.mark.anyio
async def test_whatsapp_telefone_invalido_erro_esperado(client: AsyncClient, admin_headers: dict, db: Session):
    """(b. erro esperado): envio para número com menos de 8 dígitos retorna falha tratada sem 500."""
    exame = db.exec(select(ExameFila).where(ExameFila.ativo == True)).first()
    assert exame is not None

    payload = {
        "exame_id": exame.id,
        "tipo": "auto",
        "telefone_customizado": "123",  # Telefone inválido
    }
    res = await client.post("/api/whatsapp/enviar", json=payload, headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert data.get("sucesso") is False
    assert data.get("motivo") == "telefone_invalido"


@pytest.mark.anyio
async def test_whatsapp_limites_falha_externa_resiliente(client: AsyncClient, admin_headers: dict, db: Session):
    """(d. limites / resiliência): falha externa no gateway (timeout/queda) não quebra a rota e loga falha."""
    exame = db.exec(select(ExameFila).where(ExameFila.ativo == True)).first()
    assert exame is not None

    # Simula erro de conexão externa no gateway de terceiros
    with patch("app.services.whatsapp.urllib.request.urlopen", side_effect=urllib.error.URLError("Gateway Timeout / Offline")):
        payload = {
            "exame_id": exame.id,
            "tipo": "auto",
            "telefone_customizado": "35999997777",
        }
        res = await client.post("/api/whatsapp/enviar", json=payload, headers=admin_headers)
        assert res.status_code == 200
        data = res.json()
        assert data.get("sucesso") is False

        # Valida que o log no banco registrou a falha sem dar crash na aplicação
        db.expire_all()
        log_falha = db.exec(
            select(WhatsAppLog)
            .where(WhatsAppLog.exame_id == exame.id)
            .order_by(WhatsAppLog.id.desc())
        ).first()
        assert log_falha is not None
        assert log_falha.status == "FALHA"
        assert log_falha.sucesso is False


@pytest.mark.anyio
async def test_whatsapp_acesso_indevido_operador_sem_permissao(client: AsyncClient, create_test_user):
    """(e. acesso indevido): usuário não administrador não pode alterar configuração de integração."""
    _, op_headers = create_test_user("op_sem_integracao", "Senha123@", telas="tfd")

    payload_cfg = {
        "whatsapp_habilitado": True,
        "whatsapp_provedor": "webhook_generico",
        "whatsapp_api_url": "https://url-maliciosa.local/webhook",
    }
    res = await client.put("/api/whatsapp/configuracao", json=payload_cfg, headers=op_headers)
    assert res.status_code == 403
    assert "administradores" in res.json().get("detail", "").lower()
