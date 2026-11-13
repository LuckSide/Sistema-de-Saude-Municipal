from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, LargeBinary, UniqueConstraint
from sqlmodel import Field, SQLModel

STATUS_FILA = ("na_fila", "agendado", "cancelado")
STATUS_MESTRE = ("agendado", "coletado", "realizado", "cancelado")
STATUS_AUDIT = (
    "pendente_conferencia",
    "aprovado",
    "divergente",
    "aguardando_autorizacao_sec",
)


class Laboratorio(SQLModel, table=True):
    __tablename__ = "lab_laboratorios"

    id: int | None = Field(default=None, primary_key=True)
    nome: str = Field(max_length=120, unique=True, index=True)
    ativo: bool = Field(default=True, index=True)


class VagaLab(SQLModel, table=True):
    __tablename__ = "lab_vagas"
    __table_args__ = (UniqueConstraint("laboratorio_id", "data", name="uq_lab_vaga_lab_data"),)

    id: int | None = Field(default=None, primary_key=True)
    laboratorio_id: int = Field(foreign_key="lab_laboratorios.id", index=True)
    data: date = Field(sa_column=Column(Date, index=True))
    vagas_totais: int = Field(default=0)
    vagas_ocupadas: int = Field(default=0)


class FilaPsf(SQLModel, table=True):
    __tablename__ = "lab_fila_psf"

    id: int | None = Field(default=None, primary_key=True)
    paciente_id: int = Field(foreign_key="tfd_pacientes.id", index=True)
    unidade_psf: str = Field(default="", max_length=120, index=True)
    medico_solicitante: str = Field(default="", max_length=120)
    data_solicitacao: date = Field(sa_column=Column(Date, index=True))
    status: str = Field(default="na_fila", max_length=20, index=True)
    prioridade: str = Field(default="rotina", max_length=20, index=True)  # urgente | alta | rotina
    justificativa: str = Field(default="", max_length=500)
    observacoes: str = Field(default="", max_length=500)
    sigtap_ids_json: str = Field(default="[]")
    lote_id: int | None = Field(default=None, foreign_key="lab_lotes_liberacao.id", index=True)


class SolicitacaoMestre(SQLModel, table=True):
    __tablename__ = "lab_solic_mestre"

    id: int | None = Field(default=None, primary_key=True)
    paciente_id: int = Field(foreign_key="tfd_pacientes.id", index=True)
    data_agendada: date = Field(sa_column=Column(Date, index=True))
    laboratorio_id: int = Field(foreign_key="lab_laboratorios.id", index=True)
    status: str = Field(default="agendado", max_length=20, index=True)
    agendado_por: str = Field(default="", max_length=120)
    origem_fila_id: int | None = Field(default=None, foreign_key="lab_fila_psf.id")
    lote_id: int | None = Field(default=None, foreign_key="lab_lotes_liberacao.id", index=True)
    status_auditoria: str = Field(
        default="pendente_conferencia", max_length=40, index=True
    )
    observacao_laboratorio: str = Field(default="", max_length=500)
    medico_id: int | None = Field(default=None)
    medico_solicitante: str = Field(default="", max_length=150)
    unidade_saude_id: int | None = Field(default=None)
    unidade_psf: str = Field(default="", max_length=150)
    justificativa: str = Field(default="", max_length=500)
    instrucoes_transporte: str = Field(default="", max_length=500)
    hora_agendada: str = Field(default="07:00", max_length=10)
    coletado_em: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=False))
    )
    coletado_por: str = Field(default="", max_length=120)


class ItemSolic(SQLModel, table=True):
    __tablename__ = "lab_solic_itens"

    id: int | None = Field(default=None, primary_key=True)
    solicitacao_id: int = Field(foreign_key="lab_solic_mestre.id", index=True)
    sigtap_id: int = Field(foreign_key="sigtap_procedimentos.id", index=True)
    quantidade: int = Field(default=1)
    status_auditoria: str = Field(
        default="pendente_conferencia", max_length=40, index=True
    )
    observacao: str = Field(default="", max_length=500)


class LabPedidoAjuste(SQLModel, table=True):
    __tablename__ = "lab_pedidos_ajuste"

    id: int | None = Field(default=None, primary_key=True)
    solicitacao_id: int = Field(foreign_key="lab_solic_mestre.id", index=True)
    laboratorio_id: int = Field(foreign_key="lab_laboratorios.id", index=True)
    tipo_ajuste: str = Field(default="modificacao_exames", max_length=50)
    justificativa: str = Field(max_length=1000)
    itens_propostos: str = Field(default="[]")
    status: str = Field(default="pendente", max_length=20, index=True)
    solicitado_por: str = Field(default="", max_length=120)
    resposta_secretaria: str = Field(default="", max_length=1000)
    analisado_por: str = Field(default="", max_length=120)
    created_at: datetime = Field(
        default_factory=datetime.utcnow, sa_column=Column(DateTime(timezone=False))
    )
    analisado_em: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=False))
    )


class LabOrcamentoMensal(SQLModel, table=True):
    __tablename__ = "lab_orcamentos_mensais"
    __table_args__ = (UniqueConstraint("competencia", name="uq_lab_orcamento_competencia"),)

    id: int | None = Field(default=None, primary_key=True)
    competencia: str = Field(max_length=7, index=True)  # Ex.: "2026-11" (AAAA-MM)
    teto_mensal: float = Field(default=0.0)
    valor_consumido: float = Field(default=0.0)
    observacoes: str = Field(default="", max_length=500)
    atualizado_por: str = Field(default="", max_length=120)
    created_at: datetime = Field(
        default_factory=datetime.utcnow, sa_column=Column(DateTime(timezone=False))
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow, sa_column=Column(DateTime(timezone=False))
    )


class LabLoteLiberacao(SQLModel, table=True):
    __tablename__ = "lab_lotes_liberacao"

    id: int | None = Field(default=None, primary_key=True)
    codigo_lote: str = Field(max_length=32, unique=True, index=True)  # Ex.: "LOTE-202611-0001"
    orcamento_id: int | None = Field(default=None, foreign_key="lab_orcamentos_mensais.id", index=True)
    competencia: str = Field(max_length=7, index=True)
    laboratorio_id: int = Field(foreign_key="lab_laboratorios.id", index=True)
    laboratorio_nome: str = Field(default="", max_length=120)

    valor_solicitado: float = Field(default=0.0)
    valor_consumido: float = Field(default=0.0)
    qtd_pacientes: int = Field(default=0)
    qtd_exames: int = Field(default=0)

    datas_alocacao_json: str = Field(default="[]")
    status: str = Field(default="consolidado", max_length=20, index=True)  # consolidado | cancelado
    observacoes: str = Field(default="", max_length=500)

    arquivo_comprovantes_nome: str = Field(default="", max_length=200)
    arquivo_comprovantes_sha256: str = Field(default="", max_length=64)
    arquivo_excel_nome: str = Field(default="", max_length=200)
    arquivo_excel_sha256: str = Field(default="", max_length=64)

    criado_por: str = Field(default="", max_length=120)
    created_at: datetime = Field(
        default_factory=datetime.utcnow, sa_column=Column(DateTime(timezone=False))
    )


class LabLoteItem(SQLModel, table=True):
    __tablename__ = "lab_lote_itens"
    __table_args__ = (
        UniqueConstraint("fila_psf_id", name="uq_lab_lote_item_fila_psf"),
        UniqueConstraint("solicitacao_mestre_id", name="uq_lab_lote_item_solic_mestre"),
    )

    id: int | None = Field(default=None, primary_key=True)
    lote_id: int = Field(foreign_key="lab_lotes_liberacao.id", index=True)
    fila_psf_id: int = Field(foreign_key="lab_fila_psf.id", index=True)
    solicitacao_mestre_id: int = Field(foreign_key="lab_solic_mestre.id", index=True)
    paciente_id: int = Field(foreign_key="tfd_pacientes.id", index=True)
    paciente_nome: str = Field(default="", max_length=150)
    paciente_cpf: str = Field(default="", max_length=20)
    paciente_prontuario: str = Field(default="", max_length=30)

    data_agendada: date = Field(sa_column=Column(Date, index=True))
    ordem_selecao: int = Field(default=1)
    prioridade_fila: str = Field(default="rotina", max_length=20)
    valor_consumido: float = Field(default=0.0)
    exames_snapshot_json: str = Field(default="[]")


class LabLoteArtefato(SQLModel, table=True):
    __tablename__ = "lab_lote_artefatos"
    __table_args__ = (UniqueConstraint("lote_id", "tipo", name="uq_lab_lote_artefato_tipo"),)

    id: int | None = Field(default=None, primary_key=True)
    lote_id: int = Field(foreign_key="lab_lotes_liberacao.id", index=True)
    tipo: str = Field(max_length=30, index=True)  # comprovantes_zip | relatorio_xlsx
    nome_arquivo: str = Field(max_length=200)
    mime_type: str = Field(max_length=120)
    tamanho_bytes: int = Field(default=0)
    sha256: str = Field(default="", max_length=64)
    conteudo: bytes = Field(sa_column=Column(LargeBinary, nullable=False))
    created_at: datetime = Field(
        default_factory=datetime.utcnow, sa_column=Column(DateTime(timezone=False))
    )

