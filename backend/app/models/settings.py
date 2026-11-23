from sqlmodel import Field, SQLModel


class SystemSettings(SQLModel, table=True):
    __tablename__ = "system_settings"

    id: int | None = Field(default=None, primary_key=True)
    cidade: str = Field(default="Guapé", max_length=80)
    uf: str = Field(default="MG", max_length=2)
    subtitulo: str = Field(default="Secretaria Municipal", max_length=120)
    brasao_url: str = Field(default="", max_length=500)
    icone_url: str = Field(default="", max_length=500)
    exames_habilitados_sigtap: str = Field(default="")
    exames_por_tipo_fila_json: str = Field(default="{}")
    valores_combinados_sigtap_json: str = Field(default="{}")
