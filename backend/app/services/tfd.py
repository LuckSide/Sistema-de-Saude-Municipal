from datetime import date
import time
import unicodedata
import weakref

from sqlalchemy import text
from sqlmodel import Session, func, select

from app.models.tfd import (
    ExameFila,
    Faturamento,
    Veiculo,
    Viagem,
    ViagemPaciente,
)

_ACENTOS_DE = "ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑÝŸáàãâäéèêëíìîïóòõôöúùûüçñýÿ"
_ACENTOS_PARA = "AAAAAEEEEIIIIOOOOOUUUUCNYYaaaaaeeeeiiiiooooouuuucnyy"
_PG_UNACCENT_CACHE: weakref.WeakKeyDictionary[object, tuple[bool, float]] = weakref.WeakKeyDictionary()
_PG_UNACCENT_FALSE_TTL = 60.0


def remover_acentos(texto: str) -> str:
    """Remove marcas diacríticas de strings para comparação textual normalizada."""
    if not texto:
        return ""
    nfkd = unicodedata.normalize("NFKD", str(texto))
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def coluna_sem_acento(db: Session, coluna):
    """Retorna expressão SQL normalizada para acentos em PostgreSQL (com fallback sem extensão) e SQLite."""
    try:
        bind = db.get_bind()
        dialect_name = getattr(getattr(bind, "dialect", None), "name", "")
    except Exception:
        return coluna

    if dialect_name != "postgresql":
        return coluna

    alvo = getattr(bind, "engine", bind)
    agora = time.monotonic()
    try:
        cached = _PG_UNACCENT_CACHE.get(alvo)
    except TypeError:
        cached = None
    if cached is not None:
        tem_ext, ts = cached
        if tem_ext or (agora - ts) < _PG_UNACCENT_FALSE_TTL:
            return func.unaccent(coluna) if tem_ext else func.translate(coluna, _ACENTOS_DE, _ACENTOS_PARA)

    try:
        tem_ext = bool(
            db.execute(text("SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'unaccent')")).scalar()
        )
    except Exception:
        tem_ext = False

    try:
        _PG_UNACCENT_CACHE[alvo] = (tem_ext, agora)
    except TypeError:
        pass
    return func.unaccent(coluna) if tem_ext else func.translate(coluna, _ACENTOS_DE, _ACENTOS_PARA)


def resumo_tfd(db: Session, competencia: str) -> dict:
    viagens = db.exec(
        select(func.count(Viagem.id)).where(
            func.to_char(Viagem.data_viagem, "YYYY-MM") == competencia
        )
    ).one()
    passageiros = db.exec(
        select(func.count(ViagemPaciente.id))
        .join(Viagem, Viagem.id == ViagemPaciente.viagem_id)
        .where(func.to_char(Viagem.data_viagem, "YYYY-MM") == competencia)
    ).one()
    exames_ag = db.exec(
        select(func.count(ExameFila.id)).where(ExameFila.status == "aguardando")
    ).one()
    exames_urg = db.exec(
        select(func.count(ExameFila.id)).where(
            ExameFila.status == "aguardando", ExameFila.prioridade == "urgente"
        )
    ).one()
    valor = (
        db.exec(
            select(func.coalesce(func.sum(Faturamento.valor * Faturamento.quantidade), 0)).where(
                Faturamento.competencia == competencia
            )
        ).one()
        or 0
    )
    cap_total = (
        db.exec(
            select(func.coalesce(func.sum(Veiculo.capacidade), 0))
            .join(Viagem, Viagem.veiculo_id == Veiculo.id)
            .where(func.to_char(Viagem.data_viagem, "YYYY-MM") == competencia)
        ).one()
        or 0
    )
    ocup = round((passageiros / cap_total * 100) if cap_total else 0, 1)
    return {
        "viagens_mes": viagens or 0,
        "passageiros_mes": passageiros or 0,
        "exames_aguardando": exames_ag or 0,
        "exames_urgentes": exames_urg or 0,
        "valor_competencia": float(valor),
        "ocupacao_media": ocup,
    }


def hoje_str() -> str:
    return date.today().strftime("%Y-%m")
