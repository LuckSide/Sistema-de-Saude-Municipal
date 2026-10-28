"""Testes automatizados do sistema de Auditoria e Logs:
- Rastreamento de Exportações e Pesquisas
- Captura de Dispositivo (User-Agent)
- Limpeza de Ruído de Autenticação (AUTH_CREATE)
- Estatísticas de Auditoria e Política de Retenção / Rotação
- Rótulos Humanizados de Ações e Entidades
"""

from datetime import datetime, timedelta, timezone
import json
import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.audit import (
    parse_device_from_ua,
    registrar_log_pesquisa,
    registrar_log_exportacao,
    entidade_acao,
)
from app.models.audit import AuditLog
from app.services.auditoria_txt import rotulo_acao, rotulo_entidade
from app.services.log_rotacao import (
    obter_estatisticas_auditoria,
    executar_rotacao_logs,
)


@pytest.fixture
def audit_session():
    test_engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(test_engine)
    with Session(test_engine) as session:
        yield session


def test_parse_device_from_ua():
    ua_win_chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    assert parse_device_from_ua(ua_win_chrome) == "Chrome no Windows (Desktop)"

    ua_mac_safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15"
    assert parse_device_from_ua(ua_mac_safari) == "Safari no macOS (Desktop)"

    ua_android_chrome = "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    assert parse_device_from_ua(ua_android_chrome) == "Chrome no Android (Mobile)"

    ua_ipad = "Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1"
    assert parse_device_from_ua(ua_ipad) == "Safari no iPad (Tablet)"

    assert parse_device_from_ua("") == "Desconhecido"


def test_remocao_ruido_auth_create():
    # Rotas de autenticação/token não devem gerar ação de escrita auditada
    ent, acao = entidade_acao("/api/auth/token", "POST")
    assert ent is None and acao is None

    ent, acao = entidade_acao("/auth/token", "POST")
    assert ent is None and acao is None

    # Rotas normais devem ser mapeadas
    ent, acao = entidade_acao("/api/tfd/pacientes", "POST")
    assert ent == "PATIENT"
    assert acao == "CREATE"


def test_rotulos_humanizados():
    assert rotulo_acao("EXPORT_EXCEL") == "Exportação de relatório (Excel)"
    assert rotulo_acao("SEARCH") == "Pesquisa / Consulta de dados"
    assert rotulo_acao("AUDIT_ROTATION") == "Rotação e arquivamento de logs"
    assert rotulo_acao("EXAM_CREATE") == "Inclusão na fila de exames"

    assert rotulo_entidade("PATIENT") == "Paciente"
    assert rotulo_entidade("EXAM") == "Fila de exames"
    assert rotulo_entidade("AUDIT") == "Auditoria"


def test_estatisticas_e_rotacao_logs(audit_session):
    agora = datetime.now(timezone.utc).replace(tzinfo=None)
    antigo = agora - timedelta(days=250)  # > 8 meses

    # Insere logs de teste
    log_recente = AuditLog(
        user_id=1,
        user_name="Administrador",
        action="EXPORT_EXCEL",
        entity="PACIENTES",
        entity_id=None,
        device="Chrome no Windows (Desktop)",
        details=json.dumps({"modulo": "pacientes", "total_registros": 45}),
        timestamp=agora,
    )
    log_busca = AuditLog(
        user_id=1,
        user_name="Administrador",
        action="SEARCH",
        entity="PROCEDIMENTOS",
        entity_id=None,
        device="Chrome no Windows (Desktop)",
        details=json.dumps({"modulo": "procedimentos", "termo": "hemograma", "total_resultados": 2}),
        timestamp=agora,
    )
    log_antigo = AuditLog(
        user_id=2,
        user_name="Operador",
        action="EXAM_UPDATE",
        entity="EXAM",
        entity_id=10,
        device="Safari no macOS (Desktop)",
        details=json.dumps({"status": "agendado"}),
        timestamp=antigo,
    )

    audit_session.add(log_recente)
    audit_session.add(log_busca)
    audit_session.add(log_antigo)
    audit_session.commit()

    # Estatísticas
    stats = obter_estatisticas_auditoria(audit_session)
    assert stats["total_registros"] == 3
    assert stats["total_exportacoes"] == 1
    assert stats["total_buscas"] == 1
    assert stats["ultimos_30_dias"] == 2
    assert "KB" in stats["tamanho_estimado_formatado"] or "bytes" in stats["tamanho_estimado_formatado"]

    # Executa rotação para logs > 6 meses (deve expurgar log_antigo)
    res_rotacao = executar_rotacao_logs(audit_session, meses_retencao=6, arquivar=False)
    assert res_rotacao["removidos"] == 1
    assert res_rotacao["meses_retencao"] == 6

    # Verifica se log_antigo foi excluído e os recentes foram preservados
    restantes = audit_session.exec(select(AuditLog)).all()
    # 2 logs originais + 1 log da própria rotação gerado
    acoes_restantes = [l.action for l in restantes]
    assert "EXAM_UPDATE" not in acoes_restantes
    assert "EXPORT_EXCEL" in acoes_restantes
    assert "SEARCH" in acoes_restantes
    assert "AUDIT_ROTATION" in acoes_restantes


def test_filtros_logs_estrutura(audit_session):
    from app.api.v1.auditoria import filtros_logs
    from app.models.user import User

    log = AuditLog(
        user_id=1,
        user_name="Administrador",
        action="EXPORT_EXCEL",
        entity="AUDIT",
        entity_id=1,
        details="{}",
    )
    audit_session.add(log)
    audit_session.commit()

    admin_user = User(id=1, username="admin", is_superuser=True, is_active=True, telas='["auditoria"]')
    filtros = filtros_logs(db=audit_session, user=admin_user)

    assert "acoes" in filtros
    assert "entidades" in filtros
    assert "usuarios" in filtros
    assert len(filtros["acoes"]) >= 1
    assert "valor" in filtros["acoes"][0] and "rotulo" in filtros["acoes"][0]
    assert filtros["acoes"][0]["valor"] == "EXPORT_EXCEL"
    assert filtros["acoes"][0]["rotulo"] == "Exportação de relatório (Excel)"

