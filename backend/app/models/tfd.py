from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, Numeric
from sqlmodel import Field, SQLModel


class Paciente(SQLModel, table=True):
    __tablename__ = "tfd_pacientes"

    id: int | None = Field(default=None, primary_key=True)
    nome: str = Field(max_length=150, index=True)
    cpf: str = Field(default="", max_length=14, index=True)
    cns: str = Field(default="", max_length=20, index=True)
    nascimento: date | None = Field(default=None, sa_column=Column(Date))
    telefone: str = Field(default="", max_length=20)
    endereco: str = Field(default="", max_length=255)
    endereco_numero: str = Field(default="", max_length=20)
    complemento: str = Field(default="", max_length=100)
    bairro: str = Field(default="", max_length=100)
    cep: str = Field(default="", max_length=10)
    unidade_saude_id: int | None = Field(default=None, index=True)
    equipe_esf: str = Field(default="", max_length=80)
    acs_nome: str = Field(default="", max_length=150)
    observacoes: str = Field(default="", max_length=500)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class Veiculo(SQLModel, table=True):
    __tablename__ = "tfd_veiculos"

    id: int | None = Field(default=None, primary_key=True)
    placa: str = Field(max_length=10, index=True, unique=True)
    modelo: str = Field(default="", max_length=80)
    capacidade: int = Field(default=4)
    tipo: str = Field(default="carro", max_length=20)  # carro | van | micro | amb
    status: str = Field(default="disponivel", max_length=20)  # disponivel|manutencao
    ativo: bool = Field(default=True)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class Destino(SQLModel, table=True):
    __tablename__ = "tfd_destinos"

    id: int | None = Field(default=None, primary_key=True)
    nome_destino: str = Field(max_length=120, index=True, unique=True)
    hospital_referencia: str = Field(default="", max_length=150)
    procedimento_sigtap: str = Field(default="", max_length=20)
    codigo_desloc_pac: str = Field(default="", max_length=20)
    qtd_desloc_pac: int = Field(default=0)
    codigo_desloc_acomp: str = Field(default="", max_length=20)
    qtd_desloc_acomp: int = Field(default=0)
    ativo: bool = Field(default=True, index=True)


class Motorista(SQLModel, table=True):
    """Cadastro de motoristas da frota (vínculo opcional por viagem)."""

    __tablename__ = "tfd_motoristas"

    id: int | None = Field(default=None, primary_key=True)
    nome: str = Field(max_length=120, index=True)
    cpf: str = Field(default="", max_length=14, index=True)
    cnh_numero: str = Field(default="", max_length=20)
    cnh_categoria: str = Field(default="", max_length=5)
    cnh_validade: date | None = Field(default=None, sa_column=Column(Date))
    telefone: str = Field(default="", max_length=20)
    ativo: bool = Field(default=True, index=True)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class Viagem(SQLModel, table=True):
    __tablename__ = "tfd_viagens"

    id: int | None = Field(default=None, primary_key=True)
    destino: str = Field(max_length=120, index=True)
    unidade: str = Field(default="", max_length=150)  # hospital/clinica destino
    data_viagem: date = Field(sa_column=Column(Date, index=True))
    hora_saida: str = Field(default="", max_length=5)  # HH:MM
    veiculo_id: int | None = Field(default=None, foreign_key="tfd_veiculos.id")
    motorista: str = Field(default="", max_length=120)
    motorista_id: int | None = Field(default=None, foreign_key="tfd_motoristas.id")
    departamento: str = Field(default="", max_length=120)
    data_retorno: date | None = Field(default=None, sa_column=Column(Date))
    hora_retorno: str = Field(default="", max_length=5)
    km_inicial: int = Field(default=0)
    km_final: int = Field(default=0)
    adiantamento: float = Field(default=0)
    status: str = Field(
        default="agendada", max_length=20, index=True
    )  # agendada|andamento|concluida|cancelada
    finalidade: str = Field(default="consulta", max_length=30)  # consulta|exame|cirurgia|retorno
    observacoes: str = Field(default="", max_length=500)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class ViagemPaciente(SQLModel, table=True):
    __tablename__ = "tfd_viagem_pacientes"

    id: int | None = Field(default=None, primary_key=True)
    viagem_id: int = Field(foreign_key="tfd_viagens.id", index=True)
    paciente_id: int = Field(foreign_key="tfd_pacientes.id", index=True)
    acompanhante: str = Field(default="", max_length=150)
    acompanhante_id: int | None = Field(default=None, foreign_key="tfd_pacientes.id")
    acompanhante_cpf: str = Field(default="", max_length=14)
    presente: bool = Field(default=True)
    viagem_fila_id: int | None = Field(default=None, index=True)
    tratamento: str = Field(default="", max_length=150)
    unidade: str = Field(default="", max_length=150)
    hora_consulta: str = Field(default="", max_length=5)
    observacoes: str = Field(default="", max_length=500)


class ViagemFila(SQLModel, table=True):
    """Fila de espera de pacientes para viagem (transporte a outro município)."""

    __tablename__ = "tfd_viagem_fila"

    id: int | None = Field(default=None, primary_key=True)
    paciente_id: int = Field(foreign_key="tfd_pacientes.id", index=True)
    destino: str = Field(max_length=120, index=True)  # cidade de destino
    unidade: str = Field(default="", max_length=150)  # hospital/unidade de atendimento
    tratamento: str = Field(default="", max_length=150)  # exame/consulta/tratamento
    data_consulta: date | None = Field(default=None, sa_column=Column(Date))
    hora_consulta: str = Field(default="", max_length=5)
    acompanhante: bool = Field(default=False)
    acompanhante_id: int | None = Field(default=None, foreign_key="tfd_pacientes.id")
    acompanhante_nome: str = Field(default="", max_length=150)
    acompanhante_cpf: str = Field(default="", max_length=14)
    prioridade: str = Field(default="rotina", max_length=20)  # rotina|urgente
    status: str = Field(default="aguardando", max_length=20, index=True)  # aguardando|alocado|cancelado
    exame_fila_id: int | None = Field(default=None, index=True)
    observacoes: str = Field(default="", max_length=500)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )
    viagem_fila_id: int | None = Field(default=None, index=True)
    tratamento: str = Field(default="", max_length=150)
    unidade: str = Field(default="", max_length=150)
    hora_consulta: str = Field(default="", max_length=5)


class ExameFila(SQLModel, table=True):
    __tablename__ = "tfd_exames_fila"

    id: int | None = Field(default=None, primary_key=True)
    paciente_id: int = Field(foreign_key="tfd_pacientes.id", index=True)
    exame: str = Field(max_length=120, index=True)
    especialidade: str = Field(default="", max_length=80)
    # Filtros avançados e-SUS (mapeados de fila_todos.csv):
    # - tipo_fila = servico_tipo_nome (ex: ULTRASSONOGRAFIA, CONSULTAS ESPECIALIZADAS)
    # - codigo_procedimento = codigo_procedimento (ex: 0205020186)
    # - codigo_especialidade = CBO (ex: 225320) + nome_especialidade
    tipo_fila: str = Field(default="", max_length=80, index=True)
    codigo_procedimento: str = Field(default="", max_length=20, index=True)
    codigo_especialidade: str = Field(default="", max_length=10, index=True)
    nome_especialidade: str = Field(default="", max_length=120)
    prioridade: str = Field(default="rotina", max_length=20)  # rotina|urgente
    justificativa_prioridade: str = Field(default="", max_length=500)
    status: str = Field(
        default="aguardando", max_length=20, index=True
    )  # aguardando|agendado|recepcionado|realizado|faltou|cancelado
    data_pedido: date = Field(sa_column=Column(Date, index=True))
    data_agendada: date | None = Field(default=None, sa_column=Column(Date))
    hora_agendada: str = Field(default="", max_length=5)
    medico_id: int | None = Field(default=None, index=True)
    unidade_saude_id: int | None = Field(default=None, index=True)
    # Snapshot do agendamento (médico + unidade no momento da marcação)
    medico_nome: str = Field(default="", max_length=150)
    medico_cpf: str = Field(default="", max_length=14)
    medico_cbo_codigo: str = Field(default="", max_length=10)
    medico_cbo_descricao: str = Field(default="", max_length=120)
    unidade_nome: str = Field(default="", max_length=150)
    unidade_cnes: str = Field(default="", max_length=20)
    unidade_endereco: str = Field(default="", max_length=200)
    unidade_numero: str = Field(default="", max_length=20)
    unidade_bairro: str = Field(default="", max_length=100)
    unidade_municipio: str = Field(default="", max_length=100)
    unidade_cep: str = Field(default="", max_length=10)
    # Soft delete: remoção da fila preserva histórico + timeline
    ativo: bool = Field(default=True, index=True)
    motivo_remocao: str = Field(default="", max_length=500)
    removido_em: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=False)))
    removido_por: str = Field(default="", max_length=120)
    destino: str = Field(default="", max_length=120)
    observacoes: str = Field(default="", max_length=500)
    justificativa: str = Field(default="", max_length=500)  # justificativa clínica do pedido
    resultado: str = Field(default="", max_length=2000)  # resultado/laudo do exame realizado
    recepcionado_em: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=False)))
    recepcionado_por: str = Field(default="", max_length=120)
    status_anterior: str = Field(default="", max_length=20)  # p/ estornar recepção
    public_token: str = Field(default="", max_length=64, index=True)
    codigo_curto: str = Field(default="", max_length=12, index=True)  # novo modelo; legado = ""
    numero_pedido: str = Field(default="", max_length=30, index=True)  # identificação operacional
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


# ---------- Catálogo dinâmico e-SUS (Tipos / Procedimentos / Especialidades) ----------
class TipoFila(SQLModel, table=True):
    __tablename__ = "tfd_tipos_fila"

    id: int | None = Field(default=None, primary_key=True)
    codigo: str = Field(default="", max_length=10, index=True)  # servico_tipo_id ex: 31
    nome: str = Field(max_length=80, index=True, unique=True)  # servico_tipo_nome ex: ULTRASSONOGRAFIA
    ativo: bool = Field(default=True, index=True)


class ProcedimentoCatalogo(SQLModel, table=True):
    __tablename__ = "tfd_procedimentos"

    id: int | None = Field(default=None, primary_key=True)
    codigo: str = Field(max_length=20, index=True)  # codigo_procedimento ex: 0205020186
    nome: str = Field(max_length=150, index=True)  # nome_procedimento
    tipo_fila: str = Field(default="", max_length=80, index=True)  # servico_tipo_nome
    codigo_especialidade: str = Field(default="", max_length=10, index=True)  # CBO padrão
    nome_especialidade: str = Field(default="", max_length=120)
    codigo_curto: str = Field(default="", max_length=12, index=True)
    ativo: bool = Field(default=True, index=True)


class Especialidade(SQLModel, table=True):
    __tablename__ = "tfd_especialidades"

    id: int | None = Field(default=None, primary_key=True)
    codigo_cbo: str = Field(max_length=10, index=True, unique=True)  # ex: 225320
    nome: str = Field(max_length=120, index=True)  # ex: Médico em radiologia e diagnóstico por imagem
    ativo: bool = Field(default=True, index=True)


class Faturamento(SQLModel, table=True):
    __tablename__ = "tfd_faturamento"

    id: int | None = Field(default=None, primary_key=True)
    viagem_id: int | None = Field(default=None, foreign_key="tfd_viagens.id")
    paciente_id: int = Field(foreign_key="tfd_pacientes.id", index=True)
    procedimento: str = Field(max_length=150)  # nome SIGTAP
    codigo_sigtap: str = Field(default="", max_length=20, index=True)
    competencia: str = Field(max_length=7, index=True)  # AAAA-MM
    quantidade: int = Field(default=1)
    valor: float = Field(default=0, sa_column=Column(Numeric(12, 2)))
    tipo: str = Field(default="BPA", max_length=10)  # BPA | APAC
    status: str = Field(
        default="pendente", max_length=20, index=True
    )  # pendente|aprovado|rejeitado
    observacoes: str = Field(default="", max_length=500)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )
