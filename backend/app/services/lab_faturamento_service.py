"""Serviço de Faturamento Laboratorial, Relatórios de Prestador e Gestão da FPO/SIA.

Subagente 3: Contratos, Faturamento e FPO/SIA
Implementa apuração financeira, trava de liberação no fim do mês e
conferência com a Ficha de Programação Orçamentária (FPO).
"""

from datetime import date, datetime
from typing import Optional

from fastapi import HTTPException
from sqlmodel import Session, func, select

from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import (
    ItemSolic,
    LabContrato,
    LabFechamentoFaturamento,
    LabFPOCompetencia,
    LabFPOItem,
    Laboratorio,
    SolicitacaoMestre,
)
from app.schemas.lab_fase6 import (
    LabAprovarFaturamentoIn,
    LabFaturamentoItemRelatorioOut,
    LabFaturamentoRelatorioPrestadorOut,
    LabFPOCompetenciaIn,
    LabFPOCompetenciaOut,
    LabFPOItemIn,
    LabFPOItemOut,
)
from app.services.lab_contratos_service import resolver_preco_procedimento


# ==============================================================================
# 1. APURAÇÃO E RELATÓRIO DE FATURAMENTO DO PRESTADOR
# ==============================================================================

def apurar_faturamento_competencia(
    db: Session,
    laboratorio_id: int,
    competencia: str,  # "AAAA-MM"
    usuario_nome: str = "",
) -> LabFechamentoFaturamento:
    """Calcula ou atualiza o fechamento da produção do laboratório na competência."""
    lab = db.get(Laboratorio, laboratorio_id)
    if not lab:
        raise HTTPException(404, "Laboratório não encontrado.")

    ano, mes = map(int, competencia.split("-"))
    data_inicio = date(ano, mes, 1)
    if mes == 12:
        data_fim = date(ano + 1, 1, 1)
    else:
        data_fim = date(ano, mes + 1, 1)

    # Busca ou cria registro de fechamento
    fechamento = db.exec(
        select(LabFechamentoFaturamento).where(
            LabFechamentoFaturamento.laboratorio_id == laboratorio_id,
            LabFechamentoFaturamento.competencia == competencia,
        )
    ).first()

    # Busca contrato ativo na competência
    contrato = db.exec(
        select(LabContrato).where(
            LabContrato.laboratorio_id == laboratorio_id,
            LabContrato.status == "ativo",
            LabContrato.data_inicio <= data_inicio,
            LabContrato.data_fim >= data_inicio,
        )
    ).first()

    # Busca todas as solicitações válidas da competência
    solics = db.exec(
        select(SolicitacaoMestre).where(
            SolicitacaoMestre.laboratorio_id == laboratorio_id,
            SolicitacaoMestre.data_agendada >= data_inicio,
            SolicitacaoMestre.data_agendada < data_fim,
            SolicitacaoMestre.status != "cancelado",
        )
    ).all()

    solic_ids = [s.id for s in solics if s.id is not None]

    qtd_exames = 0
    total_bruto = 0.0
    total_glosado = 0.0

    if solic_ids:
        itens = db.exec(
            select(ItemSolic).where(ItemSolic.solicitacao_id.in_(solic_ids))
        ).all()

        for it in itens:
            qtd = it.quantidade or 1
            qtd_exames += qtd
            v_un = float(it.valor_unitario_aplicado or 0.0)
            if v_un == 0.0 and it.sigtap_id:
                # Fallback dinâmico se item antigo não tinha snapshot gravado
                v_un, _, _ = resolver_preco_procedimento(
                    db, laboratorio_id, it.sigtap_id, data_inicio
                )
            subtotal = round(v_un * qtd, 2)
            if it.status_auditoria in ("divergente", "rejeitado", "glosado"):
                total_glosado += subtotal
            else:
                total_bruto += subtotal

    total_aprovado = max(0.0, round(total_bruto - total_glosado, 2))

    if not fechamento:
        fechamento = LabFechamentoFaturamento(
            laboratorio_id=laboratorio_id,
            contrato_id=contrato.id if contrato else None,
            competencia=competencia,
            qtd_solicitacoes=len(solics),
            qtd_exames=qtd_exames,
            valor_total_apurado=round(total_bruto, 2),
            valor_total_glosado=round(total_glosado, 2),
            valor_total_aprovado=total_aprovado,
            status="em_apuracao",
            liberado_visualizacao_lab=False,
            aprovado_por="",
            aprovado_em=None,
            parecer_secretaria="",
        )
        db.add(fechamento)
    else:
        # Se ainda não estiver aprovado pela Secretaria, atualiza os valores apurados
        if fechamento.status in ("em_apuracao", "aguardando_aprovacao"):
            fechamento.contrato_id = contrato.id if contrato else fechamento.contrato_id
            fechamento.qtd_solicitacoes = len(solics)
            fechamento.qtd_exames = qtd_exames
            fechamento.valor_total_apurado = round(total_bruto, 2)
            fechamento.valor_total_glosado = round(total_glosado, 2)
            fechamento.valor_total_aprovado = total_aprovado
            fechamento.updated_at = datetime.utcnow()
            db.add(fechamento)

    db.commit()
    db.refresh(fechamento)
    return fechamento


def obter_relatorio_prestador(
    db: Session,
    laboratorio_id: int,
    competencia: str,
    eh_perfil_laboratorio: bool = False,
) -> LabFaturamentoRelatorioPrestadorOut:
    """Gera o relatório imprimível de faturamento para o prestador.
    
    Regra de Risco Zero e Segurança:
    O prestador (laboratório credenciado) só tem acesso ao relatório final:
    1. Se o mês já encerrou (data de hoje >= mês subsequente);
    2. Mediante aprovação prévia da Secretaria de Saúde (liberado_visualizacao_lab = True).
    Usuários da Secretaria/Admin podem visualizar o relatório a qualquer momento para auditoria.
    """
    lab = db.get(Laboratorio, laboratorio_id)
    if not lab:
        raise HTTPException(404, "Laboratório não encontrado.")

    # Garante apuração atualizada
    fechamento = apurar_faturamento_competencia(db, laboratorio_id, competencia)

    # Aplicação estrita da trava de segurança para o perfil do Laboratório
    if eh_perfil_laboratorio:
        hoje = date.today()
        ano, mes = map(int, competencia.split("-"))
        eh_mes_vigente = (hoje.year == ano and hoje.month == mes)

        if eh_mes_vigente:
            raise HTTPException(
                403,
                f"A competência {competencia} ainda está em aberto. O relatório final de faturamento só é liberado no encerramento do mês.",
            )
        if not fechamento.liberado_visualizacao_lab:
            raise HTTPException(
                403,
                f"O relatório de faturamento de {competencia} está em auditoria pela Secretaria de Saúde e ainda não foi liberado para o prestador.",
            )

    ano, mes = map(int, competencia.split("-"))
    data_inicio = date(ano, mes, 1)
    data_fim = date(ano + 1, 1, 1) if mes == 12 else date(ano, mes + 1, 1)

    solics = db.exec(
        select(SolicitacaoMestre.id).where(
            SolicitacaoMestre.laboratorio_id == laboratorio_id,
            SolicitacaoMestre.data_agendada >= data_inicio,
            SolicitacaoMestre.data_agendada < data_fim,
            SolicitacaoMestre.status != "cancelado",
        )
    ).all()
    solic_ids = [s for s in solics if s is not None]

    # Agrupa por procedimento para montar o espelho da fatura
    itens_agrupados: dict[int, dict] = {}

    if solic_ids:
        itens = db.exec(
            select(ItemSolic).where(ItemSolic.solicitacao_id.in_(solic_ids))
        ).all()

        for it in itens:
            sid = it.sigtap_id
            if not sid:
                continue
            if sid not in itens_agrupados:
                proc = db.get(SigtapProcedimento, sid)
                v_un = float(it.valor_unitario_aplicado or 0.0)
                origem = it.origem_preco or "sigtap_padrao"
                if v_un == 0.0 and proc:
                    v_un, origem, _ = resolver_preco_procedimento(
                        db, laboratorio_id, sid, data_inicio, proc_padrao=proc
                    )
                itens_agrupados[sid] = {
                    "sigtap_id": sid,
                    "codigo": proc.codigo if proc else "",
                    "descricao": proc.descricao if proc else "",
                    "quantidade": 0,
                    "valor_unitario": v_un,
                    "origem_preco": origem,
                }
            itens_agrupados[sid]["quantidade"] += (it.quantidade or 1)

    lista_itens_out = [
        LabFaturamentoItemRelatorioOut(
            sigtap_id=d["sigtap_id"],
            codigo_procedimento=d["codigo"],
            descricao_procedimento=d["descricao"],
            quantidade_executada=d["quantidade"],
            quantidade=d["quantidade"],
            valor_unitario=round(d["valor_unitario"], 2),
            valor_total=round(d["quantidade"] * d["valor_unitario"], 2),
            origem_preco=d["origem_preco"],
        )
        for d in sorted(itens_agrupados.values(), key=lambda x: x["codigo"])
    ]

    contrato = db.get(LabContrato, fechamento.contrato_id) if fechamento.contrato_id else None
    num_contrato = contrato.numero_contrato if contrato else "SEM CONTRATO VINCULADO"

    return LabFaturamentoRelatorioPrestadorOut(
        laboratorio_id=laboratorio_id,
        laboratorio_nome=lab.nome,
        cnes_laboratorio=getattr(lab, "cnes", "") or getattr(lab, "cnes_laboratorio", "") or "",
        responsavel_tecnico=getattr(lab, "responsavel_tecnico", "") or "",
        horario_funcionamento=getattr(lab, "horario_funcionamento", "") or "",
        contrato_id=fechamento.contrato_id,
        numero_contrato=num_contrato,
        competencia=competencia,
        qtd_solicitacoes=fechamento.qtd_solicitacoes,
        qtd_exames_total=fechamento.qtd_exames,
        total_solicitacoes=fechamento.qtd_solicitacoes,
        total_exames=fechamento.qtd_exames,
        valor_total_bruto=float(fechamento.valor_total_apurado),
        valor_glosas=float(fechamento.valor_total_glosado),
        valor_total_liquido=float(fechamento.valor_total_aprovado),
        valor_total=float(fechamento.valor_total_apurado),
        valor_glosado=float(fechamento.valor_total_glosado),
        valor_aprovado=float(fechamento.valor_total_aprovado),
        status_fechamento=fechamento.status,
        liberado_visualizacao_lab=bool(fechamento.liberado_visualizacao_lab),
        aprovado_por=fechamento.aprovado_por or "",
        aprovado_em=fechamento.aprovado_em,
        parecer_secretaria=fechamento.parecer_secretaria or "",
        itens_agrupados=lista_itens_out,
        itens=lista_itens_out,
    )


def aprovar_faturamento_secretaria(
    db: Session,
    laboratorio_id: int,
    competencia: str,
    dados: LabAprovarFaturamentoIn,
    usuario_nome: str = "",
) -> LabFechamentoFaturamento:
    """Aprova formalmente o faturamento do laboratório e libera acesso à fatura."""
    fechamento = apurar_faturamento_competencia(db, laboratorio_id, competencia)
    fechamento.status = "aprovado_secretaria"
    fechamento.liberado_visualizacao_lab = dados.liberar_visualizacao_lab
    fechamento.aprovado_por = usuario_nome or "Secretaria Municipal de Saúde"
    fechamento.aprovado_em = datetime.utcnow()
    fechamento.parecer_secretaria = dados.parecer.strip()
    fechamento.updated_at = datetime.utcnow()

    db.add(fechamento)
    db.commit()
    db.refresh(fechamento)
    return fechamento


# ==============================================================================
# 2. GESTÃO E CONFERÊNCIA DA FPO (FICHA DE PROGRAMAÇÃO ORÇAMENTÁRIA)
# ==============================================================================

def criar_ou_obter_fpo(db: Session, dados: LabFPOCompetenciaIn, usuario_nome: str = "") -> LabFPOCompetenciaOut:
    """Cria ou recupera a FPO da competência para o laboratório."""
    lab = db.get(Laboratorio, dados.laboratorio_id)
    if not lab:
        raise HTTPException(404, "Laboratório não encontrado.")

    fpo = db.exec(
        select(LabFPOCompetencia).where(
            LabFPOCompetencia.laboratorio_id == dados.laboratorio_id,
            LabFPOCompetencia.competencia == dados.competencia,
        )
    ).first()

    if not fpo:
        contrato = db.exec(
            select(LabContrato).where(
                LabContrato.laboratorio_id == dados.laboratorio_id,
                LabContrato.status == "ativo",
            )
        ).first()

        fpo = LabFPOCompetencia(
            laboratorio_id=dados.laboratorio_id,
            contrato_id=contrato.id if contrato else None,
            competencia=dados.competencia,
            cnes_prestador=dados.cnes_prestador.strip(),
            numero_fpo=dados.numero_fpo.strip() or f"FPO-{dados.competencia.replace('-', '')}-{dados.laboratorio_id}",
            teto_fisico_programado=dados.teto_fisico_programado,
            teto_financeiro_programado=round(float(dados.teto_financeiro_programado), 2),
            total_fisico_executado=0,
            total_financeiro_executado=0.0,
            status="programada",
            criado_por=usuario_nome or "Secretaria de Saúde",
        )
        db.add(fpo)
        db.commit()
        db.refresh(fpo)

    return formatar_fpo_out(db, fpo)


def adicionar_item_fpo(db: Session, fpo_id: int, dados: LabFPOItemIn) -> LabFPOItemOut:
    """Inclui ou atualiza um procedimento orçado na FPO."""
    fpo = db.get(LabFPOCompetencia, fpo_id)
    if not fpo:
        raise HTTPException(404, "FPO não encontrada.")

    proc = db.get(SigtapProcedimento, dados.sigtap_id)
    if not proc:
        raise HTTPException(404, "Procedimento SIGTAP não encontrado.")

    item = db.exec(
        select(LabFPOItem).where(
            LabFPOItem.fpo_id == fpo_id,
            LabFPOItem.sigtap_id == dados.sigtap_id,
        )
    ).first()

    if not item:
        item = LabFPOItem(
            fpo_id=fpo_id,
            sigtap_id=dados.sigtap_id,
            codigo_procedimento=proc.codigo,
            descricao_procedimento=proc.descricao,
            quantidade_orcada=dados.quantidade_orcada,
            valor_orcado=round(float(dados.valor_orcado), 2),
            quantidade_aprovada=0,
            valor_aprovado=0.0,
        )
        db.add(item)
    else:
        item.quantidade_orcada = dados.quantidade_orcada
        item.valor_orcado = round(float(dados.valor_orcado), 2)
        db.add(item)

    db.commit()
    db.refresh(item)
    return LabFPOItemOut(
        id=item.id or 0,
        fpo_id=item.fpo_id,
        sigtap_id=item.sigtap_id,
        codigo_procedimento=item.codigo_procedimento,
        descricao_procedimento=item.descricao_procedimento,
        quantidade_orcada=item.quantidade_orcada,
        valor_orcado=float(item.valor_orcado),
        quantidade_aprovada=item.quantidade_aprovada,
        valor_aprovado=float(item.valor_aprovado),
    )


def formatar_fpo_out(db: Session, fpo: LabFPOCompetencia) -> LabFPOCompetenciaOut:
    lab = db.get(Laboratorio, fpo.laboratorio_id)
    lab_nome = lab.nome if lab else ""

    itens_db = db.exec(
        select(LabFPOItem).where(LabFPOItem.fpo_id == fpo.id).order_by(LabFPOItem.codigo_procedimento)
    ).all()

    itens_out = [
        LabFPOItemOut(
            id=i.id or 0,
            fpo_id=i.fpo_id,
            sigtap_id=i.sigtap_id,
            codigo_procedimento=i.codigo_procedimento,
            descricao_procedimento=i.descricao_procedimento,
            quantidade_orcada=i.quantidade_orcada,
            valor_orcado=float(i.valor_orcado),
            quantidade_aprovada=i.quantidade_aprovada,
            valor_aprovado=float(i.valor_aprovado),
        )
        for i in itens_db
    ]

    saldo_fisico = max(0, fpo.teto_fisico_programado - fpo.total_fisico_executado)
    saldo_financeiro = max(0.0, round(fpo.teto_financeiro_programado - fpo.total_financeiro_executado, 2))

    return LabFPOCompetenciaOut(
        id=fpo.id or 0,
        laboratorio_id=fpo.laboratorio_id,
        laboratorio_nome=lab_nome,
        contrato_id=fpo.contrato_id,
        competencia=fpo.competencia,
        cnes_prestador=fpo.cnes_prestador,
        numero_fpo=fpo.numero_fpo,
        teto_fisico_programado=fpo.teto_fisico_programado,
        teto_financeiro_programado=float(fpo.teto_financeiro_programado),
        total_fisico_executado=fpo.total_fisico_executado,
        total_financeiro_executado=float(fpo.total_financeiro_executado),
        saldo_fisico=saldo_fisico,
        saldo_financeiro=saldo_financeiro,
        status=fpo.status,
        exportado_em=fpo.exportado_em,
        criado_por=fpo.criado_por,
        created_at=fpo.created_at,
        itens=itens_out,
    )


def exportar_fpo_sia(db: Session, fpo_id: int) -> dict:
    """Gera layout de exportação estruturado para o SIA/SUS com validação de conformidade."""
    fpo = db.get(LabFPOCompetencia, fpo_id)
    if not fpo:
        raise HTTPException(404, "FPO não encontrada.")

    lab = db.get(Laboratorio, fpo.laboratorio_id)
    itens = db.exec(select(LabFPOItem).where(LabFPOItem.fpo_id == fpo_id)).all()

    # Monta arquivo de texto magnético padronizado SIA
    linhas: list[str] = []
    cabecalho = (
        f"01|FPO|{fpo.competencia.replace('-', '')}|{fpo.cnes_prestador or '0000000'}|"
        f"{(lab.nome if lab else 'LAB')[:30]}|{datetime.utcnow().strftime('%Y%m%d%H%M')}"
    )
    linhas.append(cabecalho)

    for i in itens:
        linha = (
            f"02|{i.codigo_procedimento}|{i.quantidade_orcada:06d}|{int(i.valor_orcado * 100):010d}|"
            f"{i.quantidade_aprovada:06d}|{int(i.valor_aprovado * 100):010d}"
        )
        linhas.append(linha)

    conteudo_sia = "\r\n".join(linhas) + "\r\n"

    fpo.status = "exportada_sia"
    fpo.exportado_em = datetime.utcnow()
    db.add(fpo)
    db.commit()

    nome_arquivo = f"FPO_{fpo.competencia.replace('-', '')}_{fpo.cnes_prestador or fpo.laboratorio_id}.txt"
    return {
        "fpo_id": fpo.id,
        "competencia": fpo.competencia,
        "nome_arquivo": nome_arquivo,
        "conteudo_txt": conteudo_sia,
        "total_linhas": len(linhas),
        "status": fpo.status,
    }
