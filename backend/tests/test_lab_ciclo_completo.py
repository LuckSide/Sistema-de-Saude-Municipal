"""Testes automatizados cobrindo o fluxo completo de gestão e marcação de exames de sangue:
- Inclusão e edição na fila do PSF
- Marcação mensal em lote
- Emissão de comprovante com horário e preparo
- Validação e solicitação de ajuste pelo laboratório
- Recepção e coleta de exames
- Consolidação e exportação BPA
"""

from datetime import date, datetime
import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import (
    FilaPsf,
    Laboratorio,
    LabPedidoAjuste,
    SolicitacaoMestre,
    VagaLab,
)
from app.models.tfd import Paciente
from app.models.user import User
from app.services.lab_fase6 import (
    agendar_lote_fila,
    analisar_pedido_ajuste,
    consolidar_bpa_laboratorial,
    criar_solicitacao_mestre,
    determinar_preparo,
    gerar_comprovante_agendamento,
    pedir_ajuste_laboratorio,
    recepcionar_coleta,
)


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", echo=False)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        # Seed inicial de laboratório
        lab = Laboratorio(nome="Laboratório Central de Guapé", ativo=True)
        session.add(lab)
        session.flush()

        # Seed de procedimentos SIGTAP
        p1 = SigtapProcedimento(
            codigo="0202010473",
            descricao="HEMOGRAMA COMPLETO",
            instrumento="BPA-C",
            valor_sa=4.11,
        )
        p2 = SigtapProcedimento(
            codigo="0202010295",
            descricao="DOSAGEM DE GLICOSE",
            instrumento="BPA-C",
            valor_sa=1.85,
        )
        p3 = SigtapProcedimento(
            codigo="0202010287",
            descricao="DOSAGEM DE COLESTEROL TOTAL",
            instrumento="BPA-C",
            valor_sa=1.85,
        )
        session.add_all([p1, p2, p3])
        session.flush()

        # Paciente
        pac = Paciente(
            nome="Jose Aparecido de Oliveira",
            cpf="111.222.333-44",
            cns="700000000000011",
            data_nascimento=date(1975, 5, 20),
            prontuario="PR-01234",
        )
        session.add(pac)
        session.flush()

        # Vagas no laboratório para 2026-11-05
        data_vaga = date(2026, 11, 5)
        vaga = VagaLab(
            laboratorio_id=lab.id,
            data=data_vaga,
            vagas_totais=20,
            vagas_ocupadas=0,
        )
        session.add(vaga)
        session.commit()
        yield session


def test_determinar_preparo():
    # Sem glicose/colesterol: jejum leve ou dispensável
    jejum, prep, orient = determinar_preparo(["HEMOGRAMA COMPLETO"])
    assert "4 horas" in jejum
    assert len(prep) >= 3

    # Com glicose ou colesterol: jejum estrito de 8 a 12 horas
    jejum_estrito, prep2, _ = determinar_preparo(["HEMOGRAMA COMPLETO", "DOSAGEM DE GLICOSE"])
    assert "8 a 12 horas" in jejum_estrito
    assert any("Jejum alimentar recomendado: 8 a 12 horas" in p for p in prep2)


def test_fluxo_completo_fila_agendamento_comprovante_e_coleta(db_session):
    lab = db_session.exec(select(Laboratorio)).first()
    pac = db_session.exec(select(Paciente)).first()
    procs = list(db_session.exec(select(SigtapProcedimento)).all())

    # 1. Entrada na Fila do PSF
    fila = FilaPsf(
        paciente_id=pac.id,
        unidade_psf="PSF Central Guapé",
        medico_solicitante="Dra. Mariana Silva",
        data_solicitacao=date(2026, 10, 25),
        justificativa="Acompanhamento de rotina para paciente hipertenso",
    )
    db_session.add(fila)
    db_session.commit()
    db_session.refresh(fila)
    assert fila.status == "na_fila"

    # 2. Marcação em lote no início do mês
    agendados = agendar_lote_fila(
        db_session,
        fila_ids=[fila.id],
        laboratorio_id=lab.id,
        data_agendada=date(2026, 11, 5),
        hora_agendada="07:30",
        sigtap_ids=[p.id for p in procs],
        agendado_por="coord_regulacao",
    )
    assert len(agendados) == 1
    mestre = agendados[0]
    assert mestre.status == "agendado"
    assert mestre.hora_agendada == "07:30"
    assert mestre.status_auditoria == "pendente_conferencia"

    # Fila original atualizada para agendado
    db_session.refresh(fila)
    assert fila.status == "agendado"

    # 3. Emissão do Comprovante de Agendamento
    comprovante = gerar_comprovante_agendamento(db_session, mestre.id)
    assert comprovante["paciente_nome"] == pac.nome
    assert comprovante["paciente_cpf"] == pac.cpf
    assert comprovante["hora_agendada"] == "07:30"
    assert comprovante["laboratorio_nome"] == lab.nome
    assert len(comprovante["itens"]) == 3
    assert "8 a 12 horas" in comprovante["jejum_horas"]
    assert len(comprovante["preparo_instrucoes"]) >= 3

    # 4. Recepção e Coleta no Laboratório
    mestre_coletado = recepcionar_coleta(db_session, mestre.id, "atendente_lab")
    assert mestre_coletado.status == "coletado"
    assert mestre_coletado.coletado_por == "atendente_lab"
    assert mestre_coletado.coletado_em is not None
    assert mestre_coletado.status_auditoria == "aprovado"

    # 5. Consolidação BPA para a competência
    resumo_bpa = consolidar_bpa_laboratorial(db_session, "2026-11")
    assert resumo_bpa["competencia"] == "2026-11"
    assert resumo_bpa["total_exames"] == 3
    assert resumo_bpa["total_pacientes"] == 1
    assert resumo_bpa["valor_total"] == pytest.approx(4.11 + 1.85 + 1.85, 0.01)


def test_pedido_ajuste_laboratorio(db_session):
    lab = db_session.exec(select(Laboratorio)).first()
    pac = db_session.exec(select(Paciente)).first()
    proc = db_session.exec(select(SigtapProcedimento)).first()

    # Cria solicitação agendada
    mestre = criar_solicitacao_mestre(
        db_session,
        paciente_id=pac.id,
        data_agendada=date(2026, 11, 5),
        laboratorio_id=lab.id,
        sigtap_ids=[proc.id],
        agendado_por="regulacao",
        justificativa="Investigação de anemia em paciente sintomático",
    )

    # Laboratório submete pedido de ajuste
    ajuste = pedir_ajuste_laboratorio(
        db_session,
        mestre_id=mestre.id,
        laboratorio_id=lab.id,
        tipo_ajuste="inclusao_procedimento",
        justificativa="Pedido médico solicita inclusão de Ferritina Sérica",
        itens_propostos=[{"codigo": "0202010384", "descricao": "FERRITINA", "quantidade": 1}],
        solicitado_por="recepcao_lab",
    )
    assert ajuste.status == "pendente"
    assert ajuste.solicitado_por == "recepcao_lab"

    db_session.refresh(mestre)
    assert mestre.status_auditoria == "aguardando_autorizacao_sec"

    # Secretaria aprova o ajuste
    ajuste_aprovado = analisar_pedido_ajuste(
        db_session,
        ajuste_id=ajuste.id,
        aprovado=True,
        resposta="Inclusão autorizada conforme requisição médica anexada",
        user_nome="auditor_secretaria",
    )
    assert ajuste_aprovado.status == "aprovado"
    assert ajuste_aprovado.analisado_por == "auditor_secretaria"

    db_session.refresh(mestre)
    assert mestre.status_auditoria == "aprovado"
    assert "[Ajuste Aprovado]" in mestre.observacao_laboratorio


def test_filtros_fila_psf_periodo_unidade_e_busca(db_session: Session):
    from app.api.v1.lab_fase6 import listar_fila

    pac1 = Paciente(nome="Carlos Eduardo Silva", cpf="11122233344", cns="700000000000010")
    pac2 = Paciente(nome="Ana Paula Mendes", cpf="55566677788", cns="700000000000020")
    db_session.add(pac1)
    db_session.add(pac2)
    db_session.commit()
    db_session.refresh(pac1)
    db_session.refresh(pac2)

    item1 = FilaPsf(
        paciente_id=pac1.id,
        unidade_psf="PSF Bela Vista",
        medico_solicitante="Dr. Carlos",
        data_solicitacao=date(2026, 10, 10),
        status="na_fila",
        justificativa="Acompanhamento de hipertensao",
        observacoes="SIGTAP_IDS: [1] | Exames: GLICOSE |",
    )
    item2 = FilaPsf(
        paciente_id=pac2.id,
        unidade_psf="PSF Centro - Dr. Celso",
        medico_solicitante="Dra. Roberta",
        data_solicitacao=date(2026, 10, 25),
        status="na_fila",
        justificativa="Investigacao de anemia profunda",
        observacoes="SIGTAP_IDS: [2] | Exames: HEMOGRAMA COMPLETO |",
    )
    db_session.add(item1)
    db_session.add(item2)
    db_session.commit()

    # 1. Filtro por PSF
    res_psf = listar_fila(unidade="Bela Vista", db=db_session, _=None)
    assert res_psf["total"] == 1
    assert res_psf["data"][0].unidade_psf == "PSF Bela Vista"

    # 2. Filtro por Período (20 a 26 de Outubro)
    res_per = listar_fila(data_de="2026-10-20", data_ate="2026-10-26", db=db_session, _=None)
    assert res_per["total"] == 1
    assert res_per["data"][0].unidade_psf == "PSF Centro - Dr. Celso"

    # 3. Filtro por Período Total (1 a 31 de Outubro)
    res_total = listar_fila(data_de="2026-10-01", data_ate="2026-10-31", db=db_session, _=None)
    assert res_total["total"] == 2

    # 4. Filtro por Busca de Paciente / Justificativa
    res_busca = listar_fila(q="anemia", db=db_session, _=None)
    assert res_busca["total"] == 1
    assert res_busca["data"][0].paciente_nome == "Ana Paula Mendes"

    # 5. Busca por CPF
    res_cpf = listar_fila(q="11122233344", db=db_session, _=None)
    assert res_cpf["total"] == 1
    assert res_cpf["data"][0].paciente_nome == "Carlos Eduardo Silva"

