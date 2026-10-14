from datetime import datetime

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    __tablename__ = "usuarios"

    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True, max_length=50)
    password_hash: str = Field(max_length=255)
    nome: str = Field(default="", max_length=120)
    area: str = Field(default="painel", max_length=20)  # painel | ferramentas
    telas: str = Field(default="", max_length=500)  # csv: dashboard,tfd,aps
    is_superuser: bool = Field(default=False)
    is_active: bool = Field(default=True)
    must_change_password: bool = Field(default=True)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )
