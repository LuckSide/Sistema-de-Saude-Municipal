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
        v_clean = (v or "").strip()
        if not v_clean:
            return ""
        ok, msg = valida_cpf(v_clean)
        if not ok:
            raise ValueError(msg)
        return v_clean

    @field_validator("crm")
    @classmethod
    def _crm_valido(cls, v: str) -> str:
        v_clean = (v or "").strip()
        if not v_clean:
            return ""
        ok, msg, normalizado = valida_crm(v_clean)
        if not ok:
            raise ValueError(msg)
        return normalizado

    @field_validator("telefone")
    @classmethod
    def _tel_valido(cls, v: str) -> str:
        v_clean = (v or "").strip()
        if not v_clean:
            return ""
        ok, msg = valida_telefone(v_clean)
        if not ok:
            raise ValueError(msg)
        return v_clean

    @field_validator("email")
    @classmethod
    def _email_valido(cls, v: str) -> str:
        v_clean = (v or "").strip()
        if not v_clean:
            return ""
        ok, msg = valida_email(v_clean)
        if not ok:
            raise ValueError(msg)
        return v_clean


class MedicoOut(BaseModel):
    id: int
    nome: str = ""
    cpf: str = ""
    crm: str = ""
    cbo_codigo: str = ""
    cbo_descricao: str = ""
    especialidades: str = ""
    telefone: str = ""
    email: str = ""
    ativo: bool = True
    usuario_criado: str | None = None
    senha_temporaria: str | None = None


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
        v_clean = (v or "").strip()
        if not v_clean:
            return ""
        ok, msg = valida_cnes(v_clean)
        if not ok:
            raise ValueError(msg)
        return so_digitos(v_clean)

    @field_validator("telefone")
    @classmethod
    def _tel_valido(cls, v: str) -> str:
        v_clean = (v or "").strip()
        if not v_clean:
            return ""
        ok, msg = valida_telefone(v_clean)
        if not ok:
            raise ValueError(msg)
        return v_clean


class UnidadeOut(BaseModel):
    id: int
    nome: str = ""
    cnes: str = ""
    endereco: str = ""
    numero: str = ""
    bairro: str = ""
    municipio: str = ""
    cep: str = ""
    telefone: str = ""
    ativo: bool = True
