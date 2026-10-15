from pydantic import BaseModel, Field


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    must_change_password: bool = False
    versao: str = "1.0.0"
    tem_atualizacao: bool = False
    update_enabled: bool = True


class LoginIn(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(default="", max_length=100)
    gerar_temporaria: bool = True
    nome: str = Field(default="", max_length=120)
    area: str = Field(default="painel", pattern="^(painel|ferramentas)$")
    telas: list[str] = Field(default_factory=list)
    acoes: dict[str, list[str]] = Field(default_factory=dict)
    medico_id: int | None = None
    permite_retroativo: bool = True
    is_superuser: bool = False
    is_active: bool = True


class UserUpdate(BaseModel):
    nome: str | None = None
    area: str | None = Field(default=None, pattern="^(painel|ferramentas)$")
    telas: list[str] | None = None
    acoes: dict[str, list[str]] | None = None
    medico_id: int | None = None
    permite_retroativo: bool | None = None
    is_superuser: bool | None = None
    is_active: bool | None = None


class ResetSenhaOut(BaseModel):
    ok: bool = True
    senha_temporaria: str
    detail: str = "Senha temporária gerada. Usuário deve trocar no próximo login."


class UserOut(BaseModel):
    id: int
    username: str
    nome: str
    area: str
    telas: list[str]
    acoes: dict[str, list[str]] = {}
    medico_id: int | None = None
    permite_retroativo: bool = True
    is_superuser: bool
    is_active: bool
    must_change_password: bool = False


# ---------- Dashboard customizável ----------
class DashboardItem(BaseModel):
    model_config = {"extra": "forbid"}

    id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    tipo: str = Field(pattern="^(atalho|widget)$")
    ref: str = Field(min_length=1, max_length=40)


class DashboardIn(BaseModel):
    model_config = {"extra": "forbid"}

    items: list[DashboardItem] = Field(default_factory=list, max_length=30)


class DashboardOut(BaseModel):
    items: list[DashboardItem] = []


class TrocarSenhaIn(BaseModel):
    senha_atual: str = Field(min_length=1, max_length=100)
    nova_senha: str = Field(min_length=6, max_length=100)


class PrimeiraTrocaIn(BaseModel):
    senha_atual: str = Field(min_length=1, max_length=100)
    nova_senha: str = Field(min_length=6, max_length=100)
    confirmar_senha: str = Field(min_length=6, max_length=100)
