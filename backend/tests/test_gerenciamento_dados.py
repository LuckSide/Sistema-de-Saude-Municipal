"""Suíte de Testes E2E: Gerenciamento de Dados (Configurações)

Cobre os 4 Tiers especificados em TEST_INFRA.md:
- Tier 1: Feature Coverage (5 domínios de detecção, unificação com reatribuição de FKs,
          exclusão física permanente, preview e execução de limpeza em massa com confirmação
          de senha, trilha de auditoria).
- Tier 2: Boundary, Negative & Corner Cases (banco vazio, campos nulos sem falsos positivos,
          CPFs com máscaras distintas, registros soft-deleted/cancelados inativos, merge com
          mesmo ID ou ID inexistente, validação de senha e confirmação explícita de limpeza, permissões).
- Tier 3: Cross-Feature Combinations & Rollback (conflitos de unicidade em uq_tfd_viagem_paciente,
          uq_tfd_faturamento_viagem_pac_cod e uq_lab_vaga_lab_data; preservação de exames agendados;
          reversão transacional atômica e rollback completo em falhas simuladas de unificação e limpeza).
- Tier 4: Real-World Scenario (ciclo completo de remediação administrativa de ponta a ponta).
- API Router / TestClient (contratos REST /api/v1/gerenciamento-dados/*, autorização e guardas).
"""
import os
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from datetime import date, datetime, timedelta
from typing import Any, Dict, Generator, List, Optional
import json
import pytest
import bcrypt

# Compatibilidade passlib com bcrypt >= 4.0.0
if not hasattr(bcrypt, "__about__"):
    bcrypt.__about__ = type("About", (), {"__version__": getattr(bcrypt, "__version__", "4.0.0")})()
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

# Modelos do sistema
from app.models.audit import AuditLog
from app.models.cadastros_saude import Medico, Prestador, UnidadeSaude
from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import (
    FilaPsf,
    ItemSolic,
    LabContrato,
    LabFechamentoFaturamento,
    LabFeriadoBloqueio,
    LabFPOCompetencia,
    LabFPOItem,
    LabLoteItem,
    LabLoteLiberacao,
    Laboratorio,
    LabResultadoArquivo,
    SolicitacaoMestre,
    VagaLab,
)
from app.models.oxigenio import EmprestimoOxigenio
from app.models.tfd import (
    ExameFila,
    Faturamento,
    Motorista,
    Paciente,
    PacienteHistorico,
    TipoFila,
    Veiculo,
    Viagem,
    ViagemFila,
    ViagemPaciente,
)
from app.models.user import User

# Schemas
from app.schemas.gerenciamento_dados import (
    AuditoriaGerenciamentoResponse,
    DetalhesDiagnostico,
    DiagnosticoResponse,
    LimpezaMassaExecutarRequest,
    LimpezaMassaExecutarResponse,
    LimpezaMassaPreviewRequest,
    LimpezaMassaPreviewResponse,
    ResumoDiagnostico,
    UnificarRegistrosRequest,
    UnificarRegistrosResponse,
)

# Serviços
from app.services.gerenciamento_dados import (
    diagnosticar_cadastros,
    diagnosticar_dados,
    diagnosticar_filas,
    diagnosticar_laboratorio,
    diagnosticar_pacientes,
    diagnosticar_viagens,
    executar_limpeza_massa,
    listar_logs_auditoria_gerenciamento,
    preview_limpeza_massa,
    unificar_registros,
)
from app.core.security import hash_password, verify_password


# ==============================================================================
# FIXTURES DE BANCO DE DADOS E ISOLAMENTO (SQLite in-memory com StaticPool)
# ==============================================================================

@pytest.fixture
def db() -> Generator[Session, None, None]:
    """Cria uma base SQLite em memória isolada por teste com enforcement rígido de FKs."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _enable_fk(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    SQLModel.metadata.drop_all(engine)


@pytest.fixture
def admin_user(db: Session) -> User:
    """Superusuário administrador com senha conhecida para testes de limpeza e auditoria."""
    user = User(
        username="superadmin_gestao",
        password_hash=hash_password("admin_pass_123"),
        is_superuser=True,
        must_change_password=False,
        ativo=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def normal_user(db: Session) -> User:
    """Usuário regular sem privilégios de superusuário."""
    user = User(
        username="operador_comum",
        password_hash=hash_password("comum_pass_123"),
        is_superuser=False,
        must_change_password=False,
        ativo=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ==============================================================================
# TIER 1 — FEATURE COVERAGE (EQUIVALENCE CLASS REPRESENTATIVES)
# ==============================================================================

def test_t1_1_pacientes_duplicidade_cpf(db: Session):
    """T1.1: Identifica duplicidades ativas em tfd_pacientes por CPF (com ou sem máscara)."""
    p1 = Paciente(nome="JOAO CARLOS DA SILVA", cpf="123.456.789-00", situacao_cadastral="ativo")
    p2 = Paciente(nome="JOAO C DA SILVA", cpf="12345678900", situacao_cadastral="ativo")
    p3 = Paciente(nome="OUTRO PACIENTE", cpf="987.654.321-99", situacao_cadastral="ativo")
    db.add_all([p1, p2, p3])
    db.commit()

    dups, incs = diagnosticar_pacientes(db)
    dups_cpf = [d for d in dups if d["tipo"] == "duplicidade_cpf"]

    assert len(dups_cpf) == 1
    assert dups_cpf[0]["chave"] == "12345678900"
    assert set(dups_cpf[0]["ids"]) == {p1.id, p2.id}
    assert dups_cpf[0]["total"] == 2


def test_t1_2_pacientes_duplicidade_cns(db: Session):
    """T1.2: Identifica duplicidades em tfd_pacientes por CNS (15 dígitos)."""
    cns_repetido = "700000000000001"
    p1 = Paciente(nome="MARIA APARECIDA", cns=cns_repetido, situacao_cadastral="ativo")
    p2 = Paciente(nome="MARIA A DE SOUZA", cns=f" {cns_repetido} ", situacao_cadastral="ativo")
    db.add_all([p1, p2])
    db.commit()

    dups, _ = diagnosticar_pacientes(db)
    dups_cns = [d for d in dups if d["tipo"] == "duplicidade_cns"]

    assert len(dups_cns) == 1
    assert dups_cns[0]["chave"] == cns_repetido
    assert set(dups_cns[0]["ids"]) == {p1.id, p2.id}


def test_t1_3_pacientes_duplicidade_nome_nascimento(db: Session):
    """T1.3: Identifica duplicidades quando nome normalizado e data de nascimento coincidem."""
    dt_nasc = date(1985, 3, 20)
    p1 = Paciente(nome="José da Silva Sauro", nascimento=dt_nasc, situacao_cadastral="ativo")
    p2 = Paciente(nome="JOSE DA SILVA SAURO", nascimento=dt_nasc, situacao_cadastral="ativo")
    db.add_all([p1, p2])
    db.commit()

    dups, _ = diagnosticar_pacientes(db)
    dups_nome = [d for d in dups if d["tipo"] == "duplicidade_nome_nascimento"]

    assert len(dups_nome) == 1
    assert set(dups_nome[0]["ids"]) == {p1.id, p2.id}


def test_t1_4_pacientes_inconsistencia_pec_e_obito(db: Session):
    """T1.4: Detecta pacientes com óbito registrado mas com exames ou viagens ativas pendentes."""
    p_obito = Paciente(
        nome="FALECIDO COM EXAME ATIVO",
        situacao_cadastral="obito",
        data_obito=date(2025, 1, 10),
    )
    db.add(p_obito)
    db.commit()

    exame_pendente = ExameFila(
        paciente_id=p_obito.id,
        exame="ULTRASSONOGRAFIA",
        status="aguardando",
        ativo=True,
    )
    db.add(exame_pendente)
    db.commit()

    _, incs = diagnosticar_pacientes(db)
    incs_obito = [i for i in incs if i["tipo"] == "obito_com_pendencias"]

    assert len(incs_obito) == 1
    assert incs_obito[0]["id"] == p_obito.id
    assert incs_obito[0]["exames_fila_ativos"] >= 1


def test_t1_5_filas_inconsistencias_tfd_exames_fila(db: Session):
    """T1.5: Identifica exames órfãos em tfd_exames_fila ou duplicidades para mesmo procedimento."""
    p = Paciente(nome="PACIENTE FILA REGULACAO", cpf="11111111112")
    db.add(p)
    db.commit()

    ef1 = ExameFila(
        paciente_id=p.id,
        exame="TOMOGRAFIA COMPUTADORIZADA",
        codigo_procedimento="0206010079",
        status="aguardando",
        ativo=True,
    )
    ef2 = ExameFila(
        paciente_id=p.id,
        exame="TOMOGRAFIA COMPUTADORIZADA",
        codigo_procedimento="0206010079",
        status="aguardando",
        ativo=True,
    )
    db.add_all([ef1, ef2])
    db.commit()

    dups, incs = diagnosticar_filas(db)
    dups_tfd = [d for d in dups if d["tipo"] == "duplicidade_tfd_exames_fila"]

    assert len(dups_tfd) == 1
    assert set(dups_tfd[0]["ids"]) == {ef1.id, ef2.id}


def test_t1_6_filas_inconsistencias_lab_fila_psf(db: Session):
    """T1.6: Identifica solicitações duplicadas na mesma data para lab_fila_psf."""
    p = Paciente(nome="PACIENTE LAB PSF", cpf="11111111113")
    db.add(p)
    db.commit()

    dt = date(2026, 11, 15)
    f1 = FilaPsf(
        paciente_id=p.id,
        especialidade="BIOQUIMICA",
        data_solicitacao=dt,
        status="na_fila",
    )
    f2 = FilaPsf(
        paciente_id=p.id,
        especialidade="BIOQUIMICA",
        data_solicitacao=dt,
        status="na_fila",
    )
    db.add_all([f1, f2])
    db.commit()

    dups, _ = diagnosticar_filas(db)
    dups_psf = [d for d in dups if d["tipo"] == "duplicidade_lab_fila_psf"]

    assert len(dups_psf) == 1
    assert set(dups_psf[0]["ids"]) == {f1.id, f2.id}


def test_t1_7_laboratorio_duplicidades_mesmo_dia(db: Session):
    """T1.7: Detecta múltiplos agendamentos laboratoriais ativos para mesmo paciente no mesmo dia."""
    p = Paciente(nome="PACIENTE LAB MASTER", cpf="11111111114")
    lab = Laboratorio(nome="LAB CENTRAL 1", ativo=True)
    db.add_all([p, lab])
    db.commit()

    dt = date(2026, 11, 20)
    m1 = SolicitacaoMestre(paciente_id=p.id, laboratorio_id=lab.id, data_agendada=dt, status="agendado")
    m2 = SolicitacaoMestre(paciente_id=p.id, laboratorio_id=lab.id, data_agendada=dt, status="agendado")
    db.add_all([m1, m2])
    db.commit()

    dups, _ = diagnosticar_laboratorio(db)
    dups_dia = [d for d in dups if d["tipo"] == "duplicidade_agendamento_dia"]

    assert len(dups_dia) == 1
    assert set(dups_dia[0]["ids"]) == {m1.id, m2.id}


def test_t1_8_laboratorio_pedidos_orfaos_sem_itens(db: Session):
    """T1.8: Detecta lab_solic_mestre vazia sem itens correspondentes em lab_solic_itens."""
    lab = Laboratorio(nome="LAB TEST T1_8", ativo=True)
    p = Paciente(nome="PACIENTE LAB SEM ITENS", cpf="11111111115")
    db.add_all([lab, p])
    db.commit()

    m_orfao = SolicitacaoMestre(
        paciente_id=p.id,
        laboratorio_id=lab.id,
        data_agendada=date(2026, 11, 22),
        status="agendado",
    )
    db.add(m_orfao)
    db.commit()

    _, incs = diagnosticar_laboratorio(db)
    incs_sem_itens = [i for i in incs if i["tipo"] == "mestre_sem_itens"]

    assert len(incs_sem_itens) == 1
    assert incs_sem_itens[0]["id"] == m_orfao.id


def test_t1_9_viagens_inconsistencias_alocacoes_e_fila(db: Session):
    """T1.9: Detecta inconsistências de viagens e passagens com passageiro alocado indevidamente."""
    p = Paciente(nome="PASSAGEIRO VIAGEM", cpf="11111111116")
    v = Viagem(destino="BELO HORIZONTE", data_viagem=date(2026, 11, 25), status="agendada")
    db.add_all([p, v])
    db.commit()

    # Cria alocação de passageiro apontando para viagem
    vp = ViagemPaciente(viagem_id=v.id, paciente_id=p.id, status_confirmacao="confirmado")
    # Fila de viagem em status 'aguardando' mesmo com passageiro alocado
    vf = ViagemFila(paciente_id=p.id, destino="BELO HORIZONTE", status="aguardando")
    db.add_all([vp, vf])
    db.commit()

    vp.viagem_fila_id = vf.id
    db.add(vp)
    db.commit()

    _, incs = diagnosticar_viagens(db)
    assert len(incs) >= 1


def test_t1_10_cadastros_medicos_unidades_prestadores(db: Session):
    """T1.10: Detecta duplicidades de CRM/CPF em médicos, CNES em unidades e nomes em laboratórios."""
    m1 = Medico(nome="DR. ROBERTO CARLOS", cpf="111.222.333-55", crm="12345/MG", ativo=True)
    m2 = Medico(nome="ROBERTO CARLOS", cpf="11122233355", crm="12345-MG", ativo=True)
    u1 = UnidadeSaude(nome="PSF CENTRO", cnes="1234567", ativo=True)
    u2 = UnidadeSaude(nome="POSTO CENTRAL", cnes="1234567", ativo=True)
    l1 = Laboratorio(nome="LABORATORIO SANTA CASA", ativo=True)
    l2 = Laboratorio(nome="Laboratório Santa Casa", ativo=True)
    db.add_all([m1, m2, u1, u2, l1, l2])
    db.commit()

    dups, _ = diagnosticar_cadastros(db)
    tipos = {d["tipo"] for d in dups}

    assert "duplicidade_medico_cpf" in tipos or "duplicidade_medico_crm" in tipos
    assert "duplicidade_unidade_cnes" in tipos
    assert "duplicidade_laboratorio_nome" in tipos


def test_t1_11_unificacao_reatribuicao_fks(db: Session, admin_user: User):
    """T1.11: Transfere vínculos de chaves estrangeiras para o paciente principal."""
    p_master = Paciente(nome="JOAO CARLOS PRINCIPAL", cpf="111.111.111-11", codigo_prontuario="PR-001")
    p_dup = Paciente(nome="JOAO C DUPLICADO", cpf="11111111111", telefone="(35) 99999-0000")
    db.add_all([p_master, p_dup])
    db.commit()

    # Cria vínculos no duplicado
    ef = ExameFila(paciente_id=p_dup.id, exame="HEMOGRAMA", status="aguardando", ativo=True)
    fpsf = FilaPsf(paciente_id=p_dup.id, especialidade="BIOQUIMICA", status="na_fila")
    db.add_all([ef, fpsf])
    db.commit()

    req = UnificarRegistrosRequest(
        entidade="pacientes",
        registro_principal_id=p_master.id,
        registro_duplicado_id=p_dup.id,
    )
    resp = unificar_registros(db, req, user=admin_user)

    assert resp.sucesso is True
    assert resp.vinculos_reatribuidos >= 2
    assert resp.registro_excluido_id == p_dup.id

    # Verifica reatribuição nas tabelas dependentes
    db.refresh(ef)
    db.refresh(fpsf)
    assert ef.paciente_id == p_master.id
    assert fpsf.paciente_id == p_master.id

    # Verifica consolidação de metadados em memória (backfill telefone)
    db.refresh(p_master)
    assert p_master.telefone == "(35) 99999-0000"


def test_t1_12_unificacao_exclusao_permanente(db: Session, admin_user: User):
    """T1.12: Verifica que o registro duplicado foi deletado fisicamente do banco de dados."""
    p_master = Paciente(nome="PACIENTE MESTRE", cpf="222.222.222-22")
    p_dup = Paciente(nome="PACIENTE DUPLICADO", cpf="22222222222")
    db.add_all([p_master, p_dup])
    db.commit()

    did = p_dup.id
    req = UnificarRegistrosRequest(
        entidade="pacientes",
        registro_principal_id=p_master.id,
        registro_duplicado_id=did,
    )
    unificar_registros(db, req, user=admin_user)

    # Confirma exclusão física permanente
    assert db.get(Paciente, did) is None
    assert db.get(Paciente, p_master.id) is not None


def test_t1_13_limpeza_massa_preview(db: Session):
    """T1.13: Retorna contagem exata e resumo sem alterar dados físicos (Dry-Run Preview)."""
    p = Paciente(nome="PACIENTE PREVIEW", cpf="33333333333")
    db.add(p)
    db.commit()

    for i in range(5):
        db.add(ExameFila(
            paciente_id=p.id,
            tipo_fila="FILA_LOTE_ERRADA",
            exame=f"EXAME {i}",
            status="aguardando",
            ativo=True,
        ))
    db.commit()

    req = LimpezaMassaPreviewRequest(
        tipo_limpeza="fila_importada",
        filtro={"tipo_fila": "FILA_LOTE_ERRADA", "apenas_nao_agendados": True},
    )
    preview = preview_limpeza_massa(db, req)

    assert preview.total_afetados == 5
    assert len(preview.detalhes) == 5

    # Garante que nenhum dado foi removido
    restantes = db.exec(select(ExameFila).where(ExameFila.tipo_fila == "FILA_LOTE_ERRADA")).all()
    assert len(restantes) == 5


def test_t1_14_limpeza_massa_execucao_com_senha(db: Session, admin_user: User):
    """T1.14: Remove com sucesso o lote selecionado mediante senha correta e confirmação."""
    p = Paciente(nome="PACIENTE CLEANUP", cpf="44444444444")
    db.add(p)
    db.commit()

    for i in range(4):
        db.add(ExameFila(
            paciente_id=p.id,
            tipo_fila="FILA_PARA_LIMPAR",
            exame=f"PROC {i}",
            status="aguardando",
            ativo=True,
        ))
    db.commit()

    req = LimpezaMassaExecutarRequest(
        tipo_limpeza="fila_importada",
        filtro={"tipo_fila": "FILA_PARA_LIMPAR"},
        senha="admin_pass_123",
        confirmacao_explicita=True,
    )
    resp = executar_limpeza_massa(db, req, admin=admin_user)

    assert resp.sucesso is True
    assert resp.total_removidos == 4

    # Confirma que a fila foi fisicamente esvaziada
    restantes = db.exec(select(ExameFila).where(ExameFila.tipo_fila == "FILA_PARA_LIMPAR")).all()
    assert len(restantes) == 0


def test_t1_15_auditoria_registro_logs(db: Session, admin_user: User):
    """T1.15: Confirma criação de logs em audit_logs para unificação e limpeza."""
    p1 = Paciente(nome="PACIENTE AUDIT 1", cpf="555.555.555-55")
    p2 = Paciente(nome="PACIENTE AUDIT 2", cpf="55555555555")
    db.add_all([p1, p2])
    db.commit()

    # Executa unificação
    unificar_registros(
        db,
        UnificarRegistrosRequest(
            entidade="pacientes",
            registro_principal_id=p1.id,
            registro_duplicado_id=p2.id,
        ),
        user=admin_user,
    )

    # Executa limpeza
    executar_limpeza_massa(
        db,
        LimpezaMassaExecutarRequest(
            tipo_limpeza="pedidos_orfaos",
            filtro={},
            senha="admin_pass_123",
            confirmacao_explicita=True,
        ),
        admin=admin_user,
    )

    logs_resp = listar_logs_auditoria_gerenciamento(db)
    assert logs_resp.total >= 2

    acoes = [l.action for l in logs_resp.logs]
    assert "DATA_UNIFY_PACIENTE" in acoes
    assert "DATA_MASS_CLEANUP" in acoes

    log_unify = next(l for l in logs_resp.logs if l.action == "DATA_UNIFY_PACIENTE")
    assert log_unify.user_id == admin_user.id
    assert log_unify.entity_id == p1.id


# ==============================================================================
# TIER 2 — BOUNDARY, NEGATIVE & CORNER CASES
# ==============================================================================

def test_t2_1_diagnostico_banco_vazio(db: Session):
    """T2.1: Diagnóstico em banco 100% vazio retorna 0 inconsistências sem erros."""
    diag = diagnosticar_dados(db)

    assert diag.resumo.pacientes.duplicidades == 0
    assert diag.resumo.pacientes.inconsistencias == 0
    assert diag.resumo.filas.duplicidades == 0
    assert diag.resumo.filas.inconsistencias == 0
    assert diag.resumo.laboratorio.duplicidades == 0
    assert diag.resumo.laboratorio.inconsistencias == 0
    assert diag.resumo.viagens.duplicidades == 0
    assert diag.resumo.viagens.inconsistencias == 0
    assert diag.resumo.cadastros.duplicidades == 0
    assert diag.resumo.cadastros.inconsistencias == 0


def test_t2_2_pacientes_campos_nulos_sem_falso_positivo(db: Session):
    """T2.2: Pacientes com CPF nulo, CNS nulo ou nascimento nulo não disparam falsas duplicidades."""
    p1 = Paciente(nome="PACIENTE SEM DOC 1", cpf=None, cns=None, nascimento=None)
    p2 = Paciente(nome="PACIENTE SEM DOC 2", cpf=None, cns=None, nascimento=None)
    p3 = Paciente(nome="PACIENTE SEM DOC 3", cpf="", cns="", nascimento=None)
    db.add_all([p1, p2, p3])
    db.commit()

    dups, _ = diagnosticar_pacientes(db)
    assert len(dups) == 0


def test_t2_3_cpf_formatacoes_distintas(db: Session):
    """T2.3: CPF com pontuação e CPF numérico puro são identificados como o mesmo CPF."""
    p1 = Paciente(nome="TESTE MASCARA A", cpf="999.888.777-66")
    p2 = Paciente(nome="TESTE MASCARA B", cpf="99988877766")
    db.add_all([p1, p2])
    db.commit()

    dups, _ = diagnosticar_pacientes(db)
    dups_cpf = [d for d in dups if d["tipo"] == "duplicidade_cpf"]

    assert len(dups_cpf) == 1
    assert dups_cpf[0]["chave"] == "99988877766"


def test_t2_4_registros_inativos_cancelados_nao_conflitam(db: Session):
    """T2.4: Registros soft-deleted (ativo=False) ou cancelados não disparam duplicidades ativas."""
    p = Paciente(nome="PACIENTE CANCELADO", cpf="77777777777")
    db.add(p)
    db.commit()

    # Dois exames cancelados/inativos para o mesmo procedimento
    ef1 = ExameFila(paciente_id=p.id, exame="RAIO X", status="cancelado", ativo=False)
    ef2 = ExameFila(paciente_id=p.id, exame="RAIO X", status="cancelado", ativo=False)
    db.add_all([ef1, ef2])
    db.commit()

    dups, _ = diagnosticar_filas(db)
    assert len([d for d in dups if d["tipo"] == "duplicidade_tfd_exames_fila"]) == 0


def test_t2_5_unificacao_mesmo_id_rejeitada(db: Session, admin_user: User):
    """T2.5: Tentativa de unificar um registro consigo mesmo deve lançar HTTP 400 Bad Request."""
    p = Paciente(nome="AUTO MERGE", cpf="88888888888")
    db.add(p)
    db.commit()

    req = UnificarRegistrosRequest(
        entidade="pacientes",
        registro_principal_id=p.id,
        registro_duplicado_id=p.id,
    )
    with pytest.raises(HTTPException) as exc_info:
        unificar_registros(db, req, user=admin_user)

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST


def test_t2_6_unificacao_id_inexistente_rejeitada(db: Session, admin_user: User):
    """T2.6: Tentativa de unificar ID inexistente deve lançar HTTP 404 Not Found."""
    p = Paciente(nome="PACIENTE REAL", cpf="99999999999")
    db.add(p)
    db.commit()

    req = UnificarRegistrosRequest(
        entidade="pacientes",
        registro_principal_id=p.id,
        registro_duplicado_id=999999,
    )
    with pytest.raises(HTTPException) as exc_info:
        unificar_registros(db, req, user=admin_user)

    assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND


def test_t2_7_limpeza_massa_sem_senha_rejeitada(db: Session, admin_user: User):
    """T2.7: Chamada de limpeza em massa sem senha ou com senha vazia é rejeitada."""
    from pydantic import ValidationError

    try:
        req = LimpezaMassaExecutarRequest(
            tipo_limpeza="pedidos_orfaos",
            filtro={},
            senha="",
            confirmacao_explicita=True,
        )
        with pytest.raises(HTTPException) as exc_info:
            executar_limpeza_massa(db, req, admin=admin_user)
        assert exc_info.value.status_code in (status.HTTP_400_BAD_REQUEST, status.HTTP_422_UNPROCESSABLE_ENTITY)
    except ValidationError:
        pass


def test_t2_8_limpeza_massa_senha_incorreta_rejeitada(db: Session, admin_user: User):
    """T2.8: Senha incorreta de superusuário lança HTTP 403 Forbidden e preserva os dados."""
    p = Paciente(nome="PACIENTE PRESERVADO", cpf="12312312312")
    db.add(p)
    db.commit()

    db.add(ExameFila(paciente_id=p.id, tipo_fila="FILA_INTACTA", exame="TESTE", status="aguardando", ativo=True))
    db.commit()

    req = LimpezaMassaExecutarRequest(
        tipo_limpeza="fila_importada",
        filtro={"tipo_fila": "FILA_INTACTA"},
        senha="senha_completamente_errada",
        confirmacao_explicita=True,
    )
    with pytest.raises(HTTPException) as exc_info:
        executar_limpeza_massa(db, req, admin=admin_user)

    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN

    # Garante que os registros permanecem intactos no banco
    itens = db.exec(select(ExameFila).where(ExameFila.tipo_fila == "FILA_INTACTA")).all()
    assert len(itens) == 1


def test_t2_9_limpeza_massa_sem_confirmacao_explicita_rejeitada(db: Session, admin_user: User):
    """T2.9: Limpeza sem flag confirmacao_explicita=True é rejeitada com HTTP 400."""
    req = LimpezaMassaExecutarRequest(
        tipo_limpeza="pedidos_orfaos",
        filtro={},
        senha="admin_pass_123",
        confirmacao_explicita=False,
    )
    with pytest.raises(HTTPException) as exc_info:
        executar_limpeza_massa(db, req, admin=admin_user)

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST


def test_t2_10_acesso_nao_autenticado_retorna_401(db: Session):
    """T2.10: Acesso Não-Autenticado: Requisição sem token JWT recebe HTTP 401 Unauthorized."""
    from app.api.v1.gerenciamento_dados import router as gd_router
    from app.core.deps import get_db

    app = FastAPI()
    app.include_router(gd_router, prefix="/api/v1/gerenciamento-dados")
    app.dependency_overrides[get_db] = lambda: db

    client = TestClient(app)

    # Requisição sem header de autorização para endpoint protegido deve retornar 401
    resp = client.get("/api/v1/gerenciamento-dados/diagnostico")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


def test_t2_11_unificacao_outras_entidades(db: Session, admin_user: User):
    """T2.11: Unificação de cadastros de Médicos, Unidades de Saúde e Laboratórios."""
    # 1. Unificação de Médicos
    m_mas = Medico(nome="DR. PRINCIPAL", crm="1111/MG", ativo=True)
    m_dup = Medico(nome="DR. DUPLICADO", crm="1111-MG", ativo=True)
    db.add_all([m_mas, m_dup])
    db.commit()

    resp_m = unificar_registros(
        db,
        UnificarRegistrosRequest(
            entidade="medicos",
            registro_principal_id=m_mas.id,
            registro_duplicado_id=m_dup.id,
        ),
        user=admin_user,
    )
    assert resp_m.sucesso is True
    assert db.get(Medico, m_dup.id) is None

    # 2. Unificação de Unidades de Saúde
    u_mas = UnidadeSaude(nome="UNIDADE CENTRAL", cnes="1112223", ativo=True)
    u_dup = UnidadeSaude(nome="UNIDADE POSTO", cnes="1112223", ativo=True)
    db.add_all([u_mas, u_dup])
    db.commit()

    resp_u = unificar_registros(
        db,
        UnificarRegistrosRequest(
            entidade="unidades",
            registro_principal_id=u_mas.id,
            registro_duplicado_id=u_dup.id,
        ),
        user=admin_user,
    )
    assert resp_u.sucesso is True
    assert db.get(UnidadeSaude, u_dup.id) is None

    # 3. Unificação de Laboratórios
    l_mas = Laboratorio(nome="LAB PRINCIPAL", ativo=True)
    l_dup = Laboratorio(nome="LAB DUPLICADO", ativo=True)
    db.add_all([l_mas, l_dup])
    db.commit()

    resp_l = unificar_registros(
        db,
        UnificarRegistrosRequest(
            entidade="laboratorios",
            registro_principal_id=l_mas.id,
            registro_duplicado_id=l_dup.id,
        ),
        user=admin_user,
    )
    assert resp_l.sucesso is True
    assert db.get(Laboratorio, l_dup.id) is None


# ==============================================================================
# TIER 3 — CROSS-FEATURE COMBINATIONS & ROLLBACK
# ==============================================================================

def test_t3_1_unificacao_conflito_uq_tfd_viagem_paciente(db: Session, admin_user: User):
    """T3.1: Resolução de colisão na constraint única uq_tfd_viagem_paciente (viagem_id, paciente_id).

    Quando ambos os pacientes já estão alocados na MESMA viagem, a reatribuição não
    deve violar unicidade: a duplicata conflitante na viagem é tratada antes do update.
    """
    v = Viagem(destino="ALFENAS", data_viagem=date(2026, 11, 28), status="agendada")
    p_master = Paciente(nome="PACIENTE MESTRE VIAGEM", cpf="32132132132")
    p_dup = Paciente(nome="PACIENTE DUP VIAGEM", cpf="32132132133")
    db.add_all([v, p_master, p_dup])
    db.commit()

    # Ambos os pacientes alocados na mesma viagem V
    vp_master = ViagemPaciente(viagem_id=v.id, paciente_id=p_master.id, status_confirmacao="confirmado")
    vp_dup = ViagemPaciente(viagem_id=v.id, paciente_id=p_dup.id, status_confirmacao="pendente")
    db.add_all([vp_master, vp_dup])
    db.commit()

    req = UnificarRegistrosRequest(
        entidade="pacientes",
        registro_principal_id=p_master.id,
        registro_duplicado_id=p_dup.id,
    )
    resp = unificar_registros(db, req, user=admin_user)

    assert resp.sucesso is True

    # Verifica que permaneceu apenas 1 passageiro alocado na viagem (o master)
    alocacoes = db.exec(select(ViagemPaciente).where(ViagemPaciente.viagem_id == v.id)).all()
    assert len(alocacoes) == 1
    assert alocacoes[0].paciente_id == p_master.id


def test_t3_2_unificacao_conflito_uq_tfd_faturamento(db: Session, admin_user: User):
    """T3.2: Resolução de colisão na constraint única uq_tfd_faturamento_viagem_pac_cod.

    Trata duplicatas pré-existentes de faturamento SIGTAP na mesma viagem ao unificar pacientes.
    """
    v = Viagem(destino="PASSOS", data_viagem=date(2026, 11, 30), status="concluida")
    p_master = Paciente(nome="MESTRE FATURAMENTO", cpf="43243243243")
    p_dup = Paciente(nome="DUP FATURAMENTO", cpf="43243243244")
    db.add_all([v, p_master, p_dup])
    db.commit()

    sigtap_cod = "0301010072"
    f_master = Faturamento(
        viagem_id=v.id,
        paciente_id=p_master.id,
        codigo_sigtap=sigtap_cod,
        procedimento="02.04.01.001-0",
        competencia="202601",
    )
    f_dup = Faturamento(
        viagem_id=v.id,
        paciente_id=p_dup.id,
        codigo_sigtap=sigtap_cod,
        procedimento="02.04.01.001-0",
        competencia="202601",
    )
    db.add_all([f_master, f_dup])
    db.commit()

    req = UnificarRegistrosRequest(
        entidade="pacientes",
        registro_principal_id=p_master.id,
        registro_duplicado_id=p_dup.id,
    )
    resp = unificar_registros(db, req, user=admin_user)

    assert resp.sucesso is True

    # Verifica que a colisão foi tratada sem erro de integridade e manteve faturamento único
    fats = db.exec(
        select(Faturamento).where(Faturamento.viagem_id == v.id, Faturamento.codigo_sigtap == sigtap_cod)
    ).all()
    assert len(fats) == 1
    assert fats[0].paciente_id == p_master.id


def test_t3_3_unificacao_conflito_uq_lab_vaga(db: Session, admin_user: User):
    """T3.3: Resolução de colisão em cota de vagas laboratoriais (uq_lab_vaga_lab_data).

    Ao unificar laboratórios com cotas cadastradas no mesmo dia, os totais devem ser somados
    no mestre e a cota do duplicado removida para evitar violação de unicidade.
    """
    l_mas = Laboratorio(nome="LABORATORIO ALFA", ativo=True)
    l_dup = Laboratorio(nome="LABORATORIO BETA", ativo=True)
    db.add_all([l_mas, l_dup])
    db.commit()

    dt = date(2026, 12, 5)
    vaga_mas = VagaLab(laboratorio_id=l_mas.id, data=dt, vagas_totais=20, vagas_ocupadas=5)
    vaga_dup = VagaLab(laboratorio_id=l_dup.id, data=dt, vagas_totais=10, vagas_ocupadas=3)
    db.add_all([vaga_mas, vaga_dup])
    db.commit()

    req = UnificarRegistrosRequest(
        entidade="laboratorios",
        registro_principal_id=l_mas.id,
        registro_duplicado_id=l_dup.id,
    )
    resp = unificar_registros(db, req, user=admin_user)

    assert resp.sucesso is True

    # Verifica que permaneceu uma única linha de vagas para a data no laboratório mestre, somada
    vagas = db.exec(select(VagaLab).where(VagaLab.data == dt)).all()
    assert len(vagas) == 1
    assert vagas[0].laboratorio_id == l_mas.id
    assert vagas[0].vagas_totais == 30
    assert vagas[0].vagas_ocupadas == 8


def test_t3_4_limpeza_massa_preserva_agendados(db: Session, admin_user: User):
    """T3.4: Limpeza em massa preserva itens já agendados quando apenas_nao_agendados=True."""
    p = Paciente(nome="PACIENTE TESTE FILA", cpf="54354354354")
    db.add(p)
    db.commit()

    # Item 1: apenas aguardando (deve ser limpo)
    ef_aguardando = ExameFila(
        paciente_id=p.id,
        tipo_fila="FILA_MISTA",
        exame="Hemograma Completo",
        data_pedido=date(2026, 11, 1),
        status="aguardando",
        data_agendada=None,
        ativo=True,
    )
    # Item 2: agendado (deve ser PRESERVADO)
    ef_agendado = ExameFila(
        paciente_id=p.id,
        tipo_fila="FILA_MISTA",
        exame="Hemograma Completo",
        data_pedido=date(2026, 11, 1),
        status="agendado",
        data_agendada=date(2026, 12, 10),
        ativo=True,
    )
    db.add_all([ef_aguardando, ef_agendado])
    db.commit()

    req = LimpezaMassaExecutarRequest(
        tipo_limpeza="fila_importada",
        filtro={"tipo_fila": "FILA_MISTA", "apenas_nao_agendados": True},
        senha="admin_pass_123",
        confirmacao_explicita=True,
    )
    resp = executar_limpeza_massa(db, req, admin=admin_user)

    assert resp.sucesso is True
    assert resp.total_removidos == 1

    # Confirma que o agendado continua no banco
    assert db.get(ExameFila, ef_agendado.id) is not None
    assert db.get(ExameFila, ef_aguardando.id) is None


def test_t3_5_atomicidade_rollback_em_falha_unificacao(db: Session, admin_user: User, monkeypatch):
    """T3.5: Rollback atômico completo se ocorrer qualquer falha durante a unificação."""
    p_master = Paciente(nome="PACIENTE ROLLBACK MESTRE", cpf="65465465465")
    p_dup = Paciente(nome="PACIENTE ROLLBACK DUP", cpf="65465465466")
    db.add_all([p_master, p_dup])
    db.commit()

    ef = ExameFila(paciente_id=p_dup.id, exame="RESSONANCIA", data_pedido=date(2026, 11, 1), status="aguardando", ativo=True)
    db.add(ef)
    db.commit()

    # Simula erro fatal no meio do processo através de interceptação do flush final
    orig_delete = db.delete
    def _faulty_delete(instance):
        if isinstance(instance, Paciente) and instance.id == p_dup.id:
            raise RuntimeError("FALHA FORÇADA DE BANCO DE DADOS DURANTE DELETE DO DUPLICADO")
        return orig_delete(instance)

    monkeypatch.setattr(db, "delete", _faulty_delete)

    req = UnificarRegistrosRequest(
        entidade="pacientes",
        registro_principal_id=p_master.id,
        registro_duplicado_id=p_dup.id,
    )
    with pytest.raises(HTTPException) as exc_info:
        unificar_registros(db, req, user=admin_user)

    assert exc_info.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR

    # ROLLBACK VERIFICATION: o registro duplicado ainda existe e o vínculo NÃO foi alterado
    dup_restaurado = db.get(Paciente, p_dup.id)
    assert dup_restaurado is not None
    db.refresh(ef)
    assert ef.paciente_id == p_dup.id


def test_t3_6_atomicidade_rollback_em_falha_limpeza(db: Session, admin_user: User, monkeypatch):
    """T3.6: Rollback atômico completo se ocorrer falha durante a execução de limpeza em massa."""
    p = Paciente(nome="PACIENTE ROLLBACK CLEANUP", cpf="76576576576")
    db.add(p)
    db.commit()

    for i in range(3):
        db.add(ExameFila(
            paciente_id=p.id,
            tipo_fila="FILA_ROLLBACK",
            exame=f"EXAME {i}",
            data_pedido=date(2026, 11, 1),
            status="aguardando",
            ativo=True,
        ))
    db.commit()

    # Intercepta delete simulando crash durante a exclusão em lote
    orig_delete = db.delete
    deletes = 0
    def _faulty_delete(instance):
        nonlocal deletes
        deletes += 1
        if deletes >= 2:
            raise RuntimeError("SIMULAÇÃO DE CORRUPÇÃO OU DISK FULL DURANTE BATCH DELETE")
        return orig_delete(instance)

    monkeypatch.setattr(db, "delete", _faulty_delete)

    req = LimpezaMassaExecutarRequest(
        tipo_limpeza="fila_importada",
        filtro={"tipo_fila": "FILA_ROLLBACK"},
        senha="admin_pass_123",
        confirmacao_explicita=True,
    )
    with pytest.raises(HTTPException) as exc_info:
        executar_limpeza_massa(db, req, admin=admin_user)

    assert exc_info.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR

    # Confirma que todas as 3 linhas da fila foram preservadas pelo rollback total
    restantes = db.exec(select(ExameFila).where(ExameFila.tipo_fila == "FILA_ROLLBACK")).all()
    assert len(restantes) == 3


# ==============================================================================
# TIER 4 — REAL-WORLD SCENARIO (WORKLOAD DE REMEDIAÇÃO COMPLETO)
# ==============================================================================

def test_t4_1_ciclo_completo_remediacao_administrativa(db: Session, admin_user: User):
    """T4.1: Cenário Realista de Ponta a Ponta:

    1. Carga com anomalias nos 5 domínios (pacientes duplicados com exames, pedidos órfãos,
       fila importada erroneamente, médicos duplicados).
    2. Diagnóstico inicial identificando todas as anomalias.
    3. Pré-visualização de limpeza em massa da fila importada por engano.
    4. Unificação com reatribuição de FKs e consolidação de metadados.
    5. Execução autenticada de limpeza em massa com senha de administrador.
    6. Novo diagnóstico comprovando reabilitação e integridade do banco.
    7. Verificação da trilha de auditoria completa com usuário, timestamp e detalhes.
    """
    # --------------------------------------------------------------------------
    # Etapa 1: Carga Suja
    # --------------------------------------------------------------------------
    p_master = Paciente(nome="ANTONIO MARCOS SILVA", cpf="111.222.333-88", codigo_prontuario="PR-010")
    p_dup = Paciente(nome="ANTONIO M SILVA", cpf="11122233388", telefone="(35) 98888-7777")
    db.add_all([p_master, p_dup])
    db.commit()

    # Vínculos do paciente duplicado
    ef_dup = ExameFila(paciente_id=p_dup.id, exame="ELETROCARDIOGRAMA", data_pedido=date(2026, 11, 1), status="aguardando", ativo=True)
    db.add(ef_dup)

    # Fila importada erroneamente que precisará de limpeza
    for i in range(3):
        db.add(ExameFila(
            paciente_id=p_master.id,
            tipo_fila="FILA_IMPORTADA_ERRONEA",
            exame=f"CHECKUP {i}",
            data_pedido=date(2026, 11, 1),
            status="aguardando",
            ativo=True,
        ))

    # Pedido laboratorial órfão (sem itens)
    lab_mestre = Laboratorio(nome="LABORATORIO REMEDIACAO T4", ativo=True)
    db.add(lab_mestre)
    db.commit()

    m_orfao = SolicitacaoMestre(
        paciente_id=p_master.id,
        laboratorio_id=lab_mestre.id,
        data_agendada=date(2026, 12, 1),
        status="agendado",
    )
    db.add(m_orfao)

    # Médicos duplicados por CRM
    m1 = Medico(nome="DRA. CARLA DIAS", crm="54321/MG", ativo=True)
    m2 = Medico(nome="CARLA DIAS", crm="54321-MG", ativo=True)
    db.add_all([m1, m2])
    db.commit()

    # --------------------------------------------------------------------------
    # Etapa 2: Diagnóstico Inicial
    # --------------------------------------------------------------------------
    diag_antes = diagnosticar_dados(db)
    assert diag_antes.resumo.pacientes.duplicidades >= 1
    assert diag_antes.resumo.laboratorio.inconsistencias >= 1
    assert diag_antes.resumo.cadastros.duplicidades >= 1

    # --------------------------------------------------------------------------
    # Etapa 3: Pré-visualização de Limpeza em Massa (Dry-Run)
    # --------------------------------------------------------------------------
    preview = preview_limpeza_massa(
        db,
        LimpezaMassaPreviewRequest(
            tipo_limpeza="fila_importada",
            filtro={"tipo_fila": "FILA_IMPORTADA_ERRONEA"},
        ),
    )
    assert preview.total_afetados == 3

    # --------------------------------------------------------------------------
    # Etapa 4: Unificação de Pacientes Duplicados
    # --------------------------------------------------------------------------
    res_unify = unificar_registros(
        db,
        UnificarRegistrosRequest(
            entidade="pacientes",
            registro_principal_id=p_master.id,
            registro_duplicado_id=p_dup.id,
        ),
        user=admin_user,
    )
    assert res_unify.sucesso is True
    assert db.get(Paciente, p_dup.id) is None
    db.refresh(ef_dup)
    assert ef_dup.paciente_id == p_master.id

    # --------------------------------------------------------------------------
    # Etapa 5: Execução da Limpeza em Massa Autenticada com Senha
    # --------------------------------------------------------------------------
    res_clean = executar_limpeza_massa(
        db,
        LimpezaMassaExecutarRequest(
            tipo_limpeza="fila_importada",
            filtro={"tipo_fila": "FILA_IMPORTADA_ERRONEA"},
            senha="admin_pass_123",
            confirmacao_explicita=True,
        ),
        admin=admin_user,
    )
    assert res_clean.sucesso is True
    assert res_clean.total_removidos == 3

    # Limpeza do pedido órfão
    res_orfaos = executar_limpeza_massa(
        db,
        LimpezaMassaExecutarRequest(
            tipo_limpeza="pedidos_orfaos",
            filtro={},
            senha="admin_pass_123",
            confirmacao_explicita=True,
        ),
        admin=admin_user,
    )
    assert res_orfaos.sucesso is True
    assert res_orfaos.total_removidos >= 1

    # --------------------------------------------------------------------------
    # Etapa 6: Diagnóstico Pós-Remediação
    # --------------------------------------------------------------------------
    diag_depois = diagnosticar_dados(db)
    # Duplicidade de pacientes foi sanada
    assert diag_depois.resumo.pacientes.duplicidades == 0
    # Inconsistência de pedidos de laboratório sem itens foi sanada
    assert diag_depois.resumo.laboratorio.inconsistencias == 0
    # Fila importada por engano não existe mais
    exames_restantes = db.exec(
        select(ExameFila).where(ExameFila.tipo_fila == "FILA_IMPORTADA_ERRONEA")
    ).all()
    assert len(exames_restantes) == 0

    # --------------------------------------------------------------------------
    # Etapa 7: Verificação da Trilha de Auditoria
    # --------------------------------------------------------------------------
    audit = listar_logs_auditoria_gerenciamento(db)
    assert audit.total >= 3
    eventos = [l.action for l in audit.logs]
    assert "DATA_UNIFY_PACIENTE" in eventos
    assert "DATA_MASS_CLEANUP" in eventos
    for log in audit.logs:
        assert log.user_name == admin_user.username
        assert log.timestamp is not None
        assert len(log.details) > 0


# ==============================================================================
# REST API ROUTER & SECURITY GUARDS (TestClient FastAPI)
# ==============================================================================

@pytest.fixture
def api_client(db: Session, admin_user: User, normal_user: User):
    """Instancia TestClient do FastAPI com as rotas reais de gerenciamento de dados."""
    from app.api.v1.gerenciamento_dados import router as gd_router
    from app.core.deps import get_current_user, get_db, require_senha_ok, require_superuser

    app = FastAPI()
    app.include_router(gd_router, prefix="/api/v1/gerenciamento-dados")
    app.include_router(gd_router, prefix="/api/gerenciamento-dados")

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_superuser] = lambda: admin_user
    app.dependency_overrides[require_senha_ok] = lambda: admin_user
    app.dependency_overrides[get_current_user] = lambda: admin_user

    client = TestClient(app)
    return client


def test_api_diagnostico_endpoint(api_client: TestClient, db: Session):
    """API: GET /api/v1/gerenciamento-dados/diagnostico retorna payload válido."""
    resp = api_client.get("/api/v1/gerenciamento-dados/diagnostico")
    assert resp.status_code == 200
    data = resp.json()
    assert "resumo" in data
    assert "detalhes" in data
    assert "pacientes" in data["resumo"]


def test_api_unificar_endpoint(api_client: TestClient, db: Session):
    """API: POST /api/v1/gerenciamento-dados/unificar unifica registros com sucesso."""
    p1 = Paciente(nome="API PRINCIPAL", cpf="87687687687")
    p2 = Paciente(nome="API DUP", cpf="87687687687")
    db.add_all([p1, p2])
    db.commit()

    payload = {
        "entidade": "pacientes",
        "registro_principal_id": p1.id,
        "registro_duplicado_id": p2.id,
    }
    resp = api_client.post("/api/v1/gerenciamento-dados/unificar", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["sucesso"] is True
    assert data["registro_excluido_id"] == p2.id


def test_api_limpeza_preview_endpoint(api_client: TestClient, db: Session):
    """API: POST /api/v1/gerenciamento-dados/limpeza-massa/preview retorna prévia."""
    payload = {
        "tipo_limpeza": "pedidos_orfaos",
        "filtro": {},
    }
    resp = api_client.post("/api/v1/gerenciamento-dados/limpeza-massa/preview", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "total_afetados" in data


def test_api_limpeza_executar_endpoint(api_client: TestClient, db: Session):
    """API: POST /api/v1/gerenciamento-dados/limpeza-massa/executar executa limpeza com senha."""
    payload = {
        "tipo_limpeza": "pedidos_orfaos",
        "filtro": {},
        "senha": "admin_pass_123",
        "confirmacao_explicita": True,
    }
    resp = api_client.post("/api/v1/gerenciamento-dados/limpeza-massa/executar", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["sucesso"] is True


def test_api_auditoria_endpoint(api_client: TestClient, db: Session):
    """API: GET /api/v1/gerenciamento-dados/auditoria retorna histórico de operações."""
    resp = api_client.get("/api/v1/gerenciamento-dados/auditoria")
    assert resp.status_code == 200
    data = resp.json()
    assert "logs" in data
    assert "total" in data


def test_api_security_guards_status_codes(db: Session, normal_user: User):
    """API: Garante 401 Unauthorized sem token e 403 Forbidden para não-superusuário."""
    from app.api.v1.gerenciamento_dados import router as gd_router
    from app.core.deps import get_current_user, get_db

    # 1. Teste de 401 Unauthorized para requisição sem autenticação
    app_auth = FastAPI()
    app_auth.include_router(gd_router, prefix="/api/v1/gerenciamento-dados")
    app_auth.dependency_overrides[get_db] = lambda: db
    client_unauth = TestClient(app_auth)

    resp_unauth = client_unauth.get("/api/v1/gerenciamento-dados/diagnostico")
    assert resp_unauth.status_code == status.HTTP_401_UNAUTHORIZED

    # 2. Router restrito testando guarda real de superusuário via dependência
    app_perm = FastAPI()
    app_perm.include_router(gd_router, prefix="/api/v1/gerenciamento-dados")
    app_perm.dependency_overrides[get_db] = lambda: db
    app_perm.dependency_overrides[get_current_user] = lambda: normal_user
    client_perm = TestClient(app_perm)

    # Chamada por usuário normal -> 403 Forbidden via dependência require_superuser real
    resp_forbidden = client_perm.post(
        "/api/v1/gerenciamento-dados/limpeza-massa/executar",
        json={"tipo_limpeza": "pedidos_orfaos", "senha": "qualquer_coisa", "confirmacao_explicita": True},
    )
    assert resp_forbidden.status_code == status.HTTP_403_FORBIDDEN
    assert "superusers" in resp_forbidden.text

    # Verifica também bloqueio no endpoint de unificação
    resp_unify = client_perm.post(
        "/api/v1/gerenciamento-dados/unificar",
        json={"entidade": "pacientes", "registro_principal_id": 1, "registro_duplicado_id": 2},
    )
    assert resp_unify.status_code == status.HTTP_403_FORBIDDEN
    assert "superusers" in resp_unify.text


def test_production_app_routes_registered():
    """Garante que app.main:app monta as rotas de gerenciamento de dados sob ambos os prefixos."""
    import sys
    from unittest.mock import MagicMock

    # Assegura stub seguro de bibliotecas opcionais de terceiros se ausentes no ambiente
    sys.modules.setdefault("openpyxl", MagicMock())
    sys.modules.setdefault("openpyxl.styles", MagicMock())
    sys.modules.setdefault("openpyxl.utils", MagicMock())

    from app.main import app

    schema = app.openapi()
    paths = set(schema.get("paths", {}).keys())

    expected_endpoints = [
        "/diagnostico",
        "/unificar",
        "/limpeza-massa/preview",
        "/limpeza-massa/executar",
        "/auditoria",
    ]

    for ep in expected_endpoints:
        v1_route = f"/api/v1/gerenciamento-dados{ep}"
        assert v1_route in paths, f"Rota de produção '{v1_route}' não registrada em app.main"

        std_route = f"/api/gerenciamento-dados{ep}"
        assert std_route in paths, f"Rota de produção '{std_route}' não registrada em app.main"


# ==============================================================================
# TIER 5 — ADVERSARIAL COVERAGE HARDENING REGRESSION TESTS
# ==============================================================================

def test_t5_1_unificacao_laboratorios_com_feriados_bloqueios(db: Session, admin_user: User):
    """T5.1: Valida unificação de laboratórios quando ambos possuem feriados/bloqueios.

    Garante que feriados na mesma data são deduplicados (excluídos) e feriados em
    datas distintas são reatribuídos ao registro mestre sem causar AttributeError.
    """
    l_mas = Laboratorio(nome="Laboratório Central Master", ativo=True)
    l_dup = Laboratorio(nome="Laboratório Central Dup", ativo=True)
    db.add_all([l_mas, l_dup])
    db.commit()

    # Feriados do master: 2026-12-25 (Natal) e 2026-01-01 (Ano Novo)
    fb_mas1 = LabFeriadoBloqueio(laboratorio_id=l_mas.id, data=date(2026, 12, 25), descricao="Natal")
    fb_mas2 = LabFeriadoBloqueio(laboratorio_id=l_mas.id, data=date(2026, 1, 1), descricao="Ano Novo")

    # Feriados do dup: 2026-12-25 (conflito duplicado) e 2026-05-01 (Dia do Trabalho, único do dup)
    fb_dup_conflito = LabFeriadoBloqueio(laboratorio_id=l_dup.id, data=date(2026, 12, 25), descricao="Natal Dup")
    fb_dup_unico = LabFeriadoBloqueio(laboratorio_id=l_dup.id, data=date(2026, 5, 1), descricao="Dia do Trabalho")

    db.add_all([fb_mas1, fb_mas2, fb_dup_conflito, fb_dup_unico])
    db.commit()

    req = UnificarRegistrosRequest(
        entidade="laboratorios",
        registro_principal_id=l_mas.id,
        registro_duplicado_id=l_dup.id,
    )
    resp = unificar_registros(db, req, user=admin_user)
    assert resp.sucesso is True

    # O laboratório duplicado deve ter sido excluído permanentemente
    assert db.get(Laboratorio, l_dup.id) is None

    # Todos os feriados restantes devem pertencer a l_mas.id
    feriados = db.exec(select(LabFeriadoBloqueio).where(LabFeriadoBloqueio.laboratorio_id == l_mas.id)).all()
    datas_restantes = {fb.data for fb in feriados}
    assert datas_restantes == {date(2026, 12, 25), date(2026, 1, 1), date(2026, 5, 1)}
    assert len(feriados) == 3

    # Nenhum feriado deve permanecer associado a l_dup.id
    feriados_dup = db.exec(select(LabFeriadoBloqueio).where(LabFeriadoBloqueio.laboratorio_id == l_dup.id)).all()
    assert len(feriados_dup) == 0


def test_t5_2_unificacao_laboratorios_com_fpo_itens(db: Session, admin_user: User):
    """T5.2: Valida unificação de laboratórios com competências FPO e itens de procedimento existentes.

    Garante que itens com mesmo sigtap_id são deduplicados e itens novos são migrados
    para a competência FPO do laboratório mestre sem causar AttributeError.
    """
    l_mas = Laboratorio(nome="Laboratório Diagnóstico Master", ativo=True)
    l_dup = Laboratorio(nome="Laboratório Diagnóstico Dup", ativo=True)
    db.add_all([l_mas, l_dup])
    db.commit()

    # Procedimentos SIGTAP
    proc1 = SigtapProcedimento(codigo="0202010121", descricao="GLICOSE")
    proc2 = SigtapProcedimento(codigo="0202010130", descricao="HEMOGRAMA COMPLETO")
    db.add_all([proc1, proc2])
    db.commit()

    # Competências FPO idênticas para a mesma competência mensal
    fpo_mas = LabFPOCompetencia(laboratorio_id=l_mas.id, competencia="2026-11")
    fpo_dup = LabFPOCompetencia(laboratorio_id=l_dup.id, competencia="2026-11")
    db.add_all([fpo_mas, fpo_dup])
    db.commit()

    # Itens do master: proc1
    it_mas = LabFPOItem(fpo_id=fpo_mas.id, sigtap_id=proc1.id, codigo_procedimento="0202010121", quantidade_aprovada=100)
    # Itens do dup: proc1 (duplicado conflitante) e proc2 (novo, a ser migrado)
    it_dup_conflito = LabFPOItem(fpo_id=fpo_dup.id, sigtap_id=proc1.id, codigo_procedimento="0202010121", quantidade_aprovada=50)
    it_dup_migrar = LabFPOItem(fpo_id=fpo_dup.id, sigtap_id=proc2.id, codigo_procedimento="0202010130", quantidade_aprovada=200)

    db.add_all([it_mas, it_dup_conflito, it_dup_migrar])
    db.commit()

    req = UnificarRegistrosRequest(
        entidade="laboratorios",
        registro_principal_id=l_mas.id,
        registro_duplicado_id=l_dup.id,
    )
    resp = unificar_registros(db, req, user=admin_user)
    assert resp.sucesso is True

    # Laboratório duplicado e sua competência excluídos
    assert db.get(Laboratorio, l_dup.id) is None
    assert db.get(LabFPOCompetencia, fpo_dup.id) is None

    # Competência do mestre agora contém proc1 e proc2
    itens_restantes = db.exec(select(LabFPOItem).where(LabFPOItem.fpo_id == fpo_mas.id)).all()
    sigtap_ids_restantes = {it.sigtap_id for it in itens_restantes}
    assert sigtap_ids_restantes == {proc1.id, proc2.id}
    assert len(itens_restantes) == 2

    # O item de proc1 conflitante do dup foi removido
    assert db.get(LabFPOItem, it_dup_conflito.id) is None
    # O item de proc2 foi migrado para fpo_mas.id
    it2_atualizado = db.get(LabFPOItem, it_dup_migrar.id)
    assert it2_atualizado is not None
    assert it2_atualizado.fpo_id == fpo_mas.id


def test_t5_3_unificacao_campos_mesclar_ignora_campos_protegidos(db: Session, admin_user: User):
    """T5.3: Valida que campos protegidos (id, _sa_instance_state, created_at) são ignorados em campos_mesclar.

    Garante que tentativas de sobrescrever a chave primária ou estado interno via campos_mesclar
    são ignoradas com segurança e não alteram o ID do registro principal nas 4 entidades.
    """
    # 1. Pacientes
    p_mas = Paciente(nome="Paciente Protegido Master", cpf="11122233344")
    p_dup = Paciente(nome="Paciente Protegido Dup", cpf="11122233355")
    db.add_all([p_mas, p_dup])
    db.commit()
    orig_p_id = p_mas.id

    resp_p = unificar_registros(
        db,
        UnificarRegistrosRequest(
            entidade="pacientes",
            registro_principal_id=orig_p_id,
            registro_duplicado_id=p_dup.id,
            campos_mesclar={"id": 999901, "_sa_instance_state": None, "created_at": datetime(2000, 1, 1), "nome": "Paciente Nome Atualizado"},
        ),
        user=admin_user,
    )
    assert resp_p.sucesso is True
    p_reloaded = db.get(Paciente, orig_p_id)
    assert p_reloaded is not None
    assert p_reloaded.id == orig_p_id
    assert p_reloaded.nome == "Paciente Nome Atualizado"
    assert db.get(Paciente, 999901) is None

    # 2. Médicos
    m_mas = Medico(nome="Dr. Protegido Master", crm="12345-MG")
    m_dup = Medico(nome="Dr. Protegido Dup", crm="54321-MG")
    db.add_all([m_mas, m_dup])
    db.commit()
    orig_m_id = m_mas.id

    resp_m = unificar_registros(
        db,
        UnificarRegistrosRequest(
            entidade="medicos",
            registro_principal_id=orig_m_id,
            registro_duplicado_id=m_dup.id,
            campos_mesclar={"id": 999902, "_sa_instance_state": None, "nome": "Dr. Nome Atualizado"},
        ),
        user=admin_user,
    )
    assert resp_m.sucesso is True
    m_reloaded = db.get(Medico, orig_m_id)
    assert m_reloaded is not None
    assert m_reloaded.id == orig_m_id
    assert m_reloaded.nome == "Dr. Nome Atualizado"
    assert db.get(Medico, 999902) is None

    # 3. Unidades
    u_mas = UnidadeSaude(nome="UBS Protegida Master", cnes="1111111")
    u_dup = UnidadeSaude(nome="UBS Protegida Dup", cnes="2222222")
    db.add_all([u_mas, u_dup])
    db.commit()
    orig_u_id = u_mas.id

    resp_u = unificar_registros(
        db,
        UnificarRegistrosRequest(
            entidade="unidades",
            registro_principal_id=orig_u_id,
            registro_duplicado_id=u_dup.id,
            campos_mesclar={"id": 999903, "_sa_instance_state": None, "nome": "UBS Nome Atualizado"},
        ),
        user=admin_user,
    )
    assert resp_u.sucesso is True
    u_reloaded = db.get(UnidadeSaude, orig_u_id)
    assert u_reloaded is not None
    assert u_reloaded.id == orig_u_id
    assert u_reloaded.nome == "UBS Nome Atualizado"
    assert db.get(UnidadeSaude, 999903) is None

    # 4. Laboratórios
    l_mas = Laboratorio(nome="Lab Protegido Master", ativo=True)
    l_dup = Laboratorio(nome="Lab Protegido Dup", ativo=True)
    db.add_all([l_mas, l_dup])
    db.commit()
    orig_l_id = l_mas.id

    resp_l = unificar_registros(
        db,
        UnificarRegistrosRequest(
            entidade="laboratorios",
            registro_principal_id=orig_l_id,
            registro_duplicado_id=l_dup.id,
            campos_mesclar={"id": 999904, "_sa_instance_state": None, "nome": "Lab Nome Atualizado"},
        ),
        user=admin_user,
    )
    assert resp_l.sucesso is True
    l_reloaded = db.get(Laboratorio, orig_l_id)
    assert l_reloaded is not None
    assert l_reloaded.id == orig_l_id
    assert l_reloaded.nome == "Lab Nome Atualizado"
    assert db.get(Laboratorio, 999904) is None

