from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import case
from sqlmodel import Session, select

from app.core.deps import get_current_user, get_db as _get_db
from app.core.security import hash_password
from app.models.cadastros_saude import Medico, UnidadeSaude
from app.models.user import User
from app.schemas.cadastros_saude import (
    MedicoIn,
    MedicoOut,
    UnidadeIn,
    UnidadeOut,
)
from app.services.permissoes import need_perm
from app.services.users import gerar_temporaria


router = APIRouter()

def _parse_unidades_ids(val: str | None) -> list[int]:
    if not val:
        return []
    out = []
    for part in str(val).replace("[", "").replace("]", "").split(","):
        part = part.strip()
        if part.isdigit():
            out.append(int(part))
    return out


def _medico_to_out(
    m: Medico,
    usuario_criado: str | None = None,
    senha_temporaria: str | None = None,
) -> MedicoOut:
    d = m.model_dump()
    d["unidades_ids"] = _parse_unidades_ids(getattr(m, "unidades_ids", None))
    if usuario_criado:
        d["usuario_criado"] = usuario_criado
    if senha_temporaria:
        d["senha_temporaria"] = senha_temporaria
    return MedicoOut(**d)


def _validar_nao_motorista(data: MedicoIn) -> None:
    cbo = (data.cbo_codigo or "").strip()
    cbo_desc = (data.cbo_descricao or "").strip().lower()
    nome = (data.nome or "").strip().lower()
    if cbo.startswith("7823") or "motorista" in cbo_desc or "motorista" in nome:
        raise HTTPException(
            status_code=400,
            detail="CBO ou função informada refere-se a Motorista/Transporte. Cadastre motoristas no módulo de Transporte (TFD > Motoristas).",
        )


# ---------- Médicos ----------
@router.get("/medicos", response_model=list[MedicoOut])
def listar_medicos(
    q: str = Query(default="", max_length=80),
    somente_ativos: bool | None = Query(default=None),
    request: Request = None,
    db: Session = Depends(_get_db),
    _ator: User = Depends(get_current_user),
):
    """Lista geral de médicos p/ todas as telas de seleção/agendamento.
    Busca por nome/CRM/CPF/CBO/especialidades. Acessível a qualquer operador logado
    para preenchimento consistente de selects e autocompletes.
    """
    filtros_exclusao = [
        ~Medico.cbo_codigo.like("7823%"),
        ~Medico.cbo_descricao.ilike("%motorista%"),
        ~Medico.nome.ilike("%motorista%"),
    ]

    ordem = [
        case((Medico.nome == "Médico da Unidade / Responsável Técnico", 0), else_=1),
        Medico.nome,
    ]

    base = select(Medico).where(*filtros_exclusao).order_by(*ordem)
    if somente_ativos is True:
        base = select(Medico).where(Medico.ativo != False, *filtros_exclusao).order_by(*ordem)  # noqa: E712
    elif somente_ativos is False:
        base = select(Medico).where(Medico.ativo == False, *filtros_exclusao).order_by(*ordem)  # noqa: E712

    medicos = list(db.exec(base).all())
    termo = (q or "").strip().lower()
    if termo:
        medicos = [
            m for m in medicos
            if termo in (m.nome or "").lower()
            or termo in (m.crm or "").lower()
            or termo in (m.cpf or "").lower()
            or termo in (m.cbo_codigo or "").lower()
            or termo in (m.cbo_descricao or "").lower()
            or termo in (m.especialidades or "").lower()
            or termo in (m.email or "").lower()
        ]
        # Ordenação por Coincidência de Início (Relevância Inteligente)
        def _chave_med(m):
            nome_l = (m.nome or "").strip().lower()
            crm_l = (m.crm or "").strip().lower()
            comeca = 0 if (nome_l.startswith(termo) or crm_l.startswith(termo)) else 1
            return (comeca, nome_l)
        medicos.sort(key=_chave_med)

    # Mantenha o médico genérico ("Médico da Unidade / Responsável Técnico") sempre disponível no topo ou na lista quando ativos forem solicitados
    if somente_ativos is not False and not termo:
        idx_rt = next((i for i, m in enumerate(medicos) if m.nome == "Médico da Unidade / Responsável Técnico"), None)
        if idx_rt is not None and idx_rt > 0:
            med_rt = medicos.pop(idx_rt)
            medicos.insert(0, med_rt)
        elif idx_rt is None:
            med_rt = db.exec(select(Medico).where(Medico.nome == "Médico da Unidade / Responsável Técnico")).first()
            if med_rt:
                medicos.insert(0, med_rt)

    if termo:
        try:
            from app.core.audit import registrar_log_pesquisa
            u_id = _ator.id if _ator else None
            u_nome = (_ator.nome or _ator.username) if _ator else ""
            ua = request.headers.get("user-agent", "") if request else ""
            registrar_log_pesquisa("medicos", termo, u_id, u_nome, ua, len(medicos))
        except Exception:
            pass

    return [_medico_to_out(m) for m in medicos]


@router.post("/medicos", response_model=MedicoOut, status_code=201)
def criar_medico(
    data: MedicoIn,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_perm("usuarios", "criar")),
):
    """Cadastra novo profissional de saúde e cria automaticamente seu usuário de acesso
    em uma única transação atômica.
    """
    _validar_nao_motorista(data)
    try:
        dados_med = data.model_dump()
        u_ids = dados_med.pop("unidades_ids", [])
        obj = Medico(**dados_med, unidades_ids=",".join(map(str, u_ids)))
        db.add(obj)
        db.flush()

        # Definição do nome de usuário / login: CPF (dígitos) ou sequencial medico101, medico102...
        email_limpo = (data.email or "").strip().lower()
        cpf_digitos = "".join(c for c in (data.cpf or "") if c.isdigit())
        if cpf_digitos:
            login_base = cpf_digitos
        elif email_limpo:
            login_base = email_limpo
        else:
            seq = 101
            while db.exec(select(User).where(User.username == f"medico{seq}")).first():
                seq += 1
            login_base = f"medico{seq}"

        # Garantia de unicidade de username
        login_usuario = login_base
        sufixo = 1
        while db.exec(select(User).where(User.username == login_usuario)).first():
            if "@" in login_base:
                p1, p2 = login_base.split("@", 1)
                login_usuario = f"{p1}.{sufixo}@{p2}"
            else:
                login_usuario = f"{login_base}.{sufixo}"
            sufixo += 1

        senha_temp = gerar_temporaria()
        novo_user = User(
            username=login_usuario,
            password_hash=hash_password(senha_temp),
            nome=data.nome.strip(),
            area="saude",
            telas="tfd,tfd_medico,tfd_exames,tfd_agenda",
            acoes="{}",
            medico_id=obj.id,
            permite_retroativo=True,
            is_superuser=False,
            is_active=bool(data.ativo),
            must_change_password=True,
        )
        db.add(novo_user)

        db.commit()
        db.refresh(obj)
        try:
            from app.services.dashboard_default import criar_dashboard_padrao_se_ausente
            criar_dashboard_padrao_se_ausente(db, novo_user)
        except Exception:
            pass
        return _medico_to_out(
            obj,
            usuario_criado=login_usuario,
            senha_temporaria=senha_temp,
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"Falha ao cadastrar profissional de saúde e criar usuário: {str(e)}",
        )


@router.put("/medicos/{mid}", response_model=MedicoOut)
def atualizar_medico(
    mid: int,
    data: MedicoIn,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_perm("usuarios", "editar")),
):
    obj = db.get(Medico, mid)
    if not obj:
        raise HTTPException(404, "Médico não encontrado")

    _validar_nao_motorista(data)

    try:
        dados_patch = data.model_dump()
        u_ids = dados_patch.pop("unidades_ids", None)
        for k, v in dados_patch.items():
            setattr(obj, k, v)
        if u_ids is not None:
            obj.unidades_ids = ",".join(map(str, u_ids))
        db.add(obj)

        # Sincroniza usuário vinculado existente ou cria novo se não existir
        user_vinculado = db.exec(select(User).where(User.medico_id == mid)).first()
        usuario_criado = None
        senha_temp = None

        if user_vinculado:
            user_vinculado.nome = data.nome.strip()
            user_vinculado.is_active = bool(data.ativo)
            db.add(user_vinculado)
        elif data.ativo:
            email_limpo = (data.email or "").strip().lower()
            cpf_digitos = "".join(c for c in (data.cpf or "") if c.isdigit())
            if cpf_digitos:
                login_base = cpf_digitos
            elif email_limpo:
                login_base = email_limpo
            else:
                seq = 101
                while db.exec(select(User).where(User.username == f"medico{seq}")).first():
                    seq += 1
                login_base = f"medico{seq}"
            login_usuario = login_base
            sufixo = 1
            while db.exec(select(User).where(User.username == login_usuario)).first():
                if "@" in login_base:
                    p1, p2 = login_base.split("@", 1)
                    login_usuario = f"{p1}.{sufixo}@{p2}"
                else:
                    login_usuario = f"{login_base}.{sufixo}"
                sufixo += 1
            senha_temp = gerar_temporaria()
            novo_user = User(
                username=login_usuario,
                password_hash=hash_password(senha_temp),
                nome=data.nome.strip(),
                area="saude",
                telas="tfd,tfd_medico,tfd_exames,tfd_agenda",
                acoes="{}",
                medico_id=obj.id,
                permite_retroativo=True,
                is_superuser=False,
                is_active=True,
                must_change_password=True,
            )
            db.add(novo_user)
            usuario_criado = login_usuario

        db.commit()
        db.refresh(obj)
        return _medico_to_out(
            obj,
            usuario_criado=usuario_criado,
            senha_temporaria=senha_temp,
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"Falha ao atualizar médico: {str(e)}",
        )


@router.delete("/medicos/{mid}", status_code=204)
def inativar_medico(
    mid: int,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_perm("usuarios", "excluir")),
):
    obj = db.get(Medico, mid)
    if not obj:
        raise HTTPException(404, "Médico não encontrado")
    obj.ativo = False
    db.add(obj)
    # Inativa também o usuário correspondente
    user_vinculado = db.exec(select(User).where(User.medico_id == mid)).first()
    if user_vinculado:
        user_vinculado.is_active = False
        db.add(user_vinculado)
    db.commit()


# ---------- Unidades / PSFs ----------
@router.get("/unidades-saude", response_model=list[UnidadeOut])
@router.get("/unidades", response_model=list[UnidadeOut], include_in_schema=False)
def listar_unidades(
    q: str = Query(default="", max_length=80),
    somente_ativas: bool | None = Query(default=None),
    db: Session = Depends(_get_db),
    _ator: User = Depends(get_current_user),
):
    """Lista geral de unidades de saúde e PSFs.
    Acessível por /api/unidades-saude e /api/unidades para todos os usuários logados.
    """
    base = select(UnidadeSaude).order_by(UnidadeSaude.nome)
    if somente_ativas is True:
        base = select(UnidadeSaude).where(UnidadeSaude.ativo != False).order_by(UnidadeSaude.nome)  # noqa: E712
    elif somente_ativas is False:
        base = select(UnidadeSaude).where(UnidadeSaude.ativo == False).order_by(UnidadeSaude.nome)  # noqa: E712

    unidades = list(db.exec(base).all())
    termo = (q or "").strip().lower()
    if termo:
        unidades = [
            u for u in unidades
            if termo in (u.nome or "").lower()
            or termo in (u.cnes or "").lower()
            or termo in (u.bairro or "").lower()
            or termo in (u.municipio or "").lower()
            or termo in (u.endereco or "").lower()
        ]
    return [UnidadeOut(**u.model_dump()) for u in unidades]


@router.post("/unidades-saude", response_model=UnidadeOut, status_code=201)
@router.post("/unidades", response_model=UnidadeOut, status_code=201, include_in_schema=False)
def criar_unidade(
    data: UnidadeIn,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_perm("usuarios", "criar")),
):
    obj = UnidadeSaude(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return UnidadeOut(**obj.model_dump())


@router.put("/unidades-saude/{uid}", response_model=UnidadeOut)
@router.put("/unidades/{uid}", response_model=UnidadeOut, include_in_schema=False)
def atualizar_unidade(
    uid: int,
    data: UnidadeIn,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_perm("usuarios", "editar")),
):
    obj = db.get(UnidadeSaude, uid)
    if not obj:
        raise HTTPException(404, "Unidade não encontrada")
    for k, v in data.model_dump().items():
        setattr(obj, k, v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return UnidadeOut(**obj.model_dump())


@router.delete("/unidades-saude/{uid}", status_code=204)
@router.delete("/unidades/{uid}", status_code=204, include_in_schema=False)
def inativar_unidade(
    uid: int,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_perm("usuarios", "excluir")),
):
    obj = db.get(UnidadeSaude, uid)
    if not obj:
        raise HTTPException(404, "Unidade não encontrada")
    obj.ativo = False
    db.add(obj)
    db.commit()


# ---------- Exportações XLSX ----------
@router.get("/medicos/exportar")
def exportar_medicos(
    db: Session = Depends(_get_db), ator=Depends(need_perm("usuarios")),
):
    from app.services.export_xlsx import resposta_xlsx

    linhas = [{
        "nome": m.nome, "cpf": m.cpf or "", "crm": m.crm or "",
        "cbo": " ".join(x for x in [m.cbo_codigo or "", m.cbo_descricao or ""] if x),
        "esps": m.especialidades or "", "contato": " ".join(x for x in [m.telefone or "", m.email or ""] if x),
        "status": "ativo" if m.ativo else "inativo",
    } for m in db.exec(select(Medico).order_by(Medico.nome)).all()]
    return resposta_xlsx(
        "Médicos / profissionais", getattr(ator, "nome", "") or getattr(ator, "username", ""),
        [
            {"chave": "nome", "rotulo": "Nome completo", "largura": 34},
            {"chave": "cpf", "rotulo": "CPF", "largura": 18},
            {"chave": "crm", "rotulo": "CRM", "largura": 16},
            {"chave": "cbo", "rotulo": "CBO", "largura": 30},
            {"chave": "esps", "rotulo": "Especialidades", "largura": 34},
            {"chave": "contato", "rotulo": "Contato", "largura": 34},
            {"chave": "status", "rotulo": "Status", "largura": 12},
        ],
        linhas, "medicos",
    )


@router.get("/unidades-saude/exportar")
def exportar_unidades(
    db: Session = Depends(_get_db), ator=Depends(need_perm("usuarios")),
):
    from app.services.export_xlsx import resposta_xlsx

    linhas = [{
        "nome": u.nome, "cnes": u.cnes or "",
        "endereco": " ".join(x for x in [
            u.endereco or "", f"Nº {u.numero}" if getattr(u, "numero", "") else "",
            u.bairro or "", getattr(u, "municipio", "") or "",
            f"CEP {u.cep}" if getattr(u, "cep", "") else "",
        ] if x),
        "telefone": u.telefone or "",
        "status": "ativo" if u.ativo else "inativo",
    } for u in db.exec(select(UnidadeSaude).order_by(UnidadeSaude.nome)).all()]
    return resposta_xlsx(
        "PSFs / Unidades de saúde", getattr(ator, "nome", "") or getattr(ator, "username", ""),
        [
            {"chave": "nome", "rotulo": "Nome", "largura": 34},
            {"chave": "cnes", "rotulo": "CNES", "largura": 14},
            {"chave": "endereco", "rotulo": "Endereço completo", "largura": 52},
            {"chave": "telefone", "rotulo": "Telefone", "largura": 16},
            {"chave": "status", "rotulo": "Status", "largura": 12},
        ],
        linhas, "unidades_saude",
    )
