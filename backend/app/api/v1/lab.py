from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.core.deps import get_current_user_senha_ok as get_current_user, get_db
from app.models.lab_exames import (
    LabSolicitacao,
    SigtapCbo,
    SigtapOcupacao,
    SigtapProcedimento,
)
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
from app.schemas.lab_fase6 import (
    LabAprovarFaturamentoIn,
    LabContratoIn,
    LabContratoOut,
    LabContratoPrecoCustomizadoIn,
    LabContratoPrecoCustomizadoOut,
    LabContratoUpdateIn,
    LabContratosPainelOut,
    LabFaturamentoRelatorioPrestadorOut,
    LabFPOCompetenciaIn,
    LabFPOCompetenciaOut,
    LabFPOItemIn,
    LabFPOItemOut,
    LabLoteConsolidarIn,
    LabLoteOut,
    LabLotePreviaIn,
    LabLotePreviaOut,
    LabOrcamentoIn,
    LabOrcamentoOut,
    PacienteGastosGeraisItemOut,
    PacienteGastosResumoOut,
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


from app.services.permissoes import need_any_perm, need_perm


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
def _sigtap_para_out(r: SigtapProcedimento) -> SigtapOut:
    from app.services.sigtap_hierarquia import decompor_codigo_sigtap

    d = r.model_dump()
    if not d.get("grupo_codigo") or not d.get("subgrupo_codigo") or not d.get("grupo_nome"):
        info = decompor_codigo_sigtap(r.codigo)
        d["grupo_codigo"] = d.get("grupo_codigo") or info["grupo_codigo"]
        d["grupo_nome"] = d.get("grupo_nome") or info["grupo_nome"]
        d["subgrupo_codigo"] = d.get("subgrupo_codigo") or info["subgrupo_codigo"]
        d["subgrupo_nome"] = d.get("subgrupo_nome") or info["subgrupo_nome"]
        d["forma_organizacao_codigo"] = d.get("forma_organizacao_codigo") or info["forma_organizacao"]
    return SigtapOut(**d)


@router.get("/sigtap/arvore")
def arvore_sigtap(
    grupo_codigo: str = Query(default="", max_length=2),
    subgrupo_codigo: str = Query(default="", max_length=4),
    cbo: str = Query(default="", max_length=10),
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_sigtap", "lab_fila", "lab_marcacao", "lab", "tfd_exames", "tfd_fila_lancamento", "tfd", "tfd_catalogo")),
):
    """Retorna a árvore hierárquica completa do SIGTAP dividida por Área (Grupo), Subgrupo e CBO."""
    from app.services.sigtap_hierarquia import obter_arvore_sigtap

    return obter_arvore_sigtap(
        db,
        grupo_codigo=grupo_codigo if isinstance(grupo_codigo, str) else "",
        subgrupo_codigo=subgrupo_codigo if isinstance(subgrupo_codigo, str) else "",
        cbo=cbo if isinstance(cbo, str) else "",
    )


@router.get("/sigtap", response_model=Pagina[SigtapOut])
def listar_sigtap(
    q: str = "",
    instrumento: str | None = Query(default=None, pattern="^(BPA-C|BPA-I|BPA-F|AIH|APAC|RAAS)?$"),
    apenas_laboratoriais: bool = Query(default=False),
    tipo_fila: str = Query(default=""),
    grupo_codigo: str = Query(default="", max_length=2),
    subgrupo_codigo: str = Query(default="", max_length=4),
    cbo: str = Query(default="", max_length=10),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=100000),
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_sigtap", "lab_fila", "lab_marcacao", "lab", "tfd_exames", "tfd_fila_lancamento", "tfd", "tfd_catalogo", "cfg_exames", "cfg_geral")),
):
    from app.models.settings import SystemSettings
    from app.services.cbo_normalizacao import limpar_codigo_cbo

    p_q = q if isinstance(q, str) else ""
    p_inst = instrumento if isinstance(instrumento, str) and instrumento else None
    p_apenas_lab = apenas_laboratoriais if isinstance(apenas_laboratoriais, bool) else False
    p_tipo_fila = (tipo_fila if isinstance(tipo_fila, str) else "").strip()
    p_page = page if isinstance(page, int) and page > 0 else 1
    p_limit = limit if isinstance(limit, int) and limit > 0 else 100

    base = select(SigtapProcedimento).order_by(SigtapProcedimento.codigo)
    if p_inst:
        base = base.where(SigtapProcedimento.instrumento == p_inst)

    g_limpo = (grupo_codigo if isinstance(grupo_codigo, str) else "").strip()[:2]
    sg_limpo = (subgrupo_codigo if isinstance(subgrupo_codigo, str) else "").strip()[:4]
    cbo_limpo = limpar_codigo_cbo(cbo if isinstance(cbo, str) else "")
    if sg_limpo:
        base = base.where(
            (SigtapProcedimento.subgrupo_codigo == sg_limpo)
            | (SigtapProcedimento.codigo.like(f"{sg_limpo}%"))
        )
    elif g_limpo:
        base = base.where(
            (SigtapProcedimento.grupo_codigo == g_limpo)
            | (SigtapProcedimento.codigo.like(f"{g_limpo}%"))
        )

    if cbo_limpo:
        cods_cbo = list({
            c.procedimento_codigo
            for c in db.exec(select(SigtapCbo).where(SigtapCbo.cbo == cbo_limpo)).all()
            if c.procedimento_codigo
        })
        if not cods_cbo:
            return {"data": [], "total": 0, "page": 1, "pages": 1}
        base = base.where(SigtapProcedimento.codigo.in_(cods_cbo))

    if p_tipo_fila or p_apenas_lab:
        cfg = db.get(SystemSettings, 1)
        codigos_filtrados = None

        if p_tipo_fila and cfg:
            import json
            raw_por_fila = getattr(cfg, "exames_por_tipo_fila_json", "{}") or "{}"
            try:
                mapa_filas = json.loads(raw_por_fila)
                if isinstance(mapa_filas, dict):
                    tf_upper = p_tipo_fila.upper()
                    for k, cods in mapa_filas.items():
                        if k.upper() == tf_upper or tf_upper in k.upper() or k.upper() in tf_upper:
                            if cods and isinstance(cods, list):
                                codigos_filtrados = [c.strip() for c in cods if c.strip()]
                                break
            except Exception:
                pass

        if codigos_filtrados is not None:
            if codigos_filtrados:
                base = base.where(SigtapProcedimento.codigo.in_(codigos_filtrados))
            else:
                base = base.where(SigtapProcedimento.codigo.like("0202%"))
        elif p_apenas_lab:
            raw_habilitados = getattr(cfg, "exames_habilitados_sigtap", "") or ""
            codigos_permitidos = [c.strip() for c in raw_habilitados.split(",") if c.strip()]
            if codigos_permitidos:
                base = base.where(SigtapProcedimento.codigo.in_(codigos_permitidos))
            else:
                base = base.where(SigtapProcedimento.codigo.like("0202%"))

    rows = list(db.exec(base).all())
    if p_q.strip():
        # Busca tolerante: remove acentos + espaços p/ "hemogra" achar HEMOGRAMA
        import unicodedata

        def norm(s: str) -> str:
            return "".join(
                c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
            )

        termo = norm(p_q.strip()).upper()
        rows = [
            r
            for r in rows
            if termo in norm(r.codigo).upper()
            or termo in norm(r.descricao).upper()
        ]
    total = len(rows)
    meta = paginar(total, p_page, p_limit)
    fatia = rows[meta["offset"]:meta["offset"] + p_limit]
    return {
        "data": [_sigtap_para_out(r) for r in fatia],
        "total": total,
        "page": meta["page"],
        "pages": meta["pages"],
    }


@router.post("/sigtap", response_model=SigtapOut, status_code=201)
def criar_sigtap(
    data: SigtapIn,
    db: Session = Depends(get_db),
    user=Depends(need_any_perm("lab_sigtap", "cfg_exames", "usuarios", "tfd_catalogo", acoes=("criar",))),
):
    sem_cod = bool(data.sem_codigo_especifico)
    codigo = data.codigo.strip()
    cod_fat = (data.codigo_faturamento_sigtap or "").strip().replace(" ", "")

    if sem_cod:
        if not codigo:
            # Gerar código sequencial interno com prefixo 99
            registros = db.exec(
                select(SigtapProcedimento.codigo)
                .where(SigtapProcedimento.codigo.like("99%"))
            ).all()
            seq_max = 0
            for r in registros:
                if len(r) == 10 and r[2:].isdigit():
                    val = int(r[2:])
                    if val > seq_max:
                        seq_max = val
            codigo = f"99{seq_max + 1:08d}"
        if cod_fat:
            cod_fat_limpo = "".join(filter(str.isdigit, cod_fat))
            if len(cod_fat_limpo) == 10:
                cod_fat = cod_fat_limpo
            proc_fat = db.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == cod_fat)).first()
            if proc_fat:
                if not data.valor_sa and not data.valor_sp and not data.valor_sh:
                    data.valor_sa = proc_fat.valor_sa
                    data.valor_sp = proc_fat.valor_sp
                    data.valor_sh = proc_fat.valor_sh
                if not data.complexidade:
                    data.complexidade = proc_fat.complexidade
                if not data.instrumento:
                    data.instrumento = proc_fat.instrumento
    else:
        cod_limpo = "".join(filter(str.isdigit, codigo))
        if len(cod_limpo) != 10:
            raise HTTPException(400, "O código SIGTAP padrão deve conter exatamente 10 dígitos numéricos.")
        codigo = cod_limpo

    if db.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == codigo)).first():
        raise HTTPException(400, f"Código SIGTAP ou identificador '{codigo}' já cadastrado.")

    ref_codigo = cod_fat or codigo
    dump = data.model_dump()
    dump["codigo"] = codigo
    dump["descricao"] = data.descricao.strip().upper()
    dump["sem_codigo_especifico"] = sem_cod
    dump["codigo_faturamento_sigtap"] = cod_fat
    dump["origem_manual"] = True
    dump["grupo_codigo"] = ref_codigo[:2] if len(ref_codigo) >= 2 else "99"
    dump["subgrupo_codigo"] = ref_codigo[:4] if len(ref_codigo) >= 4 else "9999"
    dump["forma_organizacao_codigo"] = ref_codigo[:6] if len(ref_codigo) >= 6 else "999999"
    dump["competencia"] = date.today().strftime("%Y-%m")
    obj = SigtapProcedimento(**dump)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/sigtap/{sid}", response_model=SigtapOut)
def atualizar_sigtap(
    sid: int,
    data: SigtapIn,
    db: Session = Depends(get_db),
    user=Depends(need_any_perm("lab_sigtap", "cfg_exames", "usuarios", "tfd_catalogo", acoes=("editar",))),
):
    obj = db.get(SigtapProcedimento, sid)
    if not obj:
        raise HTTPException(404, "Procedimento SIGTAP não encontrado.")

    sem_cod = bool(data.sem_codigo_especifico)
    codigo = (data.codigo or "").strip()
    cod_fat = (data.codigo_faturamento_sigtap or "").strip().replace(" ", "")

    if sem_cod:
        if not codigo:
            codigo = obj.codigo
        if cod_fat:
            cod_fat_limpo = "".join(filter(str.isdigit, cod_fat))
            if len(cod_fat_limpo) != 10:
                raise HTTPException(400, "O código SIGTAP para faturamento deve conter exatamente 10 dígitos numéricos.")
            cod_fat = cod_fat_limpo
            proc_fat = db.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == cod_fat)).first()
            if proc_fat:
                if not data.valor_sa and not data.valor_sp and not data.valor_sh:
                    data.valor_sa = proc_fat.valor_sa
                    data.valor_sp = proc_fat.valor_sp
                    data.valor_sh = proc_fat.valor_sh
                if not data.complexidade:
                    data.complexidade = proc_fat.complexidade
                if not data.instrumento:
                    data.instrumento = proc_fat.instrumento
    else:
        cod_limpo = "".join(filter(str.isdigit, codigo))
        if len(cod_limpo) != 10:
            raise HTTPException(400, "O código SIGTAP padrão deve conter exatamente 10 dígitos numéricos.")
        if cod_limpo.startswith("99999"):
            raise HTTPException(400, "Informe um código SIGTAP oficial de 10 dígitos ou marque 'sem código específico' e vincule o código SIGTAP oficial.")
        codigo = cod_limpo

    if codigo != obj.codigo:
        existente = db.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == codigo, SigtapProcedimento.id != sid)).first()
        if existente:
            raise HTTPException(400, f"Já existe outro procedimento com o código '{codigo}'.")

    ref_codigo = cod_fat or codigo
    obj.codigo = codigo
    obj.descricao = data.descricao.strip().upper()
    obj.complexidade = data.complexidade
    obj.instrumento = data.instrumento
    obj.valor_sa = data.valor_sa
    obj.valor_sp = data.valor_sp
    obj.valor_sh = data.valor_sh
    obj.valor_combinado = data.valor_combinado
    obj.tipos_fila_permitidos = data.tipos_fila_permitidos
    obj.sexo = data.sexo
    obj.sem_codigo_especifico = sem_cod
    obj.codigo_faturamento_sigtap = cod_fat
    obj.grupo_codigo = ref_codigo[:2] if len(ref_codigo) >= 2 else (obj.grupo_codigo or "99")
    obj.subgrupo_codigo = ref_codigo[:4] if len(ref_codigo) >= 4 else (obj.subgrupo_codigo or "9999")
    obj.forma_organizacao_codigo = ref_codigo[:6] if len(ref_codigo) >= 6 else (obj.forma_organizacao_codigo or "999999")

    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _sigtap_para_out(obj)


@router.get("/sigtap/cbos")
def listar_cbos_sigtap(
    procedimento_codigo: str = Query(default="", max_length=20),
    grupo_codigo: str = Query(default="", max_length=2),
    subgrupo_codigo: str = Query(default="", max_length=4),
    q: str = Query(default="", max_length=80),
    limit: int = Query(default=1000, ge=1, le=10000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """CBOs autorizados por procedimento (Tabela Unificada SIGTAP) e busca unificada sem duplicatas."""
    from app.models.tfd import Especialidade as _Esp
    from app.api.v1.tfd import MAPA_ESPECIALIDADES_CANONICAS
    from app.services.cbo_normalizacao import limpar_codigo_cbo, sanitizar_texto_cbo, comparar_nomes_cbo

    cod = "".join(c for c in (procedimento_codigo if isinstance(procedimento_codigo, str) else "") if c.isdigit())
    g_cod = (grupo_codigo if isinstance(grupo_codigo, str) else "").strip()[:2]
    sg_cod = (subgrupo_codigo if isinstance(subgrupo_codigo, str) else "").strip()[:4]
    termo_raw = (q if isinstance(q, str) else "").strip()
    p_limit = limit if isinstance(limit, int) and limit > 0 else 1000
    termo = sanitizar_texto_cbo(termo_raw)
    out: list[dict] = []

    def _deduplicar_cbos(itens: list[dict]) -> list[dict]:
        por_cbo: dict[str, dict] = {}
        for item in itens:
            cbo_norm = limpar_codigo_cbo(item.get("cbo")) or (item.get("cbo") or "").strip()
            if not cbo_norm:
                continue
            desc_atual = (item.get("descricao") or "").strip()
            if cbo_norm not in por_cbo:
                por_cbo[cbo_norm] = {"cbo": cbo_norm, "descricao": desc_atual, "origem": item.get("origem", "sigtap")}
            else:
                if len(desc_atual) > len(por_cbo[cbo_norm]["descricao"]) and not desc_atual.startswith("CBO "):
                    por_cbo[cbo_norm]["descricao"] = desc_atual
        return list(por_cbo.values())[:p_limit]

    if cod:
        # Quando um procedimento é informado, traz estritamente os CBOs autorizados para ele no SIGTAP
        for c in db.exec(
            select(SigtapCbo).where(SigtapCbo.procedimento_codigo == cod).order_by(SigtapCbo.cbo)
        ).all():
            out.append({"cbo": c.cbo, "descricao": c.descricao or "", "origem": "sigtap"})

        if out:
            if termo:
                out = [
                    c for c in out
                    if termo in sanitizar_texto_cbo(c["cbo"])
                    or termo in sanitizar_texto_cbo(c["descricao"])
                    or comparar_nomes_cbo(termo_raw, c["descricao"]) >= 0.85
                ]
            return _deduplicar_cbos(out)

    # Filtro opcional por Área / Subgrupo SIGTAP quando nenhum procedimento específico foi passado
    if not cod and (sg_cod or g_cod):
        pref = sg_cod or g_cod
        procs_esc = list(
            db.exec(
                select(SigtapProcedimento.codigo).where(
                    (SigtapProcedimento.subgrupo_codigo == sg_cod)
                    if sg_cod
                    else (SigtapProcedimento.grupo_codigo == g_cod)
                )
            ).all()
        )
        if not procs_esc:
            procs_esc = list(
                db.exec(select(SigtapProcedimento.codigo).where(SigtapProcedimento.codigo.like(f"{pref}%"))).all()
            )
        if procs_esc:
            for ini in range(0, len(procs_esc), 400):
                bloco = procs_esc[ini : ini + 400]
                for sc in db.exec(select(SigtapCbo).where(SigtapCbo.procedimento_codigo.in_(bloco))).all():
                    out.append({"cbo": sc.cbo, "descricao": sc.descricao or "", "origem": "sigtap"})

    if not out and not cod:
        # Busca universal em TODOS os CBOs do SIGTAP e ocupações normalizadas
        for oc in db.exec(select(SigtapOcupacao).where(SigtapOcupacao.ativo == True).limit(p_limit)).all():  # noqa: E712
            out.append({"cbo": oc.cbo, "descricao": oc.descricao or "", "origem": "sigtap"})

        sigtap_query = select(SigtapCbo.cbo, SigtapCbo.descricao).distinct()
        for cbo, desc in db.exec(sigtap_query.limit(p_limit)).all():
            out.append({"cbo": cbo, "descricao": desc or "", "origem": "sigtap"})

    # Incluir especialidades locais cadastradas e mapa canônico para cobertura completa
    for e in db.exec(select(_Esp).where(_Esp.ativo == True).limit(500)).all():  # noqa: E712
        out.append({"cbo": e.codigo_cbo, "descricao": e.nome or "", "origem": "catalogo"})

    for _, cbo_canon, nome_canon in MAPA_ESPECIALIDADES_CANONICAS:
        out.append({"cbo": cbo_canon, "descricao": nome_canon, "origem": "canonico"})

    if termo and out:
        out = [
            c for c in out
            if termo in sanitizar_texto_cbo(c["cbo"])
            or termo in sanitizar_texto_cbo(c["descricao"])
            or comparar_nomes_cbo(termo_raw, c["descricao"]) >= 0.85
        ]

    return _deduplicar_cbos(out)


# ---------- Solicitações ----------
@router.get("/solicitacoes", response_model=Pagina[SolicitacaoOut])
def listar_solicitacoes(
    status_: str | None = Query(default=None, alias="status"),
    laboratorio: str = "",
    de: date | None = None,
    ate: date | None = None,
    competencia: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=100000),
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
    limit: int = Query(default=100, ge=1, le=100000),
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
    instrumento: str | None = Query(default=None, pattern="^(BPA-C|BPA-I|BPA-F|AIH|APAC|RAAS)?$"),
    grupo_codigo: str = Query(default="", max_length=2),
    subgrupo_codigo: str = Query(default="", max_length=4),
    cbo: str = Query(default="", max_length=10),
    db: Session = Depends(get_db),
    ator=Depends(need_perm("lab_sigtap")),
):
    """Tabela SIGTAP em XLSX respeitando busca/instrumento/área/subgrupo/CBO ativos."""
    from app.services.export_xlsx import resposta_xlsx
    from app.services.cbo_normalizacao import limpar_codigo_cbo

    import unicodedata

    def norm(s: str) -> str:
        return "".join(
            c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn"
        )

    base = select(SigtapProcedimento).order_by(SigtapProcedimento.codigo)
    if instrumento:
        base = base.where(SigtapProcedimento.instrumento == instrumento)
    sg_limpo = (subgrupo_codigo or "").strip()[:4]
    g_limpo = (grupo_codigo or "").strip()[:2]
    cbo_limpo = limpar_codigo_cbo(cbo)
    if sg_limpo:
        base = base.where((SigtapProcedimento.subgrupo_codigo == sg_limpo) | (SigtapProcedimento.codigo.like(f"{sg_limpo}%")))
    elif g_limpo:
        base = base.where((SigtapProcedimento.grupo_codigo == g_limpo) | (SigtapProcedimento.codigo.like(f"{g_limpo}%")))
    if cbo_limpo:
        cods_cbo = list({c.procedimento_codigo for c in db.exec(select(SigtapCbo).where(SigtapCbo.cbo == cbo_limpo)).all() if c.procedimento_codigo})
        base = base.where(SigtapProcedimento.codigo.in_(cods_cbo)) if cods_cbo else base.where(SigtapProcedimento.id == -1)
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
    _=Depends(need_any_perm("lab_sigtap", "lab_fila", "lab_marcacao", "lab", "tfd_exames", "tfd_fila_lancamento", "tfd", "tfd_catalogo", "cfg_exames", "cfg_geral")),
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
    ator=Depends(need_any_perm("lab_sigtap", "tfd_catalogo", "usuarios", "cfg_geral", "tfd")),
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


@router.post("/sigtap/buscar-automatico", response_model=SigtapImportOut)
def buscar_sigtap_automatico(
    competencia: str = Query(pattern=r"^\d{4}-\d{2}$"),
    simular: bool = Query(default=True),
    db: Session = Depends(get_db),
    ator=Depends(need_any_perm("lab_sigtap", "tfd_catalogo", "usuarios", "cfg_geral", "tfd")),
):
    """Tenta baixar automaticamente o arquivo mensal da Tabela Unificada do portal DATASUS/SIGTAP.

    Caso o serviço do DATASUS esteja indisponível/desativado no momento do disparo,
    retorna exceção amigável e informativa orientando o uso do upload manual como fallback.
    Fonte oficial: http://sigtap.datasus.gov.br/tabela-unificada/app/download.jsp
    """
    from app.services.sigtap_import import importar_sigtap as _importar
    from app.services.sigtap_sync import baixar_tabela_unificada_datasus

    pacote = baixar_tabela_unificada_datasus(competencia=competencia, timeout=5)
    if not pacote:
        raise HTTPException(
            status_code=503,
            detail=(
                "O serviço de download automático do portal DATASUS/SIGTAP está temporariamente "
                "indisponível ou inacessível no momento. Por favor, acesse a fonte oficial do DATASUS "
                "(http://sigtap.datasus.gov.br/tabela-unificada/app/download.jsp), baixe o arquivo mensal "
                "compactado (.zip) da Tabela Unificada e utilize a importação manual de arquivo logo abaixo."
            ),
        )

    comp_encontrada, nome_arq, raw_bytes = pacote
    stats = _importar(
        db,
        [(nome_arq, raw_bytes)],
        comp_encontrada or competencia,
        getattr(ator, "nome", "") or getattr(ator, "username", ""),
        simular,
        origem="datasus_auto" if not simular else "simulacao",
    )
    return SigtapImportOut(**stats)


class SigtapAutoSyncConfigIn(BaseModel):
    sigtap_sync_automatica: bool | None = None
    sigtap_sync_intervalo_horas: int | None = Field(default=None, ge=1, le=720)


@router.get("/sigtap/auto-sync")
def status_auto_sync_sigtap(
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_sigtap", "tfd_catalogo", "usuarios", "cfg_geral", "tfd")),
):
    """Status e agendamento da rotina periódica de atualização automática do SIGTAP/DATASUS."""
    from app.models.integracoes import IntegrationSettings
    from app.services.sigtap_sync import is_sigtap_sync_running

    cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
    if not cfg:
        cfg = IntegrationSettings(id=1)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return {
        "sigtap_sync_automatica": bool(getattr(cfg, "sigtap_sync_automatica", True)),
        "sigtap_sync_intervalo_horas": int(getattr(cfg, "sigtap_sync_intervalo_horas", 24) or 24),
        "sigtap_sync_ultima_execucao": (
            cfg.sigtap_sync_ultima_execucao.isoformat()
            if getattr(cfg, "sigtap_sync_ultima_execucao", None)
            else None
        ),
        "sigtap_sync_ultimo_status": getattr(cfg, "sigtap_sync_ultimo_status", "") or "",
        "sigtap_sync_ultima_competencia": getattr(cfg, "sigtap_sync_ultima_competencia", "") or "",
        "sigtap_sync_ultimo_erro": getattr(cfg, "sigtap_sync_ultimo_erro", "") or "",
        "em_execucao": is_sigtap_sync_running(),
    }


@router.put("/sigtap/auto-sync")
def atualizar_config_auto_sync_sigtap(
    data: SigtapAutoSyncConfigIn,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_sigtap", "tfd_catalogo", "usuarios", "cfg_geral", "tfd", acoes=("editar",))),
):
    """Atualiza periodicidade e ativação do serviço agendado SIGTAP/DATASUS."""
    from app.models.integracoes import IntegrationSettings

    cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
    if not cfg:
        cfg = IntegrationSettings(id=1)
    if data.sigtap_sync_automatica is not None:
        cfg.sigtap_sync_automatica = data.sigtap_sync_automatica
    if data.sigtap_sync_intervalo_horas is not None:
        cfg.sigtap_sync_intervalo_horas = data.sigtap_sync_intervalo_horas
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return {"ok": True, "sigtap_sync_automatica": cfg.sigtap_sync_automatica, "sigtap_sync_intervalo_horas": cfg.sigtap_sync_intervalo_horas}


@router.post("/sigtap/auto-sync/executar")
def executar_auto_sync_sigtap_agora(
    competencia: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    forcar: bool = Query(default=False),
    sincronizar_sia: bool = Query(default=True),
    db: Session = Depends(get_db),
    ator=Depends(need_any_perm("lab_sigtap", "tfd_catalogo", "usuarios", "cfg_geral", "tfd")),
):
    """Dispara verificação/importação imediata do portal DATASUS/SIGTAP e Tabela SIA."""
    from app.services.sigtap_sync import executar_sync_automatica_sigtap

    nome_op = getattr(ator, "nome", "") or getattr(ator, "username", "") or "Operador"
    res_sigtap = executar_sync_automatica_sigtap(db, competencia=competencia, usuario=nome_op, forcar=forcar)

    if sincronizar_sia:
        from app.services.sia_sync import executar_sync_automatica_sia
        res_sia = executar_sync_automatica_sia(db, competencia=competencia, usuario=nome_op, forcar=forcar)
        res_sigtap["sia_resultado"] = res_sia
        if res_sigtap.get("ok") and res_sia.get("ok"):
            res_sigtap["mensagem"] = (
                f"{res_sigtap.get('mensagem', 'SIGTAP atualizado.')} "
                f"Tabela SIA (FTP DATASUS): {res_sia.get('mensagem', res_sia.get('status', 'OK'))}"
            )
        elif not res_sigtap.get("ok") and res_sia.get("ok"):
            res_sigtap["ok"] = True
            res_sigtap["status"] = "SUCESSO_PARCIAL"
            res_sigtap["mensagem"] = (
                f"Tabela SIA importada com sucesso via FTP oficial do DATASUS ({res_sia.get('competencia')}). "
                f"Aviso SIGTAP: {res_sigtap.get('mensagem')}"
            )
            res_sigtap["inseridos"] = res_sia.get("inseridos", 0)
            res_sigtap["atualizados"] = res_sia.get("atualizados", 0)

    return res_sigtap


class SiaAutoSyncConfigIn(BaseModel):
    sia_sync_automatica: bool | None = None


@router.get("/sia/auto-sync")
def status_auto_sync_sia(
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_sigtap", "tfd_catalogo", "usuarios", "cfg_geral", "tfd")),
):
    """Status e agendamento da rotina periódica da Tabela SIA (DATASUS FTP)."""
    from app.models.integracoes import IntegrationSettings
    from app.services.sia_sync import is_sia_sync_running

    cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
    if not cfg:
        cfg = IntegrationSettings(id=1)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return {
        "sia_sync_automatica": bool(getattr(cfg, "sia_sync_automatica", True)),
        "sia_sync_ultima_execucao": (
            cfg.sia_sync_ultima_execucao.isoformat()
            if getattr(cfg, "sia_sync_ultima_execucao", None)
            else None
        ),
        "sia_sync_ultimo_status": getattr(cfg, "sia_sync_ultimo_status", "") or "",
        "sia_sync_ultima_competencia": getattr(cfg, "sia_sync_ultima_competencia", "") or "",
        "sia_sync_ultimo_erro": getattr(cfg, "sia_sync_ultimo_erro", "") or "",
        "em_execucao": is_sia_sync_running(),
    }


@router.put("/sia/auto-sync")
def atualizar_config_auto_sync_sia(
    data: SiaAutoSyncConfigIn,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_sigtap", "tfd_catalogo", "usuarios", "cfg_geral", "tfd", acoes=("editar",))),
):
    """Atualiza ativação da rotina periódica da Tabela SIA (DATASUS FTP)."""
    from app.models.integracoes import IntegrationSettings

    cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
    if not cfg:
        cfg = IntegrationSettings(id=1)
    if data.sia_sync_automatica is not None:
        cfg.sia_sync_automatica = data.sia_sync_automatica
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return {"ok": True, "sia_sync_automatica": cfg.sia_sync_automatica}


@router.post("/sia/auto-sync/executar")
def executar_auto_sync_sia_agora(
    competencia: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    forcar: bool = Query(default=False),
    db: Session = Depends(get_db),
    ator=Depends(need_any_perm("lab_sigtap", "tfd_catalogo", "usuarios", "cfg_geral", "tfd")),
):
    """Dispara verificação e importação imediata da Tabela SIA (FTP DATASUS: ftp://ftp.datasus.gov.br/siasus/SIA/)."""
    from app.services.sia_sync import executar_sync_automatica_sia

    nome_op = getattr(ator, "nome", "") or getattr(ator, "username", "") or "Operador"
    return executar_sync_automatica_sia(db, competencia=competencia, usuario=nome_op, forcar=forcar)


# ==============================================================================
# ORÇAMENTO E LANÇAMENTO EM LOTE DE EXAMES (MOTOR ATÔMICO)
# ==============================================================================

@router.get("/orcamentos", response_model=list[LabOrcamentoOut])
def api_listar_orcamentos(
    ano: int | None = Query(default=None, ge=2020, le=2100),
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "lab_marcacao", "lab", "usuarios")),
):
    """Lista todos os tetos orçamentários mensais cadastrados."""
    from app.services.lab_lote_service import listar_orcamentos

    return listar_orcamentos(db, ano=ano)


@router.get("/orcamentos/{competencia}", response_model=LabOrcamentoOut)
def api_obter_orcamento(
    competencia: str,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "lab_marcacao", "lab", "usuarios")),
):
    """Retorna o orçamento mensal e saldo disponível para uma competência (AAAA-MM)."""
    from app.services.lab_lote_service import obter_orcamento_competencia

    orc = obter_orcamento_competencia(db, competencia)
    if not orc:
        raise HTTPException(404, f"Nenhum orçamento definido para a competência {competencia}.")
    return orc


@router.post("/orcamentos", response_model=LabOrcamentoOut, status_code=201)
def api_definir_orcamento(
    dados: LabOrcamentoIn,
    db: Session = Depends(get_db),
    ator=Depends(need_any_perm("lab_orcamento", "lab_marcacao", "lab", "usuarios", acoes=("criar", "editar"))),
):
    """Define ou atualiza o teto financeiro mensal para exames laboratoriais."""
    from app.services.lab_lote_service import definir_orcamento_mensal

    usuario_nome = getattr(ator, "nome", "") or getattr(ator, "username", "") or "Secretaria de Saúde"
    return definir_orcamento_mensal(db, dados, usuario_nome=usuario_nome)


@router.post("/lotes/previa", response_model=LabLotePreviaOut)
def api_calcular_previa_lote(
    dados: LabLotePreviaIn,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "lab_marcacao", "lab", "usuarios")),
):
    """Calcula a prévia da liberação em lote (seleção da fila + cálculo SIGTAP + cruzamento com vagas)."""
    from app.services.lab_lote_service import calcular_previa_lote

    return calcular_previa_lote(db, dados)


@router.post("/lotes/consolidar", response_model=LabLoteOut, status_code=201)
def api_consolidar_lote(
    dados: LabLoteConsolidarIn,
    db: Session = Depends(get_db),
    ator=Depends(need_any_perm("lab_orcamento", "lab_marcacao", "lab", "usuarios", acoes=("criar",))),
):
    """Executa a liberação atômica com lock pessimista, gerando agendamentos e artefatos."""
    from app.services.lab_lote_service import consolidar_lote_atomico, obter_lote_detalhe

    usuario_nome = getattr(ator, "nome", "") or getattr(ator, "username", "") or "Operador Lab"
    lote = consolidar_lote_atomico(db, dados, usuario_nome=usuario_nome)
    return obter_lote_detalhe(db, lote.id or 0)


@router.get("/lotes", response_model=list[LabLoteOut])
def api_listar_lotes(
    competencia: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    laboratorio_id: int | None = None,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "lab_marcacao", "lab", "usuarios")),
):
    """Lista o histórico de lotes liberados."""
    from app.services.lab_lote_service import listar_lotes_liberacao

    return listar_lotes_liberacao(db, competencia=competencia, laboratorio_id=laboratorio_id)


@router.get("/lotes/{lote_id}", response_model=LabLoteOut)
def api_obter_lote(
    lote_id: int,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "lab_marcacao", "lab", "usuarios")),
):
    """Retorna os detalhes de um lote específico com os exames e pacientes contemplados."""
    from app.services.lab_lote_service import obter_lote_detalhe

    return obter_lote_detalhe(db, lote_id)


@router.get("/lotes/{lote_id}/artefatos/{tipo}")
def api_baixar_artefato_lote(
    lote_id: int,
    tipo: str,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "lab_marcacao", "lab", "usuarios")),
):
    """Faz download do artefato gerado para o lote (comprovantes_zip ou relatorio_xlsx)."""
    from app.services.lab_lote_service import obter_artefato_lote

    conteudo, nome_arquivo, mime_type = obter_artefato_lote(db, lote_id, tipo)
    return Response(
        content=conteudo,
        media_type=mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{nome_arquivo}"',
            "Cache-Control": "no-store",
        },
    )


# ============================================================================
# SUBAGENTE 3: CONTRATOS, PREÇOS CUSTOMIZADOS, FATURAMENTO & FPO/SIA
# ============================================================================

@router.get("/contratos", response_model=LabContratosPainelOut)
def api_listar_contratos_painel(
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "lab_marcacao", "lab", "usuarios")),
):
    """Painel gerencial de contratos por prestador com métricas de consumo mensal e limites globais."""
    from app.services.lab_contratos_service import listar_contratos_painel

    return listar_contratos_painel(db)


@router.post("/contratos", response_model=LabContratoOut, status_code=201)
def api_criar_contrato(
    dados: LabContratoIn,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "usuarios", acoes=("criar",))),
):
    """Cadastra um novo contrato com metas financeiras e cotas mensais."""
    from app.services.lab_contratos_service import criar_contrato

    return criar_contrato(db, dados)


@router.get("/contratos/{contrato_id}", response_model=LabContratoOut)
def api_obter_contrato(
    contrato_id: int,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "lab_marcacao", "lab", "usuarios")),
):
    """Detalhes de um contrato específico com métricas calculadas."""
    from app.models.lab_fase6 import LabContrato
    from app.services.lab_contratos_service import calcular_metricas_contrato

    contrato = db.get(LabContrato, contrato_id)
    if not contrato:
        raise HTTPException(404, "Contrato não encontrado.")
    return calcular_metricas_contrato(db, contrato)


@router.put("/contratos/{contrato_id}", response_model=LabContratoOut)
def api_atualizar_contrato(
    contrato_id: int,
    dados: LabContratoUpdateIn,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "usuarios", acoes=("editar",))),
):
    """Atualiza termos, valores e status de um contrato."""
    from app.services.lab_contratos_service import atualizar_contrato

    return atualizar_contrato(db, contrato_id, dados)


@router.get("/contratos/{contrato_id}/precos", response_model=list[LabContratoPrecoCustomizadoOut])
def api_listar_precos_contrato(
    contrato_id: int,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "lab_marcacao", "lab", "usuarios")),
):
    """Lista os preços de procedimentos customizados que sobrepõem a tabela SIGTAP padrão."""
    from app.services.lab_contratos_service import listar_precos_contrato

    return listar_precos_contrato(db, contrato_id)


@router.post("/contratos/{contrato_id}/precos", response_model=LabContratoPrecoCustomizadoOut, status_code=201)
def api_definir_preco_contrato(
    contrato_id: int,
    dados: LabContratoPrecoCustomizadoIn,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "usuarios", acoes=("criar", "editar"))),
):
    """Cadastra ou atualiza o valor negociado de um procedimento para o contrato."""
    from app.services.lab_contratos_service import definir_preco_customizado

    if dados.contrato_id != contrato_id:
        dados.contrato_id = contrato_id
    return definir_preco_customizado(db, contrato_id, dados)


@router.delete("/contratos/{contrato_id}/precos/{preco_id}", status_code=204)
def api_remover_preco_contrato(
    contrato_id: int,
    preco_id: int,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "usuarios", acoes=("excluir",))),
):
    """Remove a personalização de preço de um procedimento (retorna ao SIGTAP oficial)."""
    from app.services.lab_contratos_service import remover_preco_customizado

    remover_preco_customizado(db, contrato_id, preco_id)
    return None


@router.get("/faturamento/relatorio-prestador", response_model=LabFaturamentoRelatorioPrestadorOut)
def api_relatorio_faturamento_prestador(
    laboratorio_id: int,
    competencia: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    visao: str = Query("concluidos", pattern=r"^(concluidos|projetado)$"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Emite o espelho de faturamento e produção mensal do prestador.
    
    Perfil laboratorial restrito só acessa seu próprio laboratório e somente se liberado pela Secretaria.
    Permite alternar entre visão de faturamento final (concluídos) e faturamento projetado (total agendado).
    """
    from app.services.lab_faturamento_service import obter_relatorio_prestador

    eh_perfil_lab = False
    if not bool(getattr(user, "is_superuser", False)):
        lab_vinculado = getattr(user, "laboratorio_id", None)
        if lab_vinculado:
            eh_perfil_lab = True
            laboratorio_id = lab_vinculado

    return obter_relatorio_prestador(
        db,
        laboratorio_id=laboratorio_id,
        competencia=competencia,
        eh_perfil_laboratorio=eh_perfil_lab,
        visao=visao,
    )


@router.post("/faturamento/aprovar", response_model=dict)
def api_aprovar_faturamento_secretaria(
    dados: LabAprovarFaturamentoIn,
    db: Session = Depends(get_db),
    ator=Depends(need_any_perm("lab_orcamento", "usuarios", acoes=("editar", "criar"))),
):
    """Aprovação formal e liberação da produção para visualização do prestador."""
    from app.services.lab_faturamento_service import aprovar_faturamento_secretaria

    usuario_nome = getattr(ator, "nome", "") or getattr(ator, "username", "") or "Secretaria de Saúde"
    fech = aprovar_faturamento_secretaria(db, dados.laboratorio_id, dados.competencia, dados, usuario_nome=usuario_nome)
    return {
        "ok": True,
        "status": fech.status,
        "liberado_visualizacao_lab": fech.liberado_visualizacao_lab,
        "aprovado_por": fech.aprovado_por,
        "parecer": fech.parecer_secretaria,
    }


@router.get("/fpo/competencias", response_model=list[LabFPOCompetenciaOut])
def api_listar_fpo_competencias(
    competencia: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    laboratorio_id: int | None = None,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "lab_marcacao", "lab", "usuarios")),
):
    """Lista as Fichas de Programação Orçamentária (FPO) cadastradas."""
    from app.models.lab_fase6 import LabFPOCompetencia
    from app.services.lab_faturamento_service import formatar_fpo_out

    stmt = select(LabFPOCompetencia)
    if competencia:
        stmt = stmt.where(LabFPOCompetencia.competencia == competencia)
    if laboratorio_id:
        stmt = stmt.where(LabFPOCompetencia.laboratorio_id == laboratorio_id)
    stmt = stmt.order_by(LabFPOCompetencia.competencia.desc(), LabFPOCompetencia.id.desc())

    fpos = list(db.exec(stmt).all())
    return [formatar_fpo_out(db, f) for f in fpos]


@router.post("/fpo/competencias", response_model=LabFPOCompetenciaOut, status_code=201)
def api_criar_fpo_competencia(
    dados: LabFPOCompetenciaIn,
    db: Session = Depends(get_db),
    ator=Depends(need_any_perm("lab_orcamento", "usuarios", acoes=("criar",))),
):
    """Cria ou atualiza a parametrização inicial da FPO para o prestador."""
    from app.services.lab_faturamento_service import criar_ou_obter_fpo

    usuario_nome = getattr(ator, "nome", "") or getattr(ator, "username", "") or "Gestor SUS"
    return criar_ou_obter_fpo(db, dados, usuario_nome=usuario_nome)


@router.post("/fpo/itens", response_model=LabFPOItemOut, status_code=201)
def api_adicionar_item_fpo(
    dados: LabFPOItemIn,
    fpo_id: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "usuarios", acoes=("criar", "editar"))),
):
    """Adiciona uma cota orçada de procedimento à FPO."""
    from app.services.lab_faturamento_service import adicionar_item_fpo

    return adicionar_item_fpo(db, fpo_id, dados)


@router.get("/fpo/exportar-sia/{fpo_id}")
def api_exportar_fpo_sia(
    fpo_id: int,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "lab", "usuarios")),
):
    """Gera e exporta o arquivo de programação físico-orçamentária no layout do SIA/SUS."""
    from app.services.lab_faturamento_service import exportar_fpo_sia

    res = exportar_fpo_sia(db, fpo_id)
    conteudo = res["conteudo_txt"]
    nome_arquivo = res["nome_arquivo"]
    return Response(
        content=conteudo,
        media_type="text/plain; charset=iso-8859-1",
        headers={
            "Content-Disposition": f'attachment; filename="{nome_arquivo}"',
            "Cache-Control": "no-store",
        },
    )


# ============================================================================
# SUBAGENTE 4: BI E AUDITORIA DE GASTOS POR PACIENTE
# ============================================================================

@router.get("/bi/gastos-pacientes", response_model=list[PacienteGastosGeraisItemOut])
def api_ranking_gastos_pacientes(
    q: str = "",
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "lab_marcacao", "lab", "usuarios")),
):
    """Retorna o ranking de recursos municipais investidos em exames por cidadão."""
    from app.services.lab_bi_service import listar_ranking_gastos_pacientes

    offset = (page - 1) * limit
    return listar_ranking_gastos_pacientes(db, q=q, limit=limit, offset=offset)


@router.get("/bi/pacientes/{paciente_id}/gastos", response_model=PacienteGastosResumoOut)
def api_obter_gastos_paciente(
    paciente_id: int,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_orcamento", "lab_marcacao", "lab", "usuarios")),
):
    """Retorna o extrato detalhado de todos os exames realizados e valores despendidos para um paciente."""
    from app.services.lab_bi_service import obter_gastos_paciente

    return obter_gastos_paciente(db, paciente_id)



