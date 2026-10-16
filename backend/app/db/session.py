from sqlmodel import SQLModel, create_engine

from app.core.config import settings

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)


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
    from app.models.integracoes import IntegrationSettings  # noqa: F401
    from app.models.dashboard_prefs import UserDashboardPrefs  # noqa: F401
    from app.models.audit import AuditLog  # noqa: F401
    from app.models.cadastros_saude import Medico, UnidadeSaude  # noqa: F401

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
                text("ALTER TABLE tfd_exames_fila ADD COLUMN codigo_curto VARCHAR(12) DEFAULT '' NOT NULL")
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tfd_exames_fila_codigo_curto ON tfd_exames_fila (codigo_curto)"))
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
        }.items():
            if col not in cols_pac:
                try:
                    conn.execute(text(f"ALTER TABLE tfd_pacientes ADD COLUMN {col} {ddl}"))
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
        for col in ("brasao_url", "icone_url"):
            if col not in cols_st:
                try:
                    conn.execute(text(f"ALTER TABLE system_settings ADD COLUMN {col} VARCHAR(500) DEFAULT '' NOT NULL"))
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

    from sqlmodel import Session, select

    with Session(engine) as db:
        from app.services.lab import seed_sigtap
        from app.services.lab_fase6 import seed_laboratorios
        from app.services.seed_deslocamento import seed_deslocamento

        seed_sigtap(db)
        seed_laboratorios(db)
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
