from datetime import date

from pydantic import BaseModel, Field


# ---------- SIGTAP ----------
class SigtapIn(BaseModel):
    codigo: str = Field(min_length=10, max_length=10, pattern=r"^\d{10}$")
    descricao: str = Field(min_length=2, max_length=255)
    complexidade: str = Field(default="MC", pattern="^(AB|MC|AC)$")
    instrumento: str = Field(default="BPA-C", pattern="^(BPA-C|BPA-I)$")


class SigtapOut(SigtapIn):
    id: int


# ---------- Solicitações ----------
class SolicitacaoIn(BaseModel):
    paciente_id: int
    sigtap_id: int
    data_solicitacao: date
    laboratorio: str = Field(default="", max_length=120)
    status: str = Field(
        default="Solicitado",
        pattern="^(Solicitado|Agendado|Realizado|Cancelado)$",
    )
    faturado: bool = False
    competencia: str = Field(default="", max_length=7, pattern=r"^(\d{4}-(0[1-9]|1[0-2]))?$")
    observacoes: str = Field(default="", max_length=500)


class SolicitacaoOut(SolicitacaoIn):
    id: int
    paciente_nome: str = ""
    procedimento_codigo: str = ""
    procedimento_descricao: str = ""


# ---------- Faturamento BPA ----------
class FaturarIn(BaseModel):
    ids: list[int] = Field(min_length=1)


class LoteItemOut(BaseModel):
    codigo: str
    descricao: str = ""
    instrumento: str = ""
    qtd: int


class LoteOut(BaseModel):
    competencia: str
    total: int
    itens: list[LoteItemOut] = []


class ResumoLabOut(BaseModel):
    competencia: str
    solicitados: int
    agendados: int
    realizados: int
    cancelados: int
    prontos_faturar: int
    faturados: int
