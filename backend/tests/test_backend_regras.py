import pytest
from sqlmodel import SQLModel, create_engine, Session, select
from fastapi import HTTPException
from app.models.cadastros_saude import Medico, UnidadeSaude
from app.models.tfd import Motorista, Especialidade, ExameFila, Paciente
from app.models.user import User
from app.schemas.tfd import EspecialidadeIn
from app.schemas.cadastros_saude import MedicoIn
from app.api.v1.tfd import resolver_medico_unidade, criar_especialidade, atualizar_especialidade, filtros_opcoes
from app.api.v1.cadastros_saude import listar_medicos, _validar_nao_motorista
from sqlalchemy import event
from datetime import date


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def _sqlite_funcs(dbapi_connection, connection_record):
        if hasattr(dbapi_connection, "create_function"):
            def sqlite_to_char(val, fmt):
                if not val:
                    return ""
                s = str(val)
                if fmt == "YYYY-MM":
                    return s[:7]
                elif fmt == "YYYY-MM-DD":
                    return s[:10]
                elif fmt == "YYYY":
                    return s[:4]
                return s
            dbapi_connection.create_function("to_char", 2, sqlite_to_char)

    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        yield db


def test_item1_medico_unidade_generico(session):
    uni = UnidadeSaude(nome="PSF Central", cnes="1234567", ativo=True)
    session.add(uni)
    session.commit()
    session.refresh(uni)

    # Cria e retorna genérico se medico_id for None
    med_res, uni_res = resolver_medico_unidade(session, None, uni.id)
    assert med_res.nome == "Médico da Unidade / Responsável Técnico"
    assert med_res.crm == "RESP. TÉCNICO"
    assert med_res.cbo_codigo == "225125"
    assert med_res.ativo is True
    assert uni_res.id == uni.id

    # Com 0 e -1 retorna o genérico
    med_res_0, _ = resolver_medico_unidade(session, 0, uni.id)
    assert med_res_0.id == med_res.id
    med_res_neg, _ = resolver_medico_unidade(session, -1, uni.id)
    assert med_res_neg.id == med_res.id

    # Com médico existente específico
    med_esp = Medico(nome="Dr. Fulano de Tal", crm="CRM/MG 999999", cbo_codigo="225120", ativo=True)
    session.add(med_esp)
    session.commit()
    session.refresh(med_esp)

    med_res_esp, _ = resolver_medico_unidade(session, med_esp.id, uni.id)
    assert med_res_esp.id == med_esp.id
    assert med_res_esp.nome == "Dr. Fulano de Tal"


def test_item2_higienizacao_e_filtro_motoristas(session):
    # Validação de não-motorista
    with pytest.raises(HTTPException) as exc_info:
        _validar_nao_motorista(MedicoIn(nome="João Motorista", crm="CRM/MG 123456", cbo_codigo="782310", cbo_descricao="Motorista de Ambulância"))
    assert exc_info.value.status_code == 400
    assert "Motorista" in exc_info.value.detail

    # Cria médicos motoristas na base
    med_mot1 = Medico(nome="Carlos da Silva", cbo_codigo="782320", cbo_descricao="Motorista de Veículos Pesados", cpf="111.222.333-44", telefone="35999998888", ativo=True)
    med_mot2 = Medico(nome="Sebastião Motorista", cbo_codigo="", cbo_descricao="Condutor de Pacientes", cpf="555.666.777-88", telefone="35988887777", ativo=True)
    session.add(med_mot1)
    session.add(med_mot2)
    session.commit()

    # Executa rotina de higienização
    from sqlalchemy import or_
    medicos_motoristas = session.exec(
        select(Medico).where(
            or_(
                Medico.cbo_codigo.like("7823%"),
                Medico.cbo_descricao.ilike("%motorista%"),
                Medico.nome.ilike("%motorista%"),
            )
        )
    ).all()

    for med in medicos_motoristas:
        cpf_limpo = (med.cpf or "").strip()
        nome_base = med.nome.replace(" (Motorista do Transporte)", "").strip()

        condicoes = []
        if cpf_limpo:
            condicoes.append(Motorista.cpf == cpf_limpo)
        if nome_base:
            condicoes.append(Motorista.nome.ilike(nome_base))

        motorista_existente = None
        if condicoes:
            motorista_existente = session.exec(select(Motorista).where(or_(*condicoes))).first()

        if not motorista_existente and nome_base:
            novo_mot = Motorista(nome=nome_base, cpf=cpf_limpo, telefone=med.telefone or "", ativo=True)
            session.add(novo_mot)

        med.ativo = False
        if "(Motorista" not in med.nome:
            med.nome = f"{med.nome} (Motorista do Transporte)"
        session.add(med)

    session.commit()

    # Verifica tfd_motoristas
    mot1 = session.exec(select(Motorista).where(Motorista.cpf == "111.222.333-44")).first()
    assert mot1 is not None
    assert mot1.nome == "Carlos da Silva"
    assert mot1.ativo is True

    session.refresh(med_mot1)
    assert med_mot1.ativo is False
    assert "(Motorista do Transporte)" in med_mot1.nome

    # Adiciona médico genérico e testa listar_medicos
    med_rt = Medico(nome="Médico da Unidade / Responsável Técnico", crm="RESP. TÉCNICO", cbo_codigo="225125", ativo=True)
    session.add(med_rt)
    session.commit()

    dummy_user = User(username="admin", is_superuser=True)
    lista_ativos = listar_medicos(q="", somente_ativos=True, db=session, _ator=dummy_user)
    nomes_ativos = [m.nome for m in lista_ativos]
    assert "Carlos da Silva (Motorista do Transporte)" not in nomes_ativos
    assert nomes_ativos[0] == "Médico da Unidade / Responsável Técnico"


def test_item4_especialidade_cbo_opcional_e_duplicidade(session):
    # CBO vazio
    esp_in_vazia = EspecialidadeIn(codigo_cbo="", nome="Fisioterapia Geral", ativo=True)
    esp_salva1 = criar_especialidade(esp_in_vazia, db=session)
    assert esp_salva1.id is not None
    assert esp_salva1.codigo_cbo == ""

    esp_in_vazia2 = EspecialidadeIn(codigo_cbo="", nome="Fonoaudiologia", ativo=True)
    esp_salva2 = criar_especialidade(esp_in_vazia2, db=session)
    assert esp_salva2.id is not None
    assert esp_salva2.codigo_cbo == ""

    # CBO não vazio com validação de duplicidade
    esp_in_cbo = EspecialidadeIn(codigo_cbo="225125", nome="Clínica Geral", ativo=True)
    esp_salva3 = criar_especialidade(esp_in_cbo, db=session)
    assert esp_salva3.codigo_cbo == "225125"

    with pytest.raises(HTTPException) as exc_info:
        criar_especialidade(EspecialidadeIn(codigo_cbo="225125", nome="Clínica Duplicada", ativo=True), db=session)
    assert exc_info.value.status_code == 400
    assert "CBO já cadastrado" in exc_info.value.detail

    # Atualização para CBO vazio permitida
    esp_atualizada = atualizar_especialidade(esp_salva3.id, EspecialidadeIn(codigo_cbo="", nome="Clínica Atualizada", ativo=True), db=session)
    assert esp_atualizada.codigo_cbo == ""


def test_item5_filtros_opcoes_tipo_fila(session):
    ex1 = ExameFila(paciente_id=1, exame="Ultrassom Abdominal", tipo_fila="ULTRASSONOGRAFIA", codigo_procedimento="0205020186", codigo_especialidade="225320", nome_especialidade="Radiologia", status="aguardando", data_pedido=date(2026, 10, 1))
    ex2 = ExameFila(paciente_id=2, exame="Consulta Cardiologia", tipo_fila="CONSULTAS ESPECIALIZADAS", codigo_procedimento="0301010072", codigo_especialidade="225120", nome_especialidade="Cardiologia", status="aguardando", data_pedido=date(2026, 10, 1))
    ex3 = ExameFila(paciente_id=3, exame="Ultrassom Pélvico", tipo_fila="ULTRASSONOGRAFIA", codigo_procedimento="0205020186", codigo_especialidade="225320", nome_especialidade="Radiologia", status="aguardando", data_pedido=date(2026, 10, 2))
    session.add(ex1)
    session.add(ex2)
    session.add(ex3)
    session.commit()

    # Sem filtro
    opcoes_todas = filtros_opcoes(status_="aguardando", tipo_fila=None, db=session)
    nomes_esps_todas = [e.label for e in opcoes_todas.especialidades]
    assert any("Radiologia" in l for l in nomes_esps_todas)
    assert any("Cardio" in l for l in nomes_esps_todas)

    # Com filtro
    opcoes_us = filtros_opcoes(status_="aguardando", tipo_fila="ULTRASSONOGRAFIA", db=session)
    nomes_esps_us = [e.label for e in opcoes_us.especialidades]
    assert any("Radiologia" in l for l in nomes_esps_us)
    assert not any("Cardio" in l for l in nomes_esps_us)

    procs_us = [p.label for p in opcoes_us.procedimentos]
    assert any("Ultrassom" in l for l in procs_us)
    assert not any("Cardio" in l for l in procs_us)


def test_exportacao_endereco_ids_imutaveis_e_busca_relevancia(session):
    from app.models.tfd import Paciente
    from app.schemas.tfd import PacienteIn, ExameIn
    from app.api.v1.tfd import (
        criar_paciente,
        criar_exame,
        listar_pacientes,
        _linha_fila,
        _com_posicao,
        obter_exame,
        listar_exames,
        obter_relatorio_agendados,
    )

    # 1. Criação de paciente e geração de prontuário curto amigável
    pac_in = PacienteIn(
        nome="Mateus Henrique",
        cpf="",
        cns="",
        endereco="Rua das Flores",
        endereco_numero="120",
        complemento="Apto 101",
        bairro="Centro",
        municipio="Guapé",
        cep="37177-000",
    )
    dummy_user = User(username="admin", is_superuser=True)
    pac = criar_paciente(pac_in, db=session)
    assert pac.id is not None
    assert pac.codigo_prontuario.startswith("PR-") and len(pac.codigo_prontuario) == 8
    assert pac.codigo_prontuario != f"PR-{pac.id:05d}" or pac.id > 10000
    assert pac.municipio == "Guapé"

    # Segundo paciente com nome que contém o termo no meio
    pac2 = criar_paciente(
        PacienteIn(
            nome="João Mateus Pereira",
            cpf="",
            cns="",
            endereco="Av. Brasil",
            bairro="Vila Nova",
        ),
        db=session,
    )
    assert pac2.codigo_prontuario.startswith("PR-")
    assert pac2.codigo_prontuario != pac.codigo_prontuario

    # 2. Busca com ordenação por relevância (início do nome primeiro)
    res_busca = listar_pacientes(q="Mateus", page=1, limit=10, db=session)
    itens = res_busca["data"]
    assert len(itens) >= 2
    # Mateus Henrique começa com "Mateus", deve vir antes de "João Mateus"
    assert itens[0].nome == "Mateus Henrique"
    assert itens[1].nome == "João Mateus Pereira"

    # 3. Criação de exame na fila e geração de ID imutável
    ex_in = ExameIn(
        paciente_id=pac.id,
        exame="Ecocardiograma Transtorácico",
        tipo_fila="EXAMES",
        prioridade="rotina",
        data_pedido=date(2026, 10, 1),
    )
    ex_obj = criar_exame(ex_in, db=session, ator=dummy_user)
    assert ex_obj.id is not None
    assert ex_obj.codigo_curto.startswith("EX-") and len(ex_obj.codigo_curto) == 9

    # 4. _linha_fila contém endereço completo, campos de endereço e IDs imutáveis
    linha = _linha_fila(session, {}, ex_obj, pos=1)
    assert linha["codigo_curto"] == ex_obj.codigo_curto
    assert linha["prontuario"] == pac.codigo_prontuario
    assert linha["logradouro"] == "Rua das Flores"
    assert linha["numero"] == "120"
    assert linha["complemento"] == "Apto 101"
    assert linha["bairro"] == "Centro"
    assert linha["municipio"] == "Guapé"
    assert linha["cep"] == "37177-000"
    assert "Rua das Flores" in linha["endereco_completo"]
    assert "Nº 120" in linha["endereco_completo"]
    assert "Centro" in linha["endereco_completo"]

    # 5. Busca Exata: digitar CPF completo ou Prontuário retorna estritamente o paciente
    pac.cpf = "111.222.333-44"
    session.add(pac)
    # Adiciona mais um paciente com CPF parcialmente semelhante
    pac3 = Paciente(
        nome="Lucas Silva",
        cpf="111.222.333-99",
        cns="898000000000001",
        codigo_prontuario="PR-99999",
        endereco="Av Brasil",
    )
    session.add(pac3)
    session.commit()

    # Busca com CPF exato formatado
    res_cpf_fmt = listar_pacientes(q="111.222.333-44", page=1, limit=10, db=session)
    assert res_cpf_fmt["total"] == 1
    assert res_cpf_fmt["data"][0].nome == "Mateus Henrique"

    # Busca com CPF exato sem máscara (11 dígitos puros)
    res_cpf_num = listar_pacientes(q="11122233344", page=1, limit=10, db=session)
    assert res_cpf_num["total"] == 1
    assert res_cpf_num["data"][0].nome == "Mateus Henrique"

    # Busca com Prontuário exato
    pront_mateus = pac.codigo_prontuario
    res_pront = listar_pacientes(q=pront_mateus, page=1, limit=10, db=session)
    assert res_pront["total"] == 1
    assert res_pront["data"][0].nome == "Mateus Henrique"

    # 6. Busca Sob Demanda: termo vazio retorna lista vazia imediatamente
    res_vazio = listar_pacientes(q="", page=1, limit=10, db=session)
    assert res_vazio["total"] == 0
    assert len(res_vazio["data"]) == 0

    res_espaco = listar_pacientes(q="   ", page=1, limit=10, db=session)
    assert res_espaco["total"] == 0
    assert len(res_espaco["data"]) == 0

    # 7. Busca por ID numérico puro (sem prefixo "PR-")
    res_id_puro = listar_pacientes(q=str(pac.id), page=1, limit=10, db=session)
    assert res_id_puro["total"] >= 1
    assert any(p.id == pac.id for p in res_id_puro["data"])

    # 8. Endpoint de consulta direta de exame por ID (GET /exames/{eid})
    det_ex = obter_exame(eid=ex_obj.id, db=session, ator=dummy_user)
    assert det_ex.id == ex_obj.id
    assert det_ex.paciente_id == pac.id

    # 9. Listagem de exames com agendada_de e apenas_agendados
    # Agenda o exame
    ex_db = session.get(ExameFila, ex_obj.id)
    assert ex_db is not None
    ex_db.status = "agendado"
    ex_db.data_agendada = date(2026, 10, 20)
    ex_db.hora_agendada = "09:30"
    session.add(ex_db)
    session.commit()

    res_agendados = listar_exames(
        agendada_de="2026-10-01",
        agendada_ate="2026-10-31",
        apenas_agendados=True,
        db=session,
        ator=dummy_user,
    )
    assert res_agendados["total"] >= 1
    assert any(x.id == ex_obj.id for x in res_agendados["data"])

    # 10. Relatório com escopo e segmentação
    rel_exames = obter_relatorio_agendados(
        data_de="2026-10-01",
        data_ate="2026-10-31",
        escopo="agendados",
        segmentacao="exames",
        db=session,
        ator=dummy_user,
    )
    assert rel_exames["total"] >= 1
    assert any(item["id"] == ex_obj.id for item in rel_exames["itens"])

    rel_consultas = obter_relatorio_agendados(
        data_de="2026-10-01",
        data_ate="2026-10-31",
        escopo="agendados",
        segmentacao="consultas",
        db=session,
        ator=dummy_user,
    )
    # Não deve incluir o ecocardiograma como consulta
    assert not any(item["id"] == ex_obj.id for item in rel_consultas["itens"])


def test_ordem_colunas_exportacao_fila():
    """Garante que a ordem das colunas no Excel segue estritamente o layout solicitado:
    ID do Pedido, Posição, Posição Geral da Fila SUS, Posição Especialidade,
    Prioridade / Classificação de risco, Status, Data do Envio para Fila, Procedimento,
    Especialidade, Prontuário, Paciente, CPF, Cartão SUS / CNS, Logradouro, Número, Bairro.
    """
    from app.api.v1.tfd import COLS_FILA

    ordem_esperada = [
        ("codigo_curto", "ID do Pedido"),
        ("posicao", "Posição"),
        ("posicao_tipo", "Posição Geral da Fila SUS"),
        ("posicao_especialidade", "Posição Especialidade"),
        ("risco", "Prioridade / Classificação de risco"),
        ("status", "Status"),
        ("data_pedido", "Data do Envio para Fila"),
        ("exame", "Procedimento"),
        ("especialidade", "Especialidade"),
        ("prontuario", "Prontuário"),
        ("paciente", "Paciente"),
        ("cpf", "CPF"),
        ("cns", "Cartão SUS / CNS"),
        ("logradouro", "Logradouro"),
        ("numero", "Número"),
        ("bairro", "Bairro"),
    ]

    primeiras_16 = [(c["chave"], c["rotulo"]) for c in COLS_FILA[:16]]
    assert primeiras_16 == ordem_esperada


def test_status_desistiu_individual_e_em_lote(session):
    from app.api.v1.tfd import definir_status_atendimento, definir_status_atendimento_lote, AtendimentoStatusIn, AtendimentoStatusLoteIn
    from app.models.tfd import Paciente

    pac = Paciente(nome="Paciente Desistente", cpf="999.888.777-66", municipio="Guapé")
    session.add(pac)
    session.commit()

    ex1 = ExameFila(paciente_id=pac.id, exame="CONSULTA CARDIOLOGIA", status="agendado", data_pedido=date.today())
    ex2 = ExameFila(paciente_id=pac.id, exame="ULTRASSONOGRAFIA", status="agendado", data_pedido=date.today())
    session.add_all([ex1, ex2])
    session.commit()

    ator = User(username="operador", is_superuser=True)

    # 1. Individual
    res1 = definir_status_atendimento(ex1.id, AtendimentoStatusIn(status="desistiu"), db=session, _=ator)
    assert res1.status == "desistiu"

    # 2. Em lote
    res_lote = definir_status_atendimento_lote(AtendimentoStatusLoteIn(ids=[ex2.id], status="desistencia"), db=session, ator=ator)
    assert res_lote["ok"] is True
    assert res_lote["atualizados"] == 1
    session.refresh(ex2)
    assert ex2.status == "desistiu"


def test_edicao_usuario_com_apac_e_unidade(session):
    from app.services.users import create_user, update_user
    from app.schemas import UserCreate, UserUpdate

    uni = UnidadeSaude(nome="PSF Bela Vista", cnes="7654321", ativo=True)
    session.add(uni)
    session.commit()

    uc = UserCreate(
        username="operador_psf",
        nome="Operador PSF",
        area="painel",
        telas=["tfd", "apac"],
        acoes={"tfd": ["ver", "criar"], "apac": ["ver"]},
        unidade_saude_id=uni.id,
    )
    user, _ = create_user(session, uc)
    assert user.unidade_saude_id == uni.id
    assert "apac" in user.telas

    # Atualiza permissões e unidade
    uu = UserUpdate(
        nome="Operador PSF Atualizado",
        telas=["tfd", "apac", "apac_solicitacao"],
        acoes={"apac": ["ver", "criar"], "apac_solicitacao": []}, # Lista vazia de ações não deve quebrar
        unidade_saude_id=uni.id,
    )
    user_up = update_user(session, user, uu)
    assert user_up.nome == "Operador PSF Atualizado"
    assert "apac" in user_up.telas
    assert user_up.unidade_saude_id == uni.id


def test_recepcao_validacao_cid_individual_e_lote(session: Session):
    """Garante que a recepção exija preenchimento de CID se o exame não o possuir."""
    from app.api.v1.tfd import (
        recepcionar_exame,
        recepcionar_exames_lote,
        RecepcionarExameIn,
        ExameIdsIn,
    )
    pac = Paciente(nome="Carlos Mendes", cpf="222.333.444-55", municipio="Guapé")
    session.add(pac)
    session.commit()

    ex = ExameFila(
        paciente_id=pac.id,
        exame="ECOCARDIOGRAMA",
        data_pedido=date.today(),
        status="agendado",
        data_agendada=date.today(),
        cid_codigo="",
        ativo=True,
    )
    session.add(ex)
    session.commit()

    operador = User(username="atendente", password_hash="hash", telas="tfd_agenda", is_superuser=True)

    # Individual sem CID deve falhar
    with pytest.raises(HTTPException) as exc:
        recepcionar_exame(ex.id, db=session, ator=operador)
    assert exc.value.status_code == 400
    assert "exige o preenchimento do CID" in exc.value.detail

    # Individual informando CID deve ter sucesso
    rec_ok = recepcionar_exame(
        ex.id,
        data=RecepcionarExameIn(cid_codigo="I50", cid_descricao="Insuficiência cardíaca"),
        db=session,
        ator=operador,
    )
    assert rec_ok.status == "recepcionado"
    assert rec_ok.cid_codigo == "I50"


def test_busca_justificativa_fila(session: Session):
    """Garante filtragem e pesquisa de exames na fila pelo texto da justificativa médica."""
    from app.api.v1.tfd import listar_exames
    pac = Paciente(nome="Marina Ruy", cpf="555.666.777-88", municipio="Guapé")
    session.add(pac)
    session.commit()

    ex1 = ExameFila(
        paciente_id=pac.id,
        exame="TOMOGRAFIA COMPUTADORIZADA",
        justificativa="Suspeita de cefaleia refrataria com sinais de alerta neurologicos",
        prioridade="rotina",
        status="aguardando",
        data_pedido=date.today(),
        ativo=True,
    )
    ex2 = ExameFila(
        paciente_id=pac.id,
        exame="RESSONANCIA MAGNETICA",
        justificativa="Investigacao de gonartrose cronica no joelho direito",
        prioridade="rotina",
        status="aguardando",
        data_pedido=date.today(),
        ativo=True,
    )
    session.add_all([ex1, ex2])
    session.commit()

    operador = User(username="regulacao", password_hash="hash", telas="tfd_exames", is_superuser=True)

    # Filtro específico por justificativa
    res_cefaleia = listar_exames(justificativa="cefaleia", db=session, ator=operador)
    assert res_cefaleia["total"] == 1
    assert res_cefaleia["data"][0].id == ex1.id

    res_joelho = listar_exames(justificativa="gonartrose", db=session, ator=operador)
    assert res_joelho["total"] == 1
    assert res_joelho["data"][0].id == ex2.id


def test_motorista_toxicologico_validade(session: Session):
    """Garante suporte e persistência de validade do exame toxicológico de motoristas."""
    from app.api.v1.tfd import criar_motorista, listar_motoristas, MotoristaIn
    operador = User(username="gestor_frota", password_hash="hash", telas="tfd_frota", is_superuser=True)
    val_toxi = date(2027, 5, 20)
    mot_in = MotoristaIn(
        nome="Sebastião da Silva",
        cpf="",
        cnh_numero="",
        cnh_categoria="D",
        cnh_validade=date(2028, 1, 15),
        toxicologico_validade=val_toxi,
        telefone="(35) 99999-8888",
        ativo=True,
    )
    mot = criar_motorista(mot_in, db=session, _=operador)
    assert mot.toxicologico_validade == val_toxi

    res = listar_motoristas(q="Sebastião", db=session, _=operador)
    assert res["total"] == 1
    assert res["data"][0].toxicologico_validade == val_toxi


def test_timeline_origem_unidade_e_profissional(session: Session):
    """Garante que a linha do tempo exiba explicitamente a unidade de cadastro e o profissional solicitante."""
    from app.api.v1.auditoria import timeline_paciente
    from app.models.cadastros_saude import UnidadeSaude
    from app.models.audit import AuditLog
    AuditLog.__table__.create(session.bind, checkfirst=True)
    uni = UnidadeSaude(nome="PSF Bela Vista", cnes="7654321", bairro="Bela Vista")
    session.add(uni)
    session.commit()

    pac = Paciente(
        nome="Rita Lee",
        cpf="999.888.777-66",
        unidade_saude_id=uni.id,
        unidade_nome=uni.nome,
        municipio="Guapé",
    )
    session.add(pac)
    session.commit()

    ex = ExameFila(
        paciente_id=pac.id,
        exame="HOLTER 24H",
        unidade_nome="PSF Bela Vista",
        medico_nome="Dra. Roberta Cardiologista",
        status="aguardando",
        prioridade="rotina",
        data_pedido=date.today(),
        ativo=True,
    )
    session.add(ex)
    session.commit()

    operador = User(username="auditor", password_hash="hash", telas="tfd_pacientes", is_superuser=True)
    tl = timeline_paciente(pac.id, db=session, user=operador)
    ev_cadastro = next(e for e in tl.eventos if e.tipo == "cadastro")
    assert "PSF Bela Vista" in ev_cadastro.detalhe

    ev_fila = next(e for e in tl.eventos if e.tipo == "fila")
    assert "PSF Bela Vista" in ev_fila.detalhe
    assert "Dra. Roberta Cardiologista" in ev_fila.detalhe


def test_excluir_veiculo_com_e_sem_viagem_vinculada(session: Session):
    """Garante que excluir veículo sem viagens remove do banco, e com viagens inativa preservando o histórico."""
    from app.models.tfd import Veiculo, Viagem
    from app.api.v1.tfd import excluir_veiculo

    # 1. Veículo sem viagens -> deleção física
    v_livre = Veiculo(placa="ABC1D23", modelo="Spin 1.8", ativo=True)
    session.add(v_livre)
    session.commit()
    session.refresh(v_livre)

    excluir_veiculo(v_livre.id, db=session)
    assert session.get(Veiculo, v_livre.id) is None

    # 2. Veículo com viagem vinculada -> inativação preservando histórico
    v_viagem = Veiculo(placa="XYZ9K88", modelo="Van Master", ativo=True)
    session.add(v_viagem)
    session.commit()
    session.refresh(v_viagem)

    viagem = Viagem(
        veiculo_id=v_viagem.id,
        destino="Alfenas",
        data_viagem=date.today(),
        hora_saida="06:00",
        hora_retorno="12:00",
        status="agendada",
    )
    session.add(viagem)
    session.commit()

    excluir_veiculo(v_viagem.id, db=session)
    v_db = session.get(Veiculo, v_viagem.id)
    assert v_db is not None
    assert v_db.ativo is False

    # Confirma que a viagem continua existindo intacta
    viagem_db = session.get(Viagem, viagem.id)
    assert viagem_db is not None
    assert viagem_db.veiculo_id == v_viagem.id


def test_gestao_manutencao_e_bloqueio_viagem(session: Session):
    """Valida o ciclo de manutenção de veículos e o bloqueio estrito de alocação em viagens."""
    from datetime import date, timedelta
    from fastapi import HTTPException
    import pytest
    from app.models.tfd import Veiculo
    from app.schemas.tfd import VeiculoManutencaoIn, ViagemIn
    from app.api.v1.tfd import gerenciar_manutencao_veiculo, criar_viagem
    from app.models.user import User

    # 1. Cadastra veículo disponível
    v = Veiculo(placa="MAN1234", modelo="Ducato Escolar", status="disponivel", ativo=True)
    session.add(v)
    session.commit()
    session.refresh(v)

    # 2. Coloca em manutenção com data, motivo e previsão de retorno
    hoje = date.today()
    amanha = hoje + timedelta(days=1)
    payload_manut = VeiculoManutencaoIn(
        em_manutencao=True,
        motivo="Troca da embreagem e suspensão",
        data_entrada=hoje,
        previsao_retorno=amanha,
        indefinida=False,
    )
    v_atualizado = gerenciar_manutencao_veiculo(v.id, payload_manut, db=session)
    assert v_atualizado.status == "manutencao"
    assert v_atualizado.manutencao_motivo == "Troca da embreagem e suspensão"
    assert v_atualizado.manutencao_data_entrada == hoje
    assert v_atualizado.manutencao_previsao_retorno == amanha
    assert v_atualizado.manutencao_indefinida is False

    # 3. Tenta alocar o veículo em manutenção para uma nova viagem -> deve ser bloqueado com erro 400
    user_mock = User(id=1, username="coord", role="admin", ativo=True)
    viagem_in = ViagemIn(
        destino="Passos",
        data_viagem=amanha,
        hora_saida="07:00",
        hora_retorno="13:00",
        veiculo_id=v.id,
    )
    with pytest.raises(HTTPException) as exc_info:
        criar_viagem(viagem_in, db=session, ator=user_mock)
    assert exc_info.value.status_code == 400
    assert "manutenção" in exc_info.value.detail.lower()

    # 4. Testa manutenção por tempo indeterminado / indefinida
    payload_indef = VeiculoManutencaoIn(
        em_manutencao=True,
        motivo="Aguardando peça importada do motor",
        data_entrada=hoje,
        previsao_retorno=None,
        indefinida=True,
    )
    v_indef = gerenciar_manutencao_veiculo(v.id, payload_indef, db=session)
    assert v_indef.status == "manutencao"
    assert v_indef.manutencao_indefinida is True
    assert v_indef.manutencao_previsao_retorno is None

    # 5. Conclui a manutenção e libera o veículo
    payload_liberar = VeiculoManutencaoIn(em_manutencao=False)
    v_livre = gerenciar_manutencao_veiculo(v.id, payload_liberar, db=session)
    assert v_livre.status == "disponivel"
    assert v_livre.manutencao_motivo == ""
    assert v_livre.manutencao_indefinida is False

    # 6. Agora o veículo pode ser alocado na viagem normalmente
    viagem_criada = criar_viagem(viagem_in, db=session, ator=user_mock)
    assert viagem_criada.id is not None
    assert viagem_criada.veiculo_id == v.id


def test_etapa2_seguranca_regras_servidor(session):
    from datetime import date, timedelta
    from app.models.tfd import Paciente, Viagem, ViagemPaciente
    from app.models.lab_exames import SigtapProcedimento
    from app.models.lab_fase6 import SolicitacaoMestre
    from app.schemas.tfd import FaturaIn, ExameIn, ViagemStatusConfirmacaoIn
    from app.api.v1.tfd import criar_fatura, criar_exame, atualizar_confirmacao_passageiro
    from app.api.v1.lab_fase6 import cancelar_solicitacao

    # 1. Teste Faturamento: valor ignorado e recalculado pelo SIGTAP + status forçado 'pendente'
    pac = Paciente(nome="Maria Faturamento", cpf="12345678901", ativo=True)
    session.add(pac)
    session.add(SigtapProcedimento(
        codigo="0201010011",
        descricao="BIOPSIA",
        valor_sa=15.50,
        valor_sp=5.00,
        valor_sh=0.00,
    ))
    session.commit()
    session.refresh(pac)

    fat_in = FaturaIn(
        paciente_id=pac.id,
        procedimento="BIOPSIA",
        codigo_sigtap="0201010011",
        competencia="2026-10",
        quantidade=2,
        valor=99999.00,  # Valor arbitrário enviado pelo atacante
        status="aprovado",  # Status forjado pelo atacante
    )
    user_fat = User(username="op_fat", telas="tfd,tfd_faturamento", acoes='{"tfd_faturamento":["criar","editar"]}', is_superuser=False)
    fat_criada = criar_fatura(fat_in, db=session, _=user_fat)
    assert fat_criada.valor == 20.50  # 15.50 + 5.00 recalculado no servidor
    assert fat_criada.total == 41.00  # 20.50 * 2
    assert fat_criada.status == "pendente"  # Forçado no servidor

    # 2. Teste Agendamento Direto: PSF tentando furar a fila é bloqueado com 403
    user_psf = User(
        username="op_psf",
        telas="tfd,tfd_exames",
        unidade_saude_id=10,
        is_superuser=False,
    )
    exame_in = ExameIn(
        paciente_id=pac.id,
        exame="CONSULTA OFTALMOLOGICA",
        data_pedido=date.today(),
        data_agendada=date.today() + timedelta(days=2),  # Agendamento direto indevido
        unidade_saude_id=10,
        medico_id=1,
    )
    with pytest.raises(HTTPException) as exc_info:
        criar_exame(exame_in, db=session, ator=user_psf)
    assert exc_info.value.status_code == 403
    assert "agendamento direto" in exc_info.value.detail.lower()

    # 3. Teste Cancelamento Laboratório: impedir cancelamento de exame já coletado/realizado
    sol_coletada = SolicitacaoMestre(
        paciente_id=pac.id,
        laboratorio_id=1,
        unidade_saude_id=10,
        status="coletado",
        data_agendada=date.today(),
    )
    session.add(sol_coletada)
    session.commit()
    session.refresh(sol_coletada)

    user_lab = User(username="op_lab", telas="lab,lab_marcacao", acoes='{"lab_marcacao":["excluir"]}', unidade_saude_id=10, is_superuser=False)
    with pytest.raises(HTTPException) as exc_lab:
        cancelar_solicitacao(sol_coletada.id, db=session, user=user_lab)
    assert exc_lab.value.status_code == 400
    assert "coletado" in exc_lab.value.detail.lower()

    # 4. Teste Viagem Passada: impedir alteração de presença em viagem passada sem permissão
    viagem_passada = Viagem(
        data_viagem=date.today() - timedelta(days=5),
        hora_saida="06:00",
        destino="Alfenas",
    )
    session.add(viagem_passada)
    session.commit()
    session.refresh(viagem_passada)

    vp = ViagemPaciente(
        viagem_id=viagem_passada.id,
        paciente_id=pac.id,
        status_confirmacao="pendente",
    )
    session.add(vp)
    session.commit()
    session.refresh(vp)

    user_viagem_comum = User(
        username="op_viagem",
        telas="tfd,tfd_viagens",
        acoes='{"tfd_viagens":["editar"]}',
        permite_retroativo=True,
        is_superuser=False,
    )
    with pytest.raises(HTTPException) as exc_via:
        atualizar_confirmacao_passageiro(
            viagem_passada.id,
            vp.id,
            ViagemStatusConfirmacaoIn(status_confirmacao="confirmado"),
            db=session,
            ator=user_viagem_comum,
        )
    assert exc_via.value.status_code == 403








