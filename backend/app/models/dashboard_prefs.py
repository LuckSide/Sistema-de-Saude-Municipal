from datetime import datetime

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel


class UserDashboardPrefs(SQLModel, table=True):
    """Layout customizado do dashboard por usuário (JSON validado na API)."""

    __tablename__ = "user_dashboard_preferences"

    user_id: int | None = Field(default=None, primary_key=True, foreign_key="usuarios.id")
    layout: str = Field(default="[]", max_length=8000)
    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False), onupdate=datetime.utcnow),
    )
