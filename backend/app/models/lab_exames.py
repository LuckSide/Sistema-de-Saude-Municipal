from datetime import date

from sqlalchemy import Column, Date
from sqlmodel import Field, SQLModel


class SigtapProcedimento(SQLModel, table=True):
    __tablename__ = "sigtap_procedimentos"

    id: int | None = Field(default=None, primary_key=True)
    codigo: str = Field(max_length=20, index=True, unique=True)
    descricao: str = Field(max_length=255, index=True)
    complexidade: str = Field(default="", max_length=20)
    instrumento: str = Field(default="BPA-C", max_length=10, index=True)


class LabSolicitacao(SQLModel, table=True):
    __tablename__ = "lab_solicitacoes"

    id: int | None = Field(default=None, primary_key=True)
    paciente_id: int = Field(foreign_key="tfd_pacientes.id", index=True)
    sigtap_id: int = Field(foreign_key="sigtap_procedimentos.id", index=True)
    data_solicitacao: date = Field(sa_column=Column(Date, index=True))
    laboratorio: str = Field(default="", max_length=120, index=True)
    status: str = Field(
        default="Solicitado", max_length=20, index=True
    )  # Solicitado|Agendado|Realizado|Cancelado
    faturado: bool = Field(default=False, index=True)
    competencia: str = Field(default="", max_length=7, index=True)  # AAAA-MM
    observacoes: str = Field(default="", max_length=500)
