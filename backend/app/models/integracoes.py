from datetime import datetime

from sqlalchemy import Column, DateTime, Text
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
    pec_banco_nome: str = Field(default="esus", max_length=80)
    pec_usuario: str = Field(default="", max_length=120)
    pec_senha: str = Field(default="", max_length=255)
    pec_database_url: str = Field(default="", max_length=500)
    # SSH Tunnel p/ conexão segura sem expor banco
    pec_ssh_habilitado: bool = Field(default=False)
    pec_ssh_host: str = Field(default="", max_length=150)
    pec_ssh_porta: int = Field(default=22)
    pec_ssh_usuario: str = Field(default="", max_length=120)
    pec_ssh_senha: str = Field(default="", max_length=255)
    pec_ssh_chave_privada: str = Field(default="", max_length=8000)
    pec_porta_local: int = Field(default=5433)

    # --- Sincronização Periódica de Pacientes ---
    pec_sync_automatica: bool = Field(default=True)
    pec_sync_intervalo_horas: int = Field(default=6)  # 1, 6, 12, 24
    pec_sync_ultima_execucao: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=False)),
    )
    pec_sync_ultimo_status: str = Field(default="", max_length=30)  # SUCESSO | ERRO | EM_EXECUCAO
    pec_sync_total_pacientes: int = Field(default=0)

    # --- RNDS ---
    rnds_ambiente: str = Field(default="homologacao", max_length=20)  # homologacao|producao
    rnds_client_id: str = Field(default="", max_length=120)
    rnds_secret: str = Field(default="", max_length=255)
    rnds_cert_pem: str = Field(default="", max_length=8000)
    rnds_key_pem: str = Field(default="", max_length=8000)


class PecSyncLog(SQLModel, table=True):
    """Registro de auditoria/log das sincronizações de cadastros com o e-SUS PEC."""

    __tablename__ = "pec_sync_logs"

    id: int | None = Field(default=None, primary_key=True)
    iniciado_em: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False), index=True),
    )
    finalizado_em: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=False)),
    )
    status: str = Field(default="EM_EXECUCAO", max_length=20, index=True)  # SUCESSO | ERRO | EM_EXECUCAO
    total_lidos: int = Field(default=0)
    total_inseridos: int = Field(default=0)
    total_atualizados: int = Field(default=0)
    total_duplicados_mesclados: int = Field(default=0)
    total_erros: int = Field(default=0)
    duracao_segundos: float = Field(default=0.0)
    mensagem: str = Field(default="", max_length=1000)
    detalhes: str = Field(default="", sa_column=Column(Text))
    origem: str = Field(default="agendado", max_length=20)  # agendado | manual


class PecIndicadorCache(SQLModel, table=True):
    """Cache persistente local dos indicadores do e-SUS PEC (Previne Brasil / APS).
    Elimina a lentidão de 8s de queries remotas via SSH, respondendo em <10ms.
    """

    __tablename__ = "pec_indicadores_cache"

    id: int | None = Field(default=None, primary_key=True)
    indicador_id: str = Field(max_length=20, index=True)
    nome: str = Field(default="", max_length=150)
    meta: int = Field(default=60)
    numerador: int = Field(default=0)
    denominador: int = Field(default=0)
    resultado: int = Field(default=0)
    periodo: str = Field(max_length=20, index=True)
    ubs: str = Field(default="todas", max_length=50, index=True)
    equipe: str = Field(default="todas", max_length=50, index=True)
    atualizado_em: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


