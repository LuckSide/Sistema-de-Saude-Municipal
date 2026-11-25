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

    # Configurações Oficiais de Faturamento Ambulatorial (BPA/SIA - DATASUS)
    codigo_ibge: str = Field(default="312810", max_length=7)
    cep_padrao: str = Field(default="37177000", max_length=8)
    cnpj_orgao_gestor: str = Field(default="18239616000185", max_length=14)
    nome_orgao_gestor: str = Field(default="SMS GUAPE", max_length=30)
    sigla_orgao_gestor: str = Field(default="312810", max_length=6)
    nome_orgao_destino: str = Field(default="SECRETARIA MUNICIPAL DE SAUDE", max_length=40)
    tipo_orgao_destino: str = Field(default="M", max_length=1)  # M = Municipal, E = Estadual
    cnes_sms_padrao: str = Field(default="2146479", max_length=7)
    cnes_tfd_padrao: str = Field(default="2147092", max_length=7)
    cns_responsavel_tfd: str = Field(default="703403201915616", max_length=15)
    cbo_responsavel_tfd: str = Field(default="225142", max_length=6)
    cns_responsavel_lab: str = Field(default="700508575563459", max_length=15)
    cbo_responsavel_lab: str = Field(default="223415", max_length=6)
