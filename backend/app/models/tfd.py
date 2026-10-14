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
    ativo: bool = Field(default=True, index=True)


class Viagem(SQLModel, table=True):
    __tablename__ = "tfd_viagens"

    id: int | None = Field(default=None, primary_key=True)
    destino: str = Field(max_length=120, index=True)
    unidade: str = Field(default="", max_length=150)  # hospital/clinica destino
    data_viagem: date = Field(sa_column=Column(Date, index=True))
    hora_saida: str = Field(default="", max_length=5)  # HH:MM
    veiculo_id: int | None = Field(default=None, foreign_key="tfd_veiculos.id")
    motorista: str = Field(default="", max_length=120)
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
    presente: bool = Field(default=True)


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
    prioridade: str = Field(default="rotina", max_length=20)  # rotina|prioritaria|urgente
    status: str = Field(
        default="aguardando", max_length=20, index=True
    )  # aguardando|agendado|realizado|cancelado
    data_pedido: date = Field(sa_column=Column(Date, index=True))
    data_agendada: date | None = Field(default=None, sa_column=Column(Date))
    destino: str = Field(default="", max_length=120)
    observacoes: str = Field(default="", max_length=500)
    public_token: str = Field(default="", max_length=64, index=True)
    codigo_curto: str = Field(default="", max_length=12, index=True)  # novo modelo; legado = ""
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
