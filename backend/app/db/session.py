from sqlmodel import SQLModel, create_engine

from app.core.config import settings

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)


def init_db() -> None:
    from app.models.lab_exames import (  # noqa: F401
        LabSolicitacao,
        SigtapProcedimento,
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
        Paciente,
        ProcedimentoCatalogo,
        TipoFila,
        Veiculo,
        Viagem,
        ViagemPaciente,
    )
    from app.models.user import User  # noqa: F401
    from app.models.settings import SystemSettings  # noqa: F401

    SQLModel.metadata.create_all(engine)

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
        for col, ddl in [
            ("tipo_fila", "VARCHAR(80) DEFAULT '' NOT NULL"),
            ("codigo_procedimento", "VARCHAR(20) DEFAULT '' NOT NULL"),
            ("codigo_especialidade", "VARCHAR(10) DEFAULT '' NOT NULL"),
            ("nome_especialidade", "VARCHAR(120) DEFAULT '' NOT NULL"),
        ]:
            if col not in cols_ex:
                try:
                    conn.execute(text(f"ALTER TABLE tfd_exames_fila ADD COLUMN {col} {ddl}"))
                    conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_tfd_exames_fila_{col} ON tfd_exames_fila ({col})"))
                except Exception:
                    pass

    from sqlmodel import Session, select

    with Session(engine) as db:
        from app.services.lab import seed_sigtap
        from app.services.lab_fase6 import seed_laboratorios

        seed_sigtap(db)
        seed_laboratorios(db)
        # Seed settings padrão
        try:
            from app.models.settings import SystemSettings

            if not db.get(SystemSettings, 1):
                db.add(SystemSettings(id=1, cidade="Guapé", uf="MG", subtitulo="Secretaria Municipal"))
                db.commit()
        except Exception:
            pass
