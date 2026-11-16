import os
import sys
from datetime import date, datetime, timedelta

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

# Configuração de engine SQLite em memória para testes isolados
engine_test = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

from app.api.v1.auth import get_current_user
from app.core.deps import get_db
from app.main import app
from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import (
    FilaPsf,
    ItemSolic,
    LabContrato,
    LabContratoPrecoCustomizado,
    LabFechamentoFaturamento,
    LabFeriadoBloqueio,
    LabFPOCompetencia,
    LabFPOItem,
    Laboratorio,
    SolicitacaoMestre,
    VagaLab,
)
from app.models.tfd import Paciente
from app.models.user import User


def override_get_db():
    with Session(engine_test) as session:
        yield session


usuario_teste = User(
    id=1,
    username="admin_teste",
    nome="Administrador Teste",
    is_superuser=True,
    telas="lab_orcamento,lab_marcacao,lab,usuarios,lab_vagas,lab_agenda,cfg_laboratorios",
    acoes="{}",
)

usuario_lab = User(
    id=2,
    username="lab_prestador",
    nome="Operador Prestador",
    is_superuser=False,
    laboratorio_id=1,
    telas="lab_recepcao,lab_portal,lab",
    acoes="{}",
)


def override_get_current_user():
    return usuario_teste


app.dependency_overrides[get_db] = override_get_db
app.dependency_overrides[get_current_user] = override_get_current_user

client = TestClient(app)


def test_suite_completa_lab_novas_funcionalidades():
    SQLModel.metadata.create_all(engine_test)

    with Session(engine_test) as db:
        # Cria laboratório
        lab = Laboratorio(
            id=1,
            nome="Laboratório Central de Guapé",
            ativo=True,
            responsavel_tecnico="Dr. Silva",
            horario_funcionamento="07:00 às 17:00",
        )
        db.add(lab)

        # Cria procedimentos SIGTAP
        p1 = SigtapProcedimento(
            id=1,
            codigo="0202010183",
            descricao="HEMOGRAMA COMPLETO",
            valor_sa=4.11,
            competencia="2026-11",
        )
        p2 = SigtapProcedimento(
            id=2,
            codigo="0202010310",
            descricao="DOSAGEM DE GLICOSE",
            valor_sa=1.85,
            competencia="2026-11",
        )
        db.add(p1)
        db.add(p2)

        # Cria paciente
        pac = Paciente(
            id=1,
            nome="João da Silva Guapé",
            cpf="11122233344",
            cns="898000000000001",
        )
        db.add(pac)
        db.commit()

    # 1. TESTE SUBAGENTE 2: Criar Laboratório via API com auto-criação de usuário
    res_lab = client.post(
        "/api/exames/laboratorios",
        json={
            "nome": "Laboratório São Lucas",
            "ativo": True,
            "responsavel_tecnico": "Dra. Paula",
            "horario_funcionamento": "06:30 às 16:00",
            "criar_usuario_acesso": True,
        },
    )
    assert res_lab.status_code == 201
    lab_criado = res_lab.json()
    assert lab_criado["id"] > 0
    assert lab_criado["responsavel_tecnico"] == "Dra. Paula"
    assert lab_criado["usuario_criado"] is not None
    assert lab_criado["senha_temporaria"] is not None

    # 2. TESTE SUBAGENTE 1: Feriados e Bloqueios na Agenda
    hoje = date.today()
    dia_feriado = hoje + timedelta(days=5)
    res_fer = client.post(
        "/api/exames/feriados",
        json={
            "data": dia_feriado.isoformat(),
            "descricao": "Feriado Municipal de Guapé",
            "bloquear_agendamento": True,
            "laboratorio_id": 1,
        },
    )
    assert res_fer.status_code == 201
    fer_data = res_fer.json()
    assert fer_data["id"] > 0

    # Tenta criar vaga no dia do feriado (deve bloquear com 400)
    res_vaga_bloq = client.post(
        "/api/vagas",
        json={
            "laboratorio_id": 1,
            "data": dia_feriado.isoformat(),
            "vagas_totais": 20,
            "tipo_servico": "rotina",
        },
    )
    assert res_vaga_bloq.status_code == 400
    assert "bloqueada" in res_vaga_bloq.json()["detail"]

    # Cria vaga em dia permitido
    dia_util = hoje + timedelta(days=2)
    res_vaga_ok = client.post(
        "/api/vagas",
        json={
            "laboratorio_id": 1,
            "data": dia_util.isoformat(),
            "vagas_totais": 10,
            "tipo_servico": "labcon",
        },
    )
    assert res_vaga_ok.status_code == 201
    assert res_vaga_ok.json()["tipo_servico"] == "labcon"

    # 3. TESTE SUBAGENTE 3: Contratos & Preços Customizados
    res_contrato = client.post(
        "/api/lab/contratos",
        json={
            "laboratorio_id": 1,
            "numero_contrato": "042/2026",
            "processo_licitatorio": "Pregão 015/2026",
            "objeto": "Prestação de serviços laboratoriais",
            "data_inicio": "2026-01-01",
            "data_fim": "2026-12-31",
            "valor_total_contrato": 120000.0,
            "valor_mensal_teto": 10000.0,
            "cota_exames_mensal": 1500,
            "gestor_contrato": "Secretário de Saúde",
        },
    )
    assert res_contrato.status_code == 201
    contrato_id = res_contrato.json()["id"]

    # Cadastra preço customizado para o procedimento 1 (R$ 8.50 em vez de 4.11 do SIGTAP)
    res_preco = client.post(
        f"/api/lab/contratos/{contrato_id}/precos",
        json={
            "contrato_id": contrato_id,
            "sigtap_id": 1,
            "valor_customizado": 8.50,
            "vigencia_inicio": "2026-01-01",
            "justificativa": "Acordo com tabela conveniada",
        },
    )
    assert res_preco.status_code == 201
    assert res_preco.json()["valor_customizado"] == 8.50

    # Verifica resolução de preço
    with Session(engine_test) as db:
        from app.services.lab_contratos_service import resolver_preco_procedimento
        preco_p1, orig_p1 = resolver_preco_procedimento(db, 1, laboratorio_id=1)
        assert preco_p1 == 8.50
        assert orig_p1 == "contrato_custom"

        preco_p2, orig_p2 = resolver_preco_procedimento(db, 2, laboratorio_id=1)
        assert preco_p2 == 1.85
        assert orig_p2 == "sigtap_padrao"

    # 4. Painel de Contratos
    res_painel = client.get("/api/lab/contratos")
    assert res_painel.status_code == 200
    painel_data = res_painel.json()
    assert painel_data["valor_total_todos_contratos"] == 120000.0
    assert len(painel_data["contratos"]) >= 1

    # 5. Agendamento e Manejo (Transferência / Status)
    with Session(engine_test) as db:
        mestre = SolicitacaoMestre(
            paciente_id=1,
            laboratorio_id=1,
            contrato_id=contrato_id,
            data_agendada=dia_util,
            status="agendado",
            agendado_por="admin_teste",
        )
        db.add(mestre)
        db.commit()
        db.refresh(mestre)
        mestre_id = mestre.id

        # Item associado
        it = ItemSolic(
            solicitacao_id=mestre_id,
            sigtap_id=1,
            contrato_id=contrato_id,
            valor_unitario_aplicado=8.50,
            origem_preco="contrato_custom",
        )
        db.add(it)
        db.commit()

    # Altera status para desativado
    res_status = client.patch(
        f"/api/exames/solicitacoes/{mestre_id}/status",
        json={"status": "desativado", "motivo": "Paciente solicitou adiamento"},
    )
    assert res_status.status_code == 200
    assert res_status.json()["status"] == "desativado"

    # Reativa e transfere para outra data
    dia_transferencia = hoje + timedelta(days=3)
    res_transf = client.patch(
        f"/api/exames/solicitacoes/{mestre_id}/transferir",
        json={"nova_data": dia_transferencia.isoformat(), "motivo": "Reagendamento solicitado"},
    )
    assert res_transf.status_code == 200
    assert res_transf.json()["data_agendada"] == dia_transferencia.isoformat()
    assert res_transf.json()["status"] == "agendado"

    # 6. FPO (Ficha de Programação Orçamentária) e Exportação SIA
    comp = f"{hoje.year:04d}-{hoje.month:02d}"
    res_fpo = client.post(
        "/api/lab/fpo/competencias",
        json={
            "laboratorio_id": 1,
            "contrato_id": contrato_id,
            "competencia": comp,
            "cnes_prestador": "1234567",
            "numero_fpo": "FPO-001/2026",
            "teto_fisico_programado": 100,
            "teto_financeiro_programado": 5000.0,
        },
    )
    assert res_fpo.status_code == 201
    fpo_id = res_fpo.json()["id"]

    res_fpo_item = client.post(
        f"/api/lab/fpo/itens?fpo_id={fpo_id}",
        json={
            "sigtap_id": 1,
            "quantidade_orcada": 50,
            "valor_orcado": 425.0,
        },
    )
    assert res_fpo_item.status_code == 201

    res_fpo_sia = client.get(f"/api/lab/fpo/exportar-sia/{fpo_id}")
    assert res_fpo_sia.status_code == 200
    assert "FPO-SIA-SUS" in res_fpo_sia.text

    # 7. Relatório de Faturamento por Prestador & Aprovação da Secretaria
    # Primeiro: como gestor/secretaria, gera apuração
    res_fat = client.get(f"/api/lab/faturamento/relatorio-prestador?laboratorio_id=1&competencia={comp}")
    assert res_fat.status_code == 200
    fat_data = res_fat.json()
    assert fat_data["competencia"] == comp
    assert fat_data["total_exames"] >= 1
    assert fat_data["valor_total"] >= 8.50

    # Aprova o faturamento pela Secretaria
    res_aprov = client.post(
        "/api/lab/faturamento/aprovar",
        json={
            "laboratorio_id": 1,
            "competencia": comp,
            "liberado_visualizacao_lab": True,
            "parecer_secretaria": "Produção conferida e aprovada sem glosas.",
        },
    )
    assert res_aprov.status_code == 200
    assert res_aprov.json()["status"] == "aprovado_secretaria"

    # 8. SUBAGENTE 4: BI de Gastos do Paciente
    res_bi_pac = client.get("/api/lab/bi/pacientes/1/gastos")
    assert res_bi_pac.status_code == 200
    bi_data = res_bi_pac.json()
    assert bi_data["paciente_id"] == 1
    assert bi_data["total_gasto"] >= 8.50
    assert len(bi_data["itens"]) >= 1

    res_bi_rank = client.get("/api/lab/bi/gastos-pacientes")
    assert res_bi_rank.status_code == 200
    assert len(res_bi_rank.json()) >= 1
    assert res_bi_rank.json()[0]["paciente_id"] == 1

    print("\n✅ TODAS AS SUÍTES DE TESTES (Subagentes 1, 2, 3 e 4) PASSARAM COM SUCESSO!")


if __name__ == "__main__":
    test_suite_completa_lab_novas_funcionalidades()
