import json
from datetime import date, datetime
from typing import Any
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ==========================================
# EMPRESAS FORNECEDORAS
# ==========================================
class EmpresaOxigenioIn(BaseModel):
    razao_social: str = Field(min_length=2, max_length=200)
    nome_fantasia: str = Field(default="", max_length=200)
    cnpj: str = Field(default="", max_length=20)
    telefone: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=120)
    contato_responsavel: str = Field(default="", max_length=150)
    endereco: str = Field(default="", max_length=255)
    servicos: list[str] = Field(default_factory=list)
    valor_unitario_10m3: float = Field(default=0.0, ge=0.0)
    valor_unitario_3m3: float = Field(default=0.0, ge=0.0)
    valor_unitario_1m3: float = Field(default=0.0, ge=0.0)
    valor_recarga_m3: float = Field(default=0.0, ge=0.0)
    locacao_mensal_concentrador: float = Field(default=0.0, ge=0.0)
    locacao_mensal_concentrador_5l: float = Field(default=0.0, ge=0.0)
    locacao_mensal_concentrador_10l: float = Field(default=0.0, ge=0.0)
    locacao_mensal_cpap: float = Field(default=0.0, ge=0.0)
    locacao_mensal_bipap: float = Field(default=0.0, ge=0.0)
    locacao_mensal_cilindro: float = Field(default=0.0, ge=0.0)
    observacoes: str = Field(default="")
    ativo: bool = Field(default=True)


class EmpresaOxigenioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    razao_social: str
    nome_fantasia: str
    cnpj: str
    telefone: str
    email: str
    contato_responsavel: str
    endereco: str
    servicos: list[str] = Field(default_factory=list)
    valor_unitario_10m3: float = 0.0
    valor_unitario_3m3: float = 0.0
    valor_unitario_1m3: float = 0.0
    valor_recarga_m3: float = 0.0
    locacao_mensal_concentrador: float = 0.0
    locacao_mensal_concentrador_5l: float = 0.0
    locacao_mensal_concentrador_10l: float = 0.0
    locacao_mensal_cpap: float = 0.0
    locacao_mensal_bipap: float = 0.0
    locacao_mensal_cilindro: float = 0.0
    observacoes: str
    ativo: bool
    created_at: datetime

    @field_validator("servicos", mode="before")
    @classmethod
    def parse_servicos(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return []
        if isinstance(v, list):
            return v
        return []


class MigrarEmpresaIn(BaseModel):
    empresa_origem_id: int
    empresa_destino_id: int
    transferir_pacientes: bool = True
    transferir_equipamentos: bool = True
    observacoes: str = Field(default="")


class MigrarEmpresaOut(BaseModel):
    sucesso: bool
    pacientes_transferidos: int
    equipamentos_transferidos: int
    mensagem: str


# ==========================================
# LICITAÇÕES E CONTRATOS
# ==========================================
class LicitacaoOxigenioIn(BaseModel):
    empresa_id: int
    numero_licitacao: str = Field(min_length=1, max_length=100)
    numero_contrato: str = Field(default="", max_length=100)
    ano: int = Field(default=2026)
    data_inicio: date
    data_fim: date
    objeto: str = Field(default="")
    qtd_contratada_10m3: int = Field(default=0, ge=0)
    qtd_contratada_3m3: int = Field(default=0, ge=0)
    qtd_contratada_1m3: int = Field(default=0, ge=0)
    valor_unitario_10m3: float = Field(default=0.0, ge=0.0)
    valor_unitario_3m3: float = Field(default=0.0, ge=0.0)
    valor_unitario_1m3: float = Field(default=0.0, ge=0.0)
    valor_recarga_m3: float = Field(default=0.0, ge=0.0)
    locacao_mensal_concentrador: float = Field(default=0.0, ge=0.0)
    locacao_mensal_concentrador_5l: float = Field(default=0.0, ge=0.0)
    locacao_mensal_concentrador_10l: float = Field(default=0.0, ge=0.0)
    locacao_mensal_cpap: float = Field(default=0.0, ge=0.0)
    locacao_mensal_bipap: float = Field(default=0.0, ge=0.0)
    locacao_mensal_cilindro: float = Field(default=0.0, ge=0.0)
    saldo_alerta_minimo_pct: int = Field(default=20, ge=1, le=100)
    ativo: bool = Field(default=True)
    observacoes: str = Field(default="")


class LicitacaoOxigenioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    empresa_id: int
    empresa_nome: str
    numero_licitacao: str
    numero_contrato: str
    ano: int
    data_inicio: date
    data_fim: date
    objeto: str
    qtd_contratada_10m3: int
    qtd_contratada_3m3: int
    qtd_contratada_1m3: int
    valor_unitario_10m3: float
    valor_unitario_3m3: float
    valor_unitario_1m3: float
    valor_recarga_m3: float = 0.0
    locacao_mensal_concentrador: float = 0.0
    locacao_mensal_concentrador_5l: float = 0.0
    locacao_mensal_concentrador_10l: float = 0.0
    locacao_mensal_cpap: float = 0.0
    locacao_mensal_bipap: float = 0.0
    locacao_mensal_cilindro: float = 0.0
    valor_total_contrato: float
    saldo_alerta_minimo_pct: int
    ativo: bool
    observacoes: str
    created_at: datetime

    # Saldos dinâmicos
    qtd_comprada_10m3: int = 0
    qtd_comprada_3m3: int = 0
    qtd_comprada_1m3: int = 0
    saldo_disponivel_10m3: int = 0
    saldo_disponivel_3m3: int = 0
    saldo_disponivel_1m3: int = 0
    alerta_esgotando: bool = False


# ==========================================
# COMPRAS / ENTRADAS DE OXIGÊNIO
# ==========================================
class EntradaCompraOxigenioIn(BaseModel):
    licitacao_id: int
    data_compra: date
    numero_nf: str = Field(default="", max_length=100)
    qtd_10m3: int = Field(default=0, ge=0)
    qtd_3m3: int = Field(default=0, ge=0)
    qtd_1m3: int = Field(default=0, ge=0)
    responsavel_recebimento: str = Field(default="", max_length=150)
    observacoes: str = Field(default="")


class EntradaCompraOxigenioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    licitacao_id: int
    empresa_id: int
    empresa_nome: str
    data_compra: date
    numero_nf: str
    qtd_10m3: int
    qtd_3m3: int
    qtd_1m3: int
    valor_total: float
    responsavel_recebimento: str
    observacoes: str
    created_at: datetime


# ==========================================
# EQUIPAMENTOS (CPAP, BiPAP, CONCENTRADOR)
# ==========================================
class EquipamentoRespiratorioIn(BaseModel):
    tipo: str = Field(pattern=r"^(CPAP|BiPAP|CONCENTRADOR|CONCENTRADOR_5L|CONCENTRADOR_10L)$")
    patrimonio: str = Field(default="", max_length=100)
    numero_serie: str = Field(default="", max_length=100)
    marca_modelo: str = Field(default="", max_length=150)
    propriedade: str = Field(default="PROPRIO", pattern=r"^(PROPRIO|LOCADO)$")
    empresa_id: int | None = None
    status: str = Field(default="DISPONIVEL", pattern=r"^(DISPONIVEL|EM_USO|MANUTENCAO|INATIVO_BAIXADO)$")
    data_aquisicao: date | None = None
    tensao_eletrica: str = Field(default="Bivolt", max_length=30)
    horas_uso: float = Field(default=0.0, ge=0.0)
    observacoes: str = Field(default="")
    ativo: bool = Field(default=True)


class EquipamentoRespiratorioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tipo: str
    patrimonio: str
    numero_serie: str
    marca_modelo: str
    propriedade: str
    empresa_id: int | None
    empresa_nome: str
    status: str
    data_aquisicao: date | None
    tensao_eletrica: str
    horas_uso: float
    observacoes: str
    ativo: bool
    created_at: datetime
    paciente_atual_nome: str | None = None
    emprestimo_id: int | None = None


class AlterarStatusEquipamentoIn(BaseModel):
    status: str = Field(pattern=r"^(DISPONIVEL|MANUTENCAO|INATIVO_BAIXADO|EM_USO)$")
    observacoes: str = Field(default="")
    desvincular_paciente: bool = Field(default=False)


# ==========================================
# EMPRÉSTIMOS / SAÍDAS
# ==========================================
class ItemEmprestimoIn(BaseModel):
    tipo_servico: str = Field(pattern=r"^(MAQUINA|OXIGENIO)$")
    equipamento_id: int | None = None
    tipo_equipamento: str | None = None
    equipamento_patrimonio: str | None = None
    tipo_cilindro: str | None = None
    finalidade_cilindro: str | None = None
    quantidade: int = Field(default=1, ge=1)
    posse_cilindro: str = Field(default="PROPRIO", pattern=r"^(PROPRIO|COMODATO)$")
    acompanha_equipamento: bool = Field(default=False)
    observacoes: str = Field(default="")


class ItemEmprestimoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    emprestimo_id: int
    tipo_servico: str
    equipamento_id: int | None = None
    tipo_equipamento: str | None = None
    equipamento_patrimonio: str | None = None
    equipamento_serie: str | None = None
    tipo_cilindro: str | None = None
    finalidade_cilindro: str | None = None
    quantidade: int = 1
    posse_cilindro: str = "PROPRIO"
    acompanha_equipamento: bool = False
    status: str = "ATIVO"
    observacoes: str = ""


class EmprestimoOxigenioIn(BaseModel):
    paciente_id: int
    tipo_servico: str = Field(pattern=r"^(MAQUINA|OXIGENIO)$")

    # Se MAQUINA:
    equipamento_id: int | None = None

    # Se OXIGÊNIO:
    tipo_cilindro: str | None = Field(default=None, pattern=r"^(10m3|3m3|1m3|)$")
    finalidade_cilindro: str | None = Field(
        default=None,
        pattern=r"^(FIXO_CONCENTRADOR|SEMANAL_CONCENTRADOR|TRANSPORTE_ESPECIAL|USO_CONTINUO|OUTRO|)$",
    )
    quantidade: int = Field(default=1, ge=1)
    posse_cilindro: str = Field(default="PROPRIO", pattern=r"^(PROPRIO|COMODATO)$")

    # Itens múltiplos na mesma operação:
    itens: list[ItemEmprestimoIn] = Field(default_factory=list)

    empresa_id: int | None = None
    licitacao_id: int | None = None

    data_instalacao: date
    # Se omitido e for SEMANAL_CONCENTRADOR, backend calcula automaticamente para +7 dias
    data_prevista_troca: date | None = None

    responsavel_retirada_nome: str = Field(default="", max_length=150)
    responsavel_retirada_cpf: str = Field(default="", max_length=20)
    responsavel_retirada_parentesco: str = Field(default="", max_length=50)

    medico_prescritor: str = Field(default="", max_length=150)
    cid_diagnostico: str = Field(default="", max_length=50)
    fluxo_oxigenio_litros_min: float | None = None
    pressao_cpap_bipap: str | None = None
    termo_assinado: bool = Field(default=False)
    observacoes: str = Field(default="")


class EmprestimoEditarIn(BaseModel):
    data_instalacao: date | None = None
    data_prevista_troca: date | None = None
    responsavel_retirada_nome: str | None = None
    responsavel_retirada_cpf: str | None = None
    responsavel_retirada_parentesco: str | None = None
    medico_prescritor: str | None = None
    cid_diagnostico: str | None = None
    fluxo_oxigenio_litros_min: float | None = None
    pressao_cpap_bipap: str | None = None
    termo_assinado: bool | None = None
    observacoes: str | None = None
    empresa_id: int | None = None


class InativarEmprestimoIn(BaseModel):
    data_devolucao: date
    motivo_inativacao: str = Field(
        pattern=r"^(OBITO|ALTA|TRANSFERENCIA|MELHORA_CLINICA|MUDANCA_TRATAMENTO|OUTRO)$"
    )
    observacoes: str = Field(default="")


class RegistrarTrocaIn(BaseModel):
    data_troca: date
    tipo_cilindro: str = Field(pattern=r"^(10m3|3m3|1m3)$")
    quantidade: int = Field(default=1, ge=1)
    proxima_data_troca: date | None = None  # padrão: data_troca + 7 dias
    responsavel_entrega: str = Field(default="", max_length=150)
    observacoes: str = Field(default="")


class EmprestimoOxigenioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    codigo_termo: str
    paciente_id: int
    paciente_nome: str
    paciente_cpf: str
    paciente_cns: str
    paciente_prontuario: str
    paciente_telefone: str
    paciente_endereco: str

    tipo_servico: str
    equipamento_id: int | None
    tipo_equipamento: str | None
    equipamento_patrimonio: str | None
    equipamento_serie: str | None

    tipo_cilindro: str | None
    finalidade_cilindro: str | None
    quantidade: int
    posse_cilindro: str = "PROPRIO"
    itens_resumo: str = ""
    itens: list[ItemEmprestimoOut] = Field(default_factory=list)

    empresa_id: int | None
    empresa_nome: str | None
    licitacao_id: int | None

    data_instalacao: date
    data_prevista_troca: date | None
    data_ultima_troca: date | None

    status: str
    data_devolucao: date | None
    motivo_inativacao: str | None

    responsavel_retirada_nome: str
    responsavel_retirada_cpf: str
    responsavel_retirada_parentesco: str

    medico_prescritor: str
    cid_diagnostico: str
    fluxo_oxigenio_litros_min: float | None
    pressao_cpap_bipap: str | None
    termo_assinado: bool

    observacoes: str
    created_at: datetime
    updated_at: datetime

    # Indicador de prazo de troca
    dias_para_troca: int | None = None
    status_prazo: str | None = None  # "EM_DIA", "TROCA_HOJE", "ATRASADO", "NAO_APLICAVEL"


class TrocaCilindroHistoricoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    emprestimo_id: int
    paciente_id: int
    paciente_nome: str
    data_troca: date
    tipo_cilindro: str
    quantidade: int
    empresa_id: int | None
    empresa_nome: str | None
    responsavel_entrega: str
    observacoes: str
    created_at: datetime


# ==========================================
# PAINEL DE CONTROLE / ESTATÍSTICAS
# ==========================================
class SaldoCilindroTipo(BaseModel):
    tipo: str  # "10m3", "3m3", "1m3"
    contratado: int
    comprado: int
    em_uso: int
    vazios: int = 0
    saldo_licitacao: int
    saldo_estoque_disponivel: int
    alerta_baixo: bool
    pct_saldo_licitacao: float


class EstoqueOxigenioResumoOut(BaseModel):
    saldos_cilindros: list[SaldoCilindroTipo]

    # Pacientes Ativos
    total_pacientes_ativos: int
    pacientes_ativos_oxigenio: int
    pacientes_ativos_maquinas: int
    pacientes_ativos_concentrador: int
    pacientes_ativos_concentrador_5l: int = 0
    pacientes_ativos_concentrador_10l: int = 0
    pacientes_ativos_cpap: int
    pacientes_ativos_bipap: int
    total_pacientes_inativos: int

    # Equipamentos
    total_equipamentos: int
    equipamentos_em_uso: int
    equipamentos_disponiveis: int
    equipamentos_manutencao: int

    # Próximas trocas semanais (alertas)
    trocas_pendentes_atrasadas: int
    trocas_pendentes_hoje: int
    trocas_proximos_7_dias: int

    # Consumo por mês para gráficos
    consumo_mensal: list[dict]
    consumo_por_empresa: list[dict]

    # Comodato e Cilindros Vazios
    saldos_comodato: list["ComodatoSaldoOut"] = Field(default_factory=list)
    total_cilindros_vazios_pendentes: int = 0
    vazios_10m3: int = 0
    vazios_3m3: int = 0
    vazios_1m3: int = 0
    total_cilindros_cheios_disponiveis: int = 0
    seed_habilitado: bool = False


# ==========================================
# REQUISIÇÃO AF (AUTORIZAÇÃO DE FORNECIMENTO)
# ==========================================
class ItemRequisicaoAF(BaseModel):
    tipo_cilindro: str
    descricao: str
    saldo_licitacao_atual: int
    consumo_medio_mensal: int
    previsao_dias_estoque: int
    quantidade_sugerida: int
    urgente: bool


class RequisicaoAFOut(BaseModel):
    codigo_requisicao: str
    data_geracao: date
    secretaria: str
    setor: str
    pacientes_ativos_dependentes: int
    itens: list[ItemRequisicaoAF]
    justificativa_tecnica: str
    solicitante_nome: str
    solicitante_cargo: str


# ==========================================
# CILINDROS VAZIOS E RECOLHIMENTO
# ==========================================
class CilindroVazioIn(BaseModel):
    paciente_id: int
    emprestimo_id: int | None = None
    empresa_id: int | None = None
    tipo_cilindro: str = Field(pattern=r"^(10m3|3m3|1m3)$")
    quantidade: int = Field(default=1, ge=1)
    posse: str = Field(default="PROPRIO", pattern=r"^(PROPRIO|COMODATO)$")
    observacoes: str = Field(default="")


class BaixaCilindroVazioIn(BaseModel):
    data_recolhimento: date
    responsavel_recolhimento: str = Field(min_length=2, max_length=150)
    observacoes: str = Field(default="")


class CilindroVazioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    paciente_id: int
    paciente_nome: str
    emprestimo_id: int | None
    empresa_id: int | None
    tipo_cilindro: str
    quantidade: int
    posse: str
    status: str
    data_geracao: date
    data_recolhimento: date | None
    responsavel_recolhimento: str | None
    observacoes: str
    created_at: datetime


# ==========================================
# COMODATO DE CILINDROS
# ==========================================
class ComodatoMovimentacaoIn(BaseModel):
    empresa_id: int
    tipo_movimentacao: str = Field(default="ENTRADA_COMODATO")
    tipo_cilindro: str = Field(default="10m3")
    quantidade: int = Field(default=1, ge=1)
    data_movimento: date | None = None
    data_movimentacao: date | None = None
    numero_documento: str = Field(default="", max_length=100)
    numero_nota_remessa: str = Field(default="", max_length=100)
    responsavel: str = Field(default="", max_length=150)
    observacoes: str = Field(default="")

    @field_validator("tipo_movimentacao", mode="before")
    @classmethod
    def normalizar_tipo_movimentacao(cls, v: Any) -> str:
        s = str(v or "").strip().upper()
        if "DEV" in s or "SAIDA" in s or "SAÍDA" in s or "EMPRESA" in s:
            return "DEVOLUCAO_EMPRESA"
        return "ENTRADA_COMODATO"

    @field_validator("tipo_cilindro", mode="before")
    @classmethod
    def normalizar_tipo_cilindro(cls, v: Any) -> str:
        s = str(v or "").strip().lower().replace(" ", "").replace("³", "3")
        if "10" in s:
            return "10m3"
        if "3" in s:
            return "3m3"
        if "1" in s:
            return "1m3"
        return s or "10m3"

    @model_validator(mode="after")
    def ajustar_aliases(self) -> "ComodatoMovimentacaoIn":
        if self.data_movimento is None:
            self.data_movimento = self.data_movimentacao or date.today()
        if not self.numero_documento and self.numero_nota_remessa:
            self.numero_documento = self.numero_nota_remessa
        return self


class ComodatoMovimentacaoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    empresa_id: int
    empresa_nome: str
    tipo_movimentacao: str
    tipo_cilindro: str
    quantidade: int
    data_movimento: date
    numero_documento: str
    responsavel: str
    observacoes: str
    created_at: datetime


class ComodatoSaldoOut(BaseModel):
    tipo_cilindro: str
    total_recebido: int
    total_devolvido: int
    saldo_em_comodato: int


# ==========================================
# RELATÓRIO DE FATURAMENTO E USO FINANCEIRO
# ==========================================
class ItemFaturamentoPaciente(BaseModel):
    paciente_nome: str
    paciente_cpf: str = ""
    prontuario: str = ""
    tipo_servico: str = ""
    item_descricao: str = ""
    tipo_custo: str = "FIXO_LOCACAO"  # VARIAVEL_RECARGA, FIXO_LOCACAO
    quantidade: int = 1
    valor_unitario: float = 0.0
    subtotal: float = 0.0
    empresa: str = ""
    data_instalacao: str = ""


class RelatorioFaturamentoOut(BaseModel):
    mes: int
    ano: int
    empresa_id: int | None
    empresa_nome: str | None
    periodo_formatado: str

    pacientes_ativos_total: int
    pacientes_ativos_oxigenio: int
    pacientes_ativos_concentrador: int
    pacientes_ativos_cpap: int
    pacientes_ativos_bipap: int

    recargas_10m3_qtd: int
    recargas_10m3_unit: float
    recargas_10m3_total: float

    recargas_3m3_qtd: int
    recargas_3m3_unit: float
    recargas_3m3_total: float

    recargas_1m3_qtd: int
    recargas_1m3_unit: float
    recargas_1m3_total: float

    subtotal_recargas: float

    locacao_concentradores_qtd: int
    locacao_concentradores_unit: float
    locacao_concentradores_total: float

    locacao_concentradores_5l_qtd: int = 0
    locacao_concentradores_5l_unit: float = 0.0
    locacao_concentradores_5l_total: float = 0.0

    locacao_concentradores_10l_qtd: int = 0
    locacao_concentradores_10l_unit: float = 0.0
    locacao_concentradores_10l_total: float = 0.0

    locacao_cpaps_qtd: int
    locacao_cpaps_unit: float
    locacao_cpaps_total: float

    locacao_bipaps_qtd: int
    locacao_bipaps_unit: float
    locacao_bipaps_total: float

    subtotal_locacoes: float
    total_geral_faturamento: float
    detalhes_pacientes: list[dict] = Field(default_factory=list)

    # Propriedades de conveniência consumidas pelo frontend e relatórios
    total_faturamento: float = 0.0
    total_custo_recargas: float = 0.0
    total_custo_locacoes: float = 0.0
    total_pacientes_atendidos: int = 0
    total_m3_oxigenio: float = 0.0
    total_maquinas_locadas: int = 0
    data_geracao: str = ""
    itens: list[ItemFaturamentoPaciente] = Field(default_factory=list)

    # Métricas de consumo mensal e comparativo da licitação
    contratado_licitacao_10m3: int = 0
    contratado_licitacao_3m3: int = 0
    contratado_licitacao_1m3: int = 0
    acumulado_consumido_10m3: int = 0
    acumulado_consumido_3m3: int = 0
    acumulado_consumido_1m3: int = 0
    saldo_restante_licitacao_10m3: int = 0
    saldo_restante_licitacao_3m3: int = 0
    saldo_restante_licitacao_1m3: int = 0
    cilindros_em_pacientes_10m3: int = 0
    cilindros_em_pacientes_3m3: int = 0
    cilindros_em_pacientes_1m3: int = 0
    comodato_saldo_10m3: int = 0
    comodato_saldo_3m3: int = 0
    comodato_saldo_1m3: int = 0

    # Histórico detalhado de abastecimentos no mês (conforme planilha de abastecimento)
    historico_abastecimentos: list[dict] = Field(default_factory=list)
    # Fechamento consolidado por fornecedora
    faturamento_por_empresa: list[dict] = Field(default_factory=list)
