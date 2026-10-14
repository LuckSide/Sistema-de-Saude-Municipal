from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, func, select

from app.core.deps import get_current_user_senha_ok as get_current_user, get_db
from app.models.tfd import (
    Destino,
    Especialidade,
    ExameFila,
    Faturamento,
    Paciente,
    ProcedimentoCatalogo,
    TipoFila,
    Veiculo,
    Viagem,
    ViagemPaciente,
)
from app.core.pagination import Pagina, paginar
from app.schemas.tfd import (
    DestinoIn,
    DestinoOut,
    EspecialidadeIn,
    EspecialidadeOut,
    ExameIn,
    ExameLoteIn,
    ExameLoteOut,
    ExameOut,
    ExamePublicoOut,
    FaturaIn,
    FaturaOut,
    FiltrosOpcoesOut,
    OpcaoFiltro,
    PacienteIn,
    PacienteOut,
    ProcedimentoIn,
    ProcedimentoOut,
    ResumoOut,
    TipoFilaIn,
    TipoFilaOut,
    VeiculoIn,
    VeiculoOut,
    ViagemIn,
    ViagemOut,
    ViagemPacienteIn,
    ViagemPacienteOut,
)
from app.services.tfd import hoje_str, resumo_tfd

router = APIRouter()


def need_tela(tela: str = "tfd"):
    from app.models.user import User

    def check(user: User = Depends(get_current_user)) -> User:
        if not user.is_superuser and tela not in (user.telas or "").split(","):
            raise HTTPException(status_code=403, detail="Sem acesso ao TFD")
        return user

    return check


# ---------- Resumo ----------
@router.get("/resumo", response_model=ResumoOut)
def resumo(
    competencia: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    return resumo_tfd(db, competencia or hoje_str())


# ---------- Pacientes ----------
@router.get("/pacientes", response_model=Pagina[PacienteOut])
def listar_pacientes(
    q: str = "",
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    base = select(Paciente).order_by(Paciente.nome)
    if q:
        like = f"%{q}%"
        base = select(Paciente).where(
            (Paciente.nome.ilike(like)) | (Paciente.cpf.ilike(like))
        ).order_by(Paciente.nome)
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = db.exec(base.offset(meta["offset"]).limit(limit)).all()
    return {"data": rows, "total": total, "page": meta["page"], "pages": meta["pages"]}


@router.get("/pacientes/buscar")
def buscar_pacientes_pec(
    termo: str = Query(min_length=2, max_length=80),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    """Busca paciente local + DW PEC e-SUS (nome/CNS/CPF/prontuário).

    Fonte PEC readonly; fallback local quando DW indisponível. Sem PII
    além do necessário p/ autocomplete (nome, CNS, CPF, prontuário).
    """
    like = f"%{termo}%"
    locais = db.exec(
        select(Paciente)
        .where(
            (Paciente.nome.ilike(like))
            | (Paciente.cpf.ilike(like))
            | (Paciente.cns.ilike(like))
        )
        .order_by(Paciente.nome)
        .limit(15)
    ).all()
    out = [
        {
            "id": p.id, "origem": "local", "nome": p.nome,
            "cns": p.cns, "cpf": p.cpf, "prontuario": "",
            "nascimento": p.nascimento.isoformat() if p.nascimento else None,
        }
        for p in locais
    ]
    try:
        from sqlalchemy import text

        from app.services.pec import _pg

        conn, _ = _pg()
        if conn is not None:
            try:
                rows = conn.execute(
                    text("""
                        SELECT nome, cns, cpf, prontuario, ubs_cnes
                        FROM pec_pacientes
                        WHERE nome ILIKE :like OR cns ILIKE :like
                           OR cpf ILIKE :like OR prontuario ILIKE :like
                        ORDER BY nome LIMIT 15
                    """),
                    {"like": like},
                ).all()
                for r in rows:
                    if any(o.get("cns") == r[1] and r[1] for o in out):
                        continue
                    out.append({
                        "id": None, "origem": "pec", "nome": r[0],
                        "cns": r[1] or "", "cpf": r[2] or "",
                        "prontuario": r[3] or "", "ubs": r[4] or "",
                    })
            finally:
                try:
                    conn.close()
                except Exception:
                    pass
    except Exception:
        pass
    return {"fonte": "pec+local" if out else "local", "termo": termo, "resultados": out[:15]}


# ---------- Destinos ----------
@router.get("/destinos", response_model=Pagina[DestinoOut])
def listar_destinos(
    ativos: bool | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    base = select(Destino).order_by(Destino.nome_destino)
    if ativos is not None:
        base = select(Destino).where(Destino.ativo == ativos).order_by(Destino.nome_destino)
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = db.exec(base.offset(meta["offset"]).limit(limit)).all()
    return {"data": rows, "total": total, "page": meta["page"], "pages": meta["pages"]}


@router.post("/destinos", response_model=DestinoOut, status_code=201)
def criar_destino(data: DestinoIn, db: Session = Depends(get_db), _=Depends(need_tela())):
    nome = data.nome_destino.strip()
    if db.exec(select(Destino).where(Destino.nome_destino == nome)).first():
        raise HTTPException(400, "Destino já cadastrado")
    obj = Destino(**{**data.model_dump(), "nome_destino": nome})
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/destinos/{did}", response_model=DestinoOut)
def atualizar_destino(did: int, data: DestinoIn, db: Session = Depends(get_db), _=Depends(need_tela())):
    obj = db.get(Destino, did)
    if not obj:
        raise HTTPException(404, "Destino não encontrado")
    nome = data.nome_destino.strip()
    dup = db.exec(select(Destino).where(Destino.nome_destino == nome, Destino.id != did)).first()
    if dup:
        raise HTTPException(400, "Destino já cadastrado")
    for k, v in data.model_dump().items():
        setattr(obj, k, v.strip() if k == "nome_destino" and isinstance(v, str) else v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/destinos/{did}", status_code=204)
def excluir_destino(did: int, db: Session = Depends(get_db), _=Depends(need_tela())):
    obj = db.get(Destino, did)
    if not obj:
        raise HTTPException(404, "Destino não encontrado")
    db.delete(obj)
    db.commit()


@router.post("/pacientes", response_model=PacienteOut, status_code=201)
def criar_paciente(
    data: PacienteIn, db: Session = Depends(get_db), _=Depends(need_tela())
):
    obj = Paciente(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/pacientes/{pid}", response_model=PacienteOut)
def atualizar_paciente(
    pid: int, data: PacienteIn, db: Session = Depends(get_db), _=Depends(need_tela())
):
    obj = db.get(Paciente, pid)
    if not obj:
        raise HTTPException(404, "Paciente não encontrado")
    for k, v in data.model_dump().items():
        setattr(obj, k, v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/pacientes/{pid}", status_code=204)
def excluir_paciente(pid: int, db: Session = Depends(get_db), _=Depends(need_tela())):
    obj = db.get(Paciente, pid)
    if not obj:
        raise HTTPException(404, "Paciente não encontrado")
    db.delete(obj)
    db.commit()


# ---------- Veículos (frota) ----------
@router.get("/veiculos", response_model=Pagina[VeiculoOut])
def listar_veiculos(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    base = select(Veiculo).order_by(Veiculo.placa)
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = db.exec(base.offset(meta["offset"]).limit(limit)).all()
    return {"data": rows, "total": total, "page": meta["page"], "pages": meta["pages"]}


@router.post("/veiculos", response_model=VeiculoOut, status_code=201)
def criar_veiculo(
    data: VeiculoIn, db: Session = Depends(get_db), _=Depends(need_tela())
):
    placa = data.placa.strip().upper()
    if db.exec(select(Veiculo).where(Veiculo.placa == placa)).first():
        raise HTTPException(400, "Placa já cadastrada")
    obj = Veiculo(**{**data.model_dump(), "placa": placa})
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/veiculos/{vid}", response_model=VeiculoOut)
def atualizar_veiculo(
    vid: int, data: VeiculoIn, db: Session = Depends(get_db), _=Depends(need_tela())
):
    obj = db.get(Veiculo, vid)
    if not obj:
        raise HTTPException(404, "Veículo não encontrado")
    for k, v in data.model_dump().items():
        setattr(obj, k, v.strip().upper() if k == "placa" else v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/veiculos/{vid}", status_code=204)
def excluir_veiculo(vid: int, db: Session = Depends(get_db), _=Depends(need_tela())):
    obj = db.get(Veiculo, vid)
    if not obj:
        raise HTTPException(404, "Veículo não encontrado")
    db.delete(obj)
    db.commit()


# ---------- Viagens ----------
@router.get("/viagens", response_model=Pagina[ViagemOut])
def listar_viagens(
    status_: str | None = Query(default=None, alias="status"),
    mes: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    ano: int | None = Query(default=None, ge=2000, le=2100),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    base = select(Viagem).order_by(Viagem.data_viagem.desc())
    filtros = []
    if status_:
        filtros.append(Viagem.status == status_)
    if mes:
        filtros.append(func.to_char(Viagem.data_viagem, "YYYY-MM") == mes)
    elif ano:
        filtros.append(func.to_char(Viagem.data_viagem, "YYYY") == str(ano))
    if filtros:
        base = select(Viagem).where(*filtros).order_by(Viagem.data_viagem.desc())
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    out: list[ViagemOut] = []
    for v in db.exec(base.offset(meta["offset"]).limit(limit)).all():
        n = db.exec(
            select(func.count(ViagemPaciente.id)).where(
                ViagemPaciente.viagem_id == v.id
            )
        ).one()
        placa = ""
        if v.veiculo_id:
            veh = db.get(Veiculo, v.veiculo_id)
            placa = veh.placa if veh else ""
        out.append(
            ViagemOut(**v.model_dump(), passageiros=n or 0, veiculo_placa=placa)
        )
    return {"data": out, "total": total, "page": meta["page"], "pages": meta["pages"]}


@router.post("/viagens", response_model=ViagemOut, status_code=201)
def criar_viagem(
    data: ViagemIn, db: Session = Depends(get_db), _=Depends(need_tela())
):
    obj = Viagem(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ViagemOut(**obj.model_dump(), passageiros=0)


@router.put("/viagens/{vid}", response_model=ViagemOut)
def atualizar_viagem(
    vid: int, data: ViagemIn, db: Session = Depends(get_db), _=Depends(need_tela())
):
    obj = db.get(Viagem, vid)
    if not obj:
        raise HTTPException(404, "Viagem não encontrada")
    for k, v in data.model_dump().items():
        setattr(obj, k, v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    n = db.exec(
        select(func.count(ViagemPaciente.id)).where(ViagemPaciente.viagem_id == vid)
    ).one()
    return ViagemOut(**obj.model_dump(), passageiros=n or 0)


@router.delete("/viagens/{vid}", status_code=204)
def excluir_viagem(vid: int, db: Session = Depends(get_db), _=Depends(need_tela())):
    obj = db.get(Viagem, vid)
    if not obj:
        raise HTTPException(404, "Viagem não encontrada")
    for vp in db.exec(select(ViagemPaciente).where(ViagemPaciente.viagem_id == vid)).all():
        db.delete(vp)
    db.delete(obj)
    db.commit()


@router.get("/viagens/{vid}/passageiros", response_model=list[ViagemPacienteOut])
def listar_passageiros(vid: int, db: Session = Depends(get_db), _=Depends(need_tela())):
    out: list[ViagemPacienteOut] = []
    for vp in db.exec(select(ViagemPaciente).where(ViagemPaciente.viagem_id == vid)).all():
        pac = db.get(Paciente, vp.paciente_id)
        out.append(
            ViagemPacienteOut(
                **vp.model_dump(), paciente_nome=pac.nome if pac else "?"
            )
        )
    return out


@router.post("/viagens/{vid}/passageiros", response_model=ViagemPacienteOut, status_code=201)
def add_passageiro(
    vid: int,
    data: ViagemPacienteIn,
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    if not db.get(Viagem, vid):
        raise HTTPException(404, "Viagem não encontrada")
    if not db.get(Paciente, data.paciente_id):
        raise HTTPException(404, "Paciente não encontrado")
    dup = db.exec(
        select(ViagemPaciente).where(
            ViagemPaciente.viagem_id == vid,
            ViagemPaciente.paciente_id == data.paciente_id,
        )
    ).first()
    if dup:
        raise HTTPException(400, "Paciente já está nesta viagem")
    obj = ViagemPaciente(viagem_id=vid, **data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    pac = db.get(Paciente, obj.paciente_id)
    return ViagemPacienteOut(**obj.model_dump(), paciente_nome=pac.nome if pac else "")


@router.delete("/viagens/{vid}/passageiros/{vpid}", status_code=204)
def remover_passageiro(
    vid: int, vpid: int, db: Session = Depends(get_db), _=Depends(need_tela())
):
    obj = db.get(ViagemPaciente, vpid)
    if not obj or obj.viagem_id != vid:
        raise HTTPException(404, "Passageiro não encontrado")
    db.delete(obj)
    db.commit()


# ---------- Fila de exames ----------
PRIO_PESO = {"urgente": 0, "prioritaria": 1, "rotina": 2}


def _iniciais(nome: str) -> str:
    partes = [p for p in (nome or "").split() if p]
    if not partes:
        return "—"
    if len(partes) == 1:
        return partes[0][:2].upper()
    return (partes[0][0] + partes[-1][0]).upper()


def _ordenar_fila(itens: list[ExameFila]) -> list[ExameFila]:
    return sorted(
        itens,
        key=lambda e: (PRIO_PESO.get(e.prioridade, 9), str(e.data_pedido), e.id or 0),
    )


def _grupo_procedimento(e: ExameFila) -> str:
    """Chave de segmentação: mesmo procedimento (exame+especialidade normalizados)."""
    return f"{(e.exame or '').strip().upper()}|{(e.especialidade or '').strip().upper()}"


def _rank_por_grupo(db: Session) -> dict[int, tuple[int, int]]:
    """Posição restrita ao mesmo procedimento/tipo. Retorna {id: (posicao, total_grupo)}."""
    base = list(
        db.exec(
            select(ExameFila).where(ExameFila.status.in_(["aguardando", "agendado"]))
        ).all()
    )
    grupos: dict[str, list[ExameFila]] = {}
    for e in base:
        grupos.setdefault(_grupo_procedimento(e), []).append(e)
    rank: dict[int, tuple[int, int]] = {}
    for membros in grupos.values():
        total = len(membros)
        for i, m in enumerate(_ordenar_fila(membros)):
            rank[m.id] = (i + 1, total)
    return rank


def _com_posicao(db: Session, itens: list[ExameFila]) -> list[dict]:
    """Posição segmentada por procedimento + total global p/ badge."""
    rank = _rank_por_grupo(db)
    total = len(
        db.exec(
            select(ExameFila).where(ExameFila.status.in_(["aguardando", "agendado"]))
        ).all()
    )
    out = []
    for e in itens:
        pac = db.get(Paciente, e.paciente_id)
        pos, total_grupo = rank.get(e.id, (None, None))
        out.append(
            ExameOut(
                **e.model_dump(),
                paciente_nome=pac.nome if pac else "?",
                posicao=pos,
                total_fila=total_grupo if total_grupo is not None else total,
            )
        )
    return out


@router.get("/exames", response_model=Pagina[ExameOut])
def listar_exames(
    status_: str | None = Query(default=None, alias="status"),
    q: str = Query(default="", max_length=80),
    prioridade: str | None = None,
    especialidade: str = Query(default="", max_length=80),
    tipo_fila: str = Query(default="", max_length=80),
    procedimento: str = Query(default="", max_length=150),
    codigo_especialidade: str = Query(default="", max_length=10),
    destino: str = Query(default="", max_length=120),
    data_de: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    data_ate: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    base = select(ExameFila).order_by(ExameFila.data_pedido.desc())
    filtros = []
    if status_:
        filtros.append(ExameFila.status == status_)
    if prioridade:
        filtros.append(ExameFila.prioridade == prioridade)
    if especialidade:
        # Compat: busca em especialidade legada + CBO + nome especialidade novo modelo
        like_esp = f"%{especialidade}%"
        filtros.append(
            (ExameFila.especialidade.ilike(like_esp))
            | (ExameFila.codigo_especialidade.ilike(like_esp))
            | (ExameFila.nome_especialidade.ilike(like_esp))
        )
    if tipo_fila:
        filtros.append(ExameFila.tipo_fila.ilike(f"%{tipo_fila}%"))
    if procedimento:
        # Busca por nome exato do procedimento OU código procedimento OU texto exame
        like_proc = f"%{procedimento}%"
        filtros.append(
            (ExameFila.exame.ilike(like_proc))
            | (ExameFila.codigo_procedimento.ilike(like_proc))
        )
    if codigo_especialidade:
        filtros.append(ExameFila.codigo_especialidade == codigo_especialidade.strip())
    if destino:
        filtros.append(ExameFila.destino.ilike(f"%{destino}%"))
    if data_de:
        filtros.append(func.to_char(ExameFila.data_pedido, "YYYY-MM-DD") >= data_de)
    if data_ate:
        filtros.append(func.to_char(ExameFila.data_pedido, "YYYY-MM-DD") <= data_ate)
    if filtros:
        base = (
            select(ExameFila)
            .where(*filtros)
            .order_by(ExameFila.data_pedido.desc())
        )
    itens = list(db.exec(base).all())
    if q:
        ql = q.strip().lower()
        com_nome = []
        for e in itens:
            pac = db.get(Paciente, e.paciente_id)
            hay = " ".join([
                e.exame or "", e.especialidade or "", e.tipo_fila or "",
                e.codigo_procedimento or "", e.codigo_especialidade or "",
                e.nome_especialidade or "", e.destino or "",
                pac.nome if pac else "", pac.cns if pac else "",
                pac.cpf if pac else "",
            ]).lower()
            if ql in hay:
                com_nome.append(e)
        itens = com_nome
    total = len(itens)
    meta = paginar(total, page, limit)
    pagina = _ordenar_fila(itens)[meta["offset"]:meta["offset"] + limit]
    return {
        "data": _com_posicao(db, pagina),
        "total": total,
        "page": meta["page"],
        "pages": meta["pages"],
    }


# ---------- Opções p/ filtros avançados (com contagem) ----------
@router.get("/exames/filtros-opcoes", response_model=FiltrosOpcoesOut)
def filtros_opcoes(
    status_: str | None = Query(default="aguardando", alias="status"),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    """Agrega Tipo de Fila / Procedimento / Especialidade-CBO com totais.

    Fonte primária: tfd_exames_fila (dados reais importados). Catálogo
    dinâmico (tfd_tipos_fila / tfd_procedimentos / tfd_especialidades)
    completa nomes zerados quando inativados não entram na fila.
    """
    from sqlalchemy import func as sa_func

    base_f = [ExameFila.status == status_] if status_ else []
    # Tipos
    tipos: list[OpcaoFiltro] = []
    rows = db.exec(
        select(ExameFila.tipo_fila, sa_func.count(ExameFila.id))
        .where(*base_f, ExameFila.tipo_fila != "")
        .group_by(ExameFila.tipo_fila)
        .order_by(sa_func.count(ExameFila.id).desc())
        .limit(100)
    ).all()
    for nome, n in rows:
        tipos.append(OpcaoFiltro(value=nome, label=f"{nome} ({n})", total=n or 0))
    # Procedimentos: agrupa por codigo_procedimento + nome limpo
    procs: list[OpcaoFiltro] = []
    rows_p = db.exec(
        select(ExameFila.codigo_procedimento, ExameFila.exame, sa_func.count(ExameFila.id))
        .where(*base_f)
        .group_by(ExameFila.codigo_procedimento, ExameFila.exame)
        .order_by(sa_func.count(ExameFila.id).desc())
        .limit(500)
    ).all()
    for cod, exame, n in rows_p:
        nome_limpo = (exame or "").strip()
        # exame legado = "COD - NOME"; exibe NOME (COD)
        m = None
        import re as _re

        m = _re.match(r"^[0-9.\-]{4,}\s*-\s*(.+)$", nome_limpo)
        nome_curto = (m.group(1) if m else nome_limpo).strip() or nome_limpo
        value = nome_curto or (cod or "")
        label = f"{nome_curto} ({n})" if nome_curto else f"{cod} ({n})"
        if value:
            procs.append(OpcaoFiltro(value=value, label=label, total=n or 0))
    # Especialidades CBO
    esps: list[OpcaoFiltro] = []
    rows_e = db.exec(
        select(
            ExameFila.codigo_especialidade,
            ExameFila.nome_especialidade,
            sa_func.count(ExameFila.id),
        )
        .where(*base_f, ExameFila.codigo_especialidade != "")
        .group_by(ExameFila.codigo_especialidade, ExameFila.nome_especialidade)
        .order_by(sa_func.count(ExameFila.id).desc())
        .limit(100)
    ).all()
    for cbo, nome, n in rows_e:
        rot = (nome or "").strip() or f"CBO {cbo}"
        esps.append(OpcaoFiltro(value=cbo, label=f"{rot} - CBO {cbo} ({n})", total=n or 0))
    # Fallback legado: especialidade textual sem CBO (compat fila antiga)
    if not esps:
        rows_leg = db.exec(
            select(ExameFila.especialidade, sa_func.count(ExameFila.id))
            .where(*base_f, ExameFila.especialidade != "")
            .group_by(ExameFila.especialidade)
            .order_by(sa_func.count(ExameFila.id).desc())
            .limit(100)
        ).all()
        for nome, n in rows_leg:
            esps.append(OpcaoFiltro(value=nome, label=f"{nome} ({n})", total=n or 0))
    return FiltrosOpcoesOut(tipos=tipos, procedimentos=procs, especialidades=esps)


def _garantir_token(obj: ExameFila) -> str:
    import secrets

    if not obj.public_token:
        obj.public_token = secrets.token_urlsafe(24)
    return obj.public_token


@router.post("/exames", response_model=ExameOut, status_code=201)
def criar_exame(data: ExameIn, db: Session = Depends(get_db), _=Depends(need_tela())):
    if not db.get(Paciente, data.paciente_id):
        raise HTTPException(404, "Paciente não encontrado")
    payload = data.model_dump()
    if payload.get("codigo_curto"):
        payload["codigo_curto"] = str(payload["codigo_curto"]).strip().upper()
    obj = ExameFila(**payload)
    _garantir_token(obj)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _com_posicao(db, [obj])[0]


@router.put("/exames/lote", response_model=ExameLoteOut)
def atualizar_exames_lote(
    data: ExameLoteIn, db: Session = Depends(get_db), _=Depends(need_tela())
):
    """Atualiza vários pedidos de uma vez — só campos enviados são aplicados."""
    ids = sorted(set(data.ids))
    objs = {o.id: o for o in db.exec(select(ExameFila).where(ExameFila.id.in_(ids))).all()}
    faltando = [i for i in ids if i not in objs]
    n = 0
    for i in ids:
        obj = objs.get(i)
        if not obj:
            continue
        if data.status:
            obj.status = data.status
        if data.limpar_data_agendada:
            obj.data_agendada = None
        elif data.data_agendada is not None:
            obj.data_agendada = data.data_agendada
        if data.destino != "":
            obj.destino = data.destino
        if data.prioridade:
            obj.prioridade = data.prioridade
        if data.observacoes != "":
            obj.observacoes = data.observacoes
        db.add(obj)
        n += 1
    db.commit()
    return ExameLoteOut(atualizados=n, nao_encontrados=faltando)


@router.put("/exames/{eid}", response_model=ExameOut)
def atualizar_exame(
    eid: int, data: ExameIn, db: Session = Depends(get_db), _=Depends(need_tela())
):
    obj = db.get(ExameFila, eid)
    if not obj:
        raise HTTPException(404, "Exame não encontrado")
    token_atual = obj.public_token
    for k, v in data.model_dump().items():
        setattr(obj, k, v)
    obj.public_token = token_atual
    _garantir_token(obj)
    if hasattr(data, "codigo_curto") and getattr(data, "codigo_curto"):
        obj.codigo_curto = data.codigo_curto.strip().upper()  # type: ignore[attr-defined]
    db.add(obj)
    db.commit()
    db.refresh(obj)
    pac = db.get(Paciente, obj.paciente_id)
    rank = _rank_por_grupo(db)
    pos, _ = rank.get(obj.id, (None, None))
    return ExameOut(
        **obj.model_dump(), paciente_nome=pac.nome if pac else "",
        posicao=pos,
    )


@router.delete("/exames/{eid}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_exame(eid: int, db: Session = Depends(get_db), _=Depends(need_tela())):
    obj = db.get(ExameFila, eid)
    if not obj:
        raise HTTPException(404, "Exame não encontrado")
    db.delete(obj)
    db.commit()


@router.post("/exames/{eid}/regenerar-token", response_model=ExameOut)
def regenerar_token(eid: int, db: Session = Depends(get_db), _=Depends(need_tela())):
    import secrets

    obj = db.get(ExameFila, eid)
    if not obj:
        raise HTTPException(404, "Exame não encontrado")
    obj.public_token = secrets.token_urlsafe(24)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _com_posicao(db, [obj])[0]


@router.get("/public/exames/{token}", response_model=ExamePublicoOut)
def consultar_exame_publico(token: str, db: Session = Depends(get_db)):
    """Consulta pública sem login — só status/posição, sem PII (LGPD)."""
    from fastapi import Response

    if not token or len(token) > 64:
        raise HTTPException(404, "Pedido não encontrado")
    obj = db.exec(select(ExameFila).where(ExameFila.public_token == token)).first()
    if not obj:
        raise HTTPException(404, "Pedido não encontrado")
    rank = _rank_por_grupo(db)
    pos, total_grupo = rank.get(obj.id, (None, None))
    pac = db.get(Paciente, obj.paciente_id)
    return Response(
        content=ExamePublicoOut(
            exame=obj.exame,
            especialidade=obj.especialidade,
            status=obj.status,
            prioridade=obj.prioridade,
            data_pedido=obj.data_pedido,
            data_agendada=obj.data_agendada,
            destino=obj.destino,
            posicao=pos,
            total_fila=total_grupo,
            paciente_iniciais=_iniciais(pac.nome if pac else ""),
        ).model_dump_json(),
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


# ---------- Catálogo de procedimentos (códigos curtos + dinâmico) ----------
@router.get("/exames/catalogo", response_model=list[dict])
def catalogo_procedimentos(
    q: str = Query(default="", max_length=80),
    tipo_fila: str = Query(default="", max_length=80),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    """Catálogo dinâmico + agregado da fila.

    Fonte primária: tfd_procedimentos (CRUD). Fallback: agregação
    tfd_exames_fila (legado). Busca por código, nome, curto ou tipo.
    """
    from sqlalchemy import func as sa_func

    ql = (q or "").strip().lower()
    out: list[dict] = []
    # 1) Dinâmico
    base = select(ProcedimentoCatalogo).where(ProcedimentoCatalogo.ativo == True).order_by(  # noqa: E712
        ProcedimentoCatalogo.nome
    )
    if tipo_fila:
        base = (
            select(ProcedimentoCatalogo)
            .where(
                ProcedimentoCatalogo.ativo == True,  # noqa: E712
                ProcedimentoCatalogo.tipo_fila.ilike(f"%{tipo_fila}%"),
            )
            .order_by(ProcedimentoCatalogo.nome)
        )
    for p in db.exec(base.limit(500)).all():
        rotulo = f"{p.codigo_curto} · {p.nome}" if p.codigo_curto else p.nome
        hay = f"{p.codigo} {p.nome} {p.codigo_curto} {p.tipo_fila} {p.nome_especialidade}".lower()
        if ql and ql not in hay:
            continue
        out.append({
            "exame": f"{p.codigo} - {p.nome}" if p.codigo else p.nome,
            "nome_procedimento": p.nome,
            "codigo_procedimento": p.codigo,
            "especialidade": p.nome_especialidade or "",
            "codigo_especialidade": p.codigo_especialidade or "",
            "nome_especialidade": p.nome_especialidade or "",
            "tipo_fila": p.tipo_fila or "",
            "codigo_curto": p.codigo_curto or "",
            "rotulo": rotulo,
            "usos": 0,
            "origem": "catalogo",
        })
        if len(out) >= 30 and not ql:
            break
    if out and not ql:
        # conta usos da fila p/ ordenar catálogo dinâmico
        try:
            usos = dict(
                db.exec(
                    select(ExameFila.codigo_procedimento, sa_func.count(ExameFila.id)).group_by(
                        ExameFila.codigo_procedimento
                    )
                ).all()
            )
            for o in out:
                o["usos"] = usos.get(o["codigo_procedimento"], 0)
            out.sort(key=lambda o: o["usos"], reverse=True)
        except Exception:
            pass
        return out[:30]
    if out:
        return out[:30]
    # 2) Fallback legado: agregação fila
    rows = db.exec(
        select(
            ExameFila.exame,
            ExameFila.especialidade,
            ExameFila.codigo_procedimento,
            ExameFila.tipo_fila,
            ExameFila.codigo_especialidade,
            ExameFila.nome_especialidade,
            sa_func.count(ExameFila.id),
        ).group_by(
            ExameFila.exame, ExameFila.especialidade, ExameFila.codigo_procedimento,
            ExameFila.tipo_fila, ExameFila.codigo_especialidade, ExameFila.nome_especialidade,
        ).order_by(sa_func.count(ExameFila.id).desc()).limit(500)
    ).all()
    # Códigos curtos: mapa exame normalizado -> atalho (novo modelo).
    curtos: dict[str, str] = {}
    try:
        for e in db.exec(select(ExameFila).where(ExameFila.codigo_curto != "")).all():  # type: ignore[attr-defined]
            curtos[(e.exame or "").strip().upper()] = (e.codigo_curto or "").strip().upper()  # type: ignore[attr-defined]
    except Exception:
        pass
    out2: list[dict] = []
    for exame, esp, cod_proc, tipo, cbo, nome_esp, n in rows:
        curto = curtos.get((exame or "").upper(), "")
        rotulo = f"{curto} · {exame}" if curto else exame
        hay = f"{rotulo} {esp or ''} {cod_proc or ''} {tipo or ''} {cbo or ''} {nome_esp or ''}".lower()
        if ql and ql not in hay:
            continue
        if tipo_fila and (tipo or "").strip().upper() != tipo_fila.strip().upper():
            # filtro parcial case-insensitive
            if tipo_fila.strip().lower() not in (tipo or "").lower():
                continue
        out2.append({
            "exame": exame,
            "especialidade": esp or nome_esp or "",
            "codigo_procedimento": cod_proc or "",
            "tipo_fila": tipo or "",
            "codigo_especialidade": cbo or "",
            "nome_especialidade": nome_esp or "",
            "codigo_curto": curto,
            "rotulo": rotulo,
            "usos": n,
            "origem": "fila",
        })
        if len(out2) >= 30:
            break
    return out2


# ---------- CRUD Tipos de Fila ----------
@router.get("/tipos", response_model=Pagina[TipoFilaOut])
def listar_tipos(
    q: str = Query(default="", max_length=80),
    ativos: bool | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    base = select(TipoFila).order_by(TipoFila.nome)
    filtros = []
    if q:
        filtros.append(TipoFila.nome.ilike(f"%{q}%"))
    if ativos is not None:
        filtros.append(TipoFila.ativo == ativos)
    if filtros:
        base = select(TipoFila).where(*filtros).order_by(TipoFila.nome)
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = db.exec(base.offset(meta["offset"]).limit(limit)).all()
    return {"data": rows, "total": total, "page": meta["page"], "pages": meta["pages"]}


@router.post("/tipos", response_model=TipoFilaOut, status_code=201)
def criar_tipo(data: TipoFilaIn, db: Session = Depends(get_db), _=Depends(need_tela())):
    nome = data.nome.strip().upper()
    if db.exec(select(TipoFila).where(TipoFila.nome == nome)).first():
        raise HTTPException(400, "Tipo já cadastrado")
    obj = TipoFila(codigo=data.codigo.strip(), nome=nome, ativo=data.ativo)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/tipos/{tid}", response_model=TipoFilaOut)
def atualizar_tipo(tid: int, data: TipoFilaIn, db: Session = Depends(get_db), _=Depends(need_tela())):
    obj = db.get(TipoFila, tid)
    if not obj:
        raise HTTPException(404, "Tipo não encontrado")
    nome = data.nome.strip().upper()
    dup = db.exec(select(TipoFila).where(TipoFila.nome == nome, TipoFila.id != tid)).first()
    if dup:
        raise HTTPException(400, "Tipo já cadastrado")
    obj.codigo = data.codigo.strip()
    obj.nome = nome
    obj.ativo = data.ativo
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/tipos/{tid}", status_code=204)
def excluir_tipo(tid: int, db: Session = Depends(get_db), _=Depends(need_tela())):
    obj = db.get(TipoFila, tid)
    if not obj:
        raise HTTPException(404, "Tipo não encontrado")
    db.delete(obj)
    db.commit()


# ---------- CRUD Procedimentos (catálogo dinâmico) ----------
@router.get("/procedimentos", response_model=Pagina[ProcedimentoOut])
def listar_procedimentos(
    q: str = Query(default="", max_length=80),
    tipo_fila: str = Query(default="", max_length=80),
    ativos: bool | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    base = select(ProcedimentoCatalogo).order_by(ProcedimentoCatalogo.nome)
    filtros = []
    if q:
        like = f"%{q}%"
        filtros.append(
            (ProcedimentoCatalogo.nome.ilike(like))
            | (ProcedimentoCatalogo.codigo.ilike(like))
            | (ProcedimentoCatalogo.codigo_curto.ilike(like))
        )
    if tipo_fila:
        filtros.append(ProcedimentoCatalogo.tipo_fila.ilike(f"%{tipo_fila}%"))
    if ativos is not None:
        filtros.append(ProcedimentoCatalogo.ativo == ativos)
    if filtros:
        base = select(ProcedimentoCatalogo).where(*filtros).order_by(ProcedimentoCatalogo.nome)
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = db.exec(base.offset(meta["offset"]).limit(limit)).all()
    return {"data": rows, "total": total, "page": meta["page"], "pages": meta["pages"]}


@router.post("/procedimentos", response_model=ProcedimentoOut, status_code=201)
def criar_procedimento(data: ProcedimentoIn, db: Session = Depends(get_db), _=Depends(need_tela())):
    codigo = data.codigo.strip()
    nome = data.nome.strip().upper()
    dup = db.exec(
        select(ProcedimentoCatalogo).where(
            ProcedimentoCatalogo.codigo == codigo, ProcedimentoCatalogo.nome == nome
        )
    ).first()
    if dup:
        raise HTTPException(400, "Procedimento já cadastrado")
    obj = ProcedimentoCatalogo(
        codigo=codigo, nome=nome,
        tipo_fila=data.tipo_fila.strip().upper(),
        codigo_especialidade=data.codigo_especialidade.strip(),
        nome_especialidade=data.nome_especialidade.strip(),
        codigo_curto=data.codigo_curto.strip().upper(),
        ativo=data.ativo,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/procedimentos/{pid}", response_model=ProcedimentoOut)
def atualizar_procedimento(pid: int, data: ProcedimentoIn, db: Session = Depends(get_db), _=Depends(need_tela())):
    obj = db.get(ProcedimentoCatalogo, pid)
    if not obj:
        raise HTTPException(404, "Procedimento não encontrado")
    obj.codigo = data.codigo.strip()
    obj.nome = data.nome.strip().upper()
    obj.tipo_fila = data.tipo_fila.strip().upper()
    obj.codigo_especialidade = data.codigo_especialidade.strip()
    obj.nome_especialidade = data.nome_especialidade.strip()
    obj.codigo_curto = data.codigo_curto.strip().upper()
    obj.ativo = data.ativo
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/procedimentos/{pid}", status_code=204)
def excluir_procedimento(pid: int, db: Session = Depends(get_db), _=Depends(need_tela())):
    obj = db.get(ProcedimentoCatalogo, pid)
    if not obj:
        raise HTTPException(404, "Procedimento não encontrado")
    db.delete(obj)
    db.commit()


# ---------- CRUD Especialidades (CBO) ----------
@router.get("/especialidades", response_model=Pagina[EspecialidadeOut])
def listar_especialidades(
    q: str = Query(default="", max_length=80),
    ativos: bool | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    base = select(Especialidade).order_by(Especialidade.nome)
    filtros = []
    if q:
        like = f"%{q}%"
        filtros.append(
            (Especialidade.nome.ilike(like)) | (Especialidade.codigo_cbo.ilike(like))
        )
    if ativos is not None:
        filtros.append(Especialidade.ativo == ativos)
    if filtros:
        base = select(Especialidade).where(*filtros).order_by(Especialidade.nome)
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = db.exec(base.offset(meta["offset"]).limit(limit)).all()
    return {"data": rows, "total": total, "page": meta["page"], "pages": meta["pages"]}


@router.post("/especialidades", response_model=EspecialidadeOut, status_code=201)
def criar_especialidade(data: EspecialidadeIn, db: Session = Depends(get_db), _=Depends(need_tela())):
    cbo = data.codigo_cbo.strip()
    if db.exec(select(Especialidade).where(Especialidade.codigo_cbo == cbo)).first():
        raise HTTPException(400, "CBO já cadastrado")
    obj = Especialidade(codigo_cbo=cbo, nome=data.nome.strip(), ativo=data.ativo)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/especialidades/{eid}", response_model=EspecialidadeOut)
def atualizar_especialidade(eid: int, data: EspecialidadeIn, db: Session = Depends(get_db), _=Depends(need_tela())):
    obj = db.get(Especialidade, eid)
    if not obj:
        raise HTTPException(404, "Especialidade não encontrada")
    cbo = data.codigo_cbo.strip()
    dup = db.exec(select(Especialidade).where(Especialidade.codigo_cbo == cbo, Especialidade.id != eid)).first()
    if dup:
        raise HTTPException(400, "CBO já cadastrado")
    obj.codigo_cbo = cbo
    obj.nome = data.nome.strip()
    obj.ativo = data.ativo
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/especialidades/{eid}", status_code=204)
def excluir_especialidade(eid: int, db: Session = Depends(get_db), _=Depends(need_tela())):
    obj = db.get(Especialidade, eid)
    if not obj:
        raise HTTPException(404, "Especialidade não encontrada")
    db.delete(obj)
    db.commit()


# ---------- Faturamento ----------
@router.get("/faturamento", response_model=Pagina[FaturaOut])
def listar_faturas(
    competencia: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_tela()),
):
    base = select(Faturamento).order_by(Faturamento.id.desc())
    if competencia:
        base = select(Faturamento).where(
            Faturamento.competencia == competencia
        ).order_by(Faturamento.id.desc())
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    out: list[FaturaOut] = []
    for f in db.exec(base.offset(meta["offset"]).limit(limit)).all():
        pac = db.get(Paciente, f.paciente_id)
        out.append(
            FaturaOut(
                **f.model_dump(),
                paciente_nome=pac.nome if pac else "?",
                total=round(float(f.valor) * f.quantidade, 2),
            )
        )
    return {"data": out, "total": total, "page": meta["page"], "pages": meta["pages"]}


@router.post("/faturamento", response_model=FaturaOut, status_code=201)
def criar_fatura(data: FaturaIn, db: Session = Depends(get_db), _=Depends(need_tela())):
    if not db.get(Paciente, data.paciente_id):
        raise HTTPException(404, "Paciente não encontrado")
    obj = Faturamento(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return FaturaOut(
        **obj.model_dump(), total=round(float(obj.valor) * obj.quantidade, 2)
    )


@router.put("/faturamento/{fid}", response_model=FaturaOut)
def atualizar_fatura(
    fid: int, data: FaturaIn, db: Session = Depends(get_db), _=Depends(need_tela())
):
    obj = db.get(Faturamento, fid)
    if not obj:
        raise HTTPException(404, "Fatura não encontrada")
    for k, v in data.model_dump().items():
        setattr(obj, k, v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    pac = db.get(Paciente, obj.paciente_id)
    return FaturaOut(
        **obj.model_dump(),
        paciente_nome=pac.nome if pac else "",
        total=round(float(obj.valor) * obj.quantidade, 2),
    )


@router.delete("/faturamento/{fid}", status_code=204)
def excluir_fatura(fid: int, db: Session = Depends(get_db), _=Depends(need_tela())):
    obj = db.get(Faturamento, fid)
    if not obj:
        raise HTTPException(404, "Fatura não encontrada")
    db.delete(obj)
    db.commit()
