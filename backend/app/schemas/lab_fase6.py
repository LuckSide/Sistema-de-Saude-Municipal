from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator


# ---------- Laboratórios ----------
class LaboratorioIn(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    ativo: bool = True


class LaboratorioOut(LaboratorioIn):
    id: int


# ---------- Vagas ----------
class VagaIn(BaseModel):
    laboratorio_id: int
    data: date
    vagas_totais: int = Field(ge=0, le=1000)


class VagaOut(VagaIn):
    id: int
    vagas_ocupadas: int
    vagas_livres: int = 0
    laboratorio_nome: str = ""


class VagaLoteMesIn(BaseModel):
    laboratorio_id: int
    ano: int = Field(ge=2000, le=2100)
    mes: int = Field(ge=1, le=12)
    vagas_diarias: int = Field(ge=0, le=1000)
    ignorar_fins_semana: bool = True


class VagaLoteMesOut(BaseModel):
    laboratorio_id: int
    laboratorio_nome: str = ""
    mes_ref: str = ""
    dias_alvo: int = 0
    criadas: int = 0
    atualizadas: int = 0
    ignoradas_fim_semana: int = 0
    mantidas_conflito: int = 0
    ignoradas_passado: int = 0


# ---------- Fila PSF ----------
class FilaPsfIn(BaseModel):
    paciente_id: int
    unidade_psf: str = Field(min_length=1, max_length=120)
    medico_solicitante: str = Field(min_length=1, max_length=120)
    data_solicitacao: date
    justificativa: str = Field(default="", max_length=500)
    observacoes: str = Field(default="", max_length=500)

    @field_validator("justificativa")
    @classmethod
    def _valida_justificativa(cls, v: str) -> str:
        s = (v or "").strip()
        if s and len(s) < 12:
            raise ValueError("A justificativa clínica deve ter pelo menos 12 caracteres.")
        return s



class FilaPsfOut(FilaPsfIn):
    id: int
    status: str = "na_fila"
    paciente_nome: str = ""


class FilaPsfStatusIn(BaseModel):
    status: str = Field(pattern="^(na_fila|agendado|cancelado)$")


class FilaPsfUpdateIn(BaseModel):
    unidade_psf: str | None = None
    medico_solicitante: str | None = None
    data_solicitacao: date | None = None
    justificativa: str | None = None
    observacoes: str | None = None

    @field_validator("justificativa")
    @classmethod
    def _valida_justificativa(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        if s and len(s) < 12:
            raise ValueError("A justificativa clínica deve ter pelo menos 12 caracteres.")
        return s


class FilaPsfAgendarLoteIn(BaseModel):
    fila_ids: list[int] = Field(min_length=1)
    laboratorio_id: int
    data_agendada: date
    hora_agendada: str = Field(default="07:00", max_length=10)
    sigtap_ids: list[int] = Field(default_factory=list)


# ---------- Solicitação mestre + itens ----------
class SolicItemIn(BaseModel):
    sigtap_id: int
    quantidade: int = Field(default=1, ge=1, le=99)


class SolicMestreIn(BaseModel):
    paciente_id: int
    data_agendada: date
    laboratorio_id: int
    hora_agendada: str = Field(default="07:00", max_length=10)
    # Legado: lista simples (compat). Novo: lista com quantidade.
    sigtap_ids: list[int] | None = Field(default=None, min_length=1)
    itens: list[SolicItemIn] | None = None
    origem_fila_id: int | None = None
    medico_id: int | None = None
    medico_solicitante: str = Field(default="", max_length=150)
    unidade_saude_id: int | None = None
    unidade_psf: str = Field(default="", max_length=150)
    justificativa: str = Field(default="", max_length=500)

    @field_validator("justificativa")
    @classmethod
    def _valida_justificativa(cls, v: str) -> str:
        s = (v or "").strip()
        if not s or len(s) < 12:
            raise ValueError("A justificativa clínica é obrigatória e deve ter pelo menos 12 caracteres.")
        return s

    def itens_normalizados(self) -> dict[int, int]:
        """Une sigtap_ids (qtd=1) + itens, somando quantidades por sigtap_id.

        Política: múltiplas linhas do mesmo sigtap são somadas em linha
        única (ex.: 2 linhas qtd 1+2 viram 1 linha qtd 3, máx 99).
        """
        total: dict[int, int] = {}
        for sid in self.sigtap_ids or []:
            total[sid] = total.get(sid, 0) + 1
        for it in self.itens or []:
            total[it.sigtap_id] = total.get(it.sigtap_id, 0) + it.quantidade
        if not total:
            raise ValueError("Informe itens ou sigtap_ids com ao menos 1 exame")
        for sid, qtd in total.items():
            if qtd < 1 or qtd > 99:
                raise ValueError(f"Quantidade inválida p/ sigtap {sid}: {qtd} (1..99)")
        return total


class ItemOut(BaseModel):
    id: int
    solicitacao_id: int
    sigtap_id: int
    quantidade: int = 1
    status_auditoria: str = "pendente_conferencia"
    observacao: str = ""
    procedimento_codigo: str = ""
    procedimento_descricao: str = ""


class SolicMestreOut(BaseModel):
    id: int
    paciente_id: int
    paciente_nome: str = ""
    paciente_cpf: str = ""
    paciente_cns: str = ""
    paciente_prontuario: str = ""
    paciente_nascimento: str = ""
    data_agendada: date
    hora_agendada: str = "07:00"
    laboratorio_id: int
    laboratorio_nome: str = ""
    status: str = "agendado"
    agendado_por: str = ""
    origem_fila_id: int | None = None
    status_auditoria: str = "pendente_conferencia"
    observacao_laboratorio: str = ""
    medico_id: int | None = None
    medico_solicitante: str = ""
    unidade_saude_id: int | None = None
    unidade_psf: str = ""
    justificativa: str = ""
    coletado_em: datetime | None = None
    coletado_por: str = ""
    preparo_instrucoes: list[str] = []
    itens: list[ItemOut] = []


# ---------- Comprovante de Agendamento ----------
class ComprovanteExameOut(BaseModel):
    id: int
    protocolo: str
    paciente_id: int
    paciente_nome: str
    paciente_cpf: str
    paciente_cns: str
    paciente_prontuario: str
    paciente_nascimento: str
    data_agendada: str
    hora_agendada: str
    laboratorio_id: int
    laboratorio_nome: str
    unidade_psf: str
    medico_solicitante: str
    justificativa: str
    status: str
    status_auditoria: str
    itens: list[ItemOut]
    jejum_horas: str
    preparo_instrucoes: list[str]
    orientacoes_gerais: list[str]
    emitido_em: str
    agendado_por: str


# ---------- Pedidos de Ajuste / Laboratório ----------
class PedidoAjusteIn(BaseModel):
    tipo_ajuste: str = Field(default="modificacao_exames", max_length=50)
    justificativa: str = Field(min_length=5, max_length=1000)
    itens_propostos: list[dict] = Field(default_factory=list)


class RespostaAjusteIn(BaseModel):
    aprovado: bool
    resposta: str = Field(default="", max_length=1000)


class PedidoAjusteOut(BaseModel):
    id: int
    solicitacao_id: int
    laboratorio_id: int
    laboratorio_nome: str = ""
    paciente_nome: str = ""
    tipo_ajuste: str
    justificativa: str
    itens_propostos: list[dict] = []
    status: str
    solicitado_por: str
    resposta_secretaria: str
    analisado_por: str
    created_at: datetime
    analisado_em: datetime | None = None


# ---------- Faturamento BPA Consolidado ----------
class BpaConsolidadoItemOut(BaseModel):
    codigo: str
    descricao: str
    instrumento: str = "BPA-C"
    quantidade: int
    valor_unitario: float = 0.0
    valor_total: float = 0.0
    total_pacientes: int


class BpaResumoOut(BaseModel):
    competencia: str
    total_procedimentos: int
    total_exames: int
    total_pacientes: int
    valor_total: float
    itens: list[BpaConsolidadoItemOut]


# ---------- Auditoria ----------
class AuditoriaItemIn(BaseModel):
    item_id: int
    status: str = Field(
        pattern="^(pendente_conferencia|aprovado|divergente|aguardando_autorizacao_sec)$"
    )
    obs: str = Field(default="", max_length=500)


class AuditoriaIn(BaseModel):
    status_auditoria: str = Field(
        pattern="^(pendente_conferencia|aprovado|divergente|aguardando_autorizacao_sec)$"
    )
    observacao: str = Field(default="", max_length=500)
    itens: list[AuditoriaItemIn] = []
