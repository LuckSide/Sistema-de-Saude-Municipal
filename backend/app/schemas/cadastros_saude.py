from pydantic import BaseModel, Field, field_validator

from app.services.validacoes import (
    so_digitos,
    valida_cnes,
    valida_cns,
    valida_cpf,
    valida_crm,
    valida_email,
    valida_telefone,
    UFS,
)


class MedicoIn(BaseModel):
    nome: str = Field(min_length=2, max_length=150)
    cpf: str = Field(default="", max_length=14)
    cns: str = Field(default="", max_length=15)
    crm: str = Field(default="", max_length=40)
    conselho_tipo: str = Field(default="CRM", max_length=20)
    conselho_uf: str = Field(default="MG", max_length=2)
    cbo_codigo: str = Field(default="", max_length=10)
    cbo_descricao: str = Field(default="", max_length=120)
    especialidade: str = Field(default="", max_length=120)
    especialidades: str = Field(default="", max_length=500)
    vinculo: str = Field(default="ESTATUTARIO", max_length=50)
    chs_total: int = Field(default=40, ge=0, le=168)
    chs_ambulatorial: int = Field(default=40, ge=0, le=168)
    chs_hospitalar: int = Field(default=0, ge=0, le=168)
    chs_outros: int = Field(default=0, ge=0, le=168)
    telefone: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=120)
    unidades_ids: list[int] = Field(default_factory=list)
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

    @field_validator("cns")
    @classmethod
    def _cns_valido(cls, v: str) -> str:
        v_clean = (v or "").strip()
        if not v_clean:
            return ""
        ok, msg = valida_cns(v_clean)
        if not ok:
            raise ValueError(msg)
        return so_digitos(v_clean)

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

    @field_validator("conselho_uf")
    @classmethod
    def _uf_valida(cls, v: str) -> str:
        uf = (v or "").strip().upper()
        if uf and uf not in UFS:
            raise ValueError(f"UF do conselho '{uf}' inválida.")
        return uf or "MG"

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
    cns: str = ""
    crm: str = ""
    conselho_tipo: str = "CRM"
    conselho_uf: str = "MG"
    cbo_codigo: str = ""
    cbo_descricao: str = ""
    especialidade: str = ""
    especialidades: str = ""
    vinculo: str = "ESTATUTARIO"
    chs_total: int = 40
    chs_ambulatorial: int = 40
    chs_hospitalar: int = 0
    chs_outros: int = 0
    telefone: str = ""
    email: str = ""
    unidades_ids: list[int] = Field(default_factory=list)
    ativo: bool = True
    usuario_criado: str | None = None
    senha_temporaria: str | None = None


class UnidadeIn(BaseModel):
    nome: str = Field(min_length=2, max_length=150)
    cnes: str = Field(default="", max_length=20)
    tipo_estabelecimento: str = Field(default="02", max_length=50)
    codigo_ibge: str = Field(default="312810", max_length=10)
    cnpj: str = Field(default="18239616000185", max_length=20)
    responsavel_tecnico_nome: str = Field(default="", max_length=150)
    responsavel_tecnico_cns: str = Field(default="", max_length=15)
    responsavel_tecnico_conselho: str = Field(default="", max_length=50)
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

    @field_validator("responsavel_tecnico_cns")
    @classmethod
    def _rt_cns_valido(cls, v: str) -> str:
        v_clean = (v or "").strip()
        if not v_clean:
            return ""
        ok, msg = valida_cns(v_clean)
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
    tipo_estabelecimento: str = "02"
    codigo_ibge: str = "312810"
    cnpj: str = "18239616000185"
    responsavel_tecnico_nome: str = ""
    responsavel_tecnico_cns: str = ""
    responsavel_tecnico_conselho: str = ""
    endereco: str = ""
    numero: str = ""
    bairro: str = ""
    municipio: str = ""
    cep: str = ""
    telefone: str = ""
    ativo: bool = True


# ---------- Serviços Especializados (CNES) ----------
class UnidadeServicoEspecializadoIn(BaseModel):
    unidade_saude_id: int
    servico_codigo: str = Field(min_length=1, max_length=10)
    servico_descricao: str = Field(default="", max_length=150)
    classificacao_codigo: str = Field(min_length=1, max_length=10)
    classificacao_descricao: str = Field(default="", max_length=150)
    caracteristica: str = Field(default="PROPRIO", max_length=20)
    cnes_terceiro: str = Field(default="", max_length=20)
    ativo: bool = True


class UnidadeServicoEspecializadoOut(UnidadeServicoEspecializadoIn):
    id: int


# ---------- Equipes de Saúde (INE) ----------
class EquipeProfissionalIn(BaseModel):
    medico_id: int
    funcao: str = Field(default="MÉDICO", max_length=100)
    chs: int = Field(default=40, ge=1, le=168)


class EquipeProfissionalOut(BaseModel):
    id: int
    equipe_id: int
    medico_id: int
    funcao: str = "MÉDICO"
    chs: int = 40
    medico_nome: str | None = None
    medico_cns: str | None = None
    medico_crm: str | None = None
    medico_cbo: str | None = None


class EquipeSaudeIn(BaseModel):
    unidade_saude_id: int
    ine: str = Field(min_length=1, max_length=10)
    nome_equipe: str = Field(min_length=2, max_length=150)
    tipo_equipe: str = Field(default="70 - Equipe de Saúde da Família (eSF)", max_length=100)
    area: str = Field(default="", max_length=50)
    ativo: bool = True
    profissionais: list[EquipeProfissionalIn] = Field(default_factory=list)

    @field_validator("ine")
    @classmethod
    def _ine_valido(cls, v: str) -> str:
        d = so_digitos(v)
        if not d:
            raise ValueError("INE é obrigatório.")
        if len(d) != 10:
            raise ValueError("Código INE deve ter exatamente 10 dígitos numéricos.")
        return d


class EquipeSaudeOut(BaseModel):
    id: int
    unidade_saude_id: int
    ine: str = ""
    nome_equipe: str = ""
    tipo_equipe: str = "70 - Equipe de Saúde da Família (eSF)"
    area: str = ""
    ativo: bool = True
    unidade_nome: str | None = None
    profissionais: list[EquipeProfissionalOut] = Field(default_factory=list)


# ---------- Prestadores de Serviços (Subagente 3) ----------
class PrestadorIn(BaseModel):
    razao_social: str = Field(min_length=2, max_length=150)
    nome_fantasia: str = Field(default="", max_length=150)
    cnpj: str = Field(default="", max_length=20)
    cnes: str = Field(default="", max_length=20)
    tipo_entidade: str = Field(default="hospital", max_length=50)  # hospital | laboratorio | clinica | filantropico
    responsavel_nome: str = Field(default="", max_length=120)
    responsavel_telefone: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=120)
    telefone: str = Field(default="", max_length=30)
    endereco: str = Field(default="", max_length=200)
    municipio: str = Field(default="Guapé", max_length=100)
    ativo: bool = True
    observacoes: str = Field(default="", max_length=500)


class PrestadorOut(PrestadorIn):
    id: int
