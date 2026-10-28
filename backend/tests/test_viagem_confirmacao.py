"""Testes unitários e de integração do fluxo completo de Confirmação de Presença de Viagens (TFD):
1. Geração de token de confirmação e status inicial pendente
2. Consulta pública dos dados do transporte via token
3. Confirmação de presença em tempo real pelo paciente
4. Registro de desistência com motivo
5. Atualização manual de status de presença pelo operador
6. Envio/geração de link de WhatsApp com dados da viagem
7. Rotina do worker de lembrete na véspera da viagem
"""

from datetime import date, datetime, timedelta
import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.user import User
from app.models.tfd import Paciente, Viagem, ViagemPaciente, Veiculo
from app.models.integracoes import IntegrationSettings, WhatsAppLog
from app.schemas.tfd import (
    ViagemIn,
    ViagemPacienteIn,
    ViagemConfirmarIn,
    ViagemStatusConfirmacaoIn,
)
from app.api.v1.tfd import (
    add_passageiro,
    listar_passageiros,
    obter_confirmacao_viagem_publica,
    confirmar_presenca_viagem_publica,
    atualizar_confirmacao_passageiro,
    enviar_whatsapp_confirmacao_passageiro,
    _dia_payload,
)
from app.services.whatsapp import gerar_texto_lembrete_viagem
from app.services.whatsapp_reminder_worker import executar_disparo_lembretes_dia_anterior


@pytest.fixture
def db():
    test_engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(test_engine)
    with Session(test_engine) as session:
        yield session


def test_geracao_token_e_status_inicial_passageiro(db: Session):
    # Setup paciente e viagem
    pac = Paciente(nome="Carlos Silva", cpf="111.222.333-44", telefone="35999887766", municipio="Guapé")
    db.add(pac)
    db.commit()

    amanha = date.today() + timedelta(days=1)
    viag = Viagem(
        destino="Passos",
        unidade="Santa Casa de Passos",
        data_viagem=amanha,
        hora_saida="06:00",
        ponto_saida="Prefeitura Municipal de Guapé",
        status="agendada",
    )
    db.add(viag)
    db.commit()

    ator = User(username="operador_tfd", is_superuser=True)
    p_in = ViagemPacienteIn(paciente_id=pac.id, tratamento="Consulta Oftalmologia")
    vp_out = add_passageiro(vid=viag.id, data=p_in, db=db, ator=ator)

    assert vp_out.paciente_id == pac.id
    assert vp_out.status_confirmacao == "pendente"
    assert vp_out.token_confirmacao != ""
    assert len(vp_out.token_confirmacao) >= 16
    assert "/confirmar-presenca/" in vp_out.link_confirmacao


def test_consulta_publica_dados_viagem(db: Session):
    pac = Paciente(nome="Maria Aparecida", cpf="222.333.444-55", telefone="35988776655")
    veic = Veiculo(placa="SHK-9812", modelo="Van Sprinter", tipo="van", capacidade=15)
    db.add(pac)
    db.add(veic)
    db.commit()

    amanha = date.today() + timedelta(days=1)
    viag = Viagem(
        destino="Alfenas",
        unidade="Hospital Alzira Velano",
        data_viagem=amanha,
        hora_saida="05:30",
        ponto_saida="Em frente à Prefeitura de Guapé",
        veiculo_id=veic.id,
        motorista="João Motorista",
        status="agendada",
    )
    db.add(viag)
    db.commit()

    vp = ViagemPaciente(
        viagem_id=viag.id,
        paciente_id=pac.id,
        acompanhante="José Aparecido",
        tratamento="Hemodiálise",
        token_confirmacao="tok-teste-publico-123",
        status_confirmacao="pendente",
    )
    db.add(vp)
    db.commit()

    res = obter_confirmacao_viagem_publica(token="tok-teste-publico-123", db=db)
    assert res.paciente_nome == "Maria Aparecida"
    assert res.destino == "Alfenas"
    assert res.hora_saida == "05:30"
    assert "Prefeitura" in res.ponto_saida
    assert "Van Sprinter" in res.veiculo
    assert res.motorista == "João Motorista"
    assert res.acompanhante == "José Aparecido"
    assert res.status_confirmacao == "pendente"


def test_confirmacao_presenca_pelo_paciente(db: Session):
    pac = Paciente(nome="Roberto Carlos", cpf="333.444.555-66")
    db.add(pac)
    db.commit()

    viag = Viagem(
        destino="Varginha",
        data_viagem=date.today() + timedelta(days=1),
        hora_saida="06:15",
        status="agendada",
    )
    db.add(viag)
    db.commit()

    vp = ViagemPaciente(
        viagem_id=viag.id,
        paciente_id=pac.id,
        token_confirmacao="tok-confirmacao-999",
        status_confirmacao="pendente",
        presente=True,
    )
    db.add(vp)
    db.commit()

    # Paciente acessa link e clica em Confirmar
    dados_confirmar = ViagemConfirmarIn(acao="confirmar")
    atualizado = confirmar_presenca_viagem_publica(
        token="tok-confirmacao-999",
        data=dados_confirmar,
        db=db,
    )

    assert atualizado.status_confirmacao == "confirmado"
    assert atualizado.confirmado_em is not None

    # Verifica persistência no banco
    db.refresh(vp)
    assert vp.status_confirmacao == "confirmado"
    assert vp.confirmado_em is not None
    assert vp.presente is True


def test_desistencia_pelo_paciente_com_motivo(db: Session):
    pac = Paciente(nome="Luciana Santos", cpf="444.555.666-77")
    db.add(pac)
    db.commit()

    viag = Viagem(
        destino="Pouso Alegre",
        data_viagem=date.today() + timedelta(days=1),
        hora_saida="05:00",
        status="agendada",
    )
    db.add(viag)
    db.commit()

    vp = ViagemPaciente(
        viagem_id=viag.id,
        paciente_id=pac.id,
        token_confirmacao="tok-desistir-555",
        status_confirmacao="pendente",
        presente=True,
    )
    db.add(vp)
    db.commit()

    # Paciente informa que não poderá ir
    dados_desistir = ViagemConfirmarIn(
        acao="desistir",
        motivo="Consulta remarcada pelo médico",
    )
    atualizado = confirmar_presenca_viagem_publica(
        token="tok-desistir-555",
        data=dados_desistir,
        db=db,
    )

    assert atualizado.status_confirmacao == "desistiu"
    db.refresh(vp)
    assert vp.status_confirmacao == "desistiu"
    assert vp.presente is False
    assert "Consulta remarcada" in vp.observacoes


def test_atualizacao_manual_operador(db: Session):
    pac = Paciente(nome="Antônio Pereira", cpf="555.666.777-88")
    db.add(pac)
    db.commit()

    viag = Viagem(
        destino="Passos",
        data_viagem=date.today() + timedelta(days=2),
        hora_saida="07:00",
        status="agendada",
    )
    db.add(viag)
    db.commit()

    vp = ViagemPaciente(
        viagem_id=viag.id,
        paciente_id=pac.id,
        token_confirmacao="tok-op-111",
        status_confirmacao="pendente",
        presente=True,
    )
    db.add(vp)
    db.commit()

    ator = User(username="operador_frota", is_superuser=True)

    # Operador marca presença confirmada
    dados_st = ViagemStatusConfirmacaoIn(status_confirmacao="confirmado", observacoes="Confirmou presencialmente na recepção")
    res = atualizar_confirmacao_passageiro(
        vid=viag.id,
        vpid=vp.id,
        data=dados_st,
        db=db,
        ator=ator,
    )
    assert res.status_confirmacao == "confirmado"
    assert res.confirmado_em is not None

    # Operador marca falta/não compareceu
    dados_falta = ViagemStatusConfirmacaoIn(status_confirmacao="nao_compareceu")
    res_falta = atualizar_confirmacao_passageiro(
        vid=viag.id,
        vpid=vp.id,
        data=dados_falta,
        db=db,
        ator=ator,
    )
    assert res_falta.status_confirmacao == "nao_compareceu"
    db.refresh(vp)
    assert vp.presente is False


def test_enviar_whatsapp_confirmacao_passageiro(db: Session):
    pac = Paciente(nome="Fernanda Lima", cpf="666.777.888-99", telefone="35991234567")
    db.add(pac)
    db.commit()

    viag = Viagem(
        destino="Belo Horizonte",
        unidade="Hospital das Clínicas UFMG",
        data_viagem=date.today() + timedelta(days=1),
        hora_saida="04:00",
        ponto_saida="Prefeitura Municipal de Guapé",
        status="agendada",
    )
    db.add(viag)
    db.commit()

    vp = ViagemPaciente(
        viagem_id=viag.id,
        paciente_id=pac.id,
        token_confirmacao="tok-wa-333",
        status_confirmacao="pendente",
    )
    db.add(vp)
    db.commit()

    ator = User(username="operador_frota", is_superuser=True)
    res = enviar_whatsapp_confirmacao_passageiro(vid=viag.id, vpid=vp.id, db=db, ator=ator)

    assert "link_confirmacao" in res
    assert "/confirmar-presenca/tok-wa-333" in res["link_confirmacao"]
    assert "mensagem" in res
    assert "CONFIRMAÇÃO OBRIGATÓRIA" in res["mensagem"]
    assert "https://wa.me/5535991234567" in res["whatsapp_link"]


def test_grade_semanal_payload_com_status_confirmacao(db: Session):
    pac1 = Paciente(nome="João Confirmado", cpf="777.888.999-01")
    pac2 = Paciente(nome="Maria Pendente", cpf="777.888.999-02")
    db.add(pac1)
    db.add(pac2)
    db.commit()

    dt_str = "2026-11-10"
    dt = date.fromisoformat(dt_str)
    viag = Viagem(
        destino="Passos",
        data_viagem=dt,
        hora_saida="06:00",
        ponto_saida="Prefeitura Municipal",
        status="agendada",
    )
    db.add(viag)
    db.commit()

    vp1 = ViagemPaciente(
        viagem_id=viag.id,
        paciente_id=pac1.id,
        token_confirmacao="tok-conf-1",
        status_confirmacao="confirmado",
        confirmado_em=datetime.utcnow(),
    )
    vp2 = ViagemPaciente(
        viagem_id=viag.id,
        paciente_id=pac2.id,
        token_confirmacao="tok-pend-2",
        status_confirmacao="pendente",
    )
    db.add(vp1)
    db.add(vp2)
    db.commit()

    payload = _dia_payload(db=db, data=dt_str, redigir_pacientes=False)
    viagens_passos = payload["destinos"][0]["viagens"]
    assert len(viagens_passos) == 1
    v0 = viagens_passos[0]
    assert v0["confirmados"] == 1
    assert v0["pendentes"] == 1
    assert len(v0["passageiros"]) == 2
    p0 = next(p for p in v0["passageiros"] if p["id"] == vp1.id)
    assert p0["status_confirmacao"] == "confirmado"
    assert "/confirmar-presenca/tok-conf-1" in p0["link_confirmacao"]


def test_worker_disparo_lembrete_viagem_dia_anterior(db: Session):
    # Habilita WhatsApp nas configurações de integração
    cfg = IntegrationSettings(
        id=1,
        whatsapp_habilitado=True,
        whatsapp_notificar_agendamento=True,
        whatsapp_provedor="webhook_generico",
        whatsapp_api_url="",  # Mock
    )
    db.add(cfg)
    db.commit()

    pac = Paciente(nome="Valéria Andrade", cpf="888.999.000-11", telefone="35998877665")
    db.add(pac)
    db.commit()

    amanha = date.today() + timedelta(days=1)
    viag = Viagem(
        destino="Passos",
        unidade="Hospital Regional",
        data_viagem=amanha,
        hora_saida="06:00",
        ponto_saida="Prefeitura Municipal de Guapé",
        status="agendada",
    )
    db.add(viag)
    db.commit()

    vp = ViagemPaciente(
        viagem_id=viag.id,
        paciente_id=pac.id,
        status_confirmacao="pendente",
        presente=True,
    )
    db.add(vp)
    db.commit()

    # Executa worker para o dia seguinte
    resultado = executar_disparo_lembretes_dia_anterior(db, target_date=amanha)
    assert resultado["executado"] is True

    # Verifica se gerou token e tentou disparar
    db.refresh(vp)
    assert vp.token_confirmacao != ""
    assert len(vp.token_confirmacao) >= 16

    # Verifica se log de WhatsApp foi criado
    log = db.exec(select(WhatsAppLog).where(WhatsAppLog.paciente_id == pac.id, WhatsAppLog.tipo_evento == "lembrete_viagem")).first()
    assert log is not None
    assert "CONFIRMAÇÃO OBRIGATÓRIA" in log.mensagem
    assert f"/confirmar-presenca/{vp.token_confirmacao}" in log.mensagem
