from datetime import date, datetime
from typing import List, Optional
from pydantic import BaseModel


def calcular_contagem_regressiva(validade: Optional[date]) -> tuple[str, str, Optional[int]]:
    """Retorna (status_validade, texto_formatado, dias_restantes).
    status_validade: 'VENCIDO' (fundo vermelho), 'PROXIMO_VENCIMENTO' (fundo amarelo), 'VALIDO', 'SEM_DATA'
    """
    if not validade:
        return "SEM_DATA", "Validade não informada", None

    hoje = date.today()
    dias = (validade - hoje).days

    if dias < 0:
        dias_vencido = abs(dias)
        if dias_vencido == 1:
            texto = "Vencido há 1 dia"
        elif dias_vencido < 30:
            texto = f"Vencido há {dias_vencido} dias"
        else:
            meses = dias_vencido // 30
            texto = f"Vencido há {meses} mês(es)" if meses > 1 else "Vencido há 1 mês"
        return "VENCIDO", texto, dias

    if dias == 0:
        return "PROXIMO_VENCIMENTO", "Vence hoje!", 0
    if dias == 1:
        return "PROXIMO_VENCIMENTO", "Vence amanhã!", 1
    if dias <= 30:
        return "PROXIMO_VENCIMENTO", f"Faltam {dias} dias", dias

    if dias <= 60:
        return "VALIDO", f"Vence em ~2 meses ({dias} dias)", dias

    meses = dias // 30
    if meses < 12:
        return "VALIDO", f"Vence em {meses} meses", dias

    anos = meses // 12
    return "VALIDO", f"Vence em {anos} ano(s)", dias


# --- Schemas de Medicamentos ---

class MedicamentoBase(BaseModel):
    codigo: str
    nome: str
    principio_ativo: Optional[str] = ""
    dosagem: Optional[str] = ""
    forma_farmaceutica: Optional[str] = "Comprimido"
    unidade_medida: Optional[str] = "comprimido"
    categoria: Optional[str] = "Básico / Atenção Primária"
    fabricante: Optional[str] = ""
    lote: Optional[str] = ""
    validade: Optional[date] = None
    estoque_atual: int = 0
    estoque_minimo: int = 10
    requer_receita: bool = True
    controlado: bool = False
    localizacao_prateleira: Optional[str] = ""
    observacoes: Optional[str] = ""
    ativo: bool = True


class MedicamentoCriar(MedicamentoBase):
    pass


class MedicamentoAtualizar(BaseModel):
    codigo: Optional[str] = None
    nome: Optional[str] = None
    principio_ativo: Optional[str] = None
    dosagem: Optional[str] = None
    forma_farmaceutica: Optional[str] = None
    unidade_medida: Optional[str] = None
    categoria: Optional[str] = None
    fabricante: Optional[str] = None
    lote: Optional[str] = None
    validade: Optional[date] = None
    estoque_minimo: Optional[int] = None
    requer_receita: Optional[bool] = None
    controlado: Optional[bool] = None
    localizacao_prateleira: Optional[str] = None
    observacoes: Optional[str] = None
    ativo: Optional[bool] = None


class MedicamentoOut(MedicamentoBase):
    id: int
    status_estoque: str = "NORMAL"  # "ZERADO", "CRITICO", "BAIXO", "NORMAL"
    status_validade: str = "VALIDO"  # "VENCIDO", "PROXIMO_VENCIMENTO", "VALIDO", "SEM_DATA"
    contagem_regressiva_texto: str = ""
    dias_para_vencer: Optional[int] = None
    created_at: datetime
    updated_at: datetime


# --- Schemas de Movimentação de Medicamentos ---

class MovimentacaoMedicamentoCriar(BaseModel):
    medicamento_id: int
    tipo: str  # ENTRADA_COMPRA, ENTRADA_DOACAO, SAIDA_DISPENSACAO, SAIDA_PERDA, SAIDA_TRANSFERENCIA
    quantidade: int
    lote: Optional[str] = ""
    validade: Optional[date] = None
    documento_referencia: Optional[str] = ""
    paciente_nome: Optional[str] = ""
    paciente_cpf: Optional[str] = ""
    paciente_cns: Optional[str] = ""
    prescritor_nome: Optional[str] = ""
    prescritor_crm: Optional[str] = ""
    motivo_descarte: Optional[str] = ""
    observacoes: Optional[str] = ""


class MovimentacaoMedicamentoOut(BaseModel):
    id: int
    medicamento_id: int
    medicamento_nome: str
    tipo: str
    quantidade: int
    lote: str
    validade: Optional[date]
    saldo_anterior: int
    saldo_posterior: int
    documento_referencia: str
    paciente_nome: str
    paciente_cpf: str
    paciente_cns: str
    prescritor_nome: str
    prescritor_crm: str
    motivo_descarte: str
    responsavel_usuario: str
    observacoes: str
    created_at: datetime


# --- Schemas de Insumos Internos ---

class InsumoInternoBase(BaseModel):
    codigo: str
    nome: str
    categoria: Optional[str] = "Material de Consumo"
    unidade_medida: Optional[str] = "unidade"
    lote: Optional[str] = ""
    validade: Optional[date] = None
    estoque_atual: int = 0
    estoque_minimo: int = 10
    local_armazenamento: Optional[str] = ""
    observacoes: Optional[str] = ""
    ativo: bool = True


class InsumoInternoCriar(InsumoInternoBase):
    pass


class InsumoInternoAtualizar(BaseModel):
    codigo: Optional[str] = None
    nome: Optional[str] = None
    categoria: Optional[str] = None
    unidade_medida: Optional[str] = None
    lote: Optional[str] = None
    validade: Optional[date] = None
    estoque_minimo: Optional[int] = None
    local_armazenamento: Optional[str] = None
    observacoes: Optional[str] = None
    ativo: Optional[bool] = None


class InsumoInternoOut(InsumoInternoBase):
    id: int
    status_estoque: str = "NORMAL"
    status_validade: str = "VALIDO"
    contagem_regressiva_texto: str = ""
    dias_para_vencer: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class MovimentacaoInsumoCriar(BaseModel):
    insumo_id: int
    tipo: str  # ENTRADA_COMPRA, ENTRADA_DOACAO, SAIDA_PSF, SAIDA_SETOR, SAIDA_DESCARTE
    quantidade: int
    unidade_destino: Optional[str] = ""
    responsavel_recebimento: Optional[str] = ""
    documento_referencia: Optional[str] = ""
    observacoes: Optional[str] = ""


class MovimentacaoInsumoOut(BaseModel):
    id: int
    insumo_id: int
    insumo_nome: str
    tipo: str
    quantidade: int
    saldo_anterior: int
    saldo_posterior: int
    unidade_destino: str
    responsavel_recebimento: str
    documento_referencia: str
    responsavel_usuario: str
    observacoes: str
    created_at: datetime


# --- Schemas de Links Públicos e Consulta Externa ---

class FarmaciaLinkPublicoCriar(BaseModel):
    titulo: Optional[str] = "Disponibilidade de Medicamentos"
    tipo_perfil: str = "paciente"  # "paciente" ou "tv"
    mostrar_quantidade: bool = False
    filtro_tipo: str = "todos"  # "todos", "especificos", "categoria"
    medicamentos_ids: Optional[List[int]] = []
    categoria_filtro: Optional[str] = ""
    tempo_atualizacao_segundos: int = 30
    mensagem_rodape: Optional[str] = "Secretaria Municipal de Saúde · Guapé / MG"


class FarmaciaLinkPublicoOut(BaseModel):
    id: int
    token: str
    url_publica: str
    titulo: str
    tipo_perfil: str
    mostrar_quantidade: bool
    filtro_tipo: str
    medicamentos_ids: List[int]
    categoria_filtro: str
    tempo_atualizacao_segundos: int
    mensagem_rodape: str
    ativo: bool
    visualizacoes_count: int
    created_by: str
    created_at: datetime


class ItemDisponibilidadePublicaOut(BaseModel):
    id: int
    nome: str
    principio_ativo: str
    dosagem: str
    forma_farmaceutica: str
    categoria: str
    disponivel: bool
    status_rotulo: str  # "Disponível" ou "Indisponível (Em Falta)"
    requer_receita: bool
    # Quantidade numérica é estritamente OMITIDA no Modo Paciente; só enviada se o link tiver autorização (Modo TV)
    quantidade_disponivel: Optional[int] = None


class FarmaciaPainelPublicoResponse(BaseModel):
    token: str
    titulo: str
    tipo_perfil: str  # "paciente" ou "tv"
    mostrar_quantidade: bool
    tempo_atualizacao_segundos: int
    mensagem_rodape: str
    total_itens: int
    total_disponiveis: int
    total_indisponiveis: int
    itens: List[ItemDisponibilidadePublicaOut]
    horario_servidor: datetime


# --- Schema de Resumo / Dashboard do Módulo ---

class FarmaciaResumoCardsOut(BaseModel):
    total_medicamentos: int
    total_estoque_baixo: int
    total_estoque_zerado: int
    total_proximos_vencimento: int
    total_vencidos: int
    total_dispensacoes_mes: int
    total_entradas_mes: int
    total_insumos: int
    total_insumos_baixo: int
