"""Testes da importação XML/tabular de exames laboratoriais individuais.

Valida:
1. Formato A (agrupado/aninhado: <exame> com <exames_realizados><procedimento>...</procedimento></exames_realizados>)
2. Formato B (achatado: 1 <exame> por procedimento individual com <codigo_procedimento>/<nome_procedimento>)
3. Formato C (lista delimitada em texto: <exames_realizados>0202020380 - HEMOGRAMA COMPLETO; GLICOSE</exames_realizados>)
4. Lookup SIGTAP por código, código sem zero à esquerda, nome normalizado e nome curto sem prefixo ("DOSAGEM DE ...")
5. Criação controlada de procedimento ausente (origem_manual=True) e rejeição de placeholders ("desconhecido")
6. Segregação de filas: exames laboratoriais NÃO poluem tfd_exames_fila; exames TFD continuam em tfd_exames_fila
7. Sincronização de VagaLab.vagas_ocupadas e idempotência em reimportação
8. Exposição de sigtap_ids e exames_nomes em _formatar_fila_out / _extrair_sigtap_ids_fila
"""

import json
import os
from datetime import date

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.cadastros_saude import UnidadeSaude  # noqa: F401
from app.models.integracoes import IntegrationSettings  # noqa: F401
from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import (
    FilaPsf,
    ItemSolic,
    Laboratorio,
    SolicitacaoMestre,
    VagaLab,
)
from app.models.tfd import (
    Especialidade,  # noqa: F401
    ExameFila,
    Paciente,
    PacienteHistorico,  # noqa: F401
    ProcedimentoCatalogo,  # noqa: F401
    TipoFila,
)
from app.services.importacao_filas import ler_xml, processar_linhas, sanear_historico_fila_legada
from app.api.v1.lab_fase6 import _extrair_sigtap_ids_fila, _formatar_fila_out


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        # Seed básico: laboratório, vaga, procedimentos SIGTAP oficiais
        lab = Laboratorio(nome="Laboratório Municipal de Guapé", ativo=True)
        session.add(lab)
        session.flush()

        vaga = VagaLab(
            laboratorio_id=lab.id,
            data=date(2026, 11, 20),
            vagas_totais=30,
            vagas_ocupadas=0,
        )
        session.add(vaga)

        session.add(
            SigtapProcedimento(
                codigo="0202020380",
                descricao="HEMOGRAMA COMPLETO",
                valor_sa=4.11,
                valor_sp=0.0,
                grupo_codigo="02",
                subgrupo_codigo="0202",
                instrumento="BPA-I",
            )
        )
        session.add(
            SigtapProcedimento(
                codigo="0202010473",
                descricao="DOSAGEM DE GLICOSE",
                valor_sa=1.85,
                valor_sp=0.0,
                grupo_codigo="02",
                subgrupo_codigo="0202",
                instrumento="BPA-I",
            )
        )
        session.add(
            SigtapProcedimento(
                codigo="0202010295",
                descricao="DOSAGEM DE COLESTEROL TOTAL",
                valor_sa=1.85,
                valor_sp=0.0,
                grupo_codigo="02",
                subgrupo_codigo="0202",
                instrumento="BPA-I",
            )
        )
        session.add(
            TipoFila(nome="ROTINA", tipo_fila="EXAME_LABORATORIAL", ativo=True)
        )
        session.commit()
        yield session


def test_formato_a_aninhado_popula_fila_mestre_itens_e_vagas(db_session: Session):
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <exames>
      <exame>
        <codigo_pedido>12345</codigo_pedido>
        <nome>MARIA DA SILVA</nome>
        <cpf>12345678909</cpf>
        <data_nascimento>15/05/1980</data_nascimento>
        <tipo_fila>ROTINA</tipo_fila>
        <data_pedido>10/11/2026</data_pedido>
        <data_agendada>20/11/2026</data_agendada>
        <hora_agendada>07:30</hora_agendada>
        <status>agendado</status>
        <medico>DR JOAO</medico>
        <exames_realizados>
          <procedimento>
            <codigo_procedimento>0202020380</codigo_procedimento>
            <nome_procedimento>HEMOGRAMA COMPLETO</nome_procedimento>
            <quantidade>1</quantidade>
          </procedimento>
          <procedimento>
            <codigo_procedimento>202010473</codigo_procedimento>
            <nome_procedimento>Glicose</nome_procedimento>
            <quantidade>1</quantidade>
          </procedimento>
          <procedimento>
            <nome_procedimento>COLESTEROL TOTAL</nome_procedimento>
            <quantidade>2</quantidade>
          </procedimento>
        </exames_realizados>
      </exame>
    </exames>
    """.encode("utf-8")

    linhas = ler_xml(xml)
    assert len(linhas) == 1
    assert len(linhas[0]["_procedimentos_lista"]) == 3

    res = processar_linhas(linhas, db_session)
    assert res["lidas"] == 1
    assert res["exames_novos"] == 1
    assert res["itens_lab_novos"] == 3
    assert res["sigtap_criados"] == 0

    # Não deve poluir tfd_exames_fila
    assert db_session.exec(select(ExameFila)).all() == []

    # FilaPsf criada com todos os 3 IDs SIGTAP
    filas = db_session.exec(select(FilaPsf)).all()
    assert len(filas) == 1
    sigtap_ids = json.loads(filas[0].sigtap_ids_json)
    assert len(sigtap_ids) == 3

    # SolicitacaoMestre e 3 ItemSolic com valores SIGTAP corretos
    mestres = db_session.exec(select(SolicitacaoMestre)).all()
    assert len(mestres) == 1
    assert mestres[0].status == "agendado"
    assert mestres[0].origem_fila_id == filas[0].id

    itens = db_session.exec(
        select(ItemSolic).where(ItemSolic.solicitacao_id == mestres[0].id)
    ).all()
    assert len(itens) == 3
    valores = sorted(round(it.valor_unitario_aplicado, 2) for it in itens)
    assert valores == [1.85, 1.85, 4.11]
    qtds = sorted(it.quantidade for it in itens)
    assert qtds == [1, 1, 2]

    # VagaLab sincronizada automaticamente
    vaga = db_session.exec(select(VagaLab)).first()
    assert vaga is not None
    assert vaga.vagas_ocupadas == 1

    # _formatar_fila_out lê sigtap_ids_json e resolve exames_nomes
    pac = db_session.get(Paciente, filas[0].paciente_id)
    sigtap_map = {
        sp.id: sp.descricao for sp in db_session.exec(select(SigtapProcedimento)).all()
    }
    out = _formatar_fila_out(filas[0], pac, sigtap_map)
    assert len(out.sigtap_ids) == 3
    assert set(out.exames_nomes) == {
        "HEMOGRAMA COMPLETO",
        "DOSAGEM DE GLICOSE",
        "DOSAGEM DE COLESTEROL TOTAL",
    }

    # Reimportação idempotente: zero duplicatas
    res2 = processar_linhas(linhas, db_session)
    assert res2["exames_novos"] == 0
    assert res2["itens_lab_novos"] == 0
    assert res2["duplicados"] == 1
    assert len(db_session.exec(select(FilaPsf)).all()) == 1
    assert len(db_session.exec(select(SolicitacaoMestre)).all()) == 1
    assert len(db_session.exec(select(ItemSolic)).all()) == 3


def test_formato_b_achatado_acumula_na_mesma_fila_e_solicitacao(db_session: Session):
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <exames>
      <exame>
        <nome>JOSE PEREIRA</nome>
        <cpf>98765432100</cpf>
        <tipo_fila>HIPERDIA</tipo_fila>
        <data_pedido>12/11/2026</data_pedido>
        <data_agendada>20/11/2026</data_agendada>
        <status>agendado</status>
        <codigo_procedimento>0202020380</codigo_procedimento>
        <nome_procedimento>HEMOGRAMA COMPLETO</nome_procedimento>
      </exame>
      <exame>
        <nome>JOSE PEREIRA</nome>
        <cpf>98765432100</cpf>
        <tipo_fila>HIPERDIA</tipo_fila>
        <data_pedido>12/11/2026</data_pedido>
        <data_agendada>20/11/2026</data_agendada>
        <status>realizado</status>
        <codigo_procedimento>0202010473</codigo_procedimento>
        <nome_procedimento>DOSAGEM DE GLICOSE</nome_procedimento>
      </exame>
      <exame>
        <nome>JOSE PEREIRA</nome>
        <cpf>98765432100</cpf>
        <tipo_fila>HIPERDIA</tipo_fila>
        <data_pedido>12/11/2026</data_pedido>
        <data_agendada>20/11/2026</data_agendada>
        <status>agendado</status>
        <codigo_procedimento>0202010473</codigo_procedimento>
        <nome_procedimento>DOSAGEM DE GLICOSE</nome_procedimento>
      </exame>
    </exames>
    """.encode("utf-8")

    linhas = ler_xml(xml)
    assert len(linhas) == 3

    res = processar_linhas(linhas, db_session)
    assert res["exames_novos"] == 1
    assert res["itens_lab_novos"] == 2  # deduplicou o 3º item (glicose repetida)

    filas = db_session.exec(select(FilaPsf)).all()
    assert len(filas) == 1
    assert len(_extrair_sigtap_ids_fila(filas[0])) == 2

    mestres = db_session.exec(select(SolicitacaoMestre)).all()
    assert len(mestres) == 1
    # Status avançou para "realizado" e não regrediu para "agendado" na 3ª linha
    assert mestres[0].status == "realizado"
    assert mestres[0].status_auditoria == "aprovado"

    itens = db_session.exec(select(ItemSolic)).all()
    assert len(itens) == 2


def test_formato_c_texto_delimitado_e_fallback_criacao_sigtap_e_placeholder(db_session: Session):
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <exames>
      <exame>
        <nome>ANA SOUZA</nome>
        <tipo_fila>ROTINA</tipo_fila>
        <data_pedido>14/11/2026</data_pedido>
        <data_agendada>20/11/2026</data_agendada>
        <status>agendado</status>
        <exames_realizados>0202020380 - HEMOGRAMA COMPLETO; GLICOSE; VITAMINA D 25-OH</exames_realizados>
      </exame>
      <exame>
        <nome>CARLOS PLACEHOLDER</nome>
        <tipo_fila>ROTINA</tipo_fila>
        <data_pedido>14/11/2026</data_pedido>
        <status>desconhecido</status>
        <exames_realizados>desconhecido</exames_realizados>
      </exame>
    </exames>
    """.encode("utf-8")

    linhas = ler_xml(xml)
    res = processar_linhas(linhas, db_session)
    assert res["exames_novos"] == 2
    assert res["itens_lab_novos"] == 3
    # Criou apenas 1 procedimento manual ("VITAMINA D 25-OH"), NÃO criou "desconhecido"
    assert res["sigtap_criados"] == 1

    criados_manuais = db_session.exec(
        select(SigtapProcedimento).where(SigtapProcedimento.origem_manual == True)  # noqa: E712
    ).all()
    assert len(criados_manuais) == 1
    assert criados_manuais[0].descricao == "VITAMINA D 25-OH"
    assert criados_manuais[0].codigo.startswith("IMP-")

    # Paciente placeholder ficou na fila sem exames falsos
    pac_ph = db_session.exec(select(Paciente).where(Paciente.nome == "CARLOS PLACEHOLDER")).first()
    fila_ph = db_session.exec(select(FilaPsf).where(FilaPsf.paciente_id == pac_ph.id)).first()
    assert fila_ph is not None
    assert fila_ph.status == "na_fila"
    assert json.loads(fila_ph.sigtap_ids_json) == []


def test_fila_nao_lab_continua_em_tfd_exames_fila(db_session: Session):
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <exames>
      <exame>
        <nome>PEDRO CARDIO</nome>
        <tipo_fila>CARDIOLOGIA</tipo_fila>
        <data_pedido>15/11/2026</data_pedido>
        <codigo_procedimento>0301010072</codigo_procedimento>
        <nome_procedimento>CONSULTA MEDICA EM ATENCAO ESPECIALIZADA</nome_procedimento>
      </exame>
    </exames>
    """.encode("utf-8")

    linhas = ler_xml(xml)
    res = processar_linhas(linhas, db_session)
    assert res["exames_novos"] == 1
    assert len(db_session.exec(select(ExameFila)).all()) == 1
    assert len(db_session.exec(select(FilaPsf)).all()) == 0
    assert len(db_session.exec(select(SolicitacaoMestre)).all()) == 0


def test_vinculo_pec_prioritario_sem_duplicar_e_aviso_novos_pacientes(db_session: Session):
    # 1. Seed de pacientes vindos do PEC + stub legado com mesmo nome + colisão de prontuário
    pec_maria = Paciente(
        nome="MARIA APARECIDA DA SILVA SANTOS",
        cpf="12345678909",
        co_seq_cidadao_pec=5001,
        codigo_prontuario="5001",
        situacao_cadastral="ativo",
    )
    stub_maria = Paciente(
        nome="MARIA APARECIDA DA SILVA SANTOS",
        cpf="",
        co_seq_cidadao_pec=None,
        codigo_prontuario="99999",
        situacao_cadastral="ativo",
    )
    pec_joao = Paciente(
        nome="JOAO CARLOS OLIVEIRA",
        cpf="98765432100",
        co_seq_cidadao_pec=147465,
        codigo_prontuario="147465",  # Mesmo número que o prontuário Vivver da Maria!
        situacao_cadastral="ativo",
    )
    db_session.add_all([pec_maria, stub_maria, pec_joao])
    db_session.commit()
    id_pec_maria = pec_maria.id
    id_pec_joao = pec_joao.id

    # 2. XML estilo Vivver (sem CPF/CNS/nascimento):
    # - Linha 1: Maria com prontuário 147465 (que no banco pertence ao João!) e nome abreviado -> DEVE vincular à Maria do PEC, NÃO ao João e NÃO criar novo!
    # - Linha 2: João exato sem nascimento -> DEVE vincular ao João do PEC!
    # - Linha 3: Paciente inexistente -> DEVE gerar aviso!
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <exames>
      <exame>
        <prontuario>147465</prontuario>
        <paciente>MARIA APARECIDA SILVA</paciente>
        <tipo_servico>ROTINA</tipo_servico>
        <data_agendamento>20/11/2026</data_agendamento>
        <status>agendado</status>
        <codigo_procedimento>0202020380</codigo_procedimento>
      </exame>
      <exame>
        <prontuario>88888</prontuario>
        <paciente>JOAO CARLOS OLIVEIRA</paciente>
        <tipo_servico>ROTINA</tipo_servico>
        <data_agendamento>20/11/2026</data_agendamento>
        <status>agendado</status>
        <codigo_procedimento>0202010473</codigo_procedimento>
      </exame>
      <exame>
        <prontuario>77777</prontuario>
        <paciente>FULANO INEXISTENTE NO PEC</paciente>
        <tipo_servico>ROTINA</tipo_servico>
        <data_agendamento>20/11/2026</data_agendamento>
        <status>agendado</status>
        <codigo_procedimento>0202020380</codigo_procedimento>
      </exame>
    </exames>
    """.encode("utf-8")

    linhas = ler_xml(xml)

    # 3. Teste em modo estrito (criar_pacientes_novos=False): zero pacientes criados, avisa o ausente
    res_estrito = processar_linhas(linhas, db_session, simular=False, criar_pacientes_novos=False)
    assert res_estrito["pacientes_novos"] == 0
    assert res_estrito["pacientes_vinculados_pec"] == 2
    assert res_estrito["pacientes_criados_sem_pec"] == 0
    assert res_estrito["pacientes_nao_encontrados_ignorados"] == 1
    assert "ignoradas" in res_estrito["aviso_criacao_pacientes"]
    assert len(res_estrito["avisos_pacientes_novos"]) == 1
    assert res_estrito["avisos_pacientes_novos"][0]["nome"] == "FULANO INEXISTENTE NO PEC"
    assert res_estrito["avisos_pacientes_novos"][0]["acao"] == "ignorado"

    # Confirma que Maria foi vinculada ao registro PEC dela (não ao João e não ao stub!)
    # Além disso, a consolidação pós-importação ainda unificou o stub duplicado na Maria do PEC (restam apenas os 2 PEC).
    filas = db_session.exec(select(FilaPsf)).all()
    assert {f.paciente_id for f in filas} == {id_pec_maria, id_pec_joao}
    assert len(db_session.exec(select(Paciente)).all()) == 2  # Nenhum paciente novo criado e stub duplicado consolidado!

    # 4. Teste permitindo criar ausentes (criar_pacientes_novos=True): cria apenas o inexistente e avisa
    res_criar = processar_linhas(linhas, db_session, simular=False, criar_pacientes_novos=True)
    assert res_criar["pacientes_vinculados_pec"] == 2
    assert res_criar["pacientes_novos"] == 1
    assert res_criar["pacientes_criados_sem_pec"] == 1
    assert "não foram encontrados" in res_criar["aviso_criacao_pacientes"]
    assert len(res_criar["avisos_pacientes_novos"]) == 1
    assert res_criar["avisos_pacientes_novos"][0]["nome"] == "FULANO INEXISTENTE NO PEC"
    assert res_criar["avisos_pacientes_novos"][0]["acao"] == "criado_sem_pec"
    assert len(db_session.exec(select(Paciente)).all()) == 3


def test_deduplicacao_robusta_cpf_cns_prontuario_e_nome_sem_duplicar(db_session: Session):
    """Garante que variações de zeros à esquerda em CPF/CNS/Prontuário e preposições de nomes
    não geram pacientes duplicados no sistema.
    """
    from app.services.importacao_filas import processar_linhas, ler_xml

    p1 = Paciente(
        nome="SEBASTIAO DA COSTA SANTOS",
        cpf="00123456789",  # 11 dígitos com 2 zeros à esquerda
        cns="000123456789012",  # 15 dígitos com 3 zeros
        codigo_prontuario="004521",
        nascimento=date(1965, 8, 20),
        situacao_cadastral="ativo",
    )
    p2 = Paciente(
        nome="MARIA APARECIDA DOS REIS",
        cpf="98765432100",
        cns="890123456789012",
        codigo_prontuario="PR-009876",
        nascimento=None,  # sem data registrada inicialmente
        situacao_cadastral="ativo",
    )
    db_session.add(p1)
    db_session.add(p2)
    db_session.commit()
    db_session.refresh(p1)
    db_session.refresh(p2)

    # XML vindo com:
    # Linha 1: Sebastião com CPF "123456789" (perdeu os dois zeros no Excel), CNS "123456789012", Prontuário "4521"
    # Linha 2: Maria sem preposição "MARIA APARECIDA REIS" com data de nascimento "1972-03-15" (que preenche o nascimento dela)
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <exames>
      <exame>
        <paciente>SEBASTIAO COSTA SANTOS</paciente>
        <cpf>123456789</cpf>
        <cns>123456789012</cns>
        <prontuario>4521</prontuario>
        <nascimento>1965-08-20</nascimento>
        <tipo_servico>EXAME DE SANGUE</tipo_servico>
        <status>aguardando</status>
        <nome_procedimento>GLICOSE</nome_procedimento>
      </exame>
      <exame>
        <paciente>MARIA APARECIDA REIS</paciente>
        <cpf>98765432100</cpf>
        <prontuario>9876</prontuario>
        <nascimento>1972-03-15</nascimento>
        <tipo_servico>CARDIOLOGIA</tipo_servico>
        <status>aguardando</status>
        <nome_procedimento>CONSULTA EM CARDIOLOGIA</nome_procedimento>
      </exame>
    </exames>
    """.encode("utf-8")

    linhas = ler_xml(xml)
    res = processar_linhas(linhas, db_session, simular=False, criar_pacientes_novos=True)

    # Nenhum paciente novo deve ser criado: ambos devem ser reutilizados
    assert res["pacientes_novos"] == 0
    pacs = db_session.exec(select(Paciente)).all()
    assert len(pacs) == 2

    # Verifica se os pedidos foram associados aos pacientes existentes
    fila_psf = db_session.exec(select(FilaPsf)).first()
    assert fila_psf is not None
    assert fila_psf.paciente_id == p1.id

    exame_tfd = db_session.exec(select(ExameFila)).first()
    assert exame_tfd is not None
    assert exame_tfd.paciente_id == p2.id

    # Maria teve seu nascimento enriquecido sem conflito
    db_session.refresh(p2)
    assert p2.nascimento == date(1972, 3, 15)


def test_alerta_obito_e_mudanca_nos_pedidos_e_baixa_em_lote(db_session: Session):
    """Testa identificação de alerta em pedidos de pacientes com óbito ou mudança,
    além dos endpoints de análise e baixa em lote.
    """
    from app.api.v1.tfd import (
        _com_posicao,
        analisar_pedidos_inelegiveis_tfd,
        dar_baixa_pedidos_inelegiveis_tfd,
    )
    from app.api.v1.lab_fase6 import (
        _formatar_fila_out,
        analisar_pedidos_inelegiveis_psf,
        dar_baixa_pedidos_inelegiveis_psf,
    )
    from app.schemas.tfd import BaixaPedidosInelegiveisIn
    from app.schemas.lab_fase6 import BaixaFilaPsfInelegiveisIn
    from app.models.user import User

    usuario_teste = User(
        username="operador_fila",
        nome="Operador da Fila",
        password_hash="hash",
        ativo=True,
    )
    db_session.add(usuario_teste)

    p_obito = Paciente(
        nome="PACIENTE EM OBITO SILVA",
        cpf="11122233344",
        situacao_cadastral="obito",
        data_obito=date(2026, 1, 10),
        motivo_situacao="Certidão de óbito nº 123",
    )
    p_mudou = Paciente(
        nome="PACIENTE QUE MUDOU OLIVEIRA",
        cpf="55566677788",
        situacao_cadastral="mudanca_municipio",
        motivo_situacao="Mudou-se para Alfenas/MG",
    )
    p_ativo = Paciente(
        nome="PACIENTE NORMAL ATIVO",
        cpf="99988877766",
        situacao_cadastral="ativo",
    )
    db_session.add(p_obito)
    db_session.add(p_mudou)
    db_session.add(p_ativo)
    db_session.commit()
    db_session.refresh(p_obito)
    db_session.refresh(p_mudou)
    db_session.refresh(p_ativo)

    # 1. Pedidos na Fila TFD (ExameFila)
    ex_obito = ExameFila(
        paciente_id=p_obito.id,
        exame="TOMOGRAFIA COMPUTADORIZADA",
        tipo_fila="EXAMES ESPECIAIS",
        status="aguardando",
        data_pedido=date(2026, 2, 1),
        ativo=True,
    )
    ex_mudou = ExameFila(
        paciente_id=p_mudou.id,
        exame="CONSULTA OFTALMOLOGIA",
        tipo_fila="CONSULTAS",
        status="aguardando",
        data_pedido=date(2026, 2, 2),
        ativo=True,
    )
    ex_ativo = ExameFila(
        paciente_id=p_ativo.id,
        exame="ULTRASSONOGRAFIA",
        tipo_fila="EXAMES",
        status="aguardando",
        data_pedido=date(2026, 2, 3),
        ativo=True,
    )
    db_session.add(ex_obito)
    db_session.add(ex_mudou)
    db_session.add(ex_ativo)

    # 2. Pedidos na Fila PSF (FilaPsf)
    fila_obito = FilaPsf(
        paciente_id=p_obito.id,
        especialidade="BIOQUIMICA",
        status="na_fila",
        data_solicitacao=date(2026, 2, 1),
        unidade_psf="PSF 1",
        medico_solicitante="Dr. Teste",
    )
    fila_ativo = FilaPsf(
        paciente_id=p_ativo.id,
        especialidade="HEMATOLOGIA",
        status="na_fila",
        data_solicitacao=date(2026, 2, 3),
        unidade_psf="PSF 1",
        medico_solicitante="Dr. Teste",
    )
    db_session.add(fila_obito)
    db_session.add(fila_ativo)
    db_session.commit()

    # 3. Testa badges e alertas nos schemas de saída
    out_tfd = _com_posicao(db_session, [ex_obito, ex_mudou, ex_ativo])
    assert len(out_tfd) == 3
    # ex_obito
    assert out_tfd[0].paciente_obito_ou_mudanca is True
    assert "óbito" in out_tfd[0].alerta_situacao.lower()
    # ex_mudou
    assert out_tfd[1].paciente_obito_ou_mudanca is True
    assert "mudança" in out_tfd[1].alerta_situacao.lower()
    # ex_ativo
    assert out_tfd[2].paciente_obito_ou_mudanca is False
    assert out_tfd[2].alerta_situacao == ""

    out_psf_obito = _formatar_fila_out(fila_obito, p_obito)
    assert out_psf_obito.paciente_obito_ou_mudanca is True
    assert "óbito" in out_psf_obito.alerta_situacao.lower()

    out_psf_ativo = _formatar_fila_out(fila_ativo, p_ativo)
    assert out_psf_ativo.paciente_obito_ou_mudanca is False
    assert out_psf_ativo.alerta_situacao == ""

    # 4. Testa endpoint de análise de pedidos inelegíveis TFD
    analise_tfd = analisar_pedidos_inelegiveis_tfd(db=db_session, ator=usuario_teste)
    assert analise_tfd.total_pedidos == 2
    assert analise_tfd.pedidos_obito == 1
    assert analise_tfd.pedidos_mudanca == 1
    assert analise_tfd.pedidos_inativo == 0
    ids_analise_tfd = {p.id for p in analise_tfd.pedidos}
    assert ids_analise_tfd == {ex_obito.id, ex_mudou.id}

    # 5. Executa baixa em lote na fila TFD
    res_baixa_tfd = dar_baixa_pedidos_inelegiveis_tfd(
        payload=BaixaPedidosInelegiveisIn(ids=[ex_obito.id, ex_mudou.id]),
        db=db_session,
        ator=usuario_teste,
    )
    assert res_baixa_tfd["baixados"] == 2

    db_session.refresh(ex_obito)
    db_session.refresh(ex_mudou)
    db_session.refresh(ex_ativo)
    assert ex_obito.status == "cancelado"
    assert ex_mudou.status == "cancelado"
    assert ex_ativo.status == "aguardando"  # Permanece ativo intacto!

    # 6. Testa análise e baixa na Fila PSF
    analise_psf = analisar_pedidos_inelegiveis_psf(db=db_session)
    assert analise_psf.total_pedidos == 1
    assert analise_psf.pedidos_obito == 1
    assert analise_psf.pedidos[0].id == fila_obito.id

    res_baixa_psf = dar_baixa_pedidos_inelegiveis_psf(
        payload=BaixaFilaPsfInelegiveisIn(ids=[fila_obito.id]),
        db=db_session,
        ator=usuario_teste,
    )
    assert res_baixa_psf["baixados"] == 1

    db_session.refresh(fila_obito)
    db_session.refresh(fila_ativo)
    assert fila_obito.status == "cancelado"
    assert fila_ativo.status == "na_fila"  # Permanece ativo intacto!

    # 7. Verifica se histórico do paciente foi registrado
    historico = db_session.exec(
        select(PacienteHistorico).where(PacienteHistorico.paciente_id == p_obito.id)
    ).all()
    assert len(historico) >= 2
    assert any("BAIXA" in h.tipo_evento for h in historico)


def test_separacao_automatica_historico_vs_fila_real_mesmo_xml(db_session: Session):
    """Garante que em um ÚNICO arquivo XML:
    1. Pedidos com data de agendamento passada (< hoje) ou status 'desconhecido' do Vivver
       são classificados como HISTÓRICO REALIZADO:
       - Vão para SolicitacaoMestre (status='realizado', status_auditoria='aprovado') e ItemSolic.
       - NÃO criam registros 'na_fila' em FilaPsf (a fila de trabalho do PSF não é poluída!).
    2. Pedidos com data futura (>= hoje) são classificados como FILA ATIVA AGENDADA:
       - Vão para FilaPsf (status='agendado') e SolicitacaoMestre (status='agendado').
    3. Pedidos recentes sem data agendada e status 'aguardando' são classificados como FILA ATIVA PENDENTE:
       - Vão para FilaPsf (status='na_fila') e NÃO criam SolicitacaoMestre.
    4. Pedidos cancelados são arquivados em PacienteHistorico sem entrar na fila ativa.
    """
    xml_conteudo = """<?xml version="1.0" encoding="UTF-8"?>
    <exames_laboratorio>
      <!-- 1. Exame Histórico (2024, Vivver com status desconhecido) -->
      <exame>
        <codigo>10001</codigo>
        <prontuario>147001</prontuario>
        <paciente>Paciente Historico 2024</paciente>
        <cpf>111.111.111-11</cpf>
        <data_agendamento>26/02/2024</data_agendamento>
        <hora_agendamento>08:00</hora_agendamento>
        <status>desconhecido</status>
        <tipo_servico>EX. LAB. PSF ROTINA</tipo_servico>
        <profissional>DR. MEDICO TESTE</profissional>
        <exames_realizados>desconhecido</exames_realizados>
        <resultado>desconhecido</resultado>
      </exame>

      <!-- 2. Exame Fila Real Agendada Futura (ano 2029) -->
      <exame>
        <codigo>10002</codigo>
        <prontuario>147002</prontuario>
        <paciente>Paciente Fila Futura</paciente>
        <cpf>222.222.222-22</cpf>
        <data_agendamento>20/12/2029</data_agendamento>
        <hora_agendamento>07:30</hora_agendamento>
        <status>agendado</status>
        <tipo_servico>EXAME_LABORATORIAL</tipo_servico>
        <profissional>DRA. MEDICA TESTE</profissional>
        <exames_realizados>0202020380 - HEMOGRAMA COMPLETO</exames_realizados>
      </exame>

      <!-- 3. Exame Fila Real Pendente (Aguardando convocacao) -->
      <exame>
        <codigo>10003</codigo>
        <prontuario>147003</prontuario>
        <paciente>Paciente Aguardando Fila</paciente>
        <cpf>333.333.333-33</cpf>
        <status>aguardando</status>
        <tipo_servico>EXAME_LABORATORIAL</tipo_servico>
        <profissional>DR. MEDICO TESTE</profissional>
        <exames_realizados>0202010473 - DOSAGEM DE GLICOSE</exames_realizados>
      </exame>

      <!-- 4. Exame Cancelado / Desistencia com observacao longa do Vivver -->
      <exame>
        <codigo>10004</codigo>
        <prontuario>147004</prontuario>
        <paciente>Paciente Cancelado</paciente>
        <cpf>444.444.444-44</cpf>
        <data_agendamento>15/01/2024</data_agendamento>
        <status>cancelado</status>
        <tipo_servico>EXAME_LABORATORIAL</tipo_servico>
        <observacao>................................................................................................. | Motivo: Erro digitação</observacao>
      </exame>
    </exames_laboratorio>
    """.encode("utf-8")

    linhas = ler_xml(xml_conteudo)
    res = processar_linhas(linhas, db=db_session, simular=False, criar_pacientes_novos=True)

    # Valida contadores
    assert res["lidas"] == 4
    assert res["pedidos_fila_ativa"] == 2  # Paciente Fila Futura + Paciente Aguardando Fila
    assert res["pedidos_historico_prontuario"] == 1  # Paciente Historico 2024
    assert res["pedidos_historico_cancelados"] == 1  # Paciente Cancelado

    # 1. Verifica Paciente 1 (Histórico 2024)
    p1 = db_session.exec(select(Paciente).where(Paciente.cpf == "11111111111")).first()
    assert p1 is not None

    # NÃO deve ter criado registro 'na_fila' em FilaPsf!
    fila_p1 = db_session.exec(select(FilaPsf).where(FilaPsf.paciente_id == p1.id)).all()
    assert len(fila_p1) == 0  # Zero itens de fila de espera!

    # DEVE constar em SolicitacaoMestre como realizado / aprovado
    solic_p1 = db_session.exec(
        select(SolicitacaoMestre).where(SolicitacaoMestre.paciente_id == p1.id)
    ).first()
    assert solic_p1 is not None
    assert solic_p1.status == "realizado"
    assert solic_p1.status_auditoria == "aprovado"
    assert solic_p1.data_agendada == date(2024, 2, 26)

    # DEVE ter ItemSolic criado através do fallback de tipo_servico
    itens_p1 = db_session.exec(
        select(ItemSolic).where(ItemSolic.solicitacao_id == solic_p1.id)
    ).all()
    assert len(itens_p1) == 1
    assert itens_p1[0].status_auditoria == "aprovado"

    # 2. Verifica Paciente 2 (Fila Futura Agendada)
    p2 = db_session.exec(select(Paciente).where(Paciente.cpf == "22222222222")).first()
    assert p2 is not None

    fila_p2 = db_session.exec(select(FilaPsf).where(FilaPsf.paciente_id == p2.id)).first()
    assert fila_p2 is not None
    assert fila_p2.status == "agendado"
    assert fila_p2.data_agendada == date(2029, 12, 20)

    solic_p2 = db_session.exec(
        select(SolicitacaoMestre).where(SolicitacaoMestre.paciente_id == p2.id)
    ).first()
    assert solic_p2 is not None
    assert solic_p2.status == "agendado"

    # 3. Verifica Paciente 3 (Fila Pendente Aguardando)
    p3 = db_session.exec(select(Paciente).where(Paciente.cpf == "33333333333")).first()
    assert p3 is not None

    fila_p3 = db_session.exec(select(FilaPsf).where(FilaPsf.paciente_id == p3.id)).first()
    assert fila_p3 is not None
    assert fila_p3.status == "na_fila"

    # Não deve ter SolicitacaoMestre ainda (pois está apenas aguardando convocação/agendamento)
    solic_p3 = db_session.exec(
        select(SolicitacaoMestre).where(SolicitacaoMestre.paciente_id == p3.id)
    ).first()
    assert solic_p3 is None

    # 4. Verifica Paciente 4 (Cancelado)
    p4 = db_session.exec(select(Paciente).where(Paciente.cpf == "44444444444")).first()
    assert p4 is not None

    fila_p4 = db_session.exec(select(FilaPsf).where(FilaPsf.paciente_id == p4.id)).all()
    assert len(fila_p4) == 0

    hist_p4 = db_session.exec(
        select(PacienteHistorico).where(PacienteHistorico.paciente_id == p4.id)
    ).all()
    assert len(hist_p4) >= 1
    assert any("CANCELADO" in h.tipo_evento for h in hist_p4)


def test_reimportacao_atualiza_fila_legada_para_realizado(db_session: Session):
    """Se um exame de 2024 já foi importado anteriormente como 'na_fila',
    ao reimportar o XML, o sistema deve automaticamente atualizar o status do FilaPsf para 'realizado',
    retirando-o da fila de espera e garantindo SolicitacaoMestre no prontuário.
    """
    p = Paciente(nome="Paciente Reimportado 2024", cpf="55555555555")
    db_session.add(p)
    db_session.flush()

    fila_antiga = FilaPsf(
        paciente_id=p.id,
        especialidade="EXAME_LABORATORIAL",
        tipo_fila="EXAME_LABORATORIAL",
        unidade_psf="PSF Central",
        data_solicitacao=date(2024, 3, 10),
        data_agendada=date(2024, 3, 10),
        status="na_fila",  # Estava indevidamente na fila de espera
    )
    db_session.add(fila_antiga)
    db_session.commit()

    xml_reimport = b"""<?xml version="1.0" encoding="UTF-8"?>
    <exames_laboratorio>
      <exame>
        <codigo>99999</codigo>
        <paciente>Paciente Reimportado 2024</paciente>
        <cpf>555.555.555-55</cpf>
        <data_agendamento>10/03/2024</data_agendamento>
        <status>desconhecido</status>
        <tipo_servico>EXAME_LABORATORIAL</tipo_servico>
        <exames_realizados>0202020380 - HEMOGRAMA COMPLETO</exames_realizados>
      </exame>
    </exames_laboratorio>
    """
    linhas = ler_xml(xml_reimport)
    processar_linhas(linhas, db=db_session, simular=False, criar_pacientes_novos=False)

    db_session.refresh(fila_antiga)
    # Deve ter saido de 'na_fila' para 'realizado'
    assert fila_antiga.status == "realizado"

    # E SolicitacaoMestre deve estar criada como realizado
    sm = db_session.exec(
        select(SolicitacaoMestre).where(SolicitacaoMestre.paciente_id == p.id)
    ).first()
    assert sm is not None
    assert sm.status == "realizado"
    assert sm.status_auditoria == "aprovado"


def test_sanear_historico_fila_legada_funcao(db_session: Session):
    """Testa diretamente a função sanear_historico_fila_legada."""
    p = Paciente(nome="Paciente Sanear Legado", cpf="66666666666")
    db_session.add(p)
    db_session.flush()

    f_legada = FilaPsf(
        paciente_id=p.id,
        especialidade="EXAME_LABORATORIAL",
        tipo_fila="EXAME_LABORATORIAL",
        unidade_psf="PSF Central",
        data_solicitacao=date(2024, 1, 15),
        data_agendada=date(2024, 1, 15),
        status="na_fila",
    )
    db_session.add(f_legada)
    db_session.commit()

    res = sanear_historico_fila_legada(db_session)
    assert res["filas_saneadas"] >= 1

    db_session.refresh(f_legada)
    assert f_legada.status == "realizado"
