from datetime import date, datetime
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlmodel import Session, and_, case, func, or_, select

import re as _re

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
    ValidarCboIn,
    ValidarCboOut,
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
VIAGEM_PASSADA_MSG = "Seu perfil não possui permissão para alterar viagens de datas passadas."


def exige_permissao_viagem_passada(user: User, valor) -> None:
    """Se a data da viagem for anterior a hoje e o usuário não for superusuário,
    exigir que possua tem_tela(ator, 'tfd_viagens_passadas') e user.permite_retroativo != False.
    """
    from datetime import date as _date

    if valor is None:
        return
    try:
        if isinstance(valor, str):
            from datetime import date
            valor = date.fromisoformat(valor[:10])
        passada = valor < _date.today()
    except Exception:
        return
    if not passada:
        return
    if bool(getattr(user, "is_superuser", False)):
        return
    if getattr(user, "permite_retroativo", True) is False:
        raise HTTPException(403, RETRO_MSG)
    if not tem_tela(user, "tfd_viagens_passadas"):
        raise HTTPException(403, VIAGEM_PASSADA_MSG)


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
    med = None
    if medico_id and medico_id not in (0, -1):
        med = db.get(Medico, medico_id)

    if not med:
        med = db.exec(
            select(Medico).where(Medico.nome == "Médico da Unidade / Responsável Técnico")
        ).first()

    if not med:
        med = Medico(
            nome="Médico da Unidade / Responsável Técnico",
            crm="RESP. TÉCNICO",
            cbo_codigo="225125",
            cbo_descricao="Médico da Unidade / Responsável Técnico",
            especialidades="Clínica Geral,Saúde da Família",
            ativo=True,
        )
        db.add(med)
        db.commit()
        db.refresh(med)

    uni = db.get(UnidadeSaude, unidade_id) if unidade_id else None
    if not uni:
        uni = db.exec(select(UnidadeSaude).where(UnidadeSaude.ativo != False)).first()  # noqa: E712
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


_PERMS_PACIENTES_LEITURA = (
    "tfd_pacientes",
    "tfd_exames",
    "tfd_fila_lancamento",
    "tfd_agenda",
    "tfd_viagens",
    "tfd_medico",
    "lab_marcacao",
    "lab_fila",
    "lab_vagas",
    "lab_faturamento",
    "tfd_faturamento",
    "tfd",
    "lab",
    "usuarios",
)

# ---------- Pacientes ----------
@router.get("/pacientes", response_model=Pagina[PacienteOut])
def listar_pacientes(
    q: str = "",
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    request: Request = None,
    db: Session = Depends(get_db),
    ator: User | None = Depends(need_any_perm(*_PERMS_PACIENTES_LEITURA)),
):
    q_limpo = (q or "").strip()
    if not q_limpo:
        # Busca Sob Demanda (Item 2): não exibe nenhum resultado automático ao abrir sem pesquisa
        return {"data": [], "total": 0, "page": 1, "pages": 1}

    so_num = "".join(c for c in q_limpo if c.isdigit())

    # 1. Busca EXATA prioritária (quando o usuário digita CPF, CNS ou Prontuário/ID numérico)
    exatos: list[Paciente] = []
    if len(so_num) == 11:
        cpf_fmt = f"{so_num[:3]}.{so_num[3:6]}.{so_num[6:9]}-{so_num[9:]}"
        exatos = db.exec(
            select(Paciente).where(or_(Paciente.cpf == so_num, Paciente.cpf == cpf_fmt))
        ).all()
    elif len(so_num) == 15:
        exatos = db.exec(select(Paciente).where(Paciente.cns == so_num)).all()
    else:
        q_upper = q_limpo.upper()
        filtros_pront = [Paciente.codigo_prontuario.ilike(q_upper)]
        digits = "".join(c for c in q_upper if c.isdigit())
        if digits:
            val_id = int(digits)
            filtros_pront.append(Paciente.id == val_id)
            filtros_pront.append(Paciente.codigo_prontuario.ilike(f"PR-{val_id:05d}"))
            filtros_pront.append(Paciente.codigo_prontuario.ilike(f"%{val_id}%"))
            filtros_pront.append(Paciente.codigo_prontuario == str(val_id))
        exatos_pront = db.exec(select(Paciente).where(or_(*filtros_pront))).all()
        if exatos_pront:
            exatos = exatos_pront

    # Se encontrou correspondência exata, retorna SOMENTE esse(s) paciente(s)
    # Se a busca foi por CPF, deduplica eventuais prontuários duplicados do PEC, mantendo o registro mais completo
    if exatos:
        if len(so_num) == 11:
            exatos.sort(key=lambda p: (bool(p.endereco), bool(p.cns), p.id or 0), reverse=True)
            vistos = set()
            unicos = []
            for p in exatos:
                c_clean = (p.cpf or "").strip()
                if c_clean not in vistos:
                    vistos.add(c_clean)
                    unicos.append(p)
            exatos = unicos

        for p in exatos:
            if not getattr(p, "codigo_prontuario", "") and p.id:
                p.codigo_prontuario = f"PR-{p.id:05d}"
        try:
            from app.core.audit import registrar_log_pesquisa
            u_id = ator.id if ator else None
            u_nome = (ator.nome or ator.username) if ator else ""
            ua = request.headers.get("user-agent", "") if request else ""
            registrar_log_pesquisa("pacientes", q_limpo, u_id, u_nome, ua, len(exatos))
        except Exception:
            pass
        return {"data": exatos, "total": len(exatos), "page": 1, "pages": 1}

    # 2. Busca aproximada inteligente (relevância com prioridade no início)
    filtros = [
        Paciente.nome.ilike(f"%{q_limpo}%"),
        Paciente.cpf.ilike(f"%{q_limpo}%"),
        Paciente.cns.ilike(f"%{q_limpo}%"),
        Paciente.codigo_prontuario.ilike(f"%{q_limpo}%"),
    ]
    digits = "".join(c for c in q_limpo if c.isdigit())
    if digits:
        val_id = int(digits)
        filtros.append(Paciente.id == val_id)
        filtros.append(Paciente.codigo_prontuario.ilike(f"%{digits}%"))
    if so_num and so_num != q_limpo:
        filtros.append(Paciente.cpf.ilike(f"%{so_num}%"))
        filtros.append(Paciente.cns.ilike(f"%{so_num}%"))
        filtros.append(Paciente.codigo_prontuario.ilike(f"%{so_num}%"))
    # Relevância inteligente: quem começa com o termo aparece primeiro
    ordem_relevancia = case(
        (Paciente.nome.ilike(f"{q_limpo}%"), 0),
        (Paciente.codigo_prontuario.ilike(f"{q_limpo}%"), 0),
        else_=1,
    )
    base = select(Paciente).where(or_(*filtros)).order_by(ordem_relevancia, Paciente.nome)
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = db.exec(base.offset(meta["offset"]).limit(limit)).all()
    # Garante prontuário curto em cada paciente
    for p in rows:
        if not getattr(p, "codigo_prontuario", "") and p.id:
            p.codigo_prontuario = f"PR-{p.id:05d}"

    try:
        from app.core.audit import registrar_log_pesquisa
        u_id = ator.id if ator else None
        u_nome = (ator.nome or ator.username) if ator else ""
        ua = request.headers.get("user-agent", "") if request else ""
        registrar_log_pesquisa("pacientes", q.strip(), u_id, u_nome, ua, total)
    except Exception:
        pass

    return {"data": rows, "total": total, "page": meta["page"], "pages": meta["pages"]}


@router.get("/pacientes/buscar")
def buscar_pacientes_pec(
    termo: str = Query(default="", max_length=80),
    request: Request = None,
    db: Session = Depends(get_db),
    ator: User | None = Depends(need_any_perm(*_PERMS_PACIENTES_LEITURA)),
):
    """Busca paciente local + DW PEC e-SUS (nome/CNS/CPF/prontuário).

    Fonte PEC readonly; fallback local quando DW indisponível. Sem PII
    além do necessário p/ autocomplete (nome, CNS, CPF, prontuário).
    """
    termo_limpo = (termo or "").strip()
    if not termo_limpo:
        # Busca Sob Demanda: não exibe pacientes automáticos ao abrir o campo
        return {"termo": "", "total": 0, "resultados": []}

    so_num = "".join(c for c in termo_limpo if c.isdigit())

    # 1. Busca EXATA prioritária (CPF, CNS ou Prontuário/ID numérico)
    exatos_busca: list[Paciente] = []
    if len(so_num) == 11:
        cpf_fmt = f"{so_num[:3]}.{so_num[3:6]}.{so_num[6:9]}-{so_num[9:]}"
        exatos_busca = db.exec(
            select(Paciente).where(or_(Paciente.cpf == so_num, Paciente.cpf == cpf_fmt))
        ).all()
    elif len(so_num) == 15:
        exatos_busca = db.exec(select(Paciente).where(Paciente.cns == so_num)).all()
    else:
        t_upper = termo_limpo.upper()
        filtros_p = [Paciente.codigo_prontuario.ilike(t_upper)]
        digits = "".join(c for c in t_upper if c.isdigit())
        if digits:
            val_id = int(digits)
            filtros_p.append(Paciente.id == val_id)
            filtros_p.append(Paciente.codigo_prontuario.ilike(f"PR-{val_id:05d}"))
            filtros_p.append(Paciente.codigo_prontuario.ilike(f"%{val_id}%"))
            filtros_p.append(Paciente.codigo_prontuario == str(val_id))
        exatos_p = db.exec(select(Paciente).where(or_(*filtros_p))).all()
        if exatos_p:
            exatos_busca = exatos_p

    if exatos_busca:
        if len(so_num) == 11:
            exatos_busca.sort(key=lambda p: (bool(p.endereco), bool(p.cns), p.id or 0), reverse=True)
            vistos = set()
            unicos = []
            for p in exatos_busca:
                c_clean = (p.cpf or "").strip()
                if c_clean not in vistos:
                    vistos.add(c_clean)
                    unicos.append(p)
            exatos_busca = unicos
        locais = exatos_busca
    else:
        like = f"%{termo_limpo}%"
        filtros = [
            Paciente.nome.ilike(like),
            Paciente.cpf.ilike(like),
            Paciente.cns.ilike(like),
            Paciente.codigo_prontuario.ilike(like),
        ]
        if so_num and so_num != termo_limpo:
            filtros.append(Paciente.cpf.ilike(f"%{so_num}%"))
            filtros.append(Paciente.cns.ilike(f"%{so_num}%"))
            filtros.append(Paciente.codigo_prontuario.ilike(f"%{so_num}%"))

        # Relevância inteligente: prioriza quem começa exatamente com o termo pesquisado
        ordem_relevancia = case(
            (Paciente.nome.ilike(f"{termo_limpo}%"), 0),
            (Paciente.codigo_prontuario.ilike(f"{termo_limpo}%"), 0),
            else_=1,
        )

        locais = db.exec(
            select(Paciente)
            .where(or_(*filtros))
            .order_by(ordem_relevancia, Paciente.nome)
            .limit(20)
        ).all()
    out = [
        {
            "id": p.id,
            "origem": "local",
            "nome": p.nome,
            "cns": p.cns,
            "cpf": p.cpf,
            "prontuario": p.codigo_prontuario or (f"PR-{p.id:05d}" if p.id else str(p.co_seq_cidadao_pec or "")),
            "nascimento": p.nascimento.isoformat() if p.nascimento else None,
            "ubs": p.unidade_nome or "",
            "unidade_cnes": p.unidade_cnes or "",
            "equipe": p.equipe_esf or "",
            "microarea": p.microarea or "",
            "nome_mae": p.nome_mae or "",
            "telefone": p.telefone or "",
            "endereco": f"{p.endereco}, {p.endereco_numero}" if p.endereco and p.endereco_numero else (p.endereco or ""),
            "bairro": p.bairro or "",
        }
        for p in locais
    ]
    if termo_limpo:
        try:
            from app.core.audit import registrar_log_pesquisa
            u_id = ator.id if ator else None
            u_nome = (ator.nome or ator.username) if ator else ""
            ua = request.headers.get("user-agent", "") if request else ""
            registrar_log_pesquisa("pacientes_autocomplete", termo_limpo, u_id, u_nome, ua, len(out))
        except Exception:
            pass
    return {"fonte": "local", "termo": termo, "resultados": out[:20]}


# ---------- Destinos ----------
@router.get("/destinos", response_model=Pagina[DestinoOut])
def listar_destinos(
    ativos: bool | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("tfd_destinos", "tfd_viagens", "tfd_frota_gestao")),
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
    db.flush()
    if obj.id and not obj.codigo_prontuario:
        obj.codigo_prontuario = f"PR-{obj.id:05d}"
        db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/pacientes/{pid}", response_model=PacienteOut)
def obter_paciente(
    pid: int,
    db: Session = Depends(get_db),
    ator: User | None = Depends(need_any_perm(*_PERMS_PACIENTES_LEITURA)),
):
    """Busca dados cadastrais de um paciente por ID."""
    obj = db.get(Paciente, pid)
    if not obj:
        raise HTTPException(404, "Paciente não encontrado")
    if not getattr(obj, "codigo_prontuario", "") and obj.id:
        obj.codigo_prontuario = f"PR-{obj.id:05d}"
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
        if k == "codigo_prontuario" and not v:
            continue
        setattr(obj, k, v)
    if obj.id and not obj.codigo_prontuario:
        obj.codigo_prontuario = f"PR-{obj.id:05d}"
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
    request: Request = None,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("tfd_pacientes")),
):
    """Cadastro de pacientes em XLSX respeitando a busca ativa com endereço completo e prontuário."""
    from app.services.export_xlsx import resposta_xlsx

    base = select(Paciente).order_by(Paciente.nome)
    if q:
        q_limpo = q.strip()
        so_num = "".join(c for c in q_limpo if c.isdigit())
        exatos_exp = []
        if len(so_num) == 11:
            cpf_fmt = f"{so_num[:3]}.{so_num[3:6]}.{so_num[6:9]}-{so_num[9:]}"
            exatos_exp = db.exec(
                select(Paciente).where(or_(Paciente.cpf == so_num, Paciente.cpf == cpf_fmt))
            ).all()
        elif len(so_num) == 15:
            exatos_exp = db.exec(select(Paciente).where(Paciente.cns == so_num)).all()
        else:
            q_upper = q_limpo.upper()
            filtros_pront = [Paciente.codigo_prontuario.ilike(q_upper)]
            if q_upper.startswith("PR-") or q_upper.startswith("PR"):
                digits = "".join(c for c in q_upper if c.isdigit())
                if digits:
                    val_id = int(digits)
                    filtros_pront.append(Paciente.id == val_id)
                    filtros_pront.append(Paciente.codigo_prontuario.ilike(f"PR-{val_id:05d}"))
            exatos_p = db.exec(select(Paciente).where(or_(*filtros_pront))).all()
            if exatos_p:
                exatos_exp = exatos_p

        if exatos_exp:
            base = select(Paciente).where(Paciente.id.in_([p.id for p in exatos_exp]))
        else:
            like = f"%{q_limpo}%"
            ordem_relevancia = case(
                (Paciente.nome.ilike(f"{q_limpo}%"), 0),
                (Paciente.codigo_prontuario.ilike(f"{q_limpo}%"), 0),
                else_=1,
            )
            base = select(Paciente).where(
                (Paciente.nome.ilike(like))
                | (Paciente.cpf.ilike(like))
                | (Paciente.cns.ilike(like))
                | (Paciente.codigo_prontuario.ilike(like))
            ).order_by(ordem_relevancia, Paciente.nome)

    linhas = []
    for p in list(db.exec(base).all())[:20000]:
        linhas.append({
            "codigo_prontuario": p.codigo_prontuario or (f"PR-{p.id:05d}" if p.id else ""),
            "nome": p.nome,
            "cpf": p.cpf or "",
            "cns": p.cns or "",
            "nascimento": p.nascimento,
            "telefone": p.telefone or "",
            "endereco_completo": _endereco_completo(p),
            "logradouro": p.endereco or "",
            "numero": p.endereco_numero or "",
            "complemento": getattr(p, "complemento", "") or "",
            "bairro": p.bairro or "",
            "municipio": getattr(p, "municipio", "Guapé") or "Guapé",
            "cep": p.cep or "",
            "unidade": p.unidade_nome or "",
            "equipe": p.equipe_esf or "",
            "acs": p.acs_nome or "",
        })
    return resposta_xlsx(
        "Pacientes", ator.nome or ator.username,
        [
            {"chave": "codigo_prontuario", "rotulo": "Prontuário", "largura": 16},
            {"chave": "nome", "rotulo": "Nome completo", "largura": 34},
            {"chave": "cpf", "rotulo": "CPF", "largura": 18, "formato": "texto"},
            {"chave": "cns", "rotulo": "CNS", "largura": 22},
            {"chave": "nascimento", "rotulo": "Nascimento", "largura": 14, "formato": "data"},
            {"chave": "telefone", "rotulo": "Telefone", "largura": 16},
            {"chave": "endereco_completo", "rotulo": "Endereço completo", "largura": 44},
            {"chave": "logradouro", "rotulo": "Logradouro", "largura": 32},
            {"chave": "numero", "rotulo": "Número", "largura": 12, "formato": "texto"},
            {"chave": "complemento", "rotulo": "Complemento", "largura": 18},
            {"chave": "bairro", "rotulo": "Bairro", "largura": 22},
            {"chave": "municipio", "rotulo": "Município", "largura": 20},
            {"chave": "cep", "rotulo": "CEP", "largura": 14, "formato": "texto"},
            {"chave": "equipe", "rotulo": "Equipe (eSF)", "largura": 16},
            {"chave": "acs", "rotulo": "ACS", "largura": 24},
        ],
        linhas, "pacientes",
        user_id=ator.id if ator else None,
        filtros={"busca": q} if q else {},
        request=request,
    )


@router.get("/pacientes/{pid}/demanda/exportar")
def exportar_demanda(
    pid: int,
    request: Request = None,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("tfd_pacientes")),
):
    """Demanda reprimida do paciente em XLSX (ordem cronológica + posição)."""
    from app.services.export_xlsx import resposta_xlsx

    perfil = perfil_paciente(pid, db, ator)
    demandas_ordenadas = sorted(
        perfil.demanda,
        key=lambda d: ((d.exame or "").strip().lower(), str(d.data_pedido or d.data_inclusao or ""))
    )
    linhas = [{
        "inclusao": d.data_inclusao,
        "especialidade": d.nome_especialidade or d.especialidade or d.tipo_fila,
        "procedimento": d.exame,
        "risco": d.classificacao_risco,
        "posicao": f"{d.posicao_especialidade}º de {d.total_fila_especialidade}" if d.posicao_especialidade else "",
        "status": d.status_rotulo,
    } for d in demandas_ordenadas]
    return resposta_xlsx(
        f"Demanda reprimida — {perfil.paciente.nome}",
        ator.nome or ator.username,
        [
            {"chave": "inclusao", "rotulo": "Data de inclusão", "largura": 18},
            {"chave": "especialidade", "rotulo": "Especialidade", "largura": 30},
            {"chave": "procedimento", "rotulo": "Procedimento", "largura": 40},
            {"chave": "risco", "rotulo": "Classificação de risco", "largura": 18},
            {"chave": "posicao", "rotulo": "Posição na fila", "largura": 16},
            {"chave": "status", "rotulo": "Status", "largura": 24},
        ],
        linhas,
        "demanda_reprimida",
        user_id=ator.id if ator else None,
        filtros={"paciente_id": pid},
        request=request,
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
    q: str = "",
    ativos: bool | None = None,
    page: int = 1,
    limit: int = 100,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("tfd_frota", "tfd_frota_gestao", "tfd", "tfd_viagens", "usuarios")),
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
    data: MotoristaIn,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("tfd_frota", "tfd_frota_gestao", "tfd", "usuarios", acoes=("criar",))),
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
    mid: int,
    data: MotoristaIn,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("tfd_frota", "tfd_frota_gestao", "tfd", "usuarios", acoes=("editar",))),
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
def excluir_motorista(
    mid: int,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("tfd_frota", "tfd_frota_gestao", "tfd", "usuarios", acoes=("excluir",))),
):
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

    viagens = list(db.exec(base.offset(meta["offset"]).limit(limit)).all())
    v_ids = [v.id for v in viagens if v.id]

    contagens: dict[int, int] = {}
    if v_ids:
        contagens_rows = db.exec(
            select(ViagemPaciente.viagem_id, func.count(ViagemPaciente.id))
            .where(ViagemPaciente.viagem_id.in_(v_ids))
            .group_by(ViagemPaciente.viagem_id)
        ).all()
        contagens = dict(contagens_rows)

    veic_ids = {v.veiculo_id for v in viagens if v.veiculo_id}
    veics_map: dict[int, Veiculo] = {}
    if veic_ids:
        veics = db.exec(select(Veiculo).where(Veiculo.id.in_(veic_ids))).all()
        veics_map = {veh.id: veh for veh in veics}

    out: list[ViagemOut] = []
    for v in viagens:
        veh = veics_map.get(v.veiculo_id) if v.veiculo_id else None
        n = contagens.get(v.id, 0)
        out.append(
            ViagemOut(
                **v.model_dump(),
                passageiros=n,
                veiculo_placa=veh.placa if veh else "",
                veiculo_modelo=veh.modelo if veh else "",
            )
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
    exige_permissao_viagem_passada(ator, data.data_viagem)
    exige_sem_retroativo(ator, data.data_viagem, True)
    mid, mnome = _resolver_motorista(db, data.motorista_id, data.motorista)
    _exigir_sem_conflito(db, data.data_viagem, data.hora_saida, data.hora_retorno,
                         data.veiculo_id, mid, mnome)
    obj = Viagem(**{**data.model_dump(), "motorista_id": mid, "motorista": mnome})
    db.add(obj)
    db.commit()
    db.refresh(obj)
    placa = modelo = ""
    if obj.veiculo_id:
        veh = db.get(Veiculo, obj.veiculo_id)
        placa = veh.placa if veh else ""
        modelo = veh.modelo if veh else ""
    return ViagemOut(**obj.model_dump(), passageiros=0, veiculo_placa=placa, veiculo_modelo=modelo)


@router.put("/viagens/{vid}", response_model=ViagemOut)
def atualizar_viagem(
    vid: int, data: ViagemIn, db: Session = Depends(get_db), ator: User = Depends(need_perm("tfd_viagens", "editar"))
):
    obj = db.get(Viagem, vid)
    if not obj:
        raise HTTPException(404, "Viagem não encontrada")
    exige_permissao_viagem_passada(ator, obj.data_viagem)
    exige_permissao_viagem_passada(ator, data.data_viagem)
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
    placa = modelo = ""
    if obj.veiculo_id:
        veh = db.get(Veiculo, obj.veiculo_id)
        placa = veh.placa if veh else ""
        modelo = veh.modelo if veh else ""
    return ViagemOut(**obj.model_dump(), passageiros=n or 0, veiculo_placa=placa, veiculo_modelo=modelo)


@router.patch("/viagens/{vid}/veiculo", response_model=ViagemOut)
def trocar_veiculo_viagem(
    vid: int,
    data: dict,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("tfd_viagens", "tfd_frota_gestao", acoes=("editar",))),
):
    """Troca rápida de veículo na visão semanal (seletor direto no card)."""

    obj = db.get(Viagem, vid)
    if not obj:
        raise HTTPException(404, "Viagem não encontrada")
    exige_permissao_viagem_passada(ator, obj.data_viagem)
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
    modelo = ""
    if obj.veiculo_id:
        veh = db.get(Veiculo, obj.veiculo_id)
        placa = veh.placa if veh else ""
        modelo = veh.modelo if veh else ""
    return ViagemOut(**obj.model_dump(), passageiros=n or 0, veiculo_placa=placa, veiculo_modelo=modelo)


@router.delete("/viagens/{vid}", status_code=204)
def excluir_viagem(vid: int, db: Session = Depends(get_db), ator: User = Depends(need_perm("tfd_viagens", "excluir"))):
    obj = db.get(Viagem, vid)
    if not obj:
        raise HTTPException(404, "Viagem não encontrada")
    exige_permissao_viagem_passada(ator, obj.data_viagem)
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
        prio = getattr(vp, "prioridade", "") or ""
        if not prio and vp.viagem_fila_id:
            vf = db.get(ViagemFila, vp.viagem_fila_id)
            if vf and vf.prioridade:
                prio = vf.prioridade
        out.append(
            ViagemPacienteOut(
                **vp.model_dump(), paciente_nome=pac.nome if pac else "?", prioridade=prio
            )
        )
    return out


@router.post("/viagens/{vid}/passageiros", response_model=ViagemPacienteOut, status_code=201)
def add_passageiro(
    vid: int,
    data: ViagemPacienteIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("tfd_viagens", "criar")),
):
    viagem = db.get(Viagem, vid)
    if not viagem:
        raise HTTPException(404, "Viagem não encontrada")
    exige_permissao_viagem_passada(ator, viagem.data_viagem)
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
        obj.observacoes = getattr(obj, "observacoes", "") or fila.observacoes or ""
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
    prio = (fila.prioridade if fila and fila.prioridade else "")
    return ViagemPacienteOut(**obj.model_dump(), paciente_nome=pac.nome if pac else "", prioridade=prio)


@router.delete("/viagens/{vid}/passageiros/{vpid}", status_code=204)
def remover_passageiro(
    vid: int, vpid: int, db: Session = Depends(get_db), ator: User = Depends(need_perm("tfd_viagens", "excluir"))
):
    viagem = db.get(Viagem, vid)
    if not viagem:
        raise HTTPException(404, "Viagem não encontrada")
    exige_permissao_viagem_passada(ator, viagem.data_viagem)
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
    "CONSULTA ESPECIALIZADA",
    "RETORNO CONSULTA ESPECIALIZADA",
})

MAPA_ESPECIALIDADES_CANONICAS = [
    ("GASTROENTEROLOG", "225125", "Médico Gastroenterologista"),
    ("CARDIOLOG", "225120", "Médico Cardiologista"),
    ("DERMATOLOG", "225135", "Médico Dermatologista"),
    ("ORTOPED", "225270", "Médico Ortopedista e Traumatologista"),
    ("TRAUMATOLOG", "225270", "Médico Ortopedista e Traumatologista"),
    ("OFTALMOLOG", "225265", "Médico Oftalmologista"),
    ("NEUROLOG", "225112", "Médico Neurologista"),
    ("UROLOG", "225285", "Médico Urologista"),
    ("PEDIATR", "225124", "Médico Pediatra"),
    ("GINECOLOG", "225250", "Médico Ginecologista e Obstetra"),
    ("OBSTETR", "225250", "Médico Ginecologista e Obstetra"),
    ("ENDOCRINOLOG", "225155", "Médico Endocrinologista e Metabologista"),
    ("PSIQUIATR", "225133", "Médico Psiquiatra"),
    ("CIRURGIA GERAL", "225225", "Médico Cirurgião Geral"),
    ("CIRURGIAO GERAL", "225225", "Médico Cirurgião Geral"),
    ("OTORRINOLARINGOLOG", "225275", "Médico Otorrinolaringologista"),
    ("OTORRINO", "225275", "Médico Otorrinolaringologista"),
    ("REUMATOLOG", "225145", "Médico Reumatologista"),
    ("PNEUMOLOG", "225180", "Médico Pneumologista"),
    ("INFECTOLOG", "225103", "Médico Infectologista"),
    ("NEFROLOG", "225109", "Médico Nefrologista"),
    ("HEMATOLOG", "225185", "Médico Hematologista"),
    ("VASCULAR", "225280", "Médico Cirurgião Vascular"),
    ("ANGIOLOG", "225280", "Médico Cirurgião Vascular"),
    ("MASTOLOG", "225255", "Médico Mastologista"),
    ("ONCOLOG", "225122", "Médico Cancerologista / Oncologista"),
    ("CANCEROLOG", "225122", "Médico Cancerologista / Oncologista"),
    ("GERIATRA", "225180", "Médico Geriatra"),
    ("GERIATRI", "225180", "Médico Geriatra"),
    ("ALERG", "225110", "Médico Alergista e Imunologista"),
]

CBO_PARA_NOME_CANONICO = {cbo: nome for _, cbo, nome in MAPA_ESPECIALIDADES_CANONICAS}

TERMOS_FILA_GENERICOS = {
    "CONSULTAS ESPECIALIZADAS",
    "CONSULTA ESPECIALIZADA",
    "RETORNO CONSULTA ESPECIALIZADA",
    "CONSULTAS",
    "CONSULTA",
    "EXAMES",
    "EXAME",
    "PROCEDIMENTOS",
    "PROCEDIMENTO",
    "GERAL",
    "",
}


def _remover_acentos(texto: str) -> str:
    if not texto:
        return ""
    import unicodedata

    nfkd = unicodedata.normalize("NFKD", texto)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def _identificar_grupo_especialidade(e: ExameFila) -> tuple[str, str]:
    """Retorna (chave_unica, rotulo_amigavel) unificando estritamente qualquer variação
    da mesma especialidade médica (CBO, nome de especialidade ou menção no procedimento)
    para garantir que NUNCA existam duas pessoas em 1º ou 2º lugar e que a ordenação seja
    estritamente sequencial (1, 2, 3...) dentro da especialidade.
    """
    cbo = (e.codigo_especialidade or "").strip()
    if cbo and cbo in CBO_PARA_NOME_CANONICO:
        return f"CBO:{cbo}", CBO_PARA_NOME_CANONICO[cbo]

    haystack = _remover_acentos(
        f"{e.nome_especialidade or ''} {e.especialidade or ''} {e.exame or ''}"
    ).upper()

    for padrao, cbo_padrao, rotulo_padrao in MAPA_ESPECIALIDADES_CANONICAS:
        if padrao in haystack:
            return f"CBO:{cbo_padrao}", rotulo_padrao

    if cbo:
        rot = (e.nome_especialidade or "").strip() or f"Especialidade CBO {cbo}"
        return f"CBO:{cbo}", rot

    nome_esp = (e.nome_especialidade or "").strip()
    esp = (e.especialidade or "").strip()
    tipo = (e.tipo_fila or "").strip()
    ex = (e.exame or "").strip()

    if nome_esp and _remover_acentos(nome_esp).upper() not in TERMOS_FILA_GENERICOS:
        return f"ESP:{_remover_acentos(nome_esp).upper()}", nome_esp
    if esp and _remover_acentos(esp).upper() not in TERMOS_FILA_GENERICOS:
        return f"ESP:{_remover_acentos(esp).upper()}", esp

    import re as _re
    m = _re.match(r"^[0-9.\-]{4,}\s*-\s*(.+)$", ex)
    nome_proc = (m.group(1) if m else ex).strip() or ex or tipo or "GERAL"
    cod_proc = (e.codigo_procedimento or "").strip()
    chave = f"PROC:{cod_proc}" if cod_proc else f"PROC:{_remover_acentos(nome_proc).upper()}"
    return chave, nome_proc


def _eh_consulta_especializada(e: ExameFila) -> bool:
    tf = _remover_acentos(e.tipo_fila or "").upper()
    esp = _remover_acentos(e.especialidade or "").upper()
    cbo = (e.codigo_especialidade or "").strip()
    if tf in TIPOS_CONSULTA_ESPECIALIZADA or "CONSULTA" in tf or "CONSULTA" in esp:
        return True
    if bool(cbo) or bool(e.nome_especialidade):
        return True
    haystack = _remover_acentos(f"{e.nome_especialidade or ''} {e.especialidade or ''} {e.exame or ''}").upper()
    return any(p in haystack for p, _, _ in MAPA_ESPECIALIDADES_CANONICAS)


def _grupo_fila(e: ExameFila) -> tuple[str, str]:
    """Fila específica do encaminhamento: (chave, rótulo).

    - Consultas especializadas: agrupa pela Especialidade médica canônica.
    - Demais procedimentos: agrupa pelo Tipo de Fila / Procedimento.
    """
    if _eh_consulta_especializada(e):
        return _identificar_grupo_especialidade(e)
    rotulo = (e.tipo_fila or "").strip() or "GERAL"
    return f"TIPO|{rotulo.upper()}", rotulo


def _grupo_especialidade(e: ExameFila) -> str:
    chave, _ = _identificar_grupo_especialidade(e)
    return chave


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


RISCO_ROTULO = {"rotina": "Eletivo", "urgente": "Priorizado"}


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
    if status == "recepcionado":
        return "Recepcionado"
    if status == "realizado":
        return "Realizado"
    if status == "faltou":
        return "Faltou"
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


def _identificar_grupo_tipo(e: ExameFila) -> tuple[str, str]:
    if _eh_consulta_especializada(e):
        return "CONSULTAS ESPECIALIZADAS", "Consultas Especializadas"
    rot = (e.tipo_fila or "").strip() or "PROCEDIMENTOS"
    return rot.upper(), rot


def _calcular_duplo_rank(
    db: Session,
    status_filtro: str | None = None,
) -> tuple[dict[int, tuple[int, int, str]], dict[int, tuple[int, int, str]]]:
    """Calcula ordenações sequenciais independentes e estritas:
    1. rank_tipo: ordenação sequencial estrita (1, 2, 3...) dentro do Tipo de Fila geral (ex: Consultas Especializadas).
    2. rank_esp: ordenação sequencial estrita (1, 2, 3...) unificada canonicamente por Especialidade / Procedimento.
    Garante que para qualquer especialidade SEMPRE exista apenas uma pessoa em cada posição (1º, 2º, 3º...).
    Retorna (rank_tipo, rank_esp) como dicionários {id: (posicao, total, rotulo)}.
    """
    filtro_st = [ExameFila.status == status_filtro] if status_filtro else [ExameFila.status == "aguardando"]
    base = list(
        db.exec(
            select(ExameFila).where(ExameFila.ativo == True, *filtro_st)
        ).all()
    )
    if not base:
        base = list(
            db.exec(
                select(ExameFila).where(ExameFila.ativo == True, ExameFila.status.in_(["aguardando", "agendado"]))
            ).all()
        )
    # 1. Posição Global por Tipo de Fila
    grupos_tipo: dict[str, list[ExameFila]] = {}
    rotulos_tipo: dict[str, str] = {}
    for e in base:
        chave, rot = _identificar_grupo_tipo(e)
        grupos_tipo.setdefault(chave, []).append(e)
        rotulos_tipo[chave] = rot

    rank_tipo: dict[int, tuple[int, int, str]] = {}
    for chave, membros in grupos_tipo.items():
        total = len(membros)
        for i, m in enumerate(_ordenar_fila(membros)):
            rank_tipo[m.id] = (i + 1, total, rotulos_tipo[chave])

    # 2. Posição por Especialidade / Procedimento (Canônica e Sem Duplicidade de Posições)
    grupos_esp: dict[str, list[ExameFila]] = {}
    rotulos_esp: dict[str, str] = {}
    for e in base:
        chave, rot = _identificar_grupo_especialidade(e)
        grupos_esp.setdefault(chave, []).append(e)
        rotulos_esp[chave] = rot

    rank_esp: dict[int, tuple[int, int, str]] = {}
    for chave, membros in grupos_esp.items():
        total = len(membros)
        for i, m in enumerate(_ordenar_fila(membros)):
            rank_esp[m.id] = (i + 1, total, rotulos_esp[chave])

    return rank_tipo, rank_esp


def _rank_por_grupo(db: Session, status_filtro: str | None = None) -> dict[int, tuple[int, int, str]]:
    """Posição na fila específica do encaminhamento (legado / exportação)."""
    rank_tipo, rank_esp = _calcular_duplo_rank(db, status_filtro)
    filtro_st = [ExameFila.status == status_filtro] if status_filtro else [ExameFila.status == "aguardando"]
    base = list(
        db.exec(
            select(ExameFila).where(ExameFila.ativo == True, *filtro_st)
        ).all()
    )
    if not base:
        base = list(
            db.exec(
                select(ExameFila).where(ExameFila.ativo == True, ExameFila.status.in_(["aguardando", "agendado"]))
            ).all()
        )
    rank_misto: dict[int, tuple[int, int, str]] = {}
    for e in base:
        if _eh_consulta_especializada(e):
            rank_misto[e.id] = rank_esp.get(e.id, (None, None, ""))
        else:
            rank_misto[e.id] = rank_tipo.get(e.id, (None, None, ""))
    return rank_misto


def _com_posicao(
    db: Session,
    itens: list[ExameFila],
    status_filtro: str | None = None,
    filtro_tipo: str = "",
    filtro_esp: str = "",
    filtro_proc: str = "",
    filtro_q: str = "",
    offset_base: int = 0,
    total_filtrado: int | None = None,
) -> list[ExameOut]:
    """Posições segmentadas: tipo de fila, especialidade e legado.
    - Fila por Especialidade: ordem sequencial estrita dos pacientes aguardando aquela especialidade (1º, 2º, 3º...).
    - Fila por Tipo de Fila: posição do paciente em relação a TODAS as consultas especializadas daquele tipo (ex: 2º de 659).
    """
    rank_tipo, rank_esp = _calcular_duplo_rank(db, status_filtro)
    total_geral = len(rank_tipo) or (
        db.exec(
            select(func.count(ExameFila.id)).where(
                ExameFila.ativo == True,
                ExameFila.status == (status_filtro or "aguardando"),
            )
        ).one() or 1
    )

    filtrando_especialidade = bool(
        filtro_esp
        or (filtro_q and any(p in filtro_q.upper() for p, _, _ in MAPA_ESPECIALIDADES_CANONICAS))
    )
    filtrando_tipo = bool(filtro_tipo)

    # Otimização N+1: pré-carrega todos os pacientes da página em lote único
    pacs_map: dict[int, Paciente] = {}
    pac_ids = {e.paciente_id for e in itens if e.paciente_id}
    if pac_ids:
        pacs = db.exec(select(Paciente).where(Paciente.id.in_(pac_ids))).all()
        pacs_map = {p.id: p for p in pacs}

    out: list[ExameOut] = []
    for idx_item, e in enumerate(itens):
        pac = pacs_map.get(e.paciente_id)
        pos_t_global, tot_t_global, rot_t_global = rank_tipo.get(e.id, (None, None, ""))
        pos_esp_global, tot_esp_global, rot_esp_global = rank_esp.get(e.id, (None, None, ""))

        pos_seq = offset_base + idx_item + 1

        if filtrando_especialidade:
            # Ao filtrar por Especialidade (ex: Cardiologista, mesmo que o filtro de Tipo também esteja preenchido):
            # - Posição por Especialidade: 1º, 2º, 3º... daquela especialidade
            # - Posição por Tipo de Fila: posição do paciente em relação a TODAS as consultas especializadas (ex: 2º de 659)
            pos_esp = pos_seq
            tot_esp = total_filtrado or tot_esp_global
            rot_esp = rot_esp_global or (e.nome_especialidade or e.especialidade or "Especialidade")
            pos_t = pos_t_global
            tot_t = tot_t_global
            rot_t = rot_t_global or "Consultas Especializadas"
        elif filtrando_tipo:
            # Ao filtrar apenas por Tipo de Fila (ex: Consultas Especializadas como um todo):
            # - Posição por Tipo de Fila: 1º, 2º, 3º... de todas as consultas especializadas
            # - Posição por Especialidade: posição individual de cada um na sua respectiva especialidade
            pos_t = pos_seq
            tot_t = total_filtrado or tot_t_global
            rot_t = rot_t_global or (e.tipo_fila or "Tipo de Fila")
            pos_esp = pos_esp_global
            tot_esp = tot_esp_global
            rot_esp = rot_esp_global
        else:
            pos_t = pos_t_global
            tot_t = tot_t_global
            rot_t = rot_t_global
            pos_esp = pos_esp_global
            tot_esp = tot_esp_global
            rot_esp = rot_esp_global

        pos_leg = pos_esp if _eh_consulta_especializada(e) else pos_t
        tot_leg = tot_esp if _eh_consulta_especializada(e) else tot_t
        rot_leg = rot_esp if _eh_consulta_especializada(e) else rot_t

        dump = e.model_dump()
        if not dump.get("codigo_curto") and e.id:
            dump["codigo_curto"] = f"EX-{e.id:06d}"

        out.append(
            ExameOut(
                **dump,
                paciente_nome=pac.nome if pac else "?",
                paciente_cpf=pac.cpf if pac else "",
                paciente_endereco=pac.endereco if pac else "",
                paciente_numero=pac.endereco_numero if pac else "",
                paciente_complemento=pac.complemento if pac else "",
                paciente_bairro=pac.bairro if pac else "",
                paciente_municipio=pac.municipio if pac else "",
                paciente_telefone=pac.telefone if pac else "",
                paciente_cns=pac.cns if pac else "",
                paciente_nascimento=pac.nascimento if pac else None,
                posicao=pos_leg,
                total_fila=tot_leg if tot_leg is not None else total_geral,
                grupo_fila=rot_leg or "",
                posicao_tipo=pos_t,
                total_tipo=tot_t,
                grupo_tipo=rot_t or "",
                posicao_especialidade=pos_esp,
                total_especialidade=tot_esp,
                grupo_especialidade=rot_esp or "",
            )
        )
    return out


@router.get("/exames", response_model=Pagina[ExameOut])
@router.get("/fila", response_model=Pagina[ExameOut])
@router.get("/procedimentos/fila", response_model=Pagina[ExameOut])
def listar_exames(
    status_: str | None = Query(default=None, alias="status"),
    q: str = Query(default="", max_length=80),
    prioridade: str | None = None,
    especialidade: str = Query(default="", max_length=80),
    tipo_fila: str = Query(default="", max_length=80),
    procedimento: str = Query(default="", max_length=150),
    codigo_especialidade: str = Query(default="", max_length=10),
    destino: str = Query(default="", max_length=120),
    unidade_id: int | None = Query(default=None),
    unidade: str = Query(default="", max_length=150),
    data_de: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    data_ate: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    agendada_em: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    agendada_de: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    agendada_ate: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    apenas_agendados: bool = Query(default=False),
    meus: bool = Query(default=False),
    ordenacao: str = Query(default="prioridade", pattern="^(prioridade|cronologica)$"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("tfd_exames", "tfd_medico", "tfd_fila_lancamento", "tfd_agenda", "tfd")),
):
    p_meus = meus if isinstance(meus, bool) else False
    p_page = page if isinstance(page, int) and page > 0 else 1
    p_limit = limit if isinstance(limit, int) and limit > 0 else 100
    p_ordenacao = ordenacao if isinstance(ordenacao, str) and ordenacao in ("prioridade", "cronologica") else "prioridade"
    p_status = status_ if isinstance(status_, str) else None
    p_q = q if isinstance(q, str) else ""
    p_esp = especialidade if isinstance(especialidade, str) else ""
    p_tf = tipo_fila if isinstance(tipo_fila, str) else ""
    p_proc = procedimento if isinstance(procedimento, str) else ""
    p_cbo = codigo_especialidade if isinstance(codigo_especialidade, str) else ""
    p_dest = destino if isinstance(destino, str) else ""
    p_uid = unidade_id if isinstance(unidade_id, int) else None
    p_unome = unidade if isinstance(unidade, str) else ""
    p_de = data_de if isinstance(data_de, str) else None
    p_ate = data_ate if isinstance(data_ate, str) else None
    p_ag = agendada_em if isinstance(agendada_em, str) else None
    p_ag_de = agendada_de if isinstance(agendada_de, str) else None
    p_ag_ate = agendada_ate if isinstance(agendada_ate, str) else None
    p_apenas_ag = apenas_agendados if isinstance(apenas_agendados, bool) else False

    itens = _filtrar_exames_lista(
        db, ator, p_status, p_q, prioridade, p_esp, p_tf,
        p_proc, p_cbo, p_dest, p_de, p_ate,
        p_ag, p_meus, p_uid, p_unome,
        p_ag_de, p_ag_ate, p_apenas_ag,
    )
    total = len(itens)
    meta = paginar(total, p_page, p_limit)
    offset = meta["offset"]
    pagina = _ordenar_fila(itens, p_ordenacao)[offset:offset + p_limit]
    return {
        "data": _com_posicao(
            db,
            pagina,
            status_filtro=p_status,
            filtro_tipo=p_tf,
            filtro_esp=p_cbo or p_esp,
            filtro_proc=p_proc,
            filtro_q=p_q,
            offset_base=offset,
            total_filtrado=total,
        ),
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
    unidade_id: int | None = None,
    unidade: str = "",
    agendada_de: str | None = None,
    agendada_ate: str | None = None,
    apenas_agendados: bool = False,
) -> list:
    """Filtros da fila compartilhados entre listagem e exportação XLSX."""
    filtros = [ExameFila.ativo == True]  # noqa: E712
    if isinstance(agendada_em, str) and agendada_em:
        filtros.append(func.to_char(ExameFila.data_agendada, "YYYY-MM-DD") == agendada_em)
    if isinstance(agendada_de, str) and agendada_de:
        try:
            filtros.append(ExameFila.data_agendada >= date.fromisoformat(agendada_de))
        except Exception:
            pass
    if isinstance(agendada_ate, str) and agendada_ate:
        try:
            filtros.append(ExameFila.data_agendada <= date.fromisoformat(agendada_ate))
        except Exception:
            pass
    if apenas_agendados is True:
        filtros.append(ExameFila.data_agendada.isnot(None))
    if meus is True:
        # Painel Médico: só solicitações em que o médico está envolvido.
        med = medico_do_usuario(db, ator)
        if not med:
            return []
        filtros.append(ExameFila.medico_id == med.id)
    if isinstance(status_, str) and status_:
        filtros.append(ExameFila.status == status_)
    if isinstance(prioridade, str) and prioridade:
        filtros.append(ExameFila.prioridade == prioridade)
    if isinstance(unidade_id, int):
        filtros.append(ExameFila.unidade_saude_id == unidade_id)
    elif isinstance(unidade, str) and unidade.strip():
        u_str = unidade.strip()
        filtros.append(
            (ExameFila.unidade_nome.ilike(f"%{u_str}%"))
            | (ExameFila.unidade_cnes == u_str)
        )
    if isinstance(especialidade, str) and especialidade.strip():
        # Compat: busca em especialidade legada + CBO + nome especialidade novo modelo + exame
        like_esp = f"%{especialidade.strip()}%"
        filtros.append(
            (ExameFila.especialidade.ilike(like_esp))
            | (ExameFila.codigo_especialidade.ilike(like_esp))
            | (ExameFila.nome_especialidade.ilike(like_esp))
            | (ExameFila.exame.ilike(like_esp))
        )
    if isinstance(tipo_fila, str) and tipo_fila.strip():
        tf_strip = tipo_fila.strip()
        if tf_strip.upper() in ("EXAME", "PROCEDIMENTO", "EXAMES", "PROCEDIMENTOS"):
            filtros.append(
                (ExameFila.tipo_fila.ilike("%EXAME%"))
                | (ExameFila.tipo_fila.ilike("%PROCEDIMENTO%"))
            )
        else:
            filtros.append(ExameFila.tipo_fila.ilike(f"%{tf_strip}%"))
    if isinstance(procedimento, str) and procedimento.strip():
        # Busca por nome exato do procedimento OU código procedimento OU texto exame
        p_strip = procedimento.strip()
        if p_strip.upper() in ("EXAME", "PROCEDIMENTO", "EXAMES", "PROCEDIMENTOS"):
            filtros.append(
                (ExameFila.exame.ilike("%EXAME%"))
                | (ExameFila.exame.ilike("%PROCEDIMENTO%"))
                | (ExameFila.codigo_procedimento.ilike(f"%{p_strip}%"))
            )
        else:
            filtros.append(
                (ExameFila.exame.ilike(f"%{p_strip}%"))
                | (ExameFila.codigo_procedimento.ilike(f"%{p_strip}%"))
            )
    if isinstance(codigo_especialidade, str) and codigo_especialidade.strip():
        cbo_strip = codigo_especialidade.strip()
        nome_cbo = CBO_PARA_NOME_CANONICO.get(cbo_strip, "")
        if nome_cbo:
            nome_simples = nome_cbo.replace("Médico ", "").replace("médico ", "").strip()
            like_cbo_nome = f"%{nome_simples}%"
            filtros.append(
                (ExameFila.codigo_especialidade == cbo_strip)
                | (ExameFila.nome_especialidade.ilike(like_cbo_nome))
                | (ExameFila.especialidade.ilike(like_cbo_nome))
                | (ExameFila.exame.ilike(like_cbo_nome))
            )
        else:
            filtros.append(ExameFila.codigo_especialidade == cbo_strip)
    if isinstance(destino, str) and destino.strip():
        filtros.append(ExameFila.destino.ilike(f"%{destino}%"))
    if isinstance(data_de, str) and data_de:
        filtros.append(func.to_char(ExameFila.data_pedido, "YYYY-MM-DD") >= data_de)
    if isinstance(data_ate, str) and data_ate:
        filtros.append(func.to_char(ExameFila.data_pedido, "YYYY-MM-DD") <= data_ate)
    if apenas_agendados or agendada_de or agendada_ate or agendada_em:
        base = (
            select(ExameFila)
            .where(*filtros)
            .order_by(ExameFila.data_agendada.asc(), ExameFila.hora_agendada.asc())
        )
    else:
        base = (
            select(ExameFila)
            .where(*filtros)
            .order_by(ExameFila.data_pedido.desc())
        )
    itens = list(db.exec(base).all())
    if isinstance(q, str) and q.strip():
        ql = q.strip().lower()
        palavras = [p for p in ql.split() if p]
        com_nome = []
        for e in itens:
            pac = db.get(Paciente, e.paciente_id)
            pront = (pac.codigo_prontuario or "") if pac else ""
            pront_num = "".join(c for c in pront if c.isdigit())
            hay = " ".join([
                str(e.id),
                f"EX-{e.id:06d}",
                str(e.id).zfill(6),
                e.codigo_curto or "",
                str(e.paciente_id),
                pront,
                pront_num,
                f"PR-{e.paciente_id:05d}",
                e.exame or "", e.especialidade or "", e.tipo_fila or "",
                e.codigo_procedimento or "", e.codigo_especialidade or "",
                e.nome_especialidade or "", e.destino or "",
                pac.nome if pac else "", pac.cns if pac else "",
                pac.cpf if pac else "",
            ]).lower()
            if all(p in hay for p in palavras):
                com_nome.append(e)
        itens = com_nome
    return _ordenar_fila(itens)


COLS_FILA = [
    {"chave": "codigo_curto", "rotulo": "ID do Pedido", "largura": 16},
    {"chave": "posicao", "rotulo": "Posição", "largura": 10},
    {"chave": "posicao_tipo", "rotulo": "Posição Geral da Fila SUS", "largura": 24},
    {"chave": "posicao_especialidade", "rotulo": "Posição Especialidade", "largura": 22},
    {"chave": "risco", "rotulo": "Prioridade / Classificação de risco", "largura": 26},
    {"chave": "status", "rotulo": "Status", "largura": 20},
    {"chave": "data_pedido", "rotulo": "Data do Envio para Fila", "largura": 20, "formato": "data"},
    {"chave": "exame", "rotulo": "Procedimento", "largura": 48},
    {"chave": "especialidade", "rotulo": "Especialidade", "largura": 28},
    {"chave": "prontuario", "rotulo": "Prontuário", "largura": 16},
    {"chave": "paciente", "rotulo": "Paciente", "largura": 34},
    {"chave": "cpf", "rotulo": "CPF", "largura": 18, "formato": "texto"},
    {"chave": "cns", "rotulo": "Cartão SUS / CNS", "largura": 20, "formato": "texto"},
    {"chave": "logradouro", "rotulo": "Logradouro", "largura": 32},
    {"chave": "numero", "rotulo": "Número", "largura": 12, "formato": "texto"},
    {"chave": "bairro", "rotulo": "Bairro", "largura": 24},
    {"chave": "complemento", "rotulo": "Complemento", "largura": 18},
    {"chave": "municipio", "rotulo": "Município", "largura": 20},
    {"chave": "cep", "rotulo": "CEP", "largura": 14, "formato": "texto"},
    {"chave": "telefone", "rotulo": "Telefone", "largura": 18, "formato": "texto"},
    {"chave": "endereco_completo", "rotulo": "Endereço completo", "largura": 44},
    {"chave": "codigo_procedimento", "rotulo": "Código do Procedimento", "largura": 22},
    {"chave": "grupo_fila", "rotulo": "Fila específica", "largura": 28},
    {"chave": "data_agendada", "rotulo": "Data agendada", "largura": 14, "formato": "data"},
    {"chave": "hora", "rotulo": "Hora", "largura": 10},
    {"chave": "medico", "rotulo": "Médico", "largura": 28},
    {"chave": "unidade", "rotulo": "Unidade / destino", "largura": 28},
    {"chave": "numero_pedido", "rotulo": "Nº do Pedido", "largura": 16},
    {"chave": "justificativa", "rotulo": "Justificativa", "largura": 35},
    {"chave": "observacoes", "rotulo": "Observações", "largura": 35},
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


def _linha_fila(
    db: Session,
    cache: dict,
    e,
    pos: int | None = None,
    pos_tipo: int | None = None,
    pos_esp: int | None = None,
) -> dict:
    pac = cache.get(e.paciente_id)
    if pac is None:
        pac = db.get(Paciente, e.paciente_id)
        cache[e.paciente_id] = pac
    _, rotulo = _grupo_fila(e)
    cpf = "".join(c for c in (pac.cpf if pac else "") if c.isdigit())
    cns = "".join(c for c in (pac.cns if pac else "") if c.isdigit())
    pec = cache.get("pec") or {}
    comp = pec.get(f"cpf:{cpf}") or pec.get(f"cns:{cns}") or {}
    cod_curto = getattr(e, "codigo_curto", "") or (f"EX-{e.id:06d}" if getattr(e, "id", None) else "")
    prontuario = getattr(pac, "codigo_prontuario", "") or (f"PR-{pac.id:05d}" if pac and getattr(pac, "id", None) else "")

    nome_exame = (e.exame or "").strip()
    cod_proc = (e.codigo_procedimento or "").strip()
    if cod_proc and cod_proc not in nome_exame:
        procedimento_str = f"{cod_proc} - {nome_exame}"
    else:
        procedimento_str = nome_exame

    return {
        "codigo_curto": cod_curto,
        "posicao": pos or "",
        "posicao_tipo": pos_tipo or "",
        "posicao_especialidade": pos_esp or "",
        "risco": _risco_rotulo(e.prioridade),
        "status": _status_rotulo(e),
        "data_pedido": e.data_pedido,
        "exame": procedimento_str,
        "especialidade": e.nome_especialidade or e.especialidade or e.tipo_fila or "",
        "prontuario": prontuario,
        "paciente": pac.nome if pac else "?",
        "cpf": pac.cpf if pac else "",
        "cns": (pac.cns if pac and pac.cns else comp.get("cns", "")) or "",
        "logradouro": (pac.endereco or "") if pac else "",
        "numero": (pac.endereco_numero or "") if pac else "",
        "bairro": (pac.bairro or "") if pac else "",
        "complemento": getattr(pac, "complemento", "") or "" if pac else "",
        "municipio": (pac.municipio or "") if pac else "",
        "cep": (pac.cep or "") if pac else "",
        "telefone": pac.telefone if pac else "",
        "endereco_completo": _endereco_completo(pac),
        "codigo_procedimento": cod_proc,
        "grupo_fila": rotulo,
        "data_agendada": e.data_agendada,
        "hora": e.hora_agendada or "",
        "medico": e.medico_nome or "",
        "unidade": e.unidade_nome or e.destino or "",
        "numero_pedido": e.numero_pedido or "",
        "justificativa": e.justificativa or e.justificativa_prioridade or "",
        "observacoes": e.observacoes or "",
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
    unidade_id: int | None = Query(default=None),
    unidade: str = Query(default="", max_length=150),
    data_de: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    data_ate: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    agendada_em: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    meus: bool = Query(default=False),
    ordenacao: str = Query(default="prioridade", pattern="^(prioridade|cronologica)$"),
    colunas: str | None = Query(default=None),
    ids: str | None = Query(default=None),
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("tfd_exames", "tfd_medico", "tfd_fila_lancamento")),
):
    """Exporta a fila de espera em XLSX respeitando os filtros ativos e seleção de colunas."""
    from app.services.export_xlsx import resposta_xlsx
    from app.core.audit import registrar_log_exportacao

    ids_set: set[int] = set()
    ids_str = ids if isinstance(ids, str) else None
    if ids_str and ids_str.strip():
        ids_set = {int(x.strip()) for x in ids_str.split(",") if x.strip().isdigit()}

    st_val = status_ if isinstance(status_, str) else None
    q_val = q if isinstance(q, str) else ""
    prio_val = prioridade if isinstance(prioridade, str) else None
    esp_val = especialidade if isinstance(especialidade, str) else ""
    tipo_val = tipo_fila if isinstance(tipo_fila, str) else ""
    proc_val = procedimento if isinstance(procedimento, str) else ""
    cod_esp_val = codigo_especialidade if isinstance(codigo_especialidade, str) else ""
    dest_val = destino if isinstance(destino, str) else ""
    unid_id_val = unidade_id if isinstance(unidade_id, int) else None
    unid_val = unidade if isinstance(unidade, str) else ""
    de_val = data_de if isinstance(data_de, str) else None
    ate_val = data_ate if isinstance(data_ate, str) else None
    ag_val = agendada_em if isinstance(agendada_em, str) else None
    meus_val = meus if isinstance(meus, bool) else False
    ordem_val = ordenacao if isinstance(ordenacao, str) else "prioridade"
    cols_val = colunas if isinstance(colunas, str) else None

    itens = _filtrar_exames_lista(
        db, ator, st_val, q_val, prio_val, esp_val, tipo_val,
        proc_val, cod_esp_val, dest_val, de_val, ate_val,
        ag_val, meus_val, unid_id_val, unid_val,
    )
    if ids_set:
        itens_filtrados = [it for it in itens if it.id in ids_set]
        itens_presentes = {it.id for it in itens_filtrados}
        faltantes = ids_set - itens_presentes
        if faltantes:
            extras = list(db.exec(select(ExameFila).where(ExameFila.id.in_(faltantes), ExameFila.ativo == True)).all())
            itens_filtrados.extend(extras)
        itens = itens_filtrados

    itens = _ordenar_fila(itens, ordem_val)
    filtrando_especialidade = bool(
        esp_val
        or cod_esp_val
        or proc_val
        or (q_val and any(p in q_val.upper() for p, _, _ in MAPA_ESPECIALIDADES_CANONICAS))
    )
    filtrando_tipo = bool(tipo_val)
    rank_tipo, rank_esp = _calcular_duplo_rank(db, status_filtro=st_val)
    cache: dict = {}
    for e in itens:
        if e.paciente_id not in cache:
            cache[e.paciente_id] = db.get(Paciente, e.paciente_id)
    cpfs = {"".join(c for c in (p.cpf or "") if c.isdigit()) for p in cache.values() if p}
    cnss = {"".join(c for c in (p.cns or "") if c.isdigit()) for p in cache.values() if p}
    cache["pec"] = _pec_documentos({c for c in cpfs if c}, {c for c in cnss if c})
    linhas = []
    for idx_item, e in enumerate(itens):
        pos_t_global, _, _ = rank_tipo.get(e.id, (None, None, ""))
        pos_esp_global, _, _ = rank_esp.get(e.id, (None, None, ""))
        pos_seq = idx_item + 1

        if filtrando_especialidade:
            pos_esp = pos_seq
            pos_tipo = pos_t_global
        elif filtrando_tipo:
            pos_tipo = pos_seq
            pos_esp = pos_esp_global
        else:
            pos_tipo = pos_t_global
            pos_esp = pos_esp_global

        pos_leg = pos_esp if _eh_consulta_especializada(e) else pos_tipo
        linhas.append(
            _linha_fila(
                db,
                cache,
                e,
                pos=pos_leg,
                pos_tipo=pos_tipo,
                pos_esp=pos_esp,
            )
        )

    # Filtragem de colunas caso informadas pelo seletor de exportação
    cols = COLS_FILA
    if cols_val:
        mapa_colunas_frontend: dict[str, list[str]] = {
            "codigo_curto": ["codigo_curto"],
            "id_pedido": ["codigo_curto"],
            "posicao": ["posicao"],
            "posicao_tipo": ["posicao_tipo"],
            "posicao_geral": ["posicao_tipo"],
            "posicao_especialidade": ["posicao_especialidade"],
            "prioridade": ["risco"],
            "risco": ["risco"],
            "status": ["status"],
            "data_pedido": ["data_pedido"],
            "exame": ["exame"],
            "especialidade": ["especialidade"],
            "prontuario": ["prontuario"],
            "paciente": ["paciente"],
            "paciente_nome": ["paciente", "cpf", "cns"],
            "cpf": ["cpf"],
            "cns": ["cns"],
            "logradouro": ["logradouro"],
            "numero": ["numero"],
            "bairro": ["bairro"],
            "complemento": ["complemento"],
            "municipio": ["municipio"],
            "cep": ["cep"],
            "telefone": ["telefone"],
            "endereco": ["endereco_completo", "logradouro", "numero", "complemento", "bairro", "municipio", "cep"],
            "endereco_completo": ["endereco_completo"],
            "codigo_procedimento": ["codigo_procedimento"],
            "tipo_fila": ["grupo_fila"],
            "data_agendada": ["data_agendada", "hora"],
            "destino": ["unidade"],
            "observacoes": ["observacoes"],
            "numero_pedido": ["numero_pedido"],
            "justificativa": ["justificativa"],
        }
        chaves_selecionadas = set()
        for c in cols_val.split(","):
            c_trim = c.strip()
            if not c_trim:
                continue
            if c_trim in mapa_colunas_frontend:
                chaves_selecionadas.update(mapa_colunas_frontend[c_trim])
            else:
                chaves_selecionadas.add(c_trim)
        filtradas = [c for c in COLS_FILA if c["chave"] in chaves_selecionadas]
        if filtradas:
            cols = filtradas

    titulo_relatorio = "Fila de espera — procedimentos" if not ids_set else f"Fila de espera — {len(linhas)} paciente(s) selecionado(s)"

    registrar_log_exportacao(
        modulo="tfd_fila",
        titulo=titulo_relatorio,
        usuario_id=ator.id,
        usuario_nome=ator.nome or ator.username,
        total_linhas=len(linhas),
        filtros={
            "status": st_val,
            "q": q_val,
            "prioridade": prio_val,
            "tipo_fila": tipo_val,
            "procedimento": proc_val,
            "codigo_especialidade": cod_esp_val,
            "destino": dest_val,
            "ids_selecionados": list(ids_set) if ids_set else None,
            "colunas": cols_val,
        },
    )

    return resposta_xlsx(
        titulo_relatorio,
        ator.nome or ator.username,
        cols, linhas, "fila_procedimentos",
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
@router.get("/procedimentos/filtros-opcoes", response_model=FiltrosOpcoesOut)
@router.get("/fila/filtros-opcoes", response_model=FiltrosOpcoesOut)
def filtros_opcoes(
    status_: str | None = Query(default="aguardando", alias="status"),
    tipo_fila: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("tfd_exames", "tfd_fila_lancamento", "tfd_medico")),
):
    """Agrega Tipo de Fila / Procedimento / Especialidade-CBO com totais.

    Fonte primária: tfd_exames_fila (dados reais importados). Catálogo
    dinâmico (tfd_tipos_fila / tfd_procedimentos / tfd_especialidades)
    completa nomes zerados quando inativados não entram na fila.
    """
    from sqlalchemy import func as sa_func

    base_f = [ExameFila.status == status_] if status_ else []

    # Se tipo_fila for informado, especialidades e procedimentos são filtrados por ele
    tf_filtro = (tipo_fila or "").strip()
    base_procs_esps = list(base_f)
    if tf_filtro:
        base_procs_esps.append(ExameFila.tipo_fila == tf_filtro)

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
    # Procedimentos: agrupa por codigo_procedimento + nome limpo (filtrado por tipo_fila se informado)
    procs: list[OpcaoFiltro] = []
    rows_p = db.exec(
        select(ExameFila.codigo_procedimento, ExameFila.exame, sa_func.count(ExameFila.id))
        .where(*base_procs_esps)
        .group_by(ExameFila.codigo_procedimento, ExameFila.exame)
        .order_by(sa_func.count(ExameFila.id).desc())
        .limit(500)
    ).all()
    for cod, exame, n in rows_p:
        nome_limpo = (exame or "").strip()
        # exame legado = "COD - NOME"; exibe NOME (COD)
        m = _re.match(r"^[0-9.\-]{4,}\s*-\s*(.+)$", nome_limpo)
        nome_curto = (m.group(1) if m else nome_limpo).strip() or nome_limpo
        value = nome_curto or (cod or "")
        label = f"{nome_curto} ({n})" if nome_curto else f"{cod} ({n})"
        if value:
            procs.append(OpcaoFiltro(value=value, label=label, total=n or 0))
    # Especialidades CBO (agrupamento canônico unificado, filtrado por tipo_fila se informado)
    esps_map: dict[str, dict] = {}
    todos_itens = db.exec(select(ExameFila).where(*base_procs_esps)).all()
    for e in todos_itens:
        chave, rot = _identificar_grupo_especialidade(e)
        if chave.startswith("CBO:"):
            cbo = chave.split(":", 1)[1]
            if cbo not in esps_map:
                esps_map[cbo] = {"val": cbo, "rot": rot, "total": 0}
            esps_map[cbo]["total"] += 1
        elif chave.startswith("ESP:") and rot.strip().upper() not in TERMOS_FILA_GENERICOS:
            if rot not in esps_map:
                esps_map[rot] = {"val": rot, "rot": rot, "total": 0}
            esps_map[rot]["total"] += 1

    esps: list[OpcaoFiltro] = [
        OpcaoFiltro(
            value=d["val"],
            label=f"{d['rot']} - CBO {d['val']} ({d['total']})" if d["val"].isdigit() else f"{d['rot']} ({d['total']})",
            total=d["total"],
        )
        for d in sorted(esps_map.values(), key=lambda x: x["total"], reverse=True)[:100]
    ]
    return FiltrosOpcoesOut(tipos=tipos, procedimentos=procs, especialidades=esps)


def _garantir_token(obj: ExameFila) -> str:
    import secrets

    if not obj.public_token:
        obj.public_token = secrets.token_urlsafe(24)
    return obj.public_token


def eh_tfd_central(ator: User) -> bool:
    """Verifica se o usuário possui perfil central do TFD.
    Usuários centrais (ou superusuários) podem lançar pedidos para qualquer unidade
    e escolher livremente a data de lançamento.
    Usuários lotados em PSF só podem lançar para o dia atual e vinculados à sua própria unidade.
    """
    if ator.is_superuser:
        return True
    from app.services.permissoes import tem_tela
    tem_tfd_geral = tem_tela(ator, "tfd") and not tem_tela(ator, "tfd_fila_lancamento")
    if tem_tfd_geral and not (ator.unidade_saude_id and tem_tela(ator, "tfd_fila_lancamento")):
        return True
    if tem_tela(ator, "tfd_resumo") and not ator.unidade_saude_id:
        return True
    return False


@router.post("/exames", response_model=ExameOut, status_code=201)
def criar_exame(data: ExameIn, db: Session = Depends(get_db), ator: User = Depends(need_any_perm("tfd_exames", "tfd_fila_lancamento", acoes=("criar",)))):
    if not db.get(Paciente, data.paciente_id):
        raise HTTPException(404, "Paciente não encontrado")
    exige_sem_retroativo(ator, data.data_pedido, True)
    exige_sem_retroativo(ator, data.data_agendada, data.data_agendada is not None)
    payload = data.model_dump()

    # Regra 2: Restrições de Lançamento por Perfil (PSF vs. TFD)
    is_central = eh_tfd_central(ator)
    hoje = date.today()

    if not is_central:
        # Usuário PSF: data de pedido deve ser estritamente o dia atual
        if data.data_pedido != hoje:
            raise HTTPException(403, "Usuários do PSF só podem lançar solicitações para o dia atual.")

        # Usuário PSF: unidade solicitante deve ser estritamente a sua própria unidade
        if ator.unidade_saude_id:
            if payload.get("unidade_saude_id") and payload.get("unidade_saude_id") != ator.unidade_saude_id:
                raise HTTPException(403, "Usuários do PSF só podem lançar pedidos vinculados à sua própria unidade.")
            payload["unidade_saude_id"] = ator.unidade_saude_id

    # Perfil de Lançamento Restrito: apenas adiciona à fila, sem marcar urgente e sem agendar direto
    from app.services.permissoes import tem_tela
    if not ator.is_superuser and tem_tela(ator, "tfd_fila_lancamento") and not tem_tela(ator, "tfd_exames") and not tem_tela(ator, "tfd_medico"):
        if (payload.get("prioridade") or "").lower() == "urgente":
            raise HTTPException(403, "Perfil de lançamento restrito não pode definir prioridade urgente.")
        if payload.get("data_agendada"):
            raise HTTPException(403, "Perfil de lançamento restrito não pode realizar agendamento direto.")

    # Snapshot de unidade de saúde de origem (se informada ou vinculada)
    if payload.get("unidade_saude_id") and not payload.get("data_agendada"):
        uni_origem = db.get(UnidadeSaude, payload["unidade_saude_id"])
        if uni_origem:
            payload["unidade_nome"] = uni_origem.nome or ""
            payload["unidade_cnes"] = uni_origem.cnes or ""
            payload["unidade_endereco"] = uni_origem.endereco or ""
            payload["unidade_numero"] = getattr(uni_origem, "numero", "") or ""
            payload["unidade_bairro"] = uni_origem.bairro or ""
            payload["unidade_municipio"] = getattr(uni_origem, "municipio", "") or ""
            payload["unidade_cep"] = getattr(uni_origem, "cep", "") or ""

    # Snapshot de médico requisitante (se informado)
    if payload.get("medico_id") and not payload.get("data_agendada"):
        med_origem = db.get(Medico, payload["medico_id"])
        if med_origem:
            payload["medico_nome"] = med_origem.nome or ""
            payload["medico_cpf"] = med_origem.cpf or ""
            payload["medico_cbo_codigo"] = getattr(med_origem, "cbo_codigo", "") or ""
            payload["medico_cbo_descricao"] = getattr(med_origem, "cbo_descricao", "") or ""

    if payload.get("codigo_curto"):
        payload["codigo_curto"] = str(payload["codigo_curto"]).strip().upper()
    if payload.get("numero_pedido"):
        payload["numero_pedido"] = str(payload["numero_pedido"]).strip().upper()[:30]
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
    if not obj.codigo_curto and obj.id:
        obj.codigo_curto = f"EX-{obj.id:06d}"
        db.add(obj)
        db.commit()
        db.refresh(obj)

    # Disparo automático via WhatsApp (Entrada na Fila / Agendamento)
    try:
        from app.services.whatsapp import notificar_paciente_evento
        evento_whats = "agendamento" if obj.data_agendada else "entrada_fila"
        notificar_paciente_evento(db, evento_whats, obj)
    except Exception:
        pass

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
    if agendando:
        try:
            from app.services.whatsapp import notificar_paciente_evento
            for i in ids:
                ob = objs.get(i)
                if ob and ob.data_agendada:
                    notificar_paciente_evento(db, "agendamento", ob)
        except Exception:
            pass
    return ExameLoteOut(atualizados=n, nao_encontrados=faltando)


@router.get("/exames/{eid}", response_model=ExameOut)
def obter_exame(
    eid: int,
    db: Session = Depends(get_db),
    ator: User = Depends(get_current_user),
):
    """Consulta detalhada de uma solicitação/exame específico por ID."""
    if not (bool(getattr(ator, "is_superuser", False)) or tem_tela(ator, "tfd_exames") or tem_tela(ator, "tfd") or tem_tela(ator, "tfd_medico") or tem_tela(ator, "lab_recepcao")):
        raise HTTPException(403, "Sem acesso à fila de solicitações")
    obj = db.get(ExameFila, eid)
    if not obj or not obj.ativo:
        raise HTTPException(404, "Exame não encontrado")
    return _com_posicao(db, [obj])[0]


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
    if getattr(data, "numero_pedido", ""):
        obj.numero_pedido = str(data.numero_pedido).strip().upper()[:30]
    db.add(obj)
    db.commit()
    db.refresh(obj)
    pac = db.get(Paciente, obj.paciente_id)

    if novo_agendamento and obj.data_agendada:
        try:
            from app.services.whatsapp import notificar_paciente_evento
            notificar_paciente_evento(db, "agendamento", obj, pac)
        except Exception:
            pass

    rank = _rank_por_grupo(db)
    pos, _, rotulo = rank.get(obj.id, (None, None, ""))
    return ExameOut(
        **obj.model_dump(),
        paciente_nome=pac.nome if pac else "",
        paciente_cpf=pac.cpf if pac else "",
        paciente_endereco=pac.endereco if pac else "",
        paciente_numero=pac.endereco_numero if pac else "",
        paciente_complemento=pac.complemento if pac else "",
        paciente_bairro=pac.bairro if pac else "",
        paciente_municipio=pac.municipio if pac else "",
        paciente_telefone=pac.telefone if pac else "",
        paciente_cns=pac.cns if pac else "",
        paciente_nascimento=pac.nascimento if pac else None,
        posicao=pos,
        grupo_fila=rotulo or "",
    )


@router.post("/exames/{eid}/recepcionar", response_model=ExameOut)
def recepcionar_exame(
    eid: int, db: Session = Depends(get_db), ator: User = Depends(need_perm("tfd_agenda", "editar"))
):
    """Check-in na recepção: agendado -> recepcionado (guarda status anterior)."""
    from datetime import datetime

    obj = db.get(ExameFila, eid)
    if not obj or not obj.ativo:
        raise HTTPException(404, "Agendamento não encontrado")
    if (obj.status or "") != "agendado":
        raise HTTPException(400, f"Só agendados podem ser recepcionados (atual: {obj.status or '—'}).")
    obj.status_anterior = obj.status or ""
    obj.status = "recepcionado"
    obj.recepcionado_em = datetime.now()
    obj.recepcionado_por = (ator.nome or ator.username or "")[:120]
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _com_posicao(db, [obj])[0]


@router.post("/exames/{eid}/estornar-recepcao", response_model=ExameOut)
def estornar_recepcao_exame(
    eid: int, db: Session = Depends(get_db), _=Depends(need_perm("tfd_agenda", "editar"))
):
    """Reverte recepção lançada por engano: recepcionado -> status anterior."""
    obj = db.get(ExameFila, eid)
    if not obj or not obj.ativo:
        raise HTTPException(404, "Agendamento não encontrado")
    if (obj.status or "") != "recepcionado":
        raise HTTPException(400, f"Só recepcionados podem ser estornados (atual: {obj.status or '—'}).")
    obj.status = (obj.status_anterior or "agendado").strip() or "agendado"
    obj.status_anterior = ""
    obj.recepcionado_em = None
    obj.recepcionado_por = ""
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _com_posicao(db, [obj])[0]


class AtendimentoStatusIn(BaseModel):
    status: str
    resultado: str = ""


@router.post("/exames/{eid}/atendimento-status", response_model=ExameOut)
def definir_status_atendimento(
    eid: int, data: AtendimentoStatusIn, db: Session = Depends(get_db),
    _=Depends(need_perm("tfd_agenda", "editar")),
):
    """Gestão do atendimento: faltou | realizado (+resultado) | cancelado.

    Aceita a partir de agendado/recepcionado. Resultado obrigatório
    ao marcar realizado.
    """
    alvo = (data.status or "").strip().lower()
    if alvo not in ("faltou", "realizado", "cancelado"):
        raise HTTPException(400, "Status inválido (use faltou, realizado ou cancelado).")
    obj = db.get(ExameFila, eid)
    if not obj or not obj.ativo:
        raise HTTPException(404, "Agendamento não encontrado")
    if (obj.status or "") not in ("agendado", "recepcionado"):
        raise HTTPException(400, f"Só agendados/recepcionados mudam de status (atual: {obj.status or '—'}).")
    if alvo == "realizado":
        texto = (data.resultado or "").strip()
        if not texto:
            raise HTTPException(400, "Informe o resultado do exame realizado.")
        obj.resultado = texto[:2000]
    obj.status_anterior = obj.status or ""
    obj.status = alvo
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _com_posicao(db, [obj])[0]


class ExameIdsIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)


class AtendimentoStatusLoteIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)
    status: str
    resultado: str = ""


@router.post("/exames/recepcionar-lote")
def recepcionar_exames_lote(
    data: ExameIdsIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("tfd_agenda", "editar")),
):
    """Recepção em lote: marca múltiplos exames/consultas agendados como recepcionados."""
    from datetime import datetime

    ids = sorted(set(data.ids))
    objs = list(db.exec(select(ExameFila).where(ExameFila.id.in_(ids), ExameFila.ativo == True)).all())
    atualizados = 0
    agora = datetime.now()
    nome_ator = (ator.nome or ator.username or "")[:120]
    for obj in objs:
        if (obj.status or "") in ("agendado", "aguardando"):
            obj.status_anterior = obj.status or ""
            obj.status = "recepcionado"
            obj.recepcionado_em = agora
            obj.recepcionado_por = nome_ator
            db.add(obj)
            atualizados += 1
    db.commit()
    return {"ok": True, "atualizados": atualizados, "total": len(ids)}


@router.post("/exames/atendimento-status-lote")
def definir_status_atendimento_lote(
    data: AtendimentoStatusLoteIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("tfd_agenda", "editar")),
):
    """Define desfecho do atendimento em lote (realizado, faltou, cancelado)."""
    alvo = (data.status or "").strip().lower()
    if alvo not in ("realizado", "faltou", "cancelado"):
        raise HTTPException(400, "Status inválido (use realizado, faltou ou cancelado).")
    ids = sorted(set(data.ids))
    objs = list(db.exec(select(ExameFila).where(ExameFila.id.in_(ids), ExameFila.ativo == True)).all())
    atualizados = 0
    for obj in objs:
        if (obj.status or "") in ("agendado", "recepcionado"):
            obj.status = alvo
            if alvo == "realizado" and data.resultado:
                obj.resultado = data.resultado[:2000]
            db.add(obj)
            atualizados += 1
    db.commit()
    return {"ok": True, "atualizados": atualizados, "total": len(ids)}


@router.get("/relatorios/agendados")
def obter_relatorio_agendados(
    data_de: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    data_ate: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    unidade_id: int | None = Query(default=None),
    medico_id: int | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    tipo_fila: str = Query(default="", max_length=80),
    segmentacao: str = Query(default="", max_length=50),
    escopo: str = Query(default="agendados", max_length=50),
    q: str = Query(default="", max_length=80),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("tfd_agenda", "tfd_exames", "tfd")),
):
    """Relatório detalhado de agendamentos e solicitações com métricas de resultados, absenteísmo e segmentação."""
    esc = (escopo or "").lower() if isinstance(escopo, str) else "agendados"
    if esc == "fila":
        # Apenas solicitações em espera na fila
        filtros = [ExameFila.ativo == True, ExameFila.status.in_(["aguardando", "pendente_conferencia", "regulado"])]
        if isinstance(data_de, str) and data_de:
            try:
                filtros.append(ExameFila.data_pedido >= date.fromisoformat(data_de))
            except Exception:
                pass
        if isinstance(data_ate, str) and data_ate:
            try:
                filtros.append(ExameFila.data_pedido <= date.fromisoformat(data_ate))
            except Exception:
                pass
    elif esc == "todos":
        # Todos: Fila e Agendamentos no período
        filtros = [ExameFila.ativo == True]
        if isinstance(data_de, str) and data_de:
            try:
                d_obj = date.fromisoformat(data_de)
                filtros.append(or_(ExameFila.data_agendada >= d_obj, ExameFila.data_pedido >= d_obj))
            except Exception:
                pass
        if isinstance(data_ate, str) and data_ate:
            try:
                d_obj = date.fromisoformat(data_ate)
                filtros.append(or_(ExameFila.data_agendada <= d_obj, ExameFila.data_pedido <= d_obj))
            except Exception:
                pass
    else:
        # Padrão: Agendados
        filtros = [ExameFila.ativo == True, ExameFila.data_agendada is not None]
        if isinstance(data_de, str) and data_de:
            try:
                filtros.append(ExameFila.data_agendada >= date.fromisoformat(data_de))
            except Exception:
                pass
        if isinstance(data_ate, str) and data_ate:
            try:
                filtros.append(ExameFila.data_agendada <= date.fromisoformat(data_ate))
            except Exception:
                pass

    if isinstance(unidade_id, int):
        filtros.append(ExameFila.unidade_saude_id == unidade_id)
    if isinstance(medico_id, int):
        filtros.append(ExameFila.medico_id == medico_id)
    if isinstance(status_, str) and status_:
        filtros.append(ExameFila.status == status_)
    if isinstance(tipo_fila, str) and tipo_fila.strip():
        filtros.append(ExameFila.tipo_fila.ilike(f"%{tipo_fila.strip()}%"))

    # Segmentação: Consultas Especializadas vs. Exames Especializados (Item 6)
    seg = (segmentacao or "").lower() if isinstance(segmentacao, str) else ""
    if seg in ("consultas", "consulta"):
        filtros.append(
            or_(
                ExameFila.tipo_fila.ilike("%CONSULTA%"),
                ExameFila.exame.ilike("%CONSULTA%"),
                ExameFila.especialidade != "",
            )
        )
    elif seg in ("exames", "exame"):
        filtros.append(
            and_(
                ~ExameFila.tipo_fila.ilike("%CONSULTA%"),
                ~ExameFila.exame.ilike("%CONSULTA%"),
            )
        )

    stmt = select(ExameFila).where(*filtros).order_by(
        case((ExameFila.data_agendada != None, ExameFila.data_agendada), else_=ExameFila.data_pedido).desc(),
        ExameFila.hora_agendada.asc(),
    )
    todos = list(db.exec(stmt).all())

    if isinstance(q, str) and q.strip():
        termo = q.strip().lower()
        filtrados = []
        for e in todos:
            pac = db.get(Paciente, e.paciente_id)
            if pac and (termo in (pac.nome or "").lower() or termo in (pac.cpf or "").lower() or termo in (pac.cns or "").lower()):
                filtrados.append(e)
            elif termo in (e.paciente_nome or "").lower() or termo in (e.exame or "").lower():
                filtrados.append(e)
        todos = filtrados

    total = len(todos)
    agendados = sum(1 for e in todos if e.status == "agendado")
    recepcionados = sum(1 for e in todos if e.status == "recepcionado")
    realizados = sum(1 for e in todos if e.status == "realizado")
    faltaram = sum(1 for e in todos if e.status == "faltou")
    cancelados = sum(1 for e in todos if e.status == "cancelado")

    taxa_comparecimento = round(((recepcionados + realizados) / total) * 100, 1) if total > 0 else 0.0
    taxa_absenteismo = round((faltaram / total) * 100, 1) if total > 0 else 0.0

    limite = limit if isinstance(limit, int) and limit > 0 else 100
    pagina = page if isinstance(page, int) and page > 0 else 1

    offset = (pagina - 1) * limite
    itens_pagina = todos[offset:offset + limite]

    pac_cache: dict[int, Paciente | None] = {}
    itens_out = []
    for e in itens_pagina:
        if e.paciente_id not in pac_cache:
            pac_cache[e.paciente_id] = db.get(Paciente, e.paciente_id)
        pac = pac_cache[e.paciente_id]
        itens_out.append({
            "id": e.id,
            "codigo_curto": e.codigo_curto or f"EX-{e.id:06d}",
            "paciente_id": e.paciente_id,
            "paciente_nome": pac.nome if pac else e.paciente_nome,
            "paciente_cpf": pac.cpf if pac else "",
            "paciente_cns": pac.cns if pac else "",
            "paciente_telefone": pac.telefone if pac else "",
            "data_pedido": str(e.data_pedido or ""),
            "data_agendada": str(e.data_agendada or ""),
            "hora_agendada": e.hora_agendada or "",
            "exame": e.exame or "",
            "tipo_fila": e.tipo_fila or "",
            "especialidade": e.especialidade or e.nome_especialidade or "",
            "unidade_saude_id": e.unidade_saude_id,
            "unidade_nome": e.unidade_nome or "",
            "medico_id": e.medico_id,
            "medico_nome": e.medico_nome or "",
            "status": e.status or "agendado",
            "prioridade": e.prioridade or "rotina",
            "resultado": e.resultado or "",
            "recepcionado_em": e.recepcionado_em.strftime("%d/%m/%Y %H:%M") if e.recepcionado_em else None,
            "recepcionado_por": e.recepcionado_por or "",
        })

    pages = max(1, (total + limite - 1) // limite)
    return {
        "metricas": {
            "total": total,
            "agendados": agendados,
            "recepcionados": recepcionados,
            "realizados": realizados,
            "faltaram": faltaram,
            "faltas": faltaram,
            "cancelados": cancelados,
            "taxa_comparecimento": taxa_comparecimento,
            "comparecimento_pct": taxa_comparecimento,
            "taxa_absenteismo": taxa_absenteismo,
            "absenteismo_pct": taxa_absenteismo,
        },
        "itens": itens_out,
        "total": total,
        "page": page,
        "pages": pages,
    }


@router.get("/relatorios/agendados/exportar")
def exportar_relatorio_agendados(
    data_de: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    data_ate: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    unidade_id: int | None = Query(default=None),
    medico_id: int | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    tipo_fila: str = Query(default="", max_length=80),
    segmentacao: str = Query(default="", max_length=50),
    escopo: str = Query(default="agendados", max_length=50),
    q: str = Query(default="", max_length=80),
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("tfd_agenda", "tfd_exames", "tfd")),
):
    """Exporta o relatório gerencial de agendados para planilha Excel (.xlsx)."""
    from app.services.export_xlsx import resposta_xlsx
    from app.core.audit import registrar_log_exportacao

    dados = obter_relatorio_agendados(
        data_de=data_de, data_ate=data_ate, unidade_id=unidade_id,
        medico_id=medico_id, status_=status_, tipo_fila=tipo_fila,
        segmentacao=segmentacao, escopo=escopo,
        q=q, page=1, limit=10000, db=db, ator=ator
    )
    itens = dados["itens"]

    cols = [
        {"chave": "codigo_curto", "titulo": "ID Pedido", "largura": 12},
        {"chave": "data_agendada", "titulo": "Data Agendada", "largura": 14},
        {"chave": "hora_agendada", "titulo": "Horário", "largura": 10},
        {"chave": "paciente_nome", "titulo": "Paciente", "largura": 32},
        {"chave": "paciente_cpf", "titulo": "CPF", "largura": 15},
        {"chave": "paciente_cns", "titulo": "Cartão SUS", "largura": 18},
        {"chave": "paciente_telefone", "titulo": "Telefone", "largura": 16},
        {"chave": "exame", "titulo": "Procedimento / Exame", "largura": 30},
        {"chave": "tipo_fila", "titulo": "Tipo de Serviço", "largura": 22},
        {"chave": "especialidade", "titulo": "Especialidade", "largura": 22},
        {"chave": "unidade_nome", "titulo": "Unidade / PSF", "largura": 24},
        {"chave": "medico_nome", "titulo": "Médico(a)", "largura": 24},
        {"chave": "status", "titulo": "Status", "largura": 14},
        {"chave": "prioridade", "titulo": "Prioridade", "largura": 12},
        {"chave": "resultado", "titulo": "Resultado / Desfecho", "largura": 35},
        {"chave": "recepcionado_em", "titulo": "Recepcionado Em", "largura": 18},
        {"chave": "recepcionado_por", "titulo": "Recepcionado Por", "largura": 20},
    ]

    titulo = f"Relatório de Agendados ({data_de or 'Geral'} a {data_ate or 'Geral'})"
    registrar_log_exportacao(
        modulo="tfd_relatorio_agendados",
        titulo=titulo,
        usuario_id=ator.id,
        usuario_nome=ator.nome or ator.username,
        total_linhas=len(itens),
        filtros={"data_de": data_de, "data_ate": data_ate, "status": status_, "unidade_id": unidade_id},
    )

    return resposta_xlsx(
        titulo,
        ator.nome or ator.username,
        cols,
        itens,
        "relatorio_agendados",
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
    pos, _total_grupo, rotulo = rank.get(obj.id, (None, None, ""))
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
            total_fila=None,
            grupo_fila=rotulo or "",
            paciente_iniciais=_iniciais(pac.nome if pac else ""),
        ).model_dump_json(),
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


# ---------- Catálogo de procedimentos (códigos curtos + dinâmico + SIGTAP estruturado) ----------
@router.get("/exames/catalogo", response_model=list[dict])
def catalogo_procedimentos(
    q: str = Query(default="", max_length=80),
    tipo_fila: str = Query(default="", max_length=80),
    apenas_laboratoriais: bool | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(need_any_perm(*_PERMS_PACIENTES_LEITURA)),
):
    """Catálogo dinâmico + oficial SIGTAP com filtragem contextual por Grupo/Subgrupo."""
    from app.models.settings import SystemSettings
    from app.models.lab_exames import SigtapProcedimento
    from app.services.sigtap_hierarquia import obter_filtro_sigtap_por_tipo, decompor_codigo_sigtap

    ql = (q or "").strip().lower()
    regras = obter_filtro_sigtap_por_tipo(tipo_fila)

    # Determina se a busca é estritamente laboratorial
    eh_laboratorial = (
        apenas_laboratoriais is True
        or (apenas_laboratoriais is None and regras.get("apenas_laboratoriais", False))
    )

    out: list[dict] = []
    codigos_tfd = set()

    # 1) Catálogo dinâmico do TFD / procedimentos importados (Vivver e locais)
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
        cod = (p.codigo or "").strip()
        # Se filtrando fila especializada/cirúrgica, desconsidera exames de sangue (0202)
        if regras.get("excluir_prefixos") and any(cod.startswith(pref) for pref in regras["excluir_prefixos"]):
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
        codigos_tfd.add(cod)

    # 2) Tabela Oficial SIGTAP (5.103 procedimentos) com categorização hierárquica
    try:
        filtros_sig = []
        if eh_laboratorial:
            # Modo Exames de Sangue / Laboratoriais (Subgrupo 0202)
            habs = []
            try:
                cfg = db.get(SystemSettings, 1)
                raw_hab = getattr(cfg, "exames_habilitados_sigtap", "") or ""
                habs = [c.strip() for c in raw_hab.split(",") if c.strip()]
            except Exception:
                habs = []
            if habs:
                filtros_sig.append(SigtapProcedimento.codigo.in_(habs))
            else:
                filtros_sig.append(SigtapProcedimento.codigo.like("0202%"))
        elif regras.get("prefixos"):
            conds = [SigtapProcedimento.codigo.like(f"{pref}%") for pref in regras["prefixos"]]
            filtros_sig.append(or_(*conds))

        # Exclusão de prefixos incompatíveis (ex: não trazer exames de sangue em cirurgias)
        if regras.get("excluir_prefixos"):
            for exc in regras["excluir_prefixos"]:
                filtros_sig.append(~SigtapProcedimento.codigo.like(f"{exc}%"))

        if ql:
            like = f"%{ql}%"
            filtros_sig.append(
                (SigtapProcedimento.codigo.ilike(like))
                | (SigtapProcedimento.descricao.ilike(like))
            )

        base_sig = select(SigtapProcedimento).where(*filtros_sig).order_by(SigtapProcedimento.descricao)
        limite_sig = 120 if ql else 40
        for s in db.exec(base_sig.limit(limite_sig)).all():
            cod = (s.codigo or "").strip()
            if not cod or cod in codigos_tfd:
                continue
            hier = decompor_codigo_sigtap(cod)
            esp_nome = hier.get("subgrupo_nome", "")
            out.append({
                "exame": f"{cod} - {s.descricao}",
                "nome_procedimento": s.descricao,
                "codigo_procedimento": cod,
                "especialidade": esp_nome,
                "codigo_especialidade": "",
                "nome_especialidade": esp_nome,
                "tipo_fila": tipo_fila or hier.get("grupo_nome", ""),
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
        def _chave_proc(item):
            nome_l = (item.get("nome_procedimento") or "").lower()
            cod_l = (item.get("codigo_procedimento") or "").lower()
            curto_l = (item.get("codigo_curto") or "").lower()
            comeca = 0 if (nome_l.startswith(ql) or cod_l.startswith(ql) or curto_l.startswith(ql)) else 1
            return (comeca, nome_l)
        out.sort(key=_chave_proc)
        return out[:60]
    return out[:40]


@router.post("/procedimentos/validar-cbo", response_model=ValidarCboOut)
def validar_cbo_endpoint(
    payload: ValidarCboIn,
    db: Session = Depends(get_db),
    _=Depends(need_any_perm(*_PERMS_PACIENTES_LEITURA)),
):
    """Valida se o CBO do profissional é compatível com o procedimento conforme a tabela SIGTAP."""
    from app.services.sigtap_hierarquia import validar_cbo_procedimento

    cbo = payload.cbo
    med_nome = (payload.medico_nome or "").strip()
    if payload.medico_id:
        med = db.get(Medico, payload.medico_id)
        if med:
            cbo = cbo or getattr(med, "cbo_codigo", "") or ""
            med_nome = med.nome or med_nome
    return validar_cbo_procedimento(
        db,
        payload.codigo_procedimento,
        cbo_profissional=cbo,
        medico_nome=med_nome,
        tipo_fila=payload.tipo_fila,
    )


@router.get("/sigtap/hierarquia/{codigo}")
def obter_hierarquia_sigtap_endpoint(
    codigo: str,
    _=Depends(need_any_perm(*_PERMS_PACIENTES_LEITURA)),
):
    """Retorna grupo, subgrupo e metadados estruturais do procedimento SIGTAP."""
    from app.services.sigtap_hierarquia import decompor_codigo_sigtap

    return decompor_codigo_sigtap(codigo)


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
    request: Request = None,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("tfd_catalogo")),
):
    base = select(ProcedimentoCatalogo).order_by(ProcedimentoCatalogo.nome)
    filtros = []
    ordem_extra = None
    if q:
        q_limpo = q.strip()
        like = f"%{q_limpo}%"
        filtros.append(
            (ProcedimentoCatalogo.nome.ilike(like))
            | (ProcedimentoCatalogo.codigo.ilike(like))
            | (ProcedimentoCatalogo.codigo_curto.ilike(like))
        )
        ordem_extra = case(
            (ProcedimentoCatalogo.nome.ilike(f"{q_limpo}%"), 0),
            (ProcedimentoCatalogo.codigo.ilike(f"{q_limpo}%"), 0),
            (ProcedimentoCatalogo.codigo_curto.ilike(f"{q_limpo}%"), 0),
            else_=1,
        )
    if tipo_fila:
        filtros.append(ProcedimentoCatalogo.tipo_fila.ilike(f"%{tipo_fila}%"))
    if ativos is not None:
        filtros.append(ProcedimentoCatalogo.ativo == ativos)
    if filtros:
        if ordem_extra is not None:
            base = select(ProcedimentoCatalogo).where(*filtros).order_by(ordem_extra, ProcedimentoCatalogo.nome)
        else:
            base = select(ProcedimentoCatalogo).where(*filtros).order_by(ProcedimentoCatalogo.nome)
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = db.exec(base.offset(meta["offset"]).limit(limit)).all()

    if q and q.strip():
        try:
            from app.core.audit import registrar_log_pesquisa
            u_id = ator.id if ator else None
            u_nome = (ator.nome or ator.username) if ator else ""
            ua = request.headers.get("user-agent", "") if request else ""
            registrar_log_pesquisa("procedimentos", q.strip(), u_id, u_nome, ua, total)
        except Exception:
            pass

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
    cbo = (data.codigo_cbo or "").strip()
    if cbo:
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
    cbo = (data.codigo_cbo or "").strip()
    if cbo:
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
def _eh_psf(destino: str) -> bool:
    """Destino é PSF de origem (padrão e-SUS "N - ESF ..."), não cidade."""
    s = (destino or "").strip()
    return bool(
        _re.match(r"^\d+\s*-\s*(ESF|PSF|UBS)\b", s, _re.IGNORECASE)
        or _re.match(r"^(ESF|PSF|UBS)\b", s, _re.IGNORECASE)
    )


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
    psf: str = Query(default="", max_length=150),
    status_: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    _=Depends(need_perm("tfd_viagens")),
):
    base = select(ViagemFila).order_by(ViagemFila.created_at)
    filtros = []
    if destino or psf:
        # PSF e cidade convivem em ViagemFila.destino (legado puxar); como o
        # volume da fila é pequeno, aplica-se o recorte em Python p/ precisão.
        todos = list(db.exec(select(ViagemFila)).all())
        if destino:
            termo = destino.strip().upper()
            todos = [o for o in todos
                     if termo in (o.destino or "").upper() and not _eh_psf(o.destino)]
        if psf:
            termo = psf.strip().upper()
            todos = [o for o in todos
                     if _eh_psf(o.destino) and termo in (o.destino or "").upper()
                     or termo in (o.unidade or "").upper()]
        ids = {o.id for o in todos}
        filtros.append(ViagemFila.id.in_(ids) if ids else ViagemFila.id == -1)
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
    prio = getattr(p, "prioridade", "") or ""
    if not prio and p.viagem_fila_id:
        vf = db.get(ViagemFila, p.viagem_fila_id)
        if vf and vf.prioridade:
            prio = vf.prioridade
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
        "prioridade": prio,
        "tratamento": p.tratamento or "", "unidade": p.unidade or "",
        "hora_consulta": p.hora_consulta or "",
        "observacoes": getattr(p, "observacoes", "") or "",
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


def _dia_payload(
    db: Session,
    data: str,
    redigir_pacientes: bool = False,
    frota_cache: list[dict] | None = None,
) -> dict:
    """Quadro de um dia: destinos com viagens, veículos, vagas e passageiros.
    Totalmente otimizado em lote para alta concorrência sem queries N+1.
    """
    viagens = list(db.exec(
        select(Viagem).where(func.to_char(Viagem.data_viagem, "YYYY-MM-DD") == data)
        .order_by(Viagem.destino, Viagem.hora_saida)
    ).all())
    v_ids = [v.id for v in viagens if v.id]
    alocados = {v.veiculo_id for v in viagens if v.veiculo_id}

    # Pré-carrega veículos vinculados às viagens
    veic_ids = {v.veiculo_id for v in viagens if v.veiculo_id}
    veics_map = {veh.id: veh for veh in db.exec(select(Veiculo).where(Veiculo.id.in_(veic_ids))).all()} if veic_ids else {}

    # Pré-carrega passageiros, pacientes e prioridades de todas as viagens do dia em lote
    vps_by_viagem: dict[int, list[ViagemPaciente]] = {}
    pacs_map: dict[int, Paciente] = {}
    vfs_map: dict[int, ViagemFila] = {}

    if v_ids:
        vps = list(db.exec(select(ViagemPaciente).where(ViagemPaciente.viagem_id.in_(v_ids))).all())
        for p in vps:
            vps_by_viagem.setdefault(p.viagem_id, []).append(p)

        if not redigir_pacientes:
            all_pac_ids = {p.paciente_id for p in vps if p.paciente_id} | {getattr(p, "acompanhante_id", None) for p in vps if getattr(p, "acompanhante_id", None)}
            if all_pac_ids:
                pacs = db.exec(select(Paciente).where(Paciente.id.in_(all_pac_ids))).all()
                pacs_map = {pac.id: pac for pac in pacs}

            vf_ids = {p.viagem_fila_id for p in vps if p.viagem_fila_id}
            if vf_ids:
                vfs = db.exec(select(ViagemFila).where(ViagemFila.id.in_(vf_ids))).all()
                vfs_map = {vf.id: vf for vf in vfs}

    por_destino: dict[str, list] = {}
    for v in viagens:
        veh = veics_map.get(v.veiculo_id) if v.veiculo_id else None
        cap = veh.capacidade if veh else 0
        v_pass = vps_by_viagem.get(v.id, [])

        # Cálculo de ocupação em memória
        ocup = 0
        for p in v_pass:
            if not p.presente:
                continue
            tem_acomp = bool((p.acompanhante or "").strip() or getattr(p, "acompanhante_id", None))
            ocup += 2 if tem_acomp else 1

        if redigir_pacientes:
            passageiros = []
        else:
            passageiros = []
            for p in v_pass:
                pac = pacs_map.get(p.paciente_id)
                acomp_id = getattr(p, "acompanhante_id", None)
                acomp = pacs_map.get(acomp_id) if acomp_id else None
                acomp_nome = (p.acompanhante or "").strip() or (acomp.nome if acomp else "")
                prio = getattr(p, "prioridade", "") or ""
                if not prio and p.viagem_fila_id:
                    vf = vfs_map.get(p.viagem_fila_id)
                    if vf and vf.prioridade:
                        prio = vf.prioridade
                passageiros.append({
                    "id": p.id, "viagem_id": p.viagem_id, "paciente_id": p.paciente_id,
                    "paciente_nome": pac.nome if pac else "?",
                    "paciente_cpf": pac.cpf if pac else "",
                    "paciente_nascimento": pac.nascimento.isoformat() if pac and pac.nascimento else None,
                    "acompanhante": acomp_nome, "presente": p.presente,
                    "acompanhante_id": acomp_id,
                    "acompanhante_nome": acomp.nome if acomp else acomp_nome,
                    "acompanhante_cpf": getattr(p, "acompanhante_cpf", "") or (acomp.cpf if acomp else ""),
                    "viagem_fila_id": p.viagem_fila_id,
                    "prioridade": prio,
                    "tratamento": p.tratamento or "", "unidade": p.unidade or "",
                    "hora_consulta": p.hora_consulta or "",
                    "observacoes": getattr(p, "observacoes", "") or "",
                })

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

    # Frota
    if frota_cache is not None:
        frota = [dict(veh, em_outra_viagem=veh["id"] in alocados) for veh in frota_cache]
    else:
        frota = []
        for veh in db.exec(select(Veiculo).where(Veiculo.ativo == True).order_by(Veiculo.placa)).all():
            frota.append({
                "id": veh.id, "placa": veh.placa, "modelo": veh.modelo or "",
                "tipo": veh.tipo, "capacidade": veh.capacidade,
                "status": veh.status or "disponivel",
                "em_outra_viagem": veh.id in alocados,
            })

    # Demanda aguardando calculada em lote (GROUP BY)
    demanda_rows = db.exec(
        select(ViagemFila.destino, func.count(ViagemFila.id))
        .where(ViagemFila.status == "aguardando")
        .group_by(ViagemFila.destino)
    ).all()
    demanda_map = {row[0]: row[1] for row in demanda_rows}

    return {
        "data": data,
        "destinos": [
            {"destino": d, "viagens": vs,
             "demanda_aguardando": demanda_map.get(d, 0)}
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

    frota_base = [
        {
            "id": veh.id, "placa": veh.placa, "modelo": veh.modelo or "",
            "tipo": veh.tipo, "capacidade": veh.capacidade,
            "status": veh.status or "disponivel",
        }
        for veh in db.exec(select(Veiculo).where(Veiculo.ativo == True).order_by(Veiculo.placa)).all()
    ]

    dias = []
    for i in range(7):
        d = base.fromordinal(base.toordinal() + i).isoformat()
        dias.append(_dia_payload(db, d, redigir_pacientes=redigir, frota_cache=frota_base))
    frota = dias[0].get("frota", []) if dias else []
    for d in dias:
        d.pop("frota", None)
    return {"inicio": inicio, "dias": dias, "frota": frota}
    frota = dias[0].get("frota", []) if dias else []
    for d in dias:
        d.pop("frota", None)
    return {"inicio": inicio, "dias": dias, "frota": frota}


@router.get("/viagens/sugestao")
def sugestao_frota(
    data: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    destino: str = Query(min_length=2, max_length=120),
    viagem_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(need_any_perm("tfd_viagens", "tfd_frota_gestao")),
):
    """Sugere o veículo ideal p/ a demanda do destino no dia.

    Só conta a fila com data marcada para o dia (fila contínua sem data
    fixa não força sugestão automática). Com `viagem_id`, soma os assentos
    já embarcados na viagem (passageiros + acompanhantes) — cobre o caso
    "A definir carro" com passageiros sem veículo.
    """
    fila = list(db.exec(select(ViagemFila).where(
        ViagemFila.destino == destino, ViagemFila.status == "aguardando",
        func.to_char(ViagemFila.data_consulta, "YYYY-MM-DD") == data)).all())
    assentos = sum(2 if f.acompanhante else 1 for f in fila)
    if viagem_id:
        ocup, _cap = _assentos(db, viagem_id)
        assentos = max(assentos, ocup)
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
    modelo = ""
    if obj.veiculo_id:
        veh = db.get(Veiculo, obj.veiculo_id)
        placa = veh.placa if veh else ""
        modelo = veh.modelo if veh else ""
    return ViagemOut(**obj.model_dump(), passageiros=n or 0, veiculo_placa=placa, veiculo_modelo=modelo)


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
    lista_base = [{
        "paciente_nome": p.get("paciente_nome", ""),
        "paciente_nascimento": (p.get("paciente_nascimento") or "")[:10],
        "tratamento": p.get("tratamento", ""),
        "unidade": p.get("unidade", ""),
        "hora_consulta": p.get("hora_consulta", ""),
        "observacoes": (p.get("observacoes") or "").strip(),
        "acompanhante": (p.get("acompanhante_nome") or p.get("acompanhante") or "").strip(),
    } for p in passageiros]
    # Acompanhante ocupa assento: entra como linha própria
    # "Nome (Acompanhante de Paciente)" preservando ocupação.
    lista: list[dict] = []
    for item in lista_base:
        lista.append(item)
        acomp = (item.get("acompanhante") or "").strip()
        if acomp:
            lista.append({
                "paciente_nome": f"{acomp} (Acompanhante de {item.get('paciente_nome', '').strip() or 'Paciente'})",
                "paciente_nascimento": "",
                "tratamento": item.get("tratamento", ""),
                "unidade": item.get("unidade", ""),
                "hora_consulta": item.get("hora_consulta", ""),
                "observacoes": item.get("observacoes", ""),
                "acompanhante": "",
            })

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
            "observacoes": x.get("observacoes", ""),
            "acompanhante": x.get("acompanhante", ""),
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
