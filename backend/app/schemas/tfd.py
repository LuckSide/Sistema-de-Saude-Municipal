from datetime import date

from pydantic import BaseModel, Field


# ---------- Pacientes ----------
class PacienteIn(BaseModel):
    nome: str = Field(min_length=2, max_length=150)
    cpf: str = Field(default="", max_length=14)
    cns: str = Field(default="", max_length=20)
    nascimento: date | None = None
    telefone: str = Field(default="", max_length=20)
    endereco: str = Field(default="", max_length=255)
    observacoes: str = Field(default="", max_length=500)


class PacienteOut(PacienteIn):
    id: int


# ---------- Veículos ----------
class VeiculoIn(BaseModel):
    placa: str = Field(min_length=7, max_length=10)
    modelo: str = Field(default="", max_length=80)
    capacidade: int = Field(default=4, ge=1, le=60)
    tipo: str = Field(default="carro", pattern="^(carro|van|micro|amb)$")
    ativo: bool = True


class VeiculoOut(VeiculoIn):
    id: int


# ---------- Destinos ----------
class DestinoIn(BaseModel):
    nome_destino: str = Field(min_length=2, max_length=120)
    hospital_referencia: str = Field(default="", max_length=150)
    procedimento_sigtap: str = Field(default="", max_length=20)
    ativo: bool = True


class DestinoOut(DestinoIn):
    id: int


# ---------- Viagens ----------
class ViagemIn(BaseModel):
    destino: str = Field(min_length=2, max_length=120)
    unidade: str = Field(default="", max_length=150)
    data_viagem: date
    hora_saida: str = Field(default="", max_length=5)
    veiculo_id: int | None = None
    motorista: str = Field(default="", max_length=120)
    status: str = Field(
        default="agendada",
        pattern="^(agendada|andamento|concluida|cancelada)$",
    )
    finalidade: str = Field(default="consulta", max_length=30)
    observacoes: str = Field(default="", max_length=500)


class ViagemOut(ViagemIn):
    id: int
    passageiros: int = 0
    veiculo_placa: str = ""


class ViagemPacienteIn(BaseModel):
    paciente_id: int
    acompanhante: str = Field(default="", max_length=150)
    presente: bool = True


class ViagemPacienteOut(ViagemPacienteIn):
    id: int
    viagem_id: int
    paciente_nome: str = ""


# ---------- Fila de exames ----------
class ExameIn(BaseModel):
    paciente_id: int
    exame: str = Field(min_length=2, max_length=120)
    especialidade: str = Field(default="", max_length=80)
    tipo_fila: str = Field(default="", max_length=80)
    codigo_procedimento: str = Field(default="", max_length=20)
    codigo_especialidade: str = Field(default="", max_length=10)
    nome_especialidade: str = Field(default="", max_length=120)
    prioridade: str = Field(default="rotina", pattern="^(rotina|prioritaria|urgente)$")
    status: str = Field(
        default="aguardando",
        pattern="^(aguardando|agendado|realizado|cancelado)$",
    )
    data_pedido: date
    data_agendada: date | None = None
    destino: str = Field(default="", max_length=120)
    observacoes: str = Field(default="", max_length=500)
    codigo_curto: str = Field(default="", max_length=12)  # novo modelo; legado ignora


class ExameLoteIn(BaseModel):
    """Atualização em lote: só campos enviados são aplicados."""

    ids: list[int] = Field(min_length=1, max_length=200)
    status: str = Field(default="", pattern="^(|aguardando|agendado|realizado|cancelado)$")
    data_agendada: date | None = None
    limpar_data_agendada: bool = False
    destino: str = Field(default="", max_length=120)
    prioridade: str = Field(default="", pattern="^(|rotina|prioritaria|urgente)$")
    observacoes: str = Field(default="", max_length=500)


class ExameLoteOut(BaseModel):
    atualizados: int
    nao_encontrados: list[int] = []


class ExameOut(ExameIn):
    id: int
    paciente_nome: str = ""
    public_token: str = ""
    posicao: int | None = None
    total_fila: int | None = None


class ExamePublicoOut(BaseModel):
    """Visão pública LGPD: sem CPF/CNS/nascimento/telefone/observações."""

    exame: str = ""
    especialidade: str = ""
    status: str = ""
    prioridade: str = ""
    data_pedido: date | None = None
    data_agendada: date | None = None
    destino: str = ""
    posicao: int | None = None
    total_fila: int | None = None
    paciente_iniciais: str = ""


# ---------- Catálogo dinâmico e-SUS ----------
class TipoFilaIn(BaseModel):
    codigo: str = Field(default="", max_length=10)
    nome: str = Field(min_length=2, max_length=80)
    ativo: bool = True


class TipoFilaOut(TipoFilaIn):
    id: int


class ProcedimentoIn(BaseModel):
    codigo: str = Field(min_length=1, max_length=20)
    nome: str = Field(min_length=2, max_length=150)
    tipo_fila: str = Field(default="", max_length=80)
    codigo_especialidade: str = Field(default="", max_length=10)
    nome_especialidade: str = Field(default="", max_length=120)
    codigo_curto: str = Field(default="", max_length=12)
    ativo: bool = True


class ProcedimentoOut(ProcedimentoIn):
    id: int


class EspecialidadeIn(BaseModel):
    codigo_cbo: str = Field(min_length=1, max_length=10)
    nome: str = Field(min_length=2, max_length=120)
    ativo: bool = True


class EspecialidadeOut(EspecialidadeIn):
    id: int


class OpcaoFiltro(BaseModel):
    value: str
    label: str
    total: int = 0


class FiltrosOpcoesOut(BaseModel):
    tipos: list[OpcaoFiltro] = []
    procedimentos: list[OpcaoFiltro] = []
    especialidades: list[OpcaoFiltro] = []


# ---------- Faturamento ----------
class FaturaIn(BaseModel):
    viagem_id: int | None = None
    paciente_id: int
    procedimento: str = Field(min_length=2, max_length=150)
    codigo_sigtap: str = Field(default="", max_length=20)
    competencia: str = Field(min_length=7, max_length=7, pattern=r"^\d{4}-\d{2}$")
    quantidade: int = Field(default=1, ge=1)
    valor: float = Field(default=0, ge=0)
    tipo: str = Field(default="BPA", pattern="^(BPA|APAC)$")
    status: str = Field(default="pendente", pattern="^(pendente|aprovado|rejeitado)$")
    observacoes: str = Field(default="", max_length=500)


class FaturaOut(FaturaIn):
    id: int
    paciente_nome: str = ""
    total: float = 0


class ResumoOut(BaseModel):
    viagens_mes: int
    passageiros_mes: int
    exames_aguardando: int
    exames_urgentes: int
    valor_competencia: float
    ocupacao_media: float
