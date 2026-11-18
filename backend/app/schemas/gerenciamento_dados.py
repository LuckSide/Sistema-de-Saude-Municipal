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
    cache_hit: bool = False
    gerado_em: Optional[datetime] = None


# ==============================================================================
# UNIFICAÇÃO (R3)
# ==============================================================================

EntidadeUnificavel = Literal[
    "pacientes",
    "medicos",
    "unidades",
    "laboratorios",
    "prestadores",
]


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
# LIMPEZA EM MASSA (R4) E LIMPEZA MANUAL POR ÁREA
# ==============================================================================

TipoLimpezaMassa = Literal[
    "fila_importada",
    "pedidos_orfaos",
    "agendamentos_duplicados",
    "cadastros_fantasmas",
    "limpar_filas_manual",
    "limpar_laboratorio_completo",
    "limpar_oxigenio",
    "limpar_tfd_viagens",
    "limpar_apac",
    "limpar_farmacia",
    "limpar_pacientes_manual",
]


class FilaResumoLimpeza(BaseModel):
    id: int
    nome: str
    codigo: str = ""
    tipo_fila: str = "REGULACAO_GERAL"
    qtd_tfd: int = 0
    qtd_lab: int = 0
    total: int = 0


class ResumoLimpezaManualResponse(BaseModel):
    filas: List[FilaResumoLimpeza] = Field(default_factory=list)
    filas_sem_vinculo_tfd: int = 0
    filas_sem_vinculo_lab: int = 0
    areas: Dict[str, int] = Field(default_factory=dict)


class LimpezaMassaPreviewRequest(BaseModel):
    tipo_limpeza: str = Field(
        description="Tipo de limpeza: higienização automática ou limpeza manual por área"
    )
    filtro: Optional[Dict[str, Any]] = Field(
        default=None, description="Filtros específicos para a operação de limpeza"
    )


class LimpezaMassaPreviewResponse(BaseModel):
    total_afetados: int
    detalhes: List[Dict[str, Any]] = Field(default_factory=list)
    resumo_tabelas: Optional[Dict[str, int]] = None
    mensagem: Optional[str] = None


class LimpezaMassaExecutarRequest(BaseModel):
    tipo_limpeza: str = Field(
        description="Tipo de limpeza: higienização automática ou limpeza manual por área"
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


# ==============================================================================
# RESOLUÇÃO INDIVIDUAL E EM LOTE DE INCONSISTÊNCIAS
# ==============================================================================

class ResolverInconsistenciaItem(BaseModel):
    tipo: str = Field(
        description="Tipo da inconsistência/duplicidade reportada pelo diagnóstico"
    )
    dominio: str = Field(
        description="Domínio: 'pacientes', 'filas', 'laboratorio', 'viagens' ou 'cadastros'"
    )
    chave_unica: Optional[str] = Field(
        default=None,
        description="Identificador único da ocorrência para correlação no lote",
    )
    dados: Dict[str, Any] = Field(
        default_factory=dict,
        description="Metadados da ocorrência retornada pelo diagnóstico",
    )
    parametros: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Parâmetros opcionais para customizar a correção",
    )


class ResolverInconsistenciaResultado(BaseModel):
    chave_unica: Optional[str] = None
    tipo: str
    dominio: str
    sucesso: bool
    mensagem: str
    registros_afetados: int = 0


class ResolverLoteRequest(BaseModel):
    itens: List[ResolverInconsistenciaItem] = Field(
        min_length=1,
        max_length=500,
        description="Lista de ocorrências selecionadas para correção em lote",
    )


class ResolverLoteResponse(BaseModel):
    sucesso: bool
    total_solicitados: int
    total_resolvidos: int
    total_falhas: int
    mensagem: str
    resultados: List[ResolverInconsistenciaResultado] = Field(default_factory=list)
