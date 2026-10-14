from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, func, select

from app.core.deps import get_current_user, get_db, require_superuser
from app.core.pagination import Pagina, paginar
from app.models.user import User
from app.schemas import PrimeiraTrocaIn, ResetSenhaOut, TrocarSenhaIn, UserCreate, UserOut, UserUpdate
from app.services.users import (
    create_user,
    primeira_troca,
    reset_senha,
    to_out,
    trocar_senha,
    update_user,
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


@router.get("/", response_model=Pagina[UserOut])
def listar(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(require_superuser),
):
    base = select(User).order_by(User.username)
    total = db.exec(select(func.count()).select_from(base.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = db.exec(base.offset(meta["offset"]).limit(limit)).all()
    return {
        "data": [to_out(u) for u in rows],
        "total": total,
        "page": meta["page"],
        "pages": meta["pages"],
    }


@router.post("/", response_model=ResetSenhaOut, status_code=status.HTTP_201_CREATED)
def criar(
    data: UserCreate, db: Session = Depends(get_db), _=Depends(require_superuser)
):
    """Cria conta com temporária (hash) e devolve claro 1 vez p/ entrega."""
    try:
        user, temporaria = create_user(db, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
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
    return to_out(update_user(db, user, data))


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
    db.delete(user)
    db.commit()
