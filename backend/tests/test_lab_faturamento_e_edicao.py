import pytest
from datetime import date
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import (
    ItemSolic,
    LabContrato,
    LabContratoPrecoCustomizado,
    Laboratorio,
    SolicitacaoMestre,
    VagaLab,
)
from app.models.tfd import Paciente
from app.models.user import User
from app.services.lab_fase6 import (
    criar_solicitacao_mestre,
    editar_pedido_exames,
    remover_item_solicitacao,
)
from app.services.lab_faturamento_service import (
    apurar_faturamento_competencia,
    obter_relatorio_prestador,
)


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:", echo=False)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        # Usuário analista
        u = User(
            username="admin",
            nome="Administrador",
            password_hash="hash",
            is_active=True,
            is_superuser=True,
        )
        s.add(u)

        # Paciente
        pac = Paciente(
            nome="MARIA APARECIDA DA SILVA",
            cpf="111.222.333-44",
            cns="700000000000001",
            data_nascimento=date(1980, 5, 10),
            sexo="F",
        )
        s.add(pac)

        # Laboratório
        lab = Laboratorio(nome="Laboratório Central de Guapé", ativo=True)
        s.add(lab)
        s.commit()
        s.refresh(pac)
        s.refresh(lab)

        # Procedimentos SIGTAP
        p1 = SigtapProcedimento(
            codigo="0202010473",
            descricao="HEMOGRAMA COMPLETO",
            complexidade="MC",
            instrumento="BPA-C",
            valor_sa=4.11,
            valor_sp=0.0,
            competencia="2026-11",
        )
        p2 = SigtapProcedimento(
            codigo="0202010295",
            descricao="GLICOSE",
            complexidade="MC",
            instrumento="BPA-C",
            valor_sa=1.85,
            valor_sp=0.0,
            competencia="2026-11",
        )
        p3 = SigtapProcedimento(
            codigo="0202050017",
            descricao="SUMARIO DE URINA (URINA I)",
            complexidade="MC",
            instrumento="BPA-C",
            valor_sa=3.70,
            valor_sp=0.0,
            competencia="2026-11",
        )
        s.add_all([p1, p2, p3])

        # Vagas para o dia
        dt_exame = date(2026, 11, 25)
        vaga = VagaLab(
            laboratorio_id=lab.id,
            data=dt_exame,
            vagas_totais=20,
            vagas_ocupadas=0,
        )
        s.add(vaga)

        # Contrato ativo com preço customizado para o hemograma
        contrato = LabContrato(
            laboratorio_id=lab.id,
            numero_contrato="CT-2026/001",
            status="ativo",
            data_inicio=date(2026, 1, 1),
            data_fim=date(2026, 12, 31),
            valor_teto_mensal=50000.0,
        )
        s.add(contrato)
        s.commit()
        s.refresh(contrato)

        # Preço customizado do hemograma no contrato: R$ 8.50 (SUS é 4.11)
        preco_custom = LabContratoPrecoCustomizado(
            contrato_id=contrato.id,
            sigtap_id=p1.id,
            codigo_sigtap=p1.codigo,
            valor_customizado=8.50,
            vigencia_inicio=date(2026, 1, 1),
            ativo=True,
            justificativa="Pactuação Municipal",
        )
        s.add(preco_custom)
        s.commit()

        yield s


def test_remover_exame_com_justificativa_laboratorio(session: Session):
    pac = session.exec(select(Paciente)).first()
    lab = session.exec(select(Laboratorio)).first()
    procs = session.exec(select(SigtapProcedimento)).all()
    dt = date(2026, 11, 25)

    # Cria pedido com 3 exames: Hemograma, Glicose e Urina I
    mestre = criar_solicitacao_mestre(
        session,
        paciente_id=pac.id,
        data_agendada=dt,
        laboratorio_id=lab.id,
        sigtap_ids=[p.id for p in procs],
        justificativa="Controle semestral de rotina",
    )

    itens_antes = session.exec(
        select(ItemSolic).where(ItemSolic.solicitacao_id == mestre.id)
    ).all()
    assert len(itens_antes) == 3

    # Localiza o item de Urina I
    item_urina = next(it for it in itens_antes if it.sigtap_id == procs[2].id)

    # Laboratório remove exame porque paciente não colheu/trouxe urina
    res = remover_item_solicitacao(
        session,
        solicitacao_id=mestre.id,
        item_id=item_urina.id,
        justificativa="Paciente não trouxe frasco com amostra de urina no momento da coleta",
        usuario_nome="Recepção Lab Central",
    )

    # Confere se o item foi retirado do pedido
    itens_depois = session.exec(
        select(ItemSolic).where(ItemSolic.solicitacao_id == mestre.id)
    ).all()
    assert len(itens_depois) == 2
    assert all(it.sigtap_id != procs[2].id for it in itens_depois)

    # Confere se a justificativa foi registrada nas observações do pedido
    mestre_db = session.get(SolicitacaoMestre, mestre.id)
    assert "Paciente não trouxe frasco com amostra" in mestre_db.observacao_laboratorio


def test_editar_pedido_exames_adicionar_e_remover(session: Session):
    pac = session.exec(select(Paciente)).first()
    lab = session.exec(select(Laboratorio)).first()
    p_hemo, p_glico, p_urina = session.exec(select(SigtapProcedimento)).all()
    dt = date(2026, 11, 25)

    # Pedido original com apenas Hemograma
    mestre = criar_solicitacao_mestre(
        session,
        paciente_id=pac.id,
        data_agendada=dt,
        laboratorio_id=lab.id,
        sigtap_ids=[p_hemo.id],
        justificativa="Investigação de fadiga e anemia",
    )

    itens = session.exec(select(ItemSolic).where(ItemSolic.solicitacao_id == mestre.id)).all()
    assert len(itens) == 1

    # Operador edita pedido para trocar Hemograma por Glicose e Urina I
    editar_pedido_exames(
        session,
        solicitacao_id=mestre.id,
        itens_novos={p_glico.id: 1, p_urina.id: 2},
        justificativa="Ajuste conforme novo pedido médico apresentado",
        usuario_nome="Operador Central",
    )

    itens_editados = session.exec(
        select(ItemSolic).where(ItemSolic.solicitacao_id == mestre.id)
    ).all()
    assert len(itens_editados) == 2
    sigtap_ids_editados = {it.sigtap_id for it in itens_editados}
    assert p_glico.id in sigtap_ids_editados
    assert p_urina.id in sigtap_ids_editados
    assert p_hemo.id not in sigtap_ids_editados


def test_faturamento_dois_valores_e_somente_concluidos_com_pdf(session: Session):
    pac = session.exec(select(Paciente)).first()
    lab = session.exec(select(Laboratorio)).first()
    p_hemo, p_glico, _ = session.exec(select(SigtapProcedimento)).all()
    dt = date(2026, 11, 25)

    # 1. Pedido 1: agendado mas AINDA NÃO RECEPCIONADO/SEM PDF
    solic_pendente = criar_solicitacao_mestre(
        session,
        paciente_id=pac.id,
        data_agendada=dt,
        laboratorio_id=lab.id,
        sigtap_ids=[p_glico.id],
        justificativa="Glicemia de jejum anual",
    )

    # 2. Pedido 2: RECEPCIONADO E CONCLUÍDO COM LAUDO PDF
    solic_concluida = criar_solicitacao_mestre(
        session,
        paciente_id=pac.id,
        data_agendada=dt,
        laboratorio_id=lab.id,
        sigtap_ids=[p_hemo.id],  # Preço Contrato: 8.50 | Preço SUS: 4.11
        justificativa="Hemograma completo pré-operatório",
    )
    solic_concluida.status = "realizado"
    solic_concluida.laudo_arquivo_id = 999  # PDF anexado
    session.add(solic_concluida)
    session.commit()

    # Relatório Oficial (Visão: concluidos)
    rel_concluidos = obter_relatorio_prestador(
        session,
        laboratorio_id=lab.id,
        competencia="2026-11",
        visao="concluidos",
    )

    # O faturamento final deve incluir APENAS a solicitação com PDF (Hemograma)
    assert rel_concluidos.total_solicitacoes == 1
    assert rel_concluidos.qtd_exames_total == 1
    # Verifica os DOIS VALORES (Contrato e SUS) no relatório oficial
    assert rel_concluidos.valor_total_contrato == 8.50
    assert rel_concluidos.valor_total_sigtap == 4.11

    # Confere os itens agrupados exibindo ambos os valores
    it = rel_concluidos.itens_agrupados[0]
    assert it.codigo_procedimento == "0202010473"
    assert it.valor_unitario_contrato == 8.50
    assert it.valor_unitario_sigtap == 4.11

    # Visão Projetada (Visão: projetado)
    rel_projetado = obter_relatorio_prestador(
        session,
        laboratorio_id=lab.id,
        competencia="2026-11",
        visao="projetado",
    )
    # Inclui ambos os pedidos agendados (Hemograma 8.50 + Glicemia 1.85 = 10.35)
    assert rel_projetado.total_solicitacoes == 2
    assert rel_projetado.qtd_exames_total == 2
    assert rel_projetado.valor_total_contrato == 10.35
    assert rel_projetado.valor_total_sigtap == round(4.11 + 1.85, 2)
    assert rel_projetado.qtd_exames_concluidos == 1
    assert rel_projetado.qtd_exames_pendentes == 1
