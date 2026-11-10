from datetime import date, datetime
from sqlalchemy import Column, Date, DateTime, Text
from sqlmodel import Field, SQLModel


class Medicamento(SQLModel, table=True):
    __tablename__ = "farmacia_medicamentos"

    id: int | None = Field(default=None, primary_key=True)
    codigo: str = Field(max_length=50, index=True)
    nome: str = Field(max_length=200, index=True)
    principio_ativo: str = Field(default="", max_length=200, index=True)
    dosagem: str = Field(default="", max_length=100)
    forma_farmaceutica: str = Field(default="Comprimido", max_length=100)
    unidade_medida: str = Field(default="comprimido", max_length=50)
    categoria: str = Field(default="Básico / Atenção Primária", max_length=100, index=True)
    fabricante: str = Field(default="", max_length=150)
    lote: str = Field(default="", max_length=50)
    validade: date | None = Field(default=None, sa_column=Column(Date, index=True))
    estoque_atual: int = Field(default=0)
    estoque_minimo: int = Field(default=10)
    requer_receita: bool = Field(default=True)
    controlado: bool = Field(default=False)
    localizacao_prateleira: str = Field(default="", max_length=100)
    observacoes: str = Field(default="", sa_column=Column(Text))
    ativo: bool = Field(default=True, index=True)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )
    updated_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=False), default=None),
    )


class MovimentacaoMedicamento(SQLModel, table=True):
    __tablename__ = "farmacia_movimentacoes"

    id: int | None = Field(default=None, primary_key=True)
    medicamento_id: int = Field(foreign_key="farmacia_medicamentos.id", index=True)
    medicamento_nome: str = Field(default="", max_length=200)
    tipo: str = Field(max_length=40, index=True)  # ENTRADA_COMPRA, ENTRADA_DOACAO, SAIDA_DISPENSACAO, SAIDA_PERDA, SAIDA_TRANSFERENCIA
    quantidade: int = Field(default=1)
    lote: str = Field(default="", max_length=50)
    validade: date | None = Field(default=None, sa_column=Column(Date))
    saldo_anterior: int = Field(default=0)
    saldo_posterior: int = Field(default=0)
    documento_referencia: str = Field(default="", max_length=100)  # NF, Receita ou Guia
    paciente_nome: str = Field(default="", max_length=200)
    paciente_cpf: str = Field(default="", max_length=20)
    paciente_cns: str = Field(default="", max_length=30)
    prescritor_nome: str = Field(default="", max_length=150)
    prescritor_crm: str = Field(default="", max_length=50)
    motivo_descarte: str = Field(default="", max_length=200)
    responsavel_usuario: str = Field(default="", max_length=150)
    observacoes: str = Field(default="", sa_column=Column(Text))
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class InsumoInterno(SQLModel, table=True):
    __tablename__ = "farmacia_insumos"

    id: int | None = Field(default=None, primary_key=True)
    codigo: str = Field(max_length=50, index=True)
    nome: str = Field(max_length=200, index=True)
    categoria: str = Field(default="Material de Consumo", max_length=100, index=True)  # Descartáveis, EPI, Curativos, Injetáveis, Higiene
    unidade_medida: str = Field(default="unidade", max_length=50)
    lote: str = Field(default="", max_length=50)
    validade: date | None = Field(default=None, sa_column=Column(Date, index=True))
    estoque_atual: int = Field(default=0)
    estoque_minimo: int = Field(default=10)
    local_armazenamento: str = Field(default="", max_length=100)
    observacoes: str = Field(default="", sa_column=Column(Text))
    ativo: bool = Field(default=True, index=True)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )
    updated_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=False), default=None),
    )


class MovimentacaoInsumo(SQLModel, table=True):
    __tablename__ = "farmacia_movimentacoes_insumos"

    id: int | None = Field(default=None, primary_key=True)
    insumo_id: int = Field(foreign_key="farmacia_insumos.id", index=True)
    insumo_nome: str = Field(default="", max_length=200)
    tipo: str = Field(max_length=40, index=True)  # ENTRADA_COMPRA, ENTRADA_DOACAO, SAIDA_PSF, SAIDA_SETOR, SAIDA_DESCARTE
    quantidade: int = Field(default=1)
    saldo_anterior: int = Field(default=0)
    saldo_posterior: int = Field(default=0)
    unidade_destino: str = Field(default="", max_length=150)  # PSF / Unidade Básica / Setor
    responsavel_recebimento: str = Field(default="", max_length=150)
    documento_referencia: str = Field(default="", max_length=100)
    responsavel_usuario: str = Field(default="", max_length=150)
    observacoes: str = Field(default="", sa_column=Column(Text))
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class FarmaciaLinkPublico(SQLModel, table=True):
    __tablename__ = "farmacia_links_publicos"

    id: int | None = Field(default=None, primary_key=True)
    token: str = Field(max_length=64, unique=True, index=True)
    titulo: str = Field(default="Consulta de Medicamentos - Farmácia Municipal", max_length=200)
    tipo_perfil: str = Field(default="paciente", max_length=20, index=True)  # "paciente" ou "tv"
    mostrar_quantidade: bool = Field(default=False)  # Configuração para o Modo TV
    filtro_tipo: str = Field(default="todos", max_length=30)  # "todos", "especificos", "categoria"
    medicamentos_ids: str = Field(default="[]", sa_column=Column(Text))  # JSON array de IDs de medicamentos selecionados
    categoria_filtro: str = Field(default="", max_length=100)
    tempo_atualizacao_segundos: int = Field(default=30)  # Intervalo de auto-refresh no Modo TV
    mensagem_rodape: str = Field(default="Secretaria Municipal de Saúde · Guapé / MG", max_length=255)
    ativo: bool = Field(default=True, index=True)
    visualizacoes_count: int = Field(default=0)
    created_by: str = Field(default="", max_length=100)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )
    expires_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=False)),
    )
