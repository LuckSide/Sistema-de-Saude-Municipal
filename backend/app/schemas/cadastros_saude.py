from pydantic import BaseModel, Field


class MedicoIn(BaseModel):
    nome: str = Field(min_length=2, max_length=150)
    cpf: str = Field(default="", max_length=14)
    crm: str = Field(default="", max_length=40)
    cbo_codigo: str = Field(default="", max_length=10)
    cbo_descricao: str = Field(default="", max_length=120)
    especialidades: str = Field(default="", max_length=500)
    telefone: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=120)
    ativo: bool = True


class MedicoOut(MedicoIn):
    id: int


class UnidadeIn(BaseModel):
    nome: str = Field(min_length=2, max_length=150)
    cnes: str = Field(default="", max_length=20)
    endereco: str = Field(default="", max_length=200)
    numero: str = Field(default="", max_length=20)
    bairro: str = Field(default="", max_length=100)
    municipio: str = Field(default="", max_length=100)
    cep: str = Field(default="", max_length=10)
    telefone: str = Field(default="", max_length=30)
    ativo: bool = True


class UnidadeOut(UnidadeIn):
    id: int
