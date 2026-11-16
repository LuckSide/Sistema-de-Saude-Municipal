from sqlmodel import SQLModel, Field


class Medico(SQLModel, table=True):
    __tablename__ = "medicos"

    id: int | None = Field(default=None, primary_key=True)
    nome: str = Field(max_length=150, index=True)
    cpf: str = Field(default="", max_length=14)
    crm: str = Field(default="", max_length=40, index=True)
    cbo_codigo: str = Field(default="", max_length=10)
    cbo_descricao: str = Field(default="", max_length=120)
    especialidades: str = Field(default="", max_length=500)  # csv
    telefone: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=120)
    unidades_ids: str = Field(default="", max_length=500)
    ativo: bool = Field(default=True)


class UnidadeSaude(SQLModel, table=True):
    __tablename__ = "unidades_saude"

    id: int | None = Field(default=None, primary_key=True)
    nome: str = Field(max_length=150, index=True)
    cnes: str = Field(default="", max_length=20, index=True)
    endereco: str = Field(default="", max_length=200)
    numero: str = Field(default="", max_length=20)
    bairro: str = Field(default="", max_length=100)
    municipio: str = Field(default="", max_length=100)
    cep: str = Field(default="", max_length=10)
    telefone: str = Field(default="", max_length=30)
    ativo: bool = Field(default=True)


class Prestador(SQLModel, table=True):
    """Entidade prestadora de serviços de saúde conveniada ou contratada (ex: Santa Casa, clínicas, laboratórios externos)."""
    __tablename__ = "prestadores"

    id: int | None = Field(default=None, primary_key=True)
    razao_social: str = Field(max_length=150, index=True)
    nome_fantasia: str = Field(default="", max_length=150, index=True)
    cnpj: str = Field(default="", max_length=20, index=True)
    cnes: str = Field(default="", max_length=20, index=True)
    tipo_entidade: str = Field(default="hospital", max_length=50, index=True)  # hospital | laboratorio | clinica | filantropico
    responsavel_nome: str = Field(default="", max_length=120)
    responsavel_telefone: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=120)
    telefone: str = Field(default="", max_length=30)
    endereco: str = Field(default="", max_length=200)
    municipio: str = Field(default="Guapé", max_length=100)
    ativo: bool = Field(default=True, index=True)
    observacoes: str = Field(default="", max_length=500)

