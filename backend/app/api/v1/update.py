"""Status de versão + auto-update. Leitura e execução só p/ superuser."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.deps import require_senha_ok, require_superuser
from app.models.user import User
from app.services.update import iniciar_atualizacao, ler_log, verificar_atualizacoes

router = APIRouter()


class UpdateStatusOut(BaseModel):
    versao: str = "1.0.0"
    atual: bool = True
    tem_atualizacao: bool = False
    commit_local: str | None = None
    commit_remoto: str | None = None
    release: str | None = None
    release_url: str | None = None
    branch: str = "main"
    repo: str = ""
    verificado_em: str = ""
    erro: str | None = None
    update_enabled: bool = True


@router.get("/status", response_model=UpdateStatusOut)
def status_update(
    forcar: bool = Query(default=False),
    admin: User = Depends(require_superuser),
    _=Depends(require_senha_ok),
):
    return verificar_atualizacoes(forcar=forcar)


@router.post("/executar")
def executar_update(
    admin: User = Depends(require_superuser),
    _=Depends(require_senha_ok),
):
    try:
        return iniciar_atualizacao()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/log")
def log_update(
    linhas: int = Query(default=200, ge=1, le=1000),
    admin: User = Depends(require_superuser),
    _=Depends(require_senha_ok),
):
    return {"log": ler_log(linhas)}
