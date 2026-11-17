from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator


# ---------- Laboratórios ----------
class LaboratorioIn(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    ativo: bool = True
    responsavel_tecnico: str = Field(default="", max_length=120)
    horario_funcionamento: str = Field(default="", max_length=120)
    criar_usuario_acesso: bool = True


class LaboratorioOut(LaboratorioIn):
    id: int
    usuario_criado: str | None = None
    senha_temporaria: str | None = None


# ---------- Vagas ----------
class VagaIn(BaseModel):
    laboratorio_id: int
    data: date
    vagas_totais: int = Field(ge=0, le=1000)
    tipo_servico: str = Field(default="rotina", max_length=50)


class VagaOut(VagaIn):
    id: int
    vagas_ocupadas: int
    vagas_livres: int = 0
    laboratorio_nome: str = ""


class VagaLoteMesIn(BaseModel):
    laboratorio_id: int
    ano: int = Field(ge=2000, le=2100)
    mes: int = Field(ge=1, le=12)
    vagas_diarias: int = Field(ge=0, le=1000)
    ignorar_fins_semana: bool = True
    bloquear_feriados: bool = True
    tipo_servico: str = Field(default="rotina", max_length=50)


class VagaLoteMesOut(BaseModel):
    laboratorio_id: int
    laboratorio_nome: str = ""
    mes_ref: str = ""
    dias_alvo: int = 0
    criadas: int = 0
    atualizadas: int = 0
    ignoradas_fim_semana: int = 0
    ignoradas_feriados: int = 0
    mantidas_conflito: int = 0
    ignoradas_passado: int = 0


# ---------- Feriados e Bloqueios ----------
class LabFeriadoBloqueioIn(BaseModel):
    data: date
    descricao: str = Field(default="", max_length=150)
    bloquear_agendamento: bool = True
    laboratorio_id: int | None = None


class LabFeriadoBloqueioOut(LabFeriadoBloqueioIn):
    id: int
    laboratorio_nome: str = ""
    created_at: datetime | None = None


# ---------- Fila PSF ----------
class FilaPsfIn(BaseModel):
    paciente_id: int
    especialidade: str = Field(min_length=2, max_length=120, description="Especialidade requisitante obrigatória")
    unidade_psf: str = Field(min_length=1, max_length=120)
    medico_solicitante: str = Field(min_length=1, max_length=120)
    data_solicitacao: date | None = None
    data_pedido: date | None = Field(default_factory=date.today, description="Data do pedido oficial na fila")
    prioridade: str = Field(default="rotina", pattern="^(urgente|alta|rotina)$")
    justificativa: str = Field(default="", max_length=500)
    observacoes: str = Field(default="", max_length=500)
    sigtap_ids: list[int] = Field(default_factory=list)

    @field_validator("justificativa")
    @classmethod
    def _valida_justificativa(cls, v: str) -> str:
        s = (v or "").strip()
        if s and len(s) < 12:
            raise ValueError("A justificativa clínica deve ter pelo menos 12 caracteres.")
        return s


class FilaPsfOut(FilaPsfIn):
    id: int
    especialidade: str = ""
    status: str = "na_fila"
    prioridade: str = "rotina"
    paciente_nome: str = ""
    paciente_cpf: str = ""
    paciente_cns: str = ""
    paciente_prontuario: str = ""
    exames_nomes: list[str] = Field(default_factory=list)
    lote_id: int | None = None


class FilaPsfStatusIn(BaseModel):
    status: str = Field(pattern="^(na_fila|agendado|cancelado)$")


class FilaPsfUpdateIn(BaseModel):
    especialidade: str | None = None
    unidade_psf: str | None = None
    medico_solicitante: str | None = None
    data_solicitacao: date | None = None
    data_pedido: date | None = None
    prioridade: str | None = Field(default=None, pattern="^(urgente|alta|rotina)$")
    justificativa: str | None = None
    observacoes: str | None = None
    sigtap_ids: list[int] | None = None

    @field_validator("justificativa")
    @classmethod
    def _valida_justificativa(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        if s and len(s) < 12:
            raise ValueError("A justificativa clínica deve ter pelo menos 12 caracteres.")
        return s


class FilaPsfAgendarLoteIn(BaseModel):
    fila_ids: list[int] = Field(min_length=1)
    laboratorio_id: int
    data_agendada: date
    hora_agendada: str = Field(default="07:00", max_length=10)
    sigtap_ids: list[int] = Field(default_factory=list)
    enviar_whatsapp: bool = True
    instrucoes_transporte: str = ""


# ---------- Solicitação mestre + itens ----------
class SolicItemIn(BaseModel):
    sigtap_id: int
    quantidade: int = Field(default=1, ge=1, le=99)


class SolicMestreIn(BaseModel):
    paciente_id: int
    data_agendada: date
    laboratorio_id: int
    hora_agendada: str = Field(default="07:00", max_length=10)
    # Legado: lista simples (compat). Novo: lista com quantidade.
    sigtap_ids: list[int] | None = Field(default=None, min_length=1)
    itens: list[SolicItemIn] | None = None
    origem_fila_id: int | None = None
    medico_id: int | None = None
    medico_solicitante: str = Field(default="", max_length=150)
    unidade_saude_id: int | None = None
    unidade_psf: str = Field(default="", max_length=150)
    justificativa: str = Field(default="", max_length=500)

    @field_validator("justificativa")
    @classmethod
    def _valida_justificativa(cls, v: str) -> str:
        s = (v or "").strip()
        if not s or len(s) < 12:
            raise ValueError("A justificativa clínica é obrigatória e deve ter pelo menos 12 caracteres.")
        return s

    def itens_normalizados(self) -> dict[int, int]:
        """Une sigtap_ids (qtd=1) + itens, somando quantidades por sigtap_id.

        Política: múltiplas linhas do mesmo sigtap são somadas em linha
        única (ex.: 2 linhas qtd 1+2 viram 1 linha qtd 3, máx 99).
        """
        total: dict[int, int] = {}
        for sid in self.sigtap_ids or []:
            total[sid] = total.get(sid, 0) + 1
        for it in self.itens or []:
            total[it.sigtap_id] = total.get(it.sigtap_id, 0) + it.quantidade
        if not total:
            raise ValueError("Informe itens ou sigtap_ids com ao menos 1 exame")
        for sid, qtd in total.items():
            if qtd < 1 or qtd > 99:
                raise ValueError(f"Quantidade inválida p/ sigtap {sid}: {qtd} (1..99)")
        return total


class ItemOut(BaseModel):
    id: int
    solicitacao_id: int
    sigtap_id: int
    quantidade: int = 1
    status_auditoria: str = "pendente_conferencia"
    observacao: str = ""
    procedimento_codigo: str = ""
    procedimento_descricao: str = ""
    preparo_especifico: str = ""


class SolicMestreOut(BaseModel):
    id: int
    paciente_id: int
    paciente_nome: str = ""
    paciente_cpf: str = ""
    paciente_cns: str = ""
    paciente_prontuario: str = ""
    paciente_nascimento: str = ""
    data_agendada: date
    hora_agendada: str = "07:00"
    laboratorio_id: int
    laboratorio_nome: str = ""
    status: str = "agendado"
    agendado_por: str = ""
    origem_fila_id: int | None = None
    status_auditoria: str = "pendente_conferencia"
    observacao_laboratorio: str = ""
    medico_id: int | None = None
    medico_solicitante: str = ""
    unidade_saude_id: int | None = None
    unidade_psf: str = ""
    justificativa: str = ""
    coletado_em: datetime | None = None
    coletado_por: str = ""
    laudo_arquivo_id: int | None = None
    tem_laudo: bool = False
    preparo_instrucoes: list[str] = []
    itens: list[ItemOut] = []


# ---------- Comprovante de Agendamento ----------
class ComprovanteExameOut(BaseModel):
    id: int
    protocolo: str
    paciente_id: int
    paciente_nome: str
    paciente_cpf: str
    paciente_cns: str
    paciente_prontuario: str
    paciente_nascimento: str
    data_agendada: str
    hora_agendada: str
    laboratorio_id: int
    laboratorio_nome: str
    unidade_psf: str
    medico_solicitante: str
    justificativa: str
    status: str
    status_auditoria: str
    itens: list[ItemOut]
    jejum_horas: str
    preparo_instrucoes: list[str]
    orientacoes_gerais: list[str]
    emitido_em: str
    agendado_por: str
    qr_code_url: str | None = None
    codigo_curto: str | None = None
    numero_pedido: str | None = None
    exige_preparo: bool = True
    transporte: dict | None = None
    instrucoes_transporte: str = ""


# ---------- Pedidos de Ajuste / Laboratório ----------
class PedidoAjusteIn(BaseModel):
    tipo_ajuste: str = Field(default="modificacao_exames", max_length=50)
    justificativa: str = Field(min_length=5, max_length=1000)
    itens_propostos: list[dict] = Field(default_factory=list)


class RespostaAjusteIn(BaseModel):
    aprovado: bool
    resposta: str = Field(default="", max_length=1000)


class PedidoAjusteOut(BaseModel):
    id: int
    solicitacao_id: int
    laboratorio_id: int
    laboratorio_nome: str = ""
    paciente_nome: str = ""
    tipo_ajuste: str
    justificativa: str
    itens_propostos: list[dict] = []
    status: str
    solicitado_por: str
    resposta_secretaria: str
    analisado_por: str
    created_at: datetime
    analisado_em: datetime | None = None


# ---------- Faturamento BPA Consolidado ----------
class BpaConsolidadoItemOut(BaseModel):
    codigo: str
    descricao: str
    instrumento: str = "BPA-C"
    quantidade: int
    valor_unitario: float = 0.0
    valor_total: float = 0.0
    total_pacientes: int


class BpaResumoOut(BaseModel):
    competencia: str
    total_procedimentos: int
    total_exames: int
    total_pacientes: int
    valor_total: float
    itens: list[BpaConsolidadoItemOut]


# ---------- Auditoria ----------
class AuditoriaItemIn(BaseModel):
    item_id: int
    status: str = Field(
        pattern="^(pendente_conferencia|aprovado|divergente|aguardando_autorizacao_sec)$"
    )
    obs: str = Field(default="", max_length=500)


class AuditoriaIn(BaseModel):
    status_auditoria: str = Field(
        pattern="^(pendente_conferencia|aprovado|divergente|aguardando_autorizacao_sec)$"
    )
    observacao: str = Field(default="", max_length=500)
    itens: list[AuditoriaItemIn] = []


# ---------- Verificação de Duplicidade de Exames de Sangue ----------
class PedidoDuplicadoLabOut(BaseModel):
    id: int
    tipo: str  # "agendamento" ou "fila_psf" ou "solicitacao"
    data: str
    hora: str = ""
    status: str
    status_rotulo: str
    procedimento: str
    codigo_procedimento: str = ""
    sigtap_id: int | None = None
    profissional: str = ""
    unidade: str = ""
    laboratorio: str = ""
    link_visualizacao: str


class VerificarDuplicidadeLabOut(BaseModel):
    duplicado: bool
    pedido: PedidoDuplicadoLabOut | None = None


# ---------- Orçamento e Lotes de Liberação ----------
class LabOrcamentoIn(BaseModel):
    competencia: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    teto_mensal: float = Field(ge=0.0)
    observacoes: str = Field(default="", max_length=500)


class LabOrcamentoOut(BaseModel):
    id: int
    competencia: str
    teto_mensal: float
    valor_consumido: float
    saldo_disponivel: float
    percentual_consumido: float = 0.0
    observacoes: str = ""
    atualizado_por: str = ""
    created_at: datetime
    updated_at: datetime
    lotes_count: int = 0


class LabLotePreviaIn(BaseModel):
    competencia: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    laboratorio_id: int
    valor_limite: float = Field(gt=0.0)
    datas_agendamento: list[date] = Field(min_length=1)
    hora_padrao: str = Field(default="07:00", max_length=10)
    unidade_psf: str | None = None


class LabLotePreviaProcedimento(BaseModel):
    sigtap_id: int
    codigo: str
    descricao: str
    valor_unitario: float
    quantidade: int = 1
    valor_total: float


class LabLotePreviaItemOut(BaseModel):
    fila_id: int
    paciente_id: int
    paciente_nome: str
    paciente_cpf: str
    paciente_prontuario: str
    data_solicitacao: date
    prioridade: str
    unidade_psf: str
    medico_solicitante: str = ""
    justificativa: str = ""
    data_agendada_sugerida: date | None = None
    procedimentos: list[LabLotePreviaProcedimento] = []
    valor_total: float


class LabLoteDiaDistribuicaoOut(BaseModel):
    data: date
    pacientes_alocados: int
    valor_dia: float
    vagas_totais: int
    vagas_ocupadas: int
    vagas_livres: int
    vagas_restantes_apos: int
    deficit: int
    status: str  # "ok" | "deficit" | "sem_vaga_cadastrada"


class LabLotePreviaOut(BaseModel):
    competencia: str
    laboratorio_id: int
    laboratorio_nome: str
    valor_solicitado: float
    valor_consumido_estimado: float
    saldo_orcamento_atual: float
    saldo_orcamento_apos: float
    total_pacientes_contemplados: int
    total_exames_contemplados: int
    pacientes: list[LabLotePreviaItemOut]
    distribuicao_dias: list[LabLoteDiaDistribuicaoOut]
    tem_deficit_vagas: bool
    deficit_total_vagas: int
    bloqueado: bool
    motivos_bloqueio: list[str] = []
    dias_ignorados_sem_vaga: list[str] = []
    motivo_dias_ignorados: str = ""
    sugestao_acao: str = ""


class LabLoteConsolidarIn(BaseModel):
    competencia: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    laboratorio_id: int
    valor_solicitado: float = Field(gt=0.0)
    datas_agendamento: list[date] = Field(min_length=1)
    hora_padrao: str = Field(default="07:00", max_length=10)
    fila_ids_confirmados: list[int] | None = None
    observacoes: str = Field(default="", max_length=500)


class LabLoteItemOut(BaseModel):
    id: int
    lote_id: int
    fila_psf_id: int
    solicitacao_mestre_id: int
    paciente_id: int
    paciente_nome: str
    paciente_cpf: str
    paciente_prontuario: str
    data_agendada: date
    ordem_selecao: int
    prioridade_fila: str
    valor_consumido: float
    exames: list[dict] = []


class LabLoteOut(BaseModel):
    id: int
    codigo_lote: str
    orcamento_id: int | None
    competencia: str
    laboratorio_id: int
    laboratorio_nome: str
    valor_solicitado: float
    valor_consumido: float
    qtd_pacientes: int
    qtd_exames: int
    datas_alocacao: list[dict] = []
    status: str
    observacoes: str
    arquivo_comprovantes_nome: str = ""
    arquivo_excel_nome: str = ""
    tem_comprovantes: bool = False
    tem_excel: bool = False
    criado_por: str
    created_at: datetime
    itens: list[LabLoteItemOut] = []


# ==============================================================================
# SUBAGENTE 3: CONTRATOS, FATURAMENTO E FPO / SIA
# ==============================================================================

class LabContratoIn(BaseModel):
    laboratorio_id: int
    numero_contrato: str = Field(min_length=2, max_length=50)
    processo_licitatorio: str = Field(default="", max_length=50)
    objeto: str = Field(default="", max_length=500)
    data_inicio: date
    data_fim: date
    valor_total_contrato: float = Field(ge=0.0)
    valor_mensal_teto: float = Field(ge=0.0)
    cota_exames_mensal: int = Field(default=0, ge=0)
    status: str = Field(default="ativo", max_length=20)
    gestor_contrato: str = Field(default="", max_length=120)
    observacoes: str = Field(default="", max_length=500)


class LabContratoUpdateIn(BaseModel):
    numero_contrato: str | None = None
    processo_licitatorio: str | None = None
    objeto: str | None = None
    data_inicio: date | None = None
    data_fim: date | None = None
    valor_total_contrato: float | None = None
    valor_mensal_teto: float | None = None
    cota_exames_mensal: int | None = None
    status: str | None = None
    gestor_contrato: str | None = None
    observacoes: str | None = None


class LabContratoOut(BaseModel):
    id: int
    laboratorio_id: int
    laboratorio_nome: str = ""
    numero_contrato: str
    processo_licitatorio: str
    objeto: str
    data_inicio: date
    data_fim: date
    valor_total_contrato: float
    valor_mensal_teto: float
    valor_total_gasto: float
    cota_exames_mensal: int
    status: str
    gestor_contrato: str
    observacoes: str
    created_at: datetime
    updated_at: datetime
    # Métricas computadas em tempo real
    saldo_total_contrato: float = 0.0
    valor_gasto_mes_atual: float = 0.0
    saldo_mes_atual: float = 0.0
    percentual_consumido_total: float = 0.0
    percentual_consumido_mes: float = 0.0
    precos_customizados_count: int = 0


class LabContratosPainelOut(BaseModel):
    contratos: list[LabContratoOut] = []
    valor_total_todos_contratos: float = 0.0
    valor_total_gasto_global: float = 0.0
    valor_gasto_mes_corrente_global: float = 0.0
    saldo_total_global: float = 0.0
    total_contratos_ativos: int = 0


class LabContratoPrecoCustomizadoIn(BaseModel):
    sigtap_id: int
    valor_customizado: float = Field(gt=0.0)
    vigencia_inicio: date
    vigencia_fim: date | None = None
    justificativa: str = Field(default="", max_length=255)
    ativo: bool = True


class LabContratoPrecoCustomizadoOut(BaseModel):
    id: int
    contrato_id: int
    sigtap_id: int
    codigo_sigtap: str
    descricao_procedimento: str = ""
    valor_sigtap_padrao: float = 0.0
    valor_customizado: float
    vigencia_inicio: date
    vigencia_fim: date | None = None
    ativo: bool
    justificativa: str
    created_at: datetime


class LabFaturamentoItemRelatorioOut(BaseModel):
    sigtap_id: int
    codigo_procedimento: str
    descricao_procedimento: str
    quantidade_executada: int
    quantidade: int = 0
    valor_unitario: float
    valor_total: float
    origem_preco: str  # sigtap_padrao | contrato_custom


class LabFaturamentoRelatorioPrestadorOut(BaseModel):
    laboratorio_id: int
    laboratorio_nome: str
    cnes_laboratorio: str = ""
    responsavel_tecnico: str = ""
    horario_funcionamento: str = ""
    contrato_id: int | None
    numero_contrato: str
    competencia: str
    qtd_solicitacoes: int
    qtd_exames_total: int
    total_solicitacoes: int = 0
    total_exames: int = 0
    valor_total_bruto: float
    valor_glosas: float
    valor_total_liquido: float
    valor_total: float = 0.0
    valor_glosado: float = 0.0
    valor_aprovado: float = 0.0
    status_fechamento: str  # em_apuracao | aguardando_aprovacao | aprovado_secretaria | fechado
    liberado_visualizacao_lab: bool
    aprovado_por: str
    aprovado_em: datetime | None
    parecer_secretaria: str
    itens_agrupados: list[LabFaturamentoItemRelatorioOut] = []
    itens: list[LabFaturamentoItemRelatorioOut] = []


class LabAprovarFaturamentoIn(BaseModel):
    laboratorio_id: int
    competencia: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    liberar_visualizacao_lab: bool = True
    parecer: str = Field(default="", max_length=1000)


class LabFPOCompetenciaIn(BaseModel):
    laboratorio_id: int
    competencia: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    numero_fpo: str = Field(default="", max_length=50)
    cnes_prestador: str = Field(default="", max_length=20)
    teto_fisico_programado: int = Field(default=0, ge=0)
    teto_financeiro_programado: float = Field(default=0.0, ge=0.0)


class LabFPOItemIn(BaseModel):
    sigtap_id: int
    quantidade_orcada: int = Field(ge=0)
    valor_orcado: float = Field(ge=0.0)


class LabFPOItemOut(BaseModel):
    id: int
    fpo_id: int
    sigtap_id: int
    codigo_procedimento: str
    descricao_procedimento: str
    quantidade_orcada: int
    valor_orcado: float
    quantidade_aprovada: int
    valor_aprovado: float


class LabFPOCompetenciaOut(BaseModel):
    id: int
    laboratorio_id: int
    laboratorio_nome: str = ""
    contrato_id: int | None
    competencia: str
    cnes_prestador: str
    numero_fpo: str
    teto_fisico_programado: int
    teto_financeiro_programado: float
    total_fisico_executado: int
    total_financeiro_executado: float
    saldo_fisico: int = 0
    saldo_financeiro: float = 0.0
    status: str
    exportado_em: datetime | None
    criado_por: str
    created_at: datetime
    itens: list[LabFPOItemOut] = []


# ---------- Manejo de Agendamentos (Transferência / Status) ----------
class SolicMestreTransferirIn(BaseModel):
    nova_data: date
    novo_laboratorio_id: int | None = None
    motivo: str = Field(default="", max_length=255)


class SolicMestreStatusIn(BaseModel):
    status: str = Field(pattern="^(agendado|desativado|cancelado|realizado)$")
    motivo: str = Field(default="", max_length=255)


# ---------- BI / Custos de Exames por Paciente ----------
class PacienteGastoItemOut(BaseModel):
    solicitacao_id: int
    data_agendada: date
    laboratorio_nome: str
    procedimento_codigo: str
    procedimento_descricao: str
    valor_unitario: float
    origem_preco: str


class PacienteGastosResumoOut(BaseModel):
    paciente_id: int
    paciente_nome: str
    paciente_cpf: str
    paciente_cns: str
    total_gasto: float
    qtd_exames: int
    itens: list[PacienteGastoItemOut] = Field(default_factory=list)


class PacienteGastosGeraisItemOut(BaseModel):
    paciente_id: int
    paciente_nome: str
    paciente_cpf: str
    paciente_cns: str = ""
    total_gasto: float
    qtd_exames: int
    ultimo_exame_data: date | None = None


# ==============================================================================
# SCHEMAS: CONFERÊNCIA AUTOMATIZADA DE LAUDOS VIA PDF (SUBAGENTE 2)
# ==============================================================================

class LabExameItemMatch(BaseModel):
    codigo: str = ""
    descricao: str = ""
    encontrado: bool = False
    termo_identificado: str | None = None


class LabConferenciaResultadoOut(BaseModel):
    solicitacao_id: int
    arquivo_id: int
    nome_arquivo: str
    match_paciente_ok: bool
    paciente_criterio_match: str
    dados_paciente_encontrados: dict = Field(default_factory=dict)
    status_conferencia: str  # "aprovado_automatico" | "inconsistente"
    exames_solicitados: list[LabExameItemMatch] = Field(default_factory=list)
    exames_encontrados: list[str] = Field(default_factory=list)
    exames_faltantes: list[str] = Field(default_factory=list)
    exames_adicionais: list[str] = Field(default_factory=list)
    requer_justificativa: bool
    novo_status_solicitacao: str
    mensagem: str


class LabJustificativaIn(BaseModel):
    motivo_inconsistencia: str = Field(min_length=2, max_length=60)
    justificativa: str = Field(min_length=8, max_length=2000)


class LabDecisaoSecretariaIn(BaseModel):
    acao: str = Field(pattern="^(aprovar|rejeitar)$")
    parecer: str = Field(min_length=5, max_length=2000)


class LabAuditoriaItemOut(BaseModel):
    solicitacao_id: int
    codigo_solicitacao: str = ""
    paciente_id: int
    paciente_nome: str
    paciente_cpf: str = ""
    paciente_cns: str = ""
    paciente_prontuario: str = ""
    laboratorio_id: int
    laboratorio_nome: str = ""
    data_agendada: date
    status: str
    arquivo_id: int | None = None
    nome_arquivo: str | None = None
    conferencia_id: int | None = None
    match_paciente_ok: bool = False
    paciente_criterio_match: str = ""
    exames_faltantes: list[str] = Field(default_factory=list)
    exames_adicionais: list[str] = Field(default_factory=list)
    exames_encontrados: list[str] = Field(default_factory=list)
    justificativa_laboratorio: str | None = None
    motivo_inconsistencia: str | None = None
    justificado_por: str | None = None
    justificado_em: datetime | None = None
    parecer_secretaria: str | None = None
    unidade_psf: str | None = None





