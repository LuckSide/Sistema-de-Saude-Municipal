from datetime import date, datetime
from decimal import Decimal
from enum import Enum
import json
import logging
from typing import Any, get_args
from uuid import UUID

from sqlalchemy import column, insert, inspect, text
from sqlmodel import Session, SQLModel, delete, select

from app.models.apac import (  # noqa: F401
    AnexoLaudoAPAC,
    FaixaNumeracaoAPAC,
    LoteFaturamentoAPAC,
    ProcedimentoSecundarioAPAC,
    SolicitacaoAPAC,
)
from app.models.audit import AuditLog
from app.models.cadastros_saude import Medico, UnidadeSaude
from app.models.dashboard_prefs import UserDashboardPrefs
from app.models.farmacia import (  # noqa: F401
    FarmaciaLinkPublico,
    InsumoInterno,
    Medicamento,
    MovimentacaoInsumo,
    MovimentacaoMedicamento,
)
from app.models.integracoes import (  # noqa: F401
    IntegrationSettings,
    PecIndicadorCache,
    PecSyncLog,
    WhatsAppLog,
)
from app.models.lab_exames import (
    LabSolicitacao,
    SigtapCbo,
    SigtapCid,
    SigtapFormaOrganizacao,
    SigtapGrupo,
    SigtapOcupacao,
    SigtapProcedimento,
    SigtapSubgrupo,
    SigtapVersao,
)
from app.models.lab_fase6 import (
    FilaPsf,
    ItemSolic,
    Laboratorio,
    LabLoteArtefato,
    LabLoteItem,
    LabLoteLiberacao,
    LabOrcamentoMensal,
    LabPedidoAjuste,
    SolicitacaoMestre,
    VagaLab,
)
from app.models.oxigenio import (  # noqa: F401
    CilindroComodatoMovimentacao,
    CilindroVazioRecolhimento,
    EmprestimoOxigenio,
    EmpresaOxigenio,
    EntradaCompraOxigenio,
    EquipamentoRespiratorio,
    ItemEmprestimoOxigenio,
    LicitacaoContratoOxigenio,
    TrocaCilindroHistorico,
)
from app.models.settings import SystemSettings
from app.models.tfd import (
    Destino,
    Especialidade,
    ExameFila,
    Faturamento,
    Motorista,
    Paciente,
    PacienteHistorico,
    ProcedimentoCatalogo,
    TipoFila,
    Veiculo,
    Viagem,
    ViagemFila,
    ViagemPaciente,
)
from app.models.user import User

logger = logging.getLogger("backup")

# Tabelas extras que NÃO existiam nos backups v1 legados (29 tabelas), mas têm FK para elas.
# Mantido para compatibilidade ao restaurar backups antigos.
MODELOS_LIMPEZA_EXTRA = [
    TrocaCilindroHistorico,       # referencia oxigenio_emprestimos + tfd_pacientes + oxigenio_empresas
    ItemEmprestimoOxigenio,       # referencia oxigenio_emprestimos + oxigenio_equipamentos
    CilindroVazioRecolhimento,    # referencia tfd_pacientes + oxigenio_emprestimos + oxigenio_empresas
    EmprestimoOxigenio,           # referencia tfd_pacientes + oxigenio_equipamentos + oxigenio_empresas + oxigenio_licitacoes
    AnexoLaudoAPAC,               # referencia apac_solicitacoes
    ProcedimentoSecundarioAPAC,   # referencia apac_solicitacoes
    SolicitacaoAPAC,              # referencia tfd_pacientes + medicos
    LabPedidoAjuste,              # referencia lab_solic_mestre + lab_laboratorios
    PacienteHistorico,            # referencia tfd_pacientes
]

# Conjunto legado de 29 tabelas (compatibilidade com backups antigos que não incluem módulos novos)
MODELOS_LEGADOS = [
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
TABELAS_LEGADAS: frozenset[str] = frozenset(m.__tablename__ for m in MODELOS_LEGADOS)

# Todos os modelos persistidos do sistema (52 tabelas: núcleo + TFD + SIGTAP + Lab + APAC + Oxigênio + Farmácia + Integrações)
TODOS_MODELOS: list[type[SQLModel]] = [
    *MODELOS_LEGADOS,
    LabPedidoAjuste,
    FaixaNumeracaoAPAC,
    SolicitacaoAPAC,
    ProcedimentoSecundarioAPAC,
    AnexoLaudoAPAC,
    LoteFaturamentoAPAC,
    EmpresaOxigenio,
    LicitacaoContratoOxigenio,
    EntradaCompraOxigenio,
    EquipamentoRespiratorio,
    EmprestimoOxigenio,
    TrocaCilindroHistorico,
    ItemEmprestimoOxigenio,
    CilindroVazioRecolhimento,
    CilindroComodatoMovimentacao,
    Medicamento,
    MovimentacaoMedicamento,
    InsumoInterno,
    MovimentacaoInsumo,
    FarmaciaLinkPublico,
    PecSyncLog,
    PecIndicadorCache,
    WhatsAppLog,
    PacienteHistorico,
    SigtapGrupo,
    SigtapSubgrupo,
    SigtapFormaOrganizacao,
    SigtapOcupacao,
    LabOrcamentoMensal,
    LabLoteLiberacao,
    LabLoteItem,
    LabLoteArtefato,
]

MODELO_POR_TABELA: dict[str, type[SQLModel]] = {
    m.__tablename__: m for m in TODOS_MODELOS
}

# Ordem topológica garantida pelo grafo real de FKs (pais antes de filhos)
MODELOS_ORDENADOS: list[type[SQLModel]] = [
    MODELO_POR_TABELA[t.name]
    for t in SQLModel.metadata.sorted_tables
    if t.name in MODELO_POR_TABELA
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
    if isinstance(val, bytes):
        import base64
        return base64.b64encode(val).decode("ascii")
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

    Lê diretamente as colunas existentes no banco em savepoints isolados para que
    nenhuma tabela falhe silenciosamente ou aborte a transação das tabelas seguintes.
    Em caso de erro de leitura em qualquer tabela existente, interrompe com exceção
    explícita para nunca gerar um backup incompleto como se fosse válido.
    """
    tabelas_dump: dict[str, list[dict[str, Any]]] = {}
    total_registros = 0

    insp = inspect(session.connection())
    tabelas_existentes = set(insp.get_table_names())

    for model in MODELOS_ORDENADOS:
        nome_tabela = model.__tablename__
        if nome_tabela not in tabelas_existentes:
            tabelas_dump[nome_tabela] = []
            continue

        try:
            with session.begin_nested():
                cols_db = [c["name"] for c in insp.get_columns(nome_tabela)]
                if not cols_db:
                    tabelas_dump[nome_tabela] = []
                    continue

                table = model.__table__
                select_cols = [
                    table.c[c] if c in table.c else column(c) for c in cols_db
                ]
                stmt = select(*select_cols).select_from(table)
                pk_order = [
                    table.c[pk.name]
                    for pk in table.primary_key.columns
                    if pk.name in cols_db
                ]
                if pk_order:
                    stmt = stmt.order_by(*pk_order)

                rows = session.execute(stmt).mappings().all()
                registros = [
                    {col_name: _serializar_valor(row[col_name]) for col_name in cols_db}
                    for row in rows
                ]
                tabelas_dump[nome_tabela] = registros
                total_registros += len(registros)
        except Exception as e:
            logger.exception("Falha ao exportar tabela '%s' no backup", nome_tabela)
            raise ValueError(
                f"Falha ao exportar dados da tabela '{nome_tabela}': {e}"
            ) from e

    return {
        "versao": "1.0",
        "data_geracao": datetime.utcnow().isoformat(),
        "total_registros": total_registros,
        "tabelas": tabelas_dump,
    }


def _tabelas_limpeza_ordenadas(
    session: Session, tabelas_base: set[str] | None = None
) -> list[Any]:
    """Retorna tabelas existentes no banco em ordem reversa de dependências (filhos -> pais).

    Inclui todas as tabelas alvo e quaisquer outras tabelas que possuam FK
    direta ou transitiva apontando para elas (ex.: oxigênio, APAC, ajustes de lab).
    """
    tabelas_alvo = set(tabelas_base) if tabelas_base is not None else set(MODELO_POR_TABELA)
    tabelas_alvo |= {m.__tablename__ for m in MODELOS_LIMPEZA_EXTRA}

    mudou = True
    while mudou:
        mudou = False
        for table in SQLModel.metadata.tables.values():
            if table.name not in tabelas_alvo and any(
                fk.column.table.name in tabelas_alvo for fk in table.foreign_keys
            ):
                tabelas_alvo.add(table.name)
                mudou = True

    tabelas_existentes = set(inspect(session.connection()).get_table_names())
    return [
        table
        for table in reversed(SQLModel.metadata.sorted_tables)
        if table.name in tabelas_alvo and table.name in tabelas_existentes
    ]


def _inserir_lote_tabela(
    session: Session,
    model: type[SQLModel],
    rows_data: list[Any],
    max_params: int,
) -> int:
    """Valida e insere registros em lotes multi-row preservando IDs originais."""
    nome_tabela = model.__tablename__
    table = model.__table__
    cols = list(table.columns)
    pk_keys = [c.key for c in table.primary_key.columns]
    batch_size = max(1, min(1000, max_params // max(1, len(cols))))

    campos_default_nao_nulo = {
        fname
        for fname, finfo in model.model_fields.items()
        if not finfo.is_required()
        and (finfo.default is not None or finfo.default_factory is not None)
        and type(None) not in get_args(finfo.annotation)
        and finfo.annotation is not type(None)
    }

    linhas_lote: list[dict[str, Any]] = []
    inseridos = 0

    def _flush_lote() -> None:
        if not linhas_lote:
            return
        try:
            session.execute(insert(table).values(linhas_lote))
        except Exception as e:
            raise ValueError(
                f"Falha ao inserir registros na tabela '{nome_tabela}': {e}"
            ) from e
        linhas_lote.clear()

    for item in rows_data:
        if not isinstance(item, dict):
            continue
        item_validacao = item
        if campos_default_nao_nulo and any(
            k in item and item[k] is None for k in campos_default_nao_nulo
        ):
            item_validacao = {
                k: v
                for k, v in item.items()
                if not (v is None and k in campos_default_nao_nulo)
            }
        try:
            obj = model.model_validate(item_validacao)
        except Exception as e:
            raise ValueError(
                f"Falha ao restaurar registro na tabela '{nome_tabela}': {e}"
            ) from e

        row_dict = {col.key: getattr(obj, col.key) for col in cols}
        if any(row_dict.get(pk) is None for pk in pk_keys):
            _flush_lote()
            session.add(obj)
            inseridos += 1
            continue

        linhas_lote.append(row_dict)
        inseridos += 1
        if len(linhas_lote) >= batch_size:
            _flush_lote()

    _flush_lote()
    return inseridos


def _atualizar_sequences_postgres(session: Session, modelos: list[type[SQLModel]]) -> None:
    """Atualiza as sequences do PostgreSQL para evitar erro de chave duplicada em novos inserts."""
    bind = session.get_bind()
    if not bind or bind.dialect.name != "postgresql":
        return

    for model in modelos:
        nome_tabela = model.__tablename__
        pk_cols = list(model.__table__.primary_key.columns)
        if len(pk_cols) != 1:
            continue
        pk_col = pk_cols[0].name
        try:
            with session.begin_nested():
                seq_name = session.execute(
                    text("SELECT pg_get_serial_sequence(:t, :c)"),
                    {"t": nome_tabela, "c": pk_col},
                ).scalar()
                if seq_name:
                    session.execute(
                        text(
                            f"SELECT setval(CAST(:seq AS regclass), "
                            f"COALESCE((SELECT MAX({pk_col}) FROM {nome_tabela}), 1), "
                            f"(SELECT MAX({pk_col}) FROM {nome_tabela}) IS NOT NULL)"
                        ),
                        {"seq": seq_name},
                    )
        except Exception:
            # Savepoint externo garante rollback limpo sem abortar a transação principal
            pass


def restaurar_dump_dados(session: Session, dump: dict[str, Any], autor_id: int) -> dict[str, Any]:
    """Restaura todos os dados a partir de um dump com atomicidade total.

    1. Valida estrutura do dump.
    2. Em savepoint atômico:
       - Limpa dados existentes (tabelas extras com FK primeiro, depois tabelas do backup),
         na ordem reversa de dependências (filhos -> pais).
       - Insere os dados restaurados na ordem de dependências (pais -> filhos),
         preservando IDs originais.
       - Atualiza sequences de auto-incremento (se PostgreSQL).
       - Registra um log de auditoria documentando o evento de restauração.
    3. Confirma a transação no banco de dados.
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
    modelos_inseridos: list[type[SQLModel]] = []

    # Localiza nome do autor para o log de auditoria (se já existir no dump ou na sessão atual)
    nome_autor = "Administrador"
    if autor_id:
        autor_atual = session.get(User, autor_id)
        if autor_atual:
            nome_autor = autor_atual.nome or autor_atual.username

    bind = session.get_bind()
    is_sqlite = bool(bind and bind.dialect.name == "sqlite")
    max_params = 900 if is_sqlite else 30000

    tabelas_no_dump = {
        model.__tablename__
        for model in MODELOS_ORDENADOS
        if model.__tablename__ in dados_tabelas or model.__name__ in dados_tabelas
    }
    tabelas_base_limpeza = set(TABELAS_LEGADAS) | tabelas_no_dump

    # Savepoint atômico: qualquer exceção faz rollback apenas deste ponto
    with session.begin_nested():
        # 1. Limpeza na ordem reversa de dependências (filhos -> pais)
        tabelas_limpas = _tabelas_limpeza_ordenadas(session, tabelas_base_limpeza)
        for table in tabelas_limpas:
            try:
                session.execute(delete(table))
            except Exception as e:
                raise ValueError(
                    f"Falha ao limpar tabela '{table.name}': {e}"
                ) from e

        # 2. Inserção na ordem correta (pais primeiro)
        for model in MODELOS_ORDENADOS:
            nome_tabela = model.__tablename__
            rows_data = dados_tabelas.get(nome_tabela)
            if rows_data is None:
                # Tenta pelo nome da classe
                rows_data = dados_tabelas.get(model.__name__)

            if not isinstance(rows_data, list):
                continue

            inseridos_tabela = _inserir_lote_tabela(session, model, rows_data, max_params)
            contadores[nome_tabela] = inseridos_tabela
            total_inseridos += inseridos_tabela
            modelos_inseridos.append(model)

        session.flush()
        session.expire_all()

        # 3. Atualizar sequences no PostgreSQL (todas as tabelas limpas e/ou restauradas)
        modelos_sequence = list(
            dict.fromkeys(
                [
                    MODELO_POR_TABELA[t.name]
                    for t in tabelas_limpas
                    if t.name in MODELO_POR_TABELA
                ]
                + modelos_inseridos
            )
        )
        _atualizar_sequences_postgres(session, modelos_sequence)

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

    # Confirma a transação externa aberta pelo get_db (ou pela própria sessão)
    session.commit()

    return {
        "ok": True,
        "total_registros_restaurados": total_inseridos,
        "contadores": contadores,
        "data_restauracao": datetime.utcnow().isoformat(),
    }
