from sqlmodel import SQLModel, create_engine

from app.core.config import settings

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


def init_db() -> None:
    from app.models.lab_exames import (  # noqa: F401
        LabSolicitacao,
        SigtapCbo,
        SigtapCid,
        SigtapProcedimento,
        SigtapVersao,
    )
    from app.models.lab_fase6 import (  # noqa: F401
        FilaPsf,
        ItemSolic,
        Laboratorio,
        SolicitacaoMestre,
        VagaLab,
    )
    from app.models.tfd import (  # noqa: F401
        Especialidade,
        ExameFila,
        Faturamento,
        Motorista,
        Paciente,
        ProcedimentoCatalogo,
        TipoFila,
        Veiculo,
        Viagem,
        ViagemFila,
        ViagemPaciente,
    )
    from app.models.user import User  # noqa: F401
    from app.models.settings import SystemSettings  # noqa: F401
    from app.models.integracoes import IntegrationSettings, PecSyncLog, PecIndicadorCache  # noqa: F401
    from app.models.dashboard_prefs import UserDashboardPrefs  # noqa: F401
    from app.models.audit import AuditLog  # noqa: F401
    from app.models.cadastros_saude import Medico, UnidadeSaude  # noqa: F401
    from app.models.apac import (  # noqa: F401
        AnexoLaudoAPAC,
        FaixaNumeracaoAPAC,
        LoteFaturamentoAPAC,
        ProcedimentoSecundarioAPAC,
        SolicitacaoAPAC,
    )

    # create_all com checkfirst ainda tem janela de corrida entre workers
    # (2x uvicorn no lifespan) — ignora erro de "já existe" e segue.
    try:
        SQLModel.metadata.create_all(engine)
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

        # Backfill codigo_curto imutável para exames
        try:
            if conn.dialect.name == "postgresql":
                conn.execute(text("UPDATE tfd_exames_fila SET codigo_curto = 'EX-' || LPAD(id::text, 6, '0') WHERE (codigo_curto IS NULL OR codigo_curto = '') AND id IS NOT NULL"))
            else:
                conn.execute(text("UPDATE tfd_exames_fila SET codigo_curto = 'EX-' || substr('000000' || id, -6, 6) WHERE (codigo_curto IS NULL OR codigo_curto = '') AND id IS NOT NULL"))
        except Exception:
            pass

        # Prontuário curto para Pacientes
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
        # Backfill codigo_prontuario imutável para pacientes
        try:
            if conn.dialect.name == "postgresql":
                conn.execute(text("UPDATE tfd_pacientes SET codigo_prontuario = 'PR-' || LPAD(id::text, 5, '0') WHERE (codigo_prontuario IS NULL OR codigo_prontuario = '') AND id IS NOT NULL"))
            else:
                conn.execute(text("UPDATE tfd_pacientes SET codigo_prontuario = 'PR-' || substr('00000' || id, -5, 5) WHERE (codigo_prontuario IS NULL OR codigo_prontuario = '') AND id IS NOT NULL"))
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
        ):
            try:
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS {idx} ON tfd_pacientes ({col})"))
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
        }.items():
            if col not in cols_ex3:
                try:
                    conn.execute(text(f"ALTER TABLE tfd_exames_fila ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass
        try:
            conn.execute(text("UPDATE tfd_exames_fila SET ativo = TRUE WHERE ativo IS NULL"))
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
        }.items():
            if col not in cols_sg:
                try:
                    conn.execute(text(f"ALTER TABLE sigtap_procedimentos ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass
        # Frota/viagem: status do veículo, dados da ordem de circulação e snapshots do passageiro
        try:
            cols_vei = [c["name"] for c in inspect(conn).get_columns("tfd_veiculos")]
        except Exception:
            cols_vei = []
        if "status" not in cols_vei:
            try:
                conn.execute(text("ALTER TABLE tfd_veiculos ADD COLUMN status VARCHAR(20) DEFAULT 'disponivel' NOT NULL"))
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
        }.items():
            if col not in cols_vp:
                try:
                    conn.execute(text(f"ALTER TABLE tfd_viagem_pacientes ADD COLUMN {col} {ddl}"))
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
        for col in ("brasao_url", "icone_url", "exames_habilitados_sigtap"):
            if col not in cols_st:
                try:
                    tipo_ddl = "TEXT DEFAULT '' NOT NULL" if col == "exames_habilitados_sigtap" else "VARCHAR(500) DEFAULT '' NOT NULL"
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
        }.items():
            if col not in cols_int:
                try:
                    conn.execute(text(f"ALTER TABLE integration_settings ADD COLUMN {col} {ddl}"))
                except Exception:
                    pass

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
            from app.services.sigtap_hierarquia import seed_vivver_procedimentos
            seed_vivver_procedimentos(db)
        except Exception:
            pass
        try:
            seed_deslocamento(db)
        except Exception:
            pass
        # Seed settings padrão
        try:
            from app.models.settings import SystemSettings

            if not db.get(SystemSettings, 1):
                db.add(SystemSettings(id=1, cidade="Guapé", uf="MG", subtitulo="Secretaria Municipal"))
                db.commit()
        except Exception:
            pass
        # Seed integrações (linha única id=1; segredos vazios)
        try:
            from app.models.integracoes import IntegrationSettings

            if not db.get(IntegrationSettings, 1):
                db.add(IntegrationSettings(id=1))
                db.commit()
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
            from app.models.tfd import Motorista

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
