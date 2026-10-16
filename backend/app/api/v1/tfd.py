from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlmodel import Session, func, select

from app.core.deps import get_current_user_senha_ok as get_current_user, get_db
from app.models.cadastros_saude import Medico, UnidadeSaude
from app.models.tfd import (
    Destino,
    Especialidade,
    ExameFila,
    Faturamento,
    Motorista,
    Paciente,
    ProcedimentoCatalogo,
    TipoFila,
    Veiculo,
    Viagem,
    ViagemFila,
    ViagemPaciente,
)
from app.models.user import User
from app.core.pagination import Pagina, paginar
from app.schemas.tfd import (
    DemandaItemOut,
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
    MotoristaIn,
    MotoristaOut,
    OpcaoFiltro,
    PacienteIn,
    PacienteOut,
    PacientePerfilOut,
    PrioridadeIn,
    ProcedimentoIn,
    ProcedimentoOut,
    ResumoOut,
    TipoFilaIn,
    TipoFilaOut,
    VeiculoIn,
    VeiculoOut,
    ViagemIn,
    ViagemOut,
    ViagemFilaIn,
    ViagemFilaOut,
    ViagemPacienteIn,
    ViagemPacienteOut,
)
from app.services.tfd import hoje_str, resumo_tfd

router = APIRouter()


from app.services.permissoes import need_any_perm, need_perm, tem_tela


JUSTIFICATIVA_MIN = 12

RETRO_MSG = "Seu perfil não possui permissão para realizar lançamentos com datas retroativas."


def exige_sem_retroativo(user: User, valor, mudou: bool = True) -> None:
    """Trava lançamentos retroativos (data < hoje) salvo flag ou superuser."""
    from datetime import date as _date

    if not mudou or valor is None:
        return
    try:
        passada = valor < _date.today()
    except Exception:
        return
    if not passada:
        return
    if bool(getattr(user, "is_superuser", False)):
        return
    if bool(getattr(user, "permite_retroativo", True)):
        return
    raise HTTPException(403, RETRO_MSG)


def medico_do_usuario(db: Session, user: User) -> Medico | None:
    """Cadastro de médico vinculado à conta (perfil Médico)."""
    mid = getattr(user, "medico_id", None)
    if not mid:
        return None
    try:
        return db.get(Medico, mid)
    except Exception:
        return None


def valida_justificativa(texto: str | None) -> str:
    t = (texto or "").strip()
    if len(t) < JUSTIFICATIVA_MIN:
        raise HTTPException(400, "A justificativa deve conter no mínimo 12 caracteres.")
    return t


def exige_ator_prioridade(db: Session, user: User, exame: ExameFila) -> Medico | None:
    """Só o perfil Médico — e apenas o médico envolvido — altera prioridade/justificativa."""
    if bool(getattr(user, "is_superuser", False)):
        return medico_do_usuario(db, user)
    if not tem_tela(user, "tfd_medico"):
        raise HTTPException(403, "Somente o perfil Médico pode alterar prioridade.")
    med = medico_do_usuario(db, user)
    if not med or not med.ativo:
        raise HTTPException(403, "Conta sem médico vinculado ativo.")
    if (exame.medico_id or None) != med.id:
        raise HTTPException(403, "Somente o médico envolvido na solicitação/atendimento pode alterar a prioridade.")
    return med


def preencher_snapshot(obj: ExameFila, med: Medico, uni: UnidadeSaude) -> None:
    obj.medico_id = med.id
    obj.unidade_saude_id = uni.id
    obj.medico_nome = med.nome or ""
    obj.medico_cpf = med.cpf or ""
    obj.medico_cbo_codigo = getattr(med, "cbo_codigo", "") or ""
    obj.medico_cbo_descricao = getattr(med, "cbo_descricao", "") or ""
    obj.unidade_nome = uni.nome or ""
    obj.unidade_cnes = uni.cnes or ""
    obj.unidade_endereco = uni.endereco or ""
    obj.unidade_numero = getattr(uni, "numero", "") or ""
    obj.unidade_bairro = uni.bairro or ""
    obj.unidade_municipio = getattr(uni, "municipio", "") or ""
    obj.unidade_cep = getattr(uni, "cep", "") or ""


def resolver_medico_unidade(db: Session, medico_id, unidade_id) -> tuple[Medico, UnidadeSaude]:
    med = db.get(Medico, medico_id) if medico_id else None
    if not med:
        raise HTTPException(404, "Médico não encontrado")
    uni = db.get(UnidadeSaude, unidade_id) if unidade_id else None
    if not uni:
        raise HTTPException(404, "Unidade de atendimento não encontrada")
    return med, uni


# ---------- Resumo ----------
@router.get("/resumo", response_model=ResumoOut)
def resumo(
    competencia: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
    _=Depends(need_perm("tfd_resumo")),
):
    return resumo_tfd(db, competencia or hoje_str())


# ---------- Pacientes ----------
@router.get("/pacientes", response_model=Pagina[PacienteOut])
def listar_pacientes(
    q: str = "",
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_perm("tfd_pacientes")),
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
    _=Depends(need_perm("tfd_pacientes")),
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
    _=Depends(need_perm("tfd_destinos")),
):
    base = select(Destino).order_by(Destino.nome_destino)
    if ativos is not None:
        base = select(Destino).where(Destino.ativo == ativos).order_by(Destino.nome_destino)
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = db.exec(base.offset(meta["offset"]).limit(limit)).all()
    return {"data": rows, "total": total, "page": meta["page"], "pages": meta["pages"]}


@router.post("/destinos", response_model=DestinoOut, status_code=201)
def criar_destino(data: DestinoIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_destinos", "criar"))):
    nome = data.nome_destino.strip()
    if db.exec(select(Destino).where(Destino.nome_destino == nome)).first():
        raise HTTPException(400, "Destino já cadastrado")
    obj = Destino(**{**data.model_dump(), "nome_destino": nome})
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/destinos/{did}", response_model=DestinoOut)
def atualizar_destino(did: int, data: DestinoIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_destinos", "editar"))):
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
def excluir_destino(did: int, db: Session = Depends(get_db), _=Depends(need_perm("tfd_destinos", "excluir"))):
    obj = db.get(Destino, did)
    if not obj:
        raise HTTPException(404, "Destino não encontrado")
    db.delete(obj)
    db.commit()


@router.post("/pacientes", response_model=PacienteOut, status_code=201)
def criar_paciente(
    data: PacienteIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_pacientes", "criar"))
):
    if data.unidade_saude_id is not None:
        from app.models.cadastros_saude import UnidadeSaude

        if not db.get(UnidadeSaude, data.unidade_saude_id):
            raise HTTPException(404, "Unidade de saúde não encontrada")
    obj = Paciente(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/pacientes/{pid}", response_model=PacienteOut)
def atualizar_paciente(
    pid: int, data: PacienteIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_pacientes", "editar"))
):
    obj = db.get(Paciente, pid)
    if not obj:
        raise HTTPException(404, "Paciente não encontrado")
    if data.unidade_saude_id is not None:
        from app.models.cadastros_saude import UnidadeSaude

        if not db.get(UnidadeSaude, data.unidade_saude_id):
            raise HTTPException(404, "Unidade de saúde não encontrada")
    for k, v in data.model_dump().items():
        setattr(obj, k, v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/pacientes/{pid}/perfil", response_model=PacientePerfilOut)
def perfil_paciente(
    pid: int, db: Session = Depends(get_db), _=Depends(need_perm("tfd_pacientes"))
):
    """Perfil do paciente: dados pessoais + territorialização APS + demanda reprimida.

    Demanda: solicitações ativas (aguardando/agendado) em ordem cronológica
    de inclusão, com posição dinâmica na fila global da especialidade
    (mesmo critério do Complexo Regulador: risco + antiguidade).
    """
    obj = db.get(Paciente, pid)
    if not obj:
        raise HTTPException(404, "Paciente não encontrado")
    unidade_nome = ""
    if obj.unidade_saude_id:
        try:
            from app.models.cadastros_saude import UnidadeSaude

            u = db.get(UnidadeSaude, obj.unidade_saude_id)
            unidade_nome = u.nome if u else ""
        except Exception:
            unidade_nome = ""
    rank = _rank_por_especialidade(db)
    itens = list(
        db.exec(
            select(ExameFila)
            .where(
                ExameFila.paciente_id == pid,
                ExameFila.ativo == True,  # noqa: E712
                ExameFila.status.in_(["aguardando", "agendado"]),
            )
            .order_by(ExameFila.created_at, ExameFila.data_pedido, ExameFila.id)
        ).all()
    )
    demanda = []
    for e in itens:
        pos, total_esp = rank.get(e.id, (None, None))
        demanda.append(
            DemandaItemOut(
                id=e.id or 0,
                exame=e.exame or "",
                especialidade=e.especialidade or "",
                nome_especialidade=e.nome_especialidade or "",
                tipo_fila=e.tipo_fila or "",
                prioridade=e.prioridade or "",
                classificacao_risco=_risco_rotulo(e.prioridade),
                data_pedido=e.data_pedido,
                data_inclusao=_data_inclusao_iso(e),
                posicao_especialidade=pos,
                total_fila_especialidade=total_esp,
                status=e.status or "",
                status_rotulo=_status_rotulo(e),
                data_agendada=e.data_agendada,
                hora_agendada=e.hora_agendada or "",
            )
        )
    return PacientePerfilOut(
        paciente=PacienteOut(**obj.model_dump()),
        unidade_saude_nome=unidade_nome,
        demanda=demanda,
    )


@router.get("/pacientes/exportar")
def exportar_pacientes(
    q: str = "",
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("tfd_pacientes")),
):
    """Cadastro de pacientes em XLSX respeitando a busca ativa."""
    from app.services.export_xlsx import resposta_xlsx

    base = select(Paciente).order_by(Paciente.nome)
    if q:
        like = f"%{q}%"
        base = select(Paciente).where(
            (Paciente.nome.ilike(like)) | (Paciente.cpf.ilike(like))
        ).order_by(Paciente.nome)
    linhas = []
    for p in list(db.exec(base).all())[:20000]:
        linhas.append({
            "nome": p.nome, "cpf": p.cpf or "", "cns": p.cns or "",
            "nascimento": p.nascimento,
            "telefone": p.telefone or "",
            "endereco": " ".join(x for x in [
                p.endereco or "",
                f"Nº {p.endereco_numero}" if p.endereco_numero else "",
                p.bairro or "", f"CEP {p.cep}" if p.cep else "",
            ] if x),
            "unidade": "", "equipe": p.equipe_esf or "", "acs": p.acs_nome or "",
        })
    return resposta_xlsx(
        "Pacientes", ator.nome or ator.username,
        [
            {"chave": "nome", "rotulo": "Nome completo", "largura": 34},
            {"chave": "cpf", "rotulo": "CPF", "largura": 18, "formato": "texto"},
            {"chave": "cns", "rotulo": "CNS", "largura": 22},
            {"chave": "nascimento", "rotulo": "Nascimento", "largura": 14, "formato": "data"},
            {"chave": "telefone", "rotulo": "Telefone", "largura": 16},
            {"chave": "endereco", "rotulo": "Endereço", "largura": 44},
            {"chave": "equipe", "rotulo": "Equipe (eSF)", "largura": 16},
            {"chave": "acs", "rotulo": "ACS", "largura": 24},
        ],
        linhas, "pacientes",
    )


@router.get("/pacientes/{pid}/demanda/exportar")
def exportar_demanda(
    pid: int,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("tfd_pacientes")),
):
    """Demanda reprimida do paciente em XLSX (ordem cronológica + posição)."""
    from app.services.export_xlsx import resposta_xlsx

    perfil = perfil_paciente(pid, db, ator)
    p = perfil.paciente
    linhas = [{
        "inclusao": d.data_inclusao,
        "especialidade": d.nome_especialidade or d.especialidade or d.tipo_fila,
        "procedimento": d.exame,
        "risco": d.classificacao_risco,
        "posicao": f"{d.posicao_especialidade}º de {d.total_fila_especialidade}" if d.posicao_especialidade else "",
        "status": d.status_rotulo,
    } for d in perfil.demanda]
    return resposta_xlsx(
        f"Demanda reprimida — {p.nome}",
        ator.nome or ator.username,
        [
            {"chave": "inclusao", "rotulo": "Data de inclusão", "largura": 18},
            {"chave": "especialidade", "rotulo": "Especialidade", "largura": 30},
            {"chave": "procedimento", "rotulo": "Procedimento", "largura": 40},
            {"chave": "risco", "rotulo": "Classificação de risco", "largura": 18},
            {"chave": "posicao", "rotulo": "Posição na fila", "largura": 16},
            {"chave": "status", "rotulo": "Status", "largura": 24},
        ],
        linhas, "demanda_reprimida",
    )


@router.delete("/pacientes/{pid}", status_code=204)
def excluir_paciente(pid: int, db: Session = Depends(get_db), _=Depends(need_perm("tfd_pacientes", "excluir"))):
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
    _=Depends(need_perm("tfd_frota")),
):
    base = select(Veiculo).order_by(Veiculo.placa)
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = db.exec(base.offset(meta["offset"]).limit(limit)).all()
    return {"data": rows, "total": total, "page": meta["page"], "pages": meta["pages"]}


@router.post("/veiculos", response_model=VeiculoOut, status_code=201)
def criar_veiculo(
    data: VeiculoIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_frota", "criar"))
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
    vid: int, data: VeiculoIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_frota", "editar"))
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
def excluir_veiculo(vid: int, db: Session = Depends(get_db), _=Depends(need_perm("tfd_frota", "excluir"))):
    obj = db.get(Veiculo, vid)
    if not obj:
        raise HTTPException(404, "Veículo não encontrado")
    db.delete(obj)
    db.commit()


def _resolver_motorista(db: Session, motorista_id, motorista_txt: str) -> tuple:
    """Snapshot do motorista: ID vinculado (quando escolhido no cadastro) + nome exibido."""
    if motorista_id:
        mot = db.get(Motorista, int(motorista_id))
        if not mot:
            raise HTTPException(404, "Motorista não encontrado")
        nome = (motorista_txt or "").strip() or mot.nome
        return mot.id, nome[:120]
    return None, (motorista_txt or "")[:120]


# ---------- Motoristas ----------
@router.get("/motoristas", response_model=Pagina[MotoristaOut])
def listar_motoristas(
    q: str = Query(default="", max_length=80),
    ativos: bool | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("tfd_frota", "tfd_frota_gestao")),
):
    base = select(Motorista).order_by(Motorista.nome)
    filtros = []
    if q.strip():
        like = f"%{q.strip()}%"
        filtros.append((Motorista.nome.ilike(like)) | (Motorista.cpf.ilike(like)))
    if ativos is not None:
        filtros.append(Motorista.ativo == ativos)
    if filtros:
        base = select(Motorista).where(*filtros).order_by(Motorista.nome)
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = db.exec(base.offset(meta["offset"]).limit(limit)).all()
    return {"data": rows, "total": total, "page": meta["page"], "pages": meta["pages"]}


@router.post("/motoristas", response_model=MotoristaOut, status_code=201)
def criar_motorista(
    data: MotoristaIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_frota", "criar"))
):
    nome = data.nome.strip()
    cpf = "".join(c for c in (data.cpf or "") if c.isdigit())[:11]
    if cpf and db.exec(select(Motorista).where(Motorista.cpf == cpf)).first():
        raise HTTPException(400, "CPF já cadastrado")
    obj = Motorista(**{**data.model_dump(), "nome": nome, "cpf": cpf})
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/motoristas/{mid}", response_model=MotoristaOut)
def atualizar_motorista(
    mid: int, data: MotoristaIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_frota", "editar"))
):
    obj = db.get(Motorista, mid)
    if not obj:
        raise HTTPException(404, "Motorista não encontrado")
    cpf = "".join(c for c in (data.cpf or "") if c.isdigit())[:11]
    if cpf and db.exec(select(Motorista).where(Motorista.cpf == cpf, Motorista.id != mid)).first():
        raise HTTPException(400, "CPF já cadastrado")
    for k, v in data.model_dump().items():
        setattr(obj, k, v)
    obj.nome = data.nome.strip()
    obj.cpf = cpf
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/motoristas/{mid}", status_code=204)
def excluir_motorista(mid: int, db: Session = Depends(get_db), _=Depends(need_perm("tfd_frota", "excluir"))):
    obj = db.get(Motorista, mid)
    if not obj:
        raise HTTPException(404, "Motorista não encontrado")
    vinculado = db.exec(select(Viagem).where(Viagem.motorista_id == mid).limit(1)).first()
    if vinculado:
        # Preserva histórico das viagens: inativa em vez de apagar.
        obj.ativo = False
        db.add(obj)
        db.commit()
        return
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
    _=Depends(need_perm("tfd_viagens")),
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


@router.get("/viagens/exportar")
def exportar_viagens(
    status_: str | None = Query(default=None, alias="status"),
    mes: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    ano: int | None = Query(default=None, ge=2000, le=2100),
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("tfd_viagens")),
):
    """Viagens do TFD em XLSX respeitando os filtros ativos."""
    from app.services.export_xlsx import resposta_xlsx

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
    linhas = []
    for v in list(db.exec(base).all())[:20000]:
        n = db.exec(
            select(func.count(ViagemPaciente.id)).where(ViagemPaciente.viagem_id == v.id)
        ).one()
        placa = ""
        if v.veiculo_id:
            veh = db.get(Veiculo, v.veiculo_id)
            placa = veh.placa if veh else ""
        linhas.append({
            "data": v.data_viagem, "hora": v.hora_saida or "", "destino": v.destino,
            "unidade": v.unidade or "", "motorista": v.motorista or "",
            "veiculo": placa, "passageiros": n or 0,
            "status": v.status, "finalidade": v.finalidade or "",
        })
    return resposta_xlsx(
        "Viagens do TFD", ator.nome or ator.username,
        [
            {"chave": "data", "rotulo": "Data", "largura": 14, "formato": "data"},
            {"chave": "hora", "rotulo": "Saída", "largura": 10},
            {"chave": "destino", "rotulo": "Destino", "largura": 30},
            {"chave": "unidade", "rotulo": "Unidade", "largura": 30},
            {"chave": "motorista", "rotulo": "Motorista", "largura": 24},
            {"chave": "veiculo", "rotulo": "Veículo", "largura": 12},
            {"chave": "passageiros", "rotulo": "Passageiros", "largura": 12},
            {"chave": "status", "rotulo": "Status", "largura": 14},
            {"chave": "finalidade", "rotulo": "Finalidade", "largura": 16},
        ],
        linhas, "viagens_tfd",
    )


@router.post("/viagens", response_model=ViagemOut, status_code=201)
def criar_viagem(
    data: ViagemIn, db: Session = Depends(get_db), ator: User = Depends(need_perm("tfd_viagens", "criar"))
):
    exige_sem_retroativo(ator, data.data_viagem, True)
    mid, mnome = _resolver_motorista(db, data.motorista_id, data.motorista)
    _exigir_sem_conflito(db, data.data_viagem, data.hora_saida, data.hora_retorno,
                         data.veiculo_id, mid, mnome)
    obj = Viagem(**{**data.model_dump(), "motorista_id": mid, "motorista": mnome})
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return ViagemOut(**obj.model_dump(), passageiros=0)


@router.put("/viagens/{vid}", response_model=ViagemOut)
def atualizar_viagem(
    vid: int, data: ViagemIn, db: Session = Depends(get_db), ator: User = Depends(need_perm("tfd_viagens", "editar"))
):
    obj = db.get(Viagem, vid)
    if not obj:
        raise HTTPException(404, "Viagem não encontrada")
    exige_sem_retroativo(ator, data.data_viagem, data.data_viagem != obj.data_viagem)
    mid, mnome = _resolver_motorista(db, data.motorista_id, data.motorista)
    _exigir_sem_conflito(db, data.data_viagem, data.hora_saida, data.hora_retorno,
                         data.veiculo_id, mid, mnome, ignorar_id=vid)
    for k, v in data.model_dump().items():
        setattr(obj, k, v)
    obj.motorista_id = mid
    obj.motorista = mnome
    db.add(obj)
    db.commit()
    db.refresh(obj)
    n = db.exec(
        select(func.count(ViagemPaciente.id)).where(ViagemPaciente.viagem_id == vid)
    ).one()
    return ViagemOut(**obj.model_dump(), passageiros=n or 0)


@router.patch("/viagens/{vid}/veiculo", response_model=ViagemOut)
def trocar_veiculo_viagem(
    vid: int,
    data: dict,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("tfd_viagens", "tfd_frota_gestao", acoes=("editar",))),
):
    """Troca rápida de veículo na visão semanal (seletor direto no card)."""

    obj = db.get(Viagem, vid)
    if not obj:
        raise HTTPException(404, "Viagem não encontrada")
    veiculo_id = (data or {}).get("veiculo_id")
    if veiculo_id is not None and veiculo_id != "":
        try:
            veiculo_id = int(veiculo_id)
        except (TypeError, ValueError):
            raise HTTPException(400, "Veículo inválido")
        veh = db.get(Veiculo, veiculo_id)
        if not veh or not veh.ativo:
            raise HTTPException(404, "Veículo não encontrado")
        obj.veiculo_id = veiculo_id
    else:
        # "A definir": viagem salva sem veículo vinculado.
        obj.veiculo_id = None
    if (data or {}).get("motorista_id") is not None and (data or {}).get("motorista_id") != "":
        mid, mnome = _resolver_motorista(db, (data or {}).get("motorista_id"), str((data or {}).get("motorista") or ""))
        obj.motorista_id = mid
        obj.motorista = mnome
    elif (data or {}).get("motorista") is not None:
        obj.motorista = str((data or {}).get("motorista") or "")[:120]
        if not obj.motorista:
            obj.motorista_id = None
    _exigir_sem_conflito(db, obj.data_viagem, obj.hora_saida, obj.hora_retorno,
                         obj.veiculo_id, getattr(obj, "motorista_id", None),
                         obj.motorista, ignorar_id=vid)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    # Valida capacidade após a troca (assentos ocupados vs novo veículo).
    ocup, cap = _assentos(db, vid)
    if cap and ocup > cap:
        raise HTTPException(400, f"Veículo sem capacidade p/ esta viagem ({ocup}/{cap} assentos).")
    n = db.exec(
        select(func.count(ViagemPaciente.id)).where(ViagemPaciente.viagem_id == vid)
    ).one()
    placa = ""
    if obj.veiculo_id:
        veh = db.get(Veiculo, obj.veiculo_id)
        placa = veh.placa if veh else ""
    return ViagemOut(**obj.model_dump(), passageiros=n or 0, veiculo_placa=placa)


@router.delete("/viagens/{vid}", status_code=204)
def excluir_viagem(vid: int, db: Session = Depends(get_db), _=Depends(need_perm("tfd_viagens", "excluir"))):
    obj = db.get(Viagem, vid)
    if not obj:
        raise HTTPException(404, "Viagem não encontrada")
    for vp in db.exec(select(ViagemPaciente).where(ViagemPaciente.viagem_id == vid)).all():
        if vp.viagem_fila_id:
            fila = db.get(ViagemFila, vp.viagem_fila_id)
            if fila and fila.status == "alocado":
                fila.status = "aguardando"
                db.add(fila)
        else:
            # Passageiro avulso (sem vínculo de fila): recria entrada na fila p/ não perder o agendamento.
            pac = db.get(Paciente, vp.paciente_id)
            if pac:
                db.add(ViagemFila(
                    paciente_id=vp.paciente_id,
                    destino=obj.destino or "A definir",
                    unidade=vp.unidade or obj.unidade or "",
                    tratamento=vp.tratamento or "",
                    data_consulta=obj.data_viagem,
                    hora_consulta=vp.hora_consulta or "",
                    acompanhante=bool((vp.acompanhante or "").strip() or vp.acompanhante_id),
                    acompanhante_id=getattr(vp, "acompanhante_id", None),
                    acompanhante_nome=(vp.acompanhante or "")[:150],
                    acompanhante_cpf=getattr(vp, "acompanhante_cpf", "") or "",
                    status="aguardando",
                ))
        db.delete(vp)
    db.flush()
    db.delete(obj)
    db.commit()


@router.get("/viagens/{vid}/passageiros", response_model=list[ViagemPacienteOut])
def listar_passageiros(vid: int, db: Session = Depends(get_db), _=Depends(need_perm("tfd_viagens"))):
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
    _=Depends(need_perm("tfd_viagens", "criar")),
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
    fila = None
    if data.viagem_fila_id:
        fila = db.get(ViagemFila, data.viagem_fila_id)
        if not fila or fila.status != "aguardando":
            raise HTTPException(400, "Registro da fila indisponível")
        if fila.paciente_id != data.paciente_id:
            raise HTTPException(400, "Paciente divergente da fila")
        viagem = db.get(Viagem, vid)
        if viagem and (fila.destino or "").strip().upper() != (viagem.destino or "").strip().upper():
            raise HTTPException(
                400,
                f"O paciente só pode ser alocado em veículos cadastrados para o mesmo destino (ex: {fila.destino}).",
            )
    obj = ViagemPaciente(viagem_id=vid, **data.model_dump())
    # Acompanhante via busca no sistema: resolve nome/CPF a partir do ID (manual continua válido).
    if data.acompanhante_id:
        acomp = db.get(Paciente, data.acompanhante_id)
        if not acomp:
            raise HTTPException(404, "Acompanhante não encontrado")
        if acomp.id == data.paciente_id:
            raise HTTPException(400, "Acompanhante não pode ser o próprio paciente")
        obj.acompanhante = data.acompanhante.strip() or acomp.nome
        obj.acompanhante_id = acomp.id
        obj.acompanhante_cpf = (data.acompanhante_cpf or acomp.cpf or "")[:14]
    if fila:
        obj.acompanhante = obj.acompanhante or (fila.acompanhante_nome or "") or ("Sim" if fila.acompanhante else "")
        if not obj.acompanhante_id and getattr(fila, "acompanhante_id", None):
            obj.acompanhante_id = fila.acompanhante_id
            obj.acompanhante_cpf = (fila.acompanhante_cpf or "")[:14]
            obj.acompanhante = obj.acompanhante or (fila.acompanhante_nome or "")
        obj.tratamento = obj.tratamento or fila.tratamento or ""
        obj.unidade = obj.unidade or fila.unidade or ""
        obj.hora_consulta = obj.hora_consulta or fila.hora_consulta or ""
    db.add(obj)
    db.flush()
    ocup, cap = _assentos(db, vid)
    if cap and ocup > cap:
        db.rollback()
        raise HTTPException(400, f"Capacidade do veículo excedida ({ocup}/{cap} assentos).")
    if fila:
        fila.status = "alocado"
        db.add(fila)
    db.commit()
    db.refresh(obj)
    pac = db.get(Paciente, obj.paciente_id)
    return ViagemPacienteOut(**obj.model_dump(), paciente_nome=pac.nome if pac else "")


@router.delete("/viagens/{vid}/passageiros/{vpid}", status_code=204)
def remover_passageiro(
    vid: int, vpid: int, db: Session = Depends(get_db), _=Depends(need_perm("tfd_viagens", "excluir"))
):
    obj = db.get(ViagemPaciente, vpid)
    if not obj or obj.viagem_id != vid:
        raise HTTPException(404, "Passageiro não encontrado")
    if obj.viagem_fila_id:
        fila = db.get(ViagemFila, obj.viagem_fila_id)
        if fila and fila.status == "alocado":
            fila.status = "aguardando"
            db.add(fila)
    db.delete(obj)
    db.commit()


# ---------- Fila de exames ----------
PRIO_PESO = {"urgente": 0, "rotina": 1}


def _iniciais(nome: str) -> str:
    partes = [p for p in (nome or "").split() if p]
    if not partes:
        return "—"
    if len(partes) == 1:
        return partes[0][:2].upper()
    return (partes[0][0] + partes[-1][0]).upper()


def _ordenar_fila(itens: list[ExameFila], ordem: str = "prioridade") -> list[ExameFila]:
    if ordem == "cronologica":
        return sorted(
            itens,
            key=lambda e: (str(getattr(e, "created_at", "") or ""), str(e.data_pedido), e.id or 0),
        )
    return sorted(
        itens,
        key=lambda e: (PRIO_PESO.get(e.prioridade, 9), str(e.data_pedido), e.id or 0),
    )


def _grupo_procedimento(e: ExameFila) -> str:
    """Chave legada: mesmo procedimento (exame+especialidade normalizados)."""
    return f"{(e.exame or '').strip().upper()}|{(e.especialidade or '').strip().upper()}"


# Tipos de atendimento que são consulta especializada (posição por especialidade).
TIPOS_CONSULTA_ESPECIALIZADA = frozenset({
    "CONSULTAS ESPECIALIZADAS",
    "RETORNO CONSULTA ESPECIALIZADA",
})


def _eh_consulta_especializada(e: ExameFila) -> bool:
    return (e.tipo_fila or "").strip().upper() in TIPOS_CONSULTA_ESPECIALIZADA


def _grupo_fila(e: ExameFila) -> tuple[str, str]:
    """Fila específica do encaminhamento: (chave, rótulo).

    - Exames: agrupa pelo Tipo de Fila do procedimento.
    - Consultas especializadas: agrupa pela Especialidade médica.
    """
    if _eh_consulta_especializada(e):
        rotulo = ((e.nome_especialidade or "").strip()
                  or (e.especialidade or "").strip()) or "GERAL"
        return f"ESP|{rotulo.upper()}", rotulo
    rotulo = (e.tipo_fila or "").strip() or "GERAL"
    return f"TIPO|{rotulo.upper()}", rotulo


def _grupo_especialidade(e: ExameFila) -> str:
    """Chave da fila global da especialidade (CBO/nome > tipo > exame).

    A posição do paciente é calculada dentro da especialidade solicitada,
    não por procedimento individual.
    """
    chave = (
        (e.nome_especialidade or "").strip()
        or (e.especialidade or "").strip()
        or (e.tipo_fila or "").strip()
        or (e.exame or "").strip()
    ).upper()
    return chave or "GERAL"


def _ordenar_regulacao(itens: list[ExameFila]) -> list[ExameFila]:
    """Critério do Complexo Regulador: classificação de risco + antiguidade."""
    return sorted(
        itens,
        key=lambda e: (
            PRIO_PESO.get(e.prioridade, 9),
            str(getattr(e, "created_at", "") or ""),
            str(e.data_pedido),
            e.id or 0,
        ),
    )


def _rank_por_especialidade(db: Session) -> dict[int, tuple[int, int]]:
    """Posição na fila global da especialidade. Retorna {id: (posicao, total)}."""
    base = list(
        db.exec(
            select(ExameFila).where(ExameFila.ativo == True, ExameFila.status.in_(["aguardando", "agendado"]))  # noqa: E712
        ).all()
    )
    grupos: dict[str, list[ExameFila]] = {}
    for e in base:
        grupos.setdefault(_grupo_especialidade(e), []).append(e)
    rank: dict[int, tuple[int, int]] = {}
    for membros in grupos.values():
        total = len(membros)
        for i, m in enumerate(_ordenar_regulacao(membros)):
            rank[m.id] = (i + 1, total)
    return rank


RISCO_ROTULO = {"rotina": "Eletivo", "urgente": "Urgente"}


def _risco_rotulo(prioridade: str | None) -> str:
    return RISCO_ROTULO.get((prioridade or "").strip().lower(), "Eletivo")


def _status_rotulo(e: ExameFila) -> str:
    status = (e.status or "").strip().lower()
    if status == "agendado":
        data = ""
        try:
            data = e.data_agendada.strftime("%d/%m/%Y") if e.data_agendada else ""
        except Exception:
            data = ""
        return f"Marcado ({data})" if data else "Marcado"
    if status == "aguardando":
        return "Em Regulação" if (e.prioridade or "") == "urgente" else "Aguardando Agendamento"
    if status == "realizado":
        return "Realizado"
    if status == "cancelado":
        return "Cancelado"
    return e.status or ""


def _data_inclusao_iso(e: ExameFila) -> str:
    try:
        if getattr(e, "created_at", None):
            return e.created_at.strftime("%d/%m/%Y %H:%M")  # type: ignore[union-attr]
    except Exception:
        pass
    try:
        return e.data_pedido.strftime("%d/%m/%Y 00:00") if e.data_pedido else ""
    except Exception:
        return ""


def _rank_por_grupo(db: Session) -> dict[int, tuple[int, int, str]]:
    """Posição na fila específica do encaminhamento.

    Exames agrupam por Tipo de Fila; consultas especializadas, por
    Especialidade. Retorna {id: (posicao, total_grupo, rotulo_grupo)}.
    """
    base = list(
        db.exec(
            select(ExameFila).where(ExameFila.ativo == True, ExameFila.status.in_(["aguardando", "agendado"]))  # noqa: E712
        ).all()
    )
    grupos: dict[str, list[ExameFila]] = {}
    rotulos: dict[str, str] = {}
    for e in base:
        chave, rotulo = _grupo_fila(e)
        grupos.setdefault(chave, []).append(e)
        rotulos[chave] = rotulo
    rank: dict[int, tuple[int, int, str]] = {}
    for chave, membros in grupos.items():
        total = len(membros)
        for i, m in enumerate(_ordenar_fila(membros)):
            rank[m.id] = (i + 1, total, rotulos[chave])
    return rank


def _com_posicao(db: Session, itens: list[ExameFila]) -> list[dict]:
    """Posição segmentada por procedimento + total global p/ badge."""
    rank = _rank_por_grupo(db)
    total = len(
        db.exec(
            select(ExameFila).where(ExameFila.ativo == True, ExameFila.status.in_(["aguardando", "agendado"]))  # noqa: E712
        ).all()
    )
    out = []
    for e in itens:
        pac = db.get(Paciente, e.paciente_id)
        pos, total_grupo, rotulo = rank.get(e.id, (None, None, ""))
        out.append(
            ExameOut(
                **e.model_dump(),
                paciente_nome=pac.nome if pac else "?",
                paciente_cpf=pac.cpf if pac else "",
                posicao=pos,
                total_fila=total_grupo if total_grupo is not None else total,
                grupo_fila=rotulo or "",
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
    agendada_em: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    meus: bool = Query(default=False),
    ordenacao: str = Query(default="prioridade", pattern="^(prioridade|cronologica)$"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("tfd_exames", "tfd_medico")),
):
    itens = _filtrar_exames_lista(
        db, ator, status_, q, prioridade, especialidade, tipo_fila,
        procedimento, codigo_especialidade, destino, data_de, data_ate,
        agendada_em, meus,
    )
    total = len(itens)
    meta = paginar(total, page, limit)
    pagina = _ordenar_fila(itens, ordenacao)[meta["offset"]:meta["offset"] + limit]
    return {
        "data": _com_posicao(db, pagina),
        "total": total,
        "page": meta["page"],
        "pages": meta["pages"],
    }


def _filtrar_exames_lista(
    db: Session,
    ator: User,
    status_: str | None = None,
    q: str = "",
    prioridade: str | None = None,
    especialidade: str = "",
    tipo_fila: str = "",
    procedimento: str = "",
    codigo_especialidade: str = "",
    destino: str = "",
    data_de: str | None = None,
    data_ate: str | None = None,
    agendada_em: str | None = None,
    meus: bool = False,
) -> list:
    """Filtros da fila compartilhados entre listagem e exportação XLSX."""
    filtros = [ExameFila.ativo == True]  # noqa: E712
    if agendada_em:
        filtros.append(func.to_char(ExameFila.data_agendada, "YYYY-MM-DD") == agendada_em)
    if meus:
        # Painel Médico: só solicitações em que o médico está envolvido.
        med = medico_do_usuario(db, ator)
        if not med:
            return []
        filtros.append(ExameFila.medico_id == med.id)
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
    return _ordenar_fila(itens)


COLS_FILA = [
    {"chave": "posicao", "rotulo": "Posição", "largura": 10},
    {"chave": "grupo_fila", "rotulo": "Fila específica", "largura": 28},
    {"chave": "paciente", "rotulo": "Paciente", "largura": 32},
    {"chave": "cpf", "rotulo": "CPF", "largura": 18, "formato": "texto"},
    {"chave": "cns", "rotulo": "Cartão SUS / CNS", "largura": 20, "formato": "texto"},
    {"chave": "telefone", "rotulo": "Telefone", "largura": 18, "formato": "texto"},
    {"chave": "endereco_completo", "rotulo": "Endereço completo", "largura": 44},
    {"chave": "exame", "rotulo": "Exame / procedimento", "largura": 42},
    {"chave": "especialidade", "rotulo": "Especialidade", "largura": 28},
    {"chave": "risco", "rotulo": "Classificação de risco", "largura": 18},
    {"chave": "status", "rotulo": "Status", "largura": 14},
    {"chave": "data_pedido", "rotulo": "Data do pedido", "largura": 14, "formato": "data"},
    {"chave": "data_agendada", "rotulo": "Data agendada", "largura": 14, "formato": "data"},
    {"chave": "hora", "rotulo": "Hora", "largura": 10},
    {"chave": "medico", "rotulo": "Médico", "largura": 28},
    {"chave": "unidade", "rotulo": "Unidade / destino", "largura": 28},
]


def _endereco_completo(pac) -> str:
    """Rua, número, bairro, complemento e CEP (cadastro local)."""
    if not pac:
        return ""
    partes = [
        (pac.endereco or "").strip(),
        f"Nº {(pac.endereco_numero or '').strip()}" if (pac.endereco_numero or "").strip() else "",
        (getattr(pac, "complemento", "") or "").strip(),
        (pac.bairro or "").strip(),
        f"CEP {(pac.cep or '').strip()}" if (pac.cep or "").strip() else "",
    ]
    return " · ".join([x for x in partes if x])


def _pec_documentos(cpfs: set, cnss: set) -> dict:
    """Backfill best-effort de CNS/CPF via DW PEC readonly (sem escrita).

    O DW expõe cadastro básico (cns, cpf, prontuário); endereço/telefone
    vêm do cadastro local. Falha silenciosa => só dados locais.
    """
    out: dict[str, dict] = {}
    if not cpfs and not cnss:
        return out
    try:
        from sqlalchemy import bindparam, text

        from app.services.pec import _pg

        conn, _ = _pg()
        if conn is None:
            return out
        try:
            for coluna, chaves in (("cpf", cpfs), ("cns", cnss)):
                lista = [c for c in chaves if c][:2000]
                if not lista:
                    continue
                stmt = text(
                    f"SELECT cns, cpf, prontuario FROM pec_pacientes WHERE {coluna} IN :chaves"  # noqa: S608
                ).bindparams(bindparam("chaves", expanding=True))
                for cns, cpf, _pront in conn.execute(stmt, {"chaves": lista}).all():
                    if cpf:
                        out.setdefault(f"cpf:{''.join(c for c in str(cpf) if c.isdigit())}",
                                       {"cns": cns or "", "cpf": cpf or ""})
                    if cns:
                        out.setdefault(f"cns:{''.join(c for c in str(cns) if c.isdigit())}",
                                       {"cns": cns or "", "cpf": cpf or ""})
        finally:
            try:
                conn.close()
            except Exception:
                pass
    except Exception:
        return {}
    return out


def _linha_fila(db: Session, cache: dict, e, pos: int | None = None) -> dict:
    pac = cache.get(e.paciente_id)
    if pac is None:
        pac = db.get(Paciente, e.paciente_id)
        cache[e.paciente_id] = pac
    _, rotulo = _grupo_fila(e)
    cpf = "".join(c for c in (pac.cpf if pac else "") if c.isdigit())
    cns = "".join(c for c in (pac.cns if pac else "") if c.isdigit())
    pec = cache.get("pec") or {}
    comp = pec.get(f"cpf:{cpf}") or pec.get(f"cns:{cns}") or {}
    return {
        "posicao": pos or "",
        "grupo_fila": rotulo,
        "paciente": pac.nome if pac else "?",
        "cpf": pac.cpf if pac else "",
        "cns": (pac.cns if pac and pac.cns else comp.get("cns", "")) or "",
        "telefone": pac.telefone if pac else "",
        "endereco_completo": _endereco_completo(pac),
        "exame": e.exame or "",
        "especialidade": e.nome_especialidade or e.especialidade or e.tipo_fila or "",
        "risco": _risco_rotulo(e.prioridade),
        "status": _status_rotulo(e),
        "data_pedido": e.data_pedido,
        "data_agendada": e.data_agendada,
        "hora": e.hora_agendada or "",
        "medico": e.medico_nome or "",
        "unidade": e.unidade_nome or e.destino or "",
    }


@router.get("/exames/exportar")
def exportar_fila(
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
    agendada_em: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    meus: bool = Query(default=False),
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("tfd_exames", "tfd_medico")),
):
    """Exporta a fila de espera em XLSX respeitando os filtros ativos."""
    from app.services.export_xlsx import resposta_xlsx

    itens = _filtrar_exames_lista(
        db, ator, status_, q, prioridade, especialidade, tipo_fila,
        procedimento, codigo_especialidade, destino, data_de, data_ate,
        agendada_em, meus,
    )
    rank = _rank_por_grupo(db)
    cache: dict = {}
    for e in itens:
        if e.paciente_id not in cache:
            cache[e.paciente_id] = db.get(Paciente, e.paciente_id)
    cpfs = {"".join(c for c in (p.cpf or "") if c.isdigit()) for p in cache.values() if p}
    cnss = {"".join(c for c in (p.cns or "") if c.isdigit()) for p in cache.values() if p}
    cache["pec"] = _pec_documentos({c for c in cpfs if c}, {c for c in cnss if c})
    linhas = [_linha_fila(db, cache, e, (rank.get(e.id) or (None,))[0]) for e in itens]
    return resposta_xlsx(
        "Fila de espera — exames e procedimentos",
        ator.nome or ator.username,
        COLS_FILA, linhas, "fila_espera",
    )


@router.get("/agenda/exportar")
def exportar_agenda(
    dia: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    status_: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("tfd_agenda")),
):
    """Agenda do TFD em XLSX: marcados do dia (paciente/CPF, exame, local/hora, status)."""
    from app.services.export_xlsx import resposta_xlsx

    itens = _filtrar_exames_lista(db, ator, status_, "", None, "", "", "", "", "", None, None, dia, False)
    cache: dict = {}
    linhas = [_linha_fila(db, cache, e) for e in itens]
    return resposta_xlsx(
        f"Agenda do TFD — {dia[8:10]}/{dia[5:7]}/{dia[0:4]}",
        ator.nome or ator.username,
        COLS_FILA, linhas, "agenda_tfd",
    )


# ---------- Opções p/ filtros avançados (com contagem) ----------
@router.get("/exames/filtros-opcoes", response_model=FiltrosOpcoesOut)
def filtros_opcoes(
    status_: str | None = Query(default="aguardando", alias="status"),
    db: Session = Depends(get_db),
    _=Depends(need_perm("tfd_exames")),
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
def criar_exame(data: ExameIn, db: Session = Depends(get_db), ator: User = Depends(need_perm("tfd_exames", "criar"))):
    if not db.get(Paciente, data.paciente_id):
        raise HTTPException(404, "Paciente não encontrado")
    exige_sem_retroativo(ator, data.data_pedido, True)
    exige_sem_retroativo(ator, data.data_agendada, data.data_agendada is not None)
    payload = data.model_dump()
    if payload.get("codigo_curto"):
        payload["codigo_curto"] = str(payload["codigo_curto"]).strip().upper()
    if not str(payload.get("tipo_fila") or "").strip():
        payload["tipo_fila"] = "ELETIVO"
    if payload.get("data_agendada"):
        # Marcação já na criação: médico + unidade de atendimento obrigatórios.
        if not payload.get("medico_id") or not payload.get("unidade_saude_id"):
            raise HTTPException(400, "Agendamento exige médico e unidade de atendimento.")
        med, uni = resolver_medico_unidade(db, payload.get("medico_id"), payload.get("unidade_saude_id"))
        payload["medico_nome"] = med.nome or ""
        payload["medico_cpf"] = med.cpf or ""
        payload["medico_cbo_codigo"] = getattr(med, "cbo_codigo", "") or ""
        payload["medico_cbo_descricao"] = getattr(med, "cbo_descricao", "") or ""
        payload["unidade_nome"] = uni.nome or ""
        payload["unidade_cnes"] = uni.cnes or ""
        payload["unidade_endereco"] = uni.endereco or ""
        payload["unidade_numero"] = getattr(uni, "numero", "") or ""
        payload["unidade_bairro"] = uni.bairro or ""
        payload["unidade_municipio"] = getattr(uni, "municipio", "") or ""
        payload["unidade_cep"] = getattr(uni, "cep", "") or ""
    obj = ExameFila(**payload)
    if obj.data_agendada and obj.status in ("aguardando",):
        obj.status = "agendado"
    _garantir_token(obj)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _com_posicao(db, [obj])[0]


@router.put("/exames/lote", response_model=ExameLoteOut)
def atualizar_exames_lote(
    data: ExameLoteIn, db: Session = Depends(get_db), ator: User = Depends(need_perm("tfd_exames", "editar"))
):
    """Atualiza vários pedidos de uma vez — só campos enviados são aplicados."""
    ids = sorted(set(data.ids))
    objs = {o.id: o for o in db.exec(select(ExameFila).where(ExameFila.id.in_(ids), ExameFila.ativo == True)).all()}  # noqa: E712
    faltando = [i for i in ids if i not in objs]
    agendando = data.data_agendada is not None
    if agendando:
        exige_sem_retroativo(ator, data.data_agendada, True)
    mudando_prio = bool(data.prioridade)
    med_lote = uni_lote = None
    if agendando:
        # Agendamento em lote: médico + unidade de atendimento obrigatórios.
        if not data.medico_id or not data.unidade_saude_id:
            raise HTTPException(400, "Agendamento exige médico e unidade de atendimento.")
        med_lote, uni_lote = resolver_medico_unidade(db, data.medico_id, data.unidade_saude_id)
    justificativa = ""
    if mudando_prio:
        justificativa = valida_justificativa(data.justificativa_prioridade)
        if not ator.is_superuser:
            if not tem_tela(ator, "tfd_medico"):
                raise HTTPException(403, "Somente o perfil Médico pode alterar prioridade.")
            med_ator = medico_do_usuario(db, ator)
            if not med_ator or not med_ator.ativo:
                raise HTTPException(403, "Conta sem médico vinculado ativo.")
            fora = [i for i in ids if i in objs and (objs[i].medico_id or None) != med_ator.id]
            if fora:
                raise HTTPException(403, "Somente o médico envolvido pode alterar a prioridade (itens sem vínculo).")
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
        if data.hora_agendada != "":
            obj.hora_agendada = data.hora_agendada
        if agendando and med_lote and uni_lote:
            preencher_snapshot(obj, med_lote, uni_lote)
        else:
            if data.medico_id is not None or data.unidade_saude_id is not None:
                mid = data.medico_id if data.medico_id is not None else obj.medico_id
                uid = data.unidade_saude_id if data.unidade_saude_id is not None else obj.unidade_saude_id
                if mid and uid:
                    preencher_snapshot(obj, *resolver_medico_unidade(db, mid, uid))
                else:
                    if data.medico_id is not None:
                        obj.medico_id = data.medico_id
                    if data.unidade_saude_id is not None:
                        obj.unidade_saude_id = data.unidade_saude_id
        if data.destino != "":
            obj.destino = data.destino
        if data.data_agendada is not None and data.status == "" and obj.status in ("aguardando",):
            obj.status = "agendado"
        if data.prioridade:
            obj.prioridade = data.prioridade
            obj.justificativa_prioridade = justificativa
        if data.observacoes != "":
            obj.observacoes = data.observacoes
        db.add(obj)
        n += 1
    db.commit()
    return ExameLoteOut(atualizados=n, nao_encontrados=faltando)


@router.put("/exames/{eid}/prioridade", response_model=ExameOut)
def alterar_prioridade(
    eid: int, data: PrioridadeIn, db: Session = Depends(get_db), ator: User = Depends(get_current_user)
):
    """Alteração de prioridade pelo médico envolvido (Painel Médico)."""
    if not (bool(getattr(ator, "is_superuser", False)) or tem_tela(ator, "tfd_exames") or tem_tela(ator, "tfd_medico")):
        raise HTTPException(403, "Sem acesso à fila de exames")
    obj = db.get(ExameFila, eid)
    if not obj or not obj.ativo:
        raise HTTPException(404, "Exame não encontrado")
    exige_ator_prioridade(db, ator, obj)
    obj.prioridade = data.prioridade
    obj.justificativa_prioridade = valida_justificativa(data.justificativa)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _com_posicao(db, [obj])[0]


@router.put("/exames/{eid}", response_model=ExameOut)
def atualizar_exame(
    eid: int, data: ExameIn, db: Session = Depends(get_db), ator: User = Depends(need_perm("tfd_exames", "editar"))
):
    obj = db.get(ExameFila, eid)
    if not obj or not obj.ativo:
        raise HTTPException(404, "Exame não encontrado")
    token_atual = obj.public_token
    data_antiga = obj.data_agendada
    exige_sem_retroativo(ator, data.data_pedido, data.data_pedido != obj.data_pedido)
    # Troca de prioridade: só o médico envolvido, com justificativa >= 12.
    if data.prioridade != (obj.prioridade or ""):
        exige_ator_prioridade(db, ator, obj)
        obj.justificativa_prioridade = valida_justificativa(data.justificativa_prioridade)
        obj.prioridade = data.prioridade
    elif (data.justificativa_prioridade or "").strip() and data.justificativa_prioridade.strip() != (obj.justificativa_prioridade or ""):
        exige_ator_prioridade(db, ator, obj)
        obj.justificativa_prioridade = valida_justificativa(data.justificativa_prioridade)
    for k, v in data.model_dump().items():
        if k in ("prioridade", "justificativa_prioridade", "medico_id", "unidade_saude_id"):
            continue
        setattr(obj, k, v)
    if not str(obj.tipo_fila or "").strip():
        obj.tipo_fila = "ELETIVO"
    novo_agendamento = data.data_agendada is not None and (
        data_antiga is None or data.data_agendada != data_antiga
    )
    if novo_agendamento:
        exige_sem_retroativo(ator, data.data_agendada, True)
    if obj.data_agendada and obj.status in ("aguardando",):
        obj.status = "agendado"
    if novo_agendamento:
        mid = data.medico_id if data.medico_id is not None else obj.medico_id
        uid = data.unidade_saude_id if data.unidade_saude_id is not None else obj.unidade_saude_id
        if not mid or not uid:
            raise HTTPException(400, "Agendamento exige médico e unidade de atendimento.")
        preencher_snapshot(obj, *resolver_medico_unidade(db, mid, uid))
    elif data.medico_id is not None or data.unidade_saude_id is not None:
        mid = data.medico_id if data.medico_id is not None else obj.medico_id
        uid = data.unidade_saude_id if data.unidade_saude_id is not None else obj.unidade_saude_id
        if mid and uid:
            preencher_snapshot(obj, *resolver_medico_unidade(db, mid, uid))
    obj.public_token = token_atual
    _garantir_token(obj)
    if hasattr(data, "codigo_curto") and getattr(data, "codigo_curto"):
        obj.codigo_curto = data.codigo_curto.strip().upper()  # type: ignore[attr-defined]
    db.add(obj)
    db.commit()
    db.refresh(obj)
    pac = db.get(Paciente, obj.paciente_id)
    rank = _rank_por_grupo(db)
    pos, _, rotulo = rank.get(obj.id, (None, None, ""))
    return ExameOut(
        **obj.model_dump(), paciente_nome=pac.nome if pac else "",
        paciente_cpf=pac.cpf if pac else "",
        posicao=pos,
        grupo_fila=rotulo or "",
    )


@router.delete("/exames/{eid}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_exame(
    eid: int,
    motivo: str = Query(default="", max_length=500),
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("tfd_exames", "excluir")),
):
    """Remoção da fila com soft delete: preserva o registro + timeline do paciente.

    Exige motivo/justificativa e registra evento com ator, perfil e timestamp.
    """
    from datetime import datetime

    import json as _json

    from app.models.audit import AuditLog

    obj = db.get(ExameFila, eid)
    if not obj or not obj.ativo:
        raise HTTPException(404, "Exame não encontrado")
    motivo_limpo = (motivo or "").strip()
    if not motivo_limpo:
        raise HTTPException(400, "Informe o motivo da remoção da fila.")
    agora = datetime.now()
    perfil = (
        "Superuser" if bool(getattr(ator, "is_superuser", False))
        else ("Médico" if tem_tela(ator, "tfd_medico") else "Operador")
    )
    obj.ativo = False
    obj.motivo_remocao = motivo_limpo[:500]
    obj.removido_em = agora
    obj.removido_por = f"{ator.nome or ator.username} ({perfil})"[:120]
    db.add(obj)
    db.add(AuditLog(
        user_id=ator.id,
        user_name=(ator.nome or ator.username or "")[:120],
        action="EXAM_REMOVE",
        entity="EXAM",
        entity_id=obj.id,
        details=_json.dumps({
            "evento": "remocao_fila",
            "exame": (obj.exame or "")[:80],
            "status_anterior": obj.status or "",
            "motivo": motivo_limpo[:500],
            "perfil": perfil,
            "removido_em": agora.strftime("%d/%m/%Y %H:%M:%S"),
        }, ensure_ascii=False)[:2000],
        timestamp=agora,
    ))
    db.commit()


@router.post("/exames/{eid}/regenerar-token", response_model=ExameOut)
def regenerar_token(eid: int, db: Session = Depends(get_db), _=Depends(need_perm("tfd_exames", "criar"))):
    import secrets

    obj = db.get(ExameFila, eid)
    if not obj or not obj.ativo:
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
    if not obj or not obj.ativo:
        raise HTTPException(404, "Pedido não encontrado")
    rank = _rank_por_grupo(db)
    pos, total_grupo, rotulo = rank.get(obj.id, (None, None, ""))
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
            grupo_fila=rotulo or "",
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
    _=Depends(need_perm("tfd_exames")),
):
    """Catálogo dinâmico + agregado da fila.

    Fonte primária: tfd_procedimentos (CRUD). Fallback: agregação
    tfd_exames_fila (legado). Busca por código, nome, curto ou tipo.
    """
    from sqlalchemy import func as sa_func

    ql = (q or "").strip().lower()

    out: list[dict] = []
    codigos_tfd = set()
    # 1) Catálogo do TFD (CRUD dinâmico)
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
        codigos_tfd.add((p.codigo or "").strip())
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
    # 2) Integração opcional com tabela oficial SIGTAP
    try:
        from app.models.lab_exames import SigtapProcedimento
        base_sig = select(SigtapProcedimento).order_by(SigtapProcedimento.descricao)
        if ql:
            like = f"%{ql}%"
            base_sig = select(SigtapProcedimento).where(
                (SigtapProcedimento.codigo.ilike(like))
                | (SigtapProcedimento.descricao.ilike(like))
            ).order_by(SigtapProcedimento.descricao)
        for s in db.exec(base_sig.limit(80)).all():
            cod = (s.codigo or "").strip()
            if not cod or cod in codigos_tfd:
                continue
            out.append({
                "exame": f"{cod} - {s.descricao}",
                "nome_procedimento": s.descricao,
                "codigo_procedimento": cod,
                "especialidade": "",
                "codigo_especialidade": "",
                "nome_especialidade": "",
                "tipo_fila": "",
                "codigo_curto": "",
                "rotulo": f"{cod} · {s.descricao}",
                "usos": 0,
                "origem": "sigtap",
                "instrumento": s.instrumento or "BPA-C",
            })
            codigos_tfd.add(cod)
    except Exception:
        pass
    if ql:
        return out[:50]
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
    _=Depends(need_perm("tfd_catalogo")),
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
def criar_tipo(data: TipoFilaIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_catalogo", "criar"))):
    nome = data.nome.strip().upper()
    if db.exec(select(TipoFila).where(TipoFila.nome == nome)).first():
        raise HTTPException(400, "Tipo já cadastrado")
    obj = TipoFila(codigo=data.codigo.strip(), nome=nome, ativo=data.ativo)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/tipos/{tid}", response_model=TipoFilaOut)
def atualizar_tipo(tid: int, data: TipoFilaIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_catalogo", "editar"))):
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
def excluir_tipo(tid: int, db: Session = Depends(get_db), _=Depends(need_perm("tfd_catalogo", "excluir"))):
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
    _=Depends(need_perm("tfd_catalogo")),
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
def criar_procedimento(data: ProcedimentoIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_catalogo", "criar"))):
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
def atualizar_procedimento(pid: int, data: ProcedimentoIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_catalogo", "editar"))):
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
def excluir_procedimento(pid: int, db: Session = Depends(get_db), _=Depends(need_perm("tfd_catalogo", "excluir"))):
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
    _=Depends(need_perm("tfd_catalogo")),
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
def criar_especialidade(data: EspecialidadeIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_catalogo", "criar"))):
    cbo = data.codigo_cbo.strip()
    if db.exec(select(Especialidade).where(Especialidade.codigo_cbo == cbo)).first():
        raise HTTPException(400, "CBO já cadastrado")
    obj = Especialidade(codigo_cbo=cbo, nome=data.nome.strip(), ativo=data.ativo)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/especialidades/{eid}", response_model=EspecialidadeOut)
def atualizar_especialidade(eid: int, data: EspecialidadeIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_catalogo", "editar"))):
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
def excluir_especialidade(eid: int, db: Session = Depends(get_db), _=Depends(need_perm("tfd_catalogo", "excluir"))):
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
    _=Depends(need_perm("tfd_faturamento")),
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


@router.get("/faturamento/exportar")
def exportar_faturamento(
    competencia: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("tfd_faturamento")),
):
    """Faturamento TFD em XLSX respeitando a competência ativa."""
    from app.services.export_xlsx import resposta_xlsx

    base = select(Faturamento).order_by(Faturamento.id.desc())
    if competencia:
        base = select(Faturamento).where(
            Faturamento.competencia == competencia
        ).order_by(Faturamento.id.desc())
    linhas = []
    for f in list(db.exec(base).all())[:20000]:
        pac = db.get(Paciente, f.paciente_id)
        linhas.append({
            "paciente": pac.nome if pac else "?", "procedimento": f.procedimento,
            "sigtap": f.codigo_sigtap or "", "competencia": f.competencia,
            "qtd": f.quantidade, "valor": float(f.valor or 0),
            "total": round(float(f.valor or 0) * f.quantidade, 2),
            "tipo": f.tipo, "status": f.status,
        })
    return resposta_xlsx(
        f"Faturamento TFD{f' — {competencia}' if competencia else ''}",
        ator.nome or ator.username,
        [
            {"chave": "paciente", "rotulo": "Paciente", "largura": 32},
            {"chave": "procedimento", "rotulo": "Procedimento", "largura": 40},
            {"chave": "sigtap", "rotulo": "Código SIGTAP", "largura": 16},
            {"chave": "competencia", "rotulo": "Competência", "largura": 12},
            {"chave": "qtd", "rotulo": "Qtd", "largura": 8},
            {"chave": "valor", "rotulo": "Valor unit.", "largura": 14, "formato": "moeda"},
            {"chave": "total", "rotulo": "Total", "largura": 14, "formato": "moeda"},
            {"chave": "tipo", "rotulo": "Tipo", "largura": 10},
            {"chave": "status", "rotulo": "Status", "largura": 12},
        ],
        linhas, "faturamento_tfd",
    )


@router.post("/faturamento", response_model=FaturaOut, status_code=201)
def criar_fatura(data: FaturaIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_faturamento", "criar"))):
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
    fid: int, data: FaturaIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_faturamento", "editar"))
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
def excluir_fatura(fid: int, db: Session = Depends(get_db), _=Depends(need_perm("tfd_faturamento", "excluir"))):
    obj = db.get(Faturamento, fid)
    if not obj:
        raise HTTPException(404, "Fatura não encontrada")
    db.delete(obj)
    db.commit()


# ---------- Quadro de viagens: fila de espera p/ transporte ----------
def _fila_out(db: Session, o) -> ViagemFilaOut:
    pac = db.get(Paciente, o.paciente_id)
    return ViagemFilaOut(
        **o.model_dump(),
        paciente_nome=pac.nome if pac else "?",
        paciente_cpf=pac.cpf if pac else "",
        paciente_nascimento=pac.nascimento if pac else None,
    )


@router.get("/viagens-fila", response_model=list[ViagemFilaOut])
def listar_fila_viagem(
    destino: str = Query(default="", max_length=120),
    status_: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    _=Depends(need_perm("tfd_viagens")),
):
    base = select(ViagemFila).order_by(ViagemFila.created_at)
    filtros = []
    if destino:
        filtros.append(ViagemFila.destino.ilike(f"%{destino}%"))
    if status_:
        filtros.append(ViagemFila.status == status_)
    else:
        filtros.append(ViagemFila.status.in_(["aguardando", "alocado"]))
    if filtros:
        base = select(ViagemFila).where(*filtros).order_by(ViagemFila.created_at)
    return [_fila_out(db, o) for o in db.exec(base).all()]


@router.post("/viagens-fila", response_model=ViagemFilaOut, status_code=201)
def criar_fila_viagem(
    data: ViagemFilaIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_viagens", "criar"))
):
    if not db.get(Paciente, data.paciente_id):
        raise HTTPException(404, "Paciente não encontrado")
    dados = data.model_dump()
    if data.acompanhante_id:
        acomp = db.get(Paciente, data.acompanhante_id)
        if not acomp:
            raise HTTPException(404, "Acompanhante não encontrado")
        if acomp.id == data.paciente_id:
            raise HTTPException(400, "Acompanhante não pode ser o próprio paciente")
        dados["acompanhante"] = True
        dados["acompanhante_nome"] = (data.acompanhante_nome or acomp.nome)[:150]
        dados["acompanhante_cpf"] = (data.acompanhante_cpf or acomp.cpf or "")[:14]
    elif data.acompanhante and not (data.acompanhante_nome or "").strip():
        dados["acompanhante_nome"] = ""
    obj = ViagemFila(**dados)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _fila_out(db, obj)


@router.put("/viagens-fila/{fid}", response_model=ViagemFilaOut)
def atualizar_fila_viagem(
    fid: int, data: ViagemFilaIn, db: Session = Depends(get_db), _=Depends(need_perm("tfd_viagens", "editar"))
):
    obj = db.get(ViagemFila, fid)
    if not obj:
        raise HTTPException(404, "Registro não encontrado")
    if not db.get(Paciente, data.paciente_id):
        raise HTTPException(404, "Paciente não encontrado")
    dados = data.model_dump()
    if data.acompanhante_id:
        acomp = db.get(Paciente, data.acompanhante_id)
        if not acomp:
            raise HTTPException(404, "Acompanhante não encontrado")
        if acomp.id == data.paciente_id:
            raise HTTPException(400, "Acompanhante não pode ser o próprio paciente")
        dados["acompanhante"] = True
        dados["acompanhante_nome"] = (data.acompanhante_nome or acomp.nome)[:150]
        dados["acompanhante_cpf"] = (data.acompanhante_cpf or acomp.cpf or "")[:14]
    elif not data.acompanhante:
        dados["acompanhante_id"] = None
        dados["acompanhante_nome"] = ""
        dados["acompanhante_cpf"] = ""
    for k, v in dados.items():
        setattr(obj, k, v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _fila_out(db, obj)


@router.delete("/viagens-fila/{fid}", status_code=204)
def excluir_fila_viagem(fid: int, db: Session = Depends(get_db), _=Depends(need_perm("tfd_viagens", "excluir"))):
    obj = db.get(ViagemFila, fid)
    if not obj:
        raise HTTPException(404, "Registro não encontrado")
    if obj.status == "alocado":
        raise HTTPException(400, "Devolva o paciente à fila antes de excluir")
    db.delete(obj)
    db.commit()


def _candidatos_puxar(db: Session, data: str | None) -> list:
    """Agendados ainda fora da fila de transporte (prévia do puxar)."""
    base = select(ExameFila).where(ExameFila.ativo == True, ExameFila.status == "agendado")  # noqa: E712
    if data:
        base = select(ExameFila).where(
            ExameFila.ativo == True,  # noqa: E712
            ExameFila.status == "agendado",
            func.to_char(ExameFila.data_agendada, "YYYY-MM-DD") == data,
        )
    existentes = {
        (o.exame_fila_id) for o in db.exec(
            select(ViagemFila).where(ViagemFila.status.in_(["aguardando", "alocado"]))
        ).all() if o.exame_fila_id
    }
    return [e for e in db.exec(base.order_by(ExameFila.data_agendada)).all()
            if e.id not in existentes]


def _candidato_out(db: Session, e) -> dict:
    pac = db.get(Paciente, e.paciente_id)
    return {
        "exame_fila_id": e.id,
        "paciente_id": e.paciente_id,
        "paciente_nome": pac.nome if pac else "?",
        "exame": e.exame or "",
        "destino": (e.unidade_nome or e.destino or "").strip() or "A definir",
        "unidade": e.unidade_nome or "",
        "data_agendada": e.data_agendada.isoformat() if e.data_agendada else "",
        "hora_agendada": e.hora_agendada or "",
        "prioridade": e.prioridade or "rotina",
    }


@router.get("/viagens-fila/candidatos-agendados")
def candidatos_puxar(
    data: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    db: Session = Depends(get_db),
    _=Depends(need_perm("tfd_viagens")),
):
    """Prévia do puxar-agendados: quem entraria na fila (p/ seleção no dialog)."""
    return [_candidato_out(db, e) for e in _candidatos_puxar(db, data)]


@router.post("/viagens-fila/puxar-agendados", response_model=dict)
def puxar_agendados(
    data: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    corpo: dict | None = Body(default=None),
    db: Session = Depends(get_db),
    _=Depends(need_perm("tfd_viagens", "criar")),
):
    """Traz exames/consultas com data marcada para a fila de transporte.

    body {"ids": [...]} limita aos selecionados no dialog; sem "ids",
    mantém o comportamento legado (todos os candidatos).
    """
    ids = None
    if isinstance(corpo, dict) and "ids" in corpo:
        ids = corpo.get("ids") or []
        try:
            ids = {int(i) for i in ids}
        except (TypeError, ValueError):
            raise HTTPException(400, "IDs inválidos")
    criados = 0
    ignorados = 0
    for e in _candidatos_puxar(db, data):
        if ids is not None and e.id not in ids:
            ignorados += 1
            continue
        db.add(ViagemFila(
            paciente_id=e.paciente_id,
            destino=(e.unidade_nome or e.destino or "").strip() or "A definir",
            unidade=e.unidade_nome or "",
            tratamento=(e.exame or "")[:150],
            data_consulta=e.data_agendada,
            hora_consulta=e.hora_agendada or "",
            acompanhante=False,
            prioridade=e.prioridade or "rotina",
            status="aguardando",
            exame_fila_id=e.id,
        ))
        criados += 1
    db.commit()
    return {"criados": criados, "ignorados": ignorados}


# ---------- Quadro semanal: dia por destino + frota ----------
def _assentos(db: Session, viagem_id: int) -> tuple[int, int]:
    """(ocupados, capacidade): cada presente conta 1 assento +1 p/ acompanhante."""
    viagem = db.get(Viagem, viagem_id)
    cap = 0
    if viagem and viagem.veiculo_id:
        veh = db.get(Veiculo, viagem.veiculo_id)
        cap = veh.capacidade if veh else 0
    ocup = 0
    for p in db.exec(select(ViagemPaciente).where(ViagemPaciente.viagem_id == viagem_id)).all():
        if not p.presente:
            continue
        tem_acomp = bool((p.acompanhante or "").strip() or getattr(p, "acompanhante_id", None))
        ocup += 2 if tem_acomp else 1
    return ocup, cap


def _passageiro_out(db: Session, p) -> dict:
    pac = db.get(Paciente, p.paciente_id)
    acomp_id = getattr(p, "acompanhante_id", None)
    acomp = db.get(Paciente, acomp_id) if acomp_id else None
    acomp_nome = (p.acompanhante or "").strip() or (acomp.nome if acomp else "")
    return {
        "id": p.id, "viagem_id": p.viagem_id, "paciente_id": p.paciente_id,
        "paciente_nome": pac.nome if pac else "?",
        "paciente_cpf": pac.cpf if pac else "",
        "paciente_nascimento": pac.nascimento.isoformat() if pac and pac.nascimento else None,
        "acompanhante": acomp_nome, "presente": p.presente,
        "acompanhante_id": acomp_id,
        "acompanhante_nome": acomp.nome if acomp else acomp_nome,
        "acompanhante_cpf": getattr(p, "acompanhante_cpf", "") or (acomp.cpf if acomp else ""),
        "viagem_fila_id": p.viagem_fila_id,
        "tratamento": p.tratamento or "", "unidade": p.unidade or "",
        "hora_consulta": p.hora_consulta or "",
    }


DURACAO_PADRAO_MIN = 9 * 60


def _minutos(hhmm: str | None) -> int | None:
    """'HH:MM' -> minutos desde 00h. None se inválido/vazio."""
    import re as _re

    if not hhmm or not _re.fullmatch(r"\d{1,2}:\d{2}", (hhmm or "").strip()):
        return None
    h, m = (hhmm or "").strip().split(":")
    h, m = int(h), int(m)
    if h > 23 or m > 59:
        return None
    return h * 60 + m


def _janela(saida: str | None, retorno: str | None) -> tuple[int, int]:
    """Intervalo efetivo da viagem em minutos (retorno vazio/curto => +9h)."""
    ini = _minutos(saida)
    if ini is None:
        ini = 5 * 60
    fim = _minutos(retorno)
    if fim is None or fim <= ini:
        fim = ini + DURACAO_PADRAO_MIN
    return ini, fim


def _sobrepoe(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return max(a[0], b[0]) < min(a[1], b[1])


def _norm_nome(s: str | None) -> str:
    return " ".join((s or "").strip().upper().split())


def _conflitos_viagem(db, data_viagem, saida: str, retorno: str,
                      veiculo_id, motorista_id, motorista_nome: str,
                      ignorar_id: int | None = None) -> tuple:
    """Viagens na mesma data com sobreposição p/ o mesmo veículo/motorista."""
    from datetime import date as _date

    iso = data_viagem.isoformat() if isinstance(data_viagem, _date) else str(data_viagem or "")
    if not iso:
        return None, None
    janela = _janela(saida, retorno)
    nome = _norm_nome(motorista_nome)
    conflito_veiculo = None
    conflito_motorista = None
    for v in db.exec(select(Viagem).where(
            func.to_char(Viagem.data_viagem, "YYYY-MM-DD") == iso)).all():
        if ignorar_id and v.id == ignorar_id:
            continue
        outra = _janela(v.hora_saida, v.hora_retorno)
        if not _sobrepoe(janela, outra):
            continue
        if veiculo_id and v.veiculo_id and int(v.veiculo_id) == int(veiculo_id):
            conflito_veiculo = v
        mid = getattr(v, "motorista_id", None)
        mesmo_id = bool(motorista_id and mid and int(mid) == int(motorista_id))
        mesmo_nome = bool(nome and _norm_nome(v.motorista) == nome)
        if mesmo_id or mesmo_nome:
            conflito_motorista = v
        if conflito_veiculo and conflito_motorista:
            break
    return conflito_veiculo, conflito_motorista


def _exigir_sem_conflito(db, data_viagem, saida: str, retorno: str,
                         veiculo_id, motorista_id, motorista_nome: str,
                         ignorar_id: int | None = None) -> None:
    cv, cm = _conflitos_viagem(db, data_viagem, saida, retorno, veiculo_id,
                               motorista_id, motorista_nome, ignorar_id)
    if cv is not None:
        raise HTTPException(
            400,
            f"Veículo indisponível: já alocado na {_nome_viagem(cv.destino, cv.hora_saida, cv.id)} "
            f"({(cv.hora_saida or '').strip() or 's/ horário'}"
            f"→{(cv.hora_retorno or '').strip() or 's/ retorno'}) no mesmo dia/horário.",
        )
    if cm is not None:
        quem = (motorista_nome or "").strip() or (cm.motorista or "").strip() or "motorista"
        raise HTTPException(
            400,
            f"Motorista indisponível: {quem} já alocado na "
            f"{_nome_viagem(cm.destino, cm.hora_saida, cm.id)} no mesmo dia/horário.",
        )


def _nome_viagem(destino: str, hora_saida: str, vid: int | None = None) -> str:
    """Nome dinâmico da viagem (nunca exibe placa/código solto como título)."""
    base = f"Viagem - {(destino or 'A definir').strip() or 'A definir'} - {(hora_saida or '').strip() or 's/ horário'}"
    return f"{base} #{vid}" if vid else base


def _dia_payload(db: Session, data: str, redigir_pacientes: bool = False) -> dict:
    """Quadro de um dia: destinos com viagens, veículos, vagas e passageiros.

    redigir_pacientes=True (perfil frota_gestao): oculta PII dos passageiros,
    mantendo contagens p/ gestão de veículos/motoristas.
    """
    viagens = list(db.exec(
        select(Viagem).where(func.to_char(Viagem.data_viagem, "YYYY-MM-DD") == data)
        .order_by(Viagem.destino, Viagem.hora_saida)
    ).all())
    alocados = {v.veiculo_id for v in viagens if v.veiculo_id}
    por_destino: dict[str, list] = {}
    for v in viagens:
        veh = db.get(Veiculo, v.veiculo_id) if v.veiculo_id else None
        ocup, cap = _assentos(db, v.id)
        if redigir_pacientes:
            passageiros = []
        else:
            passageiros = [_passageiro_out(db, p) for p in db.exec(
                select(ViagemPaciente).where(ViagemPaciente.viagem_id == v.id)
            ).all()]
        por_destino.setdefault(v.destino or "A definir", []).append({
            "id": v.id, "nome": _nome_viagem(v.destino, v.hora_saida, v.id),
            "destino": v.destino, "unidade": v.unidade or "",
            "data_viagem": v.data_viagem.isoformat() if v.data_viagem else "",
            "hora_saida": v.hora_saida or "",
            "hora_retorno": v.hora_retorno or "",
            "motorista": v.motorista or "",
            "motorista_id": getattr(v, "motorista_id", None),
            "status": v.status, "finalidade": v.finalidade or "",
            "veiculo_id": v.veiculo_id,
            "veiculo_placa": veh.placa if veh else "",
            "veiculo_modelo": veh.modelo if veh else "",
            "capacidade": cap, "ocupados": ocup, "vagas": max(cap - ocup, 0),
            "passageiros": passageiros,
            "passageiros_restritos": redigir_pacientes,
        })
    frota = []
    for veh in db.exec(select(Veiculo).where(Veiculo.ativo == True).order_by(Veiculo.placa)).all():  # noqa: E712
        frota.append({
            "id": veh.id, "placa": veh.placa, "modelo": veh.modelo or "",
            "tipo": veh.tipo, "capacidade": veh.capacidade,
            "status": veh.status or "disponivel",
            "em_outra_viagem": veh.id in alocados,
        })
    return {
        "data": data,
        "destinos": [
            {"destino": d, "viagens": vs,
             "demanda_aguardando": db.exec(select(func.count(ViagemFila.id)).where(
                 ViagemFila.destino == d, ViagemFila.status == "aguardando")).one() or 0}
            for d, vs in sorted(por_destino.items())
        ],
        "frota": frota,
    }


@router.get("/viagens/dia")
def dia_viagens(
    data: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    db: Session = Depends(get_db),
    user: User = Depends(need_any_perm("tfd_viagens", "tfd_frota_gestao")),
):
    """Quadro do dia: destinos com viagens, veículos, vagas e passageiros."""
    return _dia_payload(db, data, redigir_pacientes=not tem_tela(user, "tfd_viagens"))


@router.get("/viagens/semana")
def semana_viagens(
    inicio: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    db: Session = Depends(get_db),
    user: User = Depends(need_any_perm("tfd_viagens", "tfd_frota_gestao")),
):
    """Grade semanal (7 dias a partir de `inicio`): viagens + frota."""
    from datetime import date as _date

    redigir = not tem_tela(user, "tfd_viagens")
    ano, mes, dia = int(inicio[0:4]), int(inicio[5:7]), int(inicio[8:10])
    base = _date(ano, mes, dia)
    dias = []
    for i in range(7):
        d = base.fromordinal(base.toordinal() + i).isoformat()
        dias.append(_dia_payload(db, d, redigir_pacientes=redigir))
    frota = dias[0].get("frota", []) if dias else []
    for d in dias:
        d.pop("frota", None)
    return {"inicio": inicio, "dias": dias, "frota": frota}


@router.get("/viagens/sugestao")
def sugestao_frota(
    data: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    destino: str = Query(min_length=2, max_length=120),
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("tfd_viagens", "tfd_frota_gestao")),
):
    """Sugere o veículo ideal p/ a demanda do destino no dia.

    Só conta a fila com data marcada para o dia (fila contínua sem data
    fixa não força sugestão automática).
    """
    fila = list(db.exec(select(ViagemFila).where(
        ViagemFila.destino == destino, ViagemFila.status == "aguardando",
        func.to_char(ViagemFila.data_consulta, "YYYY-MM-DD") == data)).all())
    assentos = sum(2 if f.acompanhante else 1 for f in fila)
    viagens_dia = list(db.exec(select(Viagem).where(
        func.to_char(Viagem.data_viagem, "YYYY-MM-DD") == data)).all())
    alocados = {v.veiculo_id for v in viagens_dia if v.veiculo_id}
    livres = [v for v in db.exec(select(Veiculo).where(
        Veiculo.ativo == True, Veiculo.status == "disponivel"  # noqa: E712
    ).order_by(Veiculo.capacidade)).all() if v.id not in alocados]
    if not livres:
        livres = [v for v in db.exec(select(Veiculo).where(
            Veiculo.ativo == True, Veiculo.status == "disponivel"  # noqa: E712
        ).order_by(Veiculo.capacidade)).all()]
    cabe = [v for v in livres if (v.capacidade or 0) >= assentos]
    if cabe:
        esc = cabe[0]
        motivo = f"Menor veículo com {esc.capacidade} vagas p/ {assentos} assento(s) demandados"
    elif livres:
        esc = livres[-1]
        motivo = f"Maior disponível ({esc.capacidade} vagas) — demanda de {assentos} assento(s) excede a frota livre"
    else:
        return {"veiculo": None, "demanda": len(fila), "assentos": assentos, "motivo": "Sem veículo disponível na frota"}
    return {
        "veiculo": {"id": esc.id, "placa": esc.placa, "modelo": esc.modelo or "",
                    "tipo": esc.tipo, "capacidade": esc.capacidade},
        "demanda": len(fila), "assentos": assentos, "motivo": motivo,
    }


def _relatorio_frota(db: Session, de: str | None, ate: str | None) -> dict:
    """Métricas da frota no período (sem PII: só agregados por veículo/motorista)."""
    base = select(Viagem)
    filtros = []
    if de:
        filtros.append(func.to_char(Viagem.data_viagem, "YYYY-MM-DD") >= de)
    if ate:
        filtros.append(func.to_char(Viagem.data_viagem, "YYYY-MM-DD") <= ate)
    if filtros:
        base = select(Viagem).where(*filtros)
    viagens = list(db.exec(base.order_by(Viagem.data_viagem)).all())
    veiculos = {v.id: v for v in db.exec(select(Veiculo)).all()}
    por_veiculo: dict[int, dict] = {}
    por_motorista: dict[str, dict] = {}
    totais = {"agendada": 0, "andamento": 0, "concluida": 0, "cancelada": 0}
    km_total = 0
    soma_ocup = 0.0
    n_ocup = 0
    for v in viagens:
        st = (v.status or "agendada")
        totais[st] = totais.get(st, 0) + 1
        km = (v.km_final - v.km_inicial) if (v.km_final and v.km_inicial and v.km_final >= v.km_inicial) else 0
        km_total += km
        ocup, cap = _assentos(db, v.id)
        taxa = (ocup / cap) if cap else 0
        if cap:
            soma_ocup += taxa
            n_ocup += 1
        veh = veiculos.get(v.veiculo_id) if v.veiculo_id else None
        chave_v = v.veiculo_id or 0
        agg_v = por_veiculo.setdefault(chave_v, {
            "veiculo_id": v.veiculo_id, "placa": veh.placa if veh else "A definir",
            "modelo": veh.modelo if veh else "", "viagens": 0, "km": 0,
            "soma_ocup": 0.0, "n_ocup": 0,
        })
        agg_v["viagens"] += 1
        agg_v["km"] += km
        if cap:
            agg_v["soma_ocup"] += taxa
            agg_v["n_ocup"] += 1
        mot = (v.motorista or "").strip() or "A definir"
        agg_m = por_motorista.setdefault(mot, {"motorista": mot, "viagens": 0, "km": 0})
        agg_m["viagens"] += 1
        agg_m["km"] += km
    lista_v = sorted(
        ({"veiculo_id": a["veiculo_id"], "placa": a["placa"], "modelo": a["modelo"],
          "viagens": a["viagens"], "km": a["km"],
          "ocupacao_media": round(a["soma_ocup"] / a["n_ocup"], 3) if a["n_ocup"] else 0}
         for a in por_veiculo.values()),
        key=lambda x: x["viagens"], reverse=True,
    )
    lista_m = sorted(por_motorista.values(), key=lambda x: x["viagens"], reverse=True)
    return {
        "periodo": {"de": de or "", "ate": ate or ""},
        "total_viagens": len(viagens),
        "por_status": totais,
        "km_total": km_total,
        "ocupacao_media": round(soma_ocup / n_ocup, 3) if n_ocup else 0,
        "por_veiculo": lista_v,
        "por_motorista": lista_m,
        "mais_usado_veiculo": lista_v[0] if lista_v else None,
        "mais_usado_motorista": lista_m[0] if lista_m else None,
    }


@router.get("/frota/relatorio")
def relatorio_frota(
    de: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    ate: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("tfd_frota", "tfd_viagens", "tfd_frota_gestao")),
):
    """Painel da frota: viagens por período, km, uso por veículo/motorista e ocupação."""
    if de and ate and de > ate:
        raise HTTPException(400, "Período inválido")
    return _relatorio_frota(db, de, ate)


@router.get("/frota/relatorio/exportar")
def exportar_relatorio_frota(
    de: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    ate: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("tfd_frota", "tfd_viagens", "tfd_frota_gestao")),
):
    """Relatório da frota em XLSX respeitando o período filtrado."""
    from app.services.export_xlsx import resposta_xlsx

    if de and ate and de > ate:
        raise HTTPException(400, "Período inválido")
    rel = _relatorio_frota(db, de, ate)
    linhas = [
        {"grupo": "Por veículo", "item": v["placa"], "detalhe": v["modelo"],
         "viagens": v["viagens"], "km": v["km"], "ocupacao": v["ocupacao_media"]}
        for v in rel["por_veiculo"]
    ] + [
        {"grupo": "Por motorista", "item": m["motorista"], "detalhe": "",
         "viagens": m["viagens"], "km": m["km"], "ocupacao": ""}
        for m in rel["por_motorista"]
    ]
    return resposta_xlsx(
        f"Relatório da frota ({rel['periodo']['de'] or '…'} a {rel['periodo']['ate'] or '…'})",
        ator.nome or ator.username,
        [
            {"chave": "grupo", "rotulo": "Grupo", "largura": 16},
            {"chave": "item", "rotulo": "Veículo/Motorista", "largura": 28},
            {"chave": "detalhe", "rotulo": "Modelo", "largura": 24},
            {"chave": "viagens", "rotulo": "Viagens", "largura": 12},
            {"chave": "km", "rotulo": "Km rodados", "largura": 14},
            {"chave": "ocupacao", "rotulo": "Ocupação média", "largura": 16},
        ],
        linhas, "relatorio_frota",
    )


@router.get("/viagens/disponibilidade")
def disponibilidade_frota(
    data: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    saida: str = Query(default="", max_length=5),
    retorno: str = Query(default="", max_length=5),
    ignorar_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("tfd_viagens", "tfd_frota_gestao")),
):
    """Veículos e motoristas livres no dia/intervalo (sem sobreposição).

    Intervalo efetivo: saída → retorno; retorno vazio/anterior => +9h.
    `ignorar_id` exclui a própria viagem na edição/troca.
    """
    from datetime import date as _date

    ano, mes, dia = int(data[0:4]), int(data[5:7]), int(data[8:10])
    janela = _janela(saida, retorno)
    viagens = list(db.exec(select(Viagem).where(
        func.to_char(Viagem.data_viagem, "YYYY-MM-DD") == data)).all())
    if ignorar_id:
        viagens = [v for v in viagens if v.id != ignorar_id]
    veiculos_out = []
    for veh in db.exec(select(Veiculo).where(
            Veiculo.ativo == True).order_by(Veiculo.placa)).all():  # noqa: E712
        ocupado_por = None
        for v in viagens:
            if v.veiculo_id and int(v.veiculo_id) == int(veh.id or 0):
                if _sobrepoe(janela, _janela(v.hora_saida, v.hora_retorno)):
                    ocupado_por = _nome_viagem(v.destino, v.hora_saida, v.id)
                    break
        veiculos_out.append({
            "id": veh.id, "placa": veh.placa, "modelo": veh.modelo or "",
            "tipo": veh.tipo, "capacidade": veh.capacidade,
            "status": veh.status or "disponivel",
            "disponivel": ocupado_por is None and (veh.status or "") != "manutencao",
            "ocupado_por": ocupado_por,
        })
    mots = list(db.exec(select(Motorista).where(
        Motorista.ativo == True).order_by(Motorista.nome)).all())  # noqa: E712
    motoristas_out = []
    for m in mots:
        ocupado_por = None
        for v in viagens:
            mid = getattr(v, "motorista_id", None)
            if (mid and m.id and int(mid) == int(m.id)) or                (_norm_nome(v.motorista) == _norm_nome(m.nome) and _norm_nome(m.nome)):
                if _sobrepoe(janela, _janela(v.hora_saida, v.hora_retorno)):
                    ocupado_por = _nome_viagem(v.destino, v.hora_saida, v.id)
                    break
        motoristas_out.append({
            "id": m.id, "nome": m.nome,
            "disponivel": ocupado_por is None, "ocupado_por": ocupado_por,
        })
    return {
        "data": data,
        "janela": {"saida": saida, "retorno": retorno},
        "veiculos": veiculos_out,
        "motoristas": motoristas_out,
    }


@router.get("/viagens/{vid}", response_model=ViagemOut)
def obter_viagem(
    vid: int, db: Session = Depends(get_db),
    _=Depends(need_any_perm("tfd_viagens", "tfd_frota_gestao")),
):
    """Detalhe da viagem p/ edição direta na visão semanal."""
    obj = db.get(Viagem, vid)
    if not obj:
        raise HTTPException(404, "Viagem não encontrada")
    n = db.exec(
        select(func.count(ViagemPaciente.id)).where(ViagemPaciente.viagem_id == vid)
    ).one()
    placa = ""
    if obj.veiculo_id:
        veh = db.get(Veiculo, obj.veiculo_id)
        placa = veh.placa if veh else ""
    return ViagemOut(**obj.model_dump(), passageiros=n or 0, veiculo_placa=placa)


@router.get("/viagens/{vid}/ordem-circulacao")
def ordem_circulacao(
    vid: int,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("tfd_viagens")),
):
    """Ordem de Circulação de Veículos no padrão do município.

    Usa o modelo original (.odt) preenchendo só os campos; sem o modelo,
    gera .docx equivalente.
    """
    from fastapi import Response

    _ = ator
    v = db.get(Viagem, vid)
    if not v:
        raise HTTPException(404, "Viagem não encontrada")
    veh = db.get(Veiculo, v.veiculo_id) if v.veiculo_id else None
    passageiros = [_passageiro_out(db, p) for p in db.exec(
        select(ViagemPaciente).where(ViagemPaciente.viagem_id == vid)).all()]
    dados = {
        "veiculo": veh.modelo if veh else "",
        "placa": veh.placa if veh else "",
        "destino": v.destino or "",
        "motorista": v.motorista or "",
        "departamento": v.departamento or "",
        "data_saida": v.data_viagem.isoformat() if v.data_viagem else "",
        "hora_saida": v.hora_saida or "",
        "km_inicial": str(v.km_inicial or ""),
        "data_retorno": v.data_retorno.isoformat() if v.data_retorno else "",
        "hora_retorno": v.hora_retorno or "",
        "km_final": str(v.km_final or ""),
        "adiantamento": (
            f"{float(v.adiantamento or 0):.2f}".replace(".", ",") if v.adiantamento else ""
        ),
        "horas_viagem": "",
        "km_rodados": (
            str(v.km_final - v.km_inicial)
            if v.km_final and v.km_inicial and v.km_final >= v.km_inicial else ""
        ),
    }
    lista = [{
        "paciente_nome": p.get("paciente_nome", ""),
        "paciente_nascimento": (p.get("paciente_nascimento") or "")[:10],
        "tratamento": p.get("tratamento", ""),
        "unidade": p.get("unidade", ""),
        "hora_consulta": p.get("hora_consulta", ""),
    } for p in passageiros]

    import os as _os

    from app.services.preencher_odt import MODELO as _MODELO, preencher_ordem as _preencher

    placa = (veh.placa if veh else "splaca").replace("/", "-")
    if _os.path.exists(_MODELO):
        blob = _preencher(dados, lista)
        return Response(
            content=blob,
            media_type="application/vnd.oasis.opendocument.text",
            headers={
                "Content-Disposition": f'attachment; filename="ordem_circulacao_{placa}_{v.data_viagem}.odt"',
                "Cache-Control": "no-store",
            },
        )
    from app.services.ordem_circulacao import gerar_ordem

    blob = gerar_ordem(
        veiculo_modelo=dados["veiculo"],
        placa=dados["placa"],
        destino=dados["destino"],
        motorista=dados["motorista"],
        departamento=dados["departamento"],
        data_saida=dados["data_saida"],
        hora_saida=dados["hora_saida"],
        data_retorno=dados["data_retorno"],
        hora_retorno=dados["hora_retorno"],
        km_inicial=v.km_inicial or 0,
        km_final=v.km_final or 0,
        adiantamento=float(v.adiantamento or 0),
        passageiros=[{
            "paciente_nome": x["paciente_nome"],
            "paciente_nascimento": x["paciente_nascimento"],
            "tratamento": x["tratamento"],
            "unidade": x["unidade"],
            "hora_consulta": x["hora_consulta"],
        } for x in lista],
    )
    return Response(
        content=blob,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f'attachment; filename="ordem_circulacao_{placa}_{v.data_viagem}.docx"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/viagens/{vid}/faturar-deslocamento", response_model=dict)
def faturar_deslocamento(
    vid: int,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("tfd_faturamento", "criar")),
):
    """Lança faturamento SIGTAP de deslocamento (50 km x quantidade do destino).

    Por passageiro: código paciente x qtd; com acompanhante: + código
    acompanhante x qtd. Idempotente por (viagem, paciente, código).
    """
    _ = ator
    v = db.get(Viagem, vid)
    if not v:
        raise HTTPException(404, "Viagem não encontrada")
    dest = db.exec(select(Destino).where(Destino.nome_destino == (v.destino or ""))).first()
    if not dest or not dest.codigo_desloc_pac:
        raise HTTPException(400, f"Destino sem deslocamento SIGTAP cadastrado ({v.destino or '—'})")
    try:
        comp = v.data_viagem.strftime("%Y-%m") if v.data_viagem else ""
    except Exception:
        comp = ""
    criados = pula = 0
    passageiros = list(db.exec(select(ViagemPaciente).where(ViagemPaciente.viagem_id == vid)).all())
    for p in passageiros:
        itens = [(dest.codigo_desloc_pac, dest.qtd_desloc_pac or 0)]
        if (p.acompanhante or "").strip() and dest.codigo_desloc_acomp:
            itens.append((dest.codigo_desloc_acomp, dest.qtd_desloc_acomp or 0))
        for cod, qtd in itens:
            if not cod or not qtd:
                pula += 1
                continue
            ja = db.exec(select(Faturamento).where(
                Faturamento.viagem_id == vid,
                Faturamento.paciente_id == p.paciente_id,
                Faturamento.codigo_sigtap == cod,
            )).first()
            if ja:
                pula += 1
                continue
            proc = db.exec(select(ProcedimentoCatalogo).where(
                ProcedimentoCatalogo.codigo == cod)).first()
            db.add(Faturamento(
                viagem_id=vid, paciente_id=p.paciente_id,
                procedimento=(proc.nome if proc else f"DESLOCAMENTO {v.destino}")[:150],
                codigo_sigtap=cod, competencia=comp, quantidade=qtd,
                valor=0, tipo="BPA", status="pendente",
                observacoes=f"Deslocamento {v.destino} ({qtd}x50km)",
            ))
            criados += 1
    db.commit()
    return {"criados": criados, "ignorados": pula}
