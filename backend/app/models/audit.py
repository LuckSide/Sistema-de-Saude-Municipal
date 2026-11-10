from datetime import datetime

from sqlalchemy import Column, DateTime, Index
from sqlmodel import Field, SQLModel


class AuditLog(SQLModel, table=True):
    """Trilha de auditoria de ações críticas, exportações e pesquisas.

    user_id sem FK: histórico sobrevive à exclusão da conta.
    details é JSON textual já redigido (sem senhas/segredos, PII mínima).
    device armazena o navegador/sistema operacional identificado.
    """

    __tablename__ = "audit_logs"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int | None = Field(default=None, index=True)
    user_name: str = Field(default="", max_length=120, index=True)
    action: str = Field(max_length=60, index=True)
    entity: str = Field(default="", max_length=40, index=True)
    entity_id: int | None = Field(default=None, index=True)
    device: str = Field(default="", max_length=150, index=True)
    details: str = Field(default="", max_length=20000)
    timestamp: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False), index=True),
    )

    __table_args__ = (
        Index("ix_audit_logs_action_timestamp", "action", "timestamp"),
        Index("ix_audit_logs_user_timestamp", "user_id", "timestamp"),
        Index("ix_audit_logs_entity_timestamp", "entity", "timestamp"),
    )
