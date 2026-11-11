from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime
from sqlmodel import Field, SQLModel


class SigtapProcedimento(SQLModel, table=True):
    __tablename__ = "sigtap_procedimentos"

    id: int | None = Field(default=None, primary_key=True)
    codigo: str = Field(max_length=20, index=True, unique=True)
    descricao: str = Field(max_length=255, index=True)
    complexidade: str = Field(default="", max_length=20)
    instrumento: str = Field(default="BPA-C", max_length=10, index=True)
    # Detalhe Tabela Unificada DATASUS (importação SIGTAP)
    sexo: str = Field(default="", max_length=10)
    idade_min: int = Field(default=0)
    idade_max: int = Field(default=0)
    qtd_maxima: int = Field(default=0)
    pontos: int = Field(default=0)
    valor_sa: float = Field(default=0)
    valor_sp: float = Field(default=0)
    valor_sh: float = Field(default=0)
    competencia: str = Field(default="", max_length=7, index=True)  # AAAA-MM da carga
    # Hierarquia completa Tabela Unificada SIGTAP (Área/Grupo -> Subgrupo -> Forma de Organização)
    grupo_codigo: str = Field(default="", max_length=2, index=True)
    grupo_nome: str = Field(default="", max_length=150)
    subgrupo_codigo: str = Field(default="", max_length=4, index=True)
    subgrupo_nome: str = Field(default="", max_length=180)
    forma_organizacao_codigo: str = Field(default="", max_length=6, index=True)
    forma_organizacao_nome: str = Field(default="", max_length=180)


class SigtapGrupo(SQLModel, table=True):
    """Área / Grupo principal da Tabela Unificada SIGTAP (2 dígitos)."""

    __tablename__ = "sigtap_grupos"

    id: int | None = Field(default=None, primary_key=True)
    codigo: str = Field(max_length=2, unique=True, index=True)
    nome: str = Field(max_length=150)


class SigtapSubgrupo(SQLModel, table=True):
    """Subgrupo da Tabela Unificada SIGTAP vinculado à Área/Grupo (4 dígitos)."""

    __tablename__ = "sigtap_subgrupos"

    id: int | None = Field(default=None, primary_key=True)
    codigo: str = Field(max_length=4, unique=True, index=True)
    grupo_codigo: str = Field(max_length=2, index=True)
    nome: str = Field(max_length=180)


class SigtapFormaOrganizacao(SQLModel, table=True):
    """Forma de organização do SIGTAP (6 dígitos)."""

    __tablename__ = "sigtap_formas_organizacao"

    id: int | None = Field(default=None, primary_key=True)
    codigo: str = Field(max_length=6, unique=True, index=True)
    grupo_codigo: str = Field(max_length=2, index=True)
    subgrupo_codigo: str = Field(max_length=4, index=True)
    nome: str = Field(max_length=180)


class SigtapOcupacao(SQLModel, table=True):
    """Cadastro único e normalizado de CBOs (ocupações) no SIGTAP."""

    __tablename__ = "sigtap_ocupacoes"

    id: int | None = Field(default=None, primary_key=True)
    cbo: str = Field(max_length=10, unique=True, index=True)
    descricao: str = Field(default="", max_length=150)
    descricao_normalizada: str = Field(default="", max_length=150, index=True)
    ativo: bool = Field(default=True, index=True)


class SigtapCbo(SQLModel, table=True):
    """CBOs/ocupações autorizadas por procedimento."""

    __tablename__ = "sigtap_cbos"

    id: int | None = Field(default=None, primary_key=True)
    procedimento_codigo: str = Field(max_length=20, index=True)
    cbo: str = Field(max_length=10, index=True)
    descricao: str = Field(default="", max_length=120)


class SigtapCid(SQLModel, table=True):
    """CID-10 compatíveis por procedimento."""

    __tablename__ = "sigtap_cids"

    id: int | None = Field(default=None, primary_key=True)
    procedimento_codigo: str = Field(max_length=20, index=True)
    cid: str = Field(max_length=10, index=True)
    descricao: str = Field(default="", max_length=255)


class SigtapVersao(SQLModel, table=True):
    """Histórico de cargas da Tabela Unificada (competência mês/ano)."""

    __tablename__ = "sigtap_versoes"

    id: int | None = Field(default=None, primary_key=True)
    competencia: str = Field(max_length=7, index=True)
    origem: str = Field(default="upload", max_length=20)
    arquivo: str = Field(default="", max_length=255)
    total_proc: int = Field(default=0)
    inseridos: int = Field(default=0)
    atualizados: int = Field(default=0)
    cbo_total: int = Field(default=0)
    cid_total: int = Field(default=0)
    ignorados: int = Field(default=0)
    usuario: str = Field(default="", max_length=120)
    criado_em: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class LabSolicitacao(SQLModel, table=True):
    __tablename__ = "lab_solicitacoes"

    id: int | None = Field(default=None, primary_key=True)
    paciente_id: int = Field(foreign_key="tfd_pacientes.id", index=True)
    sigtap_id: int = Field(foreign_key="sigtap_procedimentos.id", index=True)
    data_solicitacao: date = Field(sa_column=Column(Date, index=True))
    laboratorio: str = Field(default="", max_length=120, index=True)
    status: str = Field(
        default="Solicitado", max_length=20, index=True
    )  # Solicitado|Agendado|Realizado|Cancelado
    faturado: bool = Field(default=False, index=True)
    competencia: str = Field(default="", max_length=7, index=True)  # AAAA-MM
    observacoes: str = Field(default="", max_length=500)
