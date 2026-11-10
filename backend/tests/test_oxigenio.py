from datetime import date, timedelta
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.v1.auth import get_current_user
from app.api.v1.oxigenio import get_db
from app.main import app
from app.models.oxigenio import (
    EmprestimoOxigenio,
    EmpresaOxigenio,
    EntradaCompraOxigenio,
    EquipamentoRespiratorio,
    LicitacaoContratoOxigenio,
    TrocaCilindroHistorico,
)
from app.models.tfd import Paciente
from app.models.user import User


@pytest.fixture(name="session")
def session_fixture():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

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


@pytest.fixture(name="client")
def client_fixture(session: Session):
    admin = User(
        username="admin",
        nome="Administrador",
        is_superuser=True,
        ativo=True,
        must_change_password=False,
        telas="oxigenio,oxigenio_empresas,oxigenio_estoque,oxigenio_equipamentos,oxigenio_emprestimos,oxigenio_relatorios",
    )

    def override_get_db():
        yield session

    def override_get_current_user():
        return admin

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    yield TestClient(app)

    app.dependency_overrides.clear()


def test_oxigenio_fluxo_completo(client: TestClient, session: Session):
    # 1. Criar Empresa
    res_emp = client.post(
        "/api/oxigenio/empresas",
        json={
            "razao_social": "Air Liquide Brasil Ltda",
            "nome_fantasia": "Air Liquide",
            "cnpj": "00.331.788/0001-19",
            "telefone": "(11) 5555-1234",
            "email": "contato@airliquide.com.br",
            "contato_responsavel": "Carlos Gerente",
            "endereco": "Av. Industrial, 500 - Distrito Industrial",
            "servicos": ["oxigenio_cilindros", "locacao_concentrador", "locacao_cpap", "locacao_bipap"],
            "observacoes": "Contrato vigente 2026",
            "ativo": True,
        },
    )
    assert res_emp.status_code == 201, res_emp.text
    emp_data = res_emp.json()
    emp_id = emp_data["id"]
    assert "oxigenio_cilindros" in emp_data["servicos"]

    # 2. Criar Licitação com Saldos de Cilindros (10m³, 3m³, 1m³)
    hoje = date.today()
    res_lic = client.post(
        "/api/oxigenio/licitacoes",
        json={
            "empresa_id": emp_id,
            "numero_licitacao": "Pregão 015/2026",
            "numero_contrato": "Contrato 030/2026",
            "ano": 2026,
            "data_inicio": str(hoje),
            "data_fim": str(hoje + timedelta(days=365)),
            "objeto": "Fornecimento de oxigênio medicinal e locação de equipamentos respiratórios",
            "qtd_contratada_10m3": 300,
            "qtd_contratada_3m3": 80,
            "qtd_contratada_1m3": 40,
            "valor_unitario_10m3": 110.0,
            "valor_unitario_3m3": 60.0,
            "valor_unitario_1m3": 35.0,
            "saldo_alerta_minimo_pct": 20,
            "ativo": True,
        },
    )
    assert res_lic.status_code == 201, res_lic.text
    lic_id = res_lic.json()["id"]

    # 3. Lançar Compra / Entrada de Oxigênio
    res_comp = client.post(
        "/api/oxigenio/compras",
        json={
            "licitacao_id": lic_id,
            "data_compra": str(hoje),
            "numero_nf": "NF-98765",
            "qtd_10m3": 50,
            "qtd_3m3": 15,
            "qtd_1m3": 5,
            "responsavel_recebimento": "Almoxarife João",
            "observacoes": "Entrega semanal conferida",
        },
    )
    assert res_comp.status_code == 201, res_comp.text
    assert res_comp.json()["qtd_10m3"] == 50

    # 4. Cadastrar Equipamento (Concentrador de Oxigênio)
    res_eq = client.post(
        "/api/oxigenio/equipamentos",
        json={
            "tipo": "CONCENTRADOR",
            "patrimonio": "CONC-2026-001",
            "numero_serie": "SN998877",
            "marca_modelo": "Devilbiss 525DS 5L/min",
            "propriedade": "PROPRIO",
            "empresa_id": emp_id,
            "status": "DISPONIVEL",
            "data_aquisicao": str(hoje),
            "tensao_eletrica": "110V",
            "horas_uso": 120.5,
            "observacoes": "Equipamento revisado",
            "ativo": True,
        },
    )
    assert res_eq.status_code == 201, res_eq.text
    eq_id = res_eq.json()["id"]

    # 5. Criar Paciente para teste
    pac = Paciente(
        nome="Maria das Dores Silva",
        cpf="111.222.333-44",
        cns="700000000000001",
        codigo_prontuario="PR-00999",
        telefone="(35) 99999-1111",
        endereco="Rua das Flores, 123",
        bairro="Centro",
    )
    session.add(pac)
    session.commit()
    session.refresh(pac)
    pac_id = pac.id

    # 6. Registrar Empréstimo de Máquina (Concentrador)
    res_emp_maq = client.post(
        "/api/oxigenio/emprestimos",
        json={
            "paciente_id": pac_id,
            "tipo_servico": "MAQUINA",
            "equipamento_id": eq_id,
            "empresa_id": emp_id,
            "licitacao_id": lic_id,
            "data_instalacao": str(hoje),
            "responsavel_retirada_nome": "José Silva (Filho)",
            "responsavel_retirada_cpf": "999.888.777-66",
            "responsavel_retirada_parentesco": "Filho",
            "medico_prescritor": "Dr. Carlos Pneumologista",
            "cid_diagnostico": "J44.9 (DPOC)",
            "fluxo_oxigenio_litros_min": 2.5,
            "termo_assinado": True,
            "observacoes": "Paciente com indicação de O2 16h/dia",
        },
    )
    assert res_emp_maq.status_code == 201, res_emp_maq.text
    emp_maq_data = res_emp_maq.json()
    assert emp_maq_data["tipo_equipamento"] == "CONCENTRADOR"

    # Verifica se o equipamento mudou para EM_USO
    res_eq_check = client.get(f"/api/oxigenio/equipamentos/{eq_id}")
    assert res_eq_check.json()["status"] == "EM_USO"

    # 7. Registrar Empréstimo do Cilindro Semanal de 10m³ para Concentrador
    res_emp_cil = client.post(
        "/api/oxigenio/emprestimos",
        json={
            "paciente_id": pac_id,
            "tipo_servico": "OXIGENIO",
            "tipo_cilindro": "10m3",
            "finalidade_cilindro": "SEMANAL_CONCENTRADOR",
            "quantidade": 1,
            "empresa_id": emp_id,
            "licitacao_id": lic_id,
            "data_instalacao": str(hoje),
            "medico_prescritor": "Dr. Carlos Pneumologista",
            "cid_diagnostico": "J44.9",
            "termo_assinado": True,
            "observacoes": "Troca semanal obrigatória",
        },
    )
    assert res_emp_cil.status_code == 201, res_emp_cil.text
    emp_cil_id = res_emp_cil.json()["id"]
    # Verifica cálculo automático de troca para +7 dias
    prev_troca = res_emp_cil.json()["data_prevista_troca"]
    assert prev_troca == str(hoje + timedelta(days=7))

    # 8. Registrar Troca de Cilindro Semanal
    data_troca = hoje + timedelta(days=7)
    res_troca = client.post(
        f"/api/oxigenio/emprestimos/{emp_cil_id}/troca",
        json={
            "data_troca": str(data_troca),
            "tipo_cilindro": "10m3",
            "quantidade": 1,
            "responsavel_entrega": "Motorista Marcos",
            "observacoes": "Cilindro cheio entregue, vazio recolhido",
        },
    )
    assert res_troca.status_code == 200, res_troca.text
    # Verifica que próxima troca foi para +7 dias da troca
    res_cil_atual = client.get(f"/api/oxigenio/emprestimos/{emp_cil_id}")
    assert res_cil_atual.json()["data_prevista_troca"] == str(data_troca + timedelta(days=7))

    # 9. Consultar Comprovante do Empréstimo com Assinatura
    res_comp_termo = client.get(f"/api/oxigenio/emprestimos/{emp_maq_data['id']}/comprovante")
    assert res_comp_termo.status_code == 200
    comp_json = res_comp_termo.json()
    assert comp_json["paciente"]["nome"] == "Maria das Dores Silva"
    assert "declaracao_responsabilidade" in comp_json

    # 10. Consultar Resumo do Painel de Estoque (KPIs, Saldos, Gráficos)
    res_resumo = client.get("/api/oxigenio/estoque/resumo")
    assert res_resumo.status_code == 200
    resumo_json = res_resumo.json()
    assert resumo_json["total_pacientes_ativos"] >= 1
    assert resumo_json["pacientes_ativos_concentrador"] >= 1
    assert len(resumo_json["saldos_cilindros"]) == 3
    assert len(resumo_json["consumo_mensal"]) == 6

    # 11. Consultar Relatório de Requisição AF
    res_af = client.get("/api/oxigenio/requisicao-af")
    assert res_af.status_code == 200
    af_json = res_af.json()
    assert len(af_json["itens"]) == 3
    assert "justificativa_tecnica" in af_json
    assert af_json["pacientes_ativos_dependentes"] >= 1

    # 12. Inativar/Devolver Empréstimo (Alta médica)
    res_inativar = client.post(
        f"/api/oxigenio/emprestimos/{emp_maq_data['id']}/inativar",
        json={
            "data_devolucao": str(hoje + timedelta(days=14)),
            "motivo_inativacao": "ALTA",
            "observacoes": "Paciente recebeu alta hospitalar/médica com sucesso.",
        },
    )
    assert res_inativar.status_code == 200
    assert res_inativar.json()["status"] == "INATIVO"
    assert res_inativar.json()["motivo_inativacao"] == "ALTA"

    # Verifica que o equipamento voltou para DISPONIVEL
    res_eq_liberado = client.get(f"/api/oxigenio/equipamentos/{eq_id}")
    assert res_eq_liberado.json()["status"] == "DISPONIVEL"

    # 13. Exportar Excel
    res_export = client.get("/api/oxigenio/exportar?tipo=todos")
    assert res_export.status_code == 200
    assert res_export.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    # ==============================================================
    # 14. TESTES DAS NOVAS FUNCIONALIDADES
    # ==============================================================

    # A) Preços Unitários e Locação na Licitação
    res_lic_precos = client.post(
        "/api/oxigenio/licitacoes",
        json={
            "empresa_id": emp_id,
            "numero_licitacao": "Pregão 020/2026",
            "numero_contrato": "Contrato 055/2026",
            "ano": 2026,
            "data_inicio": str(hoje),
            "data_fim": str(hoje + timedelta(days=365)),
            "objeto": "Locação de CPAP, BiPAP e Concentradores e Recargas",
            "qtd_contratada_10m3": 200,
            "qtd_contratada_3m3": 50,
            "qtd_contratada_1m3": 30,
            "valor_unitario_10m3": 115.0,
            "valor_unitario_3m3": 65.0,
            "valor_unitario_1m3": 40.0,
            "valor_recarga_m3": 11.5,
            "locacao_mensal_concentrador": 380.0,
            "locacao_mensal_cpap": 250.0,
            "locacao_mensal_bipap": 320.0,
            "locacao_mensal_cilindro": 45.0,
            "saldo_alerta_minimo_pct": 20,
            "ativo": True,
        },
    )
    assert res_lic_precos.status_code == 201, res_lic_precos.text
    lic_precos_data = res_lic_precos.json()
    assert lic_precos_data["locacao_mensal_concentrador"] == 380.0
    assert lic_precos_data["locacao_mensal_cpap"] == 250.0

    # B) Empréstimo Múltiplo Unificado (2 itens: 2x Cilindro 10m³ Comodato + 1x CPAP)
    res_cpap = client.post(
        "/api/oxigenio/equipamentos",
        json={
            "tipo": "CPAP",
            "patrimonio": "CPAP-2026-002",
            "numero_serie": "SNCPAP1122",
            "marca_modelo": "ResMed AirSense 10",
            "propriedade": "LOCADO",
            "empresa_id": emp_id,
            "status": "DISPONIVEL",
        },
    )
    assert res_cpap.status_code == 201
    cpap_id = res_cpap.json()["id"]

    res_emp_multi = client.post(
        "/api/oxigenio/emprestimos",
        json={
            "paciente_id": pac_id,
            "tipo_servico": "MAQUINA",
            "empresa_id": emp_id,
            "data_instalacao": str(hoje),
            "itens": [
                {
                    "tipo_servico": "MAQUINA",
                    "equipamento_id": cpap_id,
                    "tipo_equipamento": "CPAP",
                    "quantidade": 1,
                    "posse_cilindro": "PROPRIO",
                },
                {
                    "tipo_servico": "OXIGENIO",
                    "tipo_cilindro": "10m3",
                    "finalidade_cilindro": "SEMANAL_CONCENTRADOR",
                    "quantidade": 2,
                    "posse_cilindro": "COMODATO",
                },
            ],
            "responsavel_retirada_nome": "Familiar João",
            "termo_assinado": True,
        },
    )
    assert res_emp_multi.status_code == 201, res_emp_multi.text
    multi_data = res_emp_multi.json()
    assert len(multi_data["itens"]) == 2
    assert "Cilindro 10m³" in multi_data["itens_resumo"]
    assert "CPAP" in multi_data["itens_resumo"]

    # Comprovante traz itens múltiplos
    res_comp_multi = client.get(f"/api/oxigenio/emprestimos/{multi_data['id']}/comprovante")
    assert res_comp_multi.status_code == 200
    assert len(res_comp_multi.json()["servico"]["itens"]) == 2

    # C) Troca de Cilindro gera Cilindro Vazio Pendente
    res_troca_auto = client.post(
        f"/api/oxigenio/emprestimos/{multi_data['id']}/troca",
        json={
            "data_troca": str(hoje),
            "tipo_cilindro": "10m3",
            "quantidade": 2,
            "responsavel_entrega": "Motorista Entrega",
        },
    )
    assert res_troca_auto.status_code == 200
    # Verifica que paciente permaneceu ATIVO
    res_check_ativo = client.get(f"/api/oxigenio/emprestimos/{multi_data['id']}")
    assert res_check_ativo.json()["status"] == "ATIVO"

    # Verifica na lista de cilindros vazios
    res_vazios = client.get("/api/oxigenio/cilindros-vazios?status=PENDENTE")
    assert res_vazios.status_code == 200
    vazios_list = res_vazios.json()
    assert len(vazios_list) >= 1
    vazio_id = vazios_list[0]["id"]

    # Baixa / Recolhimento do cilindro vazio
    res_recolher = client.post(
        f"/api/oxigenio/cilindros-vazios/{vazio_id}/recolher",
        json={
            "data_recolhimento": str(hoje),
            "responsavel_recolhimento": "Motorista Transporte",
            "observacoes": "Coletado e devolvido à central",
        },
    )
    assert res_recolher.status_code == 200
    assert res_recolher.json()["status"] == "RECOLHIDO"

    # D) Gestão de Comodato
    res_comod_ent = client.post(
        "/api/oxigenio/comodato",
        json={
            "empresa_id": emp_id,
            "tipo_movimentacao": "ENTRADA_COMODATO",
            "tipo_cilindro": "10m3",
            "quantidade": 15,
            "data_movimento": str(hoje),
            "numero_documento": "REM-COMOD-001",
            "responsavel": "Coordenador Oxigênio",
        },
    )
    assert res_comod_ent.status_code == 201

    res_comod_saldos = client.get(f"/api/oxigenio/comodato/saldos?empresa_id={emp_id}")
    assert res_comod_saldos.status_code == 200
    saldos = res_comod_saldos.json()
    s10 = next(s for s in saldos if s["tipo_cilindro"] == "10m3")
    assert s10["saldo_em_comodato"] == 15

    # E) Alteração de Status de Equipamento
    res_alterar_st = client.patch(
        f"/api/oxigenio/equipamentos/{cpap_id}/status",
        json={
            "status": "MANUTENCAO",
            "observacoes": "Troca de filtros preventiva",
        },
    )
    assert res_alterar_st.status_code == 200
    assert res_alterar_st.json()["status"] == "MANUTENCAO"

    # F) Migração Global em Lote de Empresa
    res_emp2 = client.post(
        "/api/oxigenio/empresas",
        json={
            "razao_social": "Messer Gases do Brasil Ltda",
            "nome_fantasia": "Messer Gases",
            "cnpj": "11.222.333/0001-44",
            "servicos": ["oxigenio_cilindros", "locacao_cpap"],
            "ativo": True,
        },
    )
    assert res_emp2.status_code == 201
    emp2_id = res_emp2.json()["id"]

    res_migrar = client.post(
        "/api/oxigenio/empresas/migrar",
        json={
            "empresa_origem_id": emp_id,
            "empresa_destino_id": emp2_id,
            "transferir_pacientes": True,
            "transferir_equipamentos": True,
            "observacoes": "Término da licitação anterior",
        },
    )
    assert res_migrar.status_code == 200
    migrar_data = res_migrar.json()
    assert migrar_data["sucesso"] is True
    assert migrar_data["pacientes_transferidos"] >= 1
    assert migrar_data["equipamentos_transferidos"] >= 1

    # Verifica que o empréstimo ativo agora aponta para a nova empresa
    res_emp_migrado = client.get(f"/api/oxigenio/emprestimos/{multi_data['id']}")
    assert res_emp_migrado.json()["empresa_id"] == emp2_id

    # G) Relatório de Faturamento Mensal e Exportação
    res_fat = client.get(f"/api/oxigenio/relatorios/faturamento?mes={hoje.month}&ano={hoje.year}")
    assert res_fat.status_code == 200
    fat_data = res_fat.json()
    assert fat_data["pacientes_ativos_total"] >= 1
    assert fat_data["total_geral_faturamento"] > 0
    assert fat_data["subtotal_locacoes"] >= 0

    res_fat_exp = client.get(f"/api/oxigenio/relatorios/faturamento/exportar?mes={hoje.month}&ano={hoje.year}")
    assert res_fat_exp.status_code == 200
    assert res_fat_exp.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def test_empresa_valores_unitarios_e_estoque_vazios(client: TestClient, session: Session):
    hoje = date.today()

    # 1. Cadastrar empresa com valores unitários diretamente
    res_emp = client.post(
        "/api/oxigenio/empresas",
        json={
            "razao_social": "White Martins Gases Industriais",
            "nome_fantasia": "White Martins",
            "cnpj": "35.820.448/0001-30",
            "servicos": ["OXIGENIO_MEDICINAL", "LOCACAO_CONCENTRADOR"],
            "valor_unitario_10m3": 125.50,
            "valor_unitario_3m3": 75.00,
            "valor_unitario_1m3": 42.00,
            "valor_recarga_m3": 14.50,
            "locacao_mensal_concentrador": 395.00,
            "locacao_mensal_cpap": 260.00,
            "locacao_mensal_bipap": 330.00,
            "locacao_mensal_cilindro": 85.00,
            "ativo": True,
        },
    )
    assert res_emp.status_code == 201
    emp_data = res_emp.json()
    emp_id = emp_data["id"]
    assert emp_data["valor_unitario_10m3"] == 125.50
    assert emp_data["locacao_mensal_concentrador"] == 395.00

    # 2. Atualizar valores unitários da empresa
    res_up = client.put(
        f"/api/oxigenio/empresas/{emp_id}",
        json={
            **emp_data,
            "valor_unitario_10m3": 130.00,
        },
    )
    assert res_up.status_code == 200
    assert res_up.json()["valor_unitario_10m3"] == 130.00

    # 3. Criar licitação sem valores explícitos (deve herdar da empresa)
    res_lic = client.post(
        "/api/oxigenio/licitacoes",
        json={
            "empresa_id": emp_id,
            "numero_licitacao": "PE 040/2026",
            "ano": hoje.year,
            "data_inicio": str(hoje),
            "data_fim": str(hoje + timedelta(days=365)),
            "qtd_contratada_10m3": 100,
            "qtd_contratada_3m3": 50,
            "qtd_contratada_1m3": 20,
            # Não informando valores unitários ou enviando 0
            "valor_unitario_10m3": 0,
            "valor_unitario_3m3": 0,
            "valor_unitario_1m3": 0,
        },
    )
    assert res_lic.status_code == 201
    lic_data = res_lic.json()
    lic_id = lic_data["id"]
    # Herdou da empresa:
    assert lic_data["valor_unitario_10m3"] == 130.00
    assert lic_data["valor_unitario_3m3"] == 75.00

    # 4. Registrar compra de 20 cilindros de 10m³
    res_compra = client.post(
        "/api/oxigenio/compras",
        json={
            "licitacao_id": lic_id,
            "data_compra": str(hoje),
            "numero_nf": "NF-9988",
            "qtd_10m3": 20,
            "qtd_3m3": 0,
            "qtd_1m3": 0,
        },
    )
    assert res_compra.status_code == 201

    # 5. Criar paciente e empréstimo de 4 cilindros de 10m³
    pac = Paciente(nome="Maria Aparecida Vazios", cpf="12345678909", cartao_sus="789012345678901")
    session.add(pac)
    session.commit()
    session.refresh(pac)

    res_emp_ox = client.post(
        "/api/oxigenio/emprestimos",
        json={
            "paciente_id": pac.id,
            "tipo_servico": "OXIGENIO",
            "tipo_cilindro": "10m3",
            "quantidade": 4,
            "empresa_id": emp_id,
            "data_instalacao": str(hoje),
        },
    )
    assert res_emp_ox.status_code == 201
    emp_ox_id = res_emp_ox.json()["id"]

    # 6. Registrar 3 cilindros vazios pendentes de recolhimento
    res_vazio = client.post(
        "/api/oxigenio/cilindros-vazios",
        json={
            "paciente_id": pac.id,
            "emprestimo_id": emp_ox_id,
            "empresa_id": emp_id,
            "tipo_cilindro": "10m3",
            "quantidade": 3,
            "posse": "PROPRIO",
            "data_geracao": str(hoje),
            "observacoes": "Troca realizada, cilindros vazios no posto",
        },
    )
    assert res_vazio.status_code == 201

    # 7. Consultar resumo de estoque e verificar diferenciação:
    # Comprado = 20
    # Em uso com paciente = 4
    # Vazios pendentes = 3
    # Livres/Cheios prontos para uso = 20 - 4 - 3 = 13 (não mais 16!)
    res_resumo = client.get(f"/api/oxigenio/estoque/resumo?empresa_id={emp_id}")
    assert res_resumo.status_code == 200
    resumo_data = res_resumo.json()

    s10 = next(s for s in resumo_data["saldos_cilindros"] if s["tipo"] == "10m3")
    assert s10["comprado"] == 20
    assert s10["em_uso"] == 4
    assert s10["vazios"] == 3
    assert s10["saldo_estoque_disponivel"] == 13  # Exclui automaticamente os vazios!

    assert resumo_data["vazios_10m3"] == 3
    assert resumo_data["total_cilindros_vazios_pendentes"] >= 3
    assert resumo_data["total_cilindros_cheios_disponiveis"] >= 13

    # 8. Devolver/inativar empréstimo e verificar geração automática de vazio
    res_inativar = client.post(
        f"/api/oxigenio/emprestimos/{emp_ox_id}/inativar",
        json={
            "data_devolucao": str(hoje),
            "motivo_inativacao": "ALTA",
            "observacoes": "Paciente recebeu alta médica hospitalar",
        },
    )
    assert res_inativar.status_code == 200
    assert res_inativar.json()["status"] == "INATIVO"

    # Verifica na lista de cilindros vazios que foi criado mais um registro de vazio correspondente aos 4 cilindros devolvidos
    res_lista_vazios = client.get(f"/api/oxigenio/cilindros-vazios?paciente_id={pac.id}")
    assert res_lista_vazios.status_code == 200
    vazios_pac = res_lista_vazios.json()
    assert len(vazios_pac) >= 2
    assert any("Devolvido no encerramento" in (v.get("observacoes") or "") for v in vazios_pac)


def test_oxigenio_concentradores_5l_e_10l(client: TestClient, session: Session):
    hoje = date.today()

    # 1. Cadastrar Pacientes para teste
    pac1 = Paciente(
        nome="Paciente Concentrador 5L",
        cpf="111.222.333-44",
        cartao_sus="700000000000001",
        data_nascimento=date(1960, 5, 10),
        telefone="(35) 99999-1111",
    )
    pac2 = Paciente(
        nome="Paciente Concentrador 10L",
        cpf="222.333.444-55",
        cartao_sus="700000000000002",
        data_nascimento=date(1955, 8, 20),
        telefone="(35) 99999-2222",
    )
    session.add(pac1)
    session.add(pac2)
    session.commit()
    session.refresh(pac1)
    session.refresh(pac2)

    # 2. Criar Empresa com preços para Concentrador 5L e 10L
    res_emp = client.post(
        "/api/oxigenio/empresas",
        json={
            "razao_social": "Respira Brasil Equipamentos Ltda",
            "nome_fantasia": "Respira Brasil",
            "cnpj": "12.345.678/0001-99",
            "telefone": "(35) 3500-1122",
            "email": "contato@respirabrasil.com.br",
            "servicos": ["LOCACAO_CONCENTRADOR_5L", "LOCACAO_CONCENTRADOR_10L"],
            "locacao_mensal_concentrador_5l": 350.0,
            "locacao_mensal_concentrador_10l": 520.0,
            "locacao_mensal_cpap": 220.0,
            "locacao_mensal_bipap": 300.0,
            "ativo": True,
        },
    )
    assert res_emp.status_code == 201, res_emp.text
    emp_data = res_emp.json()
    emp_id = emp_data["id"]
    assert emp_data["locacao_mensal_concentrador_5l"] == 350.0
    assert emp_data["locacao_mensal_concentrador_10l"] == 520.0

    # 3. Criar Equipamentos tipo CONCENTRADOR_5L e CONCENTRADOR_10L
    res_eq5 = client.post(
        "/api/oxigenio/equipamentos",
        json={
            "tipo": "CONCENTRADOR_5L",
            "patrimonio": "PAT-5L-001",
            "numero_serie": "SN-5L-987",
            "marca_modelo": "Philips Respironics EverFlo 5L",
            "propriedade": "LOCADO",
            "empresa_id": emp_id,
            "status": "DISPONIVEL",
            "tensao_eletrica": "110V",
        },
    )
    assert res_eq5.status_code == 201, res_eq5.text
    eq5_id = res_eq5.json()["id"]

    res_eq10 = client.post(
        "/api/oxigenio/equipamentos",
        json={
            "tipo": "CONCENTRADOR_10L",
            "patrimonio": "PAT-10L-001",
            "numero_serie": "SN-10L-654",
            "marca_modelo": "DeVilbiss 10L High Flow",
            "propriedade": "LOCADO",
            "empresa_id": emp_id,
            "status": "DISPONIVEL",
            "tensao_eletrica": "220V",
        },
    )
    assert res_eq10.status_code == 201, res_eq10.text
    eq10_id = res_eq10.json()["id"]

    # 4. Listar com filtros específicos e gerais
    res_list_todos_conc = client.get("/api/oxigenio/equipamentos?tipo=CONCENTRADOR")
    assert res_list_todos_conc.status_code == 200
    eqs_conc = res_list_todos_conc.json()
    assert any(e["id"] == eq5_id for e in eqs_conc)
    assert any(e["id"] == eq10_id for e in eqs_conc)

    res_list_5l = client.get("/api/oxigenio/equipamentos?tipo=CONCENTRADOR_5L")
    assert res_list_5l.status_code == 200
    assert any(e["id"] == eq5_id for e in res_list_5l.json())
    assert not any(e["id"] == eq10_id for e in res_list_5l.json())

    res_list_10l = client.get("/api/oxigenio/equipamentos?tipo=CONCENTRADOR_10L")
    assert res_list_10l.status_code == 200
    assert any(e["id"] == eq10_id for e in res_list_10l.json())
    assert not any(e["id"] == eq5_id for e in res_list_10l.json())

    # 5. Criar Empréstimos para cada um
    res_emp1 = client.post(
        "/api/oxigenio/emprestimos",
        json={
            "paciente_id": pac1.id,
            "tipo_servico": "MAQUINA",
            "equipamento_id": eq5_id,
            "empresa_id": emp_id,
            "data_instalacao": str(hoje),
            "responsavel_retirada_nome": "Familiar 1",
            "responsavel_retirada_cpf": "111.111.111-11",
        },
    )
    assert res_emp1.status_code == 201, res_emp1.text

    res_emp2 = client.post(
        "/api/oxigenio/emprestimos",
        json={
            "paciente_id": pac2.id,
            "tipo_servico": "MAQUINA",
            "equipamento_id": eq10_id,
            "empresa_id": emp_id,
            "data_instalacao": str(hoje),
            "responsavel_retirada_nome": "Familiar 2",
            "responsavel_retirada_cpf": "222.222.222-22",
        },
    )
    assert res_emp2.status_code == 201, res_emp2.text

    # 6. Consultar Resumo de Estoque
    res_resumo = client.get(f"/api/oxigenio/estoque/resumo?empresa_id={emp_id}")
    assert res_resumo.status_code == 200
    resumo = res_resumo.json()
    assert resumo["pacientes_ativos_concentrador"] == 2
    assert resumo["pacientes_ativos_concentrador_5l"] == 1
    assert resumo["pacientes_ativos_concentrador_10l"] == 1

    # 7. Consultar Relatório de Faturamento Mensal
    res_fat = client.get(f"/api/oxigenio/relatorios/faturamento?mes={hoje.month}&ano={hoje.year}&empresa_id={emp_id}")
    assert res_fat.status_code == 200, res_fat.text
    fat = res_fat.json()
    assert fat["locacao_concentradores_qtd"] == 2
    assert fat["locacao_concentradores_5l_qtd"] == 1
    assert fat["locacao_concentradores_5l_unit"] == 350.0
    assert fat["locacao_concentradores_5l_total"] == 350.0
    assert fat["locacao_concentradores_10l_qtd"] == 1
    assert fat["locacao_concentradores_10l_unit"] == 520.0
    assert fat["locacao_concentradores_10l_total"] == 520.0
    assert fat["locacao_concentradores_total"] == 870.0
    assert fat["total_geral_faturamento"] == 870.0

    # 8. Exportação Excel Faturamento
    res_exp = client.get(f"/api/oxigenio/relatorios/faturamento/exportar?mes={hoje.month}&ano={hoje.year}&empresa_id={emp_id}")
    assert res_exp.status_code == 200
    assert res_exp.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def test_oxigenio_licitacao_calculo_automatico_precos_empresa(client: TestClient, session: Session):
    hoje = date.today()

    # 1. Cria Empresa com tabela de preços unitários
    res_emp = client.post(
        "/api/oxigenio/empresas",
        json={
            "razao_social": "Gases e Terapias do Sul Ltda",
            "nome_fantasia": "Gases do Sul",
            "cnpj": "99.888.777/0001-66",
            "telefone": "(35) 3500-9988",
            "email": "contato@gasesdosul.com.br",
            "servicos": ["OXIGENIO_MEDICINAL", "LOCACAO_CONCENTRADOR_5L"],
            "valor_unitario_10m3": 120.0,
            "valor_unitario_3m3": 70.0,
            "valor_unitario_1m3": 40.0,
            "valor_recarga_m3": 12.5,
            "locacao_mensal_concentrador_5l": 380.0,
            "locacao_mensal_concentrador_10l": 550.0,
            "locacao_mensal_cpap": 250.0,
            "locacao_mensal_bipap": 330.0,
            "locacao_mensal_cilindro": 50.0,
            "ativo": True,
        },
    )
    assert res_emp.status_code == 201
    emp_id = res_emp.json()["id"]

    # 2. Cria Licitação SEM informar preços (0.0), apenas informando cotas
    # Cota 10m³: 200 x 120 = 24.000
    # Cota 3m³: 50 x 70 = 3.500
    # Cota 1m³: 20 x 40 = 800
    # Total calculado automático = 28.300
    res_lic = client.post(
        "/api/oxigenio/licitacoes",
        json={
            "empresa_id": emp_id,
            "numero_licitacao": "Pregão 099/2026",
            "numero_contrato": "Contrato 099/2026",
            "ano": 2026,
            "data_inicio": str(hoje),
            "data_fim": str(hoje + timedelta(days=365)),
            "objeto": "Fornecimento parcelado de oxigênio",
            "qtd_contratada_10m3": 200,
            "qtd_contratada_3m3": 50,
            "qtd_contratada_1m3": 20,
            # Não enviamos valor_unitario_* (ou enviamos 0.0)
            "valor_unitario_10m3": 0.0,
            "valor_unitario_3m3": 0.0,
            "valor_unitario_1m3": 0.0,
            "saldo_alerta_minimo_pct": 20,
            "ativo": True,
        },
    )
    assert res_lic.status_code == 201, res_lic.text
    lic_data = res_lic.json()

    # Preços unitários devem ter sido puxados automaticamente da Empresa
    assert lic_data["valor_unitario_10m3"] == 120.0
    assert lic_data["valor_unitario_3m3"] == 70.0
    assert lic_data["valor_unitario_1m3"] == 40.0
    assert lic_data["valor_recarga_m3"] == 12.5
    assert lic_data["locacao_mensal_concentrador_5l"] == 380.0
    assert lic_data["locacao_mensal_concentrador_10l"] == 550.0

    # Valor total deve ter sido calculado automaticamente: 200*120 + 50*70 + 20*40 = 28.300
    assert lic_data["valor_total_contrato"] == 28300.0


def test_oxigenio_resumo_escopo_empresas(client: TestClient, session: Session):
    # 1. Cria Empresa A exclusiva de Locação de Equipamentos (sem oxigênio)
    res_loc = client.post(
        "/api/oxigenio/empresas",
        json={
            "razao_social": "Respirar Equipamentos Médicos Ltda",
            "nome_fantasia": "Respirar Locações",
            "cnpj": "11.222.333/0001-44",
            "servicos": ["LOCACAO_CONCENTRADOR_5L", "LOCACAO_CPAP"],
            "ativo": True,
        },
    )
    assert res_loc.status_code == 201
    emp_loc_id = res_loc.json()["id"]

    # Cadastra equipamento para Empresa A
    res_eq = client.post(
        "/api/oxigenio/equipamentos",
        json={
            "tipo": "CONCENTRADOR_5L",
            "patrimonio": "CONC-LOC-01",
            "numero_serie": "SN-LOC-01",
            "marca_modelo": "Philips Respironics",
            "propriedade": "LOCADO",
            "empresa_id": emp_loc_id,
            "status": "DISPONIVEL",
        },
    )
    assert res_eq.status_code == 201

    # 2. Cria Empresa B exclusiva de Fornecimento de Oxigênio (sem máquinas)
    res_ox = client.post(
        "/api/oxigenio/empresas",
        json={
            "razao_social": "Oxigás Medicinal do Brasil S/A",
            "nome_fantasia": "Oxigás",
            "cnpj": "22.333.444/0001-55",
            "servicos": ["OXIGENIO_MEDICINAL"],
            "valor_unitario_10m3": 100.0,
            "ativo": True,
        },
    )
    assert res_ox.status_code == 201
    emp_ox_id = res_ox.json()["id"]

    # Cria licitação e compra de oxigênio para Empresa B
    hoje = date.today()
    res_lic = client.post(
        "/api/oxigenio/licitacoes",
        json={
            "empresa_id": emp_ox_id,
            "numero_licitacao": "Pregão 012/2026",
            "ano": 2026,
            "data_inicio": str(hoje),
            "data_fim": str(hoje + timedelta(days=365)),
            "qtd_contratada_10m3": 50,
            "qtd_contratada_3m3": 0,
            "qtd_contratada_1m3": 0,
            "ativo": True,
        },
    )
    assert res_lic.status_code == 201
    lic_id = res_lic.json()["id"]

    res_compra = client.post(
        "/api/oxigenio/compras",
        json={
            "licitacao_id": lic_id,
            "data_compra": str(hoje),
            "numero_nf": "NF-12345",
            "qtd_10m3": 10,
            "qtd_3m3": 0,
            "qtd_1m3": 0,
            "valor_total": 1000.0,
        },
    )
    assert res_compra.status_code == 201

    # 3. Consulta resumo de estoque geral
    res_resumo = client.get("/api/oxigenio/estoque/resumo")
    assert res_resumo.status_code == 200
    resumo_data = res_resumo.json()

    consumo_empresas = resumo_data["consumo_por_empresa"]
    emp_loc_resumo = next((e for e in consumo_empresas if e["empresa_id"] == emp_loc_id), None)
    emp_ox_resumo = next((e for e in consumo_empresas if e["empresa_id"] == emp_ox_id), None)

    assert emp_loc_resumo is not None
    assert emp_loc_resumo["fornece_oxigenio"] is False
    assert emp_loc_resumo["loca_equipamentos"] is True
    # Empresa sem oxigênio NÃO exibe compras/cilindros nem gasto
    assert emp_loc_resumo["total_cilindros"] == 0
    assert emp_loc_resumo["compras_10m3"] == 0
    assert emp_loc_resumo["valor_total_compras"] == 0.0
    # Mas exibe equipamentos
    assert emp_loc_resumo["equipamentos_cadastrados"] == 1

    assert emp_ox_resumo is not None
    assert emp_ox_resumo["fornece_oxigenio"] is True
    assert emp_ox_resumo["loca_equipamentos"] is False
    # Empresa de oxigênio exibe compras e gasto
    assert emp_ox_resumo["total_cilindros"] == 10
    assert emp_ox_resumo["compras_10m3"] == 10
    assert emp_ox_resumo["valor_total_compras"] == 1000.0
    # Mas NÃO exibe máquinas vinculadas
    assert emp_ox_resumo["equipamentos_cadastrados"] == 0

    # 4. Consulta resumo filtrado para a empresa de locação
    res_filtro = client.get(f"/api/oxigenio/estoque/resumo?empresa_id={emp_loc_id}")
    assert res_filtro.status_code == 200
    filtro_data = res_filtro.json()
    assert len(filtro_data["consumo_por_empresa"]) == 1
    assert filtro_data["consumo_por_empresa"][0]["empresa_id"] == emp_loc_id
    assert filtro_data["consumo_por_empresa"][0]["fornece_oxigenio"] is False


def test_comodato_robustez_e_seed_real(client: TestClient, session: Session):
    hoje = date.today()

    # Cria empresa para teste
    emp = EmpresaOxigenio(
        razao_social="Empresa Teste Comodato",
        nome_fantasia="Teste Comodato",
        cnpj="00.000.000/0001-00",
        servicos='["oxigenio_cilindros"]',
        valor_unitario_10m3=99.0,
        valor_unitario_3m3=115.0,
        valor_unitario_1m3=65.0,
        ativo=True,
    )
    session.add(emp)
    session.commit()
    session.refresh(emp)

    # 1. Testa comodato aceitando "ENTRADA", "10 m³", data_movimentacao e numero_nota_remessa
    res_ent = client.post(
        "/api/oxigenio/comodato",
        json={
            "empresa_id": emp.id,
            "tipo_movimentacao": "ENTRADA",
            "tipo_cilindro": "10 m³",
            "quantidade": 10,
            "data_movimentacao": str(hoje),
            "numero_nota_remessa": "REM-TESTE-100",
            "observacoes": "Recebimento via UI",
        },
    )
    assert res_ent.status_code == 201, res_ent.text
    dados_ent = res_ent.json()
    assert dados_ent["tipo_movimentacao"] == "ENTRADA_COMODATO"
    assert dados_ent["tipo_cilindro"] == "10m3"
    assert dados_ent["numero_documento"] == "REM-TESTE-100"

    # 2. Testa devolução aceitando "DEVOLUCAO"
    res_dev = client.post(
        "/api/oxigenio/comodato",
        json={
            "empresa_id": emp.id,
            "tipo_movimentacao": "DEVOLUCAO",
            "tipo_cilindro": "10m3",
            "quantidade": 4,
            "data_movimento": str(hoje),
        },
    )
    assert res_dev.status_code == 201
    assert res_dev.json()["tipo_movimentacao"] == "DEVOLUCAO_EMPRESA"

    # Saldo deve ser 6
    res_saldos = client.get(f"/api/oxigenio/comodato/saldos?empresa_id={emp.id}")
    assert res_saldos.status_code == 200
    s10 = next(s for s in res_saldos.json() if s["tipo_cilindro"] == "10m3")
    assert s10["saldo_em_comodato"] == 6

    # 3. Devolução com quantidade excessiva deve retornar 400
    res_exc = client.post(
        "/api/oxigenio/comodato",
        json={
            "empresa_id": emp.id,
            "tipo_movimentacao": "DEVOLUCAO",
            "tipo_cilindro": "10m3",
            "quantidade": 10,
            "data_movimento": str(hoje),
        },
    )
    assert res_exc.status_code == 400

    # 4. Testa carga real via endpoint seed-dados-reais
    res_seed = client.post("/api/oxigenio/seed-dados-reais")
    assert res_seed.status_code == 200
    seed_data = res_seed.json()
    assert seed_data["ok"] is True
    assert seed_data["empresas"] == 3
    assert seed_data["cpap_importados"] >= 30
    assert seed_data["concentradores_ativos_importados"] >= 30

    # 5. Testa relatório de faturamento com novas métricas consolidadas
    res_fat = client.get("/api/oxigenio/relatorios/faturamento?mes=8&ano=2026")
    assert res_fat.status_code == 200
    fat = res_fat.json()
    assert fat["total_faturamento"] > 0
    assert len(fat["itens"]) > 0
    assert len(fat["historico_abastecimentos"]) > 0
    assert len(fat["faturamento_por_empresa"]) > 0
    assert fat["contratado_licitacao_10m3"] > 0




