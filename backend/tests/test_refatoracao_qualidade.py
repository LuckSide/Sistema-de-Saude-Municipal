"""Testes automatizados de regressão e validação de qualidade:
1. Exportação de demanda reprimida (exportar_demanda) - correção de NameError 'p'
2. Rotulação de campos e ações de auditoria (auditoria_txt)
3. Validações estritas de documentos (validacoes.py)
4. Resumo estatístico do TFD (services.tfd.resumo_tfd)
"""

from datetime import date, timedelta
import pytest
from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.cadastros_saude import Medico, UnidadeSaude
from app.models.tfd import Paciente, ExameFila, Viagem, Veiculo, Faturamento, ViagemPaciente
from app.models.user import User
from app.api.v1.tfd import exportar_demanda, perfil_paciente
from app.services.auditoria_txt import rotulo_campo, rotulo_acao, FIELD_LABELS
from app.services.tfd import resumo_tfd
from app.services.validacoes import (
    so_digitos,
    valida_cpf,
    valida_cnh,
    valida_cnh_validade,
    valida_crm,
    valida_cnes,
    valida_email,
    valida_telefone,
    valida_cns,
)


from sqlalchemy import event


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
    with Session(engine) as s:
        yield s


@pytest.fixture
def ator_admin():
    return User(
        id=1,
        username="admin",
        nome="Administrador",
        is_superuser=True,
        is_active=True,
        must_change_password=False,
        telas='["tfd_pacientes"]',
    )


# =====================================================================
# 1. EXPORTAÇÃO DE DEMANDA REPRIMIDA (exportar_demanda)
# =====================================================================

def test_exportar_demanda_com_sucesso(session, ator_admin):
    # Cria paciente e exames na fila
    pac = Paciente(
        nome="Maria da Silva",
        cpf="12345678901",
        cns="123456789012345",
        municipio="Guapé",
    )
    session.add(pac)
    session.commit()
    session.refresh(pac)

    ex = ExameFila(
        paciente_id=pac.id,
        paciente_nome=pac.nome,
        exame="Ultrassonografia Abdominal",
        especialidade="Ultrassonografia",
        prioridade="urgente",
        status="aguardando",
        ativo=True,
        data_pedido=date.today(),
    )
    session.add(ex)
    session.commit()

    # Chama exportar_demanda (anteriormente falhava com NameError: name 'p' is not defined)
    resp = exportar_demanda(pid=pac.id, request=None, db=session, ator=ator_admin)
    assert resp is not None
    assert resp.status_code == 200
    assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in resp.media_type
    assert "demanda_reprimida" in resp.headers.get("content-disposition", "")
    assert len(resp.body) > 100


def test_exportar_demanda_paciente_sem_itens(session, ator_admin):
    pac = Paciente(
        nome="José Pereira",
        cpf="98765432100",
        municipio="Guapé",
    )
    session.add(pac)
    session.commit()
    session.refresh(pac)

    resp = exportar_demanda(pid=pac.id, request=None, db=session, ator=ator_admin)
    assert resp is not None
    assert resp.status_code == 200
    assert len(resp.body) > 100


def test_exportar_demanda_paciente_inexistente(session, ator_admin):
    with pytest.raises(HTTPException) as exc_info:
        exportar_demanda(pid=99999, request=None, db=session, ator=ator_admin)
    assert exc_info.value.status_code == 404
    assert "não encontrado" in exc_info.value.detail.lower()


# =====================================================================
# 2. ROTULAÇÃO DE CAMPOS E AUDITORIA (auditoria_txt)
# =====================================================================

def test_rotulos_auditoria():
    assert rotulo_campo("medico_id") == "Médico Vinculado"
    assert rotulo_campo("paciente_id") == "Paciente"
    assert rotulo_campo("veiculo_id") == "Veículo"
    assert rotulo_campo("campo_inexistente") == "Campo inexistente"

    assert rotulo_acao("PATIENT_CREATE") == "Cadastro de paciente"
    assert rotulo_acao("EXPORT_EXCEL") == "Exportação de relatório (Excel)"
    assert rotulo_acao("USER_DELETE") == "Exclusão de conta de usuário"
    assert rotulo_acao("CUSTOM_ACTION") == "Custom Action"

    # Garante unicidade do dicionário
    assert "medico_id" in FIELD_LABELS


# =====================================================================
# 3. VALIDAÇÕES ESTRITAS DE DOCUMENTOS (validacoes.py)
# =====================================================================

def test_validacao_so_digitos():
    assert so_digitos("123.456.789-00") == "12345678900"
    assert so_digitos("abc") == ""
    assert so_digitos(None) == ""


def test_validacao_cpf():
    # Vazio / None
    ok, msg = valida_cpf(None)
    assert not ok and "11 dígitos" in msg
    ok, msg = valida_cpf("123")
    assert not ok and "11 dígitos" in msg

    # Dígitos repetidos
    ok, msg = valida_cpf("11111111111")
    assert not ok and "inválido" in msg

    # CPF inválido no DV
    ok, msg = valida_cpf("12345678900")
    assert not ok and "inválido" in msg

    # CPF válido real conhecido (algoritmo mod 11)
    ok, msg = valida_cpf("52998224725")
    assert ok and msg == ""


def test_validacao_cnh():
    ok, msg = valida_cnh(None)
    assert not ok and "11 dígitos" in msg

    ok, msg = valida_cnh("11111111111")
    assert not ok and "dígito verificador inválido" in msg

    ok, msg = valida_cnh("12345678901")
    assert not ok and "dígito verificador inválido" in msg


def test_validacao_cnh_validade():
    ok, msg = valida_cnh_validade(None)
    assert not ok and "obrigatória" in msg

    ok, msg = valida_cnh_validade("data_invalida")
    assert not ok and "formato inválido" in msg

    ontem = (date.today() - timedelta(days=1)).isoformat()
    ok, msg = valida_cnh_validade(ontem)
    assert not ok and "vencida" in msg

    amanha = (date.today() + timedelta(days=365)).isoformat()
    ok, msg = valida_cnh_validade(amanha)
    assert ok and msg == ""


def test_validacao_crm():
    ok, msg, norm = valida_crm("")
    assert not ok and "obrigatório" in msg

    # Sem UF
    ok, msg, norm = valida_crm("123456")
    assert not ok and "UF do CRM é obrigatória" in msg

    # UF inválida
    ok, msg, norm = valida_crm("123456/XX")
    assert not ok and "UF 'XX' inválida" in msg

    # Válido em formatos diferentes
    ok, msg, norm = valida_crm("123456/MG")
    assert ok and norm == "CRM/MG 123456"

    ok, msg, norm = valida_crm("CRM/SP 987654")
    assert ok and norm == "CRM/SP 987654"


def test_validacao_cnes():
    ok, msg = valida_cnes("")
    assert not ok and "obrigatório" in msg

    ok, msg = valida_cnes("12345")
    assert not ok and "7 dígitos" in msg

    ok, msg = valida_cnes("1234567")
    assert ok and msg == ""


def test_validacao_email():
    ok, msg = valida_email("")
    assert ok  # opcional

    ok, msg = valida_email("email_invalido")
    assert not ok and "inválido" in msg

    ok, msg = valida_email("email..duplo@exemplo.com")
    assert not ok and "inválido" in msg

    ok, msg = valida_email("contato@saudeguape.mg.gov.br")
    assert ok and msg == ""


def test_validacao_telefone():
    # Opcional vazio
    ok, msg = valida_telefone("", obrigatorio=False)
    assert ok

    # Obrigatório vazio
    ok, msg = valida_telefone("", obrigatorio=True)
    assert not ok and "obrigatório" in msg

    # DDD inválido
    ok, msg = valida_telefone("00999998888")
    assert not ok and "DDD inválido" in msg

    # Fixo válido (10 dígitos iniciado em 2-5)
    ok, msg = valida_telefone("(35) 3521-1234")
    assert ok

    # Fixo inválido (iniciado em 9 com 10 dígitos)
    ok, msg = valida_telefone("(35) 9521-1234")
    assert not ok and "iniciado em 2–5" in msg

    # Celular válido (11 dígitos iniciado em 9)
    ok, msg = valida_telefone("(35) 99876-5432")
    assert ok

    # Celular inválido (11 dígitos não iniciado em 9)
    ok, msg = valida_telefone("(35) 89876-5432")
    assert not ok and "DDD + 9 + número" in msg


def test_validacao_cns():
    ok, msg = valida_cns("")
    assert ok  # opcional quando vazio

    ok, msg = valida_cns("12345")
    assert not ok and "15 dígitos" in msg

    # Primeiro dígito inválido
    ok, msg = valida_cns("323456789012345")
    assert not ok and "deve iniciar com 1, 2, 7, 8 ou 9" in msg


def test_resumo_tfd(session):
    v = Veiculo(placa="ABC-1234", modelo="Van", capacidade=15, tipo="van", ativo=True)
    session.add(v)
    session.commit()
    session.refresh(v)

    viagem = Viagem(
        destino="Passos",
        data_viagem=date(2026, 10, 22),
        hora_saida="06:00",
        veiculo_id=v.id,
    )
    session.add(viagem)

    ex = ExameFila(
        paciente_id=1,
        paciente_nome="Teste",
        exame="Consulta",
        status="aguardando",
        prioridade="urgente",
        ativo=True,
    )
    session.add(ex)
    session.commit()

    res = resumo_tfd(session, "2026-10")
    assert res["viagens_mes"] == 1
    assert res["exames_aguardando"] == 1
    assert res["exames_urgentes"] == 1
    assert res["ocupacao_media"] == 0.0


def test_perfil_paciente_fila_geral_e_posicao(session, ator_admin):
    from app.models.tfd import Paciente, ExameFila
    from app.api.v1.tfd import perfil_paciente

    pac = Paciente(nome="Carlos Silva", cpf="12345678909", ativo=True)
    session.add(pac)
    session.commit()
    session.refresh(pac)

    ex1 = ExameFila(
        paciente_id=pac.id,
        paciente_nome=pac.nome,
        exame="Eletrocardiograma",
        especialidade="Cardiologia",
        tipo_fila="CONSULTAS ESPECIALIZADAS",
        prioridade="rotina",
        status="aguardando",
        ativo=True,
    )
    ex2 = ExameFila(
        paciente_id=pac.id,
        paciente_nome=pac.nome,
        exame="Ultrassonografia Abdominal",
        especialidade="Radiologia",
        tipo_fila="ULTRASSONOGRAFIA",
        prioridade="urgente",
        status="aguardando",
        ativo=True,
    )
    session.add_all([ex1, ex2])
    session.commit()

    perfil = perfil_paciente(pid=pac.id, db=session, _=ator_admin)
    assert len(perfil.demanda) == 2
    for d in perfil.demanda:
        assert d.posicao_fila_geral is not None
        assert d.total_fila_geral is not None
        assert d.total_fila_geral >= 2


def test_relatorio_agendados_filtro_procedimento(session, ator_admin):
    from app.models.tfd import Paciente, ExameFila
    from app.api.v1.tfd import obter_relatorio_agendados

    pac = Paciente(nome="Maria Santos", cpf="98765432100", ativo=True)
    session.add(pac)
    session.commit()
    session.refresh(pac)

    ex1 = ExameFila(
        paciente_id=pac.id,
        paciente_nome=pac.nome,
        exame="MAMOGRAFIA BILATERAL",
        status="agendado",
        data_agendada=date(2026, 11, 15),
        hora_agendada="08:00",
        ativo=True,
    )
    ex2 = ExameFila(
        paciente_id=pac.id,
        paciente_nome=pac.nome,
        exame="CONSULTA OFTALMOLOGICA",
        status="agendado",
        data_agendada=date(2026, 11, 15),
        hora_agendada="09:00",
        ativo=True,
    )
    session.add_all([ex1, ex2])
    session.commit()

    # Busca com filtro de procedimento
    res = obter_relatorio_agendados(
        procedimento="MAMOGRAFIA",
        escopo="agendados",
        db=session,
        ator=ator_admin,
    )
    assert res["total"] >= 1
    nomes = [item["exame"] for item in res["itens"]]
    assert any("MAMOGRAFIA" in n for n in nomes)
    assert not any("OFTALMOLOGICA" in n for n in nomes)


