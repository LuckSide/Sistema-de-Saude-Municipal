from datetime import date

from sqlalchemy import Column, Date, UniqueConstraint
from sqlmodel import Field, SQLModel

STATUS_FILA = ("na_fila", "agendado", "cancelado")
STATUS_MESTRE = ("agendado", "realizado", "cancelado")
STATUS_AUDIT = (
    "pendente_conferencia",
    "aprovado",
    "divergente",
    "aguardando_autorizacao_sec",
)


class Laboratorio(SQLModel, table=True):
    __tablename__ = "lab_laboratorios"

    id: int | None = Field(default=None, primary_key=True)
    nome: str = Field(max_length=120, unique=True, index=True)
    ativo: bool = Field(default=True, index=True)


class VagaLab(SQLModel, table=True):
    __tablename__ = "lab_vagas"
    __table_args__ = (UniqueConstraint("laboratorio_id", "data", name="uq_lab_vaga_lab_data"),)

    id: int | None = Field(default=None, primary_key=True)
    laboratorio_id: int = Field(foreign_key="lab_laboratorios.id", index=True)
    data: date = Field(sa_column=Column(Date, index=True))
    vagas_totais: int = Field(default=0)
    vagas_ocupadas: int = Field(default=0)


class FilaPsf(SQLModel, table=True):
    __tablename__ = "lab_fila_psf"

    id: int | None = Field(default=None, primary_key=True)
    paciente_id: int = Field(foreign_key="tfd_pacientes.id", index=True)
    unidade_psf: str = Field(default="", max_length=120, index=True)
    medico_solicitante: str = Field(default="", max_length=120)
    data_solicitacao: date = Field(sa_column=Column(Date, index=True))
    status: str = Field(default="na_fila", max_length=20, index=True)
    observacoes: str = Field(default="", max_length=500)


class SolicitacaoMestre(SQLModel, table=True):
    __tablename__ = "lab_solic_mestre"

    id: int | None = Field(default=None, primary_key=True)
    paciente_id: int = Field(foreign_key="tfd_pacientes.id", index=True)
    data_agendada: date = Field(sa_column=Column(Date, index=True))
    laboratorio_id: int = Field(foreign_key="lab_laboratorios.id", index=True)
    status: str = Field(default="agendado", max_length=20, index=True)
    agendado_por: str = Field(default="", max_length=120)
    origem_fila_id: int | None = Field(default=None, foreign_key="lab_fila_psf.id")
    status_auditoria: str = Field(
        default="pendente_conferencia", max_length=40, index=True
    )
    observacao_laboratorio: str = Field(default="", max_length=500)


class ItemSolic(SQLModel, table=True):
    __tablename__ = "lab_solic_itens"

    id: int | None = Field(default=None, primary_key=True)
    solicitacao_id: int = Field(foreign_key="lab_solic_mestre.id", index=True)
    sigtap_id: int = Field(foreign_key="sigtap_procedimentos.id", index=True)
    quantidade: int = Field(default=1)
    status_auditoria: str = Field(
        default="pendente_conferencia", max_length=40, index=True
    )
    observacao: str = Field(default="", max_length=500)
