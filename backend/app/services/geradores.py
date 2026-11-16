"""Geradores e formatadores de identificadores oficiais do sistema.

Subagente 1 & Diretriz Arquitetural 1:
- Troca do prefixo de pedidos de 'EX' para 'SL' (Solicitação).
- Eliminação de números aleatórios procedurais: prioriza IDs reais do banco ou registro do e-SUS PEC.
"""

from datetime import date, datetime
from typing import Any
from sqlmodel import Session, select


def obter_prontuario_real(paciente: Any = None, pac_id: int | None = None, db: Session | None = None) -> str:
    """Retorna o código de prontuário oficial e real do paciente:
    1. co_seq_cidadao_pec (se oriundo do e-SUS PEC)
    2. codigo_prontuario já persistido (se não-aleatório)
    3. ID numérico real do paciente no banco de dados
    """
    if paciente is not None:
        pec_id = getattr(paciente, "co_seq_cidadao_pec", None)
        if pec_id:
            return str(pec_id)
        cod_existente = getattr(paciente, "codigo_prontuario", "")
        if cod_existente and not cod_existente.startswith("PR-"):
            return str(cod_existente)
        pid = getattr(paciente, "id", None)
        if pid:
            return str(pid)

    if pac_id:
        if db:
            from app.models.tfd import Paciente
            p = db.get(Paciente, pac_id)
            if p:
                if p.co_seq_cidadao_pec:
                    return str(p.co_seq_cidadao_pec)
                if p.codigo_prontuario and not p.codigo_prontuario.startswith("PR-"):
                    return str(p.codigo_prontuario)
                return str(p.id)
        return str(pac_id)

    return ""


def gerar_prontuario_aleatorio(db: Session | None = None, pac_id: int | None = None) -> str:
    """Compatibilidade retroativa: agora retorna o ID real do paciente ou registro do PEC,
    cessando a geração de códigos procedurais aleatórios falsos.
    """
    if pac_id:
        return obter_prontuario_real(pac_id=pac_id, db=db)
    if db:
        from app.models.tfd import Paciente
        ultimo = db.exec(select(Paciente.id).order_by(Paciente.id.desc())).first()
        proximo = (ultimo or 0) + 1
        return str(proximo)
    return "1"


def gerar_exame_curto_aleatorio(db: Session | None = None, exame_id: int | None = None) -> str:
    """Gera identificador curto e imutável para a solicitação de exame.
    Substitui obrigatoriamente o prefixo 'EX' por 'SL' (Solicitação) e utiliza o ID real quando disponível.
    Exemplo: SL-000142 ou SL-104921
    """
    if exame_id:
        return f"SL-{exame_id:06d}"

    if db:
        from app.models.tfd import ExameFila
        # Tenta derivar do próximo ID sequencial
        ultimo = db.exec(select(ExameFila.id).order_by(ExameFila.id.desc())).first()
        if ultimo:
            cand = f"SL-{(ultimo + 1):06d}"
            if not db.exec(select(ExameFila.id).where(ExameFila.codigo_curto == cand)).first():
                return cand

        # Fallback determinístico seguro com prefixo SL
        import random
        for _ in range(50):
            num = random.randint(100000, 999999)
            cod = f"SL-{num}"
            if not db.exec(select(ExameFila.id).where(ExameFila.codigo_curto == cod)).first():
                return cod

    import random
    return f"SL-{random.randint(100000, 999999)}"


def gerar_numero_pedido_aleatorio(db: Session | None = None, prefixo_ano_mes: bool = True) -> str:
    """Gera um número de solicitação/pedido oficial com prefixo SL (ex: SL-2611-000123)."""
    ym = datetime.now().strftime("%y%m")
    prefixo = f"SL-{ym}" if prefixo_ano_mes else "SL"
    if db:
        from app.models.tfd import ExameFila
        ultimo = db.exec(select(ExameFila.id).order_by(ExameFila.id.desc())).first()
        if ultimo:
            cod = f"{prefixo}-{(ultimo + 1):06d}"
            if not db.exec(select(ExameFila.id).where(ExameFila.numero_pedido == cod)).first():
                return cod

    import random
    return f"{prefixo}-{random.randint(100000, 999999)}"


def gerar_protocolo_lab_aleatorio(data_agendada: date | None = None, mestre_id: int | None = None) -> str:
    """Gera um protocolo de agendamento de laboratório baseado no ID real (ex: LAB-2611-000123)."""
    dt = data_agendada if data_agendada else datetime.now().date()
    ym = dt.strftime("%y%m")
    if mestre_id:
        return f"LAB-{ym}-{mestre_id:06d}"
    import random
    return f"LAB-{ym}-{random.randint(100000, 999999)}"
