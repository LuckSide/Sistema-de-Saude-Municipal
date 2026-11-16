"""Serviço de Business Intelligence (BI) e Auditoria Financeira de Exames por Paciente."""

from typing import Any
from fastapi import HTTPException
from sqlalchemy import text
from sqlmodel import Session, func, or_, select

from app.models.lab_exames import SigtapProcedimento
from app.models.lab_fase6 import ItemSolic, Laboratorio, SolicitacaoMestre
from app.models.tfd import Paciente
from app.schemas.lab_fase6 import (
    PacienteGastoItemOut,
    PacienteGastosGeraisItemOut,
    PacienteGastosResumoOut,
)


def obter_gastos_paciente(db: Session, paciente_id: int) -> PacienteGastosResumoOut:
    """Calcula o histórico e volume financeiro total consumido por um cidadão em exames laboratoriais."""
    pac = db.get(Paciente, paciente_id)
    if not pac:
        raise HTTPException(404, "Paciente não encontrado")

    stmt = (
        select(ItemSolic, SolicitacaoMestre, SigtapProcedimento, Laboratorio)
        .join(SolicitacaoMestre, ItemSolic.solicitacao_id == SolicitacaoMestre.id)
        .join(SigtapProcedimento, ItemSolic.sigtap_id == SigtapProcedimento.id, isouter=True)
        .join(Laboratorio, SolicitacaoMestre.laboratorio_id == Laboratorio.id, isouter=True)
        .where(
            SolicitacaoMestre.paciente_id == paciente_id,
            SolicitacaoMestre.status != "cancelado",
        )
        .order_by(SolicitacaoMestre.data_agendada.desc(), ItemSolic.id.desc())
    )

    resultados = db.exec(stmt).all()
    itens_out: list[PacienteGastoItemOut] = []
    total_gasto = 0.0

    for it, mestre, proc, lab in resultados:
        # Se o item já gravou o valor unitário aplicado na confirmação do lote/agendamento, usa-o;
        # caso contrário, busca o valor do SIGTAP ambulatorial (SA).
        val_unit = it.valor_unitario_aplicado
        if (val_unit is None or val_unit <= 0.0) and proc:
            val_unit = float(proc.valor_sa or 0.0)
        val_unit = round(float(val_unit or 0.0), 2)
        total_gasto += val_unit

        itens_out.append(
            PacienteGastoItemOut(
                solicitacao_id=mestre.id or 0,
                data_agendada=mestre.data_agendada,
                laboratorio_nome=lab.nome if lab else "Laboratório Municipal",
                procedimento_codigo=proc.codigo if proc else "0202010183",
                procedimento_descricao=proc.descricao if proc else "EXAME LABORATORIAL",
                valor_unitario=val_unit,
                origem_preco=it.origem_preco or "sigtap_padrao",
            )
        )

    return PacienteGastosResumoOut(
        paciente_id=pac.id or 0,
        paciente_nome=pac.nome,
        paciente_cpf=getattr(pac, "cpf", "") or "",
        paciente_cns=getattr(pac, "cns", "") or "",
        total_gasto=round(total_gasto, 2),
        qtd_exames=len(itens_out),
        itens=itens_out,
    )


def listar_ranking_gastos_pacientes(
    db: Session,
    q: str = "",
    limit: int = 50,
    offset: int = 0,
) -> list[PacienteGastosGeraisItemOut]:
    """Retorna lista agregada dos pacientes com maior volume de recursos consumidos em exames."""
    stmt = (
        select(
            Paciente.id.label("paciente_id"),
            Paciente.nome.label("paciente_nome"),
            Paciente.cpf.label("paciente_cpf"),
            Paciente.cns.label("paciente_cns"),
            func.coalesce(
                func.sum(
                    func.coalesce(ItemSolic.valor_unitario_aplicado, SigtapProcedimento.valor_sa, 0.0)
                ),
                0.0,
            ).label("total_gasto"),
            func.count(ItemSolic.id).label("qtd_exames"),
            func.max(SolicitacaoMestre.data_agendada).label("ultimo_exame_data"),
        )
        .join(SolicitacaoMestre, SolicitacaoMestre.paciente_id == Paciente.id)
        .join(ItemSolic, ItemSolic.solicitacao_id == SolicitacaoMestre.id)
        .join(SigtapProcedimento, ItemSolic.sigtap_id == SigtapProcedimento.id, isouter=True)
        .where(SolicitacaoMestre.status != "cancelado")
        .group_by(Paciente.id, Paciente.nome, Paciente.cpf, Paciente.cns)
        .order_by(text("total_gasto DESC"))
    )

    if q and q.strip():
        termo = f"%{q.strip()}%"
        stmt = stmt.where(or_(Paciente.nome.ilike(termo), Paciente.cpf.ilike(termo)))

    stmt = stmt.limit(limit).offset(offset)
    linhas = db.exec(stmt).all()

    saida: list[PacienteGastosGeraisItemOut] = []
    for r in linhas:
        saida.append(
            PacienteGastosGeraisItemOut(
                paciente_id=r.paciente_id,
                paciente_nome=r.paciente_nome,
                paciente_cpf=r.paciente_cpf or "",
                paciente_cns=r.paciente_cns or "",
                total_gasto=round(float(r.total_gasto or 0.0), 2),
                qtd_exames=int(r.qtd_exames or 0),
                ultimo_exame_data=r.ultimo_exame_data,
            )
        )
    return saida
