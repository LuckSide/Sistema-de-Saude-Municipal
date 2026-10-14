from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql://guape:guape123@localhost:5432/saude_guape"
    SECRET_KEY: str = "troque-esta-chave-em-producao-32chars-min"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    FIRST_SUPERUSER: str = "admin"
    FIRST_SUPERUSER_PASSWORD: str = "admin123"
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]
    GITHUB_OWNER: str = "LuckSide"
    GITHUB_REPO: str = "Sistema-de-Saude-Municipal"
    UPDATE_BRANCH: str = "main"
    UPDATE_ENABLED: bool = True
    GITHUB_TOKEN: str = ""


settings = Settings()
