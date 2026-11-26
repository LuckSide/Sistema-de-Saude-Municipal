from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import case
from sqlmodel import Session, select

from app.core.deps import get_current_user, get_db as _get_db
from app.core.security import hash_password
from app.models.cadastros_saude import (
    Medico,
    UnidadeSaude,
    Prestador,
    UnidadeServicoEspecializado,
    EquipeSaude,
    EquipeProfissional,
)
from app.models.user import User
from app.schemas.cadastros_saude import (
    MedicoIn,
    MedicoOut,
    UnidadeIn,
    UnidadeOut,
    PrestadorIn,
    PrestadorOut,
    UnidadeServicoEspecializadoIn,
    UnidadeServicoEspecializadoOut,
    EquipeProfissionalIn,
    EquipeProfissionalOut,
    EquipeSaudeIn,
    EquipeSaudeOut,
)
from app.services.permissoes import need_any_perm
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
            or termo in (getattr(m, "cns", "") or "").lower()
            or termo in (getattr(m, "conselho_tipo", "") or "").lower()
            or termo in (getattr(m, "vinculo", "") or "").lower()
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
    _ator: User = Depends(need_any_perm("usuarios", "cfg_medicos", acoes=("criar",))),
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
            detail="Falha ao cadastrar profissional de saúde e criar usuário. Verifique os dados fornecidos.",
        )


@router.put("/medicos/{mid}", response_model=MedicoOut)
def atualizar_medico(
    mid: int,
    data: MedicoIn,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_any_perm("usuarios", "cfg_medicos", acoes=("editar",))),
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
            detail="Falha ao atualizar médico. Verifique os dados fornecidos.",
        )


@router.delete("/medicos/{mid}", status_code=204)
def inativar_medico(
    mid: int,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_any_perm("usuarios", "cfg_medicos", acoes=("excluir",))),
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
            or termo in (getattr(u, "tipo_estabelecimento", "") or "").lower()
            or termo in (getattr(u, "responsavel_tecnico_nome", "") or "").lower()
            or termo in (getattr(u, "cnpj", "") or "").lower()
            or termo in (getattr(u, "codigo_ibge", "") or "").lower()
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
    _ator: User = Depends(need_any_perm("usuarios", "cfg_unidades", acoes=("criar",))),
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
    _ator: User = Depends(need_any_perm("usuarios", "cfg_unidades", acoes=("editar",))),
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


class UnidadeRtLoteIn(BaseModel):
    unidade_ids: list[int] = Field(min_length=1)
    responsavel_tecnico_nome: str = Field(min_length=2, max_length=150)
    responsavel_tecnico_cns: str = Field(min_length=15, max_length=15)
    responsavel_tecnico_conselho: str = Field(default="", max_length=50)


@router.post("/unidades-saude/atualizar-rt-lote")
def atualizar_rt_unidades_lote(
    data: UnidadeRtLoteIn,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_any_perm("usuarios", "cfg_unidades", acoes=("editar",))),
):
    """Atualiza Responsável Técnico e CNS em lote para múltiplas Unidades/PSFs."""
    from app.core.validators import so_digitos, valida_cns

    cns_limpo = so_digitos(data.responsavel_tecnico_cns)
    ok_cns, motivo = valida_cns(cns_limpo)
    if not ok_cns:
        raise HTTPException(422, f"CNS do Responsável Técnico inválido: {motivo}")

    nome_limpo = data.responsavel_tecnico_nome.strip()
    conselho_limpo = (data.responsavel_tecnico_conselho or "").strip()
    unidades = db.exec(
        select(UnidadeSaude).where(UnidadeSaude.id.in_(data.unidade_ids))
    ).all()
    if not unidades:
        raise HTTPException(404, "Nenhuma unidade encontrada para atualização.")

    for u in unidades:
        u.responsavel_tecnico_nome = nome_limpo
        u.responsavel_tecnico_cns = cns_limpo
        if conselho_limpo:
            u.responsavel_tecnico_conselho = conselho_limpo
        db.add(u)
    db.commit()
    return {"ok": True, "atualizadas": len(unidades)}


@router.delete("/unidades-saude/{uid}", status_code=204)
@router.delete("/unidades/{uid}", status_code=204, include_in_schema=False)
def inativar_unidade(
    uid: int,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_any_perm("usuarios", "cfg_unidades", acoes=("excluir",))),
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
    db: Session = Depends(_get_db), ator=Depends(need_any_perm("usuarios", "cfg_medicos")),
):
    from app.services.export_xlsx import resposta_xlsx

    linhas = [{
        "nome": m.nome,
        "cpf": m.cpf or "",
        "cns": getattr(m, "cns", "") or "",
        "conselho": f"{getattr(m, 'conselho_tipo', 'CRM')}/{getattr(m, 'conselho_uf', 'MG')} {m.crm or ''}".strip(),
        "vinculo": getattr(m, "vinculo", "") or "",
        "chs": getattr(m, "chs_total", 40),
        "cbo": " ".join(x for x in [m.cbo_codigo or "", m.cbo_descricao or ""] if x),
        "esps": m.especialidades or "",
        "contato": " ".join(x for x in [m.telefone or "", m.email or ""] if x),
        "status": "ativo" if m.ativo else "inativo",
    } for m in db.exec(select(Medico).order_by(Medico.nome)).all()]
    return resposta_xlsx(
        "Médicos / profissionais", getattr(ator, "nome", "") or getattr(ator, "username", ""),
        [
            {"chave": "nome", "rotulo": "Nome completo", "largura": 34},
            {"chave": "cpf", "rotulo": "CPF", "largura": 16},
            {"chave": "cns", "rotulo": "CNS", "largura": 18},
            {"chave": "conselho", "rotulo": "Conselho", "largura": 18},
            {"chave": "vinculo", "rotulo": "Vínculo", "largura": 18},
            {"chave": "chs", "rotulo": "CHS", "largura": 10},
            {"chave": "cbo", "rotulo": "CBO", "largura": 30},
            {"chave": "esps", "rotulo": "Especialidades", "largura": 34},
            {"chave": "contato", "rotulo": "Contato", "largura": 34},
            {"chave": "status", "rotulo": "Status", "largura": 12},
        ],
        linhas, "medicos",
    )


@router.get("/unidades-saude/exportar")
def exportar_unidades(
    db: Session = Depends(_get_db), ator=Depends(need_any_perm("usuarios", "cfg_unidades")),
):
    from app.services.export_xlsx import resposta_xlsx

    linhas = [{
        "nome": u.nome,
        "cnes": u.cnes or "",
        "tipo": getattr(u, "tipo_estabelecimento", "") or "",
        "cnpj": getattr(u, "cnpj", "") or "",
        "ibge": getattr(u, "codigo_ibge", "") or "",
        "rt": getattr(u, "responsavel_tecnico_nome", "") or "",
        "endereco": " ".join(x for x in [
            u.endereco or "", f"Nº {u.numero}" if getattr(u, "numero", "") else "",
            u.bairro or "", getattr(u, "municipio", "") or "",
            f"CEP {u.cep}" if getattr(u, "cep", "") else "",
        ] if x),
        "telefone": u.telefone or "",
        "status": "ativo" if u.ativo else "inativo",
    } for m, u in enumerate(db.exec(select(UnidadeSaude).order_by(UnidadeSaude.nome)).all())]
    return resposta_xlsx(
        "PSFs / Unidades de saúde", getattr(ator, "nome", "") or getattr(ator, "username", ""),
        [
            {"chave": "nome", "rotulo": "Nome", "largura": 34},
            {"chave": "cnes", "rotulo": "CNES", "largura": 14},
            {"chave": "tipo", "rotulo": "Tipo Estabelecimento", "largura": 22},
            {"chave": "cnpj", "rotulo": "CNPJ", "largura": 20},
            {"chave": "ibge", "rotulo": "IBGE", "largura": 12},
            {"chave": "rt", "rotulo": "Responsável Técnico", "largura": 28},
            {"chave": "endereco", "rotulo": "Endereço completo", "largura": 52},
            {"chave": "telefone", "rotulo": "Telefone", "largura": 16},
            {"chave": "status", "rotulo": "Status", "largura": 12},
        ],
        linhas, "unidades_saude",
    )


# ---------- Serviços Especializados (CNES) ----------
@router.get("/unidades-saude/{uid}/servicos", response_model=list[UnidadeServicoEspecializadoOut])
def listar_servicos_unidade(
    uid: int,
    somente_ativos: bool | None = Query(default=None),
    db: Session = Depends(_get_db),
    _ator: User = Depends(get_current_user),
):
    """Lista os serviços especializados cadastrados para a unidade de saúde."""
    unidade = db.get(UnidadeSaude, uid)
    if not unidade:
        raise HTTPException(404, "Unidade não encontrada")
    base = select(UnidadeServicoEspecializado).where(UnidadeServicoEspecializado.unidade_saude_id == uid)
    if somente_ativos is True:
        base = base.where(UnidadeServicoEspecializado.ativo != False)
    elif somente_ativos is False:
        base = base.where(UnidadeServicoEspecializado.ativo == False)
    base = base.order_by(UnidadeServicoEspecializado.servico_codigo, UnidadeServicoEspecializado.classificacao_codigo)
    itens = list(db.exec(base).all())
    return [UnidadeServicoEspecializadoOut(**i.model_dump()) for i in itens]


@router.post("/unidades-saude/{uid}/servicos", response_model=UnidadeServicoEspecializadoOut, status_code=201)
def criar_servico_unidade(
    uid: int,
    data: UnidadeServicoEspecializadoIn,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_any_perm("usuarios", "cfg_unidades", acoes=("criar",))),
):
    """Cadastra um serviço especializado para a unidade de saúde."""
    unidade = db.get(UnidadeSaude, uid)
    if not unidade:
        raise HTTPException(404, "Unidade não encontrada")
    dados = data.model_dump()
    dados["unidade_saude_id"] = uid
    obj = UnidadeServicoEspecializado(**dados)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return UnidadeServicoEspecializadoOut(**obj.model_dump())


@router.put("/unidades-saude/{uid}/servicos/{sid}", response_model=UnidadeServicoEspecializadoOut)
def atualizar_servico_unidade(
    uid: int,
    sid: int,
    data: UnidadeServicoEspecializadoIn,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_any_perm("usuarios", "cfg_unidades", acoes=("editar",))),
):
    """Atualiza um serviço especializado."""
    obj = db.get(UnidadeServicoEspecializado, sid)
    if not obj or obj.unidade_saude_id != uid:
        raise HTTPException(404, "Serviço especializado não encontrado na unidade")
    for k, v in data.model_dump().items():
        if k != "unidade_saude_id":
            setattr(obj, k, v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return UnidadeServicoEspecializadoOut(**obj.model_dump())


@router.delete("/unidades-saude/{uid}/servicos/{sid}", status_code=204)
def remover_servico_unidade(
    uid: int,
    sid: int,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_any_perm("usuarios", "cfg_unidades", acoes=("excluir",))),
):
    """Remove um serviço especializado da unidade."""
    obj = db.get(UnidadeServicoEspecializado, sid)
    if not obj or obj.unidade_saude_id != uid:
        raise HTTPException(404, "Serviço especializado não encontrado na unidade")
    db.delete(obj)
    db.commit()


# ---------- Equipes de Saúde (INE) e Profissionais ----------
def _equipe_to_out(eq: EquipeSaude, db: Session) -> EquipeSaudeOut:
    unidade = db.get(UnidadeSaude, eq.unidade_saude_id)
    profs_db = list(db.exec(
        select(EquipeProfissional).where(EquipeProfissional.equipe_id == eq.id)
    ).all())

    profs_out: list[EquipeProfissionalOut] = []
    for p in profs_db:
        med = db.get(Medico, p.medico_id)
        p_dict = p.model_dump()
        if med:
            p_dict["medico_nome"] = med.nome
            p_dict["medico_cns"] = getattr(med, "cns", "") or ""
            p_dict["medico_crm"] = med.crm or ""
            p_dict["medico_cbo"] = f"{med.cbo_codigo} - {med.cbo_descricao}".strip(" -")
        profs_out.append(EquipeProfissionalOut(**p_dict))

    d = eq.model_dump()
    d["unidade_nome"] = unidade.nome if unidade else None
    d["profissionais"] = profs_out
    return EquipeSaudeOut(**d)


@router.get("/unidades-saude/{uid}/equipes", response_model=list[EquipeSaudeOut])
def listar_equipes_unidade(
    uid: int,
    somente_ativas: bool | None = Query(default=None),
    db: Session = Depends(_get_db),
    _ator: User = Depends(get_current_user),
):
    """Lista equipes de atenção básica vinculadas a uma unidade de saúde."""
    base = select(EquipeSaude).where(EquipeSaude.unidade_saude_id == uid)
    if somente_ativas is True:
        base = base.where(EquipeSaude.ativo != False)
    elif somente_ativas is False:
        base = base.where(EquipeSaude.ativo == False)
    base = base.order_by(EquipeSaude.nome_equipe)
    equipes = list(db.exec(base).all())
    return [_equipe_to_out(eq, db) for eq in equipes]


@router.get("/equipes", response_model=list[EquipeSaudeOut])
def listar_equipes(
    q: str = Query(default="", max_length=80),
    unidade_saude_id: int | None = Query(default=None),
    somente_ativas: bool | None = Query(default=None),
    db: Session = Depends(_get_db),
    _ator: User = Depends(get_current_user),
):
    """Lista equipes de atenção básica com busca por nome, INE, área ou tipo."""
    base = select(EquipeSaude)
    if unidade_saude_id:
        base = base.where(EquipeSaude.unidade_saude_id == unidade_saude_id)
    if somente_ativas is True:
        base = base.where(EquipeSaude.ativo != False)
    elif somente_ativas is False:
        base = base.where(EquipeSaude.ativo == False)
    base = base.order_by(EquipeSaude.nome_equipe)
    equipes = list(db.exec(base).all())

    termo = (q or "").strip().lower()
    if termo:
        equipes = [
            e for e in equipes
            if termo in (e.nome_equipe or "").lower()
            or termo in (e.ine or "").lower()
            or termo in (e.tipo_equipe or "").lower()
            or termo in (e.area or "").lower()
        ]
    return [_equipe_to_out(eq, db) for eq in equipes]


@router.get("/equipes/{eid}", response_model=EquipeSaudeOut)
def obter_equipe(
    eid: int,
    db: Session = Depends(_get_db),
    _ator: User = Depends(get_current_user),
):
    eq = db.get(EquipeSaude, eid)
    if not eq:
        raise HTTPException(404, "Equipe não encontrada")
    return _equipe_to_out(eq, db)


@router.post("/equipes", response_model=EquipeSaudeOut, status_code=201)
@router.post("/unidades-saude/{uid}/equipes", response_model=EquipeSaudeOut, status_code=201, include_in_schema=False)
def criar_equipe(
    data: EquipeSaudeIn,
    uid: int | None = None,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_any_perm("usuarios", "cfg_unidades", acoes=("criar",))),
):
    target_uid = uid or data.unidade_saude_id
    unidade = db.get(UnidadeSaude, target_uid)
    if not unidade:
        raise HTTPException(404, "Unidade não encontrada")

    # Verifica se já existe INE igual
    ine_existente = db.exec(select(EquipeSaude).where(EquipeSaude.ine == data.ine)).first()
    if ine_existente:
        raise HTTPException(400, f"Já existe uma equipe cadastrada com o INE {data.ine} ('{ine_existente.nome_equipe}').")

    dados = data.model_dump()
    profs_data = dados.pop("profissionais", [])
    dados["unidade_saude_id"] = target_uid

    eq = EquipeSaude(**dados)
    db.add(eq)
    db.commit()
    db.refresh(eq)

    for p in profs_data:
        p_obj = EquipeProfissional(
            equipe_id=eq.id,
            medico_id=p["medico_id"],
            funcao=p.get("funcao", "MÉDICO"),
            chs=p.get("chs", 40),
        )
        db.add(p_obj)
    if profs_data:
        db.commit()

    return _equipe_to_out(eq, db)


@router.put("/equipes/{eid}", response_model=EquipeSaudeOut)
def atualizar_equipe(
    eid: int,
    data: EquipeSaudeIn,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_any_perm("usuarios", "cfg_unidades", acoes=("editar",))),
):
    eq = db.get(EquipeSaude, eid)
    if not eq:
        raise HTTPException(404, "Equipe não encontrada")

    # Valida INE único
    if data.ine != eq.ine:
        ine_existente = db.exec(select(EquipeSaude).where(EquipeSaude.ine == data.ine, EquipeSaude.id != eid)).first()
        if ine_existente:
            raise HTTPException(400, f"Já existe outra equipe cadastrada com o INE {data.ine}.")

    dados = data.model_dump()
    profs_data = dados.pop("profissionais", None)
    for k, v in dados.items():
        setattr(eq, k, v)
    db.add(eq)

    # Se profissionais foram passados no payload, sincroniza
    if profs_data is not None:
        atuais = list(db.exec(select(EquipeProfissional).where(EquipeProfissional.equipe_id == eid)).all())
        for a in atuais:
            db.delete(a)
        db.flush()
        for p in profs_data:
            p_obj = EquipeProfissional(
                equipe_id=eid,
                medico_id=p["medico_id"],
                funcao=p.get("funcao", "MÉDICO"),
                chs=p.get("chs", 40),
            )
            db.add(p_obj)

    db.commit()
    db.refresh(eq)
    return _equipe_to_out(eq, db)


@router.delete("/equipes/{eid}", status_code=204)
def inativar_equipe(
    eid: int,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_any_perm("usuarios", "cfg_unidades", acoes=("excluir",))),
):
    eq = db.get(EquipeSaude, eid)
    if not eq:
        raise HTTPException(404, "Equipe não encontrada")
    eq.ativo = False
    db.add(eq)
    db.commit()


@router.post("/equipes/{eid}/profissionais", response_model=EquipeProfissionalOut, status_code=201)
def adicionar_profissional_equipe(
    eid: int,
    data: EquipeProfissionalIn,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_any_perm("usuarios", "cfg_unidades", acoes=("editar", "criar"))),
):
    eq = db.get(EquipeSaude, eid)
    if not eq:
        raise HTTPException(404, "Equipe não encontrada")
    med = db.get(Medico, data.medico_id)
    if not med:
        raise HTTPException(404, "Profissional de saúde não encontrado")

    obj = EquipeProfissional(
        equipe_id=eid,
        medico_id=data.medico_id,
        funcao=data.funcao,
        chs=data.chs,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)

    d = obj.model_dump()
    d["medico_nome"] = med.nome
    d["medico_cns"] = getattr(med, "cns", "") or ""
    d["medico_crm"] = med.crm or ""
    d["medico_cbo"] = f"{med.cbo_codigo} - {med.cbo_descricao}".strip(" -")
    return EquipeProfissionalOut(**d)


@router.delete("/equipes/{eid}/profissionais/{pid}", status_code=204)
def remover_profissional_equipe(
    eid: int,
    pid: int,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_any_perm("usuarios", "cfg_unidades", acoes=("editar", "excluir"))),
):
    obj = db.get(EquipeProfissional, pid)
    if not obj or obj.equipe_id != eid:
        raise HTTPException(404, "Vínculo profissional não encontrado na equipe")
    db.delete(obj)
    db.commit()


# ---------- Prestadores de Serviços (Subagente 3) ----------
@router.get("/prestadores", response_model=list[PrestadorOut])
def listar_prestadores(
    q: str = Query(default="", max_length=80),
    somente_ativos: bool | None = Query(default=None),
    tipo: str = Query(default="", max_length=50),
    db: Session = Depends(_get_db),
    _ator: User = Depends(get_current_user),
):
    """Lista prestadores de serviço (ex: Santa Casa, clínicas, laboratórios externos)."""
    base = select(Prestador).order_by(Prestador.razao_social)
    if somente_ativos is True:
        base = select(Prestador).where(Prestador.ativo != False).order_by(Prestador.razao_social)  # noqa: E712
    elif somente_ativos is False:
        base = select(Prestador).where(Prestador.ativo == False).order_by(Prestador.razao_social)  # noqa: E712

    itens = list(db.exec(base).all())
    termo = (q or "").strip().lower()
    tipo_norm = (tipo or "").strip().lower()
    if tipo_norm:
        itens = [p for p in itens if (p.tipo_entidade or "").lower() == tipo_norm]
    if termo:
        itens = [
            p for p in itens
            if termo in (p.razao_social or "").lower()
            or termo in (p.nome_fantasia or "").lower()
            or termo in (p.cnpj or "").lower()
            or termo in (p.cnes or "").lower()
            or termo in (p.responsavel_nome or "").lower()
            or termo in (p.municipio or "").lower()
        ]
    return [PrestadorOut(**p.model_dump()) for p in itens]


@router.get("/prestadores/exportar")
def exportar_prestadores(
    db: Session = Depends(_get_db),
    ator=Depends(need_any_perm("usuarios", "cfg_unidades", "tfd", "lab")),
):
    from app.services.export_xlsx import resposta_xlsx

    linhas = [{
        "razao_social": p.razao_social,
        "nome_fantasia": p.nome_fantasia or "",
        "tipo": p.tipo_entidade or "",
        "cnpj": p.cnpj or "",
        "cnes": p.cnes or "",
        "responsavel": p.responsavel_nome or "",
        "contato": " ".join(x for x in [p.telefone or "", p.email or ""] if x),
        "municipio": p.municipio or "",
        "status": "ativo" if p.ativo else "inativo",
    } for p in db.exec(select(Prestador).order_by(Prestador.razao_social)).all()]
    return resposta_xlsx(
        "Prestadores de Serviços", getattr(ator, "nome", "") or getattr(ator, "username", ""),
        [
            {"chave": "razao_social", "rotulo": "Razão Social", "largura": 35},
            {"chave": "nome_fantasia", "rotulo": "Nome Fantasia", "largura": 25},
            {"chave": "tipo", "rotulo": "Tipo", "largura": 16},
            {"chave": "cnpj", "rotulo": "CNPJ", "largura": 20},
            {"chave": "cnes", "rotulo": "CNES", "largura": 14},
            {"chave": "responsavel", "rotulo": "Responsável", "largura": 25},
            {"chave": "contato", "rotulo": "Contato", "largura": 30},
            {"chave": "municipio", "rotulo": "Município", "largura": 20},
            {"chave": "status", "rotulo": "Status", "largura": 12},
        ],
        linhas, "prestadores",
    )


@router.get("/prestadores/{pid}", response_model=PrestadorOut)
def obter_prestador(
    pid: int,
    db: Session = Depends(_get_db),
    _ator: User = Depends(get_current_user),
):
    obj = db.get(Prestador, pid)
    if not obj:
        raise HTTPException(404, "Prestador não encontrado")
    return PrestadorOut(**obj.model_dump())


@router.post("/prestadores", response_model=PrestadorOut, status_code=201)
def criar_prestador(
    data: PrestadorIn,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_any_perm("usuarios", "cfg_unidades", "tfd", "lab", acoes=("criar",))),
):
    obj = Prestador(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return PrestadorOut(**obj.model_dump())


@router.put("/prestadores/{pid}", response_model=PrestadorOut)
def atualizar_prestador(
    pid: int,
    data: PrestadorIn,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_any_perm("usuarios", "cfg_unidades", "tfd", "lab", acoes=("editar",))),
):
    obj = db.get(Prestador, pid)
    if not obj:
        raise HTTPException(404, "Prestador não encontrado")
    for k, v in data.model_dump().items():
        setattr(obj, k, v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return PrestadorOut(**obj.model_dump())


@router.delete("/prestadores/{pid}", status_code=204)
def inativar_prestador(
    pid: int,
    permanente: bool = False,
    db: Session = Depends(_get_db),
    _ator: User = Depends(need_any_perm("usuarios", "cfg_unidades", "tfd", "lab", acoes=("excluir",))),
):
    obj = db.get(Prestador, pid)
    if not obj:
        raise HTTPException(404, "Prestador não encontrado")
    if not permanente:
        obj.ativo = False
        db.add(obj)
        db.commit()
        return None

    db.delete(obj)
    db.commit()
    return None
