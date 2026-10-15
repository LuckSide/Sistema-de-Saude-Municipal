from sqlmodel import Field, SQLModel


class IntegrationSettings(SQLModel, table=True):
    """Configurações de integrações (linha única id=1).

    Segredos (senhas, DSN completo, RNDS secret, chave privada) ficam
    armazenados aqui e NUNCA retornados em claro — só flags `*_configurado`
    e resumos mascarados. Env vars continuam suportadas como fallback
    (ex: PEC_DATABASE_URL) quando o campo do banco está vazio.
    """

    __tablename__ = "integration_settings"

    id: int | None = Field(default=None, primary_key=True)

    # --- e-SUS APS / PEC ---
    pec_fonte: str = Field(default="auto", max_length=10)  # auto|postgres|files|mock
    pec_servidor_url: str = Field(default="", max_length=255)
    pec_usuario: str = Field(default="", max_length=120)
    pec_senha: str = Field(default="", max_length=255)
    pec_database_url: str = Field(default="", max_length=500)

    # --- RNDS ---
    rnds_ambiente: str = Field(default="homologacao", max_length=20)  # homologacao|producao
    rnds_client_id: str = Field(default="", max_length=120)
    rnds_secret: str = Field(default="", max_length=255)
    rnds_cert_pem: str = Field(default="", max_length=8000)
    rnds_key_pem: str = Field(default="", max_length=8000)
