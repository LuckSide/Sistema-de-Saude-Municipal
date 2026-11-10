import random
from datetime import date, datetime
from sqlmodel import Session, select


def gerar_prontuario_aleatorio(db: Session | None = None, pac_id: int | None = None) -> str:
    """Gera um código de prontuário aleatório, não-procedural (ex: PR-84920)."""
    if db:
        from app.models.tfd import Paciente

        for _ in range(50):
            num = random.randint(10000, 99999)
            cod = f"PR-{num}"
            if not db.exec(select(Paciente.id).where(Paciente.codigo_prontuario == cod)).first():
                return cod

    if pac_id:
        num = (pac_id * 7919 + 31847) % 90000 + 10000
        return f"PR-{num}"

    return f"PR-{random.randint(10000, 99999)}"


def gerar_exame_curto_aleatorio(db: Session | None = None, exame_id: int | None = None) -> str:
    """Gera um identificador de exame aleatório e não-procedural (ex: EX-849201)."""
    if db:
        from app.models.tfd import ExameFila

        for _ in range(50):
            num = random.randint(100000, 999999)
            cod = f"EX-{num}"
            if not db.exec(select(ExameFila.id).where(ExameFila.codigo_curto == cod)).first():
                return cod

    if exame_id:
        num = (exame_id * 104729 + 523819) % 900000 + 100000
        return f"EX-{num}"

    return f"EX-{random.randint(100000, 999999)}"


def gerar_numero_pedido_aleatorio(db: Session | None = None, prefixo_ano_mes: bool = True) -> str:
    """Gera um número de solicitação/pedido aleatório e não-procedural (ex: PED-2610-849201)."""
    ym = datetime.now().strftime("%y%m")
    prefixo = f"PED-{ym}" if prefixo_ano_mes else "PED"
    if db:
        from app.models.tfd import ExameFila

        for _ in range(50):
            num = random.randint(100000, 999999)
            cod = f"{prefixo}-{num}"
            if not db.exec(select(ExameFila.id).where(ExameFila.numero_pedido == cod)).first():
                return cod

    return f"{prefixo}-{random.randint(100000, 999999)}"


def gerar_protocolo_lab_aleatorio(data_agendada: date | None = None, mestre_id: int | None = None) -> str:
    """Gera um protocolo de agendamento de laboratório aleatório (ex: LAB-2610-849201)."""
    dt = data_agendada if data_agendada else datetime.now().date()
    ym = dt.strftime("%y%m")
    if mestre_id:
        num = (mestre_id * 104729 + 523819) % 900000 + 100000
        return f"LAB-{ym}-{num}"
    return f"LAB-{ym}-{random.randint(100000, 999999)}"
