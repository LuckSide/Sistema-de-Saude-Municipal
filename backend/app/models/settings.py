from sqlmodel import Field, SQLModel


class SystemSettings(SQLModel, table=True):
    __tablename__ = "system_settings"

    id: int | None = Field(default=None, primary_key=True)
    cidade: str = Field(default="Guapé", max_length=80)
    uf: str = Field(default="MG", max_length=2)
    subtitulo: str = Field(default="Secretaria Municipal", max_length=120)
