from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlmodel import Session, select

from app.core.deps import get_current_user_senha_ok as get_current_user, get_db
from app.models.lab_exames import LabSolicitacao, SigtapCbo, SigtapProcedimento
from app.models.tfd import Paciente
from app.core.pagination import Pagina, paginar
from app.schemas.lab import (
    FaturarIn,
    LoteOut,
    ResumoLabOut,
    SigtapImportOut,
    SigtapIn,
    SigtapOut,
    SigtapVersaoOut,
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


from app.services.permissoes import need_perm


def _enriquecer(db: Session, obj: LabSolicitacao) -> SolicitacaoOut:
    pac = db.get(Paciente, obj.paciente_id)
    proc = db.get(SigtapProcedimento, obj.sigtap_id)
    return SolicitacaoOut(
        **obj.model_dump(),
        paciente_nome=pac.nome if pac else "?",
        procedimento_codigo=proc.codigo if proc else "?",
        procedimento_descricao=proc.descricao if proc else "?",
    )


def _enriquecer_lote(db: Session, rows: list[LabSolicitacao]) -> list[SolicitacaoOut]:
    if not rows:
        return []
    pac_ids = {o.paciente_id for o in rows if o.paciente_id}
    proc_ids = {o.sigtap_id for o in rows if o.sigtap_id}
    pacs = {p.id: p for p in db.exec(select(Paciente).where(Paciente.id.in_(pac_ids))).all()} if pac_ids else {}
    procs = {p.id: p for p in db.exec(select(SigtapProcedimento).where(SigtapProcedimento.id.in_(proc_ids))).all()} if proc_ids else {}
    return [
        SolicitacaoOut(
            **o.model_dump(),
            paciente_nome=pacs.get(o.paciente_id).nome if pacs.get(o.paciente_id) else "?",
            procedimento_codigo=procs.get(o.sigtap_id).codigo if procs.get(o.sigtap_id) else "?",
            procedimento_descricao=procs.get(o.sigtap_id).descricao if procs.get(o.sigtap_id) else "?",
        )
        for o in rows
    ]


# ---------- Resumo ----------
@router.get("/resumo", response_model=ResumoLabOut)
def resumo(
    competencia: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
    _=Depends(need_perm("lab_faturamento")),
):
    return resumo_lab(db, competencia)


# ---------- SIGTAP ----------
@router.get("/sigtap", response_model=Pagina[SigtapOut])
def listar_sigtap(
    q: str = "",
    instrumento: str | None = Query(default=None, pattern="^(BPA-C|BPA-I|BPA-F)?$"),
    apenas_laboratoriais: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_perm("lab_sigtap")),
):
    from app.models.settings import SystemSettings

    base = select(SigtapProcedimento).order_by(SigtapProcedimento.codigo)
    if instrumento:
        base = base.where(SigtapProcedimento.instrumento == instrumento)

    if apenas_laboratoriais:
        cfg = db.get(SystemSettings, 1)
        raw_habilitados = getattr(cfg, "exames_habilitados_sigtap", "") or ""
        codigos_permitidos = [c.strip() for c in raw_habilitados.split(",") if c.strip()]
        if codigos_permitidos:
            base = base.where(SigtapProcedimento.codigo.in_(codigos_permitidos))
        else:
            base = base.where(SigtapProcedimento.codigo.like("0202%"))

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
    user=Depends(need_perm("lab_sigtap", "criar")),
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


@router.get("/sigtap/cbos")
def listar_cbos_sigtap(
    procedimento_codigo: str = Query(default="", max_length=20),
    q: str = Query(default="", max_length=80),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """CBOs autorizados por procedimento (Tabela Unificada SIGTAP).

    Leitura ampla (qualquer logado) p/ selects de médico/profissional.
    Sem CBO importado p/ o procedimento, cai p/ catálogo local de
    especialidades (tfd_especialidades) como fallback.
    """
    from app.models.tfd import Especialidade as _Esp

    cod = "".join(c for c in (procedimento_codigo or "") if c.isdigit())
    out: list[dict] = []
    if cod:
        for c in db.exec(
            select(SigtapCbo).where(SigtapCbo.procedimento_codigo == cod).order_by(SigtapCbo.cbo)
        ).all():
            out.append({"cbo": c.cbo, "descricao": c.descricao or "", "origem": "sigtap"})
    if not out:
        base = select(_Esp).where(_Esp.ativo == True).order_by(_Esp.nome)  # noqa: E712
        for e in db.exec(base.limit(500)).all():
            out.append({"cbo": e.codigo_cbo, "descricao": e.nome or "", "origem": "catalogo"})
    termo = (q or "").strip().lower()
    if termo:
        out = [c for c in out if termo in (c["cbo"] or "").lower() or termo in (c["descricao"] or "").lower()]
    vistos: set[str] = set()
    unicos: list[dict] = []
    for c in out:
        chave = f"{c['cbo']}|{c['descricao']}"
        if chave in vistos:
            continue
        vistos.add(chave)
        unicos.append(c)
    return unicos[:limit]


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
    _=Depends(need_perm("lab_marcacao")),
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
        "data": _enriquecer_lote(db, list(rows)),
        "total": total,
        "page": meta["page"],
        "pages": meta["pages"],
    }


@router.post("/solicitacoes", response_model=SolicitacaoOut, status_code=201)
def criar_solicitacao(
    data: SolicitacaoIn, db: Session = Depends(get_db), _=Depends(need_perm("lab_marcacao", "criar"))
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
def obter_solicitacao(sid: int, db: Session = Depends(get_db), _=Depends(need_perm("lab_marcacao"))):
    obj = db.get(LabSolicitacao, sid)
    if not obj:
        raise HTTPException(404, "Solicitação não encontrada")
    return _enriquecer(db, obj)


@router.put("/solicitacoes/{sid}", response_model=SolicitacaoOut)
def atualizar_solicitacao(
    sid: int, data: SolicitacaoIn, db: Session = Depends(get_db), _=Depends(need_perm("lab_marcacao", "editar"))
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
def excluir_solicitacao(sid: int, db: Session = Depends(get_db), _=Depends(need_perm("lab_marcacao", "excluir"))):
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
    _=Depends(need_perm("lab_faturamento")),
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
    data: FaturarIn, db: Session = Depends(get_db), _=Depends(need_perm("lab_faturamento", "criar"))
):
    return marcar_faturado(db, data.ids)


@router.get("/lote", response_model=LoteOut)
def ver_lote(
    competencia: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
    _=Depends(need_perm("lab_faturamento")),
):
    itens = lote_bpa(db, competencia)
    return {"competencia": competencia, "total": sum(i["qtd"] for i in itens), "itens": itens}


@router.get("/exportar-lote")
def exportar_lote(
    competencia: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
    _=Depends(need_perm("lab_faturamento")),
):
    csv = lote_csv(db, competencia)
    return Response(
        content=csv,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=lote_bpa_{competencia}.csv"},
    )


# ---------- Exportações XLSX ----------
@router.get("/sigtap/exportar")
def exportar_sigtap(
    q: str = "",
    instrumento: str | None = Query(default=None, pattern="^(BPA-C|BPA-I|BPA-F)?$"),
    db: Session = Depends(get_db),
    ator=Depends(need_perm("lab_sigtap")),
):
    """Tabela SIGTAP em XLSX respeitando busca/instrumento ativos."""
    from app.services.export_xlsx import resposta_xlsx

    import unicodedata

    def norm(s: str) -> str:
        return "".join(
            c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn"
        )

    base = select(SigtapProcedimento).order_by(SigtapProcedimento.codigo)
    if instrumento:
        base = select(SigtapProcedimento).where(
            SigtapProcedimento.instrumento == instrumento
        ).order_by(SigtapProcedimento.codigo)
    rows = list(db.exec(base).all())
    if q.strip():
        termo = norm(q.strip()).upper()
        rows = [r for r in rows if termo in norm(r.codigo).upper() or termo in norm(r.descricao).upper()]
    linhas = [{
        "codigo": r.codigo, "descricao": r.descricao,
        "complexidade": r.complexidade or "", "instrumento": r.instrumento or "",
        "valor_sa": getattr(r, "valor_sa", 0) or 0,
        "valor_sp": getattr(r, "valor_sp", 0) or 0,
        "valor_sh": getattr(r, "valor_sh", 0) or 0,
    } for r in rows[:20000]]
    return resposta_xlsx(
        "Tabela SIGTAP", getattr(ator, "nome", "") or getattr(ator, "username", ""),
        [
            {"chave": "codigo", "rotulo": "Código", "largura": 16},
            {"chave": "descricao", "rotulo": "Descrição", "largura": 52},
            {"chave": "complexidade", "rotulo": "Complexidade", "largura": 14},
            {"chave": "instrumento", "rotulo": "Instrumento", "largura": 14},
            {"chave": "valor_sa", "rotulo": "Valor SA (R$)", "largura": 14, "formato": "moeda"},
            {"chave": "valor_sp", "rotulo": "Valor SP (R$)", "largura": 14, "formato": "moeda"},
            {"chave": "valor_sh", "rotulo": "Valor SH (R$)", "largura": 14, "formato": "moeda"},
        ],
        linhas, "sigtap",
    )


@router.get("/solicitacoes/exportar")
def exportar_solicitacoes(
    status_: str | None = Query(default=None, alias="status"),
    laboratorio: str = "",
    competencia: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
    ator=Depends(need_perm("lab_marcacao")),
):
    """Solicitações lab em XLSX respeitando os filtros ativos."""
    from app.services.export_xlsx import resposta_xlsx

    base = select(LabSolicitacao).order_by(LabSolicitacao.data_solicitacao.desc())
    filtros = []
    if status_:
        filtros.append(LabSolicitacao.status == status_)
    if laboratorio:
        filtros.append(LabSolicitacao.laboratorio.ilike(f"%{laboratorio}%"))
    if competencia:
        filtros.append(LabSolicitacao.competencia == competencia)
    if filtros:
        base = select(LabSolicitacao).where(*filtros).order_by(LabSolicitacao.data_solicitacao.desc())
    linhas = []
    for o in list(db.exec(base).all())[:20000]:
        e = _enriquecer(db, o)
        linhas.append({
            "paciente": e.paciente_nome, "codigo": e.procedimento_codigo,
            "procedimento": e.procedimento_descricao, "data": o.data_solicitacao,
            "laboratorio": o.laboratorio or "", "status": o.status,
            "competencia": o.competencia or "",
        })
    return resposta_xlsx(
        "Solicitações de exames", getattr(ator, "nome", "") or getattr(ator, "username", ""),
        [
            {"chave": "paciente", "rotulo": "Paciente", "largura": 32},
            {"chave": "codigo", "rotulo": "Código SIGTAP", "largura": 16},
            {"chave": "procedimento", "rotulo": "Procedimento", "largura": 44},
            {"chave": "data", "rotulo": "Data", "largura": 14, "formato": "data"},
            {"chave": "laboratorio", "rotulo": "Laboratório", "largura": 24},
            {"chave": "status", "rotulo": "Status", "largura": 14},
            {"chave": "competencia", "rotulo": "Competência", "largura": 12},
        ],
        linhas, "solicitacoes_lab",
    )


# ---------- SIGTAP: importação Tabela Unificada DATASUS ----------
@router.get("/sigtap/versoes", response_model=list[SigtapVersaoOut])
def versoes_sigtap(
    db: Session = Depends(get_db),
    _=Depends(need_perm("lab_sigtap")),
):
    """Histórico de cargas SIGTAP com competência (mês/ano)."""
    from app.models.lab_exames import SigtapVersao

    rows = list(db.exec(select(SigtapVersao).order_by(SigtapVersao.id.desc()).limit(60)).all())
    out = []
    for v in rows:
        d = v.model_dump()
        try:
            d["criado_em"] = v.criado_em.strftime("%d/%m/%Y %H:%M") if v.criado_em else ""
        except Exception:
            d["criado_em"] = ""
        out.append(SigtapVersaoOut(**d))
    return out


@router.get("/sigtap/modelo")
def modelo_sigtap():
    """Modelo CSV de carga (layout esperado)."""
    from fastapi import Response

    csv_text = (
        "CO_PROCEDIMENTO;NO_PROCEDIMENTO;TP_COMPLEXIDADE;TP_SEXO;VL_IDADE_MIN;VL_IDADE_MAX;"
        "QT_MAXIMA;VL_PONTOS;VL_SA;VL_SP;VL_SH;TP_INSTRUMENTO\n"
        "0202010473;DOSAGEM DE GLICOSE;AB;B;0;130;99;0;1,85;0,00;0,00;BPA-C\n"
        "0404010011;TRAQUEOSTOMIA;AC;B;0;130;1;0;0,00;150,00;200,00;AIH\n"
    )
    return Response(
        content=csv_text.encode("utf-8-sig"),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="modelo_sigtap.csv"'},
    )


@router.post("/sigtap/importar", response_model=SigtapImportOut)
def importar_sigtap(
    file: UploadFile = File(...),
    competencia: str = Query(pattern=r"^\d{4}-\d{2}$"),
    simular: bool = Query(default=True),
    db: Session = Depends(get_db),
    ator=Depends(need_perm("lab_sigtap", "criar")),
):
    """Carga mensal SIGTAP (.zip oficial ou .txt/.csv). Simula antes de aplicar."""
    from app.services.sigtap_import import importar_sigtap as _importar

    nome = (file.filename or "arquivo").lower()
    if not nome.endswith((".zip", ".txt", ".csv", ".dat")):
        raise HTTPException(400, "Envie .zip, .txt ou .csv do layout SIGTAP")
    raw = file.file.read()
    if not raw:
        raise HTTPException(400, "Arquivo vazio")
    if len(raw) > 60 * 1024 * 1024:
        raise HTTPException(400, "Arquivo acima de 60MB")
    stats = _importar(db, [(file.filename or "arquivo", raw)], competencia,
                      getattr(ator, "nome", "") or getattr(ator, "username", ""), simular)
    return SigtapImportOut(**stats)
