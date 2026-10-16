from pydantic import BaseModel, Field, field_validator

from app.services.validacoes import (
    so_digitos,
    valida_cnes,
    valida_cpf,
    valida_crm,
    valida_email,
    valida_telefone,
)


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

    @field_validator("cpf")
    @classmethod
    def _cpf_valido(cls, v: str) -> str:
        if not (v or "").strip():
            raise ValueError("CPF é obrigatório.")
        ok, msg = valida_cpf(v)
        if not ok:
            raise ValueError(msg)
        return v

    @field_validator("crm")
    @classmethod
    def _crm_valido(cls, v: str) -> str:
        ok, msg, normalizado = valida_crm(v)
        if not ok:
            raise ValueError(msg)
        return normalizado

    @field_validator("telefone")
    @classmethod
    def _tel_valido(cls, v: str) -> str:
        ok, msg = valida_telefone(v)
        if not ok:
            raise ValueError(msg)
        return v

    @field_validator("email")
    @classmethod
    def _email_valido(cls, v: str) -> str:
        ok, msg = valida_email(v)
        if not ok:
            raise ValueError(msg)
        return v


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

    @field_validator("cnes")
    @classmethod
    def _cnes_valido(cls, v: str) -> str:
        ok, msg = valida_cnes(v)
        if not ok:
            raise ValueError(msg)
        return so_digitos(v)

    @field_validator("telefone")
    @classmethod
    def _tel_valido(cls, v: str) -> str:
        ok, msg = valida_telefone(v)
        if not ok:
            raise ValueError(msg)
        return v


class UnidadeOut(UnidadeIn):
    id: int
