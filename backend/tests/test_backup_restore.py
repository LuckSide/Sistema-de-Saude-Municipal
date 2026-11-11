from datetime import date, datetime
import gzip
import json

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import event, inspect, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.deps import get_db, require_senha_ok, require_superuser
from app.db.session import _sincronizar_colunas_faltantes
from app.main import app
from app.models.apac import (
    AnexoLaudoAPAC,
    ProcedimentoSecundarioAPAC,
    SolicitacaoAPAC,
)
from app.models.audit import AuditLog
from app.models.cadastros_saude import Medico
from app.models.dashboard_prefs import UserDashboardPrefs
from app.models.farmacia import Medicamento, MovimentacaoMedicamento
from app.models.integracoes import IntegrationSettings, PecSyncLog, WhatsAppLog
from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import (
    FilaPsf,
    ItemSolic,
    Laboratorio,
    LabPedidoAjuste,
    SolicitacaoMestre,
)
from app.models.oxigenio import (
    CilindroVazioRecolhimento,
    EmprestimoOxigenio,
    EmpresaOxigenio,
    EquipamentoRespiratorio,
    ItemEmprestimoOxigenio,
    LicitacaoContratoOxigenio,
    TrocaCilindroHistorico,
)
from app.models.tfd import ExameFila, Paciente
from app.models.user import User
from app.services.backup_crypto import criptografar_dados
from app.services.backup_service import (
    MODELOS_ORDENADOS,
    gerar_dump_dados,
    restaurar_dump_dados,
)


@pytest.fixture(name="engine_fk")
def engine_fk_fixture():
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
    return engine


def test_restaurar_limpa_tabelas_extras_com_fk_em_ordem_e_faz_commit(engine_fk):
    with Session(engine_fk) as db:
        admin = User(
            id=1,
            username="admin",
            password_hash="hash",
            nome="Administrador",
            is_superuser=True,
            is_active=True,
            must_change_password=False,
        )
        pac = Paciente(id=10, nome="Paciente Seed", updated_at=None)
        med = Medico(id=20, nome="Dr. Seed")
        lab = Laboratorio(id=30, nome="Lab Seed")
        sigtap = SigtapProcedimento(id=40, codigo="020101001", descricao="Hemograma")
        emp = EmpresaOxigenio(id=1, razao_social="Empresa Oxigenio")
        lic = LicitacaoContratoOxigenio(
            id=1, empresa_id=1, numero_licitacao="001/2026"
        )
        equip = EquipamentoRespiratorio(
            id=1, tipo="CPAP", empresa_id=1, status="EM_USO"
        )
        db.add_all([admin, pac, med, lab, sigtap, emp, lic, equip])
        db.flush()

        # Registros extras em cadeias de FK apontando para oxigenio_emprestimos, apac_solicitacoes e lab_solic_mestre
        emprestimo = EmprestimoOxigenio(
            id=1,
            paciente_id=10,
            paciente_nome="Paciente Seed",
            tipo_servico="MAQUINA",
            equipamento_id=1,
            empresa_id=1,
            licitacao_id=1,
            data_instalacao=date(2026, 1, 10),
            updated_at=None,
        )
        db.add(emprestimo)
        db.flush()

        db.add(
            ItemEmprestimoOxigenio(
                id=1,
                emprestimo_id=1,
                tipo_servico="MAQUINA",
                equipamento_id=1,
            )
        )
        db.add(
            TrocaCilindroHistorico(
                id=1,
                emprestimo_id=1,
                paciente_id=10,
                data_troca=date(2026, 1, 15),
                tipo_cilindro="10m3",
                empresa_id=1,
            )
        )
        db.add(
            CilindroVazioRecolhimento(
                id=1,
                paciente_id=10,
                paciente_nome="Paciente Seed",
                emprestimo_id=1,
                empresa_id=1,
                tipo_cilindro="10m3",
                data_geracao=date(2026, 1, 16),
            )
        )

        sol_apac = SolicitacaoAPAC(
            id=1,
            paciente_id=10,
            paciente_nome="Paciente Seed",
            medico_solicitante_id=20,
            medico_solicitante_nome="Dr. Seed",
            procedimento_principal_codigo="0305010107",
            procedimento_principal_nome="Hemodialise",
            cid_principal_codigo="N180",
            data_solicitacao=date(2026, 2, 1),
            updated_at=None,
        )
        db.add(sol_apac)
        db.flush()

        db.add(
            ProcedimentoSecundarioAPAC(
                id=1,
                solicitacao_apac_id=1,
                codigo="020101001",
                descricao="Secundario",
            )
        )
        db.add(
            AnexoLaudoAPAC(
                id=1,
                solicitacao_apac_id=1,
                titulo="Laudo",
                nome_arquivo="laudo.pdf",
            )
        )

        fila_psf = FilaPsf(
            id=1, paciente_id=10, data_solicitacao=date(2026, 2, 2)
        )
        db.add(fila_psf)
        db.flush()

        mestre = SolicitacaoMestre(
            id=1,
            paciente_id=10,
            data_agendada=date(2026, 2, 3),
            laboratorio_id=30,
            origem_fila_id=1,
        )
        db.add(mestre)
        db.flush()

        db.add(ItemSolic(id=1, solicitacao_id=1, sigtap_id=40))
        db.add(
            LabPedidoAjuste(
                id=1,
                solicitacao_id=1,
                laboratorio_id=30,
                justificativa="Ajuste de teste",
            )
        )
        db.commit()

    dump = {
        "versao": "1.0",
        "data_geracao": "2026-11-09T23:08:30",
        "tabelas": {
            "usuarios": [
                {
                    "id": 1,
                    "username": "admin",
                    "password_hash": "novo_hash",
                    "nome": "Admin Restaurado",
                    "is_superuser": True,
                    "is_active": True,
                    "must_change_password": False,
                    "created_at": "2026-11-09T23:00:00",
                }
            ],
            "user_dashboard_preferences": [
                {
                    "user_id": 1,
                    "layout": "[]",
                    "quadro_filtros": "{}",
                    "updated_at": None,
                }
            ],
            "tfd_pacientes": [
                {
                    "id": 99,
                    "nome": "Paciente Restaurado",
                    "updated_at": None,
                    "created_at": "2026-11-09T23:00:00",
                }
            ],
        },
    }

    # Simula get_db() após get_current_user(): transação já aberta antes de restaurar_dump_dados
    with Session(engine_fk) as db:
        _ = db.exec(select(User).where(User.username == "admin")).first()
        assert db.in_transaction()
        resultado = restaurar_dump_dados(db, dump, autor_id=1)

    assert resultado["ok"] is True
    assert resultado["total_registros_restaurados"] == 3

    # Verifica em uma NOVA sessão que o commit realmente persistiu no banco
    with Session(engine_fk) as verify_db:
        pacientes = verify_db.exec(select(Paciente)).all()
        assert [(p.id, p.nome, p.updated_at) for p in pacientes] == [
            (99, "Paciente Restaurado", None)
        ]
        prefs = verify_db.exec(select(UserDashboardPrefs)).all()
        assert len(prefs) == 1 and prefs[0].user_id == 1

        # Tabelas extras dependentes foram limpas; empresa de oxigênio sem FK ao dump permanece
        assert verify_db.exec(select(EmprestimoOxigenio)).all() == []
        assert verify_db.exec(select(ItemEmprestimoOxigenio)).all() == []
        assert verify_db.exec(select(SolicitacaoAPAC)).all() == []
        assert verify_db.exec(select(AnexoLaudoAPAC)).all() == []
        assert verify_db.exec(select(LabPedidoAjuste)).all() == []
        assert len(verify_db.exec(select(EmpresaOxigenio)).all()) == 1

        logs = verify_db.exec(
            select(AuditLog).where(AuditLog.action == "restaurar_backup")
        ).all()
        assert len(logs) == 1


def test_restaurar_em_lote_grande_e_rollback_em_erro(engine_fk):
    # Insere 1500 pacientes (> batch size) para validar chunking e rollback atômico
    pacientes_dump = [
        {
            "id": i,
            "nome": f"Paciente {i}",
            "updated_at": None,
            "created_at": "2026-11-09T23:00:00",
        }
        for i in range(1, 1501)
    ]
    dump_ok = {
        "versao": "1.0",
        "tabelas": {
            "usuarios": [
                {
                    "id": 1,
                    "username": "admin",
                    "password_hash": "hash",
                    "is_superuser": True,
                    "is_active": True,
                    "must_change_password": False,
                }
            ],
            "tfd_pacientes": pacientes_dump,
        },
    }

    with Session(engine_fk) as db:
        res = restaurar_dump_dados(db, dump_ok, autor_id=1)
    assert res["contadores"]["tfd_pacientes"] == 1500

    # Tentativa com registro inválido deve preservar os 1500 pacientes anteriores (savepoint rollback)
    dump_invalido = {
        "versao": "1.0",
        "tabelas": {
            "usuarios": dump_ok["tabelas"]["usuarios"],
            "tfd_pacientes": [{"id": 9999}],  # falta campo obrigatório 'nome'
        },
    }
    with Session(engine_fk) as db:
        with pytest.raises(ValueError, match="tfd_pacientes"):
            restaurar_dump_dados(db, dump_invalido, autor_id=1)

    with Session(engine_fk) as verify_db:
        assert len(verify_db.exec(select(Paciente)).all()) == 1500


def test_endpoint_restaurar_backup_bak(engine_fk):
    with Session(engine_fk) as db:
        admin = User(
            id=1,
            username="admin",
            password_hash="hash",
            nome="Admin",
            is_superuser=True,
            is_active=True,
            must_change_password=False,
        )
        db.add(admin)
        db.add(Paciente(id=5, nome="Antigo"))
        db.commit()

    dump_json = {
        "versao": "1.0",
        "data_geracao": datetime(2026, 11, 9, 23, 8, 30).isoformat(),
        "tabelas": {
            "usuarios": [
                {
                    "id": 1,
                    "username": "admin",
                    "password_hash": "hash",
                    "nome": "Admin",
                    "is_superuser": True,
                    "is_active": True,
                    "must_change_password": False,
                }
            ],
            "tfd_pacientes": [
                {"id": 77, "nome": "Restaurado via Endpoint", "updated_at": None}
            ],
        },
    }
    bak_bytes = criptografar_dados(
        gzip.compress(json.dumps(dump_json).encode("utf-8")), "mates2134"
    )

    def _override_db():
        with Session(engine_fk) as session:
            yield session

    admin_mock = User(
        id=1,
        username="admin",
        password_hash="hash",
        is_superuser=True,
        is_active=True,
        must_change_password=False,
    )
    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[require_superuser] = lambda: admin_mock
    app.dependency_overrides[require_senha_ok] = lambda: admin_mock
    try:
        client = TestClient(app)
        resp = client.post(
            "/api/backup/restaurar",
            files={"arquivo": ("backup.bak", bak_bytes, "application/octet-stream")},
            data={"senha": "mates2134"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is True
        assert body["detalhes"]["total_registros_restaurados"] == 2
    finally:
        app.dependency_overrides.clear()

    with Session(engine_fk) as verify_db:
        pacs = verify_db.exec(select(Paciente)).all()
        assert [(p.id, p.nome) for p in pacs] == [(77, "Restaurado via Endpoint")]
        roundtrip = gerar_dump_dados(verify_db)
        assert len(roundtrip["tabelas"]["tfd_pacientes"]) == 1


def test_backup_cobre_todas_as_tabelas_do_sistema():
    assert {m.__tablename__ for m in MODELOS_ORDENADOS} == set(
        SQLModel.metadata.tables.keys()
    )


def test_gerar_dump_com_coluna_ausente_nao_zera_tabelas_seguintes():
    legacy_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with legacy_engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE tfd_pacientes (id INTEGER PRIMARY KEY, nome VARCHAR(150) NOT NULL)"
            )
        )
        # Simula banco legado onde 'instrucoes_transporte' ainda não existe em tfd_exames_fila
        conn.execute(
            text(
                "CREATE TABLE tfd_exames_fila (id INTEGER PRIMARY KEY, paciente_id INTEGER NOT NULL, exame VARCHAR(120) NOT NULL, data_pedido DATE NOT NULL)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE sigtap_procedimentos (id INTEGER PRIMARY KEY, codigo VARCHAR(20) NOT NULL, descricao VARCHAR(255) NOT NULL)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE lab_laboratorios (id INTEGER PRIMARY KEY, nome VARCHAR(120) NOT NULL, ativo BOOLEAN NOT NULL)"
            )
        )
        conn.execute(
            text("INSERT INTO tfd_pacientes (id, nome) VALUES (1, 'Maria Teste')")
        )
        conn.execute(
            text(
                "INSERT INTO tfd_exames_fila (id, paciente_id, exame, data_pedido) VALUES (5, 1, 'Raio-X', '2026-11-09')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO sigtap_procedimentos (id, codigo, descricao) VALUES (1, '020101', 'Exame SIGTAP')"
            )
        )
        conn.execute(
            text("INSERT INTO lab_laboratorios (id, nome, ativo) VALUES (1, 'Lab Central', 1)")
        )

    with Session(legacy_engine) as db:
        dump = gerar_dump_dados(db)

    assert len(dump["tabelas"]["tfd_exames_fila"]) == 1
    assert dump["tabelas"]["tfd_exames_fila"][0]["exame"] == "Raio-X"
    assert len(dump["tabelas"]["sigtap_procedimentos"]) == 1
    assert len(dump["tabelas"]["lab_laboratorios"]) == 1


def test_gerar_dump_falha_explicita_quando_tabela_quebra(engine_fk, monkeypatch):
    with Session(engine_fk) as db:
        db.add(Paciente(id=1, nome="Teste"))
        db.commit()

        orig_execute = db.execute

        def _fail_exame(stmt, *args, **kwargs):
            if "tfd_exames_fila" in str(stmt):
                raise RuntimeError("Erro simulado de leitura")
            return orig_execute(stmt, *args, **kwargs)

        monkeypatch.setattr(db, "execute", _fail_exame)
        with pytest.raises(ValueError, match="tfd_exames_fila"):
            gerar_dump_dados(db)


def test_sincronizar_colunas_faltantes_adiciona_colunas_em_banco_legado():
    legacy_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with legacy_engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE tfd_exames_fila (id INTEGER PRIMARY KEY, paciente_id INTEGER NOT NULL, exame VARCHAR(120) NOT NULL, data_pedido DATE NOT NULL)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE lab_solic_mestre (id INTEGER PRIMARY KEY, paciente_id INTEGER NOT NULL, data_agendada DATE NOT NULL, laboratorio_id INTEGER NOT NULL)"
            )
        )
        conn.execute(text("CREATE TABLE integration_settings (id INTEGER PRIMARY KEY)"))

    _sincronizar_colunas_faltantes(legacy_engine)

    insp = inspect(legacy_engine)
    cols_exames = {c["name"] for c in insp.get_columns("tfd_exames_fila")}
    cols_mestre = {c["name"] for c in insp.get_columns("lab_solic_mestre")}
    cols_int = {c["name"] for c in insp.get_columns("integration_settings")}

    assert "instrucoes_transporte" in cols_exames
    assert "instrucoes_transporte" in cols_mestre
    assert "whatsapp_habilitado" in cols_int


def test_roundtrip_completo_todos_os_modulos(engine_fk):
    with Session(engine_fk) as db:
        db.add(
            User(
                id=1,
                username="admin",
                password_hash="hash",
                nome="Admin",
                is_superuser=True,
                is_active=True,
                must_change_password=False,
            )
        )
        db.add(Paciente(id=10, nome="Paciente Completo"))
        db.add(Medico(id=20, nome="Dr. Completo"))
        db.add(Laboratorio(id=30, nome="Lab Completo"))
        db.add(
            ExameFila(
                id=100,
                paciente_id=10,
                exame="Ressonância",
                data_pedido=date(2026, 11, 8),
                instrucoes_transporte="Sair às 05:30",
            )
        )
        db.add(EmpresaOxigenio(id=1, razao_social="Gas Guape"))
        db.add(
            LicitacaoContratoOxigenio(
                id=1,
                empresa_id=1,
                numero_licitacao="002/2026",
                data_inicio=None,
                data_fim=None,
            )
        )
        db.add(
            EmprestimoOxigenio(
                id=1,
                paciente_id=10,
                paciente_nome="Paciente Completo",
                tipo_servico="OXIGENIO",
                empresa_id=1,
                licitacao_id=1,
                data_instalacao=date(2026, 11, 1),
            )
        )
        db.add(
            SolicitacaoAPAC(
                id=1,
                paciente_id=10,
                paciente_nome="Paciente Completo",
                medico_solicitante_id=20,
                medico_solicitante_nome="Dr. Completo",
                procedimento_principal_codigo="0305010107",
                procedimento_principal_nome="Hemodialise",
                cid_principal_codigo="N180",
                data_solicitacao=date(2026, 11, 2),
            )
        )
        db.add(
            AnexoLaudoAPAC(
                id=1,
                solicitacao_apac_id=1,
                titulo="Laudo",
                nome_arquivo="laudo.pdf",
            )
        )
        db.add(Medicamento(id=1, codigo="MED-01", nome="Dipirona 500mg"))
        db.add(
            MovimentacaoMedicamento(
                id=1, medicamento_id=1, medicamento_nome="Dipirona 500mg", tipo="ENTRADA_COMPRA"
            )
        )
        db.add(PecSyncLog(id=1, status="SUCESSO", total_lidos=10))
        db.add(WhatsAppLog(id=1, paciente_id=10, mensagem="Confirmado"))
        db.add(IntegrationSettings(id=1))
        db.commit()

        dump = gerar_dump_dados(db)

    assert len(dump["tabelas"]) == len(MODELOS_ORDENADOS)
    assert len(dump["tabelas"]["tfd_exames_fila"]) == 1
    assert len(dump["tabelas"]["oxigenio_emprestimos"]) == 1
    assert len(dump["tabelas"]["apac_anexos"]) == 1
    assert len(dump["tabelas"]["farmacia_movimentacoes"]) == 1
    assert len(dump["tabelas"]["pec_sync_logs"]) == 1
    assert len(dump["tabelas"]["whatsapp_logs"]) == 1

    # Restaura em um banco limpo e confirma preservação integral de todos os módulos
    engine_destino = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine_destino, "connect")
    def _enable_fk_dest(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(engine_destino)

    with Session(engine_destino) as dest_db:
        res = restaurar_dump_dados(dest_db, dump, autor_id=1)
        assert res["ok"] is True

    with Session(engine_destino) as verify_db:
        exames = verify_db.exec(select(ExameFila)).all()
        assert [(e.id, e.exame, e.instrucoes_transporte) for e in exames] == [
            (100, "Ressonância", "Sair às 05:30")
        ]
        assert len(verify_db.exec(select(LicitacaoContratoOxigenio)).all()) == 1
        assert len(verify_db.exec(select(EmprestimoOxigenio)).all()) == 1
        assert len(verify_db.exec(select(AnexoLaudoAPAC)).all()) == 1
        assert len(verify_db.exec(select(MovimentacaoMedicamento)).all()) == 1
        assert len(verify_db.exec(select(PecSyncLog)).all()) == 1
        assert len(verify_db.exec(select(WhatsAppLog)).all()) == 1
