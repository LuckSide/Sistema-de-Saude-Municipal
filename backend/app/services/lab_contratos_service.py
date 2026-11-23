"""Serviço de Gestão de Contratos de Laboratório e Precificação Customizada.

Subagente 3: Contratos, Faturamento e FPO/SIA
Garante governança orçamentária rigorosa, tetos contratuais e sobrescrita de
preços SIGTAP sob regras transacionais seguras (ACID).
"""

from datetime import date, datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import text
from sqlmodel import Session, func, or_, select

from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import (
    ItemSolic,
    LabContrato,
    LabContratoPrecoCustomizado,
    LabFechamentoFaturamento,
    LabLoteLiberacao,
    Laboratorio,
    SolicitacaoMestre,
)
from app.schemas.lab_fase6 import (
    LabContratoIn,
    LabContratoOut,
    LabContratoPrecoCustomizadoIn,
    LabContratoPrecoCustomizadoOut,
    LabContratoUpdateIn,
    LabContratosPainelOut,
)


# ==============================================================================
# 1. RESOLUÇÃO DE PREÇO (CONTRATO CUSTOMIZADO VS TABELA SIGTAP)
# ==============================================================================

def resolver_preco_procedimento(
    db: Session,
    laboratorio_id: int,
    sigtap_id: int,
    data_referencia: date,
    proc_padrao: Optional[SigtapProcedimento] = None,
) -> tuple[float, str, Optional[int]]:
    """Retorna (valor_unitario, origem_preco, contrato_id) com precedência do contrato ativo.
    
    Regra de Negócio:
    1. Busca contrato ativo do laboratório na data especificada.
    2. Se existir preço customizado ativo no contrato para o procedimento, usa esse valor.
    3. Caso contrário, aplica o valor ambulatorial padrão da Tabela Unificada SIGTAP (valor_sa).
    """
    if proc_padrao is None:
        proc_padrao = db.get(SigtapProcedimento, sigtap_id)

    # 1. Busca contrato ativo
    contrato = db.exec(
        select(LabContrato).where(
            LabContrato.laboratorio_id == laboratorio_id,
            LabContrato.status == "ativo",
            LabContrato.data_inicio <= data_referencia,
            LabContrato.data_fim >= data_referencia,
        )
    ).first()

    if contrato:
        # 2. Busca preço customizado
        preco_custom = db.exec(
            select(LabContratoPrecoCustomizado).where(
                LabContratoPrecoCustomizado.contrato_id == contrato.id,
                LabContratoPrecoCustomizado.sigtap_id == sigtap_id,
                LabContratoPrecoCustomizado.ativo == True,
                LabContratoPrecoCustomizado.vigencia_inicio <= data_referencia,
                or_(
                    LabContratoPrecoCustomizado.vigencia_fim == None,
                    LabContratoPrecoCustomizado.vigencia_fim >= data_referencia,
                ),
            )
        ).first()

        if preco_custom and preco_custom.valor_customizado > 0:
            return round(float(preco_custom.valor_customizado), 2), "contrato_custom", contrato.id

    # 3. Fallback: Valor Combinado Localmente ou Tabela SIGTAP Federal
    if proc_padrao:
        if getattr(proc_padrao, "valor_combinado", 0.0) > 0:
            return round(float(proc_padrao.valor_combinado), 2), "combinado_local", (contrato.id if contrato else None)
        val_sigtap = float(proc_padrao.valor_sa or proc_padrao.valor_sp or 0.0)
        return round(val_sigtap, 2), "sigtap_padrao", (contrato.id if contrato else None)

    return 0.0, "sigtap_padrao", (contrato.id if contrato else None)


# ==============================================================================
# 2. CRUD E MÉTRICAS FINANCEIRAS DE CONTRATOS
# ==============================================================================

def calcular_metricas_contrato(db: Session, contrato: LabContrato) -> LabContratoOut:
    """Calcula saldo total, gasto do mês corrente e percentuais de consumo em tempo real."""
    hoje = date.today()
    comp_atual = hoje.strftime("%Y-%m")
    inicio_mes = date(hoje.year, hoje.month, 1)

    # Consumo no mês corrente: soma dos itens executados/agendados neste laboratório/contrato
    gasto_mes = db.exec(
        select(
            func.coalesce(
                func.sum(ItemSolic.quantidade * ItemSolic.valor_unitario_aplicado),
                0.0,
            )
        )
        .join(SolicitacaoMestre, SolicitacaoMestre.id == ItemSolic.solicitacao_id)
        .where(
            SolicitacaoMestre.laboratorio_id == contrato.laboratorio_id,
            SolicitacaoMestre.data_agendada >= inicio_mes,
            SolicitacaoMestre.status != "cancelado",
        )
    ).one()
    valor_gasto_mes = round(float(gasto_mes or 0.0), 2)

    # Total histórico gasto pelo contrato
    total_gasto = db.exec(
        select(
            func.coalesce(
                func.sum(ItemSolic.quantidade * ItemSolic.valor_unitario_aplicado),
                0.0,
            )
        )
        .join(SolicitacaoMestre, SolicitacaoMestre.id == ItemSolic.solicitacao_id)
        .where(
            SolicitacaoMestre.laboratorio_id == contrato.laboratorio_id,
            SolicitacaoMestre.data_agendada >= contrato.data_inicio,
            SolicitacaoMestre.data_agendada <= contrato.data_fim,
            SolicitacaoMestre.status != "cancelado",
        )
    ).one()
    valor_total_gasto = round(float(total_gasto or 0.0), 2)

    # Atualiza no registro caso divirja
    if abs(contrato.valor_total_gasto - valor_total_gasto) > 0.01:
        contrato.valor_total_gasto = valor_total_gasto
        contrato.updated_at = datetime.utcnow()
        db.add(contrato)
        db.commit()
        db.refresh(contrato)

    lab = db.get(Laboratorio, contrato.laboratorio_id)
    lab_nome = lab.nome if lab else ""

    saldo_total = max(0.0, round(contrato.valor_total_contrato - valor_total_gasto, 2))
    saldo_mes = max(0.0, round(contrato.valor_mensal_teto - valor_gasto_mes, 2)) if contrato.valor_mensal_teto > 0 else 0.0

    pct_total = (
        round((valor_total_gasto / contrato.valor_total_contrato) * 100, 1)
        if contrato.valor_total_contrato > 0
        else 0.0
    )
    pct_mes = (
        round((valor_gasto_mes / contrato.valor_mensal_teto) * 100, 1)
        if contrato.valor_mensal_teto > 0
        else 0.0
    )

    qtd_precos = db.exec(
        select(func.count(LabContratoPrecoCustomizado.id)).where(
            LabContratoPrecoCustomizado.contrato_id == contrato.id,
            LabContratoPrecoCustomizado.ativo == True,
        )
    ).one() or 0

    return LabContratoOut(
        id=contrato.id or 0,
        laboratorio_id=contrato.laboratorio_id,
        laboratorio_nome=lab_nome,
        numero_contrato=contrato.numero_contrato,
        processo_licitatorio=contrato.processo_licitatorio,
        objeto=contrato.objeto,
        data_inicio=contrato.data_inicio,
        data_fim=contrato.data_fim,
        valor_total_contrato=float(contrato.valor_total_contrato),
        valor_mensal_teto=float(contrato.valor_mensal_teto),
        valor_total_gasto=float(valor_total_gasto),
        cota_exames_mensal=contrato.cota_exames_mensal,
        status=contrato.status,
        gestor_contrato=contrato.gestor_contrato,
        observacoes=contrato.observacoes,
        created_at=contrato.created_at,
        updated_at=contrato.updated_at,
        saldo_total_contrato=saldo_total,
        valor_gasto_mes_atual=valor_gasto_mes,
        saldo_mes_atual=saldo_mes,
        percentual_consumido_total=pct_total,
        percentual_consumido_mes=pct_mes,
        precos_customizados_count=qtd_precos,
    )


def listar_contratos_painel(db: Session, status: Optional[str] = None) -> LabContratosPainelOut:
    """Retorna a visão executiva e agregada de todos os contratos com o Município."""
    stmt = select(LabContrato).order_by(LabContrato.data_fim.desc(), LabContrato.id.desc())
    if status:
        stmt = stmt.where(LabContrato.status == status)

    contratos_db = db.exec(stmt).all()
    contratos_out = [calcular_metricas_contrato(db, c) for c in contratos_db]

    valor_total_todos = sum(c.valor_total_contrato for c in contratos_out)
    valor_total_gasto = sum(c.valor_total_gasto for c in contratos_out)
    valor_mes_global = sum(c.valor_gasto_mes_atual for c in contratos_out)
    saldo_global = max(0.0, round(valor_total_todos - valor_total_gasto, 2))
    ativos = sum(1 for c in contratos_out if c.status == "ativo")

    return LabContratosPainelOut(
        contratos=contratos_out,
        valor_total_todos_contratos=round(valor_total_todos, 2),
        valor_total_gasto_global=round(valor_total_gasto, 2),
        valor_gasto_mes_corrente_global=round(valor_mes_global, 2),
        saldo_total_global=round(saldo_global, 2),
        total_contratos_ativos=ativos,
    )


def criar_contrato(db: Session, dados: LabContratoIn) -> LabContratoOut:
    """Cadastra um novo contrato com validação de unicidade de número e datas."""
    lab = db.get(Laboratorio, dados.laboratorio_id)
    if not lab:
        raise HTTPException(404, "Laboratório não encontrado.")

    if dados.data_fim <= dados.data_inicio:
        raise HTTPException(400, "A data de término do contrato deve ser posterior à data de início.")

    existente = db.exec(
        select(LabContrato).where(LabContrato.numero_contrato == dados.numero_contrato.strip())
    ).first()
    if existente:
        raise HTTPException(409, f"Já existe um contrato cadastrado com o número '{dados.numero_contrato}'.")

    novo = LabContrato(
        laboratorio_id=dados.laboratorio_id,
        numero_contrato=dados.numero_contrato.strip(),
        processo_licitatorio=dados.processo_licitatorio.strip(),
        objeto=dados.objeto.strip(),
        data_inicio=dados.data_inicio,
        data_fim=dados.data_fim,
        valor_total_contrato=round(float(dados.valor_total_contrato), 2),
        valor_mensal_teto=round(float(dados.valor_mensal_teto), 2),
        valor_total_gasto=0.0,
        cota_exames_mensal=dados.cota_exames_mensal,
        status=dados.status,
        gestor_contrato=dados.gestor_contrato.strip(),
        observacoes=dados.observacoes.strip(),
    )
    db.add(novo)
    db.commit()
    db.refresh(novo)
    return calcular_metricas_contrato(db, novo)


def atualizar_contrato(db: Session, contrato_id: int, dados: LabContratoUpdateIn) -> LabContratoOut:
    """Atualiza dados e vigência do contrato."""
    contrato = db.get(LabContrato, contrato_id)
    if not contrato:
        raise HTTPException(404, "Contrato não encontrado.")

    if dados.numero_contrato is not None:
        num = dados.numero_contrato.strip()
        outro = db.exec(
            select(LabContrato).where(LabContrato.numero_contrato == num, LabContrato.id != contrato_id)
        ).first()
        if outro:
            raise HTTPException(409, f"O número de contrato '{num}' já está em uso por outro registro.")
        contrato.numero_contrato = num

    if dados.processo_licitatorio is not None:
        contrato.processo_licitatorio = dados.processo_licitatorio.strip()
    if dados.objeto is not None:
        contrato.objeto = dados.objeto.strip()
    if dados.data_inicio is not None:
        contrato.data_inicio = dados.data_inicio
    if dados.data_fim is not None:
        contrato.data_fim = dados.data_fim
    if dados.valor_total_contrato is not None:
        contrato.valor_total_contrato = round(float(dados.valor_total_contrato), 2)
    if dados.valor_mensal_teto is not None:
        contrato.valor_mensal_teto = round(float(dados.valor_mensal_teto), 2)
    if dados.cota_exames_mensal is not None:
        contrato.cota_exames_mensal = dados.cota_exames_mensal
    if dados.status is not None:
        contrato.status = dados.status
    if dados.gestor_contrato is not None:
        contrato.gestor_contrato = dados.gestor_contrato.strip()
    if dados.observacoes is not None:
        contrato.observacoes = dados.observacoes.strip()

    if contrato.data_fim <= contrato.data_inicio:
        raise HTTPException(400, "A data de término do contrato deve ser posterior à data de início.")

    contrato.updated_at = datetime.utcnow()
    db.add(contrato)
    db.commit()
    db.refresh(contrato)
    return calcular_metricas_contrato(db, contrato)


# ==============================================================================
# 3. TABELA DE PREÇOS CUSTOMIZADOS DO CONTRATO
# ==============================================================================

def listar_precos_contrato(db: Session, contrato_id: int) -> list[LabContratoPrecoCustomizadoOut]:
    """Lista todos os procedimentos com precificação customizada no contrato."""
    contrato = db.get(LabContrato, contrato_id)
    if not contrato:
        raise HTTPException(404, "Contrato não encontrado.")

    precos = db.exec(
        select(LabContratoPrecoCustomizado)
        .where(LabContratoPrecoCustomizado.contrato_id == contrato_id)
        .order_by(LabContratoPrecoCustomizado.codigo_sigtap)
    ).all()

    res: list[LabContratoPrecoCustomizadoOut] = []
    for p in precos:
        proc = db.get(SigtapProcedimento, p.sigtap_id)
        val_sigtap = float(proc.valor_sa or proc.valor_sp or 0.0) if proc else 0.0
        desc = proc.descricao if proc else ""

        res.append(
            LabContratoPrecoCustomizadoOut(
                id=p.id or 0,
                contrato_id=p.contrato_id,
                sigtap_id=p.sigtap_id,
                codigo_sigtap=p.codigo_sigtap,
                descricao_procedimento=desc,
                valor_sigtap_padrao=val_sigtap,
                valor_customizado=float(p.valor_customizado),
                vigencia_inicio=p.vigencia_inicio,
                vigencia_fim=p.vigencia_fim,
                ativo=p.ativo,
                justificativa=p.justificativa,
                created_at=p.created_at,
            )
        )
    return res


def definir_preco_customizado(
    db: Session, contrato_id: int, dados: LabContratoPrecoCustomizadoIn
) -> LabContratoPrecoCustomizadoOut:
    """Define ou atualiza o preço customizado de um procedimento para o contrato."""
    contrato = db.get(LabContrato, contrato_id)
    if not contrato:
        raise HTTPException(404, "Contrato não encontrado.")

    proc = db.get(SigtapProcedimento, dados.sigtap_id)
    if not proc:
        raise HTTPException(404, "Procedimento SIGTAP não encontrado.")

    existente = db.exec(
        select(LabContratoPrecoCustomizado).where(
            LabContratoPrecoCustomizado.contrato_id == contrato_id,
            LabContratoPrecoCustomizado.sigtap_id == dados.sigtap_id,
        )
    ).first()

    if not existente:
        existente = LabContratoPrecoCustomizado(
            contrato_id=contrato_id,
            sigtap_id=dados.sigtap_id,
            codigo_sigtap=proc.codigo,
            valor_customizado=round(float(dados.valor_customizado), 2),
            vigencia_inicio=dados.vigencia_inicio,
            vigencia_fim=dados.vigencia_fim,
            ativo=dados.ativo,
            justificativa=dados.justificativa.strip(),
        )
        db.add(existente)
    else:
        existente.valor_customizado = round(float(dados.valor_customizado), 2)
        existente.vigencia_inicio = dados.vigencia_inicio
        existente.vigencia_fim = dados.vigencia_fim
        existente.ativo = dados.ativo
        existente.justificativa = dados.justificativa.strip()
        db.add(existente)

    db.commit()
    db.refresh(existente)

    val_sigtap = float(proc.valor_sa or proc.valor_sp or 0.0)
    return LabContratoPrecoCustomizadoOut(
        id=existente.id or 0,
        contrato_id=existente.contrato_id,
        sigtap_id=existente.sigtap_id,
        codigo_sigtap=existente.codigo_sigtap,
        descricao_procedimento=proc.descricao,
        valor_sigtap_padrao=val_sigtap,
        valor_customizado=float(existente.valor_customizado),
        vigencia_inicio=existente.vigencia_inicio,
        vigencia_fim=existente.vigencia_fim,
        ativo=existente.ativo,
        justificativa=existente.justificativa,
        created_at=existente.created_at,
    )


def remover_preco_customizado(db: Session, contrato_id: int, preco_id: int) -> dict[str, bool]:
    """Exclui uma sobrescrita de preço, fazendo com que o exame retorne ao valor padrão SIGTAP."""
    preco = db.get(LabContratoPrecoCustomizado, preco_id)
    if not preco or preco.contrato_id != contrato_id:
        raise HTTPException(404, "Preço customizado não encontrado para este contrato.")

    db.delete(preco)
    db.commit()
    return {"ok": True}
