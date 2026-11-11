from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, func, select

from app.core.deps import get_current_user, get_db, require_superuser
from app.core.pagination import Pagina, paginar
from app.models.tfd import Paciente
from app.models.user import User
from app.schemas import PrimeiraTrocaIn, ResetSenhaOut, TrocarSenhaIn, UserCreate, UserOut, UserUpdate
from app.services.users import (
    create_user,
    primeira_troca,
    reset_senha,
    to_out,
    trocar_senha,
    update_user,
    users_to_out,
)

router = APIRouter()


@router.put("/me/senha", status_code=status.HTTP_200_OK)
def trocar_minha_senha(
    data: TrocarSenhaIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        trocar_senha(db, user, data.senha_atual, data.nova_senha)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "detail": "Senha atualizada"}


@router.put("/me/primeira-troca", status_code=status.HTTP_200_OK)
def primeira_troca_senha(
    data: PrimeiraTrocaIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        primeira_troca(db, user, data.senha_atual, data.nova_senha, data.confirmar_senha)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "detail": "Senha definida. Acesso liberado."}


@router.post("/{user_id}/reset-senha", response_model=ResetSenhaOut)
def resetar_senha(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_superuser),
):
    user = db.exec(select(User).where(User.id == user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Use 'Trocar minha senha' para sua conta")
    temporaria = reset_senha(db, user)
    return ResetSenhaOut(ok=True, senha_temporaria=temporaria)


@router.get("/resumo")
def resumo_usuarios(
    db: Session = Depends(get_db),
    _=Depends(require_superuser),
):
    total = db.exec(select(func.count()).select_from(User)).one() or 0
    ativos = db.exec(select(func.count()).select_from(User).where(User.is_active == True)).one() or 0  # noqa: E712
    superusers = db.exec(select(func.count()).select_from(User).where(User.is_superuser == True)).one() or 0  # noqa: E712
    com_vinculo = db.exec(select(func.count()).select_from(User).where(User.paciente_id.is_not(None))).one() or 0
    return {
        "total": total,
        "ativos": ativos,
        "inativos": max(0, total - ativos),
        "superusers": superusers,
        "com_vinculo": com_vinculo,
        "sem_vinculo": max(0, total - com_vinculo),
    }


@router.get("/", response_model=Pagina[UserOut])
def listar(
    q: str = Query(default="", max_length=120),
    area: str = Query(default="", max_length=20),
    filtro: str = Query(default="", max_length=30),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=100000),
    db: Session = Depends(get_db),
    _=Depends(require_superuser),
):
    base = select(User).outerjoin(Paciente, User.paciente_id == Paciente.id)
    filtros = []

    termo = (q or "").strip()
    if termo:
        like = f"%{termo}%"
        digitos = "".join(c for c in termo if c.isdigit())
        conds = [
            User.username.ilike(like),
            User.nome.ilike(like),
            Paciente.nome.ilike(like),
            Paciente.cpf.ilike(like),
            Paciente.cns.ilike(like),
        ]
        if digitos:
            conds.append(Paciente.cpf.ilike(f"%{digitos}%"))
            if len(digitos) == 11:
                cpf_fmt = f"{digitos[:3]}.{digitos[3:6]}.{digitos[6:9]}-{digitos[9:]}"
                conds.append(Paciente.cpf.ilike(f"%{cpf_fmt}%"))
        filtros.append(or_(*conds))

    area_limpa = (area or "").strip()
    if area_limpa:
        filtros.append(User.area == area_limpa)

    filtro_limpo = (filtro or "").strip().lower()
    if filtro_limpo == "ativos":
        filtros.append(User.is_active == True)  # noqa: E712
    elif filtro_limpo == "inativos":
        filtros.append(User.is_active == False)  # noqa: E712
    elif filtro_limpo == "superuser":
        filtros.append(User.is_superuser == True)  # noqa: E712
    elif filtro_limpo == "com_vinculo":
        filtros.append(User.paciente_id.is_not(None))
    elif filtro_limpo == "sem_vinculo":
        filtros.append(User.paciente_id.is_(None))
    elif filtro_limpo == "medicos":
        filtros.append(User.medico_id.is_not(None))

    if filtros:
        base = base.where(*filtros)
    base = base.order_by(User.username)

    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = list(db.exec(base.offset(meta["offset"]).limit(limit)).all())
    return {
        "data": users_to_out(rows, db),
        "total": total,
        "page": meta["page"],
        "pages": meta["pages"],
    }


@router.get("/exportar")
def exportar(
    db: Session = Depends(get_db), admin: User = Depends(require_superuser)
):
    """Contas em XLSX (sem senhas)."""
    from app.services.export_xlsx import resposta_xlsx
    from app.services.users import list_users

    usuarios_out = users_to_out(list_users(db), db)
    linhas = [{
        "usuario": u["username"],
        "nome": u["nome"] or "",
        "pessoa_vinculada": u.get("paciente_nome") or "",
        "cpf_vinculado": u.get("paciente_cpf") or "",
        "area": u["area"],
        "telas": ",".join(u["telas"]),
        "perfil": "Superuser" if u["is_superuser"] else ("Médico" if u.get("medico_id") else "Operador"),
        "status": "ativo" if u["is_active"] else "inativo",
    } for u in usuarios_out]
    return resposta_xlsx(
        "Contas de usuário", admin.nome or admin.username,
        [
            {"chave": "usuario", "rotulo": "Usuário", "largura": 22},
            {"chave": "nome", "rotulo": "Nome", "largura": 32},
            {"chave": "pessoa_vinculada", "rotulo": "Pessoa do Município", "largura": 32},
            {"chave": "cpf_vinculado", "rotulo": "CPF Vinculado", "largura": 18},
            {"chave": "area", "rotulo": "Área", "largura": 14},
            {"chave": "telas", "rotulo": "Telas", "largura": 50},
            {"chave": "perfil", "rotulo": "Perfil", "largura": 14},
            {"chave": "status", "rotulo": "Status", "largura": 12},
        ],
        linhas, "usuarios",
    )


@router.post("/", response_model=ResetSenhaOut, status_code=status.HTTP_201_CREATED)
def criar(
    data: UserCreate, db: Session = Depends(get_db), _=Depends(require_superuser)
):
    """Cria conta com temporária (hash) e devolve claro 1 vez p/ entrega."""
    try:
        user, temporaria = create_user(db, data)
    except (ValueError, IntegrityError) as e:
        db.rollback()
        msg = str(e)
        if isinstance(e, IntegrityError) or "duplicate" in msg.lower() or "unique" in msg.lower():
            msg = "username já existe"
        raise HTTPException(status_code=400, detail=msg)
    if not temporaria:
        raise HTTPException(status_code=400, detail="Falha ao gerar temporária")
    return ResetSenhaOut(
        ok=True,
        senha_temporaria=temporaria,
        detail=f"Conta {user.username} criada. Entregue a temporária — troca obrigatória no 1º login.",
    )


@router.put("/{user_id}", response_model=UserOut)
def atualizar(
    user_id: int,
    data: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_superuser),
):
    user = db.exec(select(User).where(User.id == user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    # Trava: admin não remove próprio super/inativo (evita lockout após trocar senha/editar).
    if user.id == admin.id:
        if data.is_superuser is False:
            raise HTTPException(status_code=400, detail="Não pode remover seu próprio superuser")
        if data.is_active is False:
            raise HTTPException(status_code=400, detail="Não pode inativar a si mesmo")
    try:
        return to_out(update_user(db, user, data), db)
    except (ValueError, IntegrityError) as e:
        db.rollback()
        msg = str(e)
        if isinstance(e, IntegrityError) or "duplicate" in msg.lower() or "unique" in msg.lower():
            msg = "username já existe"
        raise HTTPException(status_code=400, detail=msg)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_superuser),
):
    user = db.exec(select(User).where(User.id == user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Não pode excluir a si mesmo")
    # Limpa prefs do dashboard (FK) antes de excluir a conta.
    try:
        from app.models.dashboard_prefs import UserDashboardPrefs

        prefs = db.get(UserDashboardPrefs, user.id)
        if prefs:
            db.delete(prefs)
    except Exception:
        pass
    db.delete(user)
    db.commit()
