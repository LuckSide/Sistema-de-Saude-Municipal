from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

from app.services.validacoes import (
    valida_cnh,
    valida_cnh_validade,
    valida_cns,
    valida_cpf,
    valida_telefone,
)


# ---------- Pacientes ----------
class PacienteBase(BaseModel):
    codigo_prontuario: str = ""
    nome: str = Field(default="", max_length=150)
    nome_social: str = Field(default="", max_length=150)
    cpf: str = Field(default="")
    cns: str = Field(default="")
    nascimento: date | None = None
    sexo: str = Field(default="", max_length=20)
    nome_mae: str = Field(default="", max_length=150)
    telefone: str = Field(default="")
    endereco: str = Field(default="")
    endereco_numero: str = Field(default="")
    complemento: str = Field(default="")
    bairro: str = Field(default="")
    municipio: str = Field(default="Guapé", max_length=100)
    cep: str = Field(default="")
    ponto_referencia: str = Field(default="", max_length=150)
    unidade_saude_id: int | None = None
    unidade_cnes: str = Field(default="", max_length=20)
    unidade_nome: str = Field(default="", max_length=150)
    equipe_esf: str = Field(default="")
    equipe_ine: str = Field(default="", max_length=20)
    microarea: str = Field(default="", max_length=20)
    acs_nome: str = Field(default="")
    observacoes: str = Field(default="")


class PacienteIn(PacienteBase):
    nome: str = Field(min_length=2, max_length=150)
    cpf: str = Field(default="", max_length=14)
    cns: str = Field(default="", max_length=20)
    telefone: str = Field(default="", max_length=50)
    endereco: str = Field(default="", max_length=255)
    endereco_numero: str = Field(default="", max_length=20)
    complemento: str = Field(default="", max_length=100)
    bairro: str = Field(default="", max_length=100)
    cep: str = Field(default="", max_length=10)
    equipe_esf: str = Field(default="", max_length=80)
    acs_nome: str = Field(default="", max_length=150)
    observacoes: str = Field(default="", max_length=500)

    @field_validator("cpf")
    @classmethod
    def _cpf_valido(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            return ""
        ok, msg = valida_cpf(s)
        if not ok:
            raise ValueError(msg)
        return s

    @field_validator("cns")
    @classmethod
    def _cns_valido(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            return ""
        ok, msg = valida_cns(s)
        if not ok:
            raise ValueError(msg)
        return s

    @field_validator("telefone")
    @classmethod
    def _telefone_valido(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            return ""
        ok, msg = valida_telefone(s)
        if not ok:
            raise ValueError(msg)
        return s


class PacienteOut(PacienteBase):
    id: int
    sincronizado_em: datetime | None = None


class DemandaItemOut(BaseModel):
    """Item da demanda reprimida do paciente (fila ativa por especialidade e fila geral)."""

    id: int
    exame: str = ""
    especialidade: str = ""
    nome_especialidade: str = ""
    tipo_fila: str = ""
    prioridade: str = ""
    classificacao_risco: str = ""
    data_pedido: date | None = None
    data_inclusao: str = ""
    posicao_especialidade: int | None = None
    total_fila_especialidade: int | None = None
    posicao_fila_geral: int | None = None
    total_fila_geral: int | None = None
    status: str = ""
    status_rotulo: str = ""
    data_agendada: date | None = None
    hora_agendada: str = ""


class PacientePerfilOut(BaseModel):
    """Perfil do paciente: dados pessoais + territorialização APS + demanda cronológica."""

    paciente: PacienteOut
    unidade_saude_nome: str = ""
    demanda: list[DemandaItemOut] = []


# ---------- Veículos ----------
class VeiculoIn(BaseModel):
    placa: str = Field(min_length=7, max_length=10)
    modelo: str = Field(default="", max_length=80)
    capacidade: int = Field(default=4, ge=1, le=60)
    tipo: str = Field(default="carro", pattern="^(carro|van|micro|amb)$")
    status: str = Field(default="disponivel", pattern="^(disponivel|manutencao)$")
    ativo: bool = True


class VeiculoOut(VeiculoIn):
    id: int


# ---------- Destinos ----------
class DestinoIn(BaseModel):
    nome_destino: str = Field(min_length=2, max_length=120)
    hospital_referencia: str = Field(default="", max_length=150)
    procedimento_sigtap: str = Field(default="", max_length=20)
    codigo_desloc_pac: str = Field(default="", max_length=20)
    qtd_desloc_pac: int = Field(default=0, ge=0)
    codigo_desloc_acomp: str = Field(default="", max_length=20)
    qtd_desloc_acomp: int = Field(default=0, ge=0)
    ativo: bool = True


class DestinoOut(DestinoIn):
    id: int


# ---------- Motoristas ----------
class MotoristaBase(BaseModel):
    model_config = {"from_attributes": True}

    nome: str = Field(min_length=2, max_length=120)
    cpf: str = Field(default="", max_length=14)
    cnh_numero: str = Field(default="", max_length=20)
    cnh_categoria: str = Field(default="", max_length=5)
    cnh_validade: date | None = None
    telefone: str = Field(default="", max_length=20)
    ativo: bool = True


class MotoristaIn(MotoristaBase):
    cnh_categoria: str = Field(default="", max_length=5, pattern="^([A-E]{1,2})?$")

    @field_validator("cpf")
    @classmethod
    def _cpf_valido(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            return ""
        ok, msg = valida_cpf(s)
        if not ok:
            raise ValueError(msg)
        return s

    @field_validator("cnh_numero")
    @classmethod
    def _cnh_valida(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            return ""
        ok, msg = valida_cnh(s)
        if not ok:
            raise ValueError(msg)
        return s

    @field_validator("cnh_validade")
    @classmethod
    def _validade_ok(cls, v: date | None) -> date | None:
        if v is None:
            return None
        ok, msg = valida_cnh_validade(v)
        if not ok:
            raise ValueError(msg)
        return v

    @field_validator("telefone")
    @classmethod
    def _tel_valido(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            return ""
        ok, msg = valida_telefone(s)
        if not ok:
            raise ValueError(msg)
        return s


class MotoristaOut(MotoristaBase):
    id: int


# ---------- Viagens ----------
class ViagemIn(BaseModel):
    destino: str = Field(min_length=2, max_length=120)
    unidade: str = Field(default="", max_length=150)
    data_viagem: date
    hora_saida: str = Field(default="", max_length=5)
    veiculo_id: int | None = None
    motorista: str = Field(default="", max_length=120)
    motorista_id: int | None = None
    departamento: str = Field(default="", max_length=120)
    data_retorno: date | None = None
    hora_retorno: str = Field(default="", max_length=5)
    km_inicial: int = Field(default=0, ge=0)
    km_final: int = Field(default=0, ge=0)
    adiantamento: float = Field(default=0, ge=0)
    status: str = Field(
        default="agendada",
        pattern="^(agendada|andamento|concluida|cancelada)$",
    )
    finalidade: str = Field(default="consulta", max_length=30)
    ponto_saida: str = Field(default="Prefeitura Municipal de Guapé", max_length=150)
    observacoes: str = Field(default="", max_length=500)


class ViagemOut(ViagemIn):
    id: int
    passageiros: int = 0
    veiculo_placa: str = ""
    veiculo_modelo: str = ""


class ViagemPacienteIn(BaseModel):
    paciente_id: int
    acompanhante: str = Field(default="", max_length=150)
    acompanhante_id: int | None = None
    acompanhante_cpf: str = Field(default="", max_length=14)
    presente: bool = True
    viagem_fila_id: int | None = None
    tratamento: str = Field(default="", max_length=150)
    unidade: str = Field(default="", max_length=150)
    hora_consulta: str = Field(default="", max_length=5)
    observacoes: str = Field(default="", max_length=500)
    status_confirmacao: str = Field(default="pendente", max_length=30)


class ViagemPacienteOut(ViagemPacienteIn):
    id: int
    viagem_id: int
    paciente_nome: str = ""
    paciente_telefone: str = ""
    observacoes: str = ""
    prioridade: str = ""
    status_confirmacao: str = "pendente"
    confirmado_em: datetime | None = None
    token_confirmacao: str = ""
    lembrete_enviado: bool = False
    lembrete_enviado_em: datetime | None = None
    link_confirmacao: str = ""


class ViagemConfirmacaoPublicaOut(BaseModel):
    token: str
    paciente_nome: str
    paciente_iniciais: str
    data_viagem: str
    hora_saida: str
    ponto_saida: str
    destino: str
    unidade: str
    veiculo: str
    modelo_veiculo: str
    placa_veiculo: str
    motorista: str
    tratamento: str
    acompanhante: str
    status_confirmacao: str
    confirmado_em: datetime | None = None
    observacoes: str = ""


class ViagemConfirmarIn(BaseModel):
    acao: str = Field(pattern="^(confirmar|desistir|cancelar)$")
    motivo: str = Field(default="", max_length=500)


class ViagemStatusConfirmacaoIn(BaseModel):
    status_confirmacao: str = Field(pattern="^(pendente|confirmado|desistiu|nao_compareceu)$")
    observacoes: str = Field(default="", max_length=500)


# ---------- Fila de espera para viagem ----------
class ViagemFilaIn(BaseModel):
    paciente_id: int
    destino: str = Field(min_length=2, max_length=120)
    unidade: str = Field(default="", max_length=150)
    tratamento: str = Field(default="", max_length=150)
    data_consulta: date | None = None
    hora_consulta: str = Field(default="", max_length=5)
    acompanhante: bool = False
    acompanhante_id: int | None = None
    acompanhante_nome: str = Field(default="", max_length=150)
    acompanhante_cpf: str = Field(default="", max_length=14)
    prioridade: str = Field(default="rotina", pattern="^(rotina|urgente)$")
    status: str = Field(
        default="aguardando",
        pattern="^(aguardando|alocado|cancelado)$",
    )
    exame_fila_id: int | None = None
    observacoes: str = Field(default="", max_length=500)


class ViagemFilaOut(ViagemFilaIn):
    id: int
    paciente_nome: str = ""
    paciente_cpf: str = ""
    paciente_nascimento: date | None = None


# ---------- Fila de exames / procedimentos ----------
class ExameBase(BaseModel):
    paciente_id: int
    exame: str = Field(default="", max_length=120)
    especialidade: str = Field(default="", max_length=80)
    tipo_fila: str = Field(default="ELETIVO", max_length=80)
    codigo_procedimento: str = Field(default="", max_length=20)
    codigo_especialidade: str = Field(default="", max_length=10)
    nome_especialidade: str = Field(default="", max_length=120)
    cid_codigo: str = Field(default="", max_length=10)
    cid_descricao: str = Field(default="", max_length=255)
    prioridade: str = Field(default="rotina", max_length=20)
    justificativa_prioridade: str = Field(default="", max_length=500)
    status: str = Field(default="aguardando", max_length=20)
    data_pedido: date
    data_agendada: date | None = None
    hora_agendada: str = Field(default="", max_length=5)
    medico_id: int | None = None
    unidade_saude_id: int | None = None
    destino: str = Field(default="", max_length=120)
    observacoes: str = Field(default="", max_length=500)
    instrucoes_transporte: str = Field(default="", max_length=500)
    justificativa: str = Field(default="", max_length=500)
    resultado: str = Field(default="", max_length=2000)
    codigo_curto: str = Field(default="", max_length=20)  # ID único e imutável (ex: EX-000123)
    numero_pedido: str = Field(default="", max_length=30)  # identificação operacional


class ExameIn(ExameBase):
    exame: str = Field(min_length=2, max_length=120)
    prioridade: str = Field(default="rotina", pattern="^(rotina|urgente)$")
    status: str = Field(
        default="aguardando",
        pattern="^(aguardando|agendado|recepcionado|realizado|faltou|cancelado)$",
    )

    @field_validator("justificativa")
    @classmethod
    def _valida_justificativa(cls, v: str) -> str:
        return (v or "").strip()


class ExameLoteIn(BaseModel):
    """Atualização em lote: só campos enviados são aplicados."""

    ids: list[int] = Field(min_length=1, max_length=200)
    status: str = Field(default="", pattern="^(|aguardando|agendado|recepcionado|realizado|faltou|cancelado)$")
    data_agendada: date | None = None
    hora_agendada: str = Field(default="", max_length=5)
    medico_id: int | None = None
    unidade_saude_id: int | None = None
    limpar_data_agendada: bool = False
    destino: str = Field(default="", max_length=120)
    prioridade: str = Field(default="", pattern="^(|rotina|urgente)$")
    justificativa_prioridade: str = Field(default="", max_length=500)
    observacoes: str = Field(default="", max_length=500)
    enviar_whatsapp: bool = True
    instrucoes_transporte: str = Field(default="", max_length=500)


class ExameLoteOut(BaseModel):
    atualizados: int
    nao_encontrados: list[int] = []


class ExameOut(ExameBase):
    id: int
    paciente_nome: str = ""
    paciente_cpf: str = ""
    public_token: str = ""
    posicao: int | None = None
    total_fila: int | None = None
    grupo_fila: str = ""
    # Duplo cálculo de posições independentes
    posicao_tipo: int | None = None
    total_tipo: int | None = None
    grupo_tipo: str = ""
    posicao_especialidade: int | None = None
    total_especialidade: int | None = None
    grupo_especialidade: str = ""
    # Dados cadastrais e endereço do paciente
    paciente_endereco: str = ""
    paciente_numero: str = ""
    paciente_complemento: str = ""
    paciente_bairro: str = ""
    paciente_municipio: str = ""
    paciente_telefone: str = ""
    paciente_cns: str = ""
    paciente_nascimento: date | None = None
    # Snapshot do agendamento (resolvido no momento da marcação)
    medico_nome: str = ""
    medico_cpf: str = ""
    medico_cbo_codigo: str = ""
    medico_cbo_descricao: str = ""
    unidade_nome: str = ""
    unidade_cnes: str = ""
    unidade_endereco: str = ""
    unidade_numero: str = ""
    unidade_bairro: str = ""
    unidade_municipio: str = ""
    unidade_cep: str = ""


class PrioridadeIn(BaseModel):
    """Alteração de prioridade pelo médico envolvido (justificativa obrigatória)."""

    prioridade: str = Field(pattern="^(rotina|urgente)$")
    justificativa: str = Field(min_length=1, max_length=500)


class ExamePublicoOut(BaseModel):
    """Visão pública LGPD: sem CPF/CNS/nascimento/telefone/observações/total.

    O QR abre só posição individual; total da fila não sai no payload.
    """

    exame: str = ""
    especialidade: str = ""
    status: str = ""
    prioridade: str = ""
    data_pedido: date | None = None
    data_agendada: date | None = None
    destino: str = ""
    posicao: int | None = None
    total_fila: int | None = None
    grupo_fila: str = ""
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
    codigo_cbo: str = Field(default="", max_length=10)
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


class ValidarCboIn(BaseModel):
    codigo_procedimento: str
    medico_id: int | None = None
    medico_nome: str | None = None
    cbo: str | None = None
    tipo_fila: str | None = None


class CboAutorizadoItem(BaseModel):
    cbo: str
    descricao: str = ""


class ValidarCboOut(BaseModel):
    codigo_procedimento: str
    nome_procedimento: str = ""
    hierarquia: dict = {}
    exige_cbo_estrito: bool = False
    cbo_profissional: str = ""
    compativel: bool = True
    motivo: str = ""
    alerta: str | None = None
    permite_responsavel_tecnico: bool = True
    cbos_autorizados: list[CboAutorizadoItem] = []

