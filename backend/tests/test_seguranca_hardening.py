from datetime import date
import json
from pathlib import Path
import gzip
import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.api.v1.backup import _descomprimir_gzip_limitado
from app.api.v1.settings import SettingsPublicOut, ler_settings_public, validar_url_marca
from app.core.audit import mascarar_cpf, redigir
from app.core.deps import _validar_payload_token, require_superuser
from app.core.security import create_access_token, validar_url_externa_segura
from app.models.lab_fase6 import LabResultadoArquivo
from app.models.user import User
from app.services.backup_crypto import criptografar_dados, descriptografar_dados
from app.services.export_xlsx import _sanitizar_celula_excel
from app.services.importacao_filas import ler_xml
from app.services.laudo_storage import obter_caminho_arquivo_laudo
from app.services.permissoes import acoes_map, tem_acao, validar_acoes
from app.services.users import hash_password, primeira_troca, trocar_senha


def test_permissoes_lista_vazia_nao_abre_fail_open():
    user = User(
        id=10,
        username="op_restrito",
        password_hash="h",
        telas="tfd_exames",
        acoes=json.dumps({"tfd_exames": []}),
        is_superuser=False,
        must_change_password=False,
    )
    assert acoes_map(user) == {"tfd_exames": []}
    assert validar_acoes({"tfd_exames": []}) == {"tfd_exames": []}
    assert tem_acao(user, "tfd_exames", "ver") is False
    assert tem_acao(user, "tfd_exames", "criar") is False


def test_settings_public_nao_expoe_cns_cnpj_cnes(monkeypatch):
    import app.api.v1.settings as settings_mod
    from app.models.settings import SystemSettings

    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(eng)
    monkeypatch.setattr(settings_mod, "engine", eng)
    out = ler_settings_public()
    assert isinstance(out, SettingsPublicOut)
    dados = out.model_dump()
    assert set(dados.keys()) == {"cidade", "uf", "subtitulo", "brasao_url", "icone_url"}


def test_url_marca_bloqueia_svg_xss_e_http():
    with pytest.raises(HTTPException):
        validar_url_marca("data:image/svg+xml,<svg onload=alert(1)>", "Brasão")
    with pytest.raises(HTTPException):
        validar_url_marca("http://exemplo.com/logo.png", "Brasão")
    assert validar_url_marca("https://exemplo.com/logo.png", "Brasão").startswith("https://")
    assert validar_url_marca("data:image/png;base64,iVBORw0KGgo=", "Ícone").startswith("data:image/png")


def test_primeira_troca_exige_senha_atual_e_trocar_revoga_token():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        u = User(
            username="sec_user",
            password_hash=hash_password("Temp1234"),
            is_active=True,
            must_change_password=True,
        )
        db.add(u)
        db.commit()
        db.refresh(u)

        with pytest.raises(ValueError, match="incorreta"):
            primeira_troca(db, u, "", "NovaSenha99", "NovaSenha99")

        primeira_troca(db, u, "Temp1234", "NovaSenha99", "NovaSenha99")
        tok_antigo = create_access_token(u.username, token_version=u.token_version)
        assert _validar_payload_token(tok_antigo, db).username == "sec_user"

        trocar_senha(db, u, "NovaSenha99", "OutraSenha88")
        with pytest.raises(HTTPException) as exc:
            _validar_payload_token(tok_antigo, db)
        assert exc.value.status_code == 401


def test_laudo_storage_bloqueia_path_traversal(tmp_path):
    fora = tmp_path / "segredo.pdf"
    fora.write_bytes(b"%PDF-1.4 fake")
    arq = LabResultadoArquivo(
        solicitacao_id=1,
        paciente_id=1,
        nome_arquivo="segredo.pdf",
        caminho_storage=str(fora),
        tamanho_bytes=13,
        hash_sha256="0" * 64,
        enviado_por="teste",
        enviado_em=date.today(),
    )
    assert obter_caminho_arquivo_laudo(arq) is None


def test_xml_xxe_doctype_e_ssrf_bloqueados():
    with pytest.raises(ValueError, match="DOCTYPE"):
        ler_xml(b'<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><exames><exame><nome>&x;</nome></exame></exames>')

    for url_ruim in (
        "http://127.0.0.1:8000/hook",
        "http://169.254.169.254/latest/meta-data/",
        "http://localhost/admin",
        "http://10.0.0.5/api",
        "ftp://example.com/a",
    ):
        with pytest.raises(ValueError):
            validar_url_externa_segura(url_ruim)


def test_sanitizacao_excel_audit_cns_e_backup_bomb():
    assert _sanitizar_celula_excel("=CMD('calc')") == "'=CMD('calc')"
    assert mascarar_cpf("703403201915616") == "703**********16"
    red = redigir({"cns_paciente": "703403201915616", "cpf": "12345678901", "senha": "segredo"})
    assert red["cns_paciente"] == "703**********16"
    assert red["cpf"] == "123******01"
    assert red["senha"] == "***"

    blob = criptografar_dados(b"dados-teste", "SenhaForte@2026")
    assert descriptografar_dados(blob, "SenhaForte@2026") == b"dados-teste"

    payload_bomba = gzip.compress(b"A" * 2048)
    with pytest.raises(ValueError, match="limite"):
        _descomprimir_gzip_limitado(payload_bomba, limite=512)
