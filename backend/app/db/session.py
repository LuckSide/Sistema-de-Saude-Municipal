import logging
from sqlalchemy import inspect, text
from sqlmodel import SQLModel, create_engine

from app.core.config import settings

_session_log = logging.getLogger("db.session")

pool_kwargs = {}
if "postgresql" in settings.DATABASE_URL:
    pool_kwargs = {
        "pool_size": settings.DB_POOL_SIZE,
        "max_overflow": settings.DB_MAX_OVERFLOW,
        "pool_timeout": settings.DB_POOL_TIMEOUT,
        "pool_recycle": settings.DB_POOL_RECYCLE,
    }

engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    **pool_kwargs,
)


def _sincronizar_colunas_faltantes(target_engine) -> None:
    """Adiciona automaticamente colunas dos modelos SQLModel ausentes em bancos antigos.

    Cada DDL roda em savepoint isolado para que nenhuma falha pontual aborte
    a transação PostgreSQL e impeça os demais ajustes de schema.
    """
    try:
        with target_engine.begin() as conn:
            insp = inspect(conn)
            existing_tables = set(insp.get_table_names())
            try:
                tables_list = SQLModel.metadata.sorted_tables
            except Exception:
                tables_list = list(SQLModel.metadata.tables.values())

            for table in tables_list:
                if table.name not in existing_tables:
                    continue
                try:
                    existing_cols = {c["name"] for c in insp.get_columns(table.name)}
                except Exception:
                    continue

                for col in table.columns:
                    if col.primary_key or col.name in existing_cols:
                        continue
                    try:
                        col_type_sql = col.type.compile(dialect=conn.dialect)
                        if (
                            col.default is not None
                            and getattr(col.default, "is_scalar", False)
                            and isinstance(col.default.arg, (str, int, float, bool))
                        ):
                            arg = col.default.arg
                            if isinstance(arg, bool):
                                default_sql = "TRUE" if arg else "FALSE"
                            elif isinstance(arg, (int, float)):
                                default_sql = str(arg)
                            else:
                                default_sql = "'" + str(arg).replace("'", "''") + "'"
                            not_null = " NOT NULL" if not col.nullable else ""
                            ddl = f"ALTER TABLE {table.name} ADD COLUMN {col.name} {col_type_sql} DEFAULT {default_sql}{not_null}"
                        else:
                            ddl = f"ALTER TABLE {table.name} ADD COLUMN {col.name} {col_type_sql}"

                        with conn.begin_nested():
                            conn.execute(text(ddl))
                            if col.index:
                                conn.execute(
                                    text(
                                        f"CREATE INDEX IF NOT EXISTS ix_{table.name}_{col.name} "
                                        f"ON {table.name} ({col.name})"
                                    )
                                )
                    except Exception as exc_col:
                        _session_log.warning("Aviso em _sincronizar_colunas_faltantes (%s.%s): %s", table.name, col.name, exc_col)
    except Exception as exc_sync:
        _session_log.warning("Aviso geral em _sincronizar_colunas_faltantes: %s", exc_sync)


def init_db() -> None:
    # Lock distribuído entre workers Gunicorn no PostgreSQL para evitar corrida em DDL/seeds
    lock_conn = None
    if engine.dialect.name == "postgresql":
        try:
            lock_conn = engine.connect()
            lock_conn.execute(text("SELECT pg_advisory_lock(847291988)"))
            lock_conn.commit()
        except Exception:
            if lock_conn is not None:
                try:
                    lock_conn.close()
                except Exception:
                    pass
                lock_conn = None

    try:
        _init_db_impl()
    except Exception as exc:
        import logging
        logging.getLogger("uvicorn.error").error(f"Aviso não-impeditivo em _init_db_impl: {exc}", exc_info=True)
    finally:
        if lock_conn is not None:
            try:
                lock_conn.execute(text("SELECT pg_advisory_unlock(847291988)"))
                lock_conn.commit()
            except Exception:
                pass
            try:
                lock_conn.close()
            except Exception:
                pass


def _init_db_impl() -> None:
    from app.models.lab_exames import (  # noqa: F401
        LabSolicitacao,
        SigtapCbo,
        SigtapCid,
        SigtapFormaOrganizacao,
        SigtapGrupo,
        SigtapOcupacao,
        SigtapProcedimento,
        SigtapSubgrupo,
        SigtapVersao,
    )
    from app.models.lab_fase6 import (  # noqa: F401
        FilaPsf,
        ItemSolic,
        LabConferenciaAutomatica,
        LabContrato,
        LabContratoPrecoCustomizado,
        LabFechamentoFaturamento,
        LabFeriadoBloqueio,
        LabFPOCompetencia,
        LabFPOItem,
        LabInconsistenciaJustificativa,
        LabLoteArtefato,
        LabLoteItem,
        LabLoteLiberacao,
        LabOrcamentoMensal,
        Laboratorio,
        LabPedidoAjuste,
        LabResultadoArquivo,
        SolicitacaoMestre,
        VagaLab,
    )
    from app.models.tfd import (  # noqa: F401
        Destino,
        Especialidade,
        ExameFila,
        Faturamento,
        Motorista,
        Paciente,
        PacienteHistorico,
        ProcedimentoCatalogo,
        TipoFila,
        Veiculo,
        Viagem,
        ViagemFila,
        ViagemPaciente,
    )
    from app.models.user import User  # noqa: F401
    from app.models.settings import SystemSettings  # noqa: F401
    from app.models.integracoes import (  # noqa: F401
        IntegrationSettings,
        PecIndicadorCache,
        PecSyncLog,
        WhatsAppLog,
    )
    from app.models.dashboard_prefs import UserDashboardPrefs  # noqa: F401
    from app.models.audit import AuditLog  # noqa: F401
    from app.models.cadastros_saude import (  # noqa: F401
        Medico,
        UnidadeSaude,
        Prestador,
        UnidadeServicoEspecializado,
        EquipeSaude,
        EquipeProfissional,
    )
    from app.models.apac import (  # noqa: F401
        AnexoLaudoAPAC,
        FaixaNumeracaoAPAC,
        LoteFaturamentoAPAC,
        ProcedimentoSecundarioAPAC,
        SolicitacaoAPAC,
    )
    from app.models.oxigenio import (  # noqa: F401
        EmpresaOxigenio,
        LicitacaoContratoOxigenio,
        EntradaCompraOxigenio,
        EquipamentoRespiratorio,
        EmprestimoOxigenio,
        TrocaCilindroHistorico,
        ItemEmprestimoOxigenio,
        CilindroVazioRecolhimento,
        CilindroComodatoMovimentacao,
    )
    from app.models.farmacia import (  # noqa: F401
        Medicamento,
        MovimentacaoMedicamento,
        InsumoInterno,
        MovimentacaoInsumo,
        FarmaciaLinkPublico,
    )
    from app.models.suporte import TicketSuporte  # noqa: F401
    from app.models.producao_ambulatorial import ProducaoAmbulatorial  # noqa: F401

    # create_all com checkfirst ainda tem janela de corrida entre workers
    # (2x uvicorn no lifespan) — ignora erro de "já existe" e segue.
    try:
        SQLModel.metadata.create_all(engine)
    except Exception:
        pass

    with engine.begin() as conn:
        try:
            insp = inspect(conn)
            if "tickets_suporte" not in insp.get_table_names():
                TicketSuporte.__table__.create(conn, checkfirst=True)
        except Exception:
            pass

    # Garante flag de troca obrigatória de senha (novos fluxos)
    from sqlalchemy import inspect, text

    with engine.begin() as conn:
        try:
            cols_u = [c["name"] for c in inspect(conn).get_columns("usuarios")]
        except Exception:
            cols_u = ["must_change_password"]
        if "must_change_password" not in cols_u:
            conn.execute(
                text(
                    "ALTER TABLE usuarios "
                    "ADD COLUMN must_change_password BOOLEAN DEFAULT TRUE NOT NULL"
                )
            )
        conn.execute(
            text(
                "UPDATE usuarios SET must_change_password = FALSE "
                "WHERE must_change_password IS NULL"
            )
        )
        if conn.dialect.name == "postgresql":
            try:
                conn.execute(text("ALTER TABLE usuarios ALTER COLUMN telas TYPE TEXT"))
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE usuarios ALTER COLUMN acoes TYPE TEXT"))
            except Exception:
                pass
    # Migração simples sem apagar dados: garante coluna quantidade
    from sqlalchemy import inspect, text

    with engine.begin() as conn:
        try:
            cols = [c["name"] for c in inspect(conn).get_columns("lab_solic_itens")]
        except Exception:
            cols = ["quantidade"]
        if "quantidade" not in cols:
            conn.execute(
                text(
                    "ALTER TABLE lab_solic_itens "
                    "ADD COLUMN quantidade INTEGER DEFAULT 1 NOT NULL"
                )
            )
        conn.execute(
            text("UPDATE lab_solic_itens SET quantidade=1 WHERE quantidade IS NULL")
        )
        try:
            cols_ex = [c["name"] for c in inspect(conn).get_columns("tfd_exames_fila")]
        except Exception:
            cols_ex = ["public_token"]
        if "public_token" not in cols_ex:
            conn.execute(
                text("ALTER TABLE tfd_exames_fila ADD COLUMN public_token VARCHAR(64) DEFAULT '' NOT NULL")
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tfd_exames_fila_public_token ON tfd_exames_fila (public_token)"))
        try:
            cols_ex = [c["name"] for c in inspect(conn).get_columns("tfd_exames_fila")]
        except Exception:
            cols_ex = ["codigo_curto"]
        if "codigo_curto" not in cols_ex:
            conn.execute(
                text("ALTER TABLE tfd_exames_fila ADD COLUMN codigo_curto VARCHAR(20) DEFAULT '' NOT NULL")
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tfd_exames_fila_codigo_curto ON tfd_exames_fila (codigo_curto)"))
        else:
            try:
                if conn.dialect.name == "postgresql":
                    conn.execute(text("ALTER TABLE tfd_exames_fila ALTER COLUMN codigo_curto TYPE VARCHAR(20)"))
            except Exception:
                pass

        # Backfill codigo_curto aleatório (não-procedural) para exames sem código
        try:
            import secrets as _sec
            usados_ex = {
                str(r[0])
                for r in conn.execute(
                    text("SELECT codigo_curto FROM tfd_exames_fila WHERE codigo_curto IS NOT NULL AND codigo_curto != ''")
                ).all()
            }
            pend_ex = conn.execute(
                text("SELECT id FROM tfd_exames_fila WHERE (codigo_curto IS NULL OR codigo_curto = '') AND id IS NOT NULL LIMIT 10000")
            ).all()
            for (eid,) in pend_ex:
                cod = ""
                for _ in range(30):
                    cand = f"SL-{100000 + _sec.randbelow(900000)}"
                    if cand not in usados_ex:
                        cod = cand
                        usados_ex.add(cand)
                        break
                if not cod:
                    cod = f"SL-{_sec.token_hex(4).upper()}"
                conn.execute(
                    text("UPDATE tfd_exames_fila SET codigo_curto = :cod WHERE id = :eid"),
                    {"cod": cod, "eid": eid},
                )
        except Exception:
            pass

        # Prontuário curto aleatório (não-procedural) para Pacientes
        try:
            cols_pac = [c["name"] for c in inspect(conn).get_columns("tfd_pacientes")]
        except Exception:
            cols_pac = []
        if "codigo_prontuario" not in cols_pac:
            try:
                conn.execute(text("ALTER TABLE tfd_pacientes ADD COLUMN codigo_prontuario VARCHAR(20) DEFAULT '' NOT NULL"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tfd_pacientes_codigo_prontuario ON tfd_pacientes (codigo_prontuario)"))
            except Exception:
                pass
        # Backfill codigo_prontuario aleatório para pacientes sem código
        try:
            import secrets as _sec
            usados_pr = {
                str(r[0])
                for r in conn.execute(
                    text("SELECT codigo_prontuario FROM tfd_pacientes WHERE codigo_prontuario IS NOT NULL AND codigo_prontuario != ''")
                ).all()
            }
            pend_pr = conn.execute(
                text("SELECT id FROM tfd_pacientes WHERE (codigo_prontuario IS NULL OR codigo_prontuario = '') AND id IS NOT NULL LIMIT 25000")
            ).all()
            for (pid,) in pend_pr:
                cod = ""
                for _ in range(30):
                    cand = f"PR-{100000 + _sec.randbelow(900000)}"
                    if cand not in usados_pr:
                        cod = cand
                        usados_pr.add(cand)
                        break
                if not cod:
                    cod = f"PR-{_sec.token_hex(4).upper()}"
                conn.execute(
                    text("UPDATE tfd_pacientes SET codigo_prontuario = :cod WHERE id = :pid"),
                    {"cod": cod, "pid": pid},
                )
        except Exception:
            pass
        # Backfill token p/ linhas existentes sem token
        try:
            import secrets

            pend = conn.execute(
                text("SELECT id FROM tfd_exames_fila WHERE public_token IS NULL OR public_token = '' LIMIT 5000")
            ).all()
            for (eid,) in pend:
                conn.execute(
                    text("UPDATE tfd_exames_fila SET public_token = :tok WHERE id = :eid"),
                    {"tok": secrets.token_urlsafe(24), "eid": eid},
                )
        except Exception:
            pass
        # Filtros avançados e-SUS: tipo_fila / codigo_procedimento / CBO
        try:
            cols_ex = [c["name"] for c in inspect(conn).get_columns("tfd_exames_fila")]
        except Exception:
            cols_ex = []
        COLS_FILTRO = {
            "tipo_fila": "VARCHAR(80) DEFAULT '' NOT NULL",
            "codigo_procedimento": "VARCHAR(20) DEFAULT '' NOT NULL",
            "codigo_especialidade": "VARCHAR(10) DEFAULT '' NOT NULL",
            "nome_especialidade": "VARCHAR(120) DEFAULT '' NOT NULL",
        }
        for col, ddl in COLS_FILTRO.items():
            if col not in cols_ex:
                try:
                    # col/ddl vêm de whitelist fixa acima — sem input de usuário.
                    conn.execute(text(f"ALTER TABLE tfd_exames_fila ADD COLUMN {col} {ddl}"))
                    conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_tfd_exames_fila_{col} ON tfd_exames_fila ({col})"))
                except Exception:
                    pass
        # Agendamento em lote: data/hora, médico e unidade PSF
        # Limpeza permanente de tipo de serviço corrompido ("11/10" / "11/10/2026")
        try:
            conn.execute(text("DELETE FROM tfd_tipos_fila WHERE nome ILIKE '%11/10%'"))
            conn.execute(text("UPDATE tfd_procedimentos SET tipo_fila = 'CONSULTAS ESPECIALIZADAS' WHERE tipo_fila ILIKE '%11/10%'"))
            conn.execute(text("UPDATE tfd_exames_fila SET tipo_fila = 'CONSULTAS ESPECIALIZADAS' WHERE tipo_fila ILIKE '%11/10%'"))
        except Exception:
            pass
        try:
            cols_ex2 = [c["name"] for c in inspect(conn).get_columns("tfd_exames_fila")]
        except Exception:
            cols_ex2 = []
        for col, ddl in {
            "hora_agendada": "VARCHAR(5) DEFAULT '' NOT NULL",
            "medico_id": "INTEGER",
            "unidade_saude_id": "INTEGER",
            "numero_pedido": "VARCHAR(30) DEFAULT '' NOT NULL",
            "justificativa": "VARCHAR(500) DEFAULT '' NOT NULL",
            "resultado": "VARCHAR(2000) DEFAULT '' NOT NULL",
            "recepcionado_em": "TIMESTAMP",
            "recepcionado_por": "VARCHAR(120) DEFAULT '' NOT NULL",
            "criado_por": "VARCHAR(120) DEFAULT '' NOT NULL",
            "status_anterior": "VARCHAR(20) DEFAULT '' NOT NULL",
        }.items():
            if col not in cols_ex2:
                try:
                    conn.execute(text(f"ALTER TABLE tfd_exames_fila ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass
        # Territorialização APS do paciente (perfil + demanda reprimida)
        try:
            cols_pac = [c["name"] for c in inspect(conn).get_columns("tfd_pacientes")]
        except Exception:
            cols_pac = []
        for col, ddl in {
            "endereco_numero": "VARCHAR(20) DEFAULT '' NOT NULL",
            "complemento": "VARCHAR(100) DEFAULT '' NOT NULL",
            "bairro": "VARCHAR(100) DEFAULT '' NOT NULL",
            "cep": "VARCHAR(10) DEFAULT '' NOT NULL",
            "unidade_saude_id": "INTEGER",
            "equipe_esf": "VARCHAR(80) DEFAULT '' NOT NULL",
            "acs_nome": "VARCHAR(150) DEFAULT '' NOT NULL",
            "nome_social": "VARCHAR(150) DEFAULT '' NOT NULL",
            "sexo": "VARCHAR(20) DEFAULT '' NOT NULL",
            "nome_mae": "VARCHAR(150) DEFAULT '' NOT NULL",
            "municipio": "VARCHAR(100) DEFAULT 'Guapé' NOT NULL",
            "ponto_referencia": "VARCHAR(150) DEFAULT '' NOT NULL",
            "unidade_cnes": "VARCHAR(20) DEFAULT '' NOT NULL",
            "unidade_nome": "VARCHAR(150) DEFAULT '' NOT NULL",
            "equipe_ine": "VARCHAR(20) DEFAULT '' NOT NULL",
            "microarea": "VARCHAR(20) DEFAULT '' NOT NULL",
            "co_seq_cidadao_pec": "BIGINT",
            "eh_teste": "BOOLEAN DEFAULT FALSE NOT NULL",
            "situacao_cadastral": "VARCHAR(30) DEFAULT 'ativo' NOT NULL",
            "data_obito": "DATE",
            "motivo_situacao": "VARCHAR(255) DEFAULT '' NOT NULL",
            "situacao_atualizada_em": "TIMESTAMP",
            "sincronizado_em": "TIMESTAMP",
            "updated_at": "TIMESTAMP",
        }.items():
            if col not in cols_pac:
                try:
                    conn.execute(text(f"ALTER TABLE tfd_pacientes ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass
        for idx, col in (
            ("ix_tfd_pacientes_co_seq_cidadao_pec", "co_seq_cidadao_pec"),
            ("ix_tfd_pacientes_unidade_cnes", "unidade_cnes"),
            ("ix_tfd_pacientes_equipe_ine", "equipe_ine"),
            ("ix_tfd_pacientes_eh_teste", "eh_teste"),
        ):
            try:
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS {idx} ON tfd_pacientes ({col})"))
            except Exception:
                pass
        try:
            cols_plog = [c["name"] for c in inspect(conn).get_columns("pec_sync_logs")]
        except Exception:
            cols_plog = ["total_baixas_fila", "total_ignorados_pec", "total_removidos_inativos"]
        for col_plog, ddl_plog in {
            "total_baixas_fila": "INTEGER DEFAULT 0 NOT NULL",
            "total_ignorados_pec": "INTEGER DEFAULT 0 NOT NULL",
            "total_removidos_inativos": "INTEGER DEFAULT 0 NOT NULL",
        }.items():
            if col_plog not in cols_plog:
                try:
                    conn.execute(text(f"ALTER TABLE pec_sync_logs ADD COLUMN {col_plog} {ddl_plog}"))
                except Exception:
                    pass
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_pec_indicadores_cache_lookup ON pec_indicadores_cache (periodo, ubs, equipe, indicador_id)"))
        except Exception:
            pass
        # Perfil Médico: vínculo conta <-> cadastro de médico
        try:
            cols_u3 = [c["name"] for c in inspect(conn).get_columns("usuarios")]
        except Exception:
            cols_u3 = ["medico_id"]
        if "medico_id" not in cols_u3:
            try:
                conn.execute(text("ALTER TABLE usuarios ADD COLUMN medico_id INTEGER"))
            except Exception:
                pass
        if "unidade_saude_id" not in cols_u3:
            try:
                conn.execute(text("ALTER TABLE usuarios ADD COLUMN unidade_saude_id INTEGER"))
            except Exception:
                pass
        if "laboratorio_id" not in cols_u3:
            try:
                conn.execute(text("ALTER TABLE usuarios ADD COLUMN laboratorio_id INTEGER"))
            except Exception:
                pass
        if "paciente_id" not in cols_u3:
            try:
                conn.execute(text("ALTER TABLE usuarios ADD COLUMN paciente_id INTEGER"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_usuarios_paciente_id ON usuarios (paciente_id)"))
            except Exception:
                pass
        try:
            cols_fila = [c["name"] for c in inspect(conn).get_columns("lab_fila_psf")]
        except Exception:
            cols_fila = []
        if "justificativa" not in cols_fila:
            try:
                conn.execute(text("ALTER TABLE lab_fila_psf ADD COLUMN justificativa VARCHAR(500) DEFAULT '' NOT NULL"))
            except Exception:
                pass
        try:
            cols_mestre = [c["name"] for c in inspect(conn).get_columns("lab_solic_mestre")]
        except Exception:
            cols_mestre = []
        if "hora_agendada" not in cols_mestre:
            try:
                conn.execute(text("ALTER TABLE lab_solic_mestre ADD COLUMN hora_agendada VARCHAR(10) DEFAULT '07:00' NOT NULL"))
            except Exception:
                pass
        if "coletado_em" not in cols_mestre:
            try:
                conn.execute(text("ALTER TABLE lab_solic_mestre ADD COLUMN coletado_em TIMESTAMP"))
            except Exception:
                pass
        if "coletado_por" not in cols_mestre:
            try:
                conn.execute(text("ALTER TABLE lab_solic_mestre ADD COLUMN coletado_por VARCHAR(120) DEFAULT '' NOT NULL"))
            except Exception:
                pass
        try:
            cols_u3b = [c["name"] for c in inspect(conn).get_columns("usuarios")]
        except Exception:
            cols_u3b = ["permite_retroativo"]
        if "permite_retroativo" not in cols_u3b:
            try:
                conn.execute(text("ALTER TABLE usuarios ADD COLUMN permite_retroativo BOOLEAN DEFAULT TRUE NOT NULL"))
            except Exception:
                pass
        try:
            conn.execute(text("UPDATE usuarios SET permite_retroativo = TRUE WHERE permite_retroativo IS NULL"))
        except Exception:
            pass
        # Médico: CBO da especialidade
        try:
            cols_med = [c["name"] for c in inspect(conn).get_columns("medicos")]
        except Exception:
            cols_med = []
        for col, ddl in {
            "cbo_codigo": "VARCHAR(10) DEFAULT '' NOT NULL",
            "cbo_descricao": "VARCHAR(120) DEFAULT '' NOT NULL",
            "especialidade": "VARCHAR(120) DEFAULT '' NOT NULL",
        }.items():
            if col not in cols_med:
                try:
                    conn.execute(text(f"ALTER TABLE medicos ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass
        # Unidade: endereço completo do atendimento
        try:
            cols_uni = [c["name"] for c in inspect(conn).get_columns("unidades_saude")]
        except Exception:
            cols_uni = []
        for col, ddl in {
            "numero": "VARCHAR(20) DEFAULT '' NOT NULL",
            "municipio": "VARCHAR(100) DEFAULT '' NOT NULL",
            "cep": "VARCHAR(10) DEFAULT '' NOT NULL",
        }.items():
            if col not in cols_uni:
                try:
                    conn.execute(text(f"ALTER TABLE unidades_saude ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass

        # Motoristas: validade do exame toxicológico
        try:
            cols_mot = [c["name"] for c in inspect(conn).get_columns("tfd_motoristas")]
        except Exception:
            cols_mot = []
        if "toxicologico_validade" not in cols_mot and cols_mot:
            try:
                conn.execute(text("ALTER TABLE tfd_motoristas ADD COLUMN toxicologico_validade DATE"))
            except Exception:
                pass

        # Auditoria: campo device, índices de alta performance e limpeza de ruído
        try:
            cols_audit = [c["name"] for c in inspect(conn).get_columns("audit_logs")]
        except Exception:
            cols_audit = []
        if "device" not in cols_audit and cols_audit:
            try:
                conn.execute(text("ALTER TABLE audit_logs ADD COLUMN device VARCHAR(150) DEFAULT '' NOT NULL"))
            except Exception:
                pass
        for idx_sql in (
            "CREATE INDEX IF NOT EXISTS ix_audit_logs_device ON audit_logs (device)",
            "CREATE INDEX IF NOT EXISTS ix_audit_logs_action_timestamp ON audit_logs (action, timestamp DESC)",
            "CREATE INDEX IF NOT EXISTS ix_audit_logs_user_timestamp ON audit_logs (user_id, timestamp DESC)",
            "CREATE INDEX IF NOT EXISTS ix_audit_logs_entity_timestamp ON audit_logs (entity, timestamp DESC)",
        ):
            try:
                conn.execute(text(idx_sql))
            except Exception:
                pass
        try:
            conn.execute(text("DELETE FROM audit_logs WHERE action = 'AUTH_CREATE'"))
        except Exception:
            pass
        # Exame: justificativa de prioridade + snapshot médico/unidade do agendamento
        try:
            cols_ex3 = [c["name"] for c in inspect(conn).get_columns("tfd_exames_fila")]
        except Exception:
            cols_ex3 = []
        for col, ddl in {
            "justificativa_prioridade": "VARCHAR(500) DEFAULT '' NOT NULL",
            "cid_codigo": "VARCHAR(10) DEFAULT '' NOT NULL",
            "cid_descricao": "VARCHAR(255) DEFAULT '' NOT NULL",
            "medico_nome": "VARCHAR(150) DEFAULT '' NOT NULL",
            "medico_cpf": "VARCHAR(14) DEFAULT '' NOT NULL",
            "medico_cbo_codigo": "VARCHAR(10) DEFAULT '' NOT NULL",
            "medico_cbo_descricao": "VARCHAR(120) DEFAULT '' NOT NULL",
            "unidade_nome": "VARCHAR(150) DEFAULT '' NOT NULL",
            "unidade_cnes": "VARCHAR(20) DEFAULT '' NOT NULL",
            "unidade_endereco": "VARCHAR(200) DEFAULT '' NOT NULL",
            "unidade_numero": "VARCHAR(20) DEFAULT '' NOT NULL",
            "unidade_bairro": "VARCHAR(100) DEFAULT '' NOT NULL",
            "unidade_municipio": "VARCHAR(100) DEFAULT '' NOT NULL",
            "unidade_cep": "VARCHAR(10) DEFAULT '' NOT NULL",
            "ativo": "BOOLEAN DEFAULT TRUE NOT NULL",
            "motivo_remocao": "VARCHAR(500) DEFAULT '' NOT NULL",
            "removido_em": "TIMESTAMP",
            "removido_por": "VARCHAR(120) DEFAULT '' NOT NULL",
            "instrucoes_transporte": "VARCHAR(500) DEFAULT '' NOT NULL",
        }.items():
            if col not in cols_ex3:
                try:
                    conn.execute(text(f"ALTER TABLE tfd_exames_fila ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass
        try:
            conn.execute(text("UPDATE tfd_exames_fila SET ativo = TRUE WHERE ativo IS NULL"))
            conn.execute(text("UPDATE tfd_exames_fila SET justificativa_prioridade = '' WHERE justificativa_prioridade = 'P1 - Médico ESF'"))
        except Exception:
            pass
        # SIGTAP: detalhe Tabela Unificada nos procedimentos
        try:
            cols_sg = [c["name"] for c in inspect(conn).get_columns("sigtap_procedimentos")]
        except Exception:
            cols_sg = []
        for col, ddl in {
            "sexo": "VARCHAR(10) DEFAULT '' NOT NULL",
            "idade_min": "INTEGER DEFAULT 0 NOT NULL",
            "idade_max": "INTEGER DEFAULT 0 NOT NULL",
            "qtd_maxima": "INTEGER DEFAULT 0 NOT NULL",
            "pontos": "INTEGER DEFAULT 0 NOT NULL",
            "valor_sa": "FLOAT DEFAULT 0 NOT NULL",
            "valor_sp": "FLOAT DEFAULT 0 NOT NULL",
            "valor_sh": "FLOAT DEFAULT 0 NOT NULL",
            "competencia": "VARCHAR(7) DEFAULT '' NOT NULL",
            "grupo_codigo": "VARCHAR(2) DEFAULT '' NOT NULL",
            "grupo_nome": "VARCHAR(150) DEFAULT '' NOT NULL",
            "subgrupo_codigo": "VARCHAR(4) DEFAULT '' NOT NULL",
            "subgrupo_nome": "VARCHAR(180) DEFAULT '' NOT NULL",
            "forma_organizacao_codigo": "VARCHAR(6) DEFAULT '' NOT NULL",
            "forma_organizacao_nome": "VARCHAR(180) DEFAULT '' NOT NULL",
            "valor_combinado": "FLOAT DEFAULT 0.0 NOT NULL",
            "tipos_fila_permitidos": "VARCHAR(500) DEFAULT '' NOT NULL",
            "sem_codigo_especifico": "BOOLEAN DEFAULT FALSE NOT NULL",
            "codigo_faturamento_sigtap": "VARCHAR(20) DEFAULT '' NOT NULL",
        }.items():
            if col not in cols_sg:
                try:
                    conn.execute(text(f"ALTER TABLE sigtap_procedimentos ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass
        # tfd_procedimentos: colunas sem_codigo_especifico e codigo_faturamento_sigtap
        try:
            cols_tfd_proc = [c["name"] for c in inspect(conn).get_columns("tfd_procedimentos")]
        except Exception:
            cols_tfd_proc = []
        for col, ddl in {
            "sem_codigo_especifico": "BOOLEAN DEFAULT FALSE NOT NULL",
            "codigo_faturamento_sigtap": "VARCHAR(20) DEFAULT '' NOT NULL",
        }.items():
            if col not in cols_tfd_proc:
                try:
                    conn.execute(text(f"ALTER TABLE tfd_procedimentos ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass
        # Frota/viagem: status do veículo, manutenção, dados da ordem de circulação e snapshots do passageiro
        try:
            cols_vei = [c["name"] for c in inspect(conn).get_columns("tfd_veiculos")]
        except Exception:
            cols_vei = []
        for col, ddl in {
            "status": "VARCHAR(20) DEFAULT 'disponivel' NOT NULL",
            "manutencao_motivo": "TEXT DEFAULT ''",
            "manutencao_data_entrada": "DATE",
            "manutencao_previsao_retorno": "DATE",
            "manutencao_indefinida": "BOOLEAN DEFAULT FALSE NOT NULL",
        }.items():
            if col not in cols_vei:
                try:
                    conn.execute(text(f"ALTER TABLE tfd_veiculos ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass
        try:
            cols_via = [c["name"] for c in inspect(conn).get_columns("tfd_viagens")]
        except Exception:
            cols_via = []
        for col, ddl in {
            "departamento": "VARCHAR(120) DEFAULT '' NOT NULL",
            "data_retorno": "DATE",
            "hora_retorno": "VARCHAR(5) DEFAULT '' NOT NULL",
            "km_inicial": "INTEGER DEFAULT 0 NOT NULL",
            "km_final": "INTEGER DEFAULT 0 NOT NULL",
            "adiantamento": "FLOAT DEFAULT 0 NOT NULL",
        }.items():
            if col not in cols_via:
                try:
                    conn.execute(text(f"ALTER TABLE tfd_viagens ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass
        try:
            cols_vp = [c["name"] for c in inspect(conn).get_columns("tfd_viagem_pacientes")]
        except Exception:
            cols_vp = []
        for col, ddl in {
            "viagem_fila_id": "INTEGER",
            "tratamento": "VARCHAR(150) DEFAULT '' NOT NULL",
            "unidade": "VARCHAR(150) DEFAULT '' NOT NULL",
            "hora_consulta": "VARCHAR(5) DEFAULT '' NOT NULL",
            "acompanhante_id": "INTEGER",
            "acompanhante_cpf": "VARCHAR(14) DEFAULT '' NOT NULL",
            "observacoes": "VARCHAR(500) DEFAULT '' NOT NULL",
            "status_confirmacao": "VARCHAR(30) DEFAULT 'pendente' NOT NULL",
            "confirmado_em": "TIMESTAMP",
            "token_confirmacao": "VARCHAR(64) DEFAULT '' NOT NULL",
            "lembrete_enviado": "BOOLEAN DEFAULT FALSE NOT NULL",
            "lembrete_enviado_em": "TIMESTAMP",
        }.items():
            if col not in cols_vp:
                try:
                    conn.execute(text(f"ALTER TABLE tfd_viagem_pacientes ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass
        for idx, col in (
            ("ix_tfd_viagem_pacientes_token_confirmacao", "token_confirmacao"),
            ("ix_tfd_viagem_pacientes_status_confirmacao", "status_confirmacao"),
        ):
            try:
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS {idx} ON tfd_viagem_pacientes ({col})"))
            except Exception:
                pass
        # Backfill token de confirmação de presença p/ viagens existentes
        try:
            import secrets
            pend_vp = conn.execute(
                text("SELECT id FROM tfd_viagem_pacientes WHERE token_confirmacao IS NULL OR token_confirmacao = '' LIMIT 5000")
            ).all()
            for (vpid,) in pend_vp:
                conn.execute(
                    text("UPDATE tfd_viagem_pacientes SET token_confirmacao = :tok WHERE id = :vpid"),
                    {"tok": secrets.token_urlsafe(24), "vpid": vpid},
                )
        except Exception:
            pass
        try:
            cols_vf = [c["name"] for c in inspect(conn).get_columns("tfd_viagem_fila")]
        except Exception:
            cols_vf = []
        for col, ddl in {
            "acompanhante_id": "INTEGER",
            "acompanhante_nome": "VARCHAR(150) DEFAULT '' NOT NULL",
            "acompanhante_cpf": "VARCHAR(14) DEFAULT '' NOT NULL",
            "criado_por": "VARCHAR(120) DEFAULT '' NOT NULL",
        }.items():
            if col not in cols_vf:
                try:
                    conn.execute(text(f"ALTER TABLE tfd_viagem_fila ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass
        try:
            cols_dst = [c["name"] for c in inspect(conn).get_columns("tfd_destinos")]
        except Exception:
            cols_dst = []
        for col, ddl in {
            "codigo_desloc_pac": "VARCHAR(20) DEFAULT '' NOT NULL",
            "qtd_desloc_pac": "INTEGER DEFAULT 0 NOT NULL",
            "codigo_desloc_acomp": "VARCHAR(20) DEFAULT '' NOT NULL",
            "qtd_desloc_acomp": "INTEGER DEFAULT 0 NOT NULL",
        }.items():
            if col not in cols_dst:
                try:
                    conn.execute(text(f"ALTER TABLE tfd_destinos ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass
        # Frota: motoristas vinculados à viagem (seletor + "A definir")
        try:
            cols_via2 = [c["name"] for c in inspect(conn).get_columns("tfd_viagens")]
        except Exception:
            cols_via2 = []
        if "motorista_id" not in cols_via2:
            try:
                conn.execute(text("ALTER TABLE tfd_viagens ADD COLUMN motorista_id INTEGER"))
            except Exception:
                pass
        if "ponto_saida" not in cols_via2:
            try:
                conn.execute(text("ALTER TABLE tfd_viagens ADD COLUMN ponto_saida VARCHAR(150) DEFAULT 'Prefeitura Municipal de Guapé' NOT NULL"))
            except Exception:
                pass
        # Auditoria: payload completo do diff (TEXT p/ Raw Payload na íntegra)
        try:
            cols_al = [c["name"] for c in inspect(conn).get_columns("audit_logs")]
        except Exception:
            cols_al = []
        if "details" in cols_al:
            try:
                conn.execute(text("ALTER TABLE audit_logs ALTER COLUMN details TYPE TEXT"))
            except Exception:
                pass
        # Marca do município (brasão/ícone) em system_settings
        try:
            cols_st = [c["name"] for c in inspect(conn).get_columns("system_settings")]
        except Exception:
            cols_st = []
        for col in ("brasao_url", "icone_url", "exames_habilitados_sigtap", "exames_por_tipo_fila_json", "valores_combinados_sigtap_json"):
            if col not in cols_st:
                try:
                    tipo_ddl = "TEXT DEFAULT '{}' NOT NULL" if "json" in col else ("TEXT DEFAULT '' NOT NULL" if col == "exames_habilitados_sigtap" else "VARCHAR(500) DEFAULT '' NOT NULL")
                    conn.execute(text(f"ALTER TABLE system_settings ADD COLUMN {col} {tipo_ddl}"))
                except Exception:
                    pass
        # Profissionais: Unidades de Saúde vinculadas
        try:
            cols_med2 = [c["name"] for c in inspect(conn).get_columns("medicos")]
        except Exception:
            cols_med2 = []
        if "unidades_ids" not in cols_med2:
            try:
                conn.execute(text("ALTER TABLE medicos ADD COLUMN unidades_ids VARCHAR(500) DEFAULT '' NOT NULL"))
            except Exception:
                pass
        # SolicitacaoMestre: campos complementares de agendamento e justificativa clínica
        try:
            cols_sm = [c["name"] for c in inspect(conn).get_columns("lab_solic_mestre")]
        except Exception:
            cols_sm = []
        for col, ddl in {
            "medico_id": "INTEGER",
            "medico_solicitante": "VARCHAR(150) DEFAULT '' NOT NULL",
            "unidade_saude_id": "INTEGER",
            "unidade_psf": "VARCHAR(150) DEFAULT '' NOT NULL",
            "justificativa": "VARCHAR(500) DEFAULT '' NOT NULL",
            "instrucoes_transporte": "VARCHAR(500) DEFAULT '' NOT NULL",
        }.items():
            if col not in cols_sm:
                try:
                    conn.execute(text(f"ALTER TABLE lab_solic_mestre ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass
        # Prioridade binária (Eletivo/Urgente): colapsa legado 'prioritaria' p/ Eletivo
        for _tab in ("tfd_exames_fila", "tfd_viagem_fila"):
            try:
                conn.execute(text(
                    f"UPDATE {_tab} SET prioridade = 'rotina' WHERE prioridade = 'prioritaria'"
                ))
            except Exception:
                pass
        # RBAC granular: ações por tela em usuarios (json; ausente = tudo)
        try:
            cols_u2 = [c["name"] for c in inspect(conn).get_columns("usuarios")]
        except Exception:
            cols_u2 = ["acoes"]
        if "acoes" not in cols_u2:
            try:
                conn.execute(text("ALTER TABLE usuarios ADD COLUMN acoes TEXT DEFAULT '{}' NOT NULL"))
            except Exception:
                pass
        try:
            conn.execute(text("UPDATE usuarios SET acoes = '{}' WHERE acoes IS NULL OR acoes = ''"))
        except Exception:
            pass
        if conn.dialect.name == "postgresql":
            try:
                conn.execute(text("ALTER TABLE usuarios ALTER COLUMN telas TYPE TEXT"))
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE usuarios ALTER COLUMN acoes TYPE TEXT"))
            except Exception:
                pass
        # Preferências do quadro semanal por operador (filtros persistidos)
        try:
            cols_q = [c["name"] for c in inspect(conn).get_columns("user_dashboard_preferences")]
        except Exception:
            cols_q = ["quadro_filtros"]
        if "quadro_filtros" not in cols_q:
            try:
                conn.execute(text("ALTER TABLE user_dashboard_preferences ADD COLUMN quadro_filtros TEXT DEFAULT '{}' NOT NULL"))
            except Exception:
                pass
        try:
            conn.execute(text("UPDATE user_dashboard_preferences SET quadro_filtros = '{}' WHERE quadro_filtros IS NULL OR quadro_filtros = ''"))
        except Exception:
            pass
        # Item 4: Especialidades CBO condicional: remove constraint unique estrita e cria índice condicional
        try:
            conn.execute(text("ALTER TABLE tfd_especialidades DROP CONSTRAINT IF EXISTS tfd_especialidades_codigo_cbo_key"))
        except Exception:
            pass
        try:
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_tfd_especialidades_cbo "
                "ON tfd_especialidades (codigo_cbo) "
                "WHERE codigo_cbo != '' AND codigo_cbo IS NOT NULL"
            ))
        except Exception:
            pass
        # Integração e-SUS PEC: colunas p/ Túnel SSH e Banco
        try:
            cols_int = [c["name"] for c in inspect(conn).get_columns("integration_settings")]
        except Exception:
            cols_int = []
        for col, ddl in {
            "pec_banco_nome": "VARCHAR(80) DEFAULT 'esus' NOT NULL",
            "pec_ssh_habilitado": "BOOLEAN DEFAULT FALSE NOT NULL",
            "pec_ssh_host": "VARCHAR(150) DEFAULT '' NOT NULL",
            "pec_ssh_porta": "INTEGER DEFAULT 22 NOT NULL",
            "pec_ssh_usuario": "VARCHAR(120) DEFAULT '' NOT NULL",
            "pec_ssh_senha": "VARCHAR(255) DEFAULT '' NOT NULL",
            "pec_ssh_chave_privada": "VARCHAR(8000) DEFAULT '' NOT NULL",
            "pec_porta_local": "INTEGER DEFAULT 5433 NOT NULL",
            "pec_sync_automatica": "BOOLEAN DEFAULT TRUE NOT NULL",
            "pec_sync_intervalo_horas": "INTEGER DEFAULT 6 NOT NULL",
            "pec_sync_ultima_execucao": "TIMESTAMP",
            "pec_sync_ultimo_status": "VARCHAR(30) DEFAULT '' NOT NULL",
            "pec_sync_total_pacientes": "INTEGER DEFAULT 0 NOT NULL",
            "sigtap_sync_automatica": "BOOLEAN DEFAULT TRUE NOT NULL",
            "sigtap_sync_intervalo_horas": "INTEGER DEFAULT 24 NOT NULL",
            "sigtap_sync_ultima_execucao": "TIMESTAMP",
            "sigtap_sync_ultimo_status": "VARCHAR(30) DEFAULT '' NOT NULL",
            "sigtap_sync_ultima_competencia": "VARCHAR(10) DEFAULT '' NOT NULL",
            "sigtap_sync_ultimo_erro": "VARCHAR(500) DEFAULT '' NOT NULL",
            "sia_sync_automatica": "BOOLEAN DEFAULT TRUE NOT NULL",
            "sia_sync_ultima_execucao": "TIMESTAMP",
            "sia_sync_ultimo_status": "VARCHAR(30) DEFAULT '' NOT NULL",
            "sia_sync_ultima_competencia": "VARCHAR(10) DEFAULT '' NOT NULL",
            "sia_sync_ultimo_erro": "VARCHAR(500) DEFAULT '' NOT NULL",
            "whatsapp_habilitado": "BOOLEAN DEFAULT FALSE NOT NULL",
            "whatsapp_provedor": "VARCHAR(50) DEFAULT 'api_oficial' NOT NULL",
            "whatsapp_api_url": "VARCHAR(500) DEFAULT '' NOT NULL",
            "whatsapp_api_token": "VARCHAR(500) DEFAULT '' NOT NULL",
            "whatsapp_instancia_id": "VARCHAR(150) DEFAULT '' NOT NULL",
            "whatsapp_notificar_entrada_fila": "BOOLEAN DEFAULT TRUE NOT NULL",
            "whatsapp_notificar_agendamento": "BOOLEAN DEFAULT TRUE NOT NULL",
            "whatsapp_ddd_padrao": "VARCHAR(5) DEFAULT '35' NOT NULL",
        }.items():
            if col not in cols_int:
                try:
                    conn.execute(text(f"ALTER TABLE integration_settings ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass

        # Padroniza sincronização automática do SIGTAP para diária (1x ao dia - 24 horas)
        try:
            conn.execute(
                text(
                    "UPDATE integration_settings SET sigtap_sync_intervalo_horas = 24 "
                    "WHERE sigtap_sync_intervalo_horas IS NULL OR sigtap_sync_intervalo_horas != 24"
                )
            )
        except Exception:
            pass

    _sincronizar_colunas_faltantes(engine)

    from sqlmodel import Session, select

    with Session(engine) as db:
        from app.services.lab import seed_sigtap
        from app.services.lab_fase6 import seed_laboratorios
        from app.services.seed_deslocamento import seed_deslocamento
        from app.services.apac_service import seed_apac

        seed_sigtap(db)
        seed_laboratorios(db)
        try:
            seed_apac(db)
        except Exception:
            pass
        try:
            from app.services.sigtap_hierarquia import (
                seed_arvore_sigtap,
                seed_vivver_procedimentos,
                seed_regras_padrao_tipos_servico,
            )
            seed_vivver_procedimentos(db)
            seed_regras_padrao_tipos_servico(db)
            if not db.exec(select(SigtapGrupo.id)).first():
                seed_arvore_sigtap(db)
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
        try:
            from app.core.config import settings
            if getattr(settings, "OXIGENIO_SEED_ENABLED", False):
                from app.services.seed_oxigenio import seed_oxigenio_dados_reais
                from app.models.oxigenio import EmpresaOxigenio
                qtd_empresas = len(db.exec(select(EmpresaOxigenio)).all())
                if qtd_empresas == 0:
                    seed_oxigenio_dados_reais(db, force_clean=False)
        except Exception:
            pass
        try:
            seed_deslocamento(db)
        except Exception:
            pass
        # Seed settings padrão
        try:
            if not db.get(SystemSettings, 1):
                db.add(SystemSettings(id=1, cidade="Guapé", uf="MG", subtitulo="Secretaria Municipal"))
                db.commit()
        except Exception:
            pass
        # Seed integrações (linha única id=1; segredos vazios)
        try:
            if not db.get(IntegrationSettings, 1):
                db.add(IntegrationSettings(id=1))
                db.commit()
        except Exception:
            pass

        # Seed Paciente Padrão "Testes" para testes em produção com isolamento contábil e de custos
        try:
            pac_teste = db.exec(
                select(Paciente).where(
                    (Paciente.eh_teste == True) | (Paciente.nome == "Testes")
                )
            ).first()
            if not pac_teste:
                pac_teste = Paciente(
                    nome="Testes",
                    cpf="00000000000",
                    cns="999999999999999",
                    codigo_prontuario="TESTE",
                    eh_teste=True,
                    situacao_cadastral="ativo",
                    municipio="Guapé",
                )
                db.add(pac_teste)
                db.commit()
            else:
                modificado = False
                if not pac_teste.eh_teste:
                    pac_teste.eh_teste = True
                    modificado = True
                if pac_teste.codigo_prontuario != "TESTE":
                    pac_teste.codigo_prontuario = "TESTE"
                    modificado = True
                if modificado:
                    db.add(pac_teste)
                    db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass

        # Item 1: Registro canônico do Médico da Unidade / Responsável Técnico
        try:
            med_rt = db.exec(
                select(Medico).where(Medico.nome == "Médico da Unidade / Responsável Técnico")
            ).first()
            if not med_rt:
                db.add(
                    Medico(
                        nome="Médico da Unidade / Responsável Técnico",
                        crm="RESP. TÉCNICO",
                        cbo_codigo="225125",
                        cbo_descricao="Médico da Unidade / Responsável Técnico",
                        especialidades="Clínica Geral,Saúde da Família",
                        ativo=True,
                    )
                )
                db.commit()
            else:
                alterou = False
                if not med_rt.ativo:
                    med_rt.ativo = True
                    alterou = True
                if med_rt.crm != "RESP. TÉCNICO":
                    med_rt.crm = "RESP. TÉCNICO"
                    alterou = True
                if med_rt.cbo_codigo != "225125":
                    med_rt.cbo_codigo = "225125"
                    alterou = True
                if med_rt.cbo_descricao != "Médico da Unidade / Responsável Técnico":
                    med_rt.cbo_descricao = "Médico da Unidade / Responsável Técnico"
                    alterou = True
                if alterou:
                    db.add(med_rt)
                    db.commit()
        except Exception:
            db.rollback()

        # Item 2: Higienização da base (remoção de motoristas do cadastro de médicos clínicos)
        try:
            from sqlalchemy import or_

            medicos_motoristas = db.exec(
                select(Medico).where(
                    or_(
                        Medico.cbo_codigo.like("7823%"),
                        Medico.cbo_descricao.ilike("%motorista%"),
                        Medico.nome.ilike("%motorista%"),
                    )
                )
            ).all()

            for med in medicos_motoristas:
                cpf_limpo = (med.cpf or "").strip()
                nome_base = med.nome.replace(" (Motorista do Transporte)", "").strip()

                condicoes = []
                if cpf_limpo:
                    condicoes.append(Motorista.cpf == cpf_limpo)
                if nome_base:
                    condicoes.append(Motorista.nome.ilike(nome_base))

                motorista_existente = None
                if condicoes:
                    motorista_existente = db.exec(select(Motorista).where(or_(*condicoes))).first()

                if not motorista_existente and nome_base:
                    novo_mot = Motorista(
                        nome=nome_base,
                        cpf=cpf_limpo,
                        telefone=med.telefone or "",
                        ativo=True,
                    )
                    db.add(novo_mot)

                med.ativo = False
                if "(Motorista" not in med.nome:
                    med.nome = f"{med.nome} (Motorista do Transporte)"
                db.add(med)

            if medicos_motoristas:
                db.commit()
        except Exception:
            db.rollback()

    # Oxigênio e Equipamentos: colunas adicionais para licitações, empresas e comodato
    with engine.begin() as conn:
        try:
            cols_empresa = [c["name"] for c in inspect(conn).get_columns("oxigenio_empresas")]
        except Exception:
            cols_empresa = []
        for col, ddl in {
            "valor_unitario_10m3": "FLOAT DEFAULT 0.0 NOT NULL",
            "valor_unitario_3m3": "FLOAT DEFAULT 0.0 NOT NULL",
            "valor_unitario_1m3": "FLOAT DEFAULT 0.0 NOT NULL",
            "valor_recarga_m3": "FLOAT DEFAULT 0.0 NOT NULL",
            "locacao_mensal_concentrador": "FLOAT DEFAULT 0.0 NOT NULL",
            "locacao_mensal_concentrador_5l": "FLOAT DEFAULT 0.0 NOT NULL",
            "locacao_mensal_concentrador_10l": "FLOAT DEFAULT 0.0 NOT NULL",
            "locacao_mensal_cpap": "FLOAT DEFAULT 0.0 NOT NULL",
            "locacao_mensal_bipap": "FLOAT DEFAULT 0.0 NOT NULL",
            "locacao_mensal_cilindro": "FLOAT DEFAULT 0.0 NOT NULL",
        }.items():
            if col not in cols_empresa:
                try:
                    with conn.begin_nested():
                        conn.execute(text(f"ALTER TABLE oxigenio_empresas ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass

        try:
            cols_lic = [c["name"] for c in inspect(conn).get_columns("oxigenio_licitacoes")]
        except Exception:
            cols_lic = []
        for col, ddl in {
            "valor_recarga_m3": "FLOAT DEFAULT 0.0 NOT NULL",
            "locacao_mensal_concentrador": "FLOAT DEFAULT 0.0 NOT NULL",
            "locacao_mensal_concentrador_5l": "FLOAT DEFAULT 0.0 NOT NULL",
            "locacao_mensal_concentrador_10l": "FLOAT DEFAULT 0.0 NOT NULL",
            "locacao_mensal_cpap": "FLOAT DEFAULT 0.0 NOT NULL",
            "locacao_mensal_bipap": "FLOAT DEFAULT 0.0 NOT NULL",
            "locacao_mensal_cilindro": "FLOAT DEFAULT 0.0 NOT NULL",
        }.items():
            if col not in cols_lic:
                try:
                    with conn.begin_nested():
                        conn.execute(text(f"ALTER TABLE oxigenio_licitacoes ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass

        try:
            cols_emp_ox = [c["name"] for c in inspect(conn).get_columns("oxigenio_emprestimos")]
        except Exception:
            cols_emp_ox = []
        for col, ddl in {
            "posse_cilindro": "VARCHAR(30) DEFAULT 'PROPRIO' NOT NULL",
            "itens_resumo": "TEXT DEFAULT '' NOT NULL",
        }.items():
            if col not in cols_emp_ox:
                try:
                    with conn.begin_nested():
                        conn.execute(text(f"ALTER TABLE oxigenio_emprestimos ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass

        try:
            cols_item_ox = [c["name"] for c in inspect(conn).get_columns("oxigenio_emprestimo_itens")]
        except Exception:
            cols_item_ox = []
        if "acompanha_equipamento" not in cols_item_ox:
            try:
                with conn.begin_nested():
                    conn.execute(text("ALTER TABLE oxigenio_emprestimo_itens ADD COLUMN acompanha_equipamento BOOLEAN DEFAULT FALSE NOT NULL"))
            except Exception:
                pass

        # Laboratório: colunas para motor de liberação em lote e prioridade na fila
        try:
            cols_fila_psf = [c["name"] for c in inspect(conn).get_columns("lab_fila_psf")]
        except Exception:
            cols_fila_psf = []
        for col, ddl in {
            "codigo_solicitacao": "VARCHAR(30) DEFAULT '' NOT NULL",
            "prioridade": "VARCHAR(20) DEFAULT 'rotina' NOT NULL",
            "sigtap_ids_json": "TEXT DEFAULT '[]' NOT NULL",
            "lote_id": "INTEGER NULL",
            "criado_por": "VARCHAR(120) DEFAULT '' NOT NULL",
        }.items():
            if col not in cols_fila_psf and cols_fila_psf:
                try:
                    with conn.begin_nested():
                        conn.execute(text(f"ALTER TABLE lab_fila_psf ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass
        if cols_fila_psf:
            try:
                with conn.begin_nested():
                    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lab_fila_psf_codigo_solicitacao ON lab_fila_psf (codigo_solicitacao)"))
            except Exception:
                pass

        try:
            cols_solic_mestre = [c["name"] for c in inspect(conn).get_columns("lab_solic_mestre")]
        except Exception:
            cols_solic_mestre = []
        for col, ddl in {
            "codigo_solicitacao": "VARCHAR(30) DEFAULT '' NOT NULL",
            "lote_id": "INTEGER NULL",
        }.items():
            if col not in cols_solic_mestre and cols_solic_mestre:
                try:
                    with conn.begin_nested():
                        conn.execute(text(f"ALTER TABLE lab_solic_mestre ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass
        if cols_solic_mestre:
            try:
                with conn.begin_nested():
                    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lab_solic_mestre_codigo_solicitacao ON lab_solic_mestre (codigo_solicitacao)"))
            except Exception:
                pass
            # Backfill aleatório para solicitações laboratoriais sem codigo_solicitacao
            try:
                import secrets as _sec
                from datetime import datetime as _dt
                ym_atual = _dt.now().strftime("%y%m")
                usados_sl = {
                    str(r[0])
                    for r in conn.execute(
                        text("SELECT codigo_solicitacao FROM lab_solic_mestre WHERE codigo_solicitacao IS NOT NULL AND codigo_solicitacao != ''")
                    ).all()
                }
                pend_sl = conn.execute(
                    text("SELECT id, data_agendada FROM lab_solic_mestre WHERE (codigo_solicitacao IS NULL OR codigo_solicitacao = '') AND id IS NOT NULL LIMIT 10000")
                ).all()
                for sid, dt_ag in pend_sl:
                    ym_row = dt_ag.strftime("%y%m") if hasattr(dt_ag, "strftime") else (str(dt_ag)[2:4] + str(dt_ag)[5:7] if dt_ag and len(str(dt_ag)) >= 7 else ym_atual)
                    cod = ""
                    for _ in range(30):
                        cand = f"SL-{ym_row}-{100000 + _sec.randbelow(900000)}"
                        if cand not in usados_sl:
                            cod = cand
                            usados_sl.add(cand)
                            break
                    if not cod:
                        cod = f"SL-{ym_row}-{_sec.token_hex(4).upper()}"
                    conn.execute(
                        text("UPDATE lab_solic_mestre SET codigo_solicitacao = :cod WHERE id = :sid"),
                        {"cod": cod, "sid": sid},
                    )
            except Exception:
                pass

        # Colunas adicionais para Contratos, Agendas e Tipos de Serviço
        try:
            cols_lab = [c["name"] for c in inspect(conn).get_columns("lab_laboratorios")]
        except Exception:
            cols_lab = []
        for col, ddl in {
            "responsavel_tecnico": "VARCHAR(120) DEFAULT '' NOT NULL",
            "horario_funcionamento": "VARCHAR(120) DEFAULT '' NOT NULL",
        }.items():
            if col not in cols_lab and cols_lab:
                try:
                    with conn.begin_nested():
                        conn.execute(text(f"ALTER TABLE lab_laboratorios ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass

        try:
            cols_vagas = [c["name"] for c in inspect(conn).get_columns("lab_vagas")]
        except Exception:
            cols_vagas = []
        if "tipo_servico" not in cols_vagas and cols_vagas:
            try:
                with conn.begin_nested():
                    conn.execute(text("ALTER TABLE lab_vagas ADD COLUMN tipo_servico VARCHAR(50) DEFAULT 'rotina' NOT NULL"))
                    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lab_vagas_tipo_servico ON lab_vagas (tipo_servico)"))
            except Exception:
                pass

        if "data_pedido" not in cols_fila_psf and cols_fila_psf:
            try:
                with conn.begin_nested():
                    conn.execute(text("ALTER TABLE lab_fila_psf ADD COLUMN data_pedido DATE"))
                    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lab_fila_psf_data_pedido ON lab_fila_psf (data_pedido)"))
                    conn.execute(text("UPDATE lab_fila_psf SET data_pedido = data_solicitacao WHERE data_pedido IS NULL"))
            except Exception:
                pass

        if "especialidade" not in cols_fila_psf and cols_fila_psf:
            try:
                with conn.begin_nested():
                    conn.execute(text("ALTER TABLE lab_fila_psf ADD COLUMN especialidade VARCHAR(120) DEFAULT '' NOT NULL"))
                    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lab_fila_psf_especialidade ON lab_fila_psf (especialidade)"))
            except Exception:
                pass

        if "contrato_id" not in cols_solic_mestre and cols_solic_mestre:
            try:
                with conn.begin_nested():
                    conn.execute(text("ALTER TABLE lab_solic_mestre ADD COLUMN contrato_id INTEGER"))
                    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lab_solic_mestre_contrato_id ON lab_solic_mestre (contrato_id)"))
            except Exception:
                pass

        # Tipos SQL conforme o dialeto do banco
        is_pg = conn.dialect.name == "postgresql"
        pk_type = "SERIAL PRIMARY KEY" if is_pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
        bytea_type = "BYTEA" if is_pg else "BLOB"
        float_type = "DOUBLE PRECISION" if is_pg else "REAL"

        try:
            cols_solic_itens = [c["name"] for c in inspect(conn).get_columns("lab_solic_itens")]
        except Exception:
            cols_solic_itens = []
        for col, ddl in {
            "contrato_id": "INTEGER",
            "valor_unitario_aplicado": f"{float_type} DEFAULT 0.0 NOT NULL",
            "origem_preco": "VARCHAR(30) DEFAULT 'sigtap_padrao' NOT NULL",
        }.items():
            if col not in cols_solic_itens and cols_solic_itens:
                try:
                    with conn.begin_nested():
                        conn.execute(text(f"ALTER TABLE lab_solic_itens ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass

        # Garante criação idempotente das tabelas do motor de liberação em lote

        ddls_tabelas_lote = [
            f"""CREATE TABLE IF NOT EXISTS lab_orcamentos_mensais (
                id {pk_type},
                competencia VARCHAR(7) NOT NULL,
                teto_mensal {float_type} DEFAULT 0.0 NOT NULL,
                valor_consumido {float_type} DEFAULT 0.0 NOT NULL,
                observacoes VARCHAR(500) DEFAULT '' NOT NULL,
                atualizado_por VARCHAR(120) DEFAULT '' NOT NULL,
                created_at TIMESTAMP,
                updated_at TIMESTAMP
            )""",
            f"""CREATE TABLE IF NOT EXISTS lab_lotes_liberacao (
                id {pk_type},
                codigo_lote VARCHAR(32) NOT NULL,
                orcamento_id INTEGER,
                competencia VARCHAR(7) NOT NULL,
                laboratorio_id INTEGER NOT NULL,
                laboratorio_nome VARCHAR(120) DEFAULT '' NOT NULL,
                valor_solicitado {float_type} DEFAULT 0.0 NOT NULL,
                valor_consumido {float_type} DEFAULT 0.0 NOT NULL,
                qtd_pacientes INTEGER DEFAULT 0 NOT NULL,
                qtd_exames INTEGER DEFAULT 0 NOT NULL,
                datas_alocacao_json TEXT DEFAULT '[]' NOT NULL,
                status VARCHAR(20) DEFAULT 'consolidado' NOT NULL,
                observacoes VARCHAR(500) DEFAULT '' NOT NULL,
                arquivo_comprovantes_nome VARCHAR(200) DEFAULT '' NOT NULL,
                arquivo_comprovantes_sha256 VARCHAR(64) DEFAULT '' NOT NULL,
                arquivo_excel_nome VARCHAR(200) DEFAULT '' NOT NULL,
                arquivo_excel_sha256 VARCHAR(64) DEFAULT '' NOT NULL,
                criado_por VARCHAR(120) DEFAULT '' NOT NULL,
                created_at TIMESTAMP
            )""",
            f"""CREATE TABLE IF NOT EXISTS lab_lote_itens (
                id {pk_type},
                lote_id INTEGER NOT NULL,
                fila_psf_id INTEGER NOT NULL,
                solicitacao_mestre_id INTEGER NOT NULL,
                paciente_id INTEGER NOT NULL,
                paciente_nome VARCHAR(150) DEFAULT '' NOT NULL,
                paciente_cpf VARCHAR(20) DEFAULT '' NOT NULL,
                paciente_prontuario VARCHAR(30) DEFAULT '' NOT NULL,
                data_agendada DATE NOT NULL,
                ordem_selecao INTEGER DEFAULT 1 NOT NULL,
                prioridade_fila VARCHAR(20) DEFAULT 'rotina' NOT NULL,
                valor_consumido {float_type} DEFAULT 0.0 NOT NULL,
                exames_snapshot_json TEXT DEFAULT '[]' NOT NULL
            )""",
            f"""CREATE TABLE IF NOT EXISTS lab_lote_artefatos (
                id {pk_type},
                lote_id INTEGER NOT NULL,
                tipo VARCHAR(30) NOT NULL,
                nome_arquivo VARCHAR(200) NOT NULL,
                mime_type VARCHAR(120) NOT NULL,
                tamanho_bytes INTEGER DEFAULT 0 NOT NULL,
                sha256 VARCHAR(64) DEFAULT '' NOT NULL,
                conteudo {bytea_type},
                created_at TIMESTAMP
            )""",
            f"""CREATE TABLE IF NOT EXISTS lab_contratos (
                id {pk_type},
                laboratorio_id INTEGER NOT NULL,
                numero_contrato VARCHAR(50) NOT NULL,
                processo_licitatorio VARCHAR(50) DEFAULT '' NOT NULL,
                objeto VARCHAR(500) DEFAULT '' NOT NULL,
                data_inicio DATE NOT NULL,
                data_fim DATE NOT NULL,
                valor_total_contrato {float_type} DEFAULT 0.0 NOT NULL,
                valor_mensal_teto {float_type} DEFAULT 0.0 NOT NULL,
                valor_total_gasto {float_type} DEFAULT 0.0 NOT NULL,
                cota_exames_mensal INTEGER DEFAULT 0 NOT NULL,
                status VARCHAR(20) DEFAULT 'ativo' NOT NULL,
                gestor_contrato VARCHAR(120) DEFAULT '' NOT NULL,
                observacoes VARCHAR(500) DEFAULT '' NOT NULL,
                created_at TIMESTAMP,
                updated_at TIMESTAMP
            )""",
            f"""CREATE TABLE IF NOT EXISTS lab_contratos_precos (
                id {pk_type},
                contrato_id INTEGER NOT NULL,
                sigtap_id INTEGER NOT NULL,
                codigo_sigtap VARCHAR(20) NOT NULL,
                valor_customizado {float_type} DEFAULT 0.0 NOT NULL,
                vigencia_inicio DATE NOT NULL,
                vigencia_fim DATE,
                ativo BOOLEAN DEFAULT TRUE NOT NULL,
                justificativa VARCHAR(255) DEFAULT '' NOT NULL,
                created_at TIMESTAMP
            )""",
            f"""CREATE TABLE IF NOT EXISTS lab_fpo_competencias (
                id {pk_type},
                laboratorio_id INTEGER NOT NULL,
                contrato_id INTEGER,
                competencia VARCHAR(7) NOT NULL,
                cnes_prestador VARCHAR(20) DEFAULT '' NOT NULL,
                numero_fpo VARCHAR(50) DEFAULT '' NOT NULL,
                teto_fisico_programado INTEGER DEFAULT 0 NOT NULL,
                teto_financeiro_programado {float_type} DEFAULT 0.0 NOT NULL,
                total_fisico_executado INTEGER DEFAULT 0 NOT NULL,
                total_financeiro_executado {float_type} DEFAULT 0.0 NOT NULL,
                status VARCHAR(20) DEFAULT 'programada' NOT NULL,
                exportado_em TIMESTAMP,
                criado_por VARCHAR(120) DEFAULT '' NOT NULL,
                created_at TIMESTAMP
            )""",
            f"""CREATE TABLE IF NOT EXISTS lab_fpo_itens (
                id {pk_type},
                fpo_id INTEGER NOT NULL,
                sigtap_id INTEGER NOT NULL,
                codigo_procedimento VARCHAR(20) NOT NULL,
                descricao_procedimento VARCHAR(255) DEFAULT '' NOT NULL,
                quantidade_orcada INTEGER DEFAULT 0 NOT NULL,
                valor_orcado {float_type} DEFAULT 0.0 NOT NULL,
                quantidade_aprovada INTEGER DEFAULT 0 NOT NULL,
                valor_aprovado {float_type} DEFAULT 0.0 NOT NULL
            )""",
            f"""CREATE TABLE IF NOT EXISTS lab_faturamento_fechamentos (
                id {pk_type},
                laboratorio_id INTEGER NOT NULL,
                contrato_id INTEGER,
                competencia VARCHAR(7) NOT NULL,
                qtd_solicitacoes INTEGER DEFAULT 0 NOT NULL,
                qtd_exames INTEGER DEFAULT 0 NOT NULL,
                valor_total_apurado {float_type} DEFAULT 0.0 NOT NULL,
                valor_total_glosado {float_type} DEFAULT 0.0 NOT NULL,
                valor_total_aprovado {float_type} DEFAULT 0.0 NOT NULL,
                status VARCHAR(30) DEFAULT 'em_apuracao' NOT NULL,
                liberado_visualizacao_lab BOOLEAN DEFAULT FALSE NOT NULL,
                aprovado_por VARCHAR(120) DEFAULT '' NOT NULL,
                aprovado_em TIMESTAMP,
                parecer_secretaria VARCHAR(1000) DEFAULT '' NOT NULL,
                created_at TIMESTAMP,
                updated_at TIMESTAMP
            )""",
            f"""CREATE TABLE IF NOT EXISTS lab_feriados_bloqueios (
                id {pk_type},
                data DATE NOT NULL,
                descricao VARCHAR(150) DEFAULT '' NOT NULL,
                bloquear_agendamento BOOLEAN DEFAULT TRUE NOT NULL,
                laboratorio_id INTEGER,
                created_at TIMESTAMP
            )""",
        ]
        for ddl_tbl in ddls_tabelas_lote:
            try:
                with conn.begin_nested():
                    conn.execute(text(ddl_tbl))
            except Exception as exc_ddl:
                _session_log.warning("Aviso DDL em init_db: %s", exc_ddl)

        try:
            with conn.begin_nested():
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS unaccent"))
        except Exception as exc_ext:
            _session_log.warning("Aviso ao criar extensao unaccent: %s", exc_ext)

        for idx_lote in [
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_lab_orcamento_competencia ON lab_orcamentos_mensais (competencia)",
            "CREATE INDEX IF NOT EXISTS ix_lab_orcamentos_mensais_competencia ON lab_orcamentos_mensais (competencia)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_lab_lotes_liberacao_codigo_lote ON lab_lotes_liberacao (codigo_lote)",
            "CREATE INDEX IF NOT EXISTS ix_lab_lotes_liberacao_competencia ON lab_lotes_liberacao (competencia)",
            "CREATE INDEX IF NOT EXISTS ix_lab_lotes_liberacao_laboratorio_id ON lab_lotes_liberacao (laboratorio_id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_lotes_liberacao_orcamento_id ON lab_lotes_liberacao (orcamento_id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_feriados_bloqueios_data ON lab_feriados_bloqueios (data)",
            "CREATE INDEX IF NOT EXISTS ix_lab_feriados_bloqueios_lab ON lab_feriados_bloqueios (laboratorio_id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_lote_itens_lote_id ON lab_lote_itens (lote_id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_lote_itens_fila_psf_id ON lab_lote_itens (fila_psf_id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_lote_itens_solicitacao_mestre_id ON lab_lote_itens (solicitacao_mestre_id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_lote_itens_paciente_id ON lab_lote_itens (paciente_id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_lote_itens_data_agendada ON lab_lote_itens (data_agendada)",
            "CREATE INDEX IF NOT EXISTS ix_lab_lote_artefatos_lote_id ON lab_lote_artefatos (lote_id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_lote_artefatos_tipo ON lab_lote_artefatos (tipo)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_lab_lote_artefato_tipo ON lab_lote_artefatos (lote_id, tipo)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_lab_contratos_numero ON lab_contratos (numero_contrato)",
            "CREATE INDEX IF NOT EXISTS ix_lab_contratos_laboratorio_id ON lab_contratos (laboratorio_id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_contratos_status ON lab_contratos (status)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_lab_contrato_proc_preco ON lab_contratos_precos (contrato_id, sigtap_id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_contratos_precos_contrato_id ON lab_contratos_precos (contrato_id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_contratos_precos_sigtap_id ON lab_contratos_precos (sigtap_id)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_lab_fpo_lab_competencia ON lab_fpo_competencias (laboratorio_id, competencia)",
            "CREATE INDEX IF NOT EXISTS ix_lab_fpo_competencias_competencia ON lab_fpo_competencias (competencia)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_lab_fpo_item_proc ON lab_fpo_itens (fpo_id, sigtap_id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_fpo_itens_fpo_id ON lab_fpo_itens (fpo_id)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_lab_fat_fechamento_lab_comp ON lab_faturamento_fechamentos (laboratorio_id, competencia)",
            "CREATE INDEX IF NOT EXISTS ix_lab_fat_fechamentos_competencia ON lab_faturamento_fechamentos (competencia)",
            """
            CREATE TABLE IF NOT EXISTS prestadores (
                id SERIAL PRIMARY KEY,
                razao_social VARCHAR(150) NOT NULL,
                nome_fantasia VARCHAR(150) NOT NULL DEFAULT '',
                cnpj VARCHAR(20) NOT NULL DEFAULT '',
                cnes VARCHAR(20) NOT NULL DEFAULT '',
                tipo_entidade VARCHAR(50) NOT NULL DEFAULT 'hospital',
                responsavel_nome VARCHAR(120) NOT NULL DEFAULT '',
                responsavel_telefone VARCHAR(30) NOT NULL DEFAULT '',
                email VARCHAR(120) NOT NULL DEFAULT '',
                telefone VARCHAR(30) NOT NULL DEFAULT '',
                endereco VARCHAR(200) NOT NULL DEFAULT '',
                municipio VARCHAR(100) NOT NULL DEFAULT 'Guapé',
                ativo BOOLEAN NOT NULL DEFAULT TRUE,
                observacoes VARCHAR(500) NOT NULL DEFAULT ''
            )
            """,
            "CREATE INDEX IF NOT EXISTS ix_prestadores_razao_social ON prestadores (razao_social)",
            "CREATE INDEX IF NOT EXISTS ix_prestadores_cnpj ON prestadores (cnpj)",
            "CREATE INDEX IF NOT EXISTS ix_prestadores_cnes ON prestadores (cnes)",
            "CREATE INDEX IF NOT EXISTS ix_prestadores_ativo ON prestadores (ativo)",
            "ALTER TABLE lab_solic_mestre ALTER COLUMN status TYPE VARCHAR(40)",
            "ALTER TABLE lab_solic_mestre ADD COLUMN IF NOT EXISTS laudo_arquivo_id INTEGER",
            "CREATE INDEX IF NOT EXISTS ix_lab_solic_mestre_laudo_arquivo_id ON lab_solic_mestre (laudo_arquivo_id)",
            """
            CREATE TABLE IF NOT EXISTS lab_resultado_arquivos (
                id SERIAL PRIMARY KEY,
                solicitacao_id INTEGER NOT NULL REFERENCES lab_solic_mestre(id),
                paciente_id INTEGER NOT NULL REFERENCES tfd_pacientes(id),
                laboratorio_id INTEGER NOT NULL REFERENCES lab_laboratorios(id),
                nome_arquivo_original VARCHAR(255) NOT NULL,
                nome_arquivo_sistema VARCHAR(255) NOT NULL,
                caminho_storage VARCHAR(500) NOT NULL DEFAULT '',
                sha256_hash VARCHAR(64) NOT NULL,
                tamanho_bytes INTEGER NOT NULL DEFAULT 0,
                mime_type VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
                texto_extraido TEXT,
                enviado_por VARCHAR(120) NOT NULL DEFAULT '',
                enviado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                ativo BOOLEAN NOT NULL DEFAULT TRUE
            )
            """,
            "CREATE INDEX IF NOT EXISTS ix_lab_resultado_arquivos_solicitacao_id ON lab_resultado_arquivos (solicitacao_id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_resultado_arquivos_paciente_id ON lab_resultado_arquivos (paciente_id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_resultado_arquivos_sha256_hash ON lab_resultado_arquivos (sha256_hash)",
            """
            CREATE TABLE IF NOT EXISTS lab_conferencias_automaticas (
                id SERIAL PRIMARY KEY,
                solicitacao_id INTEGER NOT NULL REFERENCES lab_solic_mestre(id),
                arquivo_id INTEGER NOT NULL REFERENCES lab_resultado_arquivos(id),
                match_paciente_ok BOOLEAN NOT NULL DEFAULT FALSE,
                paciente_criterio_match VARCHAR(200) NOT NULL DEFAULT '',
                dados_paciente_encontrados_json TEXT NOT NULL DEFAULT '{}',
                status_conferencia VARCHAR(50) NOT NULL DEFAULT 'inconsistente',
                exames_solicitados_json TEXT NOT NULL DEFAULT '[]',
                exames_encontrados_json TEXT NOT NULL DEFAULT '[]',
                exames_faltantes_json TEXT NOT NULL DEFAULT '[]',
                exames_adicionais_json TEXT NOT NULL DEFAULT '[]',
                total_solicitados INTEGER NOT NULL DEFAULT 0,
                total_encontrados INTEGER NOT NULL DEFAULT 0,
                total_faltantes INTEGER NOT NULL DEFAULT 0,
                total_adicionais INTEGER NOT NULL DEFAULT 0,
                score_confianca DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                executado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            )
            """,
            "CREATE INDEX IF NOT EXISTS ix_lab_conferencias_solic_id ON lab_conferencias_automaticas (solicitacao_id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_conferencias_status ON lab_conferencias_automaticas (status_conferencia)",
            """
            CREATE TABLE IF NOT EXISTS lab_inconsistencias_justificativas (
                id SERIAL PRIMARY KEY,
                solicitacao_id INTEGER NOT NULL REFERENCES lab_solic_mestre(id),
                conferencia_id INTEGER NOT NULL REFERENCES lab_conferencias_automaticas(id),
                motivo_inconsistencia VARCHAR(60) NOT NULL DEFAULT 'divergencia_exames',
                justificativa_laboratorio VARCHAR(2000) NOT NULL,
                registrado_por VARCHAR(120) NOT NULL DEFAULT '',
                registrado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                status_revisao VARCHAR(30) NOT NULL DEFAULT 'pendente_secretaria',
                parecer_secretaria VARCHAR(2000) NOT NULL DEFAULT '',
                revisado_por VARCHAR(120) NOT NULL DEFAULT '',
                revisado_em TIMESTAMP WITHOUT TIME ZONE
            )
            """,
            "CREATE INDEX IF NOT EXISTS ix_lab_inconsistencias_solic_id ON lab_inconsistencias_justificativas (solicitacao_id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_inconsistencias_status_revisao ON lab_inconsistencias_justificativas (status_revisao)",
            # Migrações Subagente 1: Tipagem de Filas e Regras de Serviços (tfd_tipos_fila)
            "ALTER TABLE tfd_tipos_fila ADD COLUMN IF NOT EXISTS tipo_fila VARCHAR(40) DEFAULT 'REGULACAO_GERAL' NOT NULL",
            "CREATE INDEX IF NOT EXISTS ix_tfd_tipos_fila_tipo_fila ON tfd_tipos_fila (tipo_fila)",
            "ALTER TABLE tfd_tipos_fila ADD COLUMN IF NOT EXISTS cbos_permitidos VARCHAR(2000) DEFAULT '' NOT NULL",
            "ALTER TABLE tfd_tipos_fila ADD COLUMN IF NOT EXISTS exigir_cbo_estrito BOOLEAN DEFAULT FALSE NOT NULL",
            "ALTER TABLE tfd_tipos_fila ADD COLUMN IF NOT EXISTS prefixos_sigtap VARCHAR(500) DEFAULT '' NOT NULL",
            "ALTER TABLE tfd_tipos_fila ADD COLUMN IF NOT EXISTS excluir_prefixos_sigtap VARCHAR(500) DEFAULT '' NOT NULL",
            "ALTER TABLE tfd_tipos_fila ADD COLUMN IF NOT EXISTS especialidade_padrao VARCHAR(120) DEFAULT '' NOT NULL",
            "ALTER TABLE tfd_tipos_fila ADD COLUMN IF NOT EXISTS cbo_padrao VARCHAR(10) DEFAULT '' NOT NULL",
            "ALTER TABLE tfd_tipos_fila ADD COLUMN IF NOT EXISTS sinonimos VARCHAR(1000) DEFAULT '' NOT NULL",
            "ALTER TABLE tfd_tipos_fila ADD COLUMN IF NOT EXISTS descricao_regras VARCHAR(1000) DEFAULT '' NOT NULL",
            "UPDATE tfd_tipos_fila SET tipo_fila = 'EXAME_LABORATORIAL' WHERE (nome ILIKE '%SANGUE%' OR nome ILIKE '%LABORAT%' OR nome ILIKE '%BIOQUIM%') AND (tipo_fila IS NULL OR tipo_fila = '' OR tipo_fila = 'REGULACAO_GERAL')",
            "UPDATE tfd_tipos_fila SET tipo_fila = 'ALTA_COMPLEXIDADE' WHERE (nome ILIKE '%APAC%' OR nome ILIKE '%ALTA COMPLEX%') AND (tipo_fila IS NULL OR tipo_fila = '' OR tipo_fila = 'REGULACAO_GERAL')",
            # Migrações Subagente 2: Composição de Equipamentos de Oxigênio
            "ALTER TABLE oxigenio_equipamentos ADD COLUMN IF NOT EXISTS cilindro_incluso_tipo VARCHAR(30)",
            "ALTER TABLE oxigenio_equipamentos ADD COLUMN IF NOT EXISTS cilindro_incluso_qtd INTEGER DEFAULT 0 NOT NULL",
            # Migrações Subagente 2: Vínculo com a Fila (fila_id) e Tipagem em tfd_exames_fila e lab_fila_psf
            "ALTER TABLE tfd_exames_fila ADD COLUMN IF NOT EXISTS fila_id INTEGER REFERENCES tfd_tipos_fila(id)",
            "CREATE INDEX IF NOT EXISTS ix_tfd_exames_fila_fila_id ON tfd_exames_fila (fila_id)",
            "ALTER TABLE lab_fila_psf ADD COLUMN IF NOT EXISTS fila_id INTEGER REFERENCES tfd_tipos_fila(id)",
            "CREATE INDEX IF NOT EXISTS ix_lab_fila_psf_fila_id ON lab_fila_psf (fila_id)",
            "ALTER TABLE lab_fila_psf ADD COLUMN IF NOT EXISTS tipo_fila VARCHAR(80) DEFAULT '' NOT NULL",
            "CREATE INDEX IF NOT EXISTS ix_lab_fila_psf_tipo_fila ON lab_fila_psf (tipo_fila)",
            "ALTER TABLE lab_fila_psf ADD COLUMN IF NOT EXISTS unidade_saude_id INTEGER",
            "CREATE INDEX IF NOT EXISTS ix_lab_fila_psf_unidade_saude_id ON lab_fila_psf (unidade_saude_id)",
            # Backfill fila_id em tfd_exames_fila a partir do nome da fila
            """
            UPDATE tfd_exames_fila ef
            SET fila_id = tf.id
            FROM tfd_tipos_fila tf
            WHERE ef.fila_id IS NULL
              AND (
                UPPER(TRIM(ef.tipo_fila)) = UPPER(TRIM(tf.nome))
                OR UPPER(TRIM(ef.especialidade)) = UPPER(TRIM(tf.nome))
              )
            """,
            # Backfill fila_id e tipo_fila em lab_fila_psf
            """
            UPDATE lab_fila_psf lp
            SET fila_id = tf.id,
                tipo_fila = COALESCE(NULLIF(lp.tipo_fila, ''), tf.nome)
            FROM tfd_tipos_fila tf
            WHERE lp.fila_id IS NULL
              AND (
                UPPER(TRIM(lp.tipo_fila)) = UPPER(TRIM(tf.nome))
                OR UPPER(TRIM(lp.especialidade)) = UPPER(TRIM(tf.nome))
              )
            """,
            # Migração de visibilidade pós-importação: garantir que exames laboratoriais existentes em tfd_exames_fila estejam sincronizados em lab_fila_psf
            """
            INSERT INTO lab_fila_psf (
                paciente_id, especialidade, unidade_psf, medico_solicitante,
                data_solicitacao, data_pedido, status, prioridade,
                justificativa, observacoes, sigtap_ids_json, fila_id, tipo_fila, unidade_saude_id
            )
            SELECT
                ef.paciente_id,
                COALESCE(NULLIF(ef.tipo_fila, ''), ef.especialidade, 'EXAME_LABORATORIAL'),
                COALESCE(NULLIF(ef.unidade_nome, ''), ef.destino, ''),
                COALESCE(ef.medico_nome, ''),
                COALESCE(ef.data_pedido, CURRENT_DATE),
                ef.data_pedido,
                CASE
                    WHEN ef.status = 'aguardando' THEN 'na_fila'
                    WHEN ef.status = 'agendado' THEN 'agendado'
                    WHEN ef.status = 'cancelado' THEN 'cancelado'
                    ELSE 'na_fila'
                END,
                CASE
                    WHEN LOWER(ef.prioridade) = 'urgente' THEN 'urgente'
                    WHEN LOWER(ef.prioridade) = 'alta' THEN 'alta'
                    ELSE 'rotina'
                END,
                COALESCE(ef.justificativa, ''),
                COALESCE(ef.observacoes, ''),
                '[]',
                ef.fila_id,
                COALESCE(NULLIF(ef.tipo_fila, ''), 'EXAME_LABORATORIAL'),
                ef.unidade_saude_id
            FROM tfd_exames_fila ef
            WHERE ef.ativo = TRUE
              AND (
                EXISTS (
                    SELECT 1 FROM tfd_tipos_fila tf
                    WHERE tf.tipo_fila = 'EXAME_LABORATORIAL'
                      AND (tf.id = ef.fila_id OR UPPER(TRIM(tf.nome)) = UPPER(TRIM(ef.tipo_fila)))
                )
                OR UPPER(ef.tipo_fila) LIKE '%LAB%'
                OR UPPER(ef.tipo_fila) LIKE '%SANGUE%'
                OR UPPER(ef.tipo_fila) LIKE '%BIOQUIM%'
              )
              AND NOT EXISTS (
                SELECT 1 FROM lab_fila_psf lp
                WHERE lp.paciente_id = ef.paciente_id
                  AND lp.data_solicitacao = ef.data_pedido
                  AND (lp.tipo_fila = ef.tipo_fila OR lp.especialidade = ef.tipo_fila)
              )
            """,
            "ALTER TABLE lab_fila_psf ADD COLUMN IF NOT EXISTS data_agendada date",
            "ALTER TABLE lab_fila_psf ADD COLUMN IF NOT EXISTS hora_agendada varchar(10)",
            """
            INSERT INTO tfd_tipos_fila (codigo, nome, tipo_fila, ativo)
            VALUES 
                ('', 'EX. LAB. PSF ROTINA', 'EXAME_LABORATORIAL', true),
                ('', 'EX. LAB. SECRETARIA', 'EXAME_LABORATORIAL', true),
                ('', 'EX. LAB. HIPERDIA', 'EXAME_LABORATORIAL', true),
                ('', 'EX. LAB. PEDIATRIA', 'EXAME_LABORATORIAL', true),
                ('', 'EX. LAB. PRÉ-NATAL', 'EXAME_LABORATORIAL', true),
                ('', 'EX. LAB. GINECOLOGIA', 'EXAME_LABORATORIAL', true),
                ('', 'LAB EX CAPS', 'EXAME_LABORATORIAL', true)
            ON CONFLICT DO NOTHING
            """,
            """
            UPDATE tfd_tipos_fila
            SET tipo_fila = 'EXAME_LABORATORIAL'
            WHERE UPPER(TRIM(nome)) IN (
                'EX. LAB. PSF ROTINA', 'EX. LAB. SECRETARIA', 'EX. LAB. HIPERDIA',
                'EX. LAB. PEDIATRIA', 'EX. LAB. PRÉ-NATAL', 'EX. LAB. GINECOLOGIA', 'LAB EX CAPS'
            ) AND tipo_fila != 'EXAME_LABORATORIAL'
            """,
            """
            INSERT INTO lab_laboratorios (nome, ativo)
            SELECT 'Labcon Análises Clínicas', true
            WHERE NOT EXISTS (SELECT 1 FROM lab_laboratorios WHERE nome ILIKE '%LABCON%')
            """,
            """
            INSERT INTO lab_laboratorios (nome, ativo)
            SELECT 'Medlabor Análises Clínicas', true
            WHERE NOT EXISTS (SELECT 1 FROM lab_laboratorios WHERE nome ILIKE '%MEDLABOR%' OR nome ILIKE '%MED LABOR%')
            """,
            """
            INSERT INTO lab_laboratorios (nome, ativo)
            SELECT 'Pró-Análises Laboratório', true
            WHERE NOT EXISTS (SELECT 1 FROM lab_laboratorios WHERE unaccent(nome) ILIKE '%PRO%ANALISE%' OR nome ILIKE '%PRO%AN%LISE%')
            """,
            "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1",
            """
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'tfd_pacientes'
                  AND column_name = 'co_seq_cidadao_pec'
                  AND data_type = 'integer'
              ) THEN
                ALTER TABLE tfd_pacientes ALTER COLUMN co_seq_cidadao_pec TYPE BIGINT;
              END IF;
            END $$;
            """,
            "CREATE INDEX IF NOT EXISTS ix_tfd_exames_fila_data_agendada ON tfd_exames_fila (data_agendada)",
            "CREATE INDEX IF NOT EXISTS ix_tfd_exames_fila_ativo_status_pedido ON tfd_exames_fila (ativo, status, data_pedido)",
            "CREATE INDEX IF NOT EXISTS ix_tfd_viagem_fila_data_consulta ON tfd_viagem_fila (data_consulta)",
            "CREATE INDEX IF NOT EXISTS ix_lab_solic_mestre_lab_status_data ON lab_solic_mestre (laboratorio_id, status, data_agendada)",
            "CREATE INDEX IF NOT EXISTS ix_audit_logs_entity_entity_id_ts ON audit_logs (entity, entity_id, timestamp)",
        ]:
            try:
                with conn.begin_nested():
                    conn.execute(text(idx_lote))
            except Exception as exc_lote:
                _session_log.warning("Aviso DDL/Seed em init_db: %s", exc_lote)

    # Garante extensão unaccent (quando o usuário do banco tem permissão) e índices únicos
    with engine.begin() as conn:
        if conn.dialect.name == "postgresql":
            try:
                with conn.begin_nested():
                    conn.execute(text("CREATE EXTENSION IF NOT EXISTS unaccent"))
            except Exception:
                pass
            for col_hist_sql in [
                "ALTER TABLE tfd_pacientes_historico ALTER COLUMN motivo TYPE VARCHAR(500)",
                "ALTER TABLE tfd_pacientes_historico ALTER COLUMN descricao TYPE VARCHAR(1000)",
                "ALTER TABLE tfd_pacientes_historico ALTER COLUMN tipo_evento TYPE VARCHAR(60)",
                "ALTER TABLE tfd_pacientes_historico ALTER COLUMN origem TYPE VARCHAR(100)",
            ]:
                try:
                    with conn.begin_nested():
                        conn.execute(text(col_hist_sql))
                except Exception:
                    pass
        for idx_sql in [
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_tfd_viagem_paciente ON tfd_viagem_pacientes (viagem_id, paciente_id)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_tfd_faturamento_viagem_pac_cod ON tfd_faturamento (viagem_id, paciente_id, codigo_sigtap) WHERE viagem_id IS NOT NULL",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_tfd_viagem_fila_exame_ativo ON tfd_viagem_fila (exame_fila_id) WHERE exame_fila_id IS NOT NULL AND status IN ('aguardando', 'alocado')",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_apac_solicitacoes_numero_apac ON apac_solicitacoes (numero_apac) WHERE numero_apac IS NOT NULL AND numero_apac != ''",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_lab_solic_mestre_origem_fila_ativa ON lab_solic_mestre (origem_fila_id) WHERE origem_fila_id IS NOT NULL AND status != 'cancelado'",
            """CREATE TABLE IF NOT EXISTS gerenciamento_dados_cache (
                chave VARCHAR(40) PRIMARY KEY,
                payload_json TEXT NOT NULL,
                atualizado_em TIMESTAMP NOT NULL
            )""",
        ]:
            try:
                with conn.begin_nested():
                    conn.execute(text(idx_sql))
            except Exception:
                pass

        # Migração segura e idempotente para ampliar colunas de nomes SIGTAP/TFD
        try:
            from app.services.sigtap_hierarquia import migrar_colunas_sigtap_amplas

            migrar_colunas_sigtap_amplas(conn)
        except Exception as exc_sigtap_col:
            _session_log.warning("Aviso em migrar_colunas_sigtap_amplas: %s", exc_sigtap_col)

        # Backfill idempotente de numeração de pedidos (codigo_solicitacao) na Fila de Exames de Sangue (lab_fila_psf)
        try:
            from app.services.lab_fase6 import backfill_codigos_fila_psf

            with conn.begin_nested():
                backfill_codigos_fila_psf(conn)
        except Exception as exc_backfill_lab:
            _session_log.warning("Aviso em backfill_codigos_fila_psf: %s", exc_backfill_lab)
