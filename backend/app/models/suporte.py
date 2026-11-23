from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime, Text
from sqlmodel import Field, SQLModel


class TicketSuporte(SQLModel, table=True):
    """Modelo de dados para chamados e tickets de suporte dos usuários."""

    __tablename__ = "tickets_suporte"

    id: Optional[int] = Field(default=None, primary_key=True)
    usuario_id: Optional[int] = Field(default=None, index=True)
    usuario_nome: str = Field(default="", max_length=120)
    tipo: str = Field(
        default="bug",
        max_length=50,
        index=True,
    )  # bug, info_incorreta, nova_funcionalidade, duvida, outro
    descricao: str = Field(sa_column=Column(Text, nullable=False))
    pagina_url: str = Field(default="", max_length=500)
    status: str = Field(
        default="aberto",
        max_length=30,
        index=True,
    )  # aberto, em_analise, resolvido
    resposta_admin: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    resolvido_por: Optional[str] = Field(default=None, max_length=120)
    resolvido_em: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=False), nullable=True),
    )
    criado_em: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False), nullable=False),
    )
