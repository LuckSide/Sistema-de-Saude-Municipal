"""Módulo de agregação de rotas API v1.

Exporta router e api_router com o módulo de Gerenciamento de Dados montado sob o prefixo /gerenciamento-dados.
"""

from fastapi import APIRouter
from app.api.v1.gerenciamento_dados import router as gerenciamento_dados_router

router = APIRouter()
router.include_router(
    gerenciamento_dados_router,
    prefix="/gerenciamento-dados",
    tags=["Gerenciamento de Dados"],
)

api_router = router

__all__ = ["router", "api_router", "gerenciamento_dados_router"]
