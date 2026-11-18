"""Router REST para Gerenciamento de Dados (Configurações).

Endpoints:
- GET  /api/v1/gerenciamento-dados/diagnostico
- POST /api/v1/gerenciamento-dados/unificar
- POST /api/v1/gerenciamento-dados/resolver
- POST /api/v1/gerenciamento-dados/resolver-lote
- POST /api/v1/gerenciamento-dados/limpeza-massa/preview
- POST /api/v1/gerenciamento-dados/limpeza-massa/executar
- GET  /api/v1/gerenciamento-dados/auditoria
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, status
from sqlmodel import Session

from app.core.deps import get_db, require_senha_ok, require_superuser
from app.models.user import User
from app.schemas.gerenciamento_dados import (
    AuditoriaGerenciamentoResponse,
    DiagnosticoResponse,
    LimpezaMassaExecutarRequest,
    LimpezaMassaExecutarResponse,
    LimpezaMassaPreviewRequest,
    LimpezaMassaPreviewResponse,
    ResolverInconsistenciaItem,
    ResolverInconsistenciaResultado,
    ResolverLoteRequest,
    ResolverLoteResponse,
    UnificarRegistrosRequest,
    UnificarRegistrosResponse,
)
from app.services.gerenciamento_dados import (
    diagnosticar_dados,
    executar_limpeza_massa,
    listar_logs_auditoria_gerenciamento,
    preview_limpeza_massa,
    resolver_inconsistencia,
    resolver_inconsistencias_lote,
    unificar_registros,
)

router = APIRouter()


@router.get(
    "/diagnostico",
    response_model=DiagnosticoResponse,
    summary="Relatório de diagnóstico de inconsistências e duplicidades",
    description="Analisa a base de dados nos 5 domínios (pacientes, filas, laboratorio, viagens, cadastros), utilizando cache persistente salvo no banco quando forcar=false.",
)
def obter_diagnostico(
    dominio: Optional[str] = Query(
        default=None,
        description="Filtro opcional de domínio ('pacientes', 'filas', 'laboratorio', 'viagens', 'cadastros' ou omitir para todos)",
    ),
    forcar: bool = Query(
        default=False,
        description="Quando true, ignora o cache e reexecuta a varredura completa no banco.",
    ),
    db: Session = Depends(get_db),
    user: User = Depends(require_superuser),
) -> DiagnosticoResponse:
    return diagnosticar_dados(db, dominio=dominio, forcar=forcar)


@router.post(
    "/resolver",
    response_model=ResolverInconsistenciaResultado,
    summary="Correção automatizada de uma inconsistência ou duplicidade",
    description="Executa a ação corretiva adequada para qualquer um dos tipos detectados nos 5 domínios, com bloqueio transacional, auditoria e invalidação do cache.",
)
def resolver_item(
    payload: ResolverInconsistenciaItem,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_superuser),
    _senha_guard: User = Depends(require_senha_ok),
) -> ResolverInconsistenciaResultado:
    client_ip = request.client.host if request.client else ""
    user_agent = request.headers.get("user-agent", "")
    return resolver_inconsistencia(
        db=db,
        item=payload,
        user=user,
        client_ip=client_ip,
        user_agent=user_agent,
    )


@router.post(
    "/resolver-lote",
    response_model=ResolverLoteResponse,
    summary="Correção em lote de inconsistências selecionadas",
    description="Processa em lote os itens selecionados usando savepoints isolados por item, auditoria consolidada e invalidação automática do cache.",
)
def resolver_lote(
    payload: ResolverLoteRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_superuser),
    _senha_guard: User = Depends(require_senha_ok),
) -> ResolverLoteResponse:
    client_ip = request.client.host if request.client else ""
    user_agent = request.headers.get("user-agent", "")
    return resolver_inconsistencias_lote(
        db=db,
        request=payload,
        user=user,
        client_ip=client_ip,
        user_agent=user_agent,
    )


@router.post(
    "/unificar",
    response_model=UnificarRegistrosResponse,
    summary="Unificação transacional de registros duplicados",
    description="Reatribui todas as chaves estrangeiras para o registro principal, resolve conflitos de constraints únicas e exclui o registro duplicado.",
)
def unificar_dados(
    payload: UnificarRegistrosRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_superuser),
) -> UnificarRegistrosResponse:
    client_ip = request.client.host if request.client else ""
    user_agent = request.headers.get("user-agent", "")
    return unificar_registros(
        db=db,
        request=payload,
        user=user,
        client_ip=client_ip,
        user_agent=user_agent,
    )


@router.post(
    "/limpeza-massa/preview",
    response_model=LimpezaMassaPreviewResponse,
    summary="Pré-visualização (dry-run) de limpeza em massa",
    description="Retorna a contagem exata e amostra de registros elegíveis para remoção sem alterar dados.",
)
def preview_limpeza(
    payload: LimpezaMassaPreviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_superuser),
) -> LimpezaMassaPreviewResponse:
    return preview_limpeza_massa(db=db, request=payload)


@router.post(
    "/limpeza-massa/executar",
    response_model=LimpezaMassaExecutarResponse,
    summary="Execução definitiva de limpeza em massa restrita a superusuários",
    description="Requer privilégio de superusuário e validação explícita da senha atual do administrador.",
)
def executar_limpeza(
    payload: LimpezaMassaExecutarRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_superuser),
    _senha_guard: User = Depends(require_senha_ok),
) -> LimpezaMassaExecutarResponse:
    client_ip = request.client.host if request.client else ""
    user_agent = request.headers.get("user-agent", "")
    return executar_limpeza_massa(
        db=db,
        request=payload,
        admin=admin,
        client_ip=client_ip,
        user_agent=user_agent,
    )


@router.get(
    "/auditoria",
    response_model=AuditoriaGerenciamentoResponse,
    summary="Histórico de auditoria das operações de gerenciamento de dados",
    description="Consulta as ações de unificação e limpeza registradas na trilha de auditoria do sistema.",
)
def listar_auditoria(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(require_superuser),
) -> AuditoriaGerenciamentoResponse:
    return listar_logs_auditoria_gerenciamento(db=db, limit=limit, offset=offset)
