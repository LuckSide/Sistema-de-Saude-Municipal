from datetime import date, datetime
import re
from pydantic import BaseModel, ConfigDict, Field, field_validator


def _limpar_digitos(v: str) -> str:
    return re.sub(r"\D", "", v or "")


class ProcedimentoSecundarioIn(BaseModel):
    codigo: str = Field(description="Código SIGTAP de 10 dígitos")
    descricao: str = Field(default="", max_length=255)
    quantidade_mes_1: int = Field(default=1, ge=0)
    quantidade_mes_2: int = Field(default=0, ge=0)
    quantidade_mes_3: int = Field(default=0, ge=0)
    valor_unitario: float = Field(default=0.0, ge=0.0)

    @field_validator("codigo")
    @classmethod
    def validar_codigo_sigtap(cls, v: str) -> str:
        digitos = _limpar_digitos(v)
        if len(digitos) != 10:
            raise ValueError(f"Código SIGTAP deve conter exatamente 10 dígitos (recebido: {v})")
        return digitos


class ProcedimentoSecundarioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    solicitacao_apac_id: int
    codigo: str
    descricao: str
    quantidade_mes_1: int
    quantidade_mes_2: int
    quantidade_mes_3: int
    quantidade_total: int
    valor_unitario: float
    valor_total: float


class AnexoLaudoIn(BaseModel):
    tipo_documento: str = Field(default="laudo_exame", max_length=50)
    titulo: str = Field(min_length=2, max_length=150)
    nome_arquivo: str = Field(min_length=1, max_length=255)
    conteudo_base64: str = Field(min_length=1)


class AnexoLaudoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    solicitacao_apac_id: int
    tipo_documento: str
    titulo: str
    nome_arquivo: str
    tamanho_bytes: int
    created_at: datetime


class SolicitacaoAPACCreate(BaseModel):
    paciente_id: int
    carater_atendimento: str = Field(default="01", max_length=2)  # 01 Eletivo, 02 Urgência
    estabelecimento_solicitante_id: int | None = None
    estabelecimento_executante_id: int | None = None
    medico_solicitante_id: int

    procedimento_principal_codigo: str = Field(description="Código SIGTAP de 10 dígitos")
    quantidade_mes_1: int = Field(default=1, ge=0)
    quantidade_mes_2: int = Field(default=0, ge=0)
    quantidade_mes_3: int = Field(default=0, ge=0)

    cid_principal_codigo: str = Field(min_length=3, max_length=10)
    cid_secundario_codigo: str = Field(default="", max_length=10)
    cid_causas_associadas: str = Field(default="", max_length=10)

    anamnese_diagnostico: str = Field(default="", max_length=3000)
    justificativa_solicitacao: str = Field(min_length=12, max_length=3000)
    estadiamento_grau: str = Field(default="", max_length=50)
    indicacao_clinica: str = Field(default="", max_length=500)
    data_solicitacao: date | None = None

    procedimentos_secundarios: list[ProcedimentoSecundarioIn] = Field(default_factory=list)

    @field_validator("procedimento_principal_codigo")
    @classmethod
    def validar_procedimento_codigo(cls, v: str) -> str:
        digitos = _limpar_digitos(v)
        if len(digitos) != 10:
            raise ValueError(f"Código SIGTAP principal deve conter exatamente 10 dígitos (recebido: {v})")
        return digitos

    @field_validator("justificativa_solicitacao")
    @classmethod
    def validar_justificativa(cls, v: str) -> str:
        v_clean = (v or "").strip()
        if len(v_clean) < 12:
            raise ValueError("Justificativa clínica deve conter no mínimo 12 caracteres.")
        return v_clean


class SolicitacaoAPACUpdate(BaseModel):
    carater_atendimento: str | None = None
    estabelecimento_solicitante_id: int | None = None
    estabelecimento_executante_id: int | None = None
    medico_solicitante_id: int | None = None

    procedimento_principal_codigo: str | None = None
    quantidade_mes_1: int | None = Field(default=None, ge=0)
    quantidade_mes_2: int | None = Field(default=None, ge=0)
    quantidade_mes_3: int | None = Field(default=None, ge=0)

    cid_principal_codigo: str | None = None
    cid_secundario_codigo: str | None = None
    cid_causas_associadas: str | None = None

    anamnese_diagnostico: str | None = None
    justificativa_solicitacao: str | None = None
    estadiamento_grau: str | None = None
    indicacao_clinica: str | None = None

    procedimentos_secundarios: list[ProcedimentoSecundarioIn] | None = None

    @field_validator("procedimento_principal_codigo")
    @classmethod
    def validar_procedimento_codigo(cls, v: str | None) -> str | None:
        if v is None:
            return None
        digitos = _limpar_digitos(v)
        if len(digitos) != 10:
            raise ValueError(f"Código SIGTAP principal deve conter exatamente 10 dígitos (recebido: {v})")
        return digitos

    @field_validator("justificativa_solicitacao")
    @classmethod
    def validar_justificativa(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v_clean = v.strip()
        if len(v_clean) < 12:
            raise ValueError("Justificativa clínica deve conter no mínimo 12 caracteres.")
        return v_clean


class SolicitacaoAPACItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    numero_apac: str
    tipo_apac: str
    apac_anterior_id: int | None
    numero_apac_anterior: str
    status: str
    carater_atendimento: str

    paciente_id: int
    paciente_nome: str
    paciente_cpf: str
    paciente_cns: str

    medico_solicitante_nome: str
    medico_autorizador_nome: str

    procedimento_principal_codigo: str
    procedimento_principal_nome: str

    cid_principal_codigo: str
    cid_principal_nome: str

    quantidade_mes_1: int
    quantidade_mes_2: int
    quantidade_mes_3: int
    quantidade_total: int
    valor_unitario: float
    valor_total: float

    data_solicitacao: date
    data_autorizacao: date | None
    data_inicio_validade: date | None
    data_fim_validade: date | None
    competencia: str

    dias_restantes: int = 0
    esta_vencida: bool = False
    proxima_do_vencimento: bool = False

    created_at: datetime
    updated_at: datetime


class SolicitacaoAPACDetailOut(SolicitacaoAPACItemOut):
    paciente_nascimento: date | None
    paciente_sexo: str
    paciente_nome_mae: str
    paciente_telefone: str
    paciente_endereco: str
    paciente_bairro: str
    paciente_municipio: str
    paciente_cep: str

    estabelecimento_solicitante_id: int | None
    estabelecimento_solicitante_cnes: str
    estabelecimento_solicitante_nome: str
    estabelecimento_executante_id: int | None
    estabelecimento_executante_cnes: str
    estabelecimento_executante_nome: str

    medico_solicitante_id: int
    medico_solicitante_cpf: str
    medico_solicitante_cns: str
    medico_solicitante_crm: str
    medico_solicitante_cbo: str

    medico_autorizador_id: int | None
    medico_autorizador_cpf: str
    medico_autorizador_cns: str
    medico_autorizador_crm: str
    medico_autorizador_cbo: str
    autorizador_usuario_id: int | None

    cid_secundario_codigo: str
    cid_secundario_nome: str
    cid_causas_associadas: str
    anamnese_diagnostico: str
    justificativa_solicitacao: str
    estadiamento_grau: str
    indicacao_clinica: str

    parecer_regulador: str
    motivo_devolucao: str
    motivo_indeferimento: str
    historico_tramitacao: str

    procedimentos_secundarios: list[ProcedimentoSecundarioOut] = Field(default_factory=list)
    anexos: list[AnexoLaudoOut] = Field(default_factory=list)


class DuplicarContinuidadeIn(BaseModel):
    justificativa_solicitacao: str = Field(min_length=12, max_length=3000)
    anamnese_diagnostico: str | None = None

    @field_validator("justificativa_solicitacao")
    @classmethod
    def validar_justificativa(cls, v: str) -> str:
        v_clean = (v or "").strip()
        if len(v_clean) < 12:
            raise ValueError("Justificativa de continuidade deve conter no mínimo 12 caracteres.")
        return v_clean


class AutorizacaoIn(BaseModel):
    medico_autorizador_id: int
    data_autorizacao: date | None = None
    validade_meses: int | None = Field(default=None, ge=1, le=12)
    parecer: str = Field(default="", max_length=2000)


class DevolucaoIn(BaseModel):
    motivo: str = Field(min_length=3, max_length=1000)


class IndeferimentoIn(BaseModel):
    motivo: str = Field(min_length=3, max_length=1000)


class FaixaNumeracaoCreate(BaseModel):
    ano: int = Field(ge=2020, le=2050)
    uf: str = Field(default="MG", min_length=2, max_length=2)
    serie: str = Field(default="01", min_length=1, max_length=10)
    numero_inicial: int = Field(gt=0)
    numero_final: int = Field(gt=0)
    proximo_numero: int | None = None
    tipo_procedimento: str = Field(default="TODOS", max_length=50)
    ativo: bool = True
    descricao: str = Field(default="", max_length=150)

    @field_validator("numero_final")
    @classmethod
    def validar_intervalo(cls, v: int, info) -> int:
        num_ini = info.data.get("numero_inicial")
        if num_ini is not None and v < num_ini:
            raise ValueError("numero_final deve ser maior ou igual ao numero_inicial")
        return v


class FaixaNumeracaoUpdate(BaseModel):
    ano: int | None = None
    uf: str | None = None
    serie: str | None = None
    numero_inicial: int | None = None
    numero_final: int | None = None
    proximo_numero: int | None = None
    tipo_procedimento: str | None = None
    ativo: bool | None = None
    descricao: str | None = None


class FaixaNumeracaoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ano: int
    uf: str
    serie: str
    numero_inicial: int
    numero_final: int
    proximo_numero: int
    tipo_procedimento: str
    ativo: bool
    descricao: str
    total_disponivel: int = 0
    total_utilizado: int = 0
    created_at: datetime


class GerarRemessaIn(BaseModel):
    competencia: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    cnes_executante: str | None = None


class LoteFaturamentoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    competencia: str
    cnes_executante: str
    tipo_remessa: str
    total_apacs: int
    total_procedimentos: int
    valor_total: float
    status: str
    arquivo_nome: str
    criado_em: datetime
    criado_por: str


class ResumoFaturamentoOut(BaseModel):
    competencia: str
    total_apacs_autorizadas: int = 0
    total_procedimentos: int = 0
    valor_total_aprovado: float = 0.0
    total_pendentes: int = 0
    total_vencidas: int = 0
    lotes_gerados: int = 0
