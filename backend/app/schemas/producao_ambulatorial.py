from datetime import date, datetime
from pydantic import BaseModel, ConfigDict, Field


class ProducaoAmbulatorialBase(BaseModel):
    unidade_saude_id: int = Field(..., description="ID da Unidade de Saúde")
    medico_id: int = Field(..., description="ID do Profissional/Médico executante")
    equipe_id: int | None = Field(default=None, description="ID da Equipe de Saúde (INE opcional)")
    procedimento_id: int | None = Field(default=None, description="ID do Procedimento no SIGTAP")
    procedimento_codigo: str = Field(..., max_length=10, description="Código de 10 dígitos do SIGTAP")
    procedimento_nome: str | None = Field(default=None, max_length=250, description="Nome do Procedimento")
    cbo_codigo: str | None = Field(default=None, max_length=10, description="CBO do profissional executante")
    competencia: str | None = Field(default=None, max_length=6, description="Competência no formato AAAAMM")
    data_atendimento: date = Field(..., description="Data da realização do atendimento")
    instrumento_registro: str = Field(default="BPA-C", max_length=10, description="BPA-C ou BPA-I")
    quantidade: int = Field(default=1, ge=1, description="Quantidade realizada")
    valor_unitario: float | None = Field(default=None, ge=0.0, description="Valor unitário em R$")
    valor_total: float | None = Field(default=None, ge=0.0, description="Valor total em R$")

    # Campos específicos para BPA-I (Individualizado)
    paciente_id: int | None = Field(default=None, description="ID do Paciente")
    paciente_nome: str = Field(default="", max_length=150, description="Nome do Paciente")
    paciente_cns: str = Field(default="", max_length=15, description="CNS do Paciente (15 dígitos)")
    paciente_sexo: str = Field(default="", max_length=1, description="Sexo do Paciente (M/F)")
    paciente_data_nascimento: date | None = Field(default=None, description="Data de nascimento do paciente")
    paciente_municipio_ibge: str = Field(default="312810", max_length=10, description="IBGE do município do paciente")
    cid10: str = Field(default="", max_length=10, description="CID-10 diagnóstico")
    numero_autorizacao: str = Field(default="", max_length=20, description="Número de autorização se houver")
    servico_codigo: str = Field(default="", max_length=10, description="Código do Serviço no CNES")
    classificacao_codigo: str = Field(default="", max_length=10, description="Código da Classificação no CNES")

    origem: str = Field(default="DIGITACAO_PROFISSIONAL", max_length=50)
    status: str = Field(default="VALIDADO", max_length=20)


class ProducaoAmbulatorialCreate(ProducaoAmbulatorialBase):
    pass


class ProducaoAmbulatorialUpdate(BaseModel):
    unidade_saude_id: int | None = None
    medico_id: int | None = None
    equipe_id: int | None = None
    procedimento_id: int | None = None
    procedimento_codigo: str | None = None
    procedimento_nome: str | None = None
    cbo_codigo: str | None = None
    competencia: str | None = None
    data_atendimento: date | None = None
    instrumento_registro: str | None = None
    quantidade: int | None = Field(default=None, ge=1)
    valor_unitario: float | None = None
    valor_total: float | None = None
    paciente_id: int | None = None
    paciente_nome: str | None = None
    paciente_cns: str | None = None
    paciente_sexo: str | None = None
    paciente_data_nascimento: date | None = None
    paciente_municipio_ibge: str | None = None
    cid10: str | None = None
    numero_autorizacao: str | None = None
    servico_codigo: str | None = None
    classificacao_codigo: str | None = None
    origem: str | None = None
    status: str | None = None


class ProducaoAmbulatorialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    unidade_saude_id: int
    unidade_saude_nome: str | None = None
    medico_id: int
    medico_nome: str | None = None
    equipe_id: int | None = None
    equipe_nome: str | None = None
    equipe_ine: str | None = None
    procedimento_id: int
    procedimento_codigo: str
    procedimento_nome: str
    cbo_codigo: str
    competencia: str
    data_atendimento: date
    instrumento_registro: str
    quantidade: int
    valor_unitario: float
    valor_total: float
    paciente_id: int | None = None
    paciente_nome: str = ""
    paciente_cns: str = ""
    paciente_sexo: str = ""
    paciente_data_nascimento: date | None = None
    paciente_idade: int | None = None
    paciente_municipio_ibge: str = "312810"
    cid10: str = ""
    numero_autorizacao: str = ""
    servico_codigo: str = ""
    classificacao_codigo: str = ""
    origem: str = "DIGITACAO_PROFISSIONAL"
    status: str = "VALIDADO"
    usuario_id: int | None = None
    criado_em: datetime
    atualizado_em: datetime


class ResumoTopProcedimento(BaseModel):
    procedimento_codigo: str
    procedimento_nome: str
    instrumento: str
    quantidade: int
    valor_total: float


class ResumoCompetenciaOut(BaseModel):
    competencia: str
    total_procedimentos: int
    total_lancamentos: int
    valor_total: float
    total_bpac: int
    valor_bpac: float
    total_bpai: int
    valor_bpai: float
    total_profissionais: int
    total_unidades: int
    top_procedimentos: list[ResumoTopProcedimento] = []


class ProcedimentoSigtapItem(BaseModel):
    id: int
    codigo: str
    descricao: str
    complexidade: str
    instrumento: str
    sexo: str
    idade_min: int
    idade_max: int
    qtd_maxima: int
    pontos: int
    valor_sa: float
    valor_sp: float
    valor_total: float
