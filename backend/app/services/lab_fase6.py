from datetime import date

from fastapi import HTTPException
from sqlmodel import Session, func, select

from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import (
    STATUS_AUDIT,
    FilaPsf,
    ItemSolic,
    Laboratorio,
    SolicitacaoMestre,
    VagaLab,
)
from app.models.tfd import Paciente

LABS_PADRAO = ["Municipal", "Santa Casa", "Terceirizado"]


def seed_laboratorios(db: Session) -> int:
    total = db.exec(select(func.count(Laboratorio.id))).one() or 0
    if total:
        return 0
    for nome in LABS_PADRAO:
        db.add(Laboratorio(nome=nome, ativo=True))
    db.commit()
    return len(LABS_PADRAO)


def get_lab_or_404(db: Session, laboratorio_id: int) -> Laboratorio:
    lab = db.get(Laboratorio, laboratorio_id)
    if not lab:
        raise HTTPException(404, "Laboratório não encontrado")
    if not lab.ativo:
        raise HTTPException(400, "Laboratório inativo")
    return lab


def vaga_livre(db: Session, laboratorio_id: int, data: date) -> VagaLab:
    if data < date.today():
        raise HTTPException(400, "Dia passado indisponível (sem vagas)")
    vaga = db.exec(
        select(VagaLab).where(
            VagaLab.laboratorio_id == laboratorio_id, VagaLab.data == data
        )
    ).first()
    if not vaga:
        raise HTTPException(400, "Sem vaga cadastrada p/ laboratório+data")
    if vaga.vagas_ocupadas >= vaga.vagas_totais:
        raise HTTPException(400, "Sem vaga livre p/ laboratório+data")
    return vaga


def ocupar_vaga(db: Session, vaga_id: int) -> VagaLab:
    """Abate 1 vaga com proteção contra concorrência.

    UPDATE atômico só sucede se ainda houver livre; rowcount 0 = esgotou.
    """
    from sqlalchemy import text

    res = db.exec(
        text(
            "UPDATE lab_vagas SET vagas_ocupadas = vagas_ocupadas + 1 "
            "WHERE id = :vid AND vagas_ocupadas < vagas_totais"
        ).bindparams(vid=vaga_id)
    )
    rowcount = getattr(res, "rowcount", 1)
    if rowcount == 0:
        raise HTTPException(400, "Sem vaga livre p/ laboratório+data")
    vaga = db.get(VagaLab, vaga_id)
    if not vaga:
        raise HTTPException(400, "Vaga removida durante agendamento")
    return vaga


def criar_solicitacao_mestre(
    db: Session,
    paciente_id: int,
    data_agendada: date,
    laboratorio_id: int,
    sigtap_ids: list[int] | None = None,
    origem_fila_id: int | None = None,
    agendado_por: str = "",
    itens: dict[int, int] | list[dict] | None = None,
) -> SolicitacaoMestre:
    """Cria mestre + itens com quantidade em transação única.

    Política linhas repetidas: mesmo sigtap soma quantidades em linha
    única (ex. [{id:5,qtd:1},{id:5,qtd:2}] vira 1 linha qtd 3, máx 99).
    """
    if not db.get(Paciente, paciente_id):
        raise HTTPException(404, "Paciente não encontrado")
    get_lab_or_404(db, laboratorio_id)

    totais: dict[int, int] = {}
    for sid in sigtap_ids or []:
        totais[sid] = totais.get(sid, 0) + 1
    if isinstance(itens, dict):
        for sid, qtd in itens.items():
            totais[int(sid)] = totais.get(int(sid), 0) + int(qtd)
    elif isinstance(itens, list):
        for row in itens:
            sid = int(row.get("sigtap_id"))
            qtd = int(row.get("quantidade", 1))
            totais[sid] = totais.get(sid, 0) + qtd
    if not totais:
        raise HTTPException(400, "Informe ao menos 1 sigtap_id")
    for sid, qtd in totais.items():
        if qtd < 1 or qtd > 99:
            raise HTTPException(400, f"Quantidade inválida p/ sigtap {sid}: {qtd} (1..99)")
    for sid in totais:
        if not db.get(SigtapProcedimento, sid):
            raise HTTPException(404, f"SIGTAP {sid} não encontrado")

    fila = None
    if origem_fila_id:
        fila = db.get(FilaPsf, origem_fila_id)
        if not fila:
            raise HTTPException(404, "Origem fila não encontrada")
        if fila.status != "na_fila":
            raise HTTPException(400, "Fila já agendada/cancelada")

    vaga = vaga_livre(db, laboratorio_id, data_agendada)

    # Transação única
    try:
        mestre = SolicitacaoMestre(
            paciente_id=paciente_id,
            data_agendada=data_agendada,
            laboratorio_id=laboratorio_id,
            status="agendado",
            agendado_por=agendado_por,
            origem_fila_id=origem_fila_id,
            status_auditoria="pendente_conferencia",
        )
        db.add(mestre)
        db.flush()
        for sid, qtd in sorted(totais.items()):
            db.add(ItemSolic(solicitacao_id=mestre.id, sigtap_id=sid, quantidade=qtd))
        db.flush()
        ocupar_vaga(db, vaga.id)
        if fila:
            fila.status = "agendado"
            db.add(fila)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"Falha ao agendar: {e}")
    db.refresh(mestre)
    return mestre


def enriquecer_mestre(db: Session, m: SolicitacaoMestre) -> dict:
    pac = db.get(Paciente, m.paciente_id)
    lab = db.get(Laboratorio, m.laboratorio_id)
    itens = list(
        db.exec(
            select(ItemSolic).where(ItemSolic.solicitacao_id == m.id)
        ).all()
    )
    itens_out = []
    for it in itens:
        proc = db.get(SigtapProcedimento, it.sigtap_id)
        itens_out.append(
            {
                "id": it.id,
                "solicitacao_id": it.solicitacao_id,
                "sigtap_id": it.sigtap_id,
                "quantidade": it.quantidade or 1,
                "status_auditoria": it.status_auditoria,
                "observacao": it.observacao,
                "procedimento_codigo": proc.codigo if proc else "?",
                "procedimento_descricao": proc.descricao if proc else "?",
            }
        )
    return {
        "id": m.id,
        "paciente_id": m.paciente_id,
        "paciente_nome": pac.nome if pac else "?",
        "data_agendada": m.data_agendada,
        "laboratorio_id": m.laboratorio_id,
        "laboratorio_nome": lab.nome if lab else "?",
        "status": m.status,
        "agendado_por": m.agendado_por,
        "origem_fila_id": m.origem_fila_id,
        "status_auditoria": m.status_auditoria,
        "observacao_laboratorio": m.observacao_laboratorio,
        "itens": itens_out,
    }


def auditar_mestre(
    db: Session,
    mestre_id: int,
    status_auditoria: str,
    observacao: str,
    itens: list[dict],
) -> SolicitacaoMestre:
    if status_auditoria not in STATUS_AUDIT:
        raise HTTPException(400, "status_auditoria inválido")
    m = db.get(SolicitacaoMestre, mestre_id)
    if not m:
        raise HTTPException(404, "Solicitação não encontrada")
    # Valida itens antes de mutar (evita sessão suja em erro parcial)
    validados: list[tuple] = []
    for row in itens or []:
        it = db.get(ItemSolic, row["item_id"])
        if not it or it.solicitacao_id != mestre_id:
            raise HTTPException(404, f"Item {row['item_id']} não encontrado")
        if row["status"] not in STATUS_AUDIT:
            raise HTTPException(400, "status item inválido")
        validados.append((it, row["status"], row.get("obs") or ""))
    try:
        m.status_auditoria = status_auditoria
        m.observacao_laboratorio = observacao or ""
        db.add(m)
        for it, st, obs_txt in validados:
            it.status_auditoria = st
            it.observacao = obs_txt
            db.add(it)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"Falha ao auditar: {e}")
    db.refresh(m)
    return m
