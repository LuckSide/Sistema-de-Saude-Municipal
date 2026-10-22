from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql://guape:guape123@localhost:5432/saude_guape"
    SECRET_KEY: str = Field(
        default="troque-esta-chave-em-producao-32chars-min", min_length=32
    )
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    FIRST_SUPERUSER: str = "admin"
    FIRST_SUPERUSER_PASSWORD: str = Field(default="admin123", min_length=6)
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    # Configurações do Pool de Conexões do Banco (para suportar 100+ usuários simultâneos)
    DB_POOL_SIZE: int = 30
    DB_MAX_OVERFLOW: int = 50
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 1800
    GITHUB_OWNER: str = "LuckSide"
    GITHUB_REPO: str = "Sistema-de-Saude-Municipal"
    UPDATE_BRANCH: str = "main"
    # Seguro por padrão: auto-update só liga com UPDATE_ENABLED=true explícito (compose).
    UPDATE_ENABLED: bool = False
    GITHUB_TOKEN: str = ""


settings = Settings()
