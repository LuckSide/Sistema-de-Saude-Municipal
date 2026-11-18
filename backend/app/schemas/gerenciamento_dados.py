from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


# ==============================================================================
# DIAGNÓSTICO (R2)
# ==============================================================================

class ResumoDominio(BaseModel):
    duplicidades: int = 0
    inconsistencias: int = 0


class ResumoDiagnostico(BaseModel):
    pacientes: ResumoDominio = Field(default_factory=ResumoDominio)
    filas: ResumoDominio = Field(default_factory=ResumoDominio)
    laboratorio: ResumoDominio = Field(default_factory=ResumoDominio)
    viagens: ResumoDominio = Field(default_factory=ResumoDominio)
    cadastros: ResumoDominio = Field(default_factory=ResumoDominio)


class DetalhesDiagnostico(BaseModel):
    pacientes: List[Dict[str, Any]] = Field(default_factory=list)
    filas: List[Dict[str, Any]] = Field(default_factory=list)
    laboratorio: List[Dict[str, Any]] = Field(default_factory=list)
    viagens: List[Dict[str, Any]] = Field(default_factory=list)
    cadastros: List[Dict[str, Any]] = Field(default_factory=list)


class DiagnosticoResponse(BaseModel):
    resumo: ResumoDiagnostico
    detalhes: DetalhesDiagnostico


# ==============================================================================
# UNIFICAÇÃO (R3)
# ==============================================================================

EntidadeUnificavel = Literal["pacientes", "medicos", "unidades", "laboratorios"]


class UnificarRegistrosRequest(BaseModel):
    entidade: EntidadeUnificavel = Field(
        description="Entidade alvo: 'pacientes', 'medicos', 'unidades' ou 'laboratorios'"
    )
    registro_principal_id: int = Field(
        gt=0, description="ID do registro principal que será preservado"
    )
    registro_duplicado_id: int = Field(
        gt=0, description="ID do registro duplicado que será unificado e excluído"
    )
    campos_mesclar: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Campos sobrescritos manualmente a serem mesclados no registro principal",
    )


class UnificarRegistrosResponse(BaseModel):
    sucesso: bool
    mensagem: str
    vinculos_reatribuidos: int
    registro_excluido_id: int
    detalhes: Optional[Dict[str, Any]] = Field(default_factory=dict)


# ==============================================================================
# LIMPEZA EM MASSA (R4)
# ==============================================================================

TipoLimpezaMassa = Literal[
    "fila_importada",
    "pedidos_orfaos",
    "agendamentos_duplicados",
    "cadastros_fantasmas",
]


class LimpezaMassaPreviewRequest(BaseModel):
    tipo_limpeza: str = Field(
        description="Tipo de limpeza: 'fila_importada', 'pedidos_orfaos', 'agendamentos_duplicados'"
    )
    filtro: Optional[Dict[str, Any]] = Field(
        default=None, description="Filtros específicos para a operação de limpeza"
    )


class LimpezaMassaPreviewResponse(BaseModel):
    total_afetados: int
    detalhes: List[Dict[str, Any]] = Field(default_factory=list)
    mensagem: Optional[str] = None


class LimpezaMassaExecutarRequest(BaseModel):
    tipo_limpeza: str = Field(
        description="Tipo de limpeza: 'fila_importada', 'pedidos_orfaos', 'agendamentos_duplicados'"
    )
    filtro: Optional[Dict[str, Any]] = Field(
        default=None, description="Filtros específicos para a operação de limpeza"
    )
    senha: str = Field(
        default="",
        description="Senha do administrador logado para confirmação da operação",
    )
    confirmacao_explicita: bool = Field(
        default=False,
        description="Confirmação inequívoca da execução destrutiva em lote",
    )


class LimpezaMassaExecutarResponse(BaseModel):
    sucesso: bool
    total_removidos: int
    mensagem: str
    detalhes: Optional[Dict[str, Any]] = Field(default_factory=dict)


# ==============================================================================
# AUDITORIA (R5)
# ==============================================================================

class LogAuditoriaItem(BaseModel):
    id: int
    user_id: Optional[int] = None
    user_name: str = ""
    action: str
    entity: str = ""
    entity_id: Optional[int] = None
    device: str = ""
    details: str = ""
    timestamp: datetime
    rotulo_acao: Optional[str] = None
    rotulo_entidade: Optional[str] = None


class AuditoriaGerenciamentoResponse(BaseModel):
    logs: List[LogAuditoriaItem] = Field(default_factory=list)
    total: int = 0
