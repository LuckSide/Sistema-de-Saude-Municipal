from datetime import date, datetime, timedelta
import pytest
from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.v1.apac import (
    atualizar_solicitacao,
    autorizar_solicitacao_regulacao,
    cancelar_solicitacao,
    criar_faixa,
    criar_solicitacao,
    devolver_solicitacao_regulacao,
    duplicar_continuidade,
    indeferir_solicitacao_regulacao,
    iniciar_analise_regulacao,
)
from app.models.apac import (
    FaixaNumeracaoAPAC,
    LoteFaturamentoAPAC,
    ProcedimentoSecundarioAPAC,
    SolicitacaoAPAC,
)
from app.models.cadastros_saude import Medico, UnidadeSaude
from app.models.lab_exames import SigtapCid, SigtapProcedimento
from app.models.tfd import Paciente
from app.models.user import User
from app.schemas.apac import (
    AutorizacaoIn,
    DevolucaoIn,
    DuplicarContinuidadeIn,
    FaixaNumeracaoCreate,
    GerarRemessaIn,
    IndeferimentoIn,
    ProcedimentoSecundarioIn,
    SolicitacaoAPACCreate,
)
from app.services.apac_service import (
    alocar_proximo_numero_apac,
    autorizar_apac,
    calcular_flags_vencimento,
    calcular_prazo_validade_dias,
    duplicar_para_continuidade,
    gerar_arquivo_apac_mag,
    seed_apac,
)


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        seed_apac(db)
        yield db


@pytest.fixture
def mock_user_solicitante():
    return User(
        id=1,
        username="medico_psf",
        nome="Dr. Solicitante PSF",
        is_active=True,
        is_superuser=False,
        telas="tfd,apac_solicitacao",
    )


@pytest.fixture
def mock_user_regulador():
    return User(
        id=2,
        username="regulador_apac",
        nome="Dr. Regulador Municipal",
        is_active=True,
        is_superuser=False,
        telas="tfd,apac_regulacao,apac_faturamento",
    )


def test_1_criacao_solicitacao_com_secundarios(session, mock_user_solicitante):
    """Criação de solicitação com procedimento principal e secundário, validação de SIGTAP e justificativa."""
    # 1. Cria dados base
    paciente = Paciente(
        nome="Maria de Fatima",
        cpf="123.456.789-00",
        cns="700000000000001",
        nascimento=date(1965, 5, 20),
        telefone="35999990000",
        endereco="Rua das Flores, 100",
        bairro="Centro",
    )
    med_sol = Medico(
        nome="Dr. Carlos Solicitante",
        crm="CRM/MG 111111",
        cbo_codigo="225125",
        cpf="111.111.111-11",
        ativo=True,
    )
    unidade = UnidadeSaude(
        nome="PSF Central Guapé",
        cnes="2121001",
        ativo=True,
    )
    session.add(paciente)
    session.add(med_sol)
    session.add(unidade)
    session.commit()
    session.refresh(paciente)
    session.refresh(med_sol)
    session.refresh(unidade)

    # 2. Procedimento SIGTAP e CID
    proc_prin = session.exec(
        select(SigtapProcedimento).where(SigtapProcedimento.codigo == "0305010107")
    ).first()
    assert proc_prin is not None

    # 3. Payload válido de criação
    payload = SolicitacaoAPACCreate(
        paciente_id=paciente.id,
        carater_atendimento="01",
        estabelecimento_solicitante_id=unidade.id,
        medico_solicitante_id=med_sol.id,
        procedimento_principal_codigo="0305010107",
        quantidade_mes_1=13,
        quantidade_mes_2=13,
        quantidade_mes_3=13,
        cid_principal_codigo="N180",
        justificativa_solicitacao="Paciente com insuficiência renal crônica estágio 5 necessitando de hemodiálise urgente.",
        procedimentos_secundarios=[
            ProcedimentoSecundarioIn(
                codigo="0205020151",
                descricao="ECOCARDIOGRAFIA TRANSTORACICA",
                quantidade_mes_1=1,
                quantidade_mes_2=0,
                quantidade_mes_3=0,
                valor_unitario=50.0,
            )
        ],
    )

    out = criar_solicitacao(payload=payload, db=session, user=mock_user_solicitante)
    assert out.id is not None
    assert out.status == "SOLICITADO"
    assert out.tipo_apac == "inicial"
    assert out.quantidade_total == 39  # 13 + 13 + 13
    assert out.valor_total > 0
    assert len(out.procedimentos_secundarios) == 1
    assert out.procedimentos_secundarios[0].codigo == "0205020151"
    assert out.procedimentos_secundarios[0].quantidade_total == 1
    assert "CRIACAO" in out.historico_tramitacao

    # 4. Validação de justificativa curta (< 12 caracteres)
    with pytest.raises(Exception):
        SolicitacaoAPACCreate(
            paciente_id=paciente.id,
            medico_solicitante_id=med_sol.id,
            procedimento_principal_codigo="0305010107",
            cid_principal_codigo="N180",
            justificativa_solicitacao="Curta",
        )

    # 5. Validação de código SIGTAP inválido (não 10 dígitos)
    with pytest.raises(Exception):
        SolicitacaoAPACCreate(
            paciente_id=paciente.id,
            medico_solicitante_id=med_sol.id,
            procedimento_principal_codigo="12345",  # inválido
            cid_principal_codigo="N180",
            justificativa_solicitacao="Justificativa válida com mais de 12 caracteres.",
        )


def test_2_incompatibilidade_vinculo_medico(session, mock_user_regulador):
    """Rejeita autorização se o médico solicitante for o mesmo autorizador."""
    # Cria médico e paciente
    med = Medico(nome="Dr. Unico Solicitante e Regulador", crm="CRM/MG 222222", cbo_codigo="225125", ativo=True)
    pac = Paciente(nome="Jose da Silva", cpf="222.333.444-55")
    session.add(med)
    session.add(pac)
    session.commit()
    session.refresh(med)
    session.refresh(pac)

    sol = SolicitacaoAPAC(
        status="SOLICITADO",
        paciente_id=pac.id,
        paciente_nome=pac.nome,
        medico_solicitante_id=med.id,
        medico_solicitante_nome=med.nome,
        procedimento_principal_codigo="0305010107",
        procedimento_principal_nome="HEMODIALISE",
        cid_principal_codigo="N180",
        justificativa_solicitacao="Tratamento hemodialítico contínuo para paciente renal crônico.",
        data_solicitacao=date.today(),
    )
    session.add(sol)
    session.commit()
    session.refresh(sol)

    # Tenta autorizar com o mesmo médico solicitante
    payload_aut = AutorizacaoIn(
        medico_autorizador_id=med.id,
        parecer="Parecer emitido pelo próprio solicitante.",
    )

    with pytest.raises(HTTPException) as exc_info:
        autorizar_solicitacao_regulacao(
            id=sol.id,
            payload=payload_aut,
            db=session,
            user=mock_user_regulador,
        )

    assert exc_info.value.status_code == 400
    assert "Incompatibilidade" in exc_info.value.detail
    assert "não pode ser o mesmo" in exc_info.value.detail


def test_3_autorizacao_valida_e_alocacao_faixa(session, mock_user_regulador):
    """Autorização com médico regulador válido e geração do número sequencial da APAC a partir da faixa."""
    # Cria médicos diferentes
    med_sol = Medico(nome="Dr. Solicitante Clínico", crm="CRM/MG 333333", ativo=True)
    med_reg = Medico(nome="Dra. Reguladora Oficial", crm="CRM/MG 444444", cbo_codigo="225125", ativo=True)
    pac = Paciente(nome="Sebastiao do Prado", cpf="333.444.555-66")
    session.add(med_sol)
    session.add(med_reg)
    session.add(pac)
    session.commit()
    session.refresh(med_sol)
    session.refresh(med_reg)
    session.refresh(pac)

    # Confere faixa seed
    faixa = session.exec(select(FaixaNumeracaoAPAC).where(FaixaNumeracaoAPAC.ano == 2026)).first()
    assert faixa is not None
    prox_esperado = str(faixa.proximo_numero)

    sol = SolicitacaoAPAC(
        status="SOLICITADO",
        paciente_id=pac.id,
        paciente_nome=pac.nome,
        medico_solicitante_id=med_sol.id,
        medico_solicitante_nome=med_sol.nome,
        procedimento_principal_codigo="0305010107",  # Hemodiálise contínua (180 dias)
        procedimento_principal_nome="HEMODIALISE (MAXIMO 3 SESSOES POR SEMANA)",
        cid_principal_codigo="N180",
        justificativa_solicitacao="Insuficiência renal crônica dependente de diálise semanal contínua.",
        data_solicitacao=date.today(),
    )
    session.add(sol)
    session.commit()
    session.refresh(sol)

    # Inicia análise
    sol_analise = iniciar_analise_regulacao(id=sol.id, db=session, user=mock_user_regulador)
    assert sol_analise.status == "EM_ANALISE"

    # Autoriza
    payload_aut = AutorizacaoIn(
        medico_autorizador_id=med_reg.id,
        parecer="Laudos e exames anexos condizentes com indicação de TRS. Autorizado.",
    )
    out_aut = autorizar_solicitacao_regulacao(
        id=sol.id,
        payload=payload_aut,
        db=session,
        user=mock_user_regulador,
    )

    assert out_aut.status == "AUTORIZADO"
    assert out_aut.numero_apac == prox_esperado
    assert out_aut.medico_autorizador_nome == med_reg.nome
    assert out_aut.data_autorizacao == date.today()
    assert out_aut.data_inicio_validade == date.today()
    # Hemodiálise deve ter validade de 180 dias
    assert out_aut.data_fim_validade == date.today() + timedelta(days=180)
    assert out_aut.dias_restantes > 170
    assert out_aut.esta_vencida is False
    assert out_aut.proxima_do_vencimento is False

    # Confere que a faixa avançou o próximo número
    session.refresh(faixa)
    assert faixa.proximo_numero == int(prox_esperado) + 1


def test_4_duplicacao_para_continuidade(session, mock_user_solicitante):
    """Duplicação de APAC autorizada para pedido de continuidade clínica."""
    med_sol = Medico(nome="Dr. Nefrologista", crm="CRM/MG 555555", ativo=True)
    med_reg = Medico(nome="Dr. Regulador", crm="CRM/MG 666666", ativo=True)
    pac = Paciente(nome="Ana Paula Vieira", cpf="444.555.666-77")
    session.add(med_sol)
    session.add(med_reg)
    session.add(pac)
    session.commit()

    sol_orig = SolicitacaoAPAC(
        numero_apac="3126100000005",
        tipo_apac="inicial",
        status="AUTORIZADO",
        paciente_id=pac.id,
        paciente_nome=pac.nome,
        medico_solicitante_id=med_sol.id,
        medico_solicitante_nome=med_sol.nome,
        medico_autorizador_id=med_reg.id,
        medico_autorizador_nome=med_reg.nome,
        procedimento_principal_codigo="0305010107",
        procedimento_principal_nome="HEMODIALISE",
        quantidade_mes_1=12,
        quantidade_total=12,
        cid_principal_codigo="N180",
        justificativa_solicitacao="Tratamento inicial de hemodiálise com boa tolerância.",
        data_solicitacao=date.today() - timedelta(days=90),
        data_autorizacao=date.today() - timedelta(days=90),
        data_fim_validade=date.today() + timedelta(days=90),
    )
    session.add(sol_orig)
    session.commit()
    session.refresh(sol_orig)

    # Adiciona secundário na original
    sec = ProcedimentoSecundarioAPAC(
        solicitacao_apac_id=sol_orig.id,
        codigo="0205020151",
        descricao="ECOCARDIOGRAFIA",
        quantidade_mes_1=1,
        quantidade_total=1,
    )
    session.add(sec)
    session.commit()

    # Duplica para continuidade
    payload_cont = DuplicarContinuidadeIn(
        justificativa_solicitacao="Manutenção do tratamento dialítico trissemanal devido à permanência do quadro uremico crônico.",
    )
    nova_cont = duplicar_continuidade(
        id=sol_orig.id,
        payload=payload_cont,
        db=session,
        user=mock_user_solicitante,
    )

    assert nova_cont.id != sol_orig.id
    assert nova_cont.tipo_apac == "continuidade"
    assert nova_cont.apac_anterior_id == sol_orig.id
    assert nova_cont.numero_apac_anterior == "3126100000005"
    assert nova_cont.status == "SOLICITADO"
    assert nova_cont.numero_apac == ""  # Novo número será dado apenas na autorização
    assert nova_cont.medico_autorizador_id is None
    assert nova_cont.medico_autorizador_nome == ""
    assert nova_cont.justificativa_solicitacao == payload_cont.justificativa_solicitacao
    # Procedimento secundário clonado
    assert len(nova_cont.procedimentos_secundarios) == 1
    assert nova_cont.procedimentos_secundarios[0].codigo == "0205020151"


def test_5_geracao_arquivo_apac_mag_e_faturamento(session):
    """Gera remessa no padrão posicional APAC-Mag e registra lote de faturamento."""
    pac = Paciente(nome="Benedito Aparecido", cpf="555.666.777-88", cns="700000000000099")
    med_sol = Medico(nome="Dr. Oncologista", crm="CRM/MG 777777", ativo=True)
    med_aut = Medico(nome="Dr. Regulador APAC", crm="CRM/MG 888888", ativo=True)
    session.add(pac)
    session.add(med_sol)
    session.add(med_aut)
    session.commit()

    comp_atual = date.today().strftime("%Y-%m")
    sol_aut = SolicitacaoAPAC(
        numero_apac="3126100000010",
        tipo_apac="inicial",
        status="AUTORIZADO",
        paciente_id=pac.id,
        paciente_nome=pac.nome,
        paciente_cpf="55566677788",
        paciente_cns="700000000000099",
        paciente_sexo="M",
        paciente_nascimento=date(1958, 8, 14),
        estabelecimento_solicitante_cnes="2121001",
        estabelecimento_executante_cnes="2121345",
        medico_solicitante_id=med_sol.id,
        medico_solicitante_nome=med_sol.nome,
        medico_autorizador_id=med_aut.id,
        medico_autorizador_nome=med_aut.nome,
        procedimento_principal_codigo="0304020220",  # Quimioterapia
        procedimento_principal_nome="QUIMIOTERAPIA PALIATIVA - ADULTO",
        quantidade_mes_1=1,
        quantidade_mes_2=1,
        quantidade_mes_3=1,
        quantidade_total=3,
        valor_unitario=1420.0,
        valor_total=4260.0,
        cid_principal_codigo="C509",
        cid_secundario_codigo="",
        justificativa_solicitacao="Tratamento oncológico quimioterápico com indicação comprovada por biópsia.",
        data_solicitacao=date.today(),
        data_autorizacao=date.today(),
        data_inicio_validade=date.today(),
        data_fim_validade=date.today() + timedelta(days=180),
        competencia=comp_atual,
    )
    session.add(sol_aut)
    session.commit()
    session.refresh(sol_aut)

    # Secundário
    sec = ProcedimentoSecundarioAPAC(
        solicitacao_apac_id=sol_aut.id,
        codigo="0206010079",
        descricao="TOMOGRAFIA DE TORAX",
        quantidade_mes_1=1,
        quantidade_total=1,
        valor_unitario=136.4,
        valor_total=136.4,
    )
    session.add(sec)
    session.commit()

    # Gera remessa
    lote = gerar_arquivo_apac_mag(
        db=session,
        competencia=comp_atual,
        cnes_executante="2121345",
        usuario_ator="TestRunner",
    )

    assert lote.id is not None
    assert lote.status == "FECHADO"
    assert lote.competencia == comp_atual
    assert lote.total_apacs == 1
    assert lote.total_procedimentos == 4  # 3 principais + 1 secundario
    assert lote.valor_total == 4260.0 + 136.4
    assert lote.arquivo_nome.startswith("APAC_2121345_")

    # Valida estrutura do arquivo magnético
    conteudo = lote.conteudo_arquivo
    linhas = [line for line in conteudo.split("\r\n") if line]
    assert len(linhas) == 3  # Header (01) + APAC Principal (02) + Secundario (03)

    # Linha 01: Header
    linha_01 = linhas[0]
    assert linha_01.startswith("01APACMG")
    assert comp_atual.replace("-", "") in linha_01
    assert "2121345" in linha_01
    assert len(linha_01) == 180

    # Linha 02: Registro Principal da APAC
    linha_02 = linhas[1]
    assert linha_02.startswith("023126100000010")
    assert "0304020220" in linha_02
    assert "C509" in linha_02
    assert len(linha_02) == 180

    # Linha 03: Procedimento Secundário
    linha_03 = linhas[2]
    assert linha_03.startswith("033126100000010")
    assert "0206010079" in linha_03
    assert len(linha_03) == 180


def test_6_tramitacao_devolver_e_indeferir(session, mock_user_regulador):
    """Testa devolução com pendência e indeferimento de APAC."""
    med = Medico(nome="Dr. Medico Geral", crm="CRM/MG 999111", ativo=True)
    pac = Paciente(nome="Luzia Rodrigues", cpf="666.777.888-99")
    session.add(med)
    session.add(pac)
    session.commit()

    sol = SolicitacaoAPAC(
        status="SOLICITADO",
        paciente_id=pac.id,
        paciente_nome=pac.nome,
        medico_solicitante_id=med.id,
        medico_solicitante_nome=med.nome,
        procedimento_principal_codigo="0207010064",
        procedimento_principal_nome="RESSONANCIA LOMBAR",
        cid_principal_codigo="M511",
        justificativa_solicitacao="Lombociatalgia crônica refratária ao tratamento clínico por mais de 6 meses.",
        data_solicitacao=date.today(),
    )
    session.add(sol)
    session.commit()
    session.refresh(sol)

    # Devolve com pendência
    out_dev = devolver_solicitacao_regulacao(
        id=sol.id,
        payload=DevolucaoIn(motivo="Falta anexar laudo da radiografia simples prévia e termo assinado."),
        db=session,
        user=mock_user_regulador,
    )
    assert out_dev.status == "PENDENTE"
    assert "Falta anexar laudo" in out_dev.motivo_devolucao
    assert "DEVOLUCAO" in out_dev.historico_tramitacao

    # Indefere
    out_ind = indeferir_solicitacao_regulacao(
        id=sol.id,
        payload=IndeferimentoIn(motivo="Procedimento não indicado segundo protocolo clínico do Ministério da Saúde."),
        db=session,
        user=mock_user_regulador,
    )
    assert out_ind.status == "INDEFERIDO"
    assert "não indicado" in out_ind.motivo_indeferimento
    assert "INDEFERIMENTO" in out_ind.historico_tramitacao


def test_7_faixas_crud(session, mock_user_regulador):
    """Cadastro e listagem de faixas de numeração."""
    from app.api.v1.apac import listar_faixas, atualizar_faixa
    from app.schemas.apac import FaixaNumeracaoUpdate

    nova_faixa = criar_faixa(
        payload=FaixaNumeracaoCreate(
            ano=2027,
            uf="MG",
            serie="MG02",
            numero_inicial=3127100000001,
            numero_final=3127100005000,
            tipo_procedimento="TODOS",
            descricao="Faixa 2027",
        ),
        db=session,
        user=mock_user_regulador,
    )
    assert nova_faixa.id is not None
    assert nova_faixa.total_disponivel == 5000

    faixas = listar_faixas(db=session, user=mock_user_regulador)
    assert any(f.ano == 2027 for f in faixas)

    # Atualiza faixa
    faixa_up = atualizar_faixa(
        id=nova_faixa.id,
        payload=FaixaNumeracaoUpdate(descricao="Faixa 2027 Atualizada"),
        db=session,
        user=mock_user_regulador,
    )
    assert faixa_up.descricao == "Faixa 2027 Atualizada"


def test_8_alertas_vencimento():
    """Valida cálculo de flags de dias restantes, vencimento e alerta próximo."""
    hoje = date.today()

    # Vencida no passado
    dias, vencida, proxima = calcular_flags_vencimento(hoje - timedelta(days=5))
    assert dias == -5
    assert vencida is True
    assert proxima is False

    # Próxima do vencimento (15 dias restantes)
    dias, vencida, proxima = calcular_flags_vencimento(hoje + timedelta(days=15))
    assert dias == 15
    assert vencida is False
    assert proxima is True

    # Validade longa (120 dias restantes)
    dias, vencida, proxima = calcular_flags_vencimento(hoje + timedelta(days=120))
    assert dias == 120
    assert vencida is False
    assert proxima is False

    # Sem data
    dias, vencida, proxima = calcular_flags_vencimento(None)
    assert dias == 0
    assert vencida is False
    assert proxima is False


def test_9_catalogo_e_cids(session, mock_user_solicitante):
    """Busca de procedimentos SIGTAP de Alta Complexidade e CIDs cadastrados."""
    from app.api.v1.apac import listar_sigtap_apac, buscar_cids

    procs = listar_sigtap_apac(q="hemodialise", db=session, user=mock_user_solicitante)
    assert len(procs) >= 1
    assert any("HEMODIALISE" in p.descricao.upper() for p in procs)

    cids = buscar_cids(q="renal", db=session, user=mock_user_solicitante)
    assert len(cids) >= 1
    assert any("renal" in c["descricao"].lower() for c in cids)


def test_10_faturamento_resumo_e_excel(session, mock_user_regulador):
    """Resumo de faturamento e exportação de planilha XLSX."""
    from app.api.v1.apac import resumo_faturamento, exportar_excel_apac

    comp = date.today().strftime("%Y-%m")
    res = resumo_faturamento(competencia=comp, db=session, user=mock_user_regulador)
    assert res.competencia == comp
    assert isinstance(res.total_apacs_autorizadas, int)

    resp_excel = exportar_excel_apac(competencia=comp, db=session, user=mock_user_regulador)
    assert resp_excel.status_code == 200
    assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in resp_excel.media_type

