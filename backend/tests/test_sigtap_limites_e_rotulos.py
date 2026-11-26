from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.v1.lab import criar_sigtap, listar_sigtap
from app.api.v1.tfd import criar_procedimento
from app.models.lab_exames import SigtapProcedimento
from app.models.tfd import ExameFila, Faturamento, Paciente, ProcedimentoCatalogo
from app.models.user import User
from app.schemas.lab import SigtapIn
from app.schemas.tfd import ExameIn, ExameLoteCriarIn, ExameLoteCriarItemIn, FaturaIn, ProcedimentoIn
from app.services.sigtap_hierarquia import migrar_colunas_sigtap_amplas
from app.services.sigtap_import import importar_sigtap


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        user = User(
            id=1,
            username="admin_sigtap",
            nome="Admin SIGTAP",
            password_hash="hash",
            is_active=True,
            is_superuser=True,
            must_change_password=False,
            telas="lab,usuarios,tfd,configuracoes",
        )
        pac = Paciente(id=1, nome="PACIENTE TESTE SIGTAP", cpf="11122233344")
        db.add(user)
        db.add(pac)
        db.commit()
        db.refresh(user)
        yield db


def test_criar_e_listar_sigtap_nome_longo_sem_truncamento(session):
    user = session.exec(select(User)).first()
    nome_longo = (
        "TESTE CONFIRMATORIO POR IMUNOFLUORESCENCIA INDIRETA OU WESTERN BLOT PARA DIAGNOSTICO "
        "DE INFECCAO POR VIRUS DA IMUNODEFICIENCIA HUMANA COM PESQUISA COMPLEMENTAR DE ANTICORPOS "
        "ESPECIFICOS E DETALHAMENTO MOLECULAR DE SUBTIPOS CIRCULANTES EM AMOSTRA DE SORO OU PLASMA "
        "HUMANO COM LAUDO TECNICO DETALHADO E CONTROLE DE QUALIDADE"
    )
    assert len(nome_longo) > 300

    payload = SigtapIn(
        codigo="0202039999",
        descricao=nome_longo,
        complexidade="MC",
        instrumento="BPA-I",
        valor_sa=45.90,
        sem_codigo_especifico=False,
    )
    criado = criar_sigtap(data=payload, db=session, user=user)
    assert len(criado.descricao) == len(nome_longo)
    assert criado.descricao == nome_longo

    listagem = listar_sigtap(q="IMUNOFLUORESCENCIA INDIRETA", db=session, _=user)
    assert listagem["total"] == 1
    assert listagem["data"][0].descricao == nome_longo


def test_procedimento_catalogo_exame_fila_e_fatura_nomes_longos(session):
    nome_longo = "X" * 340
    proc_in = ProcedimentoIn(
        codigo="9900000123",
        nome=nome_longo,
        tipo_fila="EXAMES ESPECIALIZADOS",
        sem_codigo_especifico=True,
        codigo_faturamento_sigtap="0205020186",
        ativo=True,
    )
    proc_criado = criar_procedimento(data=proc_in, db=session, _=None)
    assert len(proc_criado.nome) == 340
    assert proc_criado.nome == nome_longo

    exame_schema = ExameIn(
        paciente_id=1,
        exame=nome_longo,
        especialidade="CLINICA MEDICA",
        data_pedido=date(2026, 11, 26),
        justificativa="Justificativa clinica completa para teste de limite ampliado.",
    )
    assert len(exame_schema.exame) == 340

    lote_schema = ExameLoteCriarIn(
        tipo_fila="EXAMES ESPECIALIZADOS",
        exame=nome_longo,
        itens=[ExameLoteCriarItemIn(paciente_id=1)],
    )
    assert len(lote_schema.exame) == 340

    fatura_schema = FaturaIn(
        paciente_id=1,
        procedimento=nome_longo,
        codigo_sigtap="0205020186",
        competencia="2026-11",
        quantidade=1,
        valor=50.0,
    )
    assert len(fatura_schema.procedimento) == 340

    ex_db = ExameFila(
        paciente_id=1,
        exame=nome_longo,
        especialidade="CLINICA MEDICA",
        data_pedido=date(2026, 11, 26),
    )
    fat_db = Faturamento(
        paciente_id=1,
        procedimento=nome_longo,
        codigo_sigtap="0205020186",
        competencia="2026-11",
    )
    session.add(ex_db)
    session.add(fat_db)
    session.commit()
    session.refresh(ex_db)
    session.refresh(fat_db)
    assert ex_db.exame == nome_longo
    assert fat_db.procedimento == nome_longo


def test_importar_sigtap_csv_sem_truncamento_255(session):
    nome_320 = ("DOSAGEM CONFIRMATORIA DE PAINEL MOLECULAR " * 8).strip()[:320]
    assert len(nome_320) == 320
    csv_conteudo = (
        "codigo;descricao;complexidade;instrumento;valor_sa;valor_sp;valor_sh\n"
        f"0202019991;{nome_320};AC;BPA-I;120.50;0;0\n"
    ).encode("utf-8")

    stats = importar_sigtap(
        session,
        [("procedimentos_amplos.csv", csv_conteudo)],
        "2026-11",
        "admin_sigtap",
        simular=False,
    )
    assert stats["inseridos"] == 1
    proc = session.exec(
        select(SigtapProcedimento).where(SigtapProcedimento.codigo == "0202019991")
    ).first()
    assert proc is not None
    assert proc.descricao == nome_320
    assert len(proc.descricao) == 320


def test_migrar_colunas_sigtap_amplas_sqlite_e_postgres_simulado(session):
    # Em SQLite é no-op seguro
    conn_sqlite = session.connection()
    res_sqlite = migrar_colunas_sigtap_amplas(conn_sqlite)
    assert res_sqlite["dialect"] == "sqlite"
    assert res_sqlite["alteradas"] == []

    # Em PostgreSQL simulado: altera colunas VARCHAR para TEXT e ignora as que já são TEXT (idempotência)
    mock_conn = MagicMock()
    mock_conn.dialect.name = "postgresql"
    mock_conn.begin_nested.return_value.__enter__ = MagicMock(return_value=None)
    mock_conn.begin_nested.return_value.__exit__ = MagicMock(return_value=False)

    mock_insp = MagicMock()
    mock_insp.has_table.return_value = True

    def _cols_por_tabela(tabela):
        if tabela == "sigtap_procedimentos":
            return [
                {"name": "descricao", "type": "VARCHAR(255)"},
                {"name": "grupo_nome", "type": "VARCHAR(150)"},
                {"name": "subgrupo_nome", "type": "TEXT"},  # já migrada -> deve pular
                {"name": "forma_organizacao_nome", "type": "VARCHAR(180)"},
            ]
        if tabela == "tfd_procedimentos":
            return [{"name": "nome", "type": "VARCHAR(150)"}]
        if tabela == "tfd_exames_fila":
            return [{"name": "exame", "type": "VARCHAR(120)"}]
        if tabela == "tfd_faturamento":
            return [{"name": "procedimento", "type": "VARCHAR(150)"}]
        return [{"name": "nome", "type": "VARCHAR(150)"}, {"name": "descricao", "type": "VARCHAR(150)"}]

    mock_insp.get_columns.side_effect = _cols_por_tabela

    with patch("sqlalchemy.inspect", return_value=mock_insp):
        res_pg = migrar_colunas_sigtap_amplas(mock_conn)

    assert res_pg["dialect"] == "postgresql"
    assert "sigtap_procedimentos.descricao" in res_pg["alteradas"]
    assert "sigtap_procedimentos.grupo_nome" in res_pg["alteradas"]
    assert "sigtap_procedimentos.subgrupo_nome" not in res_pg["alteradas"]
    assert "tfd_procedimentos.nome" in res_pg["alteradas"]
    assert "tfd_exames_fila.exame" in res_pg["alteradas"]
    assert "tfd_faturamento.procedimento" in res_pg["alteradas"]
    assert mock_conn.execute.call_count == len(res_pg["alteradas"])


def test_rotulos_financeiros_padronizados_no_frontend():
    raiz = Path(__file__).resolve().parents[2]
    config_tsx = (raiz / "frontend" / "src" / "pages" / "Configuracoes.tsx").read_text(encoding="utf-8")
    fat_tsx = (raiz / "frontend" / "src" / "pages" / "lab" / "LabFaturamento.tsx").read_text(encoding="utf-8")

    assert "Valor Contrato Local" in config_tsx
    assert "Valor SIGTAP/SUS" in config_tsx
    assert "Valor Combinado Local" not in config_tsx
    assert "Valor combinado local" not in config_tsx

    assert "Valor SIGTAP/SUS" in fat_tsx
    assert "Valor Contrato Local" in fat_tsx
    assert "Valor SIGTAP oficial" not in fat_tsx
