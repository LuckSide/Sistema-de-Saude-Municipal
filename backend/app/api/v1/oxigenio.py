import json
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import desc, func, or_
from sqlmodel import Session, select

from app.api.v1.auth import get_current_user
from app.db.session import engine
from app.models.oxigenio import (
    CilindroComodatoMovimentacao,
    CilindroVazioRecolhimento,
    EmprestimoOxigenio,
    EmpresaOxigenio,
    EntradaCompraOxigenio,
    EquipamentoRespiratorio,
    ItemEmprestimoOxigenio,
    LicitacaoContratoOxigenio,
    TrocaCilindroHistorico,
)
from app.models.tfd import Paciente
from app.models.user import User
from app.schemas.oxigenio import (
    AlterarStatusEquipamentoIn,
    BaixaCilindroVazioIn,
    CilindroVazioIn,
    CilindroVazioOut,
    ComodatoMovimentacaoIn,
    ComodatoMovimentacaoOut,
    ComodatoSaldoOut,
    EmprestimoEditarIn,
    EmprestimoOxigenioIn,
    EmprestimoOxigenioOut,
    EmpresaOxigenioIn,
    EmpresaOxigenioOut,
    EntradaCompraOxigenioIn,
    EntradaCompraOxigenioOut,
    EquipamentoRespiratorioIn,
    EquipamentoRespiratorioOut,
    EstoqueOxigenioResumoOut,
    InativarEmprestimoIn,
    ItemEmprestimoIn,
    ItemEmprestimoOut,
    ItemFaturamentoPaciente,
    ItemRequisicaoAF,
    LicitacaoOxigenioIn,
    LicitacaoOxigenioOut,
    MigrarEmpresaIn,
    MigrarEmpresaOut,
    RegistrarTrocaIn,
    RelatorioFaturamentoOut,
    RequisicaoAFOut,
    SaldoCilindroTipo,
    TrocaCilindroHistoricoOut,
)
from app.services.export_xlsx import resposta_xlsx
from app.services.permissoes import need_any_perm, need_perm

router = APIRouter()


def get_db():
    with Session(engine) as session:
        yield session


# ==============================================================================
# 1. EMPRESAS FORNECEDORAS
# ==============================================================================

@router.get("/empresas", response_model=list[EmpresaOxigenioOut])
def listar_empresas(
    q: str = "",
    servico: str = "",
    apenas_ativas: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(need_any_perm("oxigenio_empresas", "oxigenio", "usuarios")),
):
    stmt = select(EmpresaOxigenio).order_by(EmpresaOxigenio.razao_social)
    if apenas_ativas:
        stmt = stmt.where(EmpresaOxigenio.ativo == True)
    if q.strip():
        t = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(EmpresaOxigenio.razao_social).like(t),
                func.lower(EmpresaOxigenio.nome_fantasia).like(t),
                func.lower(EmpresaOxigenio.cnpj).like(t),
            )
        )
    empresas = db.exec(stmt).all()
    resultado = []
    for emp in empresas:
        try:
            servs = json.loads(emp.servicos or "[]")
        except Exception:
            servs = []
        if servico and servico not in servs:
            continue
        item = EmpresaOxigenioOut.model_validate(emp)
        item.servicos = servs
        resultado.append(item)
    return resultado


@router.post("/empresas", response_model=EmpresaOxigenioOut, status_code=201)
def criar_empresa(
    data: EmpresaOxigenioIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_empresas", "criar")),
):
    emp = EmpresaOxigenio(
        razao_social=data.razao_social.strip(),
        nome_fantasia=data.nome_fantasia.strip(),
        cnpj=data.cnpj.strip(),
        telefone=data.telefone.strip(),
        email=data.email.strip(),
        contato_responsavel=data.contato_responsavel.strip(),
        endereco=data.endereco.strip(),
        servicos=json.dumps(data.servicos),
        valor_unitario_10m3=data.valor_unitario_10m3,
        valor_unitario_3m3=data.valor_unitario_3m3,
        valor_unitario_1m3=data.valor_unitario_1m3,
        valor_recarga_m3=data.valor_recarga_m3,
        locacao_mensal_concentrador=data.locacao_mensal_concentrador or data.locacao_mensal_concentrador_5l,
        locacao_mensal_concentrador_5l=data.locacao_mensal_concentrador_5l or data.locacao_mensal_concentrador,
        locacao_mensal_concentrador_10l=data.locacao_mensal_concentrador_10l,
        locacao_mensal_cpap=data.locacao_mensal_cpap,
        locacao_mensal_bipap=data.locacao_mensal_bipap,
        locacao_mensal_cilindro=data.locacao_mensal_cilindro,
        observacoes=data.observacoes.strip(),
        ativo=data.ativo,
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)
    item = EmpresaOxigenioOut.model_validate(emp)
    item.servicos = data.servicos
    return item


@router.get("/empresas/{empresa_id}", response_model=EmpresaOxigenioOut)
def obter_empresa(
    empresa_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(need_any_perm("oxigenio_empresas", "oxigenio", "usuarios")),
):
    emp = db.get(EmpresaOxigenio, empresa_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")
    item = EmpresaOxigenioOut.model_validate(emp)
    try:
        item.servicos = json.loads(emp.servicos or "[]")
    except Exception:
        item.servicos = []
    return item


@router.put("/empresas/{empresa_id}", response_model=EmpresaOxigenioOut)
def atualizar_empresa(
    empresa_id: int,
    data: EmpresaOxigenioIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_empresas", "editar")),
):
    emp = db.get(EmpresaOxigenio, empresa_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")

    emp.razao_social = data.razao_social.strip()
    emp.nome_fantasia = data.nome_fantasia.strip()
    emp.cnpj = data.cnpj.strip()
    emp.telefone = data.telefone.strip()
    emp.email = data.email.strip()
    emp.contato_responsavel = data.contato_responsavel.strip()
    emp.endereco = data.endereco.strip()
    emp.servicos = json.dumps(data.servicos)
    emp.valor_unitario_10m3 = data.valor_unitario_10m3
    emp.valor_unitario_3m3 = data.valor_unitario_3m3
    emp.valor_unitario_1m3 = data.valor_unitario_1m3
    emp.valor_recarga_m3 = data.valor_recarga_m3
    emp.locacao_mensal_concentrador = data.locacao_mensal_concentrador or data.locacao_mensal_concentrador_5l
    emp.locacao_mensal_concentrador_5l = data.locacao_mensal_concentrador_5l or data.locacao_mensal_concentrador
    emp.locacao_mensal_concentrador_10l = data.locacao_mensal_concentrador_10l
    emp.locacao_mensal_cpap = data.locacao_mensal_cpap
    emp.locacao_mensal_bipap = data.locacao_mensal_bipap
    emp.locacao_mensal_cilindro = data.locacao_mensal_cilindro
    emp.observacoes = data.observacoes.strip()
    emp.ativo = data.ativo

    db.add(emp)
    db.commit()
    db.refresh(emp)

    item = EmpresaOxigenioOut.model_validate(emp)
    item.servicos = data.servicos
    return item


@router.delete("/empresas/{empresa_id}")
def excluir_empresa(
    empresa_id: int,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_empresas", "excluir")),
):
    emp = db.get(EmpresaOxigenio, empresa_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")

    # Se possui licitações ou equipamentos vinculados, inativa em vez de remover
    tem_lic = db.exec(select(LicitacaoContratoOxigenio).where(LicitacaoContratoOxigenio.empresa_id == empresa_id)).first()
    tem_eq = db.exec(select(EquipamentoRespiratorio).where(EquipamentoRespiratorio.empresa_id == empresa_id)).first()
    if tem_lic or tem_eq:
        emp.ativo = False
        db.add(emp)
        db.commit()
        return {"ok": True, "mensagem": "Empresa inativada com sucesso pois possui vínculos contratuais/equipamentos."}

    db.delete(emp)
    db.commit()
    return {"ok": True, "mensagem": "Empresa excluída com sucesso."}


@router.post("/empresas/migrar", response_model=MigrarEmpresaOut)
def migrar_empresa_contratada(
    data: MigrarEmpresaIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_empresas", "editar")),
):
    if data.empresa_origem_id == data.empresa_destino_id:
        raise HTTPException(status_code=400, detail="A empresa de origem e destino não podem ser as mesmas.")

    emp_origem = db.get(EmpresaOxigenio, data.empresa_origem_id)
    if not emp_origem:
        raise HTTPException(status_code=404, detail="Empresa de origem não encontrada.")

    emp_destino = db.get(EmpresaOxigenio, data.empresa_destino_id)
    if not emp_destino:
        raise HTTPException(status_code=404, detail="Empresa de destino não encontrada.")
    if not emp_destino.ativo:
        raise HTTPException(status_code=400, detail="A empresa de destino selecionada está inativa.")

    nome_origem = emp_origem.nome_fantasia or emp_origem.razao_social
    nome_destino = emp_destino.nome_fantasia or emp_destino.razao_social
    hoje_str = date.today().strftime("%d/%m/%Y")

    pacs_transferidos = 0
    eqs_transferidos = 0

    if data.transferir_pacientes:
        emprestimos_ativos = db.exec(
            select(EmprestimoOxigenio).where(
                EmprestimoOxigenio.empresa_id == data.empresa_origem_id,
                EmprestimoOxigenio.status == "ATIVO",
            )
        ).all()
        for emp in emprestimos_ativos:
            emp.empresa_id = emp_destino.id
            emp.empresa_nome = nome_destino
            nota = f"[Migração de Fornecedor em {hoje_str} por {ator.nome}]: Transferido de '{nome_origem}' para '{nome_destino}'."
            if data.observacoes.strip():
                nota += f" Motivo: {data.observacoes.strip()}"
            emp.observacoes = (emp.observacoes + "\n" + nota).strip() if emp.observacoes else nota
            emp.updated_at = datetime.utcnow()
            db.add(emp)
            pacs_transferidos += 1

    if data.transferir_equipamentos:
        equipamentos = db.exec(
            select(EquipamentoRespiratorio).where(
                EquipamentoRespiratorio.empresa_id == data.empresa_origem_id,
            )
        ).all()
        for eq in equipamentos:
            eq.empresa_id = emp_destino.id
            eq.empresa_nome = nome_destino
            nota_eq = f"[Migração Fornecedor em {hoje_str}]: Fornecedor anterior: {nome_origem}."
            eq.observacoes = (eq.observacoes + "\n" + nota_eq).strip() if eq.observacoes else nota_eq
            db.add(eq)
            eqs_transferidos += 1

    db.commit()

    return MigrarEmpresaOut(
        sucesso=True,
        pacientes_transferidos=pacs_transferidos,
        equipamentos_transferidos=eqs_transferidos,
        mensagem=f"Migração global concluída com sucesso! {pacs_transferidos} paciente(s)/empréstimo(s) e {eqs_transferidos} equipamento(s) transferidos de '{nome_origem}' para '{nome_destino}'.",
    )


# ==============================================================================
# 2. LICITAÇÕES E CONTRATOS (SALDOS E COMPRAS)
# ==============================================================================

@router.get("/licitacoes", response_model=list[LicitacaoOxigenioOut])
def listar_licitacoes(
    empresa_id: int | None = None,
    ano: int | None = None,
    apenas_ativas: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(need_any_perm("oxigenio_estoque", "oxigenio", "usuarios")),
):
    stmt = select(LicitacaoContratoOxigenio).order_by(desc(LicitacaoContratoOxigenio.ano), desc(LicitacaoContratoOxigenio.id))
    if empresa_id:
        stmt = stmt.where(LicitacaoContratoOxigenio.empresa_id == empresa_id)
    if ano:
        stmt = stmt.where(LicitacaoContratoOxigenio.ano == ano)
    if apenas_ativas:
        stmt = stmt.where(LicitacaoContratoOxigenio.ativo == True)

    lics = db.exec(stmt).all()
    resultado: list[LicitacaoOxigenioOut] = []

    for lic in lics:
        # Soma entradas/compras já realizadas vinculadas a esta licitação
        compras = db.exec(
            select(
                func.coalesce(func.sum(EntradaCompraOxigenio.qtd_10m3), 0),
                func.coalesce(func.sum(EntradaCompraOxigenio.qtd_3m3), 0),
                func.coalesce(func.sum(EntradaCompraOxigenio.qtd_1m3), 0),
            ).where(EntradaCompraOxigenio.licitacao_id == lic.id)
        ).first()

        c_10 = int(compras[0]) if compras else 0
        c_3 = int(compras[1]) if compras else 0
        c_1 = int(compras[2]) if compras else 0

        saldo_10 = max(0, lic.qtd_contratada_10m3 - c_10)
        saldo_3 = max(0, lic.qtd_contratada_3m3 - c_3)
        saldo_1 = max(0, lic.qtd_contratada_1m3 - c_1)

        pct_10 = (saldo_10 / lic.qtd_contratada_10m3 * 100) if lic.qtd_contratada_10m3 > 0 else 100
        pct_3 = (saldo_3 / lic.qtd_contratada_3m3 * 100) if lic.qtd_contratada_3m3 > 0 else 100
        pct_1 = (saldo_1 / lic.qtd_contratada_1m3 * 100) if lic.qtd_contratada_1m3 > 0 else 100

        alerta = (pct_10 <= lic.saldo_alerta_minimo_pct) or (pct_3 <= lic.saldo_alerta_minimo_pct) or (pct_1 <= lic.saldo_alerta_minimo_pct)

        item = LicitacaoOxigenioOut.model_validate(lic)
        item.qtd_comprada_10m3 = c_10
        item.qtd_comprada_3m3 = c_3
        item.qtd_comprada_1m3 = c_1
        item.saldo_disponivel_10m3 = saldo_10
        item.saldo_disponivel_3m3 = saldo_3
        item.saldo_disponivel_1m3 = saldo_1
        item.alerta_esgotando = alerta

        resultado.append(item)

    return resultado


@router.post("/licitacoes", response_model=LicitacaoOxigenioOut, status_code=201)
def criar_licitacao(
    data: LicitacaoOxigenioIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_estoque", "criar")),
):
    emp = db.get(EmpresaOxigenio, data.empresa_id)
    if not emp:
        raise HTTPException(status_code=400, detail="Empresa fornecedora não encontrada.")

    val_10 = data.valor_unitario_10m3 if data.valor_unitario_10m3 > 0 else getattr(emp, "valor_unitario_10m3", 0.0)
    val_3 = data.valor_unitario_3m3 if data.valor_unitario_3m3 > 0 else getattr(emp, "valor_unitario_3m3", 0.0)
    val_1 = data.valor_unitario_1m3 if data.valor_unitario_1m3 > 0 else getattr(emp, "valor_unitario_1m3", 0.0)
    val_rec = data.valor_recarga_m3 if data.valor_recarga_m3 > 0 else getattr(emp, "valor_recarga_m3", 0.0)
    loc_conc = data.locacao_mensal_concentrador if data.locacao_mensal_concentrador > 0 else getattr(emp, "locacao_mensal_concentrador", 0.0)
    loc_conc_5l = data.locacao_mensal_concentrador_5l if data.locacao_mensal_concentrador_5l > 0 else getattr(emp, "locacao_mensal_concentrador_5l", loc_conc)
    loc_conc_10l = data.locacao_mensal_concentrador_10l if data.locacao_mensal_concentrador_10l > 0 else getattr(emp, "locacao_mensal_concentrador_10l", 0.0)
    loc_cpap = data.locacao_mensal_cpap if data.locacao_mensal_cpap > 0 else getattr(emp, "locacao_mensal_cpap", 0.0)
    loc_bipap = data.locacao_mensal_bipap if data.locacao_mensal_bipap > 0 else getattr(emp, "locacao_mensal_bipap", 0.0)
    loc_cil = data.locacao_mensal_cilindro if data.locacao_mensal_cilindro > 0 else getattr(emp, "locacao_mensal_cilindro", 0.0)

    total_val = (
        (data.qtd_contratada_10m3 * val_10)
        + (data.qtd_contratada_3m3 * val_3)
        + (data.qtd_contratada_1m3 * val_1)
    )

    lic = LicitacaoContratoOxigenio(
        empresa_id=emp.id,
        empresa_nome=emp.nome_fantasia or emp.razao_social,
        numero_licitacao=data.numero_licitacao.strip(),
        numero_contrato=data.numero_contrato.strip(),
        ano=data.ano,
        data_inicio=data.data_inicio,
        data_fim=data.data_fim,
        objeto=data.objeto.strip(),
        qtd_contratada_10m3=data.qtd_contratada_10m3,
        qtd_contratada_3m3=data.qtd_contratada_3m3,
        qtd_contratada_1m3=data.qtd_contratada_1m3,
        valor_unitario_10m3=val_10,
        valor_unitario_3m3=val_3,
        valor_unitario_1m3=val_1,
        valor_recarga_m3=val_rec,
        locacao_mensal_concentrador=loc_conc or loc_conc_5l,
        locacao_mensal_concentrador_5l=loc_conc_5l or loc_conc,
        locacao_mensal_concentrador_10l=loc_conc_10l,
        locacao_mensal_cpap=loc_cpap,
        locacao_mensal_bipap=loc_bipap,
        locacao_mensal_cilindro=loc_cil,
        valor_total_contrato=total_val,
        saldo_alerta_minimo_pct=data.saldo_alerta_minimo_pct,
        ativo=data.ativo,
        observacoes=data.observacoes.strip(),
    )
    db.add(lic)
    db.commit()
    db.refresh(lic)

    item = LicitacaoOxigenioOut.model_validate(lic)
    item.saldo_disponivel_10m3 = lic.qtd_contratada_10m3
    item.saldo_disponivel_3m3 = lic.qtd_contratada_3m3
    item.saldo_disponivel_1m3 = lic.qtd_contratada_1m3
    return item


@router.put("/licitacoes/{licitacao_id}", response_model=LicitacaoOxigenioOut)
def atualizar_licitacao(
    licitacao_id: int,
    data: LicitacaoOxigenioIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_estoque", "editar")),
):
    lic = db.get(LicitacaoContratoOxigenio, licitacao_id)
    if not lic:
        raise HTTPException(status_code=404, detail="Licitação não encontrada.")

    emp = db.get(EmpresaOxigenio, data.empresa_id)
    if not emp:
        raise HTTPException(status_code=400, detail="Empresa fornecedora não encontrada.")

    val_10 = data.valor_unitario_10m3 if data.valor_unitario_10m3 > 0 else getattr(emp, "valor_unitario_10m3", 0.0)
    val_3 = data.valor_unitario_3m3 if data.valor_unitario_3m3 > 0 else getattr(emp, "valor_unitario_3m3", 0.0)
    val_1 = data.valor_unitario_1m3 if data.valor_unitario_1m3 > 0 else getattr(emp, "valor_unitario_1m3", 0.0)
    val_rec = data.valor_recarga_m3 if data.valor_recarga_m3 > 0 else getattr(emp, "valor_recarga_m3", 0.0)
    loc_conc = data.locacao_mensal_concentrador if data.locacao_mensal_concentrador > 0 else getattr(emp, "locacao_mensal_concentrador", 0.0)
    loc_conc_5l = data.locacao_mensal_concentrador_5l if data.locacao_mensal_concentrador_5l > 0 else getattr(emp, "locacao_mensal_concentrador_5l", loc_conc)
    loc_conc_10l = data.locacao_mensal_concentrador_10l if data.locacao_mensal_concentrador_10l > 0 else getattr(emp, "locacao_mensal_concentrador_10l", 0.0)
    loc_cpap = data.locacao_mensal_cpap if data.locacao_mensal_cpap > 0 else getattr(emp, "locacao_mensal_cpap", 0.0)
    loc_bipap = data.locacao_mensal_bipap if data.locacao_mensal_bipap > 0 else getattr(emp, "locacao_mensal_bipap", 0.0)
    loc_cil = data.locacao_mensal_cilindro if data.locacao_mensal_cilindro > 0 else getattr(emp, "locacao_mensal_cilindro", 0.0)

    total_val = (
        (data.qtd_contratada_10m3 * val_10)
        + (data.qtd_contratada_3m3 * val_3)
        + (data.qtd_contratada_1m3 * val_1)
    )

    lic.empresa_id = emp.id
    lic.empresa_nome = emp.nome_fantasia or emp.razao_social
    lic.numero_licitacao = data.numero_licitacao.strip()
    lic.numero_contrato = data.numero_contrato.strip()
    lic.ano = data.ano
    lic.data_inicio = data.data_inicio
    lic.data_fim = data.data_fim
    lic.objeto = data.objeto.strip()
    lic.qtd_contratada_10m3 = data.qtd_contratada_10m3
    lic.qtd_contratada_3m3 = data.qtd_contratada_3m3
    lic.qtd_contratada_1m3 = data.qtd_contratada_1m3
    lic.valor_unitario_10m3 = val_10
    lic.valor_unitario_3m3 = val_3
    lic.valor_unitario_1m3 = val_1
    lic.valor_recarga_m3 = val_rec
    lic.locacao_mensal_concentrador = loc_conc or loc_conc_5l
    lic.locacao_mensal_concentrador_5l = loc_conc_5l or loc_conc
    lic.locacao_mensal_concentrador_10l = loc_conc_10l
    lic.locacao_mensal_cpap = loc_cpap
    lic.locacao_mensal_bipap = loc_bipap
    lic.locacao_mensal_cilindro = loc_cil
    lic.valor_total_contrato = total_val
    lic.saldo_alerta_minimo_pct = data.saldo_alerta_minimo_pct
    lic.ativo = data.ativo
    lic.observacoes = data.observacoes.strip()

    db.add(lic)
    db.commit()
    db.refresh(lic)

    return LicitacaoOxigenioOut.model_validate(lic)


@router.delete("/licitacoes/{licitacao_id}")
def excluir_licitacao(
    licitacao_id: int,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_estoque", "excluir")),
):
    lic = db.get(LicitacaoContratoOxigenio, licitacao_id)
    if not lic:
        raise HTTPException(status_code=404, detail="Licitação não encontrada.")

    # Verifica se há compras registradas
    tem_compra = db.exec(select(EntradaCompraOxigenio).where(EntradaCompraOxigenio.licitacao_id == licitacao_id)).first()
    if tem_compra:
        lic.ativo = False
        db.add(lic)
        db.commit()
        return {"ok": True, "mensagem": "Licitação inativada pois possui histórico de compras vinculado."}

    db.delete(lic)
    db.commit()
    return {"ok": True, "mensagem": "Licitação excluída com sucesso."}


# ==============================================================================
# 3. ENTRADA DE COMPRAS DE OXIGÊNIO
# ==============================================================================

@router.get("/compras", response_model=list[EntradaCompraOxigenioOut])
def listar_compras(
    licitacao_id: int | None = None,
    empresa_id: int | None = None,
    de: date | None = None,
    ate: date | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(need_any_perm("oxigenio_estoque", "oxigenio", "usuarios")),
):
    stmt = select(EntradaCompraOxigenio).order_by(desc(EntradaCompraOxigenio.data_compra), desc(EntradaCompraOxigenio.id))
    if licitacao_id:
        stmt = stmt.where(EntradaCompraOxigenio.licitacao_id == licitacao_id)
    if empresa_id:
        stmt = stmt.where(EntradaCompraOxigenio.empresa_id == empresa_id)
    if de:
        stmt = stmt.where(EntradaCompraOxigenio.data_compra >= de)
    if ate:
        stmt = stmt.where(EntradaCompraOxigenio.data_compra <= ate)

    return db.exec(stmt).all()


@router.post("/compras", response_model=EntradaCompraOxigenioOut, status_code=201)
def lancar_compra(
    data: EntradaCompraOxigenioIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_estoque", "criar")),
):
    lic = db.get(LicitacaoContratoOxigenio, data.licitacao_id)
    if not lic:
        raise HTTPException(status_code=400, detail="Licitação informada não existe.")

    # Calcula valor total com base no contrato
    val_total = (
        (data.qtd_10m3 * lic.valor_unitario_10m3)
        + (data.qtd_3m3 * lic.valor_unitario_3m3)
        + (data.qtd_1m3 * lic.valor_unitario_1m3)
    )

    compra = EntradaCompraOxigenio(
        licitacao_id=lic.id,
        empresa_id=lic.empresa_id,
        empresa_nome=lic.empresa_nome,
        data_compra=data.data_compra,
        numero_nf=data.numero_nf.strip(),
        qtd_10m3=data.qtd_10m3,
        qtd_3m3=data.qtd_3m3,
        qtd_1m3=data.qtd_1m3,
        valor_total=val_total,
        responsavel_recebimento=data.responsavel_recebimento.strip() or ator.nome,
        observacoes=data.observacoes.strip(),
    )
    db.add(compra)
    db.commit()
    db.refresh(compra)

    return compra


@router.delete("/compras/{compra_id}")
def excluir_compra(
    compra_id: int,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_estoque", "excluir")),
):
    compra = db.get(EntradaCompraOxigenio, compra_id)
    if not compra:
        raise HTTPException(status_code=404, detail="Registro de compra não encontrado.")
    db.delete(compra)
    db.commit()
    return {"ok": True, "mensagem": "Registro de compra excluído com sucesso."}


# ==============================================================================
# 4. GESTÃO DE EQUIPAMENTOS (CPAP, BiPAP, CONCENTRADOR)
# ==============================================================================

@router.get("/equipamentos", response_model=list[EquipamentoRespiratorioOut])
def listar_equipamentos(
    tipo: str = "",
    status: str = "",
    propriedade: str = "",
    empresa_id: int | None = None,
    q: str = "",
    db: Session = Depends(get_db),
    _: User = Depends(need_any_perm("oxigenio_equipamentos", "oxigenio", "usuarios")),
):
    stmt = select(EquipamentoRespiratorio).order_by(EquipamentoRespiratorio.tipo, EquipamentoRespiratorio.patrimonio)
    if tipo:
        if tipo.upper() == "CONCENTRADOR":
            stmt = stmt.where(EquipamentoRespiratorio.tipo.in_(["CONCENTRADOR", "CONCENTRADOR_5L", "CONCENTRADOR_10L"]))
        else:
            stmt = stmt.where(EquipamentoRespiratorio.tipo == tipo.upper())
    if status:
        stmt = stmt.where(EquipamentoRespiratorio.status == status.upper())
    if propriedade:
        stmt = stmt.where(EquipamentoRespiratorio.propriedade == propriedade.upper())
    if empresa_id:
        stmt = stmt.where(EquipamentoRespiratorio.empresa_id == empresa_id)
    if q.strip():
        t = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(EquipamentoRespiratorio.patrimonio).like(t),
                func.lower(EquipamentoRespiratorio.numero_serie).like(t),
                func.lower(EquipamentoRespiratorio.marca_modelo).like(t),
            )
        )

    eqs = db.exec(stmt).all()
    resultado = []

    # Mapa de empréstimos ativos para vincular o paciente atual
    emp_ativos = db.exec(
        select(EmprestimoOxigenio).where(
            EmprestimoOxigenio.tipo_servico == "MAQUINA",
            EmprestimoOxigenio.status == "ATIVO",
        )
    ).all()
    mapa_paciente = {e.equipamento_id: (e.paciente_nome, e.id) for e in emp_ativos if e.equipamento_id}

    for eq in eqs:
        out = EquipamentoRespiratorioOut.model_validate(eq)
        if eq.id in mapa_paciente:
            out.paciente_atual_nome, out.emprestimo_id = mapa_paciente[eq.id]
        resultado.append(out)

    return resultado


@router.post("/equipamentos", response_model=EquipamentoRespiratorioOut, status_code=201)
def criar_equipamento(
    data: EquipamentoRespiratorioIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_equipamentos", "criar")),
):
    emp_nome = ""
    if data.empresa_id:
        emp = db.get(EmpresaOxigenio, data.empresa_id)
        if emp:
            emp_nome = emp.nome_fantasia or emp.razao_social

    eq = EquipamentoRespiratorio(
        tipo=data.tipo.upper(),
        patrimonio=data.patrimonio.strip(),
        numero_serie=data.numero_serie.strip(),
        marca_modelo=data.marca_modelo.strip(),
        propriedade=data.propriedade.upper(),
        empresa_id=data.empresa_id,
        empresa_nome=emp_nome,
        status=data.status.upper(),
        data_aquisicao=data.data_aquisicao,
        tensao_eletrica=data.tensao_eletrica.strip() or "Bivolt",
        horas_uso=data.horas_uso,
        observacoes=data.observacoes.strip(),
        ativo=data.ativo,
    )
    db.add(eq)
    db.commit()
    db.refresh(eq)
    return EquipamentoRespiratorioOut.model_validate(eq)


@router.get("/equipamentos/{equipamento_id}", response_model=EquipamentoRespiratorioOut)
def obter_equipamento(
    equipamento_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(need_any_perm("oxigenio_equipamentos", "oxigenio", "usuarios")),
):
    eq = db.get(EquipamentoRespiratorio, equipamento_id)
    if not eq:
        raise HTTPException(status_code=404, detail="Equipamento não encontrado.")
    out = EquipamentoRespiratorioOut.model_validate(eq)
    emp_ativo = db.exec(
        select(EmprestimoOxigenio).where(
            EmprestimoOxigenio.equipamento_id == eq.id,
            EmprestimoOxigenio.status == "ATIVO",
        )
    ).first()
    if emp_ativo:
        out.paciente_atual_nome = emp_ativo.paciente_nome
        out.emprestimo_id = emp_ativo.id
    return out


@router.put("/equipamentos/{equipamento_id}", response_model=EquipamentoRespiratorioOut)
def atualizar_equipamento(
    equipamento_id: int,
    data: EquipamentoRespiratorioIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_equipamentos", "editar")),
):
    eq = db.get(EquipamentoRespiratorio, equipamento_id)
    if not eq:
        raise HTTPException(status_code=404, detail="Equipamento não encontrado.")

    emp_nome = eq.empresa_nome
    if data.empresa_id and data.empresa_id != eq.empresa_id:
        emp = db.get(EmpresaOxigenio, data.empresa_id)
        if emp:
            emp_nome = emp.nome_fantasia or emp.razao_social

    eq.tipo = data.tipo.upper()
    eq.patrimonio = data.patrimonio.strip()
    eq.numero_serie = data.numero_serie.strip()
    eq.marca_modelo = data.marca_modelo.strip()
    eq.propriedade = data.propriedade.upper()
    eq.empresa_id = data.empresa_id
    eq.empresa_nome = emp_nome
    eq.status = data.status.upper()
    eq.data_aquisicao = data.data_aquisicao
    eq.tensao_eletrica = data.tensao_eletrica.strip() or "Bivolt"
    eq.horas_uso = data.horas_uso
    eq.observacoes = data.observacoes.strip()
    eq.ativo = data.ativo

    db.add(eq)
    db.commit()
    db.refresh(eq)
    return EquipamentoRespiratorioOut.model_validate(eq)


@router.delete("/equipamentos/{equipamento_id}")
def excluir_equipamento(
    equipamento_id: int,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_equipamentos", "excluir")),
):
    eq = db.get(EquipamentoRespiratorio, equipamento_id)
    if not eq:
        raise HTTPException(status_code=404, detail="Equipamento não encontrado.")

    # Se está em uso, bloqueia
    if eq.status == "EM_USO":
        raise HTTPException(status_code=400, detail="Não é possível excluir equipamento que está atualmente em uso com paciente.")

    db.delete(eq)
    db.commit()
    return {"ok": True, "mensagem": "Equipamento excluído com sucesso."}


@router.patch("/equipamentos/{equipamento_id}/status", response_model=EquipamentoRespiratorioOut)
def alterar_status_equipamento(
    equipamento_id: int,
    data: AlterarStatusEquipamentoIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_equipamentos", "editar")),
):
    eq = db.get(EquipamentoRespiratorio, equipamento_id)
    if not eq:
        raise HTTPException(status_code=404, detail="Equipamento não encontrado.")

    novo_status = data.status.upper()
    status_antigo = eq.status
    eq.status = novo_status
    if data.observacoes.strip():
        nota = f"[Status alterado para {novo_status} em {date.today().strftime('%d/%m/%Y')} por {ator.nome}]: {data.observacoes.strip()}"
        eq.observacoes = (eq.observacoes + "\n" + nota).strip() if eq.observacoes else nota

    # Apenas encerra o empréstimo se explicitamente solicitado desvinculação total
    if data.desvincular_paciente:
        emp_ativo = db.exec(
            select(EmprestimoOxigenio).where(
                EmprestimoOxigenio.equipamento_id == eq.id,
                EmprestimoOxigenio.status == "ATIVO",
            )
        ).first()
        if emp_ativo:
            emp_ativo.status = "DEVOLVIDO"
            emp_ativo.data_devolucao = date.today()
            emp_ativo.motivo_inativacao = f"Equipamento desvinculado com status {novo_status}"
            emp_ativo.updated_at = datetime.utcnow()
            db.add(emp_ativo)

    db.add(eq)
    db.commit()
    db.refresh(eq)

    out = EquipamentoRespiratorioOut.model_validate(eq)
    return out


# ==============================================================================
# 5. EMPRÉSTIMOS / SAÍDAS E COMPROVANTE
# ==============================================================================

def _calcular_prazo_troca(data_prevista: date | None) -> tuple[int | None, str]:
    if not data_prevista:
        return None, "NAO_APLICAVEL"
    hoje = date.today()
    dias = (data_prevista - hoje).days
    if dias < 0:
        return dias, "ATRASADO"
    if dias == 0:
        return 0, "TROCA_HOJE"
    return dias, "EM_DIA"


@router.get("/emprestimos", response_model=list[EmprestimoOxigenioOut])
def listar_emprestimos(
    status: str = "ATIVO",  # ATIVO, INATIVO, DEVOLVIDO, TODOS
    tipo_servico: str = "",  # MAQUINA, OXIGENIO
    tipo_equipamento: str = "",  # CPAP, BiPAP, CONCENTRADOR
    tipo_cilindro: str = "",  # 10m3, 3m3, 1m3
    empresa_id: int | None = None,
    paciente_id: int | None = None,
    apenas_trocas_proximas: bool = False,
    q: str = "",
    db: Session = Depends(get_db),
    _: User = Depends(need_any_perm("oxigenio_emprestimos", "oxigenio", "usuarios")),
):
    stmt = select(EmprestimoOxigenio).order_by(desc(EmprestimoOxigenio.data_instalacao), desc(EmprestimoOxigenio.id))

    if status and status.upper() != "TODOS":
        if status.upper() == "INATIVO":
            stmt = stmt.where(EmprestimoOxigenio.status.in_(["INATIVO", "DEVOLVIDO"]))
        else:
            stmt = stmt.where(EmprestimoOxigenio.status == status.upper())

    if tipo_servico:
        stmt = stmt.where(EmprestimoOxigenio.tipo_servico == tipo_servico.upper())
    if tipo_equipamento:
        if tipo_equipamento.upper() == "CONCENTRADOR":
            stmt = stmt.where(EmprestimoOxigenio.tipo_equipamento.in_(["CONCENTRADOR", "CONCENTRADOR_5L", "CONCENTRADOR_10L"]))
        else:
            stmt = stmt.where(EmprestimoOxigenio.tipo_equipamento == tipo_equipamento.upper())
    if tipo_cilindro:
        stmt = stmt.where(EmprestimoOxigenio.tipo_cilindro == tipo_cilindro)
    if empresa_id:
        stmt = stmt.where(EmprestimoOxigenio.empresa_id == empresa_id)
    if paciente_id:
        stmt = stmt.where(EmprestimoOxigenio.paciente_id == paciente_id)

    if q.strip():
        t = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(EmprestimoOxigenio.paciente_nome).like(t),
                func.lower(EmprestimoOxigenio.paciente_cpf).like(t),
                func.lower(EmprestimoOxigenio.paciente_prontuario).like(t),
                func.lower(EmprestimoOxigenio.codigo_termo).like(t),
                func.lower(EmprestimoOxigenio.equipamento_patrimonio).like(t),
            )
        )

    itens = db.exec(stmt).all()
    resultado = []
    hoje = date.today()

    for emp in itens:
        dias, status_p = _calcular_prazo_troca(emp.data_prevista_troca)
        if apenas_trocas_proximas:
            # Apenas os que precisam de troca nos próximos 7 dias ou atrasados
            if emp.status != "ATIVO" or emp.finalidade_cilindro != "SEMANAL_CONCENTRADOR":
                continue
            if dias is not None and dias > 7:
                continue

        out = EmprestimoOxigenioOut.model_validate(emp)
        out.dias_para_troca = dias
        out.status_prazo = status_p

        # Carrega itens múltiplos vinculados
        sub_itens = db.exec(
            select(ItemEmprestimoOxigenio).where(ItemEmprestimoOxigenio.emprestimo_id == emp.id)
        ).all()
        out.itens = [ItemEmprestimoOut.model_validate(si) for si in sub_itens]
        resultado.append(out)

    return resultado


@router.post("/emprestimos", response_model=EmprestimoOxigenioOut, status_code=201)
def criar_emprestimo(
    data: EmprestimoOxigenioIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_emprestimos", "criar")),
):
    # Carrega dados do paciente
    pac = db.get(Paciente, data.paciente_id)
    if not pac:
        raise HTTPException(status_code=400, detail="Paciente não encontrado no sistema.")

    emp_nome = ""
    if data.empresa_id:
        emp_obj = db.get(EmpresaOxigenio, data.empresa_id)
        if emp_obj:
            emp_nome = emp_obj.nome_fantasia or emp_obj.razao_social

    # Processamento de Itens (Múltiplos ou Único)
    itens_processados: list[dict] = []
    itens_resumo_lista: list[str] = []
    primeiro_eq = None
    primeiro_tipo_servico = data.tipo_servico
    primeiro_tipo_cilindro = data.tipo_cilindro
    primeiro_finalidade = data.finalidade_cilindro
    primeira_qtd = data.quantidade
    primeira_posse = data.posse_cilindro

    if data.itens and len(data.itens) > 0:
        for idx, item_in in enumerate(data.itens):
            item_eq = None
            if item_in.tipo_servico == "MAQUINA":
                if not item_in.equipamento_id:
                    raise HTTPException(status_code=400, detail=f"Item #{idx+1}: selecione o equipamento a ser emprestado.")
                item_eq = db.get(EquipamentoRespiratorio, item_in.equipamento_id)
                if not item_eq:
                    raise HTTPException(status_code=400, detail=f"Item #{idx+1}: Equipamento não encontrado.")
                if item_eq.status == "EM_USO":
                    raise HTTPException(status_code=400, detail=f"O equipamento {item_eq.patrimonio or item_eq.tipo} já está em uso.")
                item_eq.status = "EM_USO"
                db.add(item_eq)
                resumo_txt = f"1x {item_eq.tipo} ({item_eq.marca_modelo or 'Patr: ' + item_eq.patrimonio})"
            else:
                c_tipo_fmt = (item_in.tipo_cilindro or "10m³").replace("m3", "m³")
                resumo_txt = f"{item_in.quantidade}x Cilindro {c_tipo_fmt} ({'Comodato' if item_in.posse_cilindro == 'COMODATO' else 'Próprio/Licitado'})"

            itens_resumo_lista.append(resumo_txt)
            itens_processados.append({
                "in": item_in,
                "eq": item_eq,
            })

        # Define campos primários para compatibilidade
        p_item = itens_processados[0]
        primeiro_tipo_servico = p_item["in"].tipo_servico
        primeiro_eq = p_item["eq"]
        primeiro_tipo_cilindro = p_item["in"].tipo_cilindro
        primeiro_finalidade = p_item["in"].finalidade_cilindro
        primeira_qtd = p_item["in"].quantidade
        primeira_posse = p_item["in"].posse_cilindro
    else:
        # Modo clássico: item único
        if data.tipo_servico == "MAQUINA":
            if not data.equipamento_id:
                raise HTTPException(status_code=400, detail="Selecione o equipamento a ser emprestado.")
            primeiro_eq = db.get(EquipamentoRespiratorio, data.equipamento_id)
            if not primeiro_eq:
                raise HTTPException(status_code=400, detail="Equipamento respiratório não encontrado.")
            if primeiro_eq.status == "EM_USO":
                raise HTTPException(status_code=400, detail=f"O equipamento {primeiro_eq.patrimonio or primeiro_eq.tipo} já se encontra em uso.")
            primeiro_eq.status = "EM_USO"
            db.add(primeiro_eq)
            resumo_txt = f"1x {primeiro_eq.tipo} ({primeiro_eq.marca_modelo or 'Patr: ' + primeiro_eq.patrimonio})"
        else:
            c_tipo_fmt = (data.tipo_cilindro or "10m³").replace("m3", "m³")
            resumo_txt = f"{data.quantidade}x Cilindro {c_tipo_fmt} ({'Comodato' if data.posse_cilindro == 'COMODATO' else 'Próprio/Licitado'})"

        itens_resumo_lista.append(resumo_txt)
        itens_processados.append({
            "in": ItemEmprestimoIn(
                tipo_servico=data.tipo_servico,
                equipamento_id=primeiro_eq.id if primeiro_eq else None,
                tipo_equipamento=primeiro_eq.tipo if primeiro_eq else None,
                equipamento_patrimonio=primeiro_eq.patrimonio if primeiro_eq else None,
                tipo_cilindro=data.tipo_cilindro,
                finalidade_cilindro=data.finalidade_cilindro,
                quantidade=data.quantidade,
                posse_cilindro=data.posse_cilindro,
            ),
            "eq": primeiro_eq,
        })

    # Se for cilindro semanal de 10m³ para concentrador, calcula previsão de troca em +7 dias se não informada
    data_troca_prevista = data.data_prevista_troca
    if primeiro_finalidade == "SEMANAL_CONCENTRADOR" and not data_troca_prevista:
        data_troca_prevista = data.data_instalacao + timedelta(days=7)

    # Gera código do termo único: TERM-AAAAMM-XXXX
    prefixo = f"TERM-{datetime.now().strftime('%Y%m')}"
    total_mes = db.exec(
        select(func.count(EmprestimoOxigenio.id)).where(EmprestimoOxigenio.codigo_termo.like(f"{prefixo}%"))
    ).one()
    codigo_termo = f"{prefixo}-{(total_mes or 0) + 1:04d}"

    # Endereço completo formatado
    partes_end = [pac.endereco, f"Nº {pac.endereco_numero}" if pac.endereco_numero else "", pac.bairro]
    end_fmt = " · ".join([p for p in partes_end if p])

    emprestimo = EmprestimoOxigenio(
        codigo_termo=codigo_termo,
        paciente_id=pac.id,
        paciente_nome=pac.nome,
        paciente_cpf=pac.cpf or "",
        paciente_cns=pac.cns or "",
        paciente_prontuario=pac.codigo_prontuario or (f"PR-{pac.id:05d}" if pac.id else ""),
        paciente_telefone=pac.telefone or "",
        paciente_endereco=end_fmt,
        tipo_servico=primeiro_tipo_servico,
        equipamento_id=primeiro_eq.id if primeiro_eq else None,
        tipo_equipamento=primeiro_eq.tipo if primeiro_eq else None,
        equipamento_patrimonio=primeiro_eq.patrimonio if primeiro_eq else None,
        equipamento_serie=primeiro_eq.numero_serie if primeiro_eq else None,
        tipo_cilindro=primeiro_tipo_cilindro or None,
        finalidade_cilindro=primeiro_finalidade or None,
        quantidade=primeira_qtd,
        posse_cilindro=primeira_posse,
        itens_resumo=" · ".join(itens_resumo_lista),
        empresa_id=data.empresa_id or (primeiro_eq.empresa_id if primeiro_eq else None),
        empresa_nome=emp_nome or (primeiro_eq.empresa_nome if primeiro_eq else None),
        licitacao_id=data.licitacao_id,
        data_instalacao=data.data_instalacao,
        data_prevista_troca=data_troca_prevista,
        status="ATIVO",
        responsavel_retirada_nome=data.responsavel_retirada_nome.strip() or pac.nome,
        responsavel_retirada_cpf=data.responsavel_retirada_cpf.strip() or (pac.cpf or ""),
        responsavel_retirada_parentesco=data.responsavel_retirada_parentesco.strip() or "Próprio paciente",
        medico_prescritor=data.medico_prescritor.strip(),
        cid_diagnostico=data.cid_diagnostico.strip(),
        fluxo_oxigenio_litros_min=data.fluxo_oxigenio_litros_min,
        pressao_cpap_bipap=data.pressao_cpap_bipap.strip() if data.pressao_cpap_bipap else None,
        termo_assinado=data.termo_assinado,
        observacoes=data.observacoes.strip(),
    )

    db.add(emprestimo)
    db.commit()
    db.refresh(emprestimo)

    # Grava itens individuais vinculados a este empréstimo
    itens_salvos: list[ItemEmprestimoOut] = []
    for proc in itens_processados:
        it_in = proc["in"]
        eq_obj = proc["eq"]
        sub_item = ItemEmprestimoOxigenio(
            emprestimo_id=emprestimo.id,
            tipo_servico=it_in.tipo_servico,
            equipamento_id=eq_obj.id if eq_obj else it_in.equipamento_id,
            tipo_equipamento=eq_obj.tipo if eq_obj else it_in.tipo_equipamento,
            equipamento_patrimonio=eq_obj.patrimonio if eq_obj else it_in.equipamento_patrimonio,
            equipamento_serie=eq_obj.numero_serie if eq_obj else None,
            tipo_cilindro=it_in.tipo_cilindro,
            finalidade_cilindro=it_in.finalidade_cilindro,
            quantidade=it_in.quantidade,
            posse_cilindro=it_in.posse_cilindro,
            status="ATIVO",
            observacoes=it_in.observacoes,
        )
        db.add(sub_item)
        db.commit()
        db.refresh(sub_item)
        itens_salvos.append(ItemEmprestimoOut.model_validate(sub_item))

    dias, status_p = _calcular_prazo_troca(emprestimo.data_prevista_troca)
    out = EmprestimoOxigenioOut.model_validate(emprestimo)
    out.dias_para_troca = dias
    out.status_prazo = status_p
    out.itens = itens_salvos
    return out


@router.get("/emprestimos/{emprestimo_id}", response_model=EmprestimoOxigenioOut)
def obter_emprestimo(
    emprestimo_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(need_any_perm("oxigenio_emprestimos", "oxigenio", "usuarios")),
):
    emp = db.get(EmprestimoOxigenio, emprestimo_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Registro de empréstimo não encontrado.")
    dias, status_p = _calcular_prazo_troca(emp.data_prevista_troca)
    out = EmprestimoOxigenioOut.model_validate(emp)
    out.dias_para_troca = dias
    out.status_prazo = status_p

    sub_itens = db.exec(
        select(ItemEmprestimoOxigenio).where(ItemEmprestimoOxigenio.emprestimo_id == emp.id)
    ).all()
    out.itens = [ItemEmprestimoOut.model_validate(si) for si in sub_itens]
    return out


@router.put("/emprestimos/{emprestimo_id}", response_model=EmprestimoOxigenioOut)
def editar_emprestimo(
    emprestimo_id: int,
    data: EmprestimoEditarIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_emprestimos", "editar")),
):
    emp = db.get(EmprestimoOxigenio, emprestimo_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Empréstimo não encontrado.")

    if data.data_instalacao is not None:
        emp.data_instalacao = data.data_instalacao
    if data.data_prevista_troca is not None:
        emp.data_prevista_troca = data.data_prevista_troca
    if data.responsavel_retirada_nome is not None:
        emp.responsavel_retirada_nome = data.responsavel_retirada_nome.strip()
    if data.responsavel_retirada_cpf is not None:
        emp.responsavel_retirada_cpf = data.responsavel_retirada_cpf.strip()
    if data.responsavel_retirada_parentesco is not None:
        emp.responsavel_retirada_parentesco = data.responsavel_retirada_parentesco.strip()
    if data.medico_prescritor is not None:
        emp.medico_prescritor = data.medico_prescritor.strip()
    if data.cid_diagnostico is not None:
        emp.cid_diagnostico = data.cid_diagnostico.strip()
    if data.fluxo_oxigenio_litros_min is not None:
        emp.fluxo_oxigenio_litros_min = data.fluxo_oxigenio_litros_min
    if data.pressao_cpap_bipap is not None:
        emp.pressao_cpap_bipap = data.pressao_cpap_bipap.strip()
    if data.termo_assinado is not None:
        emp.termo_assinado = data.termo_assinado
    if data.observacoes is not None:
        emp.observacoes = data.observacoes.strip()
    if data.empresa_id is not None:
        emp.empresa_id = data.empresa_id
        emp_obj = db.get(EmpresaOxigenio, data.empresa_id)
        if emp_obj:
            emp.empresa_nome = emp_obj.nome_fantasia or emp_obj.razao_social

    emp.updated_at = datetime.utcnow()
    db.add(emp)
    db.commit()
    db.refresh(emp)

    dias, status_p = _calcular_prazo_troca(emp.data_prevista_troca)
    out = EmprestimoOxigenioOut.model_validate(emp)
    out.dias_para_troca = dias
    out.status_prazo = status_p
    return out


@router.post("/emprestimos/{emprestimo_id}/inativar", response_model=EmprestimoOxigenioOut)
def inativar_devolver_emprestimo(
    emprestimo_id: int,
    data: InativarEmprestimoIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_emprestimos", "editar")),
):
    emp = db.get(EmprestimoOxigenio, emprestimo_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Empréstimo não encontrado.")

    emp.status = "INATIVO"
    emp.data_devolucao = data.data_devolucao
    emp.motivo_inativacao = data.motivo_inativacao
    if data.observacoes.strip():
        emp.observacoes = (emp.observacoes + "\n" + f"[Encerramento em {data.data_devolucao}]: {data.observacoes.strip()}").strip()

    # Se for máquina, libera o equipamento de volta para DISPONIVEL
    if emp.equipamento_id:
        eq = db.get(EquipamentoRespiratorio, emp.equipamento_id)
        if eq:
            eq.status = "DISPONIVEL"
            db.add(eq)

    # Se tinha cilindros vinculados, gera recolhimento de cilindro vazio pendente
    itens_cil = db.exec(
        select(ItemEmprestimoOxigenio).where(
            ItemEmprestimoOxigenio.emprestimo_id == emp.id,
            ItemEmprestimoOxigenio.tipo_cilindro.is_not(None),
        )
    ).all()
    if itens_cil:
        for it in itens_cil:
            if it.tipo_cilindro:
                vazio = CilindroVazioRecolhimento(
                    paciente_id=emp.paciente_id,
                    paciente_nome=emp.paciente_nome,
                    emprestimo_id=emp.id,
                    empresa_id=emp.empresa_id,
                    tipo_cilindro=it.tipo_cilindro,
                    quantidade=it.quantidade or 1,
                    posse=it.posse_cilindro or "PROPRIO",
                    status="PENDENTE",
                    data_geracao=data.data_devolucao or date.today(),
                    observacoes=f"Devolvido no encerramento do empréstimo {emp.codigo_termo}",
                )
                db.add(vazio)
    elif emp.tipo_cilindro:
        vazio = CilindroVazioRecolhimento(
            paciente_id=emp.paciente_id,
            paciente_nome=emp.paciente_nome,
            emprestimo_id=emp.id,
            empresa_id=emp.empresa_id,
            tipo_cilindro=emp.tipo_cilindro,
            quantidade=emp.quantidade or 1,
            posse=emp.posse_cilindro or "PROPRIO",
            status="PENDENTE",
            data_geracao=data.data_devolucao or date.today(),
            observacoes=f"Devolvido no encerramento do empréstimo {emp.codigo_termo}",
        )
        db.add(vazio)

    emp.updated_at = datetime.utcnow()
    db.add(emp)
    db.commit()
    db.refresh(emp)

    out = EmprestimoOxigenioOut.model_validate(emp)
    out.status_prazo = "NAO_APLICAVEL"
    return out


@router.post("/emprestimos/{emprestimo_id}/troca", response_model=TrocaCilindroHistoricoOut)
def registrar_troca_cilindro(
    emprestimo_id: int,
    data: RegistrarTrocaIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_emprestimos", "criar")),
):
    emp = db.get(EmprestimoOxigenio, emprestimo_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Empréstimo não encontrado.")
    if emp.status != "ATIVO":
        raise HTTPException(status_code=400, detail="Não é possível lançar troca para um empréstimo inativo/devolvido.")

    proxima_data = data.proxima_data_troca or (data.data_troca + timedelta(days=7))

    troca = TrocaCilindroHistorico(
        emprestimo_id=emp.id,
        paciente_id=emp.paciente_id,
        paciente_nome=emp.paciente_nome,
        data_troca=data.data_troca,
        tipo_cilindro=data.tipo_cilindro,
        quantidade=data.quantidade,
        empresa_id=emp.empresa_id,
        empresa_nome=emp.empresa_nome,
        responsavel_entrega=data.responsavel_entrega.strip() or ator.nome,
        observacoes=data.observacoes.strip(),
    )
    db.add(troca)

    # Registra automaticamente a posse de cilindro vazio pendente de recolhimento
    cil_vazio = CilindroVazioRecolhimento(
        paciente_id=emp.paciente_id,
        paciente_nome=emp.paciente_nome,
        emprestimo_id=emp.id,
        empresa_id=emp.empresa_id,
        tipo_cilindro=data.tipo_cilindro,
        quantidade=data.quantidade,
        posse=emp.posse_cilindro or "PROPRIO",
        status="PENDENTE",
        data_geracao=data.data_troca,
        observacoes=f"Gerado automaticamente na troca de cilindro do termo {emp.codigo_termo}",
    )
    db.add(cil_vazio)

    # Garante status ATIVO após troca consecutiva
    emp.status = "ATIVO"
    emp.data_ultima_troca = data.data_troca
    emp.data_prevista_troca = proxima_data
    emp.updated_at = datetime.utcnow()
    db.add(emp)

    db.commit()
    db.refresh(troca)
    return troca


@router.get("/emprestimos/{emprestimo_id}/trocas", response_model=list[TrocaCilindroHistoricoOut])
def listar_trocas_emprestimo(
    emprestimo_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(need_any_perm("oxigenio_emprestimos", "oxigenio", "usuarios")),
):
    stmt = (
        select(TrocaCilindroHistorico)
        .where(TrocaCilindroHistorico.emprestimo_id == emprestimo_id)
        .order_by(desc(TrocaCilindroHistorico.data_troca))
    )
    return db.exec(stmt).all()


@router.get("/emprestimos/{emprestimo_id}/comprovante")
def obter_dados_comprovante(
    emprestimo_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(need_any_perm("oxigenio_emprestimos", "oxigenio", "usuarios")),
):
    emp = db.get(EmprestimoOxigenio, emprestimo_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Empréstimo não encontrado.")

    pac = db.get(Paciente, emp.paciente_id)
    sub_itens = db.exec(
        select(ItemEmprestimoOxigenio).where(ItemEmprestimoOxigenio.emprestimo_id == emp.id)
    ).all()
    itens_comprovante = [
        {
            "id": si.id,
            "tipo_servico": si.tipo_servico,
            "tipo_equipamento": si.tipo_equipamento,
            "equipamento_patrimonio": si.equipamento_patrimonio,
            "equipamento_serie": si.equipamento_serie,
            "tipo_cilindro": si.tipo_cilindro,
            "finalidade_cilindro": si.finalidade_cilindro,
            "quantidade": si.quantidade,
            "posse_cilindro": si.posse_cilindro,
            "status": si.status,
            "observacoes": si.observacoes,
        }
        for si in sub_itens
    ]

    return {
        "codigo_termo": emp.codigo_termo,
        "data_emissao": datetime.now().strftime("%d/%m/%Y %H:%M"),
        "paciente": {
            "id": pac.id if pac else emp.paciente_id,
            "nome": emp.paciente_nome,
            "cpf": emp.paciente_cpf,
            "cns": emp.paciente_cns,
            "prontuario": emp.paciente_prontuario,
            "telefone": emp.paciente_telefone,
            "endereco": emp.paciente_endereco,
        },
        "responsavel_retirada": {
            "nome": emp.responsavel_retirada_nome,
            "cpf": emp.responsavel_retirada_cpf,
            "parentesco": emp.responsavel_retirada_parentesco,
        },
        "servico": {
            "tipo_servico": emp.tipo_servico,
            "tipo_equipamento": emp.tipo_equipamento,
            "equipamento_patrimonio": emp.equipamento_patrimonio,
            "equipamento_serie": emp.equipamento_serie,
            "tipo_cilindro": emp.tipo_cilindro,
            "finalidade_cilindro": emp.finalidade_cilindro,
            "quantidade": emp.quantidade,
            "posse_cilindro": emp.posse_cilindro,
            "itens_resumo": emp.itens_resumo,
            "itens": itens_comprovante,
            "data_instalacao": emp.data_instalacao.strftime("%d/%m/%Y"),
            "data_prevista_troca": emp.data_prevista_troca.strftime("%d/%m/%Y") if emp.data_prevista_troca else None,
            "fluxo_oxigenio": f"{emp.fluxo_oxigenio_litros_min} L/min" if emp.fluxo_oxigenio_litros_min else None,
            "pressao_cpap_bipap": emp.pressao_cpap_bipap,
            "empresa_fornecedora": emp.empresa_nome,
        },
        "prescricao": {
            "medico": emp.medico_prescritor,
            "cid": emp.cid_diagnostico,
        },
        "observacoes": emp.observacoes,
        "declaracao_responsabilidade": (
            "Declaro que recebi da Secretaria Municipal de Saúde o equipamento/cilindro acima discriminado em perfeitas condições de uso, "
            "e assumo total responsabilidade por sua guarda, conservação e devolução nas mesmas condições. Comprometo-me a comunicar imediatamente "
            "qualquer defeito, alteração no estado clínico ou alta médica que justifique a devolução do equipamento."
        ),
    }


# ==============================================================================
# 6. PAINEL DE CONTROLE / RESUMO DE ESTOQUE E CONSUMO
# ==============================================================================

@router.get("/estoque/resumo", response_model=EstoqueOxigenioResumoOut)
def resumo_estoque(
    empresa_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(need_any_perm("oxigenio_estoque", "oxigenio", "usuarios")),
):
    # 1. Licitações e Contratos
    lic_stmt = select(LicitacaoContratoOxigenio).where(LicitacaoContratoOxigenio.ativo == True)
    if empresa_id:
        lic_stmt = lic_stmt.where(LicitacaoContratoOxigenio.empresa_id == empresa_id)
    licitacoes = db.exec(lic_stmt).all()

    tot_contratado_10 = sum(l.qtd_contratada_10m3 for l in licitacoes)
    tot_contratado_3 = sum(l.qtd_contratada_3m3 for l in licitacoes)
    tot_contratado_1 = sum(l.qtd_contratada_1m3 for l in licitacoes)

    # 2. Compras / Entradas
    compra_stmt = select(
        func.coalesce(func.sum(EntradaCompraOxigenio.qtd_10m3), 0),
        func.coalesce(func.sum(EntradaCompraOxigenio.qtd_3m3), 0),
        func.coalesce(func.sum(EntradaCompraOxigenio.qtd_1m3), 0),
    )
    if empresa_id:
        compra_stmt = compra_stmt.where(EntradaCompraOxigenio.empresa_id == empresa_id)
    tot_comprado = db.exec(compra_stmt).first()
    tot_comp_10 = int(tot_comprado[0]) if tot_comprado else 0
    tot_comp_3 = int(tot_comprado[1]) if tot_comprado else 0
    tot_comp_1 = int(tot_comprado[2]) if tot_comprado else 0

    # 3. Empréstimos Ativos de Oxigênio (cilindros com pacientes)
    emp_ox_stmt = select(EmprestimoOxigenio).where(
        EmprestimoOxigenio.status == "ATIVO",
        EmprestimoOxigenio.tipo_cilindro.is_not(None),
    )
    if empresa_id:
        emp_ox_stmt = emp_ox_stmt.where(EmprestimoOxigenio.empresa_id == empresa_id)
    emp_ox_ativos = db.exec(emp_ox_stmt).all()

    em_uso_10 = sum(e.quantidade for e in emp_ox_ativos if e.tipo_cilindro == "10m3")
    em_uso_3 = sum(e.quantidade for e in emp_ox_ativos if e.tipo_cilindro == "3m3")
    em_uso_1 = sum(e.quantidade for e in emp_ox_ativos if e.tipo_cilindro == "1m3")

    # 3b. Cilindros Vazios (Retornados / Aguardando Recolhimento ou Troca)
    vazios_stmt = select(CilindroVazioRecolhimento).where(CilindroVazioRecolhimento.status == "PENDENTE")
    if empresa_id:
        vazios_stmt = vazios_stmt.where(
            or_(
                CilindroVazioRecolhimento.empresa_id == empresa_id,
                CilindroVazioRecolhimento.empresa_id.is_(None),
            )
        )
    todos_vazios = db.exec(vazios_stmt).all()

    vazios_10 = sum(v.quantidade for v in todos_vazios if v.tipo_cilindro == "10m3")
    vazios_3 = sum(v.quantidade for v in todos_vazios if v.tipo_cilindro == "3m3")
    vazios_1 = sum(v.quantidade for v in todos_vazios if v.tipo_cilindro == "1m3")
    tot_vazios = vazios_10 + vazios_3 + vazios_1

    saldo_lic_10 = max(0, tot_contratado_10 - tot_comp_10)
    saldo_lic_3 = max(0, tot_contratado_3 - tot_comp_3)
    saldo_lic_1 = max(0, tot_contratado_1 - tot_comp_1)

    # Estoque Físico Livre / Disponível: deduz estritamente os cilindros vazios
    # (refletindo apenas os cilindros cheios prontos para uso)
    disp_cheios_10 = max(0, tot_comp_10 - em_uso_10 - vazios_10)
    disp_cheios_3 = max(0, tot_comp_3 - em_uso_3 - vazios_3)
    disp_cheios_1 = max(0, tot_comp_1 - em_uso_1 - vazios_1)

    pct_10 = (saldo_lic_10 / tot_contratado_10 * 100) if tot_contratado_10 > 0 else 100
    pct_3 = (saldo_lic_3 / tot_contratado_3 * 100) if tot_contratado_3 > 0 else 100
    pct_1 = (saldo_lic_1 / tot_contratado_1 * 100) if tot_contratado_1 > 0 else 100

    # 4. Saldos por Tipo
    saldos_tipos = [
        SaldoCilindroTipo(
            tipo="10m3",
            contratado=tot_contratado_10,
            comprado=tot_comp_10,
            em_uso=em_uso_10,
            vazios=vazios_10,
            saldo_licitacao=saldo_lic_10,
            saldo_estoque_disponivel=disp_cheios_10,
            alerta_baixo=(pct_10 <= 20),
            pct_saldo_licitacao=round(pct_10, 1),
        ),
        SaldoCilindroTipo(
            tipo="3m3",
            contratado=tot_contratado_3,
            comprado=tot_comp_3,
            em_uso=em_uso_3,
            vazios=vazios_3,
            saldo_licitacao=saldo_lic_3,
            saldo_estoque_disponivel=disp_cheios_3,
            alerta_baixo=(pct_3 <= 20),
            pct_saldo_licitacao=round(pct_3, 1),
        ),
        SaldoCilindroTipo(
            tipo="1m3",
            contratado=tot_contratado_1,
            comprado=tot_comp_1,
            em_uso=em_uso_1,
            vazios=vazios_1,
            saldo_licitacao=saldo_lic_1,
            saldo_estoque_disponivel=disp_cheios_1,
            alerta_baixo=(pct_1 <= 20),
            pct_saldo_licitacao=round(pct_1, 1),
        ),
    ]

    # 5. Pacientes Ativos
    todos_emp_ativos = db.exec(
        select(EmprestimoOxigenio).where(EmprestimoOxigenio.status == "ATIVO")
    ).all()
    pacs_ox_ativos = {e.paciente_id for e in todos_emp_ativos if e.tipo_servico == "OXIGENIO" or e.tipo_cilindro}
    pacs_maq_ativos = {e.paciente_id for e in todos_emp_ativos if e.tipo_servico == "MAQUINA"}
    pacs_conc = {e.paciente_id for e in todos_emp_ativos if e.tipo_equipamento in ["CONCENTRADOR", "CONCENTRADOR_5L", "CONCENTRADOR_10L"]}
    pacs_conc_5l = {e.paciente_id for e in todos_emp_ativos if e.tipo_equipamento in ["CONCENTRADOR_5L", "CONCENTRADOR"]}
    pacs_conc_10l = {e.paciente_id for e in todos_emp_ativos if e.tipo_equipamento == "CONCENTRADOR_10L"}
    pacs_cpap = {e.paciente_id for e in todos_emp_ativos if e.tipo_equipamento == "CPAP"}
    pacs_bipap = {e.paciente_id for e in todos_emp_ativos if e.tipo_equipamento == "BiPAP"}
    todos_pacs_ativos = {e.paciente_id for e in todos_emp_ativos}

    # Inativos
    total_inativos = db.exec(
        select(func.count(func.distinct(EmprestimoOxigenio.paciente_id))).where(
            EmprestimoOxigenio.status.in_(["INATIVO", "DEVOLVIDO"])
        )
    ).one() or 0

    # 6. Equipamentos
    eq_stmt = select(EquipamentoRespiratorio)
    if empresa_id:
        eq_stmt = eq_stmt.where(EquipamentoRespiratorio.empresa_id == empresa_id)
    todos_eq = db.exec(eq_stmt).all()
    tot_eq = len(todos_eq)
    eq_em_uso = sum(1 for q in todos_eq if q.status == "EM_USO")
    eq_disp = sum(1 for q in todos_eq if q.status == "DISPONIVEL")
    eq_manut = sum(1 for q in todos_eq if q.status == "MANUTENCAO")

    # 7. Alertas de trocas semanais de cilindros
    hoje = date.today()
    trocas_atrasadas = 0
    trocas_hoje = 0
    trocas_7dias = 0

    for e in todos_emp_ativos:
        if e.finalidade_cilindro == "SEMANAL_CONCENTRADOR" and e.data_prevista_troca:
            d = (e.data_prevista_troca - hoje).days
            if d < 0:
                trocas_atrasadas += 1
            elif d == 0:
                trocas_hoje += 1
            elif d <= 7:
                trocas_7dias += 1

    # 8. Gráficos de Consumo Mensal (últimos 6 meses)
    consumo_mensal = []
    meses_nomes = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
    data_cursor = hoje.replace(day=1)
    for _ in range(6):
        m_str = f"{meses_nomes[data_cursor.month - 1]}/{str(data_cursor.year)[2:]}"
        # Primeiro e último dia do mês
        p_dia = data_cursor
        u_dia = (data_cursor.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)

        # Trocas realizadas no mês
        trocas_stmt = select(TrocaCilindroHistorico).where(
            TrocaCilindroHistorico.data_troca >= p_dia,
            TrocaCilindroHistorico.data_troca <= u_dia,
        )
        if empresa_id:
            trocas_stmt = trocas_stmt.where(TrocaCilindroHistorico.empresa_id == empresa_id)
        trocas_m = db.exec(trocas_stmt).all()
        t10 = sum(t.quantidade for t in trocas_m if t.tipo_cilindro == "10m3")
        t3 = sum(t.quantidade for t in trocas_m if t.tipo_cilindro == "3m3")
        t1 = sum(t.quantidade for t in trocas_m if t.tipo_cilindro == "1m3")

        # Compras realizadas no mês
        compras_stmt = select(EntradaCompraOxigenio).where(
            EntradaCompraOxigenio.data_compra >= p_dia,
            EntradaCompraOxigenio.data_compra <= u_dia,
        )
        if empresa_id:
            compras_stmt = compras_stmt.where(EntradaCompraOxigenio.empresa_id == empresa_id)
        compras_m = db.exec(compras_stmt).all()
        c10 = sum(c.qtd_10m3 for c in compras_m)
        c3 = sum(c.qtd_3m3 for c in compras_m)
        c1 = sum(c.qtd_1m3 for c in compras_m)

        consumo_mensal.append({
            "mes": m_str,
            "cilindros_10m3": t10 + c10,
            "cilindros_3m3": t3 + c3,
            "cilindros_1m3": t1 + c1,
            "total_geral": (t10 + c10 + t3 + c3 + t1 + c1),
        })
        # Volta um mês
        data_cursor = (data_cursor - timedelta(days=1)).replace(day=1)

    consumo_mensal.reverse()

    # 9. Consumo por Empresa (filtrado por escopo: não exibe oxigênio para empresas sem fornecimento e não exibe máquinas para empresas exclusivas de oxigênio)
    consumo_por_empresa = []
    emp_stmt = select(EmpresaOxigenio).where(EmpresaOxigenio.ativo == True)
    if empresa_id:
        emp_stmt = emp_stmt.where(EmpresaOxigenio.id == empresa_id)
    empresas_resumo = db.exec(emp_stmt).all()

    for emp in empresas_resumo:
        try:
            servs = json.loads(emp.servicos or "[]")
        except Exception:
            servs = []

        tem_oxigenio = (
            "OXIGENIO_MEDICINAL" in servs
            or any("oxigenio" in s.lower() for s in servs)
        )
        tem_equipamentos = any(
            s in ["LOCACAO_CONCENTRADOR", "LOCACAO_CONCENTRADOR_5L", "LOCACAO_CONCENTRADOR_10L", "LOCACAO_CPAP", "LOCACAO_BIPAP"]
            or "locacao" in s.lower()
            or "concentrador" in s.lower()
            or "cpap" in s.lower()
            or "bipap" in s.lower()
            or "maquina" in s.lower()
            for s in servs
        )
        # Compatibilidade com cadastros legados com lista de serviços vazia
        if not servs:
            tem_oxigenio = True
            tem_equipamentos = True

        c_emp = db.exec(
            select(
                func.coalesce(func.sum(EntradaCompraOxigenio.qtd_10m3), 0),
                func.coalesce(func.sum(EntradaCompraOxigenio.qtd_3m3), 0),
                func.coalesce(func.sum(EntradaCompraOxigenio.qtd_1m3), 0),
                func.coalesce(func.sum(EntradaCompraOxigenio.valor_total), 0),
            ).where(EntradaCompraOxigenio.empresa_id == emp.id)
        ).first()

        t_10 = int(c_emp[0]) if c_emp and tem_oxigenio else 0
        t_3 = int(c_emp[1]) if c_emp and tem_oxigenio else 0
        t_1 = int(c_emp[2]) if c_emp and tem_oxigenio else 0
        val_total = float(c_emp[3]) if c_emp and tem_oxigenio else 0.0

        # Equipamentos da empresa
        n_eqs = 0
        eq_em_uso = 0
        if tem_equipamentos:
            n_eqs = db.exec(
                select(func.count(EquipamentoRespiratorio.id)).where(EquipamentoRespiratorio.empresa_id == emp.id)
            ).one() or 0
            eq_em_uso = db.exec(
                select(func.count(EquipamentoRespiratorio.id)).where(
                    EquipamentoRespiratorio.empresa_id == emp.id,
                    EquipamentoRespiratorio.status == "EM_USO",
                )
            ).one() or 0

        consumo_por_empresa.append({
            "empresa_id": emp.id,
            "empresa_nome": emp.nome_fantasia or emp.razao_social,
            "servicos": servs,
            "fornece_oxigenio": tem_oxigenio,
            "loca_equipamentos": tem_equipamentos,
            "compras_10m3": t_10,
            "compras_3m3": t_3,
            "compras_1m3": t_1,
            "total_cilindros": t_10 + t_3 + t_1,
            "valor_total_compras": val_total,
            "equipamentos_cadastrados": n_eqs,
            "equipamentos_em_uso": eq_em_uso,
        })

    # 10. Saldos de Comodato (Cilindros emprestados pela fornecedora)
    saldos_comodato = []
    for tipo_c in ["10m3", "3m3", "1m3"]:
        comod_stmt = select(CilindroComodatoMovimentacao).where(CilindroComodatoMovimentacao.tipo_cilindro == tipo_c)
        if empresa_id:
            comod_stmt = comod_stmt.where(CilindroComodatoMovimentacao.empresa_id == empresa_id)
        movs = db.exec(comod_stmt).all()
        ent = sum(m.quantidade for m in movs if m.tipo_movimentacao == "ENTRADA_COMODATO")
        dev = sum(m.quantidade for m in movs if m.tipo_movimentacao == "DEVOLUCAO_EMPRESA")
        saldos_comodato.append(ComodatoSaldoOut(
            tipo_cilindro=tipo_c,
            total_recebido=ent,
            total_devolvido=dev,
            saldo_em_comodato=max(0, ent - dev),
        ))

    # 11. Cilindros Vazios Pendentes de Recolhimento (já totalizados em tot_vazios como soma de quantidades)

    return EstoqueOxigenioResumoOut(
        saldos_cilindros=saldos_tipos,
        total_pacientes_ativos=len(todos_pacs_ativos),
        pacientes_ativos_oxigenio=len(pacs_ox_ativos),
        pacientes_ativos_maquinas=len(pacs_maq_ativos),
        pacientes_ativos_concentrador=len(pacs_conc),
        pacientes_ativos_concentrador_5l=len(pacs_conc_5l),
        pacientes_ativos_concentrador_10l=len(pacs_conc_10l),
        pacientes_ativos_cpap=len(pacs_cpap),
        pacientes_ativos_bipap=len(pacs_bipap),
        total_pacientes_inativos=total_inativos,
        total_equipamentos=tot_eq,
        equipamentos_em_uso=eq_em_uso,
        equipamentos_disponiveis=eq_disp,
        equipamentos_manutencao=eq_manut,
        trocas_pendentes_atrasadas=trocas_atrasadas,
        trocas_pendentes_hoje=trocas_hoje,
        trocas_proximos_7_dias=trocas_7dias,
        consumo_mensal=consumo_mensal,
        consumo_por_empresa=consumo_por_empresa,
        saldos_comodato=saldos_comodato,
        total_cilindros_vazios_pendentes=tot_vazios,
        vazios_10m3=vazios_10,
        vazios_3m3=vazios_3,
        vazios_1m3=vazios_1,
        total_cilindros_cheios_disponiveis=(disp_cheios_10 + disp_cheios_3 + disp_cheios_1),
    )


# ==============================================================================
# 7. RELATÓRIO PARA REQUISIÇÃO AF (AUTORIZAÇÃO DE FORNECIMENTO / ALMOXARIFADO)
# ==============================================================================

@router.get("/requisicao-af", response_model=RequisicaoAFOut)
def gerar_requisicao_af(
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("oxigenio_relatorios", "oxigenio", "usuarios")),
):
    hoje = date.today()

    # Contratos vigentes
    licitacoes = db.exec(select(LicitacaoContratoOxigenio).where(LicitacaoContratoOxigenio.ativo == True)).all()
    tot_contratado_10 = sum(l.qtd_contratada_10m3 for l in licitacoes)
    tot_contratado_3 = sum(l.qtd_contratada_3m3 for l in licitacoes)
    tot_contratado_1 = sum(l.qtd_contratada_1m3 for l in licitacoes)

    tot_comprado = db.exec(
        select(
            func.coalesce(func.sum(EntradaCompraOxigenio.qtd_10m3), 0),
            func.coalesce(func.sum(EntradaCompraOxigenio.qtd_3m3), 0),
            func.coalesce(func.sum(EntradaCompraOxigenio.qtd_1m3), 0),
        )
    ).first()
    tot_comp_10 = int(tot_comprado[0]) if tot_comprado else 0
    tot_comp_3 = int(tot_comprado[1]) if tot_comprado else 0
    tot_comp_1 = int(tot_comprado[2]) if tot_comprado else 0

    saldo_10 = max(0, tot_contratado_10 - tot_comp_10)
    saldo_3 = max(0, tot_contratado_3 - tot_comp_3)
    saldo_1 = max(0, tot_contratado_1 - tot_comp_1)

    # Pacientes ativos dependentes de oxigênio
    ativos = db.exec(select(EmprestimoOxigenio).where(EmprestimoOxigenio.status == "ATIVO")).all()
    pacs_dependentes = len({e.paciente_id for e in ativos})
    pacs_conc = len({e.paciente_id for e in ativos if e.tipo_equipamento in ["CONCENTRADOR", "CONCENTRADOR_5L", "CONCENTRADOR_10L"]})
    pacs_semanal_10m3 = len([e for e in ativos if e.finalidade_cilindro == "SEMANAL_CONCENTRADOR"])

    # Estimativa de consumo médio mensal
    # Cilindros 10m³: pacientes com troca semanal usam ~4 cilindros/mês cada
    consumo_mes_10 = max(20, pacs_semanal_10m3 * 4)
    consumo_mes_3 = max(5, pacs_conc)  # backup e trocas eventuais
    consumo_mes_1 = max(3, 4)

    # Dias estimados de estoque da licitação
    dias_10 = int((saldo_10 / (consumo_mes_10 / 30))) if consumo_mes_10 > 0 else 999
    dias_3 = int((saldo_3 / (consumo_mes_3 / 30))) if consumo_mes_3 > 0 else 999
    dias_1 = int((saldo_1 / (consumo_mes_1 / 30))) if consumo_mes_1 > 0 else 999

    # Quantidade sugerida para o próximo pedido de AF (para cobrir 30 a 45 dias)
    sug_10 = min(saldo_10, int(consumo_mes_10 * 1.5))
    sug_3 = min(saldo_3, int(consumo_mes_3 * 1.5))
    sug_1 = min(saldo_1, int(consumo_mes_1 * 1.5))

    itens = [
        ItemRequisicaoAF(
            tipo_cilindro="10m3",
            descricao="Cilindro de Oxigênio Medicinal 10m³ (Troca Semanal de Concentradores e Domiciliar)",
            saldo_licitacao_atual=saldo_10,
            consumo_medio_mensal=consumo_mes_10,
            previsao_dias_estoque=dias_10,
            quantidade_sugerida=sug_10,
            urgente=(dias_10 <= 20),
        ),
        ItemRequisicaoAF(
            tipo_cilindro="3m3",
            descricao="Cilindro de Oxigênio Medicinal 3m³ (Backup de Segurança p/ Queda de Energia em Concentradores)",
            saldo_licitacao_atual=saldo_3,
            consumo_medio_mensal=consumo_mes_3,
            previsao_dias_estoque=dias_3,
            quantidade_sugerida=sug_3,
            urgente=(dias_3 <= 20),
        ),
        ItemRequisicaoAF(
            tipo_cilindro="1m3",
            descricao="Cilindro de Oxigênio Medicinal 1m³ (Transporte de Pacientes e Situações Especiais)",
            saldo_licitacao_atual=saldo_1,
            consumo_medio_mensal=consumo_mes_1,
            previsao_dias_estoque=dias_1,
            quantidade_sugerida=sug_1,
            urgente=(dias_1 <= 20),
        ),
    ]

    justificativa = (
        f"A presente requisição de fornecimento (AF) fundamenta-se na necessidade contínua e ininterrupta de abastecimento de "
        f"oxigênio medicinal para atendimento de {pacs_dependentes} pacientes munícipes em oxigenoterapia domiciliar contínua "
        f"e dependentes de equipamentos respiratórios (concentradores de oxigênio, CPAP e BiPAP). "
        f"Considerando a taxa média de consumo mensal e a margem de segurança necessária para prevenir o desabastecimento de cilindros "
        f"de troca semanal (10m³) e de reserva emergencial (3m³), solicita-se o empenho e emissão da Autorização de Fornecimento "
        f"junto à empresa contratada nos quantitativos especificados."
    )

    return RequisicaoAFOut(
        codigo_requisicao=f"REQ-AF-{hoje.strftime('%Y%m')}-{(pacs_dependentes % 900) + 100:03d}",
        data_geracao=hoje,
        secretaria="Secretaria Municipal de Saúde",
        setor="Coordenação de Oxigenoterapia e Equipamentos Respiratórios",
        pacientes_ativos_dependentes=pacs_dependentes,
        itens=itens,
        justificativa_tecnica=justificativa,
        solicitante_nome=ator.nome,
        solicitante_cargo="Responsável Técnico / Setor de Oxigênio",
    )


# ==============================================================================
# 8. EXPORTAÇÃO EXCEL (.XLSX)
# ==============================================================================

@router.get("/exportar")
def exportar_oxigenio_xlsx(
    tipo: str = "todos",  # estoque, emprestimos, inativos, equipamentos, todos
    empresa_id: int | None = None,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("oxigenio_relatorios", "oxigenio", "usuarios")),
):
    hoje = date.today()
    linhas: list[dict[str, Any]] = []

    if tipo in ("inativos", "todos"):
        inativos = db.exec(
            select(EmprestimoOxigenio).where(EmprestimoOxigenio.status.in_(["INATIVO", "DEVOLVIDO"]))
        ).all()
        for e in inativos:
            linhas.append({
                "secao": "INATIVOS",
                "codigo_termo": e.codigo_termo,
                "paciente": e.paciente_nome,
                "cpf": e.paciente_cpf,
                "prontuario": e.paciente_prontuario,
                "tipo_servico": e.tipo_servico,
                "item": (e.tipo_equipamento or "") + (f" Cilindro {e.tipo_cilindro}" if e.tipo_cilindro else ""),
                "patrimonio": e.equipamento_patrimonio or "—",
                "data_instalacao": e.data_instalacao,
                "data_devolucao": e.data_devolucao,
                "status": e.status,
                "motivo_encerramento": e.motivo_inativacao or "—",
                "empresa": e.empresa_nome or "—",
                "observacoes": e.observacoes or "",
            })

    if tipo in ("emprestimos", "todos"):
        ativos = db.exec(select(EmprestimoOxigenio).where(EmprestimoOxigenio.status == "ATIVO")).all()
        for e in ativos:
            linhas.append({
                "secao": "ATIVOS",
                "codigo_termo": e.codigo_termo,
                "paciente": e.paciente_nome,
                "cpf": e.paciente_cpf,
                "prontuario": e.paciente_prontuario,
                "tipo_servico": e.tipo_servico,
                "item": (e.tipo_equipamento or "") + (f" Cilindro {e.tipo_cilindro}" if e.tipo_cilindro else ""),
                "patrimonio": e.equipamento_patrimonio or "—",
                "data_instalacao": e.data_instalacao,
                "data_devolucao": e.data_devolucao,
                "status": e.status,
                "motivo_encerramento": "Em uso ativo",
                "empresa": e.empresa_nome or "—",
                "observacoes": e.observacoes or "",
            })

    if tipo == "equipamentos":
        eqs = db.exec(select(EquipamentoRespiratorio)).all()
        for eq in eqs:
            tipo_label = "Concentrador 5L" if eq.tipo in ("CONCENTRADOR_5L", "CONCENTRADOR") else ("Concentrador 10L" if eq.tipo == "CONCENTRADOR_10L" else eq.tipo)
            linhas.append({
                "secao": "EQUIPAMENTOS",
                "codigo_termo": eq.patrimonio,
                "paciente": "—",
                "cpf": "—",
                "prontuario": "—",
                "tipo_servico": "MAQUINA",
                "item": f"{tipo_label} - {eq.marca_modelo}",
                "patrimonio": eq.patrimonio,
                "data_instalacao": eq.data_aquisicao,
                "data_devolucao": None,
                "status": eq.status,
                "motivo_encerramento": f"Propriedade: {eq.propriedade}",
                "empresa": eq.empresa_nome or "—",
                "observacoes": eq.observacoes or "",
            })

    colunas = [
        {"chave": "secao", "rotulo": "Categoria", "largura": 15},
        {"chave": "codigo_termo", "rotulo": "Termo / Código", "largura": 18},
        {"chave": "paciente", "rotulo": "Paciente", "largura": 32},
        {"chave": "cpf", "rotulo": "CPF", "largura": 16},
        {"chave": "prontuario", "rotulo": "Prontuário", "largura": 16},
        {"chave": "tipo_servico", "rotulo": "Tipo Serviço", "largura": 14},
        {"chave": "item", "rotulo": "Item / Equipamento / Cilindro", "largura": 30},
        {"chave": "patrimonio", "rotulo": "Patrimônio", "largura": 16},
        {"chave": "data_instalacao", "rotulo": "Data Instalação", "formato": "data", "largura": 16},
        {"chave": "data_devolucao", "rotulo": "Data Devolução", "formato": "data", "largura": 16},
        {"chave": "status", "rotulo": "Status", "largura": 14},
        {"chave": "motivo_encerramento", "rotulo": "Motivo Encerramento", "largura": 22},
        {"chave": "empresa", "rotulo": "Empresa Fornecedora", "largura": 26},
        {"chave": "observacoes", "rotulo": "Observações", "largura": 35},
    ]

    return resposta_xlsx(
        titulo="Relatório de Gestão de Oxigênio e Equipamentos Respiratórios",
        usuario_nome=ator.nome,
        colunas=colunas,
        linhas=linhas,
        arquivo_base=f"oxigenio_gestao_{tipo}",
        user_id=ator.id,
    )


# ==============================================================================
# 9. CILINDROS VAZIOS E RECOLHIMENTO
# ==============================================================================

@router.get("/cilindros-vazios", response_model=list[CilindroVazioOut])
def listar_cilindros_vazios(
    status: str = "PENDENTE",  # PENDENTE, RECOLHIDO, TODOS
    tipo_cilindro: str = "",
    paciente_id: int | None = None,
    empresa_id: int | None = None,
    q: str = "",
    db: Session = Depends(get_db),
    _: User = Depends(need_any_perm("oxigenio_emprestimos", "oxigenio", "usuarios")),
):
    stmt = select(CilindroVazioRecolhimento).order_by(desc(CilindroVazioRecolhimento.data_geracao), desc(CilindroVazioRecolhimento.id))
    if status and status.upper() != "TODOS":
        stmt = stmt.where(CilindroVazioRecolhimento.status == status.upper())
    if tipo_cilindro:
        stmt = stmt.where(CilindroVazioRecolhimento.tipo_cilindro == tipo_cilindro)
    if paciente_id:
        stmt = stmt.where(CilindroVazioRecolhimento.paciente_id == paciente_id)
    if empresa_id:
        stmt = stmt.where(CilindroVazioRecolhimento.empresa_id == empresa_id)
    if q.strip():
        t = f"%{q.strip().lower()}%"
        stmt = stmt.where(func.lower(CilindroVazioRecolhimento.paciente_nome).like(t))

    itens = db.exec(stmt).all()
    return [CilindroVazioOut.model_validate(it) for it in itens]


@router.post("/cilindros-vazios", response_model=CilindroVazioOut, status_code=201)
def registrar_cilindro_vazio(
    data: CilindroVazioIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_emprestimos", "criar")),
):
    pac = db.get(Paciente, data.paciente_id)
    if not pac:
        raise HTTPException(status_code=404, detail="Paciente não encontrado.")

    emp_id = data.empresa_id
    if not emp_id and data.emprestimo_id:
        emp_loan = db.get(EmprestimoOxigenio, data.emprestimo_id)
        if emp_loan:
            emp_id = emp_loan.empresa_id

    cv = CilindroVazioRecolhimento(
        paciente_id=pac.id,
        paciente_nome=pac.nome,
        emprestimo_id=data.emprestimo_id,
        empresa_id=emp_id,
        tipo_cilindro=data.tipo_cilindro,
        quantidade=data.quantidade,
        posse=data.posse,
        status="PENDENTE",
        data_geracao=date.today(),
        observacoes=data.observacoes.strip(),
    )
    db.add(cv)
    db.commit()
    db.refresh(cv)
    return CilindroVazioOut.model_validate(cv)


@router.post("/cilindros-vazios/{cilindro_id}/recolher", response_model=CilindroVazioOut)
def recolher_cilindro_vazio(
    cilindro_id: int,
    data: BaixaCilindroVazioIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_emprestimos", "editar")),
):
    cv = db.get(CilindroVazioRecolhimento, cilindro_id)
    if not cv:
        raise HTTPException(status_code=404, detail="Registro de cilindro vazio não encontrado.")

    cv.status = "RECOLHIDO"
    cv.data_recolhimento = data.data_recolhimento
    cv.responsavel_recolhimento = data.responsavel_recolhimento.strip() or ator.nome
    if data.observacoes.strip():
        nota = f"[Recolhimento em {data.data_recolhimento.strftime('%d/%m/%Y')}]: {data.observacoes.strip()}"
        cv.observacoes = (cv.observacoes + "\n" + nota).strip() if cv.observacoes else nota

    db.add(cv)
    db.commit()
    db.refresh(cv)
    return CilindroVazioOut.model_validate(cv)


# ==============================================================================
# 10. COMODATO DE CILINDROS (FORNECEDORA -> MUNICÍPIO)
# ==============================================================================

@router.get("/comodato", response_model=list[ComodatoMovimentacaoOut])
def listar_comodato(
    empresa_id: int | None = None,
    tipo_movimentacao: str = "",
    tipo_cilindro: str = "",
    db: Session = Depends(get_db),
    _: User = Depends(need_any_perm("oxigenio_estoque", "oxigenio", "usuarios")),
):
    stmt = select(CilindroComodatoMovimentacao).order_by(desc(CilindroComodatoMovimentacao.data_movimento), desc(CilindroComodatoMovimentacao.id))
    if empresa_id:
        stmt = stmt.where(CilindroComodatoMovimentacao.empresa_id == empresa_id)
    if tipo_movimentacao:
        stmt = stmt.where(CilindroComodatoMovimentacao.tipo_movimentacao == tipo_movimentacao.upper())
    if tipo_cilindro:
        stmt = stmt.where(CilindroComodatoMovimentacao.tipo_cilindro == tipo_cilindro)

    movs = db.exec(stmt).all()
    return [ComodatoMovimentacaoOut.model_validate(m) for m in movs]


@router.post("/comodato", response_model=ComodatoMovimentacaoOut, status_code=201)
def registrar_movimentacao_comodato(
    data: ComodatoMovimentacaoIn,
    db: Session = Depends(get_db),
    ator: User = Depends(need_perm("oxigenio_estoque", "criar")),
):
    emp = db.get(EmpresaOxigenio, data.empresa_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Empresa fornecedora não encontrada.")

    # Se for devolução à empresa, valida se há saldo suficiente para evitar inconsistência
    if data.tipo_movimentacao == "DEVOLUCAO_EMPRESA":
        movs = db.exec(
            select(CilindroComodatoMovimentacao).where(
                CilindroComodatoMovimentacao.empresa_id == data.empresa_id,
                CilindroComodatoMovimentacao.tipo_cilindro == data.tipo_cilindro,
            )
        ).all()
        ent = sum(m.quantidade for m in movs if m.tipo_movimentacao == "ENTRADA_COMODATO")
        dev = sum(m.quantidade for m in movs if m.tipo_movimentacao == "DEVOLUCAO_EMPRESA")
        saldo_atual = ent - dev
        if data.quantidade > saldo_atual and saldo_atual >= 0:
            raise HTTPException(
                status_code=400,
                detail=f"Quantidade a devolver ({data.quantidade}) é maior do que o saldo atual em comodato ({saldo_atual}) para cilindros {data.tipo_cilindro} desta empresa.",
            )

    try:
        mov = CilindroComodatoMovimentacao(
            empresa_id=emp.id,
            empresa_nome=emp.nome_fantasia or emp.razao_social,
            tipo_movimentacao=data.tipo_movimentacao,
            tipo_cilindro=data.tipo_cilindro,
            quantidade=data.quantidade,
            data_movimento=data.data_movimento or date.today(),
            numero_documento=data.numero_documento.strip(),
            responsavel=data.responsavel.strip() or ator.nome,
            observacoes=data.observacoes.strip(),
        )
        db.add(mov)
        db.commit()
        db.refresh(mov)
        return ComodatoMovimentacaoOut.model_validate(mov)
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao registrar movimentação de comodato: {str(exc)}",
        )


@router.post("/seed-dados-reais")
def carregar_dados_reais_planilha(
    force_clean: bool = True,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("oxigenio", "usuarios")),
):
    from app.services.seed_oxigenio import seed_oxigenio_dados_reais
    resultado = seed_oxigenio_dados_reais(db, force_clean=force_clean)
    if not resultado.get("ok"):
        raise HTTPException(status_code=500, detail=resultado.get("erro", "Erro ao carregar dados da planilha"))
    return resultado


@router.get("/comodato/saldos", response_model=list[ComodatoSaldoOut])
def saldos_comodato(
    empresa_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(need_any_perm("oxigenio_estoque", "oxigenio", "usuarios")),
):
    resultado = []
    for tipo_c in ["10m3", "3m3", "1m3"]:
        stmt = select(CilindroComodatoMovimentacao).where(CilindroComodatoMovimentacao.tipo_cilindro == tipo_c)
        if empresa_id:
            stmt = stmt.where(CilindroComodatoMovimentacao.empresa_id == empresa_id)
        movs = db.exec(stmt).all()
        ent = sum(m.quantidade for m in movs if m.tipo_movimentacao == "ENTRADA_COMODATO")
        dev = sum(m.quantidade for m in movs if m.tipo_movimentacao == "DEVOLUCAO_EMPRESA")
        resultado.append(ComodatoSaldoOut(
            tipo_cilindro=tipo_c,
            total_recebido=ent,
            total_devolvido=dev,
            saldo_em_comodato=max(0, ent - dev),
        ))
    return resultado


# ==============================================================================
# 11. RELATÓRIO DE FATURAMENTO E USO FINANCEIRO CONSOLIDADO
# ==============================================================================

@router.get("/relatorios/faturamento", response_model=RelatorioFaturamentoOut)
def relatorio_faturamento_mensal(
    mes: int | None = None,
    ano: int | None = None,
    empresa_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(need_any_perm("oxigenio_relatorios", "oxigenio", "usuarios")),
):
    hoje = date.today()
    mes_calc = mes or hoje.month
    ano_calc = ano or hoje.year

    p_dia = date(ano_calc, mes_calc, 1)
    if mes_calc == 12:
        u_dia = date(ano_calc + 1, 1, 1) - timedelta(days=1)
    else:
        u_dia = date(ano_calc, mes_calc + 1, 1) - timedelta(days=1)

    emp_nome = None
    emp_obj = None
    if empresa_id:
        emp_obj = db.get(EmpresaOxigenio, empresa_id)
        if emp_obj:
            emp_nome = emp_obj.nome_fantasia or emp_obj.razao_social
    else:
        # Se não filtrado por empresa específica, pega a primeira empresa ativa para referência de valores
        emp_obj = db.exec(select(EmpresaOxigenio).where(EmpresaOxigenio.ativo == True)).first()

    # Busca licitação ativa para obter preços unitários complementares
    lic_stmt = select(LicitacaoContratoOxigenio).where(LicitacaoContratoOxigenio.ativo == True)
    if empresa_id:
        lic_stmt = lic_stmt.where(LicitacaoContratoOxigenio.empresa_id == empresa_id)
    lic = db.exec(lic_stmt).first()

    # Prioriza valores unitários centralizados na Empresa; se não preenchidos (>0), consulta licitação; senão padrão
    val_10 = (emp_obj.valor_unitario_10m3 if emp_obj and getattr(emp_obj, "valor_unitario_10m3", 0.0) > 0
              else (lic.valor_unitario_10m3 if lic and lic.valor_unitario_10m3 > 0 else 110.0))
    val_3 = (emp_obj.valor_unitario_3m3 if emp_obj and getattr(emp_obj, "valor_unitario_3m3", 0.0) > 0
             else (lic.valor_unitario_3m3 if lic and lic.valor_unitario_3m3 > 0 else 60.0))
    val_1 = (emp_obj.valor_unitario_1m3 if emp_obj and getattr(emp_obj, "valor_unitario_1m3", 0.0) > 0
             else (lic.valor_unitario_1m3 if lic and lic.valor_unitario_1m3 > 0 else 35.0))
    val_loc_conc_5l = (
        emp_obj.locacao_mensal_concentrador_5l if emp_obj and getattr(emp_obj, "locacao_mensal_concentrador_5l", 0.0) > 0
        else (lic.locacao_mensal_concentrador_5l if lic and getattr(lic, "locacao_mensal_concentrador_5l", 0.0) > 0
        else (emp_obj.locacao_mensal_concentrador if emp_obj and getattr(emp_obj, "locacao_mensal_concentrador", 0.0) > 0
        else (lic.locacao_mensal_concentrador if lic and getattr(lic, "locacao_mensal_concentrador", 0.0) > 0 else 380.0)))
    )
    val_loc_conc_10l = (
        emp_obj.locacao_mensal_concentrador_10l if emp_obj and getattr(emp_obj, "locacao_mensal_concentrador_10l", 0.0) > 0
        else (lic.locacao_mensal_concentrador_10l if lic and getattr(lic, "locacao_mensal_concentrador_10l", 0.0) > 0 else 480.0)
    )
    val_loc_conc = val_loc_conc_5l
    val_loc_cpap = (emp_obj.locacao_mensal_cpap if emp_obj and getattr(emp_obj, "locacao_mensal_cpap", 0.0) > 0
                    else (lic.locacao_mensal_cpap if lic and lic.locacao_mensal_cpap > 0 else 250.0))
    val_loc_bipap = (emp_obj.locacao_mensal_bipap if emp_obj and getattr(emp_obj, "locacao_mensal_bipap", 0.0) > 0
                     else (lic.locacao_mensal_bipap if lic and lic.locacao_mensal_bipap > 0 else 320.0))

    # 1. Recargas de Cilindros realizadas no período (Trocas + Compras)
    trocas_stmt = select(TrocaCilindroHistorico).where(
        TrocaCilindroHistorico.data_troca >= p_dia,
        TrocaCilindroHistorico.data_troca <= u_dia,
    )
    if empresa_id:
        trocas_stmt = trocas_stmt.where(TrocaCilindroHistorico.empresa_id == empresa_id)
    trocas_mes = db.exec(trocas_stmt).all()

    # Compras / Abastecimentos faturados no mês
    compras_stmt = select(EntradaCompraOxigenio).where(
        EntradaCompraOxigenio.data_compra >= p_dia,
        EntradaCompraOxigenio.data_compra <= u_dia,
    ).order_by(EntradaCompraOxigenio.data_compra)
    if empresa_id:
        compras_stmt = compras_stmt.where(EntradaCompraOxigenio.empresa_id == empresa_id)
    compras_mes = db.exec(compras_stmt).all()

    c10_trocas = sum(t.quantidade for t in trocas_mes if t.tipo_cilindro == "10m3")
    c3_trocas = sum(t.quantidade for t in trocas_mes if t.tipo_cilindro == "3m3")
    c1_trocas = sum(t.quantidade for t in trocas_mes if t.tipo_cilindro == "1m3")

    c10_compras = sum(c.qtd_10m3 for c in compras_mes)
    c3_compras = sum(c.qtd_3m3 for c in compras_mes)
    c1_compras = sum(c.qtd_1m3 for c in compras_mes)

    # Usa o maior entre consumo registrado e compras faturadas
    tot_recargas_10 = max(c10_trocas, c10_compras)
    tot_recargas_3 = max(c3_trocas, c3_compras)
    tot_recargas_1 = max(c1_trocas, c1_compras)

    subtot_rec_10 = round(tot_recargas_10 * val_10, 2)
    subtot_rec_3 = round(tot_recargas_3 * val_3, 2)
    subtot_rec_1 = round(tot_recargas_1 * val_1, 2)
    subtotal_recargas = round(subtot_rec_10 + subtot_rec_3 + subtot_rec_1, 2)

    # Constrói o histórico individual de cada entrega do mês (estilo aba Abastecimento)
    historico_abastecimentos = []
    for c in compras_mes:
        if c.qtd_10m3 > 0:
            historico_abastecimentos.append({
                "data": c.data_compra.strftime("%d/%m/%Y"),
                "descricao": "10m³",
                "quantidade": c.qtd_10m3,
                "valor_unitario": val_10,
                "valor_total": round(c.qtd_10m3 * val_10, 2),
                "numero_nf": c.numero_nf,
                "empresa": c.empresa_nome,
            })
        if c.qtd_3m3 > 0:
            historico_abastecimentos.append({
                "data": c.data_compra.strftime("%d/%m/%Y"),
                "descricao": "3m³",
                "quantidade": c.qtd_3m3,
                "valor_unitario": val_3,
                "valor_total": round(c.qtd_3m3 * val_3, 2),
                "numero_nf": c.numero_nf,
                "empresa": c.empresa_nome,
            })
        if c.qtd_1m3 > 0:
            historico_abastecimentos.append({
                "data": c.data_compra.strftime("%d/%m/%Y"),
                "descricao": "1m³",
                "quantidade": c.qtd_1m3,
                "valor_unitario": val_1,
                "valor_total": round(c.qtd_1m3 * val_1, 2),
                "numero_nf": c.numero_nf,
                "empresa": c.empresa_nome,
            })

    # 2. Pacientes Ativos e Locações Fixas de Equipamentos no mês
    emp_stmt = select(EmprestimoOxigenio).where(
        EmprestimoOxigenio.status == "ATIVO",
        EmprestimoOxigenio.data_instalacao <= u_dia,
    )
    if empresa_id:
        emp_stmt = emp_stmt.where(EmprestimoOxigenio.empresa_id == empresa_id)
    ativos = db.exec(emp_stmt).all()

    pacs_total = len({e.paciente_id for e in ativos})
    pacs_ox = len([e for e in ativos if e.tipo_servico == "OXIGENIO" or e.tipo_cilindro])

    n_conc_5l = len([e for e in ativos if e.tipo_equipamento in ["CONCENTRADOR_5L", "CONCENTRADOR"]])
    n_conc_10l = len([e for e in ativos if e.tipo_equipamento == "CONCENTRADOR_10L"])
    n_conc = n_conc_5l + n_conc_10l
    n_cpap = len([e for e in ativos if e.tipo_equipamento == "CPAP"])
    n_bipap = len([e for e in ativos if e.tipo_equipamento == "BiPAP"])

    tot_loc_conc_5l = round(n_conc_5l * val_loc_conc_5l, 2)
    tot_loc_conc_10l = round(n_conc_10l * val_loc_conc_10l, 2)
    tot_loc_conc = round(tot_loc_conc_5l + tot_loc_conc_10l, 2)
    tot_loc_cpap = round(n_cpap * val_loc_cpap, 2)
    tot_loc_bipap = round(n_bipap * val_loc_bipap, 2)
    subtotal_locacoes = round(tot_loc_conc + tot_loc_cpap + tot_loc_bipap, 2)

    total_geral = round(subtotal_recargas + subtotal_locacoes, 2)

    # 3. Comparativo de Licitação vs Consumo vs Pacientes
    lics_stmt = select(LicitacaoContratoOxigenio).where(LicitacaoContratoOxigenio.ativo == True)
    if empresa_id:
        lics_stmt = lics_stmt.where(LicitacaoContratoOxigenio.empresa_id == empresa_id)
    lics_ativas = db.exec(lics_stmt).all()

    tot_lic_10 = sum(l.qtd_contratada_10m3 for l in lics_ativas)
    tot_lic_3 = sum(l.qtd_contratada_3m3 for l in lics_ativas)
    tot_lic_1 = sum(l.qtd_contratada_1m3 for l in lics_ativas)

    comp_acum_stmt = select(
        func.coalesce(func.sum(EntradaCompraOxigenio.qtd_10m3), 0),
        func.coalesce(func.sum(EntradaCompraOxigenio.qtd_3m3), 0),
        func.coalesce(func.sum(EntradaCompraOxigenio.qtd_1m3), 0),
    ).where(EntradaCompraOxigenio.data_compra <= u_dia)
    if empresa_id:
        comp_acum_stmt = comp_acum_stmt.where(EntradaCompraOxigenio.empresa_id == empresa_id)
    acum_res = db.exec(comp_acum_stmt).first()
    acum_10 = int(acum_res[0]) if acum_res else 0
    acum_3 = int(acum_res[1]) if acum_res else 0
    acum_1 = int(acum_res[2]) if acum_res else 0

    saldo_lic_10 = max(0, tot_lic_10 - acum_10)
    saldo_lic_3 = max(0, tot_lic_3 - acum_3)
    saldo_lic_1 = max(0, tot_lic_1 - acum_1)

    # Cilindros em poder dos pacientes
    itens_pacs = db.exec(
        select(ItemEmprestimoOxigenio)
        .join(EmprestimoOxigenio, ItemEmprestimoOxigenio.emprestimo_id == EmprestimoOxigenio.id)
        .where(
            EmprestimoOxigenio.status == "ATIVO",
            EmprestimoOxigenio.data_instalacao <= u_dia,
            ItemEmprestimoOxigenio.status == "ATIVO",
        )
    ).all()
    pacs_c10 = sum(it.quantidade for it in itens_pacs if it.tipo_cilindro == "10m3")
    pacs_c3 = sum(it.quantidade for it in itens_pacs if it.tipo_cilindro == "3m3")
    pacs_c1 = sum(it.quantidade for it in itens_pacs if it.tipo_cilindro == "1m3")

    for e in ativos:
        if e.tipo_cilindro and not any(it.emprestimo_id == e.id for it in itens_pacs):
            if e.tipo_cilindro == "10m3":
                pacs_c10 += e.quantidade or 1
            elif e.tipo_cilindro == "3m3":
                pacs_c3 += e.quantidade or 1
            elif e.tipo_cilindro == "1m3":
                pacs_c1 += e.quantidade or 1

    # Saldos de Comodato
    comod_saldos = {}
    for tc in ["10m3", "3m3", "1m3"]:
        comod_q = select(CilindroComodatoMovimentacao).where(
            CilindroComodatoMovimentacao.tipo_cilindro == tc,
            CilindroComodatoMovimentacao.data_movimento <= u_dia,
        )
        if empresa_id:
            comod_q = comod_q.where(CilindroComodatoMovimentacao.empresa_id == empresa_id)
        movs = db.exec(comod_q).all()
        ent = sum(m.quantidade for m in movs if m.tipo_movimentacao == "ENTRADA_COMODATO")
        dev = sum(m.quantidade for m in movs if m.tipo_movimentacao == "DEVOLUCAO_EMPRESA")
        comod_saldos[tc] = max(0, ent - dev)

    # 4. Detalhes de pacientes e itens para exibição em tabela
    detalhes = []
    itens_faturamento: list[ItemFaturamentoPaciente] = []
    for e in ativos:
        tipo_item_desc = (
            "Concentrador 5L" if e.tipo_equipamento in ("CONCENTRADOR_5L", "CONCENTRADOR")
            else "Concentrador 10L" if e.tipo_equipamento == "CONCENTRADOR_10L"
            else e.tipo_equipamento or (f"Cilindro {e.tipo_cilindro}" if e.tipo_cilindro else "Oxigênio")
        )
        val_unit = (
            val_loc_conc_5l if e.tipo_equipamento in ("CONCENTRADOR_5L", "CONCENTRADOR")
            else val_loc_conc_10l if e.tipo_equipamento == "CONCENTRADOR_10L"
            else val_loc_cpap if e.tipo_equipamento == "CPAP"
            else val_loc_bipap if e.tipo_equipamento == "BiPAP"
            else val_10 if e.tipo_cilindro == "10m3"
            else val_3 if e.tipo_cilindro == "3m3"
            else val_1 if e.tipo_cilindro == "1m3"
            else 0.0
        )
        detalhes.append({
            "paciente": e.paciente_nome,
            "cpf": e.paciente_cpf,
            "tipo_servico": e.tipo_servico,
            "tipo_item": tipo_item_desc,
            "data_instalacao": e.data_instalacao.strftime("%d/%m/%Y"),
            "empresa": e.empresa_nome or "—",
            "valor_unitario": val_unit,
            "subtotal": val_unit,
        })
        if e.tipo_equipamento:
            itens_faturamento.append(ItemFaturamentoPaciente(
                paciente_nome=e.paciente_nome,
                paciente_cpf=e.paciente_cpf or "",
                prontuario=e.paciente_prontuario or "",
                tipo_servico=e.tipo_servico,
                item_descricao=f"{tipo_item_desc} (Patr. {e.equipamento_patrimonio or 'S/N'})",
                tipo_custo="FIXO_LOCACAO",
                quantidade=1,
                valor_unitario=val_unit,
                subtotal=val_unit,
                empresa=e.empresa_nome or "—",
                data_instalacao=e.data_instalacao.strftime("%d/%m/%Y"),
            ))

    # Adiciona itens de recargas consolidadas à lista de faturamento
    if tot_recargas_10 > 0:
        itens_faturamento.append(ItemFaturamentoPaciente(
            paciente_nome="Consumo Municipal Consolidado",
            prontuario="SMS-O2",
            tipo_servico="OXIGENIO",
            item_descricao="Recargas de Cilindro de Oxigênio 10m³",
            tipo_custo="VARIAVEL_RECARGA",
            quantidade=tot_recargas_10,
            valor_unitario=val_10,
            subtotal=subtot_rec_10,
            empresa=emp_nome or "COMERCIAL PITIA LTDA",
            data_instalacao=p_dia.strftime("%d/%m/%Y"),
        ))
    if tot_recargas_3 > 0:
        itens_faturamento.append(ItemFaturamentoPaciente(
            paciente_nome="Consumo Municipal Consolidado",
            prontuario="SMS-O2",
            tipo_servico="OXIGENIO",
            item_descricao="Recargas de Cilindro de Oxigênio 3m³",
            tipo_custo="VARIAVEL_RECARGA",
            quantidade=tot_recargas_3,
            valor_unitario=val_3,
            subtotal=subtot_rec_3,
            empresa=emp_nome or "COMERCIAL PITIA LTDA",
            data_instalacao=p_dia.strftime("%d/%m/%Y"),
        ))
    if tot_recargas_1 > 0:
        itens_faturamento.append(ItemFaturamentoPaciente(
            paciente_nome="Consumo Municipal Consolidado",
            prontuario="SMS-O2",
            tipo_servico="OXIGENIO",
            item_descricao="Recargas de Cilindro de Oxigênio 1m³",
            tipo_custo="VARIAVEL_RECARGA",
            quantidade=tot_recargas_1,
            valor_unitario=val_1,
            subtotal=subtot_rec_1,
            empresa=emp_nome or "COMERCIAL PITIA LTDA",
            data_instalacao=p_dia.strftime("%d/%m/%Y"),
        ))

    # 5. Consolidação por Fornecedora (aba Financeiro)
    faturamento_por_empresa = []
    todas_empresas = db.exec(select(EmpresaOxigenio).where(EmpresaOxigenio.ativo == True)).all()
    for emp in todas_empresas:
        sub_rec = 0.0
        sub_loc = 0.0
        qtd_maqs = 0
        m3_o2 = 0.0

        if "oxigenio_cilindros" in emp.servicos or emp.valor_unitario_10m3 > 0:
            rec_emp_10 = sum(c.qtd_10m3 for c in compras_mes if c.empresa_id == emp.id)
            rec_emp_3 = sum(c.qtd_3m3 for c in compras_mes if c.empresa_id == emp.id)
            rec_emp_1 = sum(c.qtd_1m3 for c in compras_mes if c.empresa_id == emp.id)
            sub_rec = (rec_emp_10 * (emp.valor_unitario_10m3 or val_10) +
                       rec_emp_3 * (emp.valor_unitario_3m3 or val_3) +
                       rec_emp_1 * (emp.valor_unitario_1m3 or val_1))
            m3_o2 = (rec_emp_10 * 10) + (rec_emp_3 * 3) + (rec_emp_1 * 1)

        maqs_emp = [e for e in ativos if e.empresa_id == emp.id or emp.nome_fantasia in (e.empresa_nome or "")]
        for m in maqs_emp:
            qtd_maqs += 1
            if m.tipo_equipamento in ("CONCENTRADOR_5L", "CONCENTRADOR"):
                sub_loc += emp.locacao_mensal_concentrador_5l or emp.locacao_mensal_concentrador or 85.0
            elif m.tipo_equipamento == "CONCENTRADOR_10L":
                sub_loc += emp.locacao_mensal_concentrador_10l or 299.0
            elif m.tipo_equipamento == "CPAP":
                sub_loc += emp.locacao_mensal_cpap or 49.99
            elif m.tipo_equipamento == "BiPAP":
                sub_loc += emp.locacao_mensal_bipap or 800.0

        if sub_rec > 0 or sub_loc > 0 or emp.id == empresa_id:
            faturamento_por_empresa.append({
                "empresa_id": emp.id,
                "empresa_nome": emp.nome_fantasia or emp.razao_social,
                "total_recargas": round(sub_rec, 2),
                "total_locacoes": round(sub_loc, 2),
                "total_geral": round(sub_rec + sub_loc, 2),
                "maquinas_ativas": qtd_maqs,
                "m3_oxigenio": m3_o2,
            })

    meses_nomes = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
    periodo_fmt = f"{meses_nomes[mes_calc - 1]} de {ano_calc}"

    tot_m3 = (tot_recargas_10 * 10) + (tot_recargas_3 * 3) + (tot_recargas_1 * 1)
    tot_maquinas = n_conc + n_cpap + n_bipap

    return RelatorioFaturamentoOut(
        mes=mes_calc,
        ano=ano_calc,
        empresa_id=empresa_id,
        empresa_nome=emp_nome,
        periodo_formatado=periodo_fmt,
        pacientes_ativos_total=pacs_total,
        pacientes_ativos_oxigenio=pacs_ox,
        pacientes_ativos_concentrador=n_conc,
        pacientes_ativos_cpap=n_cpap,
        pacientes_ativos_bipap=n_bipap,
        recargas_10m3_qtd=tot_recargas_10,
        recargas_10m3_unit=val_10,
        recargas_10m3_total=subtot_rec_10,
        recargas_3m3_qtd=tot_recargas_3,
        recargas_3m3_unit=val_3,
        recargas_3m3_total=subtot_rec_3,
        recargas_1m3_qtd=tot_recargas_1,
        recargas_1m3_unit=val_1,
        recargas_1m3_total=subtot_rec_1,
        subtotal_recargas=subtotal_recargas,
        locacao_concentradores_qtd=n_conc,
        locacao_concentradores_unit=val_loc_conc,
        locacao_concentradores_total=tot_loc_conc,
        locacao_concentradores_5l_qtd=n_conc_5l,
        locacao_concentradores_5l_unit=val_loc_conc_5l,
        locacao_concentradores_5l_total=tot_loc_conc_5l,
        locacao_concentradores_10l_qtd=n_conc_10l,
        locacao_concentradores_10l_unit=val_loc_conc_10l,
        locacao_concentradores_10l_total=tot_loc_conc_10l,
        locacao_cpaps_qtd=n_cpap,
        locacao_cpaps_unit=val_loc_cpap,
        locacao_cpaps_total=tot_loc_cpap,
        locacao_bipaps_qtd=n_bipap,
        locacao_bipaps_unit=val_loc_bipap,
        locacao_bipaps_total=tot_loc_bipap,
        subtotal_locacoes=subtotal_locacoes,
        total_geral_faturamento=total_geral,
        detalhes_pacientes=detalhes,
        total_faturamento=total_geral,
        total_custo_recargas=subtotal_recargas,
        total_custo_locacoes=subtotal_locacoes,
        total_pacientes_atendidos=pacs_total,
        total_m3_oxigenio=float(tot_m3),
        total_maquinas_locadas=tot_maquinas,
        data_geracao=date.today().isoformat(),
        itens=itens_faturamento,
        contratado_licitacao_10m3=tot_lic_10,
        contratado_licitacao_3m3=tot_lic_3,
        contratado_licitacao_1m3=tot_lic_1,
        acumulado_consumido_10m3=acum_10,
        acumulado_consumido_3m3=acum_3,
        acumulado_consumido_1m3=acum_1,
        saldo_restante_licitacao_10m3=saldo_lic_10,
        saldo_restante_licitacao_3m3=saldo_lic_3,
        saldo_restante_licitacao_1m3=saldo_lic_1,
        cilindros_em_pacientes_10m3=pacs_c10,
        cilindros_em_pacientes_3m3=pacs_c3,
        cilindros_em_pacientes_1m3=pacs_c1,
        comodato_saldo_10m3=comod_saldos.get("10m3", 0),
        comodato_saldo_3m3=comod_saldos.get("3m3", 0),
        comodato_saldo_1m3=comod_saldos.get("1m3", 0),
        historico_abastecimentos=historico_abastecimentos,
        faturamento_por_empresa=faturamento_por_empresa,
    )


@router.get("/relatorios/faturamento/exportar")
def exportar_faturamento_xlsx(
    mes: int | None = None,
    ano: int | None = None,
    empresa_id: int | None = None,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("oxigenio_relatorios", "oxigenio", "usuarios")),
):
    dados = relatorio_faturamento_mensal(mes=mes, ano=ano, empresa_id=empresa_id, db=db, _=ator)

    linhas_locacoes = []
    if dados.locacao_concentradores_10l_qtd > 0 or dados.locacao_concentradores_5l_qtd > 0:
        if dados.locacao_concentradores_5l_qtd > 0 or dados.locacao_concentradores_5l_unit > 0:
            linhas_locacoes.append({"categoria": "LOCAÇÃO DE EQUIPAMENTOS (FIXO)", "item": "Locação Mensal Concentrador 5L", "quantidade": dados.locacao_concentradores_5l_qtd, "valor_unitario": dados.locacao_concentradores_5l_unit, "valor_total": dados.locacao_concentradores_5l_total, "tipo_custo": "Fixo Mensal"})
        if dados.locacao_concentradores_10l_qtd > 0 or dados.locacao_concentradores_10l_unit > 0:
            linhas_locacoes.append({"categoria": "LOCAÇÃO DE EQUIPAMENTOS (FIXO)", "item": "Locação Mensal Concentrador 10L", "quantidade": dados.locacao_concentradores_10l_qtd, "valor_unitario": dados.locacao_concentradores_10l_unit, "valor_total": dados.locacao_concentradores_10l_total, "tipo_custo": "Fixo Mensal"})
    else:
        linhas_locacoes.append({"categoria": "LOCAÇÃO DE EQUIPAMENTOS (FIXO)", "item": "Locação Mensal Concentrador de O2", "quantidade": dados.locacao_concentradores_qtd, "valor_unitario": dados.locacao_concentradores_unit, "valor_total": dados.locacao_concentradores_total, "tipo_custo": "Fixo Mensal"})

    linhas_locacoes.extend([
        {"categoria": "LOCAÇÃO DE EQUIPAMENTOS (FIXO)", "item": "Locação Mensal CPAP", "quantidade": dados.locacao_cpaps_qtd, "valor_unitario": dados.locacao_cpaps_unit, "valor_total": dados.locacao_cpaps_total, "tipo_custo": "Fixo Mensal"},
        {"categoria": "LOCAÇÃO DE EQUIPAMENTOS (FIXO)", "item": "Locação Mensal BiPAP", "quantidade": dados.locacao_bipaps_qtd, "valor_unitario": dados.locacao_bipaps_unit, "valor_total": dados.locacao_bipaps_total, "tipo_custo": "Fixo Mensal"},
    ])

    linhas = [
        # Seção Recargas
        {"categoria": "CONSUMO CONTÍNUO (RECARGAS)", "item": "Recarga Cilindro 10m³", "quantidade": dados.recargas_10m3_qtd, "valor_unitario": dados.recargas_10m3_unit, "valor_total": dados.recargas_10m3_total, "tipo_custo": "Variável / Consumo"},
        {"categoria": "CONSUMO CONTÍNUO (RECARGAS)", "item": "Recarga Cilindro 3m³", "quantidade": dados.recargas_3m3_qtd, "valor_unitario": dados.recargas_3m3_unit, "valor_total": dados.recargas_3m3_total, "tipo_custo": "Variável / Consumo"},
        {"categoria": "CONSUMO CONTÍNUO (RECARGAS)", "item": "Recarga Cilindro 1m³", "quantidade": dados.recargas_1m3_qtd, "valor_unitario": dados.recargas_1m3_unit, "valor_total": dados.recargas_1m3_total, "tipo_custo": "Variável / Consumo"},
        {"categoria": "SUBTOTAL RECARGAS", "item": "Total de Insumos / Gases", "quantidade": dados.recargas_10m3_qtd + dados.recargas_3m3_qtd + dados.recargas_1m3_qtd, "valor_unitario": None, "valor_total": dados.subtotal_recargas, "tipo_custo": "Subtotal Variável"},

        # Seção Locações
        *linhas_locacoes,
        {"categoria": "SUBTOTAL LOCAÇÕES", "item": "Total de Locações de Máquinas", "quantidade": dados.locacao_concentradores_qtd + dados.locacao_cpaps_qtd + dados.locacao_bipaps_qtd, "valor_unitario": None, "valor_total": dados.subtotal_locacoes, "tipo_custo": "Subtotal Fixo"},

        # Total Geral
        {"categoria": "TOTAL GERAL FATURAMENTO", "item": f"Consolidado Mês {dados.periodo_formatado}", "quantidade": None, "valor_unitario": None, "valor_total": dados.total_geral_faturamento, "tipo_custo": "Total a Faturar"},
    ]

    colunas = [
        {"chave": "categoria", "rotulo": "Categoria de Faturamento", "largura": 32},
        {"chave": "item", "rotulo": "Item / Descrição", "largura": 35},
        {"chave": "quantidade", "rotulo": "Qtd / Ativos", "largura": 14},
        {"chave": "valor_unitario", "rotulo": "Valor Unitário (R$)", "formato": "moeda", "largura": 18},
        {"chave": "valor_total", "rotulo": "Valor Total (R$)", "formato": "moeda", "largura": 18},
        {"chave": "tipo_custo", "rotulo": "Classificação Orçamentária", "largura": 24},
    ]

    return resposta_xlsx(
        titulo=f"Faturamento e Demonstrativo Financeiro - Oxigenioterapia ({dados.periodo_formatado})",
        usuario_nome=ator.nome,
        colunas=colunas,
        linhas=linhas,
        arquivo_base=f"faturamento_oxigenio_{dados.ano}_{dados.mes:02d}",
        user_id=ator.id,
    )
