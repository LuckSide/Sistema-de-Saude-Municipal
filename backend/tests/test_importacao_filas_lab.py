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
from app.services.importacao_filas import ler_xml, processar_linhas
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
