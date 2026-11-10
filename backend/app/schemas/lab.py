from datetime import date

from pydantic import BaseModel, Field


# ---------- SIGTAP ----------
class SigtapIn(BaseModel):
    codigo: str = Field(min_length=10, max_length=10, pattern=r"^\d{10}$")
    descricao: str = Field(min_length=2, max_length=255)
    complexidade: str = Field(default="MC", pattern="^(NA|AB|MC|AC)$")
    instrumento: str = Field(default="BPA-C", pattern="^(BPA-C|BPA-I|BPA-F|AIH|APAC|RAAS)$")


class SigtapOut(SigtapIn):
    id: int
    sexo: str = ""
    idade_min: int = 0
    idade_max: int = 0
    qtd_maxima: int = 0
    pontos: int = 0
    valor_sa: float = 0
    valor_sp: float = 0
    valor_sh: float = 0
    competencia: str = ""


class SigtapVersaoOut(BaseModel):
    id: int
    competencia: str = ""
    origem: str = ""
    arquivo: str = ""
    total_proc: int = 0
    inseridos: int = 0
    atualizados: int = 0
    cbo_total: int = 0
    cid_total: int = 0
    ignorados: int = 0
    usuario: str = ""
    criado_em: str = ""


class SigtapImportOut(BaseModel):
    simulacao: bool = True
    arquivo: str = ""
    competencia: str = ""
    processados: int = 0
    inseridos: int = 0
    atualizados: int = 0
    ignorados: int = 0
    cbo_total: int = 0
    cid_total: int = 0
    erros: list[dict] = []


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
