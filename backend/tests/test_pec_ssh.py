from unittest.mock import patch, MagicMock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from app.models.integracoes import IntegrationSettings
from app.services.pec_tunnel import (
    verificar_porta_aberta,
    status_tunel,
    garantir_tunel_db,
)


def test_status_tunel():
    st = status_tunel(local_port=59999)
    assert "ativo" in st
    assert st["porta_local"] == 59999
    assert st["gerenciado"] is False


def test_garantir_tunel_db_direto():
    cfg = IntegrationSettings(
        id=1,
        pec_fonte="postgres",
        pec_ssh_habilitado=False,
        pec_database_url="postgresql://user:pass@192.168.1.1:5432/esus",
    )
    ativo, dsn = garantir_tunel_db(cfg)
    assert ativo is True
    assert dsn == "postgresql://user:pass@192.168.1.1:5432/esus"


def test_garantir_tunel_db_ssh_mock():
    cfg = IntegrationSettings(
        id=1,
        pec_fonte="postgres",
        pec_ssh_habilitado=True,
        pec_ssh_host="192.168.1.1",
        pec_ssh_porta=22,
        pec_ssh_usuario="ssh_user",
        pec_ssh_senha="mockpassword123",
        pec_porta_local=5433,
        pec_banco_nome="esus",
        pec_usuario="painel_readonly",
        pec_senha="mockdbpassword",
    )
    with patch("app.services.pec_tunnel.iniciar_tunel") as mock_iniciar:
        mock_iniciar.return_value = {"ok": True, "porta_local": 5433}
        ativo, dsn = garantir_tunel_db(cfg)
        assert ativo is True
        assert dsn == "postgresql://painel_readonly:mockdbpassword@127.0.0.1:5433/esus"
        mock_iniciar.assert_called_once_with(
            ssh_host="192.168.1.1",
            ssh_port=22,
            ssh_user="ssh_user",
            ssh_pass="mockpassword123",
            ssh_key="",
            local_port=5433,
            remote_host="127.0.0.1",
            remote_port=5432,
        )
