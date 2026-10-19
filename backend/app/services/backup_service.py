from datetime import date, datetime
from decimal import Decimal
from enum import Enum
import json
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlmodel import Session, delete, select

from app.models.audit import AuditLog
from app.models.cadastros_saude import Medico, UnidadeSaude
from app.models.dashboard_prefs import UserDashboardPrefs
from app.models.integracoes import IntegrationSettings
from app.models.lab_exames import (
    LabSolicitacao,
    SigtapCbo,
    SigtapCid,
    SigtapProcedimento,
    SigtapVersao,
)
from app.models.lab_fase6 import (
    FilaPsf,
    ItemSolic,
    Laboratorio,
    SolicitacaoMestre,
    VagaLab,
)
from app.models.settings import SystemSettings
from app.models.tfd import (
    Destino,
    Especialidade,
    ExameFila,
    Faturamento,
    Motorista,
    Paciente,
    ProcedimentoCatalogo,
    TipoFila,
    Veiculo,
    Viagem,
    ViagemFila,
    ViagemPaciente,
)
from app.models.user import User

# Ordem de inserção: pais primeiro, depois dependentes/filhos
MODELOS_ORDENADOS = [
    SystemSettings,
    IntegrationSettings,
    User,
    UserDashboardPrefs,
    Medico,
    UnidadeSaude,
    Destino,
    Veiculo,
    Motorista,
    Especialidade,
    ProcedimentoCatalogo,
    TipoFila,
    Paciente,
    Viagem,
    ExameFila,
    ViagemFila,
    ViagemPaciente,
    Faturamento,
    SigtapProcedimento,
    SigtapCbo,
    SigtapCid,
    SigtapVersao,
    LabSolicitacao,
    Laboratorio,
    VagaLab,
    FilaPsf,
    SolicitacaoMestre,
    ItemSolic,
    AuditLog,
]


def _serializar_valor(val: Any) -> Any:
    """Converte valores de tipos especiais (datas, decimais, UUIDs, enums) para JSON."""
    if val is None:
        return None
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, UUID):
        return str(val)
    if isinstance(val, Enum):
        return val.value
    return val


def _serializar_entidade(obj: Any) -> dict[str, Any]:
    """Serializa uma entidade SQLModel baseando-se nas colunas reais da tabela."""
    dados = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.name, None)
        dados[col.name] = _serializar_valor(val)
    return dados


def gerar_dump_dados(session: Session) -> dict[str, Any]:
    """Coleta e serializa todas as tabelas do sistema em um dicionário de dump.

    Retorna metadados (versão='1.0', data_geracao=ISO8601, total_registros)
    e os dados agrupados por nome da tabela.
    """
    tabelas_dump: dict[str, list[dict[str, Any]]] = {}
    total_registros = 0

    for model in MODELOS_ORDENADOS:
        nome_tabela = model.__tablename__
        try:
            # Ordena por id se existir a coluna id
            stmt = select(model)
            if hasattr(model, "id"):
                stmt = stmt.order_by(model.id)
            rows = session.exec(stmt).all()
            registros = [_serializar_entidade(r) for r in rows]
            tabelas_dump[nome_tabela] = registros
            total_registros += len(registros)
        except Exception:
            # Se a tabela não existir ainda no banco ou der erro de leitura, registra vazia
            tabelas_dump[nome_tabela] = []

    return {
        "versao": "1.0",
        "data_geracao": datetime.utcnow().isoformat(),
        "total_registros": total_registros,
        "tabelas": tabelas_dump,
    }


def _atualizar_sequences_postgres(session: Session, tabelas: list[str]) -> None:
    """Atualiza as sequences do PostgreSQL para evitar erro de chave duplicada em novos inserts."""
    if not session.bind or session.bind.dialect.name != "postgresql":
        return

    for nome_tabela in tabelas:
        try:
            seq_name = session.execute(
                text("SELECT pg_get_serial_sequence(:t, 'id')"), {"t": nome_tabela}
            ).scalar()
            if seq_name:
                session.execute(
                    text(
                        f"SELECT setval('{seq_name}', COALESCE((SELECT MAX(id) FROM {nome_tabela}), 1), (SELECT MAX(id) FROM {nome_tabela}) IS NOT NULL)"
                    )
                )
        except Exception:
            pass


def restaurar_dump_dados(session: Session, dump: dict[str, Any], autor_id: int) -> dict[str, Any]:
    """Restaura todos os dados a partir de um dump com atomicidade total.

    1. Valida estrutura do dump.
    2. Em transação atômica / savepoint:
       - Limpa dados existentes na ordem reversa de dependências (filhos -> pais).
       - Insere os dados restaurados na ordem de dependências (pais -> filhos), preservando IDs originais.
       - Atualiza sequences de auto-incremento (se PostgreSQL).
       - Registra um log de auditoria documentando o evento de restauração.
    """
    if not isinstance(dump, dict):
        raise ValueError("Conteúdo de backup inválido: não é um JSON válido.")

    dados_tabelas = dump.get("tabelas")
    if dados_tabelas is None and "total_registros" not in dump:
        # Tenta interpretar se o dump veio com as tabelas na raiz
        dados_tabelas = dump
    elif dados_tabelas is None:
        dados_tabelas = {}

    total_inseridos = 0
    contadores: dict[str, int] = {}
    tabelas_inseridas: list[str] = []

    # Localiza nome do autor para o log de auditoria (se já existir no dump ou na sessão atual)
    nome_autor = "Administrador"
    if autor_id:
        autor_atual = session.get(User, autor_id)
        if autor_atual:
            nome_autor = autor_atual.nome or autor_atual.username

    # Atomicidade total: qualquer exceção faz rollback no savepoint
    with session.begin_nested():
        # 1. Limpeza na ordem reversa (filhos primeiro)
        for model in reversed(MODELOS_ORDENADOS):
            try:
                session.exec(delete(model))
            except Exception as e:
                raise ValueError(f"Falha ao limpar tabela '{model.__tablename__}': {e}") from e

        # 2. Inserção na ordem correta (pais primeiro)
        for model in MODELOS_ORDENADOS:
            nome_tabela = model.__tablename__
            rows_data = dados_tabelas.get(nome_tabela)
            if rows_data is None:
                # Tenta pelo nome da classe
                rows_data = dados_tabelas.get(model.__name__, [])

            if not isinstance(rows_data, list):
                continue

            contadores[nome_tabela] = len(rows_data)
            tabelas_inseridas.append(nome_tabela)

            for item in rows_data:
                if not isinstance(item, dict):
                    continue
                try:
                    obj = model.model_validate(item)
                    session.add(obj)
                    total_inseridos += 1
                except Exception as e:
                    raise ValueError(
                        f"Falha ao restaurar registro na tabela '{nome_tabela}': {e}"
                    ) from e

        session.flush()

        # 3. Atualizar sequences no PostgreSQL
        _atualizar_sequences_postgres(session, tabelas_inseridas)

        # 4. Registrar evento na auditoria
        log_auditoria = AuditLog(
            user_id=autor_id if autor_id else None,
            user_name=nome_autor,
            action="restaurar_backup",
            entity="sistema",
            entity_id=None,
            details=json.dumps(
                {
                    "mensagem": "Restauração atômica do sistema concluída com sucesso.",
                    "versao_dump": dump.get("versao", "1.0"),
                    "data_dump": dump.get("data_geracao", ""),
                    "total_registros_restaurados": total_inseridos,
                    "tabelas": contadores,
                },
                ensure_ascii=False,
            ),
            timestamp=datetime.utcnow(),
        )
        session.add(log_auditoria)
        session.flush()

    # Confirma a transação
    session.commit()

    return {
        "ok": True,
        "total_registros_restaurados": total_inseridos,
        "contadores": contadores,
        "data_restauracao": datetime.utcnow().isoformat(),
    }
