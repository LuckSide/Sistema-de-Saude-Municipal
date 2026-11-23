import os
from datetime import date, datetime
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

# Configuração de engine SQLite em memória para testes isolados
engine_test = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

from app.models.lab_exames import LabSolicitacao, SigtapProcedimento
from app.models.lab_fase6 import (
    FilaPsf,
    ItemSolic,
    LabContrato,
    LabFechamentoFaturamento,
    Laboratorio,
    LabOrcamentoMensal,
    SolicitacaoMestre,
    VagaLab,
)
from app.models.tfd import (
    Destino,
    Faturamento,
    Paciente,
    ProcedimentoCatalogo,
    Veiculo,
    Viagem,
    ViagemPaciente,
)
from app.schemas.lab_fase6 import LabLotePreviaIn
from app.services.lab import lote_bpa, prontos_faturar
from app.services.lab_bi_service import listar_ranking_gastos_pacientes, obter_gastos_paciente
from app.services.lab_contratos_service import calcular_metricas_contrato
from app.services.lab_faturamento_service import (
    apurar_faturamento_competencia,
    obter_relatorio_prestador,
)
from app.services.lab_lote_service import calcular_previa_lote
from app.services.tfd import resumo_tfd
from app.services.validacoes import valida_cns, valida_cpf


def setup_db():
    SQLModel.metadata.drop_all(engine_test)
    SQLModel.metadata.create_all(engine_test)


def test_criacao_e_validacao_paciente_testes():
    setup_db()
    with Session(engine_test) as db:
        # 1. Validações de CPF e CNS do paciente de testes
        cpf_teste = "00000000000"
        cns_teste = "999999999999999"
        ok_cpf, msg_cpf = valida_cpf(cpf_teste)
        assert ok_cpf is True, f"CPF de testes deve ser válido: {msg_cpf}"
        ok_cns, msg_cns = valida_cns(cns_teste)
        assert ok_cns is True, f"CNS de testes deve ser válido: {msg_cns}"

        # 2. Criação do paciente padrão
        pac = Paciente(
            nome="Testes",
            cpf=cpf_teste,
            cns=cns_teste,
            codigo_prontuario="TESTE",
            eh_teste=True,
            situacao_cadastral="ativo",
            municipio="Guapé",
        )
        db.add(pac)
        db.commit()
        db.refresh(pac)

        assert pac.id is not None
        assert pac.eh_teste is True
        assert pac.nome == "Testes"
        assert pac.codigo_prontuario == "TESTE"

        # Consulta no banco
        buscado = db.exec(select(Paciente).where(Paciente.eh_teste == True)).first()
        assert buscado is not None
        assert buscado.id == pac.id


def test_operacoes_fila_psf_e_solicitacao_mestre_com_paciente_teste():
    """Garante que o paciente de testes funciona 100% operacionalmente nas filas e pedidos."""
    setup_db()
    with Session(engine_test) as db:
        pac = Paciente(
            nome="Testes",
            cpf="00000000000",
            cns="999999999999999",
            codigo_prontuario="TESTE",
            eh_teste=True,
            situacao_cadastral="ativo",
        )
        db.add(pac)

        lab = Laboratorio(nome="Laboratório de Teste", ativo=True)
        db.add(lab)

        proc = SigtapProcedimento(
            codigo="0202010183",
            descricao="HEMOGRAMA COMPLETO",
            valor_sa=4.11,
            competencia="2026-11",
        )
        db.add(proc)
        db.commit()

        # 1. Pode lançar pedido na Fila PSF
        fila_item = FilaPsf(
            codigo_solicitacao="PSF-TESTE-01",
            paciente_id=pac.id,
            especialidade="Clínica Geral",
            unidade_psf="PSF Central",
            medico_solicitante="Dr. Médico Teste",
            data_solicitacao=date(2026, 11, 10),
            prioridade="rotina",
            sigtap_ids_json=f"[{proc.id}]",
            status="na_fila",
        )
        db.add(fila_item)
        db.commit()
        db.refresh(fila_item)
        assert fila_item.id is not None
        assert fila_item.paciente_id == pac.id

        # 2. Pode agendar e criar SolicitacaoMestre + ItemSolic
        mestre = SolicitacaoMestre(
            codigo_solicitacao="LAB-TESTE-001",
            paciente_id=pac.id,
            laboratorio_id=lab.id,
            data_agendada=date(2026, 11, 15),
            status="agendado",
            origem_fila_id=fila_item.id,
        )
        db.add(mestre)
        db.commit()
        db.refresh(mestre)
        assert mestre.id is not None

        item = ItemSolic(
            solicitacao_id=mestre.id,
            sigtap_id=proc.id,
            quantidade=1,
            valor_unitario_aplicado=4.11,
            origem_preco="sigtap_padrao",
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        assert item.id is not None
        assert item.solicitacao_id == mestre.id


def test_isolamento_financeiro_lab_faturamento():
    """Garante que pedidos do paciente de teste NÃO entrem no total a pagar nem no rateio financeiro."""
    setup_db()
    with Session(engine_test) as db:
        # Cria laboratório e contrato
        lab = Laboratorio(nome="Laboratório Credenciado Guapé", ativo=True)
        db.add(lab)
        db.commit()
        db.refresh(lab)

        contrato = LabContrato(
            laboratorio_id=lab.id,
            numero_contrato="01/2026",
            data_inicio=date(2026, 1, 1),
            data_fim=date(2026, 12, 31),
            valor_total_contrato=100000.0,
            valor_mensal_teto=10000.0,
            status="ativo",
        )
        db.add(contrato)

        proc = SigtapProcedimento(
            codigo="0202010183",
            descricao="HEMOGRAMA COMPLETO",
            valor_sa=10.0,
            competencia="2026-11",
        )
        db.add(proc)

        # Paciente REAL (deve ser faturado)
        pac_real = Paciente(
            nome="Cidadão Real Guapé",
            cpf="11122233344",
            cns="898000000000001",
            eh_teste=False,
            situacao_cadastral="ativo",
        )
        db.add(pac_real)

        # Paciente TESTE (deve ser 100% isolado de faturamento e custos)
        pac_teste = Paciente(
            nome="Testes",
            cpf="00000000000",
            cns="999999999999999",
            codigo_prontuario="TESTE",
            eh_teste=True,
            situacao_cadastral="ativo",
        )
        db.add(pac_teste)
        db.commit()

        # Cria 1 solicitação de R$ 50 para o paciente real
        mestre_real = SolicitacaoMestre(
            codigo_solicitacao="SOLIC-REAL",
            paciente_id=pac_real.id,
            laboratorio_id=lab.id,
            data_agendada=date(2026, 11, 10),
            status="realizado",
        )
        db.add(mestre_real)
        db.commit()
        db.refresh(mestre_real)

        db.add(
            ItemSolic(
                solicitacao_id=mestre_real.id,
                sigtap_id=proc.id,
                quantidade=5,
                valor_unitario_aplicado=10.0,
                origem_preco="sigtap_padrao",
                status_auditoria="aprovado",
            )
        )

        # Cria 1 solicitação de R$ 1.000 para o paciente de teste
        mestre_teste = SolicitacaoMestre(
            codigo_solicitacao="SOLIC-TESTE",
            paciente_id=pac_teste.id,
            laboratorio_id=lab.id,
            data_agendada=date(2026, 11, 12),
            status="realizado",
        )
        db.add(mestre_teste)
        db.commit()
        db.refresh(mestre_teste)

        db.add(
            ItemSolic(
                solicitacao_id=mestre_teste.id,
                sigtap_id=proc.id,
                quantidade=100,
                valor_unitario_aplicado=10.0,
                origem_preco="sigtap_padrao",
                status_auditoria="aprovado",
            )
        )
        db.commit()

        # 1. Apuração da competência 2026-11
        fechamento = apurar_faturamento_competencia(db, lab.id, "2026-11")

        # Deve conter APENAS a solicitação real (1 solicitação, 5 exames, R$ 50.00)
        assert fechamento.qtd_solicitacoes == 1, f"Esperado 1 solicitação real, obtido {fechamento.qtd_solicitacoes}"
        assert fechamento.qtd_exames == 5, f"Esperado 5 exames reais, obtido {fechamento.qtd_exames}"
        assert fechamento.valor_total_apurado == 50.0, f"Esperado R$ 50.00, obtido {fechamento.valor_total_apurado}"
        assert fechamento.valor_total_aprovado == 50.0

        # 2. Relatório de faturamento do prestador
        relatorio = obter_relatorio_prestador(db, lab.id, "2026-11", eh_perfil_laboratorio=False)
        assert relatorio.valor_total_bruto == 50.0
        assert relatorio.qtd_solicitacoes == 1
        assert len(relatorio.itens) == 1
        assert relatorio.itens[0].quantidade == 5
        assert relatorio.itens[0].valor_total == 50.0


def test_isolamento_consumo_teto_contratos():
    """Garante que calcular_metricas_contrato não contabiliza itens do paciente de teste."""
    setup_db()
    with Session(engine_test) as db:
        lab = Laboratorio(nome="Laboratório Contrato Teste", ativo=True)
        db.add(lab)
        db.commit()

        hoje = date.today()
        contrato = LabContrato(
            laboratorio_id=lab.id,
            numero_contrato="10/2026",
            data_inicio=date(hoje.year, 1, 1),
            data_fim=date(hoje.year, 12, 31),
            valor_total_contrato=50000.0,
            valor_mensal_teto=5000.0,
            status="ativo",
        )
        db.add(contrato)

        proc = SigtapProcedimento(
            codigo="0202010183",
            descricao="HEMOGRAMA COMPLETO",
            valor_sa=100.0,
            competencia="2026-11",
        )
        db.add(proc)

        pac_real = Paciente(nome="Paciente Real", cpf="11122233344", eh_teste=False)
        pac_teste = Paciente(nome="Testes", cpf="00000000000", eh_teste=True)
        db.add(pac_real)
        db.add(pac_teste)
        db.commit()

        # Solicitação real de R$ 200 no mês corrente
        s_real = SolicitacaoMestre(
            codigo_solicitacao="SR1",
            paciente_id=pac_real.id,
            laboratorio_id=lab.id,
            data_agendada=hoje,
            status="agendado",
        )
        db.add(s_real)
        db.commit()
        db.add(ItemSolic(solicitacao_id=s_real.id, sigtap_id=proc.id, quantidade=2, valor_unitario_aplicado=100.0))

        # Solicitação de TESTE de R$ 9.000 (que estouraria o teto se contada!)
        s_teste = SolicitacaoMestre(
            codigo_solicitacao="ST1",
            paciente_id=pac_teste.id,
            laboratorio_id=lab.id,
            data_agendada=hoje,
            status="agendado",
        )
        db.add(s_teste)
        db.commit()
        db.add(ItemSolic(solicitacao_id=s_teste.id, sigtap_id=proc.id, quantidade=90, valor_unitario_aplicado=100.0))
        db.commit()

        # Calcula métricas
        metricas = calcular_metricas_contrato(db, contrato)

        # O consumo deve ser APENAS os R$ 200 do paciente real
        assert metricas.valor_gasto_mes_atual == 200.0, f"Gasto mês esperado 200.0, obtido {metricas.valor_gasto_mes_atual}"
        assert metricas.valor_total_gasto == 200.0
        assert metricas.saldo_mes_atual == 4800.0  # 5000 - 200


def test_isolamento_bi_e_ranking_gastos():
    """Garante que o paciente de teste não aparece no ranking de gastos e tem total_gasto zerado."""
    setup_db()
    with Session(engine_test) as db:
        lab = Laboratorio(nome="Laboratório Municipal", ativo=True)
        db.add(lab)

        proc = SigtapProcedimento(
            codigo="0202010183",
            descricao="HEMOGRAMA",
            valor_sa=5.0,
            competencia="2026-11",
        )
        db.add(proc)

        pac_real = Paciente(nome="Maria Silva", cpf="12345678901", eh_teste=False)
        pac_teste = Paciente(nome="Testes", cpf="00000000000", eh_teste=True)
        db.add(pac_real)
        db.add(pac_teste)
        db.commit()

        # Gasto real de R$ 50
        s_real = SolicitacaoMestre(paciente_id=pac_real.id, laboratorio_id=lab.id, data_agendada=date(2026, 11, 5), status="realizado")
        db.add(s_real)
        db.commit()
        db.add(ItemSolic(solicitacao_id=s_real.id, sigtap_id=proc.id, quantidade=10, valor_unitario_aplicado=5.0))

        # Gasto teste de R$ 50.000
        s_teste = SolicitacaoMestre(paciente_id=pac_teste.id, laboratorio_id=lab.id, data_agendada=date(2026, 11, 5), status="realizado")
        db.add(s_teste)
        db.commit()
        db.add(ItemSolic(solicitacao_id=s_teste.id, sigtap_id=proc.id, quantidade=10000, valor_unitario_aplicado=5.0))
        db.commit()

        # 1. Ranking de gastos
        ranking = listar_ranking_gastos_pacientes(db)
        nomes_ranking = [r.paciente_nome for r in ranking]
        assert "Maria Silva" in nomes_ranking
        assert "Testes" not in nomes_ranking, "Paciente de testes NÃO deve constar no ranking de gastos públicos de BI!"

        # 2. Gastos individuais do paciente de testes
        bi_teste = obter_gastos_paciente(db, pac_teste.id)
        assert bi_teste.total_gasto == 0.0, f"Paciente de testes deve ter total_gasto zerado, obtido {bi_teste.total_gasto}"


def test_isolamento_lab_lote_service():
    """Garante que a prévia de lote ignora itens da fila PSF pertencentes ao paciente de teste."""
    from datetime import timedelta
    setup_db()
    with Session(engine_test) as db:
        dt_futura = date.today() + timedelta(days=2)
        comp = dt_futura.strftime("%Y-%m")

        lab = Laboratorio(nome="Laboratório Central", ativo=True)
        db.add(lab)
        db.commit()

        # Vaga lab
        db.add(VagaLab(laboratorio_id=lab.id, data=dt_futura, vagas_totais=20, vagas_ocupadas=0))

        proc = SigtapProcedimento(codigo="0202010183", descricao="HEMOGRAMA", valor_sa=20.0, competencia=comp)
        db.add(proc)

        pac_real = Paciente(nome="Carlos Souza", cpf="22233344455", eh_teste=False)
        pac_teste = Paciente(nome="Testes", cpf="00000000000", eh_teste=True)
        db.add(pac_real)
        db.add(pac_teste)
        db.commit()

        # Fila PSF para paciente real
        db.add(
            FilaPsf(
                codigo_solicitacao="F-REAL",
                paciente_id=pac_real.id,
                data_solicitacao=dt_futura - timedelta(days=5),
                sigtap_ids_json=f"[{proc.id}]",
                status="na_fila",
            )
        )

        # Fila PSF para paciente de testes
        db.add(
            FilaPsf(
                codigo_solicitacao="F-TESTE",
                paciente_id=pac_teste.id,
                data_solicitacao=dt_futura - timedelta(days=5),
                sigtap_ids_json=f"[{proc.id}]",
                status="na_fila",
            )
        )
        db.commit()

        # Prévia do lote
        dados_previa = LabLotePreviaIn(
            laboratorio_id=lab.id,
            competencia=comp,
            valor_limite=5000.0,
            datas_agendamento=[dt_futura],
        )
        previa = calcular_previa_lote(db, dados_previa)

        # Deve conter apenas o paciente real
        pacs_selecionados = [p.paciente_nome for p in previa.pacientes]
        assert "Carlos Souza" in pacs_selecionados
        assert "Testes" not in pacs_selecionados


def test_isolamento_tfd_faturamento_e_deslocamento():
    """Garante que faturar_deslocamento e resumo_tfd não somam custos do paciente de teste."""
    setup_db()
    with Session(engine_test) as db:
        veic = Veiculo(placa="ABC-1234", modelo="Van SUS", capacidade=15, tipo="Van", status="ativo", ativo=True)
        db.add(veic)
        dest = Destino(
            nome_destino="Alfenas",
            codigo_desloc_pac="0803010041",
            qtd_desloc_pac=2,
            codigo_desloc_acomp="0803010050",
            qtd_desloc_acomp=2,
        )
        db.add(dest)
        proc_cat = ProcedimentoCatalogo(codigo="0803010041", nome="DESLOCAMENTO ALFENAS", tipo="TFD")
        db.add(proc_cat)

        pac_real = Paciente(nome="Paciente Viagem", cpf="33344455566", eh_teste=False)
        pac_teste = Paciente(nome="Testes", cpf="00000000000", eh_teste=True)
        db.add(pac_real)
        db.add(pac_teste)
        db.commit()

        viagem = Viagem(
            data_viagem=date(2026, 11, 25),
            destino="Alfenas",
            veiculo_id=veic.id,
            status="concluida",
        )
        db.add(viagem)
        db.commit()
        db.refresh(viagem)

        # Passageiros: 1 real e 1 de testes
        db.add(ViagemPaciente(viagem_id=viagem.id, paciente_id=pac_real.id))
        db.add(ViagemPaciente(viagem_id=viagem.id, paciente_id=pac_teste.id))
        db.commit()

        # Faturar deslocamento
        from unittest.mock import MagicMock
        from app.api.v1.tfd import faturar_deslocamento

        mock_user = MagicMock()
        mock_user.id = 1
        mock_user.nome = "Auditor SUS"
        mock_user.username = "auditor"

        res = faturar_deslocamento(vid=viagem.id, db=db, ator=mock_user)
        # Deve criar faturamento apenas para o paciente real (1 registro de deslocamento)
        assert res["criados"] == 1

        faturas = db.exec(select(Faturamento).where(Faturamento.viagem_id == viagem.id)).all()
        assert len(faturas) == 1
        assert faturas[0].paciente_id == pac_real.id

        # Verifica resumo_tfd
        resumo = resumo_tfd(db, "2026-11")
        assert isinstance(resumo["valor_competencia"], float)


def test_isolamento_lab_bpa_e_bloqueio_exclusao():
    """Valida isolamento no BPA laboratorial e proteção contra exclusão do paciente 'Testes'."""
    from fastapi import HTTPException
    from app.api.v1.tfd import excluir_paciente

    setup_db()
    with Session(engine_test) as db:
        proc = SigtapProcedimento(
            codigo="0202010183",
            descricao="HEMOGRAMA",
            instrumento="BPA-C",
            valor_sa=4.11,
            competencia="2026-11",
        )
        db.add(proc)

        pac_real = Paciente(nome="Paciente Real BPA", cpf="44455566677", eh_teste=False)
        pac_teste = Paciente(nome="Testes", cpf="00000000000", eh_teste=True)
        db.add(pac_real)
        db.add(pac_teste)
        db.commit()

        # Solicitacao lab para paciente real
        db.add(
            LabSolicitacao(
                paciente_id=pac_real.id,
                sigtap_id=proc.id,
                data_solicitacao=date(2026, 11, 10),
                competencia="2026-11",
                status="Realizado",
                faturado=False,
            )
        )

        # Solicitacao lab para paciente de testes
        db.add(
            LabSolicitacao(
                paciente_id=pac_teste.id,
                sigtap_id=proc.id,
                data_solicitacao=date(2026, 11, 10),
                competencia="2026-11",
                status="Realizado",
                faturado=False,
            )
        )
        db.commit()

        # 1. Prontos para faturar
        prontos = prontos_faturar(db, "2026-11")
        assert len(prontos) == 1
        assert prontos[0].paciente_id == pac_real.id

        # 2. Lote BPA
        bpa_itens = lote_bpa(db, "2026-11")
        assert len(bpa_itens) == 1
        assert bpa_itens[0]["qtd"] == 1  # Apenas o paciente real

        # 3. Tentativa de excluir o paciente padrão "Testes" deve ser bloqueada
        try:
            excluir_paciente(pac_teste.id, db=db)
            assert False, "Deveria ter lançado HTTPException ao tentar excluir paciente de testes"
        except HTTPException as exc:
            assert exc.status_code == 400
            assert "não pode ser excluído" in exc.detail
