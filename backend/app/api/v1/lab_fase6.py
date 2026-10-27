import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, func, select, or_

from app.core.deps import get_current_user_senha_ok as get_current_user, get_db
from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import (
    FilaPsf,
    Laboratorio,
    LabPedidoAjuste,
    SolicitacaoMestre,
    VagaLab,
)
from app.models.tfd import Paciente
from app.services.geradores import gerar_prontuario_aleatorio
from app.core.pagination import Pagina, paginar
from app.schemas.lab_fase6 import (
    AuditoriaIn,
    BpaResumoOut,
    ComprovanteExameOut,
    FilaPsfAgendarLoteIn,
    FilaPsfIn,
    FilaPsfOut,
    FilaPsfStatusIn,
    FilaPsfUpdateIn,
    LaboratorioIn,
    LaboratorioOut,
    PedidoAjusteIn,
    PedidoAjusteOut,
    RespostaAjusteIn,
    SolicMestreIn,
    SolicMestreOut,
    VagaIn,
    VagaLoteMesIn,
    VagaLoteMesOut,
    VagaOut,
)
from app.services.lab_fase6 import (
    agendar_lote_fila,
    analisar_pedido_ajuste,
    auditar_mestre,
    consolidar_bpa_laboratorial,
    criar_solicitacao_mestre,
    enriquecer_mestre,
    enriquecer_mestre_lote,
    gerar_comprovante_agendamento,
    pedir_ajuste_laboratorio,
    recepcionar_coleta,
)

router = APIRouter()


from app.services.permissoes import need_any_perm, need_perm


# ---------- Laboratórios (leitura p/ agenda) ----------
@router.get("/exames/laboratorios", response_model=list[LaboratorioOut])
def listar_labs(
    somente_ativos: bool = True,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Seletores de agendamento: por padrão só laboratórios ativos.

    Desativados (soft delete) somem dos dropdowns mas preservam o
    histórico de exames/vagas já marcados. Passe somente_ativos=false
    na tela de Configurações para gerenciar todos.
    """
    base = select(Laboratorio).order_by(Laboratorio.nome)
    if somente_ativos:
        base = select(Laboratorio).where(Laboratorio.ativo == True).order_by(Laboratorio.nome)  # noqa: E712
    return list(db.exec(base).all())

@router.post("/exames/laboratorios", response_model=LaboratorioOut, status_code=201)
def criar_lab(
    data: LaboratorioIn,
    db: Session = Depends(get_db),
    _=Depends(need_perm("lab_vagas", "criar")),
):
    nome = data.nome.strip()
    if db.exec(select(Laboratorio).where(Laboratorio.nome == nome)).first():
        raise HTTPException(400, "Laboratório já existe")
    obj = Laboratorio(nome=nome, ativo=data.ativo)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/exames/laboratorios/{lid}", response_model=LaboratorioOut)
def atualizar_lab(
    lid: int,
    data: LaboratorioIn,
    db: Session = Depends(get_db),
    _=Depends(need_perm("lab_vagas", "editar")),
):
    lab = db.get(Laboratorio, lid)
    if not lab:
        raise HTTPException(404, "Laboratório não encontrado")
    nome = data.nome.strip()
    dup = db.exec(select(Laboratorio).where(Laboratorio.nome == nome, Laboratorio.id != lid)).first()
    if dup:
        raise HTTPException(400, "Laboratório já existe")
    lab.nome = nome
    lab.ativo = data.ativo
    db.add(lab)
    db.commit()
    db.refresh(lab)
    return lab


@router.delete("/exames/laboratorios/{lid}", status_code=204)
def remover_lab(
    lid: int, db: Session = Depends(get_db), _=Depends(need_perm("lab_vagas", "excluir"))
):
    lab = db.get(Laboratorio, lid)
    if not lab:
        raise HTTPException(404, "Laboratório não encontrado")
    # Remoção lógica para preservar histórico/vagas; não apaga FKs.
    lab.ativo = False
    db.add(lab)
    db.commit()
    return None


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
    _=Depends(need_perm("lab_vagas")),
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
    data: VagaIn, db: Session = Depends(get_db), _=Depends(need_perm("lab_vagas", "criar"))
):
    if data.data < date.today():
        raise HTTPException(400, "Dia passado indisponível (sem vagas)")
    lab = db.get(Laboratorio, data.laboratorio_id)
    if not lab:
        raise HTTPException(404, "Laboratório não encontrado")
    if not lab.ativo:
        raise HTTPException(400, "Laboratório inativo — reative em Configurações para abrir vagas")
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
    _=Depends(need_perm("lab_vagas", "criar")),
):
    from calendar import monthrange

    lab = db.get(Laboratorio, data.laboratorio_id)
    if not lab:
        raise HTTPException(404, "Laboratório não encontrado")
    if not lab.ativo:
        raise HTTPException(400, "Laboratório inativo — reative em Configurações para abrir vagas")
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
    vid: int, data: VagaIn, db: Session = Depends(get_db), _=Depends(need_perm("lab_vagas", "editar"))
):
    obj = db.get(VagaLab, vid)
    if not obj:
        raise HTTPException(404, "Vaga não encontrada")
    if data.data < date.today() or obj.data < date.today():
        raise HTTPException(400, "Dia passado indisponível (sem vagas)")
    if data.vagas_totais < obj.vagas_ocupadas:
        raise HTTPException(400, "vagas_totais menor que vagas_ocupadas")
    _lab = db.get(Laboratorio, data.laboratorio_id)
    if not _lab:
        raise HTTPException(404, "Laboratório não encontrado")
    if not _lab.ativo:
        raise HTTPException(400, "Laboratório inativo — reative em Configurações para abrir vagas")
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
def excluir_vaga(vid: int, db: Session = Depends(get_db), _=Depends(need_perm("lab_vagas", "excluir"))):
    obj = db.get(VagaLab, vid)
    if not obj:
        raise HTTPException(404, "Vaga não encontrada")
    if obj.vagas_ocupadas > 0:
        raise HTTPException(400, "Vaga com agendamentos não pode ser excluída")
    db.delete(obj)
    db.commit()


def _formatar_fila_out(o: FilaPsf, pac: Paciente | None) -> FilaPsfOut:
    sids = []
    nomes = []
    obs = o.observacoes or ""
    if "SIGTAP_IDS:" in obs:
        try:
            import json
            parte = obs.split("SIGTAP_IDS:")[1].split("|")[0].strip()
            sids = json.loads(parte)
        except Exception:
            sids = []
    if "Exames:" in obs:
        try:
            nomes_str = obs.split("Exames:")[1].split("|")[0].strip()
            nomes = [n.strip() for n in nomes_str.split(",") if n.strip()]
        except Exception:
            nomes = []

    prontuario = getattr(pac, "codigo_prontuario", "") or (gerar_prontuario_aleatorio(pac_id=pac.id) if pac and pac.id else "")
    return FilaPsfOut(
        id=o.id,
        paciente_id=o.paciente_id,
        unidade_psf=o.unidade_psf,
        medico_solicitante=o.medico_solicitante,
        data_solicitacao=o.data_solicitacao,
        justificativa=o.justificativa,
        observacoes=o.observacoes,
        status=o.status,
        sigtap_ids=sids,
        exames_nomes=nomes,
        paciente_nome=pac.nome if pac else "?",
        paciente_cpf=getattr(pac, "cpf", "") or "",
        paciente_cns=getattr(pac, "cns", "") or "",
        paciente_prontuario=prontuario,
    )


# ---------- Fila PSF ----------
@router.get("/exames/fila-psf", response_model=Pagina[FilaPsfOut])
def listar_fila(
    status_: str | None = Query(default=None, alias="status"),
    unidade: str = "",
    data_de: str | None = None,
    data_ate: str | None = None,
    q: str = "",
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_fila", "lab_agenda")),
):
    if not isinstance(status_, str):
        status_ = getattr(status_, "default", None)
    if not isinstance(page, int):
        page = getattr(page, "default", 1)
    if not isinstance(limit, int):
        limit = getattr(limit, "default", 100)
    if not isinstance(unidade, str):
        unidade = getattr(unidade, "default", "") or ""
    if not isinstance(data_de, str):
        data_de = getattr(data_de, "default", None)
    if not isinstance(data_ate, str):
        data_ate = getattr(data_ate, "default", None)
    if not isinstance(q, str):
        q = getattr(q, "default", "") or ""

    filtros = []
    if status_ and status_.strip() and status_ != "todos":
        filtros.append(FilaPsf.status == status_.strip())
    if unidade and unidade.strip() and unidade != "todas":
        filtros.append(FilaPsf.unidade_psf.ilike(f"%{unidade.strip()}%"))
    if data_de and str(data_de).strip():
        try:
            d_de = date.fromisoformat(str(data_de).strip())
            filtros.append(FilaPsf.data_solicitacao >= d_de)
        except ValueError:
            pass
    if data_ate and str(data_ate).strip():
        try:
            d_ate = date.fromisoformat(str(data_ate).strip())
            filtros.append(FilaPsf.data_solicitacao <= d_ate)
        except ValueError:
            pass

    base = select(FilaPsf).join(Paciente, FilaPsf.paciente_id == Paciente.id, isouter=True)

    if q and str(q).strip():
        q_clean = str(q).strip()
        so_num = "".join(c for c in q_clean if c.isdigit())
        is_sqlite = bool(db.bind and db.bind.dialect.name == "sqlite")
        conds = [
            Paciente.nome.ilike(f"%{q_clean}%"),
            FilaPsf.unidade_psf.ilike(f"%{q_clean}%"),
            FilaPsf.medico_solicitante.ilike(f"%{q_clean}%"),
            FilaPsf.observacoes.ilike(f"%{q_clean}%"),
            FilaPsf.justificativa.ilike(f"%{q_clean}%"),
        ]
        if not is_sqlite:
            conds.append(func.unaccent(Paciente.nome).ilike(f"%{q_clean}%"))
        if so_num:
            conds.append(Paciente.cpf.ilike(f"%{so_num}%"))
            conds.append(Paciente.cns.ilike(f"%{so_num}%"))
            conds.append(Paciente.codigo_prontuario.ilike(f"%{so_num}%"))
            if len(so_num) <= 9 and int(so_num) <= 2147483647:
                conds.append(Paciente.id == int(so_num))
                conds.append(FilaPsf.id == int(so_num))
        filtros.append(or_(*conds))

    if filtros:
        base = base.where(*filtros)

    base = base.order_by(FilaPsf.data_solicitacao.desc(), FilaPsf.id.desc())
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    out = []
    for o in db.exec(base.offset(meta["offset"]).limit(limit)).all():
        pac = db.get(Paciente, o.paciente_id)
        out.append(_formatar_fila_out(o, pac))
    return {"data": out, "total": total, "page": meta["page"], "pages": meta["pages"]}


@router.post("/exames/fila-psf", response_model=FilaPsfOut, status_code=201)
def criar_fila(
    data: FilaPsfIn, db: Session = Depends(get_db), _=Depends(need_perm("lab_fila", "criar"))
):
    pac = db.get(Paciente, data.paciente_id)
    if not pac:
        raise HTTPException(404, "Paciente não encontrado")

    obs_final = (data.observacoes or "").strip()
    if data.sigtap_ids:
        procs = db.exec(select(SigtapProcedimento).where(SigtapProcedimento.id.in_(data.sigtap_ids))).all()
        nomes_exames = [p.descricao for p in procs]
        import json
        trecho_ids = json.dumps(data.sigtap_ids)
        trecho_nomes = ", ".join(nomes_exames)
        obs_extra = f"Exames: {trecho_nomes} | SIGTAP_IDS:{trecho_ids}"
        if obs_final:
            obs_final = f"{obs_extra} | {obs_final}"
        else:
            obs_final = obs_extra
        obs_final = obs_final[:500]

    obj = FilaPsf(
        paciente_id=data.paciente_id,
        unidade_psf=data.unidade_psf,
        medico_solicitante=data.medico_solicitante,
        data_solicitacao=data.data_solicitacao,
        justificativa=data.justificativa,
        observacoes=obs_final,
        status="na_fila",
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    try:
        from app.services.whatsapp import notificar_paciente_evento
        notificar_paciente_evento(db, "entrada_fila", obj, pac)
    except Exception:
        pass
    return _formatar_fila_out(obj, pac)


@router.patch("/exames/fila-psf/{fid}", response_model=FilaPsfOut)
def atualizar_status_fila(
    fid: int,
    data: FilaPsfStatusIn,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("lab_fila", "lab_agenda")),
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
    try:
        from app.services.whatsapp import notificar_paciente_evento
        notificar_paciente_evento(db, "entrada_fila", obj, pac)
    except Exception:
        pass
    return _formatar_fila_out(obj, pac)


@router.put("/exames/fila-psf/{fid}", response_model=FilaPsfOut)
def atualizar_fila(
    fid: int,
    data: FilaPsfUpdateIn,
    db: Session = Depends(get_db),
    _=Depends(need_perm("lab_fila", "editar")),
):
    obj = db.get(FilaPsf, fid)
    if not obj:
        raise HTTPException(404, "Fila não encontrada")
    if data.unidade_psf is not None:
        obj.unidade_psf = data.unidade_psf.strip()
    if data.medico_solicitante is not None:
        obj.medico_solicitante = data.medico_solicitante.strip()
    if data.data_solicitacao is not None:
        obj.data_solicitacao = data.data_solicitacao
    if data.justificativa is not None:
        obj.justificativa = data.justificativa.strip()
    if data.observacoes is not None:
        obs_limpa = data.observacoes.strip()
        if data.sigtap_ids is not None:
            procs = db.exec(select(SigtapProcedimento).where(SigtapProcedimento.id.in_(data.sigtap_ids))).all()
            nomes_exames = [p.descricao for p in procs]
            import json
            trecho_ids = json.dumps(data.sigtap_ids)
            trecho_nomes = ", ".join(nomes_exames)
            obs_extra = f"Exames: {trecho_nomes} | SIGTAP_IDS:{trecho_ids}"
            obs_limpa = f"{obs_extra} | {obs_limpa}" if obs_limpa else obs_extra
        obj.observacoes = obs_limpa[:500]
    elif data.sigtap_ids is not None:
        procs = db.exec(select(SigtapProcedimento).where(SigtapProcedimento.id.in_(data.sigtap_ids))).all()
        nomes_exames = [p.descricao for p in procs]
        import json
        trecho_ids = json.dumps(data.sigtap_ids)
        trecho_nomes = ", ".join(nomes_exames)
        obj.observacoes = f"Exames: {trecho_nomes} | SIGTAP_IDS:{trecho_ids}"[:500]

    db.add(obj)
    db.commit()
    db.refresh(obj)
    pac = db.get(Paciente, obj.paciente_id)
    try:
        from app.services.whatsapp import notificar_paciente_evento
        notificar_paciente_evento(db, "entrada_fila", obj, pac)
    except Exception:
        pass
    return _formatar_fila_out(obj, pac)


@router.post("/exames/fila-psf/agendar-lote", response_model=dict)
def agendar_fila_lote(
    data: FilaPsfAgendarLoteIn,
    db: Session = Depends(get_db),
    user=Depends(need_any_perm("lab_marcacao", "lab_agenda", acoes=("criar",))),
):
    """Marcação mensal em lote dos exames da fila para as vagas dos laboratórios conveniados."""
    solicitacoes = agendar_lote_fila(
        db,
        fila_ids=data.fila_ids,
        laboratorio_id=data.laboratorio_id,
        data_agendada=data.data_agendada,
        hora_agendada=data.hora_agendada,
        sigtap_ids=data.sigtap_ids,
        agendado_por=user.username,
        instrucoes_transporte=data.instrucoes_transporte,
    )
    if data.enviar_whatsapp:
        try:
            from app.services.whatsapp import notificar_paciente_evento
            for s in solicitacoes:
                notificar_paciente_evento(
                    db,
                    "agendamento",
                    s,
                    instrucoes_adicionais=data.instrucoes_transporte,
                )
        except Exception:
            pass
    return {
        "ok": True,
        "total_agendados": len(solicitacoes),
        "solicitacoes_ids": [s.id for s in solicitacoes],
    }


@router.delete("/exames/fila-psf/{fid}", status_code=204)
def excluir_fila(
    fid: int, db: Session = Depends(get_db), _=Depends(need_perm("lab_fila", "excluir"))
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
    q: str | None = None,
    status: str | None = None,
    data_de: date | None = None,
    data_ate: date | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    user=Depends(need_any_perm("lab_marcacao", "lab_agenda", "lab_recepcao")),
):
    filtros = []
    # Perfil Laboratório: restringe aos exames do seu próprio laboratório
    lab_id_efetivo = laboratorio_id
    if getattr(user, "laboratorio_id", None) and not user.is_superuser:
        lab_id_efetivo = user.laboratorio_id

    if status_auditoria:
        filtros.append(SolicitacaoMestre.status_auditoria == status_auditoria)
    if lab_id_efetivo:
        filtros.append(SolicitacaoMestre.laboratorio_id == lab_id_efetivo)
    if status:
        filtros.append(SolicitacaoMestre.status == status)
    if data_de:
        filtros.append(SolicitacaoMestre.data_agendada >= data_de)
    if data_ate:
        filtros.append(SolicitacaoMestre.data_agendada <= data_ate)
    if q and q.strip():
        import re
        from sqlalchemy import or_
        q_clean = q.strip()
        so_num = re.sub(r"\D", "", q_clean)
        condicoes_pac = [
            Paciente.nome.ilike(f"%{q_clean}%"),
            Paciente.cpf.ilike(f"%{q_clean}%"),
            Paciente.codigo_prontuario.ilike(f"%{q_clean}%"),
            Paciente.cns.ilike(f"%{q_clean}%"),
        ]
        if so_num and len(so_num) <= 8 and so_num.isdigit():
            val_id = int(so_num)
            condicoes_pac.append(Paciente.id == val_id)
            condicoes_pac.append(Paciente.codigo_prontuario == f"PR-{val_id:05d}")

        pacs_matching = list(
            db.exec(
                select(Paciente.id).where(or_(*condicoes_pac))
            ).all()
        )
        condicoes = []
        if pacs_matching:
            condicoes.append(SolicitacaoMestre.paciente_id.in_(pacs_matching))
        if q_clean.isdigit():
            condicoes.append(SolicitacaoMestre.id == int(q_clean))
            condicoes.append(SolicitacaoMestre.paciente_id == int(q_clean))
        if condicoes:
            filtros.append(or_(*condicoes))
        else:
            filtros.append(SolicitacaoMestre.id == -1)

    base = select(SolicitacaoMestre).order_by(SolicitacaoMestre.data_agendada.desc())
    if filtros:
        base = select(SolicitacaoMestre).where(*filtros).order_by(SolicitacaoMestre.data_agendada.desc())
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = list(db.exec(base.offset(meta["offset"]).limit(limit)).all())
    return {
        "data": enriquecer_mestre_lote(db, rows),
        "total": total,
        "page": meta["page"],
        "pages": meta["pages"],
    }


@router.post("/exames/solicitacoes", response_model=SolicMestreOut, status_code=201)
def criar_mestre(
    data: SolicMestreIn,
    db: Session = Depends(get_db),
    user=Depends(need_any_perm("lab_marcacao", "lab_agenda", acoes=("criar",))),
):
    try:
        totais = data.itens_normalizados()
    except ValueError as e:
        raise HTTPException(400, str(e))
    m = criar_solicitacao_mestre(
        db,
        paciente_id=data.paciente_id,
        data_agendada=data.data_agendada,
        hora_agendada=data.hora_agendada,
        laboratorio_id=data.laboratorio_id,
        sigtap_ids=None,
        origem_fila_id=data.origem_fila_id,
        agendado_por=user.username,
        itens=totais,
        medico_id=data.medico_id,
        medico_solicitante=data.medico_solicitante,
        unidade_saude_id=data.unidade_saude_id,
        unidade_psf=data.unidade_psf,
        justificativa=data.justificativa,
    )
    return enriquecer_mestre(db, m)


@router.get("/exames/solicitacoes/{mid}", response_model=SolicMestreOut)
def obter_mestre(
    mid: int,
    db: Session = Depends(get_db),
    user=Depends(need_any_perm("lab_marcacao", "lab_agenda", "lab_recepcao")),
):
    m = db.get(SolicitacaoMestre, mid)
    if not m:
        raise HTTPException(404, "Solicitação não encontrada")
    if getattr(user, "laboratorio_id", None) and not user.is_superuser:
        if m.laboratorio_id != user.laboratorio_id:
            raise HTTPException(403, "Acesso não autorizado para exames de outro laboratório")
    return enriquecer_mestre(db, m)


@router.delete("/exames/solicitacoes/{mid}", status_code=204)
def cancelar_solicitacao(
    mid: int,
    db: Session = Depends(get_db),
    user=Depends(need_any_perm("lab_marcacao", "usuarios")),
):
    m = db.get(SolicitacaoMestre, mid)
    if not m:
        raise HTTPException(404, "Solicitação não encontrada")
    if m.status != "cancelado":
        vaga = db.exec(
            select(VagaLab).where(
                VagaLab.laboratorio_id == m.laboratorio_id,
                VagaLab.data == m.data_agendada,
            )
        ).first()
        if vaga and vaga.ocupadas > 0:
            vaga.ocupadas -= 1
            db.add(vaga)
        m.status = "cancelado"
        db.add(m)
        db.commit()
    return None


@router.get("/exames/solicitacoes/{mid}/comprovante", response_model=ComprovanteExameOut)
def emitir_comprovante(
    mid: int,
    db: Session = Depends(get_db),
    user=Depends(need_any_perm("lab_marcacao", "lab_agenda", "lab_recepcao", "lab_fila")),
):
    """Emite o comprovante oficial de agendamento com horários e orientações de preparo."""
    m = db.get(SolicitacaoMestre, mid)
    if not m:
        raise HTTPException(404, "Solicitação não encontrada")
    if getattr(user, "laboratorio_id", None) and not user.is_superuser:
        if m.laboratorio_id != user.laboratorio_id:
            raise HTTPException(403, "Acesso não autorizado para exames de outro laboratório")
    return gerar_comprovante_agendamento(db, mid)


@router.post("/exames/solicitacoes/{mid}/recepcionar", response_model=SolicMestreOut)
def marcar_recepcao(
    mid: int,
    db: Session = Depends(get_db),
    user=Depends(need_any_perm("lab_recepcao", "lab_audit", "lab_marcacao")),
):
    """Laboratório valida a chegada do paciente e marca como Recepcionado / Coletado."""
    m = db.get(SolicitacaoMestre, mid)
    if not m:
        raise HTTPException(404, "Solicitação não encontrada")
    if getattr(user, "laboratorio_id", None) and not user.is_superuser:
        if m.laboratorio_id != user.laboratorio_id:
            raise HTTPException(403, "Acesso não autorizado para exames de outro laboratório")
    m = recepcionar_coleta(db, mid, user.nome or user.username)
    return enriquecer_mestre(db, m)


@router.post("/exames/solicitacoes/{mid}/pedir-ajuste", response_model=PedidoAjusteOut)
def solicitar_ajuste(
    mid: int,
    data: PedidoAjusteIn,
    db: Session = Depends(get_db),
    user=Depends(need_any_perm("lab_recepcao", "lab_audit", "lab_marcacao")),
):
    """Laboratório submete pedido de modificação/ajuste para aprovação da Secretaria."""
    m = db.get(SolicitacaoMestre, mid)
    if not m:
        raise HTTPException(404, "Solicitação não encontrada")
    lab_id = m.laboratorio_id
    if getattr(user, "laboratorio_id", None) and not user.is_superuser:
        if m.laboratorio_id != user.laboratorio_id:
            raise HTTPException(403, "Acesso não autorizado para exames de outro laboratório")
        lab_id = user.laboratorio_id
    ajuste = pedir_ajuste_laboratorio(
        db,
        mestre_id=mid,
        laboratorio_id=lab_id,
        tipo_ajuste=data.tipo_ajuste,
        justificativa=data.justificativa,
        itens_propostos=data.itens_propostos,
        solicitado_por=user.nome or user.username,
    )
    lab = db.get(Laboratorio, ajuste.laboratorio_id)
    pac = db.get(Paciente, m.paciente_id)
    return PedidoAjusteOut(
        id=ajuste.id,
        solicitacao_id=ajuste.solicitacao_id,
        laboratorio_id=ajuste.laboratorio_id,
        laboratorio_nome=lab.nome if lab else "?",
        paciente_nome=pac.nome if pac else "?",
        tipo_ajuste=ajuste.tipo_ajuste,
        justificativa=ajuste.justificativa,
        itens_propostos=json.loads(ajuste.itens_propostos or "[]"),
        status=ajuste.status,
        solicitado_por=ajuste.solicitado_por,
        resposta_secretaria=ajuste.resposta_secretaria,
        analisado_por=ajuste.analisado_por,
        created_at=ajuste.created_at,
        analisado_em=ajuste.analisado_em,
    )


@router.get("/exames/pedidos-ajuste", response_model=list[PedidoAjusteOut])
def listar_pedidos_ajuste(
    status: str | None = None,
    laboratorio_id: int | None = None,
    db: Session = Depends(get_db),
    user=Depends(need_any_perm("lab_audit", "lab_marcacao", "lab_recepcao")),
):
    """Lista pedidos de ajuste submetidos por laboratórios conveniados."""
    filtros = []
    if getattr(user, "laboratorio_id", None) and not user.is_superuser:
        filtros.append(LabPedidoAjuste.laboratorio_id == user.laboratorio_id)
    elif laboratorio_id:
        filtros.append(LabPedidoAjuste.laboratorio_id == laboratorio_id)

    if status:
        filtros.append(LabPedidoAjuste.status == status)

    query = select(LabPedidoAjuste).order_by(LabPedidoAjuste.created_at.desc())
    if filtros:
        query = query.where(*filtros)

    rows = list(db.exec(query).all())
    labs = {l.id: l.nome for l in db.exec(select(Laboratorio)).all()}
    out = []
    for a in rows:
        m = db.get(SolicitacaoMestre, a.solicitacao_id)
        pac = db.get(Paciente, m.paciente_id) if m else None
        out.append(
            PedidoAjusteOut(
                id=a.id,
                solicitacao_id=a.solicitacao_id,
                laboratorio_id=a.laboratorio_id,
                laboratorio_nome=labs.get(a.laboratorio_id, "?"),
                paciente_nome=pac.nome if pac else "?",
                tipo_ajuste=a.tipo_ajuste,
                justificativa=a.justificativa,
                itens_propostos=json.loads(a.itens_propostos or "[]"),
                status=a.status,
                solicitado_por=a.solicitado_por,
                resposta_secretaria=a.resposta_secretaria,
                analisado_por=a.analisado_por,
                created_at=a.created_at,
                analisado_em=a.analisado_em,
            )
        )
    return out


@router.post("/exames/pedidos-ajuste/{aid}/analisar", response_model=PedidoAjusteOut)
def responder_ajuste(
    aid: int,
    data: RespostaAjusteIn,
    db: Session = Depends(get_db),
    user=Depends(need_perm("lab_audit", "editar")),
):
    """Secretaria analisa, autoriza ou rejeita o pedido de ajuste do laboratório."""
    ajuste = analisar_pedido_ajuste(
        db,
        ajuste_id=aid,
        aprovado=data.aprovado,
        resposta=data.resposta,
        user_nome=user.nome or user.username,
    )
    m = db.get(SolicitacaoMestre, ajuste.solicitacao_id)
    pac = db.get(Paciente, m.paciente_id) if m else None
    lab = db.get(Laboratorio, ajuste.laboratorio_id)
    return PedidoAjusteOut(
        id=ajuste.id,
        solicitacao_id=ajuste.solicitacao_id,
        laboratorio_id=ajuste.laboratorio_id,
        laboratorio_nome=lab.nome if lab else "?",
        paciente_nome=pac.nome if pac else "?",
        tipo_ajuste=ajuste.tipo_ajuste,
        justificativa=ajuste.justificativa,
        itens_propostos=json.loads(ajuste.itens_propostos or "[]"),
        status=ajuste.status,
        solicitado_por=ajuste.solicitado_por,
        resposta_secretaria=ajuste.resposta_secretaria,
        analisado_por=ajuste.analisado_por,
        created_at=ajuste.created_at,
        analisado_em=ajuste.analisado_em,
    )


@router.get("/exames/bpa/consolidado", response_model=BpaResumoOut)
def obter_bpa_consolidado(
    competencia: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    db: Session = Depends(get_db),
    _=Depends(need_perm("lab_faturamento")),
):
    """Consolida produção de exames coletados/realizados para o faturamento BPA."""
    return consolidar_bpa_laboratorial(db, competencia)


@router.get("/exames/bpa/exportar-csv")
def exportar_bpa_csv(
    competencia: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    db: Session = Depends(get_db),
    _=Depends(need_perm("lab_faturamento")),
):
    from fastapi.responses import Response

    resumo = consolidar_bpa_laboratorial(db, competencia)
    linhas = ["codigo,procedimento,quantidade,valor_unitario,valor_total,instrumento"]
    for it in resumo["itens"]:
        linhas.append(f"{it['codigo']},\"{it['descricao']}\",{it['quantidade']},{it['valor_unitario']:.2f},{it['valor_total']:.2f},{it['instrumento']}")
    csv_str = "\n".join(linhas) + "\n"
    return Response(
        content=csv_str,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=bpa_consolidado_{competencia}.csv"},
    )


# ---------- Auditoria ----------
@router.get("/exames/auditoria", response_model=Pagina[SolicMestreOut])
def listar_auditoria(
    status_auditoria: str | None = None,
    laboratorio_id: int | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    user=Depends(need_any_perm("lab_audit", "lab_recepcao")),
):
    filtros = []
    lab_id_efetivo = laboratorio_id
    if getattr(user, "laboratorio_id", None) and not user.is_superuser:
        lab_id_efetivo = user.laboratorio_id

    if status_auditoria:
        filtros.append(SolicitacaoMestre.status_auditoria == status_auditoria)
    if lab_id_efetivo:
        filtros.append(SolicitacaoMestre.laboratorio_id == lab_id_efetivo)

    base = select(SolicitacaoMestre).order_by(SolicitacaoMestre.data_agendada.desc())
    if filtros:
        base = select(SolicitacaoMestre).where(*filtros).order_by(SolicitacaoMestre.data_agendada.desc())
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = list(db.exec(base.offset(meta["offset"]).limit(limit)).all())
    return {
        "data": enriquecer_mestre_lote(db, rows),
        "total": total,
        "page": meta["page"],
        "pages": meta["pages"],
    }


@router.put("/exames/auditoria/{mid}", response_model=SolicMestreOut)
def auditar(
    mid: int,
    data: AuditoriaIn,
    db: Session = Depends(get_db),
    _=Depends(need_perm("lab_audit", "editar")),
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
    mid: int, db: Session = Depends(get_db), _=Depends(need_perm("lab_audit", "criar"))
):
    m = db.get(SolicitacaoMestre, mid)
    if not m:
        raise HTTPException(404, "Solicitação não encontrada")
    m.status_auditoria = "aguardando_autorizacao_sec"
    db.add(m)
    db.commit()
    db.refresh(m)
    return enriquecer_mestre(db, m)


# ---------- Exportação XLSX ----------
@router.get("/exames/fila-psf/exportar")
def exportar_fila_psf(
    status_: str | None = Query(default=None, alias="status"),
    unidade: str = "",
    data_de: str | None = None,
    data_ate: str | None = None,
    q: str = "",
    ids: str | None = Query(default=None),
    db: Session = Depends(get_db),
    ator=Depends(need_any_perm("lab_fila", "lab_agenda")),
):
    """Fila do PSF em XLSX respeitando os filtros ativos e seleção de registros."""
    from app.services.export_xlsx import resposta_xlsx
    from app.core.audit import registrar_log_exportacao

    ids_set: set[int] = set()
    filtros = []
    st_val = status_ if isinstance(status_, str) else None
    unid_val = unidade.strip() if isinstance(unidade, str) else ""
    ids_str = ids if isinstance(ids, str) else None

    if st_val and st_val.strip() and st_val != "todos":
        filtros.append(FilaPsf.status == st_val.strip())
    if unid_val and unid_val != "todas":
        filtros.append(FilaPsf.unidade_psf.ilike(f"%{unid_val}%"))
    if data_de and str(data_de).strip():
        try:
            d_de = date.fromisoformat(str(data_de).strip())
            filtros.append(FilaPsf.data_solicitacao >= d_de)
        except ValueError:
            pass
    if data_ate and str(data_ate).strip():
        try:
            d_ate = date.fromisoformat(str(data_ate).strip())
            filtros.append(FilaPsf.data_solicitacao <= d_ate)
        except ValueError:
            pass
    if ids_str and ids_str.strip():
        ids_set = {int(x.strip()) for x in ids_str.split(",") if x.strip().isdigit()}
        if ids_set:
            filtros.append(FilaPsf.id.in_(ids_set))

    base = select(FilaPsf).join(Paciente, FilaPsf.paciente_id == Paciente.id, isouter=True)

    if q and str(q).strip():
        q_clean = str(q).strip()
        so_num = "".join(c for c in q_clean if c.isdigit())
        is_sqlite = bool(db.bind and db.bind.dialect.name == "sqlite")
        conds = [
            Paciente.nome.ilike(f"%{q_clean}%"),
            FilaPsf.unidade_psf.ilike(f"%{q_clean}%"),
            FilaPsf.medico_solicitante.ilike(f"%{q_clean}%"),
            FilaPsf.observacoes.ilike(f"%{q_clean}%"),
            FilaPsf.justificativa.ilike(f"%{q_clean}%"),
        ]
        if not is_sqlite:
            conds.append(func.unaccent(Paciente.nome).ilike(f"%{q_clean}%"))
        if so_num:
            conds.append(Paciente.cpf.ilike(f"%{so_num}%"))
            conds.append(Paciente.cns.ilike(f"%{so_num}%"))
            conds.append(Paciente.codigo_prontuario.ilike(f"%{so_num}%"))
            if len(so_num) <= 9 and int(so_num) <= 2147483647:
                conds.append(Paciente.id == int(so_num))
                conds.append(FilaPsf.id == int(so_num))
        filtros.append(or_(*conds))

    if filtros:
        base = base.where(*filtros)

    base = base.order_by(FilaPsf.data_solicitacao.desc(), FilaPsf.id.desc())

    linhas = []
    for o in list(db.exec(base).all())[:20000]:
        pac = db.get(Paciente, o.paciente_id)
        obs = o.observacoes or ""
        exames_str = "—"
        if "Exames:" in obs:
            try:
                exames_str = obs.split("Exames:")[1].split("|")[0].strip() or "—"
            except Exception:
                pass
        prontuario = getattr(pac, "codigo_prontuario", "") or (gerar_prontuario_aleatorio(pac_id=pac.id) if pac and pac.id else "")
        linhas.append({
            "paciente": pac.nome if pac else "?",
            "cpf": getattr(pac, "cpf", "") or "",
            "prontuario": prontuario,
            "data": o.data_solicitacao,
            "unidade": o.unidade_psf or "",
            "medico": o.medico_solicitante or "",
            "exames": exames_str,
            "status": o.status,
            "justificativa": o.justificativa or "",
            "obs": obs,
        })

    titulo_relatorio = "Fila de Exames de Sangue (PSF)" if not ids_set else f"Fila de Exames — {len(linhas)} selecionado(s)"

    registrar_log_exportacao(
        modulo="lab_fila",
        titulo=titulo_relatorio,
        usuario_id=ator.id,
        usuario_nome=getattr(ator, "nome", "") or getattr(ator, "username", ""),
        total_linhas=len(linhas),
        filtros={
            "status": status_,
            "unidade": unidade,
            "data_de": data_de,
            "data_ate": data_ate,
            "q": q,
            "ids_selecionados": list(ids_set) if ids_set else None,
        },
    )

    return resposta_xlsx(
        titulo_relatorio, getattr(ator, "nome", "") or getattr(ator, "username", ""),
        [
            {"chave": "data", "rotulo": "Data Pedido", "largura": 14, "formato": "data"},
            {"chave": "paciente", "rotulo": "Nome do Paciente", "largura": 32},
            {"chave": "cpf", "rotulo": "CPF", "largura": 16},
            {"chave": "prontuario", "rotulo": "Prontuário", "largura": 14},
            {"chave": "unidade", "rotulo": "PSF / Origem", "largura": 24},
            {"chave": "medico", "rotulo": "Médico Requisitante", "largura": 28},
            {"chave": "exames", "rotulo": "Exames Solicitados", "largura": 35},
            {"chave": "justificativa", "rotulo": "Justificativa Clínica", "largura": 35},
            {"chave": "status", "rotulo": "Status", "largura": 14},
            {"chave": "obs", "rotulo": "Observações", "largura": 30},
        ],
        linhas, "fila_exames_sangue",
    )
