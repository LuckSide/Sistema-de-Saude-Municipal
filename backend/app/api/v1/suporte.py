from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import Session, select

from app.core.deps import get_current_user_senha_ok, get_db
from app.models.suporte import TicketSuporte
from app.models.user import User
from app.services.permissoes import tem_tela

router = APIRouter()


class TicketCreate(BaseModel):
    tipo: str = Field(..., min_length=2, max_length=50, description="Tipo de chamado")
    descricao: str = Field(..., min_length=3, description="Descrição detalhada do problema ou solicitação")
    pagina_url: str = Field(default="", max_length=500, description="URL da tela onde o usuário estava")


class TicketStatusUpdate(BaseModel):
    status: str = Field(..., description="Novo status: aberto, em_analise ou resolvido")
    resposta_admin: Optional[str] = Field(default=None, description="Resposta ou notas do administrador")


class TicketOut(BaseModel):
    id: int
    usuario_id: Optional[int] = None
    usuario_nome: str
    tipo: str
    descricao: str
    pagina_url: str
    status: str
    resposta_admin: Optional[str] = None
    resolvido_por: Optional[str] = None
    resolvido_em: Optional[datetime] = None
    criado_em: datetime

    model_config = ConfigDict(from_attributes=True)


def require_admin_suporte(user: User = Depends(get_current_user_senha_ok)) -> User:
    """Valida se o usuário tem perfil administrativo ou permissão de usuários/administração."""
    if user.is_superuser or tem_tela(user, "usuarios") or tem_tela(user, "administracao"):
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Acesso restrito a administradores do sistema",
    )


@router.post("/tickets", response_model=TicketOut, status_code=status.HTTP_201_CREATED)
def criar_ticket(
    data: TicketCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_senha_ok),
):
    """Criação de ticket de suporte pelo usuário autenticado."""
    tipo_sanitizado = data.tipo.strip().lower()
    descricao_sanitizada = data.descricao.strip()

    if not descricao_sanitizada:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A descrição do ticket não pode estar vazia.",
        )

    ticket = TicketSuporte(
        usuario_id=current_user.id,
        usuario_nome=current_user.nome or current_user.username,
        tipo=tipo_sanitizado,
        descricao=descricao_sanitizada,
        pagina_url=(data.pagina_url or "").strip(),
        status="aberto",
        criado_em=datetime.utcnow(),
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


@router.get("/tickets", response_model=List[TicketOut])
def listar_tickets(
    tipo: Optional[str] = Query(default=None, description="Filtrar por tipo"),
    status_ticket: Optional[str] = Query(default=None, alias="status", description="Filtrar por status"),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_suporte),
):
    """Listagem de tickets com suporte a filtros para administradores."""
    query = select(TicketSuporte)

    if tipo and tipo.strip() and tipo.strip().lower() != "todos":
        query = query.where(TicketSuporte.tipo == tipo.strip().lower())

    if status_ticket and status_ticket.strip() and status_ticket.strip().lower() != "todos":
        query = query.where(TicketSuporte.status == status_ticket.strip().lower())

    query = query.order_by(TicketSuporte.criado_em.desc()).offset(offset).limit(limit)
    tickets = db.exec(query).all()
    return tickets


@router.get("/tickets/{ticket_id}", response_model=TicketOut)
def obter_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_suporte),
):
    """Detalhes de um ticket de suporte."""
    ticket = db.get(TicketSuporte, ticket_id)
    if not ticket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticket não encontrado.",
        )
    return ticket


@router.patch("/tickets/{ticket_id}/status", response_model=TicketOut)
def atualizar_status_ticket(
    ticket_id: int,
    data: TicketStatusUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin_suporte),
):
    """Atualiza o status de um ticket (ex: 'resolvido', 'aberto', 'em_analise')."""
    ticket = db.get(TicketSuporte, ticket_id)
    if not ticket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticket não encontrado.",
        )

    novo_status = data.status.strip().lower()
    if novo_status not in ("aberto", "em_analise", "resolvido"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Status inválido. Use 'aberto', 'em_analise' ou 'resolvido'.",
        )

    ticket.status = novo_status

    if novo_status == "resolvido":
        ticket.resolvido_por = admin.nome or admin.username
        ticket.resolvido_em = datetime.utcnow()
    elif novo_status in ("aberto", "em_analise"):
        ticket.resolvido_por = None
        ticket.resolvido_em = None

    if data.resposta_admin is not None:
        ticket.resposta_admin = data.resposta_admin.strip()

    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket
