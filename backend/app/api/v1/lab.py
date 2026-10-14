from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlmodel import Session, select

from app.core.deps import get_current_user_senha_ok as get_current_user, get_db
from app.models.lab_exames import LabSolicitacao, SigtapProcedimento
from app.models.tfd import Paciente
from app.core.pagination import Pagina, paginar
from app.schemas.lab import (
    FaturarIn,
    LoteOut,
    ResumoLabOut,
    SigtapIn,
    SigtapOut,
    SolicitacaoIn,
    SolicitacaoOut,
)
from app.services.lab import (
    competencia_of,
    lote_bpa,
    lote_csv,
    marcar_faturado,
    prontos_faturar,
    resumo_lab,
)

router = APIRouter()


def need_tela(tela: str = "lab"):
    from app.models.user import User

    def check(user: User = Depends(get_current_user)) -> User:
        telas = [t.strip() for t in (user.telas or "").split(",") if t.strip()]
        if not user.is_superuser and tela not in telas:
            raise HTTPException(status_code=403, detail="Sem acesso ao Lab")
        return user

    return check


def _enriquecer(db: Session, obj: LabSolicitacao) -> SolicitacaoOut:
    pac = db.get(Paciente, obj.paciente_id)
    proc = db.get(SigtapProcedimento, obj.sigtap_id)
    return SolicitacaoOut(
        **obj.model_dump(),
        paciente_nome=pac.nome if pac else "?",
        procedimento_codigo=proc.codigo if proc else "?",
        procedimento_descricao=proc.descricao if proc else "?",
    )


# ---------- Resumo ----------
@router.get("/resumo", response_model=ResumoLabOut)
def resumo(
    competencia: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    return resumo_lab(db, competencia)


# ---------- SIGTAP ----------
@router.get("/sigtap", response_model=Pagina[SigtapOut])
def listar_sigtap(
    q: str = "",
    instrumento: str | None = Query(default=None, pattern="^(BPA-C|BPA-I|BPA-F)$"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    from sqlmodel import func as sm_func
    base = select(SigtapProcedimento).order_by(SigtapProcedimento.codigo)
    if instrumento:
        base = select(SigtapProcedimento).where(
            SigtapProcedimento.instrumento == instrumento
        ).order_by(SigtapProcedimento.codigo)
    rows = list(db.exec(base).all())
    if q.strip():
        # Busca tolerante: remove acentos + espaços p/ "hemogra" achar HEMOGRAMA
        import unicodedata

        def norm(s: str) -> str:
            return "".join(
                c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
            )

        termo = norm(q.strip()).upper()
        rows = [
            r
            for r in rows
            if termo in norm(r.codigo).upper()
            or termo in norm(r.descricao).upper()
        ]
    total = len(rows)
    meta = paginar(total, page, limit)
    return {
        "data": rows[meta["offset"]:meta["offset"] + limit],
        "total": total,
        "page": meta["page"],
        "pages": meta["pages"],
    }


@router.post("/sigtap", response_model=SigtapOut, status_code=201)
def criar_sigtap(
    data: SigtapIn,
    db: Session = Depends(get_db),
    user=Depends(need_tela()),
):
    if not user.is_superuser and "lab" not in (user.telas or "").split(","):
        raise HTTPException(status_code=403, detail="Sem acesso ao Lab")
    codigo = data.codigo.strip()
    if db.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == codigo)).first():
        raise HTTPException(400, "Código SIGTAP já cadastrado")
    obj = SigtapProcedimento(
        **{**data.model_dump(), "codigo": codigo, "descricao": data.descricao.strip().upper()}
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


# ---------- Solicitações ----------
@router.get("/solicitacoes", response_model=Pagina[SolicitacaoOut])
def listar_solicitacoes(
    status_: str | None = Query(default=None, alias="status"),
    laboratorio: str = "",
    de: date | None = None,
    ate: date | None = None,
    competencia: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    from sqlmodel import func as sm_func
    base = select(LabSolicitacao).order_by(LabSolicitacao.data_solicitacao.desc())
    filtros = []
    if status_:
        filtros.append(LabSolicitacao.status == status_)
    if laboratorio:
        filtros.append(LabSolicitacao.laboratorio.ilike(f"%{laboratorio}%"))
    if de:
        filtros.append(LabSolicitacao.data_solicitacao >= de)
    if ate:
        filtros.append(LabSolicitacao.data_solicitacao <= ate)
    if competencia:
        filtros.append(LabSolicitacao.competencia == competencia)
    if filtros:
        base = (
            select(LabSolicitacao)
            .where(*filtros)
            .order_by(LabSolicitacao.data_solicitacao.desc())
        )
    total = db.exec(select(sm_func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = db.exec(base.offset(meta["offset"]).limit(limit)).all()
    return {
        "data": [_enriquecer(db, o) for o in rows],
        "total": total,
        "page": meta["page"],
        "pages": meta["pages"],
    }


@router.post("/solicitacoes", response_model=SolicitacaoOut, status_code=201)
def criar_solicitacao(
    data: SolicitacaoIn, db: Session = Depends(get_db), _=Depends(need_tela())
):
    if not db.get(Paciente, data.paciente_id):
        raise HTTPException(404, "Paciente não encontrado")
    if not db.get(SigtapProcedimento, data.sigtap_id):
        raise HTTPException(404, "Procedimento SIGTAP não encontrado")
    payload = data.model_dump()
    if not payload["competencia"]:
        payload["competencia"] = competencia_of(data.data_solicitacao)
    obj = LabSolicitacao(**payload)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _enriquecer(db, obj)


@router.get("/solicitacoes/{sid}", response_model=SolicitacaoOut)
def obter_solicitacao(sid: int, db: Session = Depends(get_db), _=Depends(need_tela())):
    obj = db.get(LabSolicitacao, sid)
    if not obj:
        raise HTTPException(404, "Solicitação não encontrada")
    return _enriquecer(db, obj)


@router.put("/solicitacoes/{sid}", response_model=SolicitacaoOut)
def atualizar_solicitacao(
    sid: int, data: SolicitacaoIn, db: Session = Depends(get_db), _=Depends(need_tela())
):
    obj = db.get(LabSolicitacao, sid)
    if not obj:
        raise HTTPException(404, "Solicitação não encontrada")
    if not db.get(Paciente, data.paciente_id):
        raise HTTPException(404, "Paciente não encontrado")
    if not db.get(SigtapProcedimento, data.sigtap_id):
        raise HTTPException(404, "Procedimento SIGTAP não encontrado")
    payload = data.model_dump()
    if not payload["competencia"]:
        payload["competencia"] = competencia_of(data.data_solicitacao)
    for k, v in payload.items():
        setattr(obj, k, v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _enriquecer(db, obj)


@router.delete("/solicitacoes/{sid}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_solicitacao(sid: int, db: Session = Depends(get_db), _=Depends(need_tela())):
    obj = db.get(LabSolicitacao, sid)
    if not obj:
        raise HTTPException(404, "Solicitação não encontrada")
    db.delete(obj)
    db.commit()


# ---------- Faturamento BPA ----------
@router.get("/prontos-faturar", response_model=Pagina[SolicitacaoOut])
def listar_prontos(
    competencia: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    from app.core.pagination import paginar as _paginar
    todos = prontos_faturar(db, competencia)
    total = len(todos)
    meta = _paginar(total, page, limit)
    fatia = todos[meta["offset"]:meta["offset"] + limit]
    return {
        "data": [_enriquecer(db, o) for o in fatia],
        "total": total,
        "page": meta["page"],
        "pages": meta["pages"],
    }


@router.post("/marcar-faturado")
def marcar(
    data: FaturarIn, db: Session = Depends(get_db), _=Depends(need_tela())
):
    return marcar_faturado(db, data.ids)


@router.get("/lote", response_model=LoteOut)
def ver_lote(
    competencia: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    itens = lote_bpa(db, competencia)
    return {"competencia": competencia, "total": sum(i["qtd"] for i in itens), "itens": itens}


@router.get("/exportar-lote")
def exportar_lote(
    competencia: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    csv = lote_csv(db, competencia)
    return Response(
        content=csv,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=lote_bpa_{competencia}.csv"},
    )
