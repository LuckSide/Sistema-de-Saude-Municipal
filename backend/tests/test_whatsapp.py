from datetime import date
import pytest
from sqlmodel import SQLModel, create_engine, Session, select
from fastapi import HTTPException
from app.models.tfd import Paciente, ExameFila
from app.models.integracoes import IntegrationSettings, WhatsAppLog
from app.services.whatsapp import (
    normalizar_telefone_whatsapp,
    formatar_telefone_exibicao,
    gerar_texto_entrada_fila,
    gerar_texto_agendamento,
    gerar_link_whatsapp,
    notificar_paciente_evento,
    disparar_whatsapp_gateway,
)
from app.api.v1.whatsapp import (
    obter_configuracao_whatsapp,
    salvar_configuracao_whatsapp,
    obter_preview_whatsapp,
    enviar_mensagem_whatsapp,
    endpoint_testar_whatsapp,
    listar_logs_whatsapp,
    WhatsAppConfigIn,
    WhatsAppEnviarIn,
    WhatsAppTestarIn,
)
from app.models.user import User


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        yield db


def test_normalizacao_telefone_whatsapp():
    # DDD padrão 35
    assert normalizar_telefone_whatsapp("98888-7777", ddd_padrao="35") == "5535988887777"
    assert normalizar_telefone_whatsapp("8888-7777", ddd_padrao="35") == "553588887777"
    assert normalizar_telefone_whatsapp("(35) 98888-7777") == "5535988887777"
    assert normalizar_telefone_whatsapp("(35) 3522-1234") == "553535221234"
    assert normalizar_telefone_whatsapp("5535988887777") == "5535988887777"
    assert normalizar_telefone_whatsapp("+55 (35) 98888-7777") == "5535988887777"
    
    # Inválidos ou vazios
    assert normalizar_telefone_whatsapp("") is None
    assert normalizar_telefone_whatsapp(None) is None
    assert normalizar_telefone_whatsapp("123") is None


def test_formatar_telefone_exibicao():
    assert formatar_telefone_exibicao("35988887777") == "(35) 98888-7777"
    assert formatar_telefone_exibicao("5535988887777") == "(35) 98888-7777"
    assert formatar_telefone_exibicao("3535221234") == "(35) 3522-1234"
    assert formatar_telefone_exibicao("123") == "123"


def test_gerar_textos_whatsapp():
    pac = Paciente(nome="Maria da Silva", telefone="(35) 99999-1111", cns="700000000000001")
    pac.id = 101

    ex = ExameFila(
        paciente_id=101,
        paciente_nome="Maria da Silva",
        exame="GLICOSE EM JEJUM",
        procedimento_codigo="0202010473",
        status="aguardando",
        codigo_curto="EX-000101",
    )
    ex.id = 202

    # Texto Entrada na Fila
    txt_fila = gerar_texto_entrada_fila(pac, ex)
    assert "Maria" in txt_fila
    assert "Silva" in txt_fila
    assert "GLICOSE EM JEJUM" in txt_fila
    assert "Fila de Espera" in txt_fila
    assert "EX-000101" in txt_fila
    assert "Secretaria Municipal de Saúde de Guapé" in txt_fila

    # Texto Agendamento com Preparo Clínico
    ex.data_agendada = date(2026, 11, 5)
    ex.hora_agendada = "07:30"
    txt_agendado = gerar_texto_agendamento(
        paciente=pac,
        exame=ex,
        local_nome="Laboratório Central de Guapé",
    )
    assert "Maria" in txt_agendado
    assert "Silva" in txt_agendado
    assert "AGENDADO" in txt_agendado
    assert "05/11/2026" in txt_agendado
    assert "07:30" in txt_agendado
    assert "Laboratório Central de Guapé" in txt_agendado
    assert "Jejum" in txt_agendado  # Glicose tem preparo de jejum 8-12h automático!

    # Geração de link wa.me
    link = gerar_link_whatsapp("35999991111", txt_agendado)
    assert link.startswith("https://wa.me/5535999991111?text=")
    assert "Maria" in link and "Silva" in link


def test_configuracao_e_logs_whatsapp(session):
    admin = User(login="admin", role="administrador", is_superuser=True, ativo=True)
    admin.id = 1

    # Obter configuração inicial (vazia/padrão)
    cfg = obter_configuracao_whatsapp(db=session, ator=admin)
    assert cfg.whatsapp_habilitado is False
    assert cfg.whatsapp_ddd_padrao == "35"
    assert cfg.whatsapp_token_configurado is False

    # Salvar nova configuração
    novo_cfg = WhatsAppConfigIn(
        whatsapp_habilitado=True,
        whatsapp_provedor="z_api",
        whatsapp_api_url="https://api.z-api.io/instances/test/token/test",
        whatsapp_api_token="secreto_token_123",
        whatsapp_instancia_id="INST_123",
        whatsapp_notificar_entrada_fila=True,
        whatsapp_notificar_agendamento=True,
        whatsapp_ddd_padrao="35",
    )
    salvo = salvar_configuracao_whatsapp(data=novo_cfg, db=session, ator=admin)
    assert salvo.whatsapp_habilitado is True
    assert salvo.whatsapp_provedor == "z_api"
    assert salvo.whatsapp_token_configurado is True

    # Testar endpoint de preview
    pac = Paciente(nome="Carlos Souza", telefone="(35) 99888-0000", cns="700000000000002")
    session.add(pac)
    session.commit()
    session.refresh(pac)

    ex = ExameFila(
        paciente_id=pac.id,
        paciente_nome=pac.nome,
        exame="HEMOGRAMA COMPLETO",
        status="agendado",
        data_agendada=date(2026, 11, 10),
        hora_agendada="08:00",
        destino="Laboratório São Lucas",
    )
    session.add(ex)
    session.commit()
    session.refresh(ex)

    prev = obter_preview_whatsapp(exame_id=ex.id, tipo="agendamento", db=session, ator=admin)
    assert prev.paciente_nome == "Carlos Souza"
    assert prev.telefone_formatado == "(35) 99888-0000"
    assert prev.telefone_whatsapp == "5535998880000"
    assert "HEMOGRAMA COMPLETO" in prev.mensagem
    assert "10/11/2026" in prev.mensagem
    assert "Laboratório São Lucas" in prev.mensagem
    assert prev.whatsapp_habilitado is True

    # Teste de envio com gateway
    res_teste = endpoint_testar_whatsapp(data=WhatsAppTestarIn(telefone="35998880000"), db=session, ator=admin)
    # Como a URL é de teste/fake, deve falhar com tratamento elegante e registrar log
    assert res_teste["status"].lower() in ("erro", "simulado", "falha")

    # Verificar que o log foi gravado no banco de auditoria
    logs = listar_logs_whatsapp(limit=10, db=session, ator=admin)
    assert len(logs) >= 1
    assert logs[0].telefone_destinatario == "5535998880000"
    assert logs[0].tipo_evento == "teste"


def test_notificar_paciente_evento_nao_bloqueia_transacao(session):
    # Garante que erro de rede ou gateway desativado não lança exceção fatal
    pac = Paciente(nome="Paciente Sem Telefone")
    session.add(pac)
    session.commit()
    session.refresh(pac)

    ex = ExameFila(paciente_id=pac.id, paciente_nome=pac.nome, exame="RAIO-X DE TORAX", status="aguardando")
    session.add(ex)
    session.commit()
    session.refresh(ex)

    # Executa trigger sem telefone -> deve finalizar suavemente retornando sucesso False sem crash
    res = notificar_paciente_evento(session, "entrada_fila", ex, pac)
    assert res["sucesso"] is False
