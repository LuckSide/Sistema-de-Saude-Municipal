import pytest
from datetime import date, datetime
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool
from fastapi import HTTPException

from app.models.tfd import Paciente, ExameFila
from app.models.cadastros_saude import UnidadeSaude
from app.models.user import User
from app.api.v1.tfd import (
    gerar_dados_comprovante_tfd,
    leitura_rapida_qr,
    recepcao_rapida,
    RecepcionarRapidoIn,
)


@pytest.fixture(name="session")
def session_fixture():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def test_comprovante_unificado_multiplos_exames_mesmo_pedido(session: Session):
    pac = Paciente(nome="Maria Aparecida da Silva", cpf="12345678900", cns="700000000000001")
    session.add(pac)
    session.commit()
    session.refresh(pac)

    unidade = UnidadeSaude(nome="PSF Centro - Dr. Celso", codigo_cnes="1234567")
    session.add(unidade)
    session.commit()
    session.refresh(unidade)

    num_pedido = "PED-202610-998877"

    # Medico solicita 3 exames de sangue no mesmo pedido
    ex1 = ExameFila(
        paciente_id=pac.id,
        unidade_saude_id=unidade.id,
        unidade_nome=unidade.nome,
        exame="0202010183 · GLICOSE",
        codigo_procedimento="0202010183",
        numero_pedido=num_pedido,
        codigo_curto="EX-1001",
        data_pedido=date.today(),
        status="agendado",
        data_agendada=date.today(),
        hora_agendada="07:30",
        ativo=True,
    )
    ex2 = ExameFila(
        paciente_id=pac.id,
        unidade_saude_id=unidade.id,
        unidade_nome=unidade.nome,
        exame="0202010272 · HEMOGRAMA COMPLETO",
        codigo_procedimento="0202010272",
        numero_pedido=num_pedido,
        codigo_curto="EX-1002",
        data_pedido=date.today(),
        status="agendado",
        data_agendada=date.today(),
        hora_agendada="07:30",
        ativo=True,
    )
    ex3 = ExameFila(
        paciente_id=pac.id,
        unidade_saude_id=unidade.id,
        unidade_nome=unidade.nome,
        exame="0202010299 · LIPIDOGRAMA (COLESTEROL TOTAL E FRACOES)",
        codigo_procedimento="0202010299",
        numero_pedido=num_pedido,
        codigo_curto="EX-1003",
        data_pedido=date.today(),
        status="agendado",
        data_agendada=date.today(),
        hora_agendada="07:30",
        ativo=True,
    )
    session.add_all([ex1, ex2, ex3])
    session.commit()
    session.refresh(ex1)

    # Gera comprovante a partir de qualquer um dos exames do pedido
    comp = gerar_dados_comprovante_tfd(session, ex1)

    assert comp["protocolo"] == num_pedido
    assert comp["paciente_nome"] == "Maria Aparecida da Silva"
    assert comp["paciente_cpf"] == "12345678900"
    assert len(comp["itens"]) == 3
    # Verifica procedimentos unificados na tabela
    descricoes = [it["procedimento_descricao"] for it in comp["itens"]]
    assert "GLICOSE" in descricoes
    assert "HEMOGRAMA COMPLETO" in descricoes
    assert "LIPIDOGRAMA (COLESTEROL TOTAL E FRACOES)" in descricoes

    # QR Code gerado
    assert "qr_code_url" in comp
    assert "api.qrserver.com" in comp["qr_code_url"]
    # Jejum e preparo clínico computados automaticamente
    assert comp["jejum_horas"] != ""


def test_leitura_rapida_qr_e_recepcao_em_lote(session: Session):
    pac = Paciente(nome="João Batista Pereira", cpf="98765432100", codigo_prontuario="PR-00999")
    session.add(pac)
    session.commit()
    session.refresh(pac)

    num_pedido = "PED-202610-554433"
    cod_curto = "EX-005544"

    ex1 = ExameFila(
        paciente_id=pac.id,
        exame="0202010183 · GLICOSE",
        codigo_procedimento="0202010183",
        numero_pedido=num_pedido,
        codigo_curto=cod_curto,
        data_pedido=date.today(),
        status="agendado",
        data_agendada=date.today(),
        public_token="token_qr_teste_123",
        ativo=True,
    )
    ex2 = ExameFila(
        paciente_id=pac.id,
        exame="0202010507 · TRIGLICERIDEOS",
        codigo_procedimento="0202010507",
        numero_pedido=num_pedido,
        codigo_curto="EX-005545",
        data_pedido=date.today(),
        status="agendado",
        data_agendada=date.today(),
        ativo=True,
    )
    session.add_all([ex1, ex2])
    session.commit()
    session.refresh(ex1)

    ator = User(id=1, username="atendente_balcao", nome="Atendente Balcão", role="operador")

    # 1. Leitura rápida com scanner QR Code (formato de string estruturada ou código puro)
    qr_lido_1 = f"PEDIDO:{cod_curto}|PRONT:PR-00999|PAC:{pac.id}"
    res1 = leitura_rapida_qr(codigo=qr_lido_1, db=session, ator=ator)
    assert res1["encontrado"] is True
    assert res1["paciente"]["nome"] == "João Batista Pereira"
    assert res1["numero_pedido"] == num_pedido
    assert len(res1["exames"]) == 2
    assert res1["pode_recepcionar"] is True

    # 2. Leitura rápida pelo número de pedido puro
    res2 = leitura_rapida_qr(codigo=num_pedido, db=session, ator=ator)
    assert res2["encontrado"] is True
    assert len(res2["exames"]) == 2

    # 3. Leitura rápida pelo token público
    res3 = leitura_rapida_qr(codigo="token_qr_teste_123", db=session, ator=ator)
    assert res3["encontrado"] is True

    # 4. Recepção rápida em lote via QR Code
    resp_rec = recepcao_rapida(
        payload=RecepcionarRapidoIn(codigo=cod_curto, resultado="Tubos coletados com sucesso"),
        db=session,
        ator=ator,
    )
    assert resp_rec["sucesso"] is True
    assert resp_rec["total_recepcionados"] == 2

    session.refresh(ex1)
    session.refresh(ex2)
    assert ex1.status == "recepcionado"
    assert ex2.status == "recepcionado"
    assert ex1.recepcionado_por == "Atendente Balcão"
    assert ex2.recepcionado_por == "Atendente Balcão"
    assert ex1.resultado == "Tubos coletados com sucesso"


def test_geradores_aleatorios_nao_procedurais(session: Session):
    import re
    from app.services.geradores import (
        gerar_prontuario_aleatorio,
        gerar_exame_curto_aleatorio,
        gerar_numero_pedido_aleatorio,
        gerar_protocolo_lab_aleatorio,
    )

    prontuarios = [gerar_prontuario_aleatorio(session) for _ in range(30)]
    assert len(set(prontuarios)) == 30
    for p in prontuarios:
        assert re.match(r"^PR-\d{5}$", p)

    exames = [gerar_exame_curto_aleatorio(session) for _ in range(30)]
    assert len(set(exames)) == 30
    for e in exames:
        assert re.match(r"^EX-\d{6}$", e)

    pedidos = [gerar_numero_pedido_aleatorio(session) for _ in range(30)]
    assert len(set(pedidos)) == 30
    for ped in pedidos:
        assert re.match(r"^PED-\d{4}-\d{6}$", ped)

    protocolos = [gerar_protocolo_lab_aleatorio() for _ in range(30)]
    assert len(set(protocolos)) == 30
    for proto in protocolos:
        assert re.match(r"^LAB-\d{4}-\d{6}$", proto)


def test_fila_psf_com_exames_sigtap_e_data_solicitacao(session: Session):
    from app.models.lab_exames import SigtapProcedimento
    from app.models.lab_fase6 import Laboratorio
    from app.schemas.lab_fase6 import FilaPsfIn, FilaPsfAgendarLoteIn
    from app.api.v1.lab_fase6 import criar_fila, _formatar_fila_out
    from app.services.lab_fase6 import agendar_lote_fila

    # Cria procedimentos SIGTAP
    sig1 = SigtapProcedimento(
        codigo="0202010183",
        descricao="DOSAGEM DE GLICOSE",
        complexidade="AB",
        tipo="LAB",
        ativo=True,
    )
    sig2 = SigtapProcedimento(
        codigo="0202010272",
        descricao="HEMOGRAMA COMPLETO",
        complexidade="AB",
        tipo="LAB",
        ativo=True,
    )
    session.add_all([sig1, sig2])

    # Cria paciente e laboratório
    pac = Paciente(nome="Carlos Alberto de Souza", cpf="33344455566", codigo_prontuario="PR-77889")
    lab = Laboratorio(nome="Laboratório Central Municipal", cnes="7654321", ativo=True)
    session.add_all([pac, lab])
    session.commit()
    session.refresh(sig1)
    session.refresh(sig2)
    session.refresh(pac)
    session.refresh(lab)

    from app.models.lab_fase6 import VagaLab
    vaga = VagaLab(laboratorio_id=lab.id, data=date(2026, 10, 28), vagas_totais=10, vagas_ocupadas=0)
    session.add(vaga)
    session.commit()

    # 1. Cria item na fila com exames selecionados e data do pedido
    payload = FilaPsfIn(
        paciente_id=pac.id,
        unidade_psf="PSF Bela Vista",
        medico_solicitante="Dr. Roberto",
        data_solicitacao=date(2026, 10, 15),
        justificativa="Investigação de anemia e controle glicêmico de rotina",
        sigtap_ids=[sig1.id, sig2.id],
    )
    fila_item = criar_fila(payload, db=session)
    assert fila_item.id is not None
    assert fila_item.data_solicitacao == date(2026, 10, 15)
    assert fila_item.sigtap_ids == [sig1.id, sig2.id]
    assert len(fila_item.exames_nomes) == 2
    assert "DOSAGEM DE GLICOSE" in fila_item.exames_nomes[0]
    assert "HEMOGRAMA COMPLETO" in fila_item.exames_nomes[1]

    # 2. Testa agendamento em lote preservando os exames selecionados da fila
    solicitacoes = agendar_lote_fila(
        db=session,
        fila_ids=[fila_item.id],
        laboratorio_id=lab.id,
        data_agendada=date(2026, 10, 28),
        hora_agendada="07:30",
        sigtap_ids=[],
        agendado_por="operador_teste",
    )
    assert len(solicitacoes) == 1
    mestre = solicitacoes[0]
    assert mestre.paciente_id == pac.id
    assert mestre.laboratorio_id == lab.id
    assert mestre.status == "agendado"

    # Confirma que os 2 itens de exames foram criados vinculados à solicitação mestre
    from app.models.lab_fase6 import ItemSolic
    from sqlmodel import select
    itens = list(session.exec(select(ItemSolic).where(ItemSolic.solicitacao_id == mestre.id)).all())
    assert len(itens) == 2
    s_ids = [it.sigtap_id for it in itens]
    assert sig1.id in s_ids
    assert sig2.id in s_ids


def test_comprovante_sem_preparo_para_exames_gerais_nao_sangue(session: Session):
    pac = Paciente(nome="Francisca Alves", cpf="98765432100", cns="700000000000099")
    session.add(pac)
    session.commit()
    session.refresh(pac)

    # Exame de Mamografia (não é de sangue / laboratorial)
    ex_mamo = ExameFila(
        paciente_id=pac.id,
        tipo_fila="MAMOGRAFIA",
        exame="0204030188 · MAMOGRAFIA BILATERAL PARA RASTREAMENTO",
        codigo_procedimento="0204030188",
        numero_pedido="PED-MAMO-001",
        data_pedido=date.today(),
        status="agendado",
        data_agendada=date.today(),
        hora_agendada="08:00",
        ativo=True,
    )
    session.add(ex_mamo)
    session.commit()
    session.refresh(ex_mamo)

    comp = gerar_dados_comprovante_tfd(session, ex_mamo)

    # Exames que não são de sangue NÃO devem exibir preparo nem jejum
    assert comp["exige_preparo"] is False
    assert comp["jejum_horas"] == ""
    assert len(comp["preparo_instrucoes"]) == 0
    assert len(comp["orientacoes_gerais"]) == 0
    for it in comp["itens"]:
        assert it["preparo_especifico"] == ""


def test_whatsapp_sem_preparo_para_exames_gerais_nao_sangue():
    from app.services.whatsapp import gerar_texto_agendamento

    pac = Paciente(nome="Francisca Alves", cpf="98765432100")

    # 1. Mamografia: NÃO deve ter jejum nem bloco de preparo de sangue
    ex_mamo = ExameFila(
        id=10,
        exame="MAMOGRAFIA BILATERAL",
        tipo_fila="MAMOGRAFIA",
        codigo_procedimento="0204030188",
    )
    txt_mamo = gerar_texto_agendamento(pac, ex_mamo)
    assert "Jejum" not in txt_mamo
    assert "Instruções e Preparo Necessário" not in txt_mamo

    # 2. Hemograma de Sangue: DEVE ter jejum e bloco de preparo
    ex_sangue = ExameFila(
        id=11,
        exame="HEMOGRAMA COMPLETO",
        tipo_fila="EXAMES LABORATORIAIS",
        codigo_procedimento="0202010120",
    )
    txt_sangue = gerar_texto_agendamento(pac, ex_sangue)
    assert "Jejum" in txt_sangue
    assert "Instruções e Preparo Necessário" in txt_sangue


def test_tela_recepcao_lab_sem_botoes_comprovante_e_whatsapp():
    import os
    path = os.path.join(os.path.dirname(__file__), "../../frontend/src/pages/lab/RecepcaoLab.tsx")
    with open(path, "r", encoding="utf-8") as f:
        conteudo = f.read()

    # Tela do laboratório não deve ter as opções de imprimir comprovante nem enviar WhatsApp
    assert "ComprovanteExameModal" not in conteudo
    assert "BotaoWhatsApp" not in conteudo
    assert "Printer" not in conteudo


def test_cruzamento_transporte_e_exibicao_condicional_no_qr_code(session: Session):
    from app.models.tfd import Viagem, ViagemPaciente, Veiculo

    # 1. Cria Paciente
    pac = Paciente(nome="Sebastião Oliveira", cpf="11122233344", telefone="35999998888")
    session.add(pac)
    session.commit()
    session.refresh(pac)

    # 2. Cria Veículo e Viagem no TFD
    veic = Veiculo(placa="GPZ-1020", modelo="Chevrolet Spin 7 Lugares", tipo="carro")
    session.add(veic)
    session.commit()
    session.refresh(veic)

    data_exame = date(2026, 11, 10)
    viagem = Viagem(
        destino="Alfenas - Hospital Regional",
        data_viagem=data_exame,
        hora_saida="06:30",
        veiculo_id=veic.id,
        motorista="João da Silva",
        observacoes="Embarque na Praça da Prefeitura às 06:30",
        status="agendada",
    )
    session.add(viagem)
    session.commit()
    session.refresh(viagem)

    vp = ViagemPaciente(
        viagem_id=viagem.id,
        paciente_id=pac.id,
        acompanhante="Maria Oliveira",
    )
    session.add(vp)
    session.commit()

    # 3. Exame no mesmo dia da viagem: DEVE cruzar os dados de transporte
    ex_com_viagem = ExameFila(
        paciente_id=pac.id,
        exame="RESSONANCIA MAGNETICA",
        codigo_procedimento="0207010064",
        numero_pedido="PED-VIAGEM-999",
        codigo_curto="EX-9999",
        data_pedido=date(2026, 10, 20),
        status="agendado",
        data_agendada=data_exame,
        hora_agendada="09:00",
        instrucoes_transporte="Aguardar na prefeitura às 06:30 para o transporte do exame",
        ativo=True,
    )
    session.add(ex_com_viagem)
    session.commit()
    session.refresh(ex_com_viagem)

    user_admin = User(username="admin", role="admin", is_superuser=True)

    # Leitura do QR Code com viagem vinculada
    res_qr = leitura_rapida_qr(codigo="EX-9999", db=session, ator=user_admin)
    assert res_qr["encontrado"] is True
    assert res_qr["transporte"] is not None
    assert res_qr["transporte"]["possui_viagem"] is True
    assert "Spin" in res_qr["transporte"]["veiculo"]
    assert "GPZ-1020" in res_qr["transporte"]["veiculo"]
    assert res_qr["transporte"]["horario_saida"] == "06:30"
    assert "Prefeitura" in res_qr["transporte"]["ponto_saida"]
    assert res_qr["transporte"]["motorista"] == "João da Silva"
    assert res_qr["transporte"]["acompanhante"] == "Maria Oliveira"
    assert res_qr["instrucoes_transporte"] == "Aguardar na prefeitura às 06:30 para o transporte do exame"

    # Comprovante também traz os dados da viagem
    comp = gerar_dados_comprovante_tfd(session, ex_com_viagem)
    assert comp["transporte"] is not None
    assert comp["transporte"]["possui_viagem"] is True
    assert comp["instrucoes_transporte"] == "Aguardar na prefeitura às 06:30 para o transporte do exame"

    # 4. Caso SEM viagem (outro paciente ou outra data)
    pac2 = Paciente(nome="Carlos Sem Viagem", cpf="55566677788", telefone="35988887777")
    session.add(pac2)
    session.commit()
    session.refresh(pac2)

    ex_sem_viagem = ExameFila(
        paciente_id=pac2.id,
        exame="ELETROCARDIOGRAMA",
        codigo_procedimento="0211020036",
        numero_pedido="PED-LOCAL-888",
        codigo_curto="EX-8888",
        data_pedido=date(2026, 10, 20),
        status="agendado",
        data_agendada=date(2026, 11, 15),
        hora_agendada="10:00",
        ativo=True,
    )
    session.add(ex_sem_viagem)
    session.commit()
    session.refresh(ex_sem_viagem)

    # Leitura do QR Code sem viagem vinculada: transporte DEVE ser None
    res_qr_sem = leitura_rapida_qr(codigo="EX-8888", db=session, ator=user_admin)
    assert res_qr_sem["encontrado"] is True
    assert res_qr_sem["transporte"] is None

    comp_sem = gerar_dados_comprovante_tfd(session, ex_sem_viagem)
    assert comp_sem["transporte"] is None


def test_whatsapp_marcacao_em_lote_e_lembrete_dia_anterior(session: Session):
    from datetime import timedelta
    from app.models.integracoes import IntegrationSettings
    from app.services.whatsapp import gerar_texto_agendamento, gerar_texto_lembrete
    from app.services.whatsapp_reminder_worker import executar_disparo_lembretes_dia_anterior

    # Configuração de WhatsApp ativa em memória
    cfg = IntegrationSettings(
        id=1,
        whatsapp_habilitado=True,
        whatsapp_provedor="webhook_generico",
        whatsapp_api_url="http://localhost:9999/webhook",
        whatsapp_notificar_agendamento=True,
    )
    session.add(cfg)
    session.commit()

    pac = Paciente(nome="Benedito Pereira", cpf="22233344455", telefone="35999991234")
    session.add(pac)
    session.commit()
    session.refresh(pac)

    amanha = date.today() + timedelta(days=1)

    ex = ExameFila(
        paciente_id=pac.id,
        exame="TOMOGRAFIA COMPUTADORIZADA",
        codigo_procedimento="0206010010",
        numero_pedido="PED-LOTE-001",
        codigo_curto="EX-7777",
        data_pedido=date.today(),
        status="agendado",
        data_agendada=amanha,
        hora_agendada="08:00",
        instrucoes_transporte="Aguardar na prefeitura às 07h para o transporte do exame",
        ativo=True,
    )
    session.add(ex)
    session.commit()
    session.refresh(ex)

    # 1. Verifica texto com instruções de transporte embutidas
    txt_agendamento = gerar_texto_agendamento(
        paciente=pac,
        exame=ex,
        instrucoes_adicionais=ex.instrucoes_transporte,
    )
    assert "Benedito" in txt_agendamento
    assert "TOMOGRAFIA" in txt_agendamento
    assert "Aguardar na prefeitura às 07h para o transporte do exame" in txt_agendamento
    assert "Orientações de Transporte / Instruções Adicionais" in txt_agendamento

    # 2. Verifica texto do lembrete de véspera (D-1)
    txt_lembrete = gerar_texto_lembrete(
        paciente=pac,
        exame=ex,
        instrucoes_adicionais=ex.instrucoes_transporte,
    )
    assert "LEMBRETE DE AGENDAMENTO - AMANHÃ" in txt_lembrete
    assert "Benedito" in txt_lembrete
    assert "Aguardar na prefeitura às 07h para o transporte do exame" in txt_lembrete

    # 3. Executa worker de disparo de lembretes para o dia seguinte
    res_worker = executar_disparo_lembretes_dia_anterior(session, target_date=amanha)
    assert res_worker["executado"] is True
    assert res_worker["total_elegiveis"] == 1
    # Como o webhook aponta para porta 9999 fechada, gateway registra log de falha de conexão ou sucesso
    assert (res_worker["total_enviados"] + res_worker["total_falhas"]) == 1

    # Idempotência: segunda execução no mesmo dia não deve disparar novamente para o mesmo paciente
    # Simulando um log de sucesso prévio
    from app.models.integracoes import WhatsAppLog
    log_sucesso = WhatsAppLog(
        paciente_id=pac.id,
        tipo_evento="lembrete_dia_anterior",
        telefone_destinatario="5535999991234",
        status="ENVIADO",
        sucesso=True,
    )
    session.add(log_sucesso)
    session.commit()

    res_worker2 = executar_disparo_lembretes_dia_anterior(session, target_date=amanha)
    assert res_worker2["total_ja_enviados"] == 1
    assert res_worker2["total_enviados"] == 0



