"""Indicadores / Dashboard — agregados fila TFD + agenda lab (somente leitura agregada)."""

from calendar import monthrange
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from app.core.deps import get_db
from app.services.permissoes import need_perm
from app.models.lab_fase6 import Laboratorio, SolicitacaoMestre
from app.models.tfd import ExameFila, Paciente

router = APIRouter()

MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]


def _parse_data(s: str | None, fallback: date) -> date:
    if not s:
        return fallback
    try:
        y, m, d = map(int, s.split("-"))
        return date(y, m, d)
    except Exception:
        return fallback


def _bucket_mes(d: date) -> str:
    return d.strftime("%Y-%m")


def _label_mes(key: str) -> str:
    try:
        y, m = key.split("-")
        return f"{MESES_PT[int(m) - 1]}/{y[2:]}"
    except Exception:
        return key


def _bucket_semana(d: date) -> str:
    iso_ano, iso_sem, _ = d.isocalendar()
    return f"{iso_ano}-S{iso_sem:02d}"


def _label_semana(key: str, inicio: date) -> str:
    return f"{inicio.day:02d}/{inicio.month:02d}"


def _iter_meses(de: date, ate: date) -> list[str]:
    out: list[str] = []
    y, m = de.year, de.month
    while (y, m) <= (ate.year, ate.month):
        out.append(f"{y}-{m:02d}")
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return out


def _iter_semanas(de: date, ate: date) -> list[tuple[str, date, date]]:
    # semanas ISO seg–dom cobrindo [de, ate]
    ini = de - timedelta(days=de.weekday())
    out: list[tuple[str, date, date]] = []
    cur = ini
    while cur <= ate:
        fim = cur + timedelta(days=6)
        out.append((_bucket_semana(cur), cur, fim))
        cur += timedelta(days=7)
    return out


def _nome_tipo(e: ExameFila) -> str:
    t = (e.tipo_fila or "").strip().upper()
    if t:
        return t
    return "SEM TIPO"


def _nome_proc(e: ExameFila) -> str:
    """Nome limpo do procedimento p/ agrupar: 'COD - NOME' -> 'NOME' (upper)."""
    import re as _re

    s = (e.exame or "").strip()
    m = _re.match(r"^[0-9.\-]{4,}\s*-\s*(.+)$", s)
    nome = (m.group(1) if m else s).strip()
    return (nome or s or "SEM PROCEDIMENTO").upper()


def _match_proc(e: ExameFila, termo: str) -> bool:
    t = (termo or "").strip().lower()
    if not t:
        return False
    hay = f"{e.exame or ''} {e.tipo_fila or ''} {e.codigo_procedimento or ''} {_nome_proc(e)}".lower()
    return t in hay


def _metade(d_de: date, d_ate: date) -> date:
    delta = (d_ate - d_de).days
    return d_de + timedelta(days=delta // 2)


@router.get("/indicadores/procedimentos-top")
def procedimentos_top(
    de: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    ate: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    limit: int = Query(default=8, ge=1, le=20),
    db: Session = Depends(get_db),
    _=Depends(need_perm("dash_indicadores")),
):
    return procs_top_impl(db, de, ate, limit)


def procs_top_impl(db: Session, de: str | None, ate: str | None, limit: int) -> dict:
    hoje = date.today()
    d_ate = _parse_data(ate, hoje)
    prim = date(d_ate.year, d_ate.month, 1)
    m = prim.month - 5
    y = prim.year
    while m <= 0:
        m += 12
        y -= 1
    d_de = _parse_data(de, date(y, m, 1))
    meio = _metade(d_de, d_ate)
    exames = list(db.exec(select(ExameFila).where(ExameFila.ativo == True)).all())
    grupos: dict[str, dict] = {}
    for e in exames:
        k = _nome_proc(e)
        g = grupos.setdefault(k, {
            "procedimento": k, "codigo": (e.codigo_procedimento or "").strip(),
            "total_fila": 0, "aguardando": 0, "agendados": 0, "urgentes": 0,
            "novos_pri": 0, "novos_seg": 0, "novos_periodo": 0, "realizados_periodo": 0,
        })
        if e.status in ("aguardando", "agendado"):
            g["total_fila"] += 1
            if e.status == "agendado":
                g["agendados"] += 1
            else:
                g["aguardando"] += 1
            if e.prioridade == "urgente":
                g["urgentes"] += 1
        if e.data_pedido and d_de <= e.data_pedido <= d_ate:
            g["novos_periodo"] += 1
            if e.data_pedido <= meio:
                g["novos_pri"] += 1
            else:
                g["novos_seg"] += 1
        if e.status == "realizado" and e.data_agendada and d_de <= e.data_agendada <= d_ate:
            g["realizados_periodo"] += 1
    itens = []
    for g in grupos.values():
        if g["total_fila"] == 0 and g["novos_periodo"] == 0:
            continue
        pri, seg = g.pop("novos_pri"), g.pop("novos_seg")
        if pri > 0:
            var = round((seg - pri) / pri * 100, 1)
        else:
            var = 100.0 if seg > 0 else 0.0
        g["variacao_pct"] = var
        g["tendencia"] = "alta" if var > 10 else ("queda" if var < -10 else "estavel")
        itens.append(g)
    itens.sort(key=lambda g: g["total_fila"], reverse=True)
    return {"de": d_de.isoformat(), "ate": d_ate.isoformat(), "total": len(itens), "itens": itens[:limit]}


@router.get("/indicadores/procedimentos-evolucao")
def procedimentos_evolucao(
    de: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    ate: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    granularidade: str = Query(default="mes", pattern="^(mes|semana)$"),
    procedimentos: str = Query(default="", max_length=500),
    top: int = Query(default=4, ge=1, le=6),
    db: Session = Depends(get_db),
    _=Depends(need_perm("dash_indicadores")),
):
    return procs_evolucao_impl(db, de, ate, granularidade, procedimentos, top)


def procs_evolucao_impl(
    db: Session, de: str | None, ate: str | None,
    granularidade: str, procedimentos: str, top: int,
) -> dict:
    hoje = date.today()
    d_ate = _parse_data(ate, hoje)
    prim = date(d_ate.year, d_ate.month, 1)
    m = prim.month - 5
    y = prim.year
    while m <= 0:
        m += 12
        y -= 1
    d_de = _parse_data(de, date(y, m, 1))
    exames = list(db.exec(select(ExameFila).where(ExameFila.ativo == True)).all())
    termos = [t.strip() for t in (procedimentos or "").split(",") if t.strip()]
    if not termos:
        prev = procs_top_impl(db, d_de.isoformat(), d_ate.isoformat(), top)
        termos = [g["procedimento"] for g in prev["itens"][:top]]
    series = termos[:top]
    if granularidade == "semana":
        buckets = _iter_semanas(d_de, d_ate)
        pontos = []
        for k, ini, fim in buckets:
            row: dict = {
                "periodo": k, "label": _label_semana(k, ini),
                "inicio": ini.isoformat(), "fim": min(fim, d_ate).isoformat(),
            }
            tot = 0
            for s in series:
                n = sum(1 for e in exames if e.data_pedido and ini <= e.data_pedido <= fim and _match_proc(e, s))
                row[s] = n
                tot += n
            row["total"] = tot
            pontos.append(row)
    else:
        pontos = []
        for k in _iter_meses(d_de, d_ate):
            y_, m_ = map(int, k.split("-"))
            _, nd = monthrange(y_, m_)
            ini, fim = date(y_, m_, 1), date(y_, m_, nd)
            row = {"periodo": k, "label": _label_mes(k), "inicio": ini.isoformat(), "fim": fim.isoformat()}
            tot = 0
            for s in series:
                n = sum(1 for e in exames if e.data_pedido and ini <= e.data_pedido <= fim and _match_proc(e, s))
                row[s] = n
                tot += n
            row["total"] = tot
            pontos.append(row)
    return {
        "granularidade": granularidade, "de": d_de.isoformat(), "ate": d_ate.isoformat(),
        "series": series, "pontos": pontos,
    }


@router.get("/indicadores/resumo")
def resumo(
    de: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    ate: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    db: Session = Depends(get_db),
    _=Depends(need_perm("dash_indicadores")),
):
    return resumo_impl(db, de, ate)


def resumo_impl(db: Session, de: str | None, ate: str | None) -> dict:
    hoje = date.today()
    d_ate = _parse_data(ate, hoje)
    d_de = _parse_data(de, date(d_ate.year, d_ate.month, 1))
    exames = list(db.exec(select(ExameFila).where(ExameFila.ativo == True)).all())
    em_fila = sum(1 for e in exames if e.status in ("aguardando", "agendado"))
    urgentes = sum(1 for e in exames if e.status in ("aguardando", "agendado") and e.prioridade == "urgente")
    novos = sum(1 for e in exames if e.data_pedido and d_de <= e.data_pedido <= d_ate)
    agendados = sum(1 for e in exames if e.status == "agendado")
    realizados = sum(
        1 for e in exames
        if e.status == "realizado" and e.data_agendada and d_de <= e.data_agendada <= d_ate
    )
    mestres = list(db.exec(select(SolicitacaoMestre)).all())
    conf_mes = sum(1 for m in mestres if m.data_agendada and d_de <= m.data_agendada <= d_ate and m.status == "agendado")
    real_mes = sum(1 for m in mestres if m.data_agendada and d_de <= m.data_agendada <= d_ate and m.status == "realizado")
    # tempo médio espera (dias) dos realizados com pedido+agendada
    esperas = [
        (e.data_agendada - e.data_pedido).days
        for e in exames
        if e.status == "realizado" and e.data_pedido and e.data_agendada
        and d_de <= e.data_agendada <= d_ate and (e.data_agendada - e.data_pedido).days >= 0
    ]
    tempo_medio = round(sum(esperas) / len(esperas), 1) if esperas else 0
    return {
        "de": d_de.isoformat(), "ate": d_ate.isoformat(),
        "em_fila": em_fila, "urgentes": urgentes,
        "novos_periodo": novos, "agendados": agendados,
        "realizados_periodo": realizados,
        "agenda_confirmados": conf_mes, "agenda_realizados": real_mes,
        "tempo_medio_espera_dias": tempo_medio,
    }


@router.get("/indicadores/filas-evolucao")
def filas_evolucao(
    de: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    ate: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    granularidade: str = Query(default="mes", pattern="^(mes|semana)$"),
    tipo_fila: str = Query(default="", max_length=80),
    db: Session = Depends(get_db),
    _=Depends(need_perm("dash_indicadores")),
):
    return evolucao_impl(db, de, ate, granularidade, tipo_fila)


def evolucao_impl(db: Session, de: str | None, ate: str | None, granularidade: str, tipo_fila: str) -> dict:
    hoje = date.today()
    d_ate = _parse_data(ate, hoje)
    # default: últimos 6 meses completos
    prim = date(d_ate.year, d_ate.month, 1)
    m = prim.month - 5
    y = prim.year
    while m <= 0:
        m += 12
        y -= 1
    d_de = _parse_data(de, date(y, m, 1))
    exames = list(db.exec(select(ExameFila).where(ExameFila.ativo == True)).all())
    if tipo_fila:
        tf = tipo_fila.strip().lower()
        exames = [e for e in exames if tf in (_nome_tipo(e)).lower() or tf in (e.exame or "").lower()]

    if granularidade == "semana":
        buckets = _iter_semanas(d_de, d_ate)
        pontos = []
        for k, ini, fim in buckets:
            criados = sum(1 for e in exames if e.data_pedido and ini <= e.data_pedido <= fim)
            concl = sum(1 for e in exames if e.status == "realizado" and e.data_agendada and ini <= e.data_agendada <= fim)
            ag = sum(1 for e in exames if e.status == "agendado" and e.data_agendada and ini <= e.data_agendada <= fim)
            urg = sum(1 for e in exames if e.data_pedido and ini <= e.data_pedido <= fim and e.prioridade == "urgente")
            pontos.append({
                "periodo": k, "label": _label_semana(k, ini),
                "inicio": ini.isoformat(), "fim": min(fim, d_ate).isoformat(),
                "total": criados, "realizados": concl, "agendados": ag, "urgentes": urg,
            })
    else:
        keys = _iter_meses(d_de, d_ate)
        pontos = []
        for k in keys:
            y_, m_ = map(int, k.split("-"))
            _, nd = monthrange(y_, m_)
            ini, fim = date(y_, m_, 1), date(y_, m_, nd)
            criados = sum(1 for e in exames if e.data_pedido and ini <= e.data_pedido <= fim)
            concl = sum(1 for e in exames if e.status == "realizado" and e.data_agendada and ini <= e.data_agendada <= fim)
            ag = sum(1 for e in exames if e.status == "agendado" and e.data_agendada and ini <= e.data_agendada <= fim)
            urg = sum(1 for e in exames if e.data_pedido and ini <= e.data_pedido <= fim and e.prioridade == "urgente")
            pontos.append({
                "periodo": k, "label": _label_mes(k),
                "inicio": ini.isoformat(), "fim": fim.isoformat(),
                "total": criados, "realizados": concl, "agendados": ag, "urgentes": urg,
            })
    return {
        "granularidade": granularidade, "de": d_de.isoformat(), "ate": d_ate.isoformat(),
        "tipo_fila": tipo_fila, "pontos": pontos,
    }


@router.get("/indicadores/filas-volume")
def filas_volume(
    de: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    ate: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    status: str = Query(default="aguardando,agendado", max_length=60),
    db: Session = Depends(get_db),
    _=Depends(need_perm("dash_indicadores")),
):
    return volume_impl(db, de, ate, status)


def volume_impl(db: Session, de: str | None, ate: str | None, status: str) -> dict:
    hoje = date.today()
    d_ate = _parse_data(ate, hoje)
    prim = date(d_ate.year, d_ate.month, 1)
    m = prim.month - 5
    y = prim.year
    while m <= 0:
        m += 12
        y -= 1
    d_de = _parse_data(de, date(y, m, 1))
    wanted = {s.strip() for s in (status or "").split(",") if s.strip()} or {"aguardando", "agendado"}
    exames = [
        e for e in db.exec(select(ExameFila).where(ExameFila.ativo == True)).all()
        if e.status in wanted and e.data_pedido and d_de <= e.data_pedido <= d_ate
    ]
    # fallback: sem filtro de período quando nada cai no intervalo (base legada concentrada)
    if not exames:
        exames = [e for e in db.exec(select(ExameFila).where(ExameFila.ativo == True)).all() if e.status in wanted]
    grupos: dict[str, dict] = {}
    for e in exames:
        t = _nome_tipo(e)
        g = grupos.setdefault(t, {"tipo": t, "total": 0, "urgentes": 0, "agendados": 0, "aguardando": 0})
        g["total"] += 1
        if e.prioridade == "urgente":
            g["urgentes"] += 1
        if e.status == "agendado":
            g["agendados"] += 1
        elif e.status == "aguardando":
            g["aguardando"] += 1
    itens = sorted(grupos.values(), key=lambda g: g["total"], reverse=True)[:20]
    total = sum(g["total"] for g in itens)
    for g in itens:
        g["perc"] = round(g["total"] / total * 100, 1) if total else 0
    return {"de": d_de.isoformat(), "ate": d_ate.isoformat(), "status": sorted(wanted), "total": total, "itens": itens}


@router.get("/indicadores/agenda")
def agenda(
    de: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    ate: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    laboratorio_id: int | None = None,
    db: Session = Depends(get_db),
    _=Depends(need_perm("dash_indicadores")),
):
    return agenda_impl(db, de, ate, laboratorio_id)


def agenda_impl(db: Session, de: str | None, ate: str | None, laboratorio_id: int | None) -> dict:
    hoje = date.today()
    d_de = _parse_data(de, date(hoje.year, hoje.month, 1))
    _, nd = monthrange(d_de.year, d_de.month)
    d_ate = _parse_data(ate, date(d_de.year, d_de.month, nd))
    labs = {l.id: l.nome for l in db.exec(select(Laboratorio)).all()}
    dias: dict[str, dict] = {}
    cur = d_de
    while cur <= d_ate:
        dias[cur.isoformat()] = {
            "data": cur.isoformat(), "confirmados": 0, "realizados": 0,
            "cancelados": 0, "total": 0, "itens": [],
        }
        cur += timedelta(days=1)
    mestres = list(db.exec(select(SolicitacaoMestre)).all())
    if laboratorio_id:
        mestres = [m for m in mestres if m.laboratorio_id == laboratorio_id]
    for m in mestres:
        if not m.data_agendada or not (d_de <= m.data_agendada <= d_ate):
            continue
        k = m.data_agendada.isoformat()
        pac = db.get(Paciente, m.paciente_id)
        d = dias.get(k)
        if not d:
            continue
        d["total"] += 1
        if m.status == "agendado":
            d["confirmados"] += 1
        elif m.status == "realizado":
            d["realizados"] += 1
        elif m.status == "cancelado":
            d["cancelados"] += 1
        if len(d["itens"]) < 30:
            d["itens"].append({
                "origem": "lab", "id": m.id,
                "titulo": pac.nome if pac else f"Pedido #{m.id}",
                "status": m.status,
                "local": labs.get(m.laboratorio_id, ""),
            })
    exames = list(db.exec(select(ExameFila).where(ExameFila.ativo == True, ExameFila.data_agendada != None)).all())  # noqa: E711
    for e in exames:
        if not e.data_agendada or not (d_de <= e.data_agendada <= d_ate):
            continue
        if e.status not in ("agendado", "realizado"):
            continue
        k = e.data_agendada.isoformat()
        d = dias.get(k)
        if not d:
            continue
        pac = db.get(Paciente, e.paciente_id)
        d["total"] += 1
        if e.status == "agendado":
            d["confirmados"] += 1
        else:
            d["realizados"] += 1
        if len(d["itens"]) < 30:
            d["itens"].append({
                "origem": "tfd", "id": e.id,
                "titulo": f"{pac.nome if pac else '?'} · {(e.exame or '')[:40]}",
                "status": e.status,
                "local": e.destino or "",
            })
    lista = [dias[k] for k in sorted(dias)]
    return {
        "de": d_de.isoformat(), "ate": d_ate.isoformat(),
        "laboratorios": [{"id": i, "nome": n} for i, n in sorted(labs.items(), key=lambda x: x[1])],
        "dias": lista,
        "tot_confirmados": sum(d["confirmados"] for d in lista),
        "tot_realizados": sum(d["realizados"] for d in lista),
        "tot_cancelados": sum(d["cancelados"] for d in lista),
    }
