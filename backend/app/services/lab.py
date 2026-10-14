import json
from datetime import date
from pathlib import Path

from sqlmodel import Session, func, select

from app.models.lab_exames import LabSolicitacao, SigtapProcedimento


def seed_sigtap(db: Session) -> int:
    seed_path = Path(__file__).parent.parent / "data" / "sigtap_lab_seed.json"
    rows: list[dict] = []
    if seed_path.exists():
        rows = json.loads(seed_path.read_text(encoding="utf-8"))
    if not rows:
        rows = [
            {"codigo": "0202020380", "descricao": "HEMOGRAMA COMPLETO", "complexidade": "MC", "instrumento": "BPA-C"},
            {"codigo": "0202010473", "descricao": "DOSAGEM DE GLICOSE", "complexidade": "AB", "instrumento": "BPA-C"},
            {"codigo": "0202010295", "descricao": "DOSAGEM DE COLESTEROL TOTAL", "complexidade": "AB", "instrumento": "BPA-C"},
        ]
    novos = 0
    existentes = {r.codigo for r in db.exec(select(SigtapProcedimento)).all()}
    for row in rows:
        if row.get("codigo") in existentes:
            continue
        db.add(SigtapProcedimento(**row))
        novos += 1
    if novos:
        db.commit()
    return novos


def competencia_of(data_solicitacao: date) -> str:
    return data_solicitacao.strftime("%Y-%m")


def _count(db: Session, stmt) -> int:
    return db.exec(stmt).one() or 0


def resumo_lab(db: Session, competencia: str) -> dict:
    base = [LabSolicitacao.competencia == competencia]
    solicitados = _count(db, select(func.count(LabSolicitacao.id)).where(*base, LabSolicitacao.status == "Solicitado"))
    agendados = _count(db, select(func.count(LabSolicitacao.id)).where(*base, LabSolicitacao.status == "Agendado"))
    realizados = _count(db, select(func.count(LabSolicitacao.id)).where(*base, LabSolicitacao.status == "Realizado"))
    cancelados = _count(db, select(func.count(LabSolicitacao.id)).where(*base, LabSolicitacao.status == "Cancelado"))
    prontos = _count(
        db,
        select(func.count(LabSolicitacao.id)).where(
            *base, LabSolicitacao.status == "Realizado", LabSolicitacao.faturado == False  # noqa: E712
        ),
    )
    faturados = _count(db, select(func.count(LabSolicitacao.id)).where(*base, LabSolicitacao.faturado == True))  # noqa: E712
    return {
        "competencia": competencia,
        "solicitados": solicitados,
        "agendados": agendados,
        "realizados": realizados,
        "cancelados": cancelados,
        "prontos_faturar": prontos,
        "faturados": faturados,
    }


def prontos_faturar(db: Session, competencia: str | None = None) -> list[LabSolicitacao]:
    stmt = select(LabSolicitacao).where(
        LabSolicitacao.status == "Realizado",
        LabSolicitacao.faturado == False,  # noqa: E712
    )
    if competencia:
        stmt = stmt.where(LabSolicitacao.competencia == competencia)
    return list(db.exec(stmt.order_by(LabSolicitacao.data_solicitacao.desc()).limit(500)).all())


def marcar_faturado(db: Session, ids: list[int]) -> dict:
    atualizados = 0
    nao_encontrados: list[int] = []
    for sid in set(ids):
        obj = db.get(LabSolicitacao, sid)
        if not obj:
            nao_encontrados.append(sid)
            continue
        if not obj.faturado:
            obj.faturado = True
            db.add(obj)
            atualizados += 1
    db.commit()
    return {"atualizados": atualizados, "nao_encontrados": sorted(nao_encontrados)}


def lote_bpa(db: Session, competencia: str) -> list[dict]:
    rows = db.exec(
        select(
            SigtapProcedimento.codigo,
            SigtapProcedimento.descricao,
            SigtapProcedimento.instrumento,
            func.count(LabSolicitacao.id).label("qtd"),
        )
        .join(SigtapProcedimento, SigtapProcedimento.id == LabSolicitacao.sigtap_id)
        .where(
            LabSolicitacao.competencia == competencia,
            LabSolicitacao.status == "Realizado",
            SigtapProcedimento.instrumento == "BPA-C",
        )
        .group_by(
            SigtapProcedimento.codigo,
            SigtapProcedimento.descricao,
            SigtapProcedimento.instrumento,
        )
        .order_by(SigtapProcedimento.codigo)
    ).all()
    return [{"codigo": c, "descricao": d, "instrumento": i, "qtd": q} for c, d, i, q in rows]


def lote_csv(db: Session, competencia: str) -> str:
    linhas = ["codigo,qtd"]
    for item in lote_bpa(db, competencia):
        linhas.append(f"{item['codigo']},{item['qtd']}")
    return "\n".join(linhas) + "\n"
