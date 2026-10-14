from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, func, select

from app.core.deps import get_current_user_senha_ok as get_current_user, get_db
from app.models.lab_fase6 import FilaPsf, Laboratorio, SolicitacaoMestre, VagaLab
from app.models.tfd import Paciente
from app.core.pagination import Pagina, paginar
from app.schemas.lab_fase6 import (
    AuditoriaIn,
    FilaPsfIn,
    FilaPsfOut,
    FilaPsfStatusIn,
    LaboratorioOut,
    SolicMestreIn,
    SolicMestreOut,
    VagaIn,
    VagaLoteMesIn,
    VagaLoteMesOut,
    VagaOut,
)
from app.services.lab_fase6 import (
    auditar_mestre,
    criar_solicitacao_mestre,
    enriquecer_mestre,
)

router = APIRouter()


def _telas(user) -> list[str]:
    return [t.strip() for t in (user.telas or "").split(",") if t.strip()]


def need_tela(tela: str):
    from app.models.user import User

    def check(user: User = Depends(get_current_user)) -> User:
        if not user.is_superuser and tela not in _telas(user):
            raise HTTPException(status_code=403, detail=f"Sem acesso a {tela}")
        return user

    return check


def need_any_tela(*telas: str):
    from app.models.user import User

    def check(user: User = Depends(get_current_user)) -> User:
        if user.is_superuser:
            return user
        proprias = _telas(user)
        if not any(t in proprias for t in telas):
            raise HTTPException(status_code=403, detail="Sem acesso")
        return user

    return check


# ---------- Laboratórios (leitura p/ agenda) ----------
@router.get("/exames/laboratorios", response_model=list[LaboratorioOut])
def listar_labs(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return list(db.exec(select(Laboratorio).order_by(Laboratorio.nome)).all())


# ---------- Vagas grade mensal p/ agenda ----------
@router.get("/vagas/grade")
def grade_vagas(
    month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    laboratorio_id: int | None = None,
    laboratorio: str | None = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    from calendar import monthrange

    if laboratorio and not laboratorio_id:
        lab_obj = db.exec(select(Laboratorio).where(Laboratorio.nome == laboratorio)).first()
        if lab_obj:
            laboratorio_id = lab_obj.id
    y, m = map(int, month.split("-"))
    _, ndays = monthrange(y, m)
    de = date(y, m, 1)
    ate = date(y, m, ndays)
    filtros = [VagaLab.data >= de, VagaLab.data <= ate]
    if laboratorio_id:
        filtros.append(VagaLab.laboratorio_id == laboratorio_id)
    vagas = db.exec(select(VagaLab).where(*filtros)).all()
    labs = {l.id: l.nome for l in db.exec(select(Laboratorio)).all()}
    return [
        {
            "data": v.data.isoformat(),
            "laboratorio_id": v.laboratorio_id,
            "laboratorio_nome": labs.get(v.laboratorio_id, "?"),
            "laboratorio": labs.get(v.laboratorio_id, "?"),
            "total": v.vagas_totais,
            "ocupadas": v.vagas_ocupadas,
            "livres": max(0, v.vagas_totais - v.vagas_ocupadas),
        }
        for v in vagas
    ]


# ---------- Vagas CRUD admin ----------
@router.get("/vagas", response_model=Pagina[VagaOut])
def listar_vagas(
    de: date | None = None,
    ate: date | None = None,
    laboratorio_id: int | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_tela("lab_vagas")),
):
    filtros = []
    if de:
        filtros.append(VagaLab.data >= de)
    if ate:
        filtros.append(VagaLab.data <= ate)
    if laboratorio_id:
        filtros.append(VagaLab.laboratorio_id == laboratorio_id)
    base = select(VagaLab).order_by(VagaLab.data)
    if filtros:
        base = select(VagaLab).where(*filtros).order_by(VagaLab.data)
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    out = []
    for v in db.exec(base.offset(meta["offset"]).limit(limit)).all():
        lab = db.get(Laboratorio, v.laboratorio_id)
        out.append(
            VagaOut(
                **v.model_dump(),
                vagas_livres=max(0, v.vagas_totais - v.vagas_ocupadas),
                laboratorio_nome=lab.nome if lab else "?",
            )
        )
    return {"data": out, "total": total, "page": meta["page"], "pages": meta["pages"]}


@router.post("/vagas", response_model=VagaOut, status_code=201)
def criar_vaga(
    data: VagaIn, db: Session = Depends(get_db), _=Depends(need_tela("lab_vagas"))
):
    if data.data < date.today():
        raise HTTPException(400, "Dia passado indisponível (sem vagas)")
    lab = db.get(Laboratorio, data.laboratorio_id)
    if not lab:
        raise HTTPException(404, "Laboratório não encontrado")
    dup = db.exec(
        select(VagaLab).where(
            VagaLab.laboratorio_id == data.laboratorio_id, VagaLab.data == data.data
        )
    ).first()
    if dup:
        raise HTTPException(400, "Vaga já existe p/ laboratório+data")
    obj = VagaLab(**data.model_dump(), vagas_ocupadas=0)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return VagaOut(
        **obj.model_dump(),
        vagas_livres=obj.vagas_totais,
        laboratorio_nome=lab.nome,
    )


@router.post("/vagas/lote-mes", response_model=VagaLoteMesOut, status_code=201)
def liberar_mes(
    data: VagaLoteMesIn,
    db: Session = Depends(get_db),
    _=Depends(need_tela("lab_vagas")),
):
    from calendar import monthrange

    lab = db.get(Laboratorio, data.laboratorio_id)
    if not lab:
        raise HTTPException(404, "Laboratório não encontrado")
    _, ndays = monthrange(data.ano, data.mes)
    hoje = date.today()
    criadas = atualizadas = ignoradas = mantidas = ignoradas_passado = 0
    dias_alvo = 0
    for dia in range(1, ndays + 1):
        d = date(data.ano, data.mes, dia)
        if d < hoje:
            ignoradas_passado += 1
            continue
        if data.ignorar_fins_semana and d.weekday() >= 5:
            ignoradas += 1
            continue
        dias_alvo += 1
        ex = db.exec(
            select(VagaLab).where(
                VagaLab.laboratorio_id == data.laboratorio_id, VagaLab.data == d
            )
        ).first()
        if ex:
            if data.vagas_diarias < ex.vagas_ocupadas:
                mantidas += 1
                continue
            if ex.vagas_totais != data.vagas_diarias:
                ex.vagas_totais = data.vagas_diarias
                db.add(ex)
                atualizadas += 1
            continue
        db.add(
            VagaLab(
                laboratorio_id=data.laboratorio_id,
                data=d,
                vagas_totais=data.vagas_diarias,
                vagas_ocupadas=0,
            )
        )
        criadas += 1
    db.commit()
    return VagaLoteMesOut(
        laboratorio_id=data.laboratorio_id,
        laboratorio_nome=lab.nome,
        mes_ref=f"{data.ano}-{data.mes:02d}",
        dias_alvo=dias_alvo,
        criadas=criadas,
        atualizadas=atualizadas,
        ignoradas_fim_semana=ignoradas,
        mantidas_conflito=mantidas,
        ignoradas_passado=ignoradas_passado,
    )


@router.put("/vagas/{vid}", response_model=VagaOut)
def atualizar_vaga(
    vid: int, data: VagaIn, db: Session = Depends(get_db), _=Depends(need_tela("lab_vagas"))
):
    obj = db.get(VagaLab, vid)
    if not obj:
        raise HTTPException(404, "Vaga não encontrada")
    if data.data < date.today() or obj.data < date.today():
        raise HTTPException(400, "Dia passado indisponível (sem vagas)")
    if data.vagas_totais < obj.vagas_ocupadas:
        raise HTTPException(400, "vagas_totais menor que vagas_ocupadas")
    if not db.get(Laboratorio, data.laboratorio_id):
        raise HTTPException(404, "Laboratório não encontrado")
    dup = db.exec(
        select(VagaLab).where(
            VagaLab.laboratorio_id == data.laboratorio_id,
            VagaLab.data == data.data,
            VagaLab.id != vid,
        )
    ).first()
    if dup:
        raise HTTPException(400, "Vaga já existe p/ laboratório+data")
    obj.laboratorio_id = data.laboratorio_id
    obj.data = data.data
    obj.vagas_totais = data.vagas_totais
    db.add(obj)
    db.commit()
    db.refresh(obj)
    lab = db.get(Laboratorio, obj.laboratorio_id)
    return VagaOut(
        **obj.model_dump(),
        vagas_livres=max(0, obj.vagas_totais - obj.vagas_ocupadas),
        laboratorio_nome=lab.nome if lab else "?",
    )


@router.delete("/vagas/{vid}", status_code=204)
def excluir_vaga(vid: int, db: Session = Depends(get_db), _=Depends(need_tela("lab_vagas"))):
    obj = db.get(VagaLab, vid)
    if not obj:
        raise HTTPException(404, "Vaga não encontrada")
    if obj.vagas_ocupadas > 0:
        raise HTTPException(400, "Vaga com agendamentos não pode ser excluída")
    db.delete(obj)
    db.commit()


# ---------- Fila PSF ----------
@router.get("/exames/fila-psf", response_model=Pagina[FilaPsfOut])
def listar_fila(
    status_: str | None = Query(default=None, alias="status"),
    unidade: str = "",
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_any_tela("lab_fila", "lab_agenda")),
):
    filtros = []
    if status_:
        filtros.append(FilaPsf.status == status_)
    if unidade:
        filtros.append(FilaPsf.unidade_psf.ilike(f"%{unidade}%"))
    base = select(FilaPsf).order_by(FilaPsf.data_solicitacao.desc())
    if filtros:
        base = (
            select(FilaPsf)
            .where(*filtros)
            .order_by(FilaPsf.data_solicitacao.desc())
        )
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    out = []
    for o in db.exec(base.offset(meta["offset"]).limit(limit)).all():
        pac = db.get(Paciente, o.paciente_id)
        out.append(
            FilaPsfOut(
                **o.model_dump(), paciente_nome=pac.nome if pac else "?"
            )
        )
    return {"data": out, "total": total, "page": meta["page"], "pages": meta["pages"]}


@router.post("/exames/fila-psf", response_model=FilaPsfOut, status_code=201)
def criar_fila(
    data: FilaPsfIn, db: Session = Depends(get_db), _=Depends(need_tela("lab_fila"))
):
    if not db.get(Paciente, data.paciente_id):
        raise HTTPException(404, "Paciente não encontrado")
    obj = FilaPsf(**data.model_dump(), status="na_fila")
    db.add(obj)
    db.commit()
    db.refresh(obj)
    pac = db.get(Paciente, obj.paciente_id)
    return FilaPsfOut(**obj.model_dump(), paciente_nome=pac.nome if pac else "?")


@router.patch("/exames/fila-psf/{fid}", response_model=FilaPsfOut)
def atualizar_status_fila(
    fid: int,
    data: FilaPsfStatusIn,
    db: Session = Depends(get_db),
    _=Depends(need_any_tela("lab_fila", "lab_agenda")),
):
    obj = db.get(FilaPsf, fid)
    if not obj:
        raise HTTPException(404, "Fila não encontrada")
    if obj.status != "na_fila" and data.status == "na_fila":
        raise HTTPException(400, "Fila já processada não volta p/ espera")
    if data.status == "agendado":
        raise HTTPException(400, "Use a agenda p/ agendar a fila")
    obj.status = data.status
    db.add(obj)
    db.commit()
    db.refresh(obj)
    pac = db.get(Paciente, obj.paciente_id)
    return FilaPsfOut(**obj.model_dump(), paciente_nome=pac.nome if pac else "?")


@router.delete("/exames/fila-psf/{fid}", status_code=204)
def excluir_fila(
    fid: int, db: Session = Depends(get_db), _=Depends(need_tela("lab_fila"))
):
    obj = db.get(FilaPsf, fid)
    if not obj:
        raise HTTPException(404, "Fila não encontrada")
    if obj.status != "na_fila":
        raise HTTPException(400, "Só fila em espera pode ser removida")
    db.delete(obj)
    db.commit()


# ---------- Solicitações mestre + detalhe ----------
@router.get("/exames/solicitacoes", response_model=Pagina[SolicMestreOut])
def listar_mestre(
    status_auditoria: str | None = None,
    laboratorio_id: int | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_tela("lab_agenda")),
):
    filtros = []
    if status_auditoria:
        filtros.append(SolicitacaoMestre.status_auditoria == status_auditoria)
    if laboratorio_id:
        filtros.append(SolicitacaoMestre.laboratorio_id == laboratorio_id)
    base = select(SolicitacaoMestre).order_by(SolicitacaoMestre.data_agendada.desc())
    if filtros:
        base = (
            select(SolicitacaoMestre)
            .where(*filtros)
            .order_by(SolicitacaoMestre.data_agendada.desc())
        )
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = db.exec(base.offset(meta["offset"]).limit(limit)).all()
    return {
        "data": [enriquecer_mestre(db, m) for m in rows],
        "total": total,
        "page": meta["page"],
        "pages": meta["pages"],
    }


@router.post("/exames/solicitacoes", response_model=SolicMestreOut, status_code=201)
def criar_mestre(
    data: SolicMestreIn,
    db: Session = Depends(get_db),
    user=Depends(need_tela("lab_agenda")),
):
    try:
        totais = data.itens_normalizados()
    except ValueError as e:
        raise HTTPException(400, str(e))
    m = criar_solicitacao_mestre(
        db,
        paciente_id=data.paciente_id,
        data_agendada=data.data_agendada,
        laboratorio_id=data.laboratorio_id,
        sigtap_ids=None,
        origem_fila_id=data.origem_fila_id,
        agendado_por=user.username,
        itens=totais,
    )
    return enriquecer_mestre(db, m)


@router.get("/exames/solicitacoes/{mid}", response_model=SolicMestreOut)
def obter_mestre(
    mid: int, db: Session = Depends(get_db), _=Depends(need_tela("lab_agenda"))
):
    m = db.get(SolicitacaoMestre, mid)
    if not m:
        raise HTTPException(404, "Solicitação não encontrada")
    return enriquecer_mestre(db, m)


# ---------- Auditoria ----------
@router.get("/exames/auditoria", response_model=Pagina[SolicMestreOut])
def listar_auditoria(
    status_auditoria: str | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_tela("lab_audit")),
):
    base = select(SolicitacaoMestre).order_by(SolicitacaoMestre.data_agendada.desc())
    if status_auditoria:
        base = (
            select(SolicitacaoMestre)
            .where(SolicitacaoMestre.status_auditoria == status_auditoria)
            .order_by(SolicitacaoMestre.data_agendada.desc())
        )
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = db.exec(base.offset(meta["offset"]).limit(limit)).all()
    return {
        "data": [enriquecer_mestre(db, m) for m in rows],
        "total": total,
        "page": meta["page"],
        "pages": meta["pages"],
    }


@router.put("/exames/auditoria/{mid}", response_model=SolicMestreOut)
def auditar(
    mid: int,
    data: AuditoriaIn,
    db: Session = Depends(get_db),
    _=Depends(need_tela("lab_audit")),
):
    m = auditar_mestre(
        db,
        mestre_id=mid,
        status_auditoria=data.status_auditoria,
        observacao=data.observacao,
        itens=[{"item_id": i.item_id, "status": i.status, "obs": i.obs} for i in data.itens],
    )
    return enriquecer_mestre(db, m)


@router.post("/exames/auditoria/{mid}/solicitar-autorizacao", response_model=SolicMestreOut)
def solicitar_autorizacao(
    mid: int, db: Session = Depends(get_db), _=Depends(need_tela("lab_audit"))
):
    m = db.get(SolicitacaoMestre, mid)
    if not m:
        raise HTTPException(404, "Solicitação não encontrada")
    m.status_auditoria = "aguardando_autorizacao_sec"
    db.add(m)
    db.commit()
    db.refresh(m)
    return enriquecer_mestre(db, m)
