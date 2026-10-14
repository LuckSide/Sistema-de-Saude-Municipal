from datetime import date

from sqlmodel import Session, func, select

from app.models.tfd import (
    ExameFila,
    Faturamento,
    Paciente,
    Veiculo,
    Viagem,
    ViagemPaciente,
)


def resumo_tfd(db: Session, competencia: str) -> dict:
    ano, mes = competencia.split("-")
    viagens = db.exec(
        select(func.count(Viagem.id)).where(
            func.to_char(Viagem.data_viagem, "YYYY-MM") == competencia
        )
    ).one()
    passageiros = db.exec(
        select(func.count(ViagemPaciente.id))
        .join(Viagem, Viagem.id == ViagemPaciente.viagem_id)
        .where(func.to_char(Viagem.data_viagem, "YYYY-MM") == competencia)
    ).one()
    exames_ag = db.exec(
        select(func.count(ExameFila.id)).where(ExameFila.status == "aguardando")
    ).one()
    exames_urg = db.exec(
        select(func.count(ExameFila.id)).where(
            ExameFila.status == "aguardando", ExameFila.prioridade == "urgente"
        )
    ).one()
    valor = (
        db.exec(
            select(func.coalesce(func.sum(Faturamento.valor * Faturamento.quantidade), 0)).where(
                Faturamento.competencia == competencia
            )
        ).one()
        or 0
    )
    cap_total = (
        db.exec(
            select(func.coalesce(func.sum(Veiculo.capacidade), 0))
            .join(Viagem, Viagem.veiculo_id == Veiculo.id)
            .where(func.to_char(Viagem.data_viagem, "YYYY-MM") == competencia)
        ).one()
        or 0
    )
    ocup = round((passageiros / cap_total * 100) if cap_total else 0, 1)
    return {
        "viagens_mes": viagens or 0,
        "passageiros_mes": passageiros or 0,
        "exames_aguardando": exames_ag or 0,
        "exames_urgentes": exames_urg or 0,
        "valor_competencia": float(valor),
        "ocupacao_media": ocup,
    }


def hoje_str() -> str:
    return date.today().strftime("%Y-%m")
