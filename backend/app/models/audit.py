from datetime import datetime

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel


class AuditLog(SQLModel, table=True):
    """Trilha de auditoria de ações críticas (escritas via middleware global).

    user_id sem FK: histórico sobrevive à exclusão da conta.
    details é JSON textual já redigido (sem senhas/segredos, PII mínima).
    """

    __tablename__ = "audit_logs"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int | None = Field(default=None, index=True)
    user_name: str = Field(default="", max_length=120, index=True)
    action: str = Field(max_length=60, index=True)
    entity: str = Field(default="", max_length=40, index=True)
    entity_id: int | None = Field(default=None, index=True)
    details: str = Field(default="", max_length=20000)
    timestamp: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False), index=True),
    )
