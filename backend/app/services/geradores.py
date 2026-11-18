"""Geradores criptograficamente aleatórios de identificadores do sistema.

Garante que prontuários (`PR-XXXXXX`) e números de solicitação/pedido
(`SL-XXXXXX`, `SL-AAMM-XXXXXX`, `LAB-AAMM-XXXXXX`) sejam SEMPRE gerados com
números aleatórios (`secrets.randbelow`) verificados contra colisões no banco,
nunca de forma procedural/sequencial a partir do `id` ou `co_seq_cidadao_pec`.
"""

import secrets
from datetime import date, datetime
from typing import Any
from sqlmodel import Session, select


def _gerar_digitos_aleatorios(digitos: int = 6) -> str:
    """Gera string numérica aleatória criptograficamente segura (ex.: 6 dígitos -> 100000..999999)."""
    minimo = 10 ** (digitos - 1)
    alcance = 9 * minimo
    return str(minimo + secrets.randbelow(alcance))


def gerar_prontuario_aleatorio(
    db: Session | None = None,
    pac_id: int | None = None,
    usados: set[str] | None = None,
) -> str:
    """Gera um código de prontuário aleatório único no formato `PR-XXXXXX`.

    Nunca utiliza `id`, `pac_id`, `co_seq_cidadao_pec` ou sequência incremental.
    Quando `usados` (set em memória) ou `db` são fornecidos, garante unicidade.
    """
    _ = pac_id  # mantido apenas na assinatura por compatibilidade; nunca usado na geração
    for digitos in (6, 7, 8):
        for _ in range(40):
            cod = f"PR-{_gerar_digitos_aleatorios(digitos)}"
            if usados is not None and cod in usados:
                continue
            if db is not None:
                from app.models.tfd import Paciente
                if db.exec(select(Paciente.id).where(Paciente.codigo_prontuario == cod)).first():
                    if usados is not None:
                        usados.add(cod)
                    continue
            if usados is not None:
                usados.add(cod)
            return cod
    cod = f"PR-{secrets.token_hex(4).upper()}"
    if usados is not None:
        usados.add(cod)
    return cod


def obter_prontuario_real(
    paciente: Any = None,
    pac_id: int | None = None,
    db: Session | None = None,
) -> str:
    """Retorna o código de prontuário persistido do paciente (ou gera e persiste um aleatório se vazio)."""
    if paciente is not None:
        cod_existente = (getattr(paciente, "codigo_prontuario", "") or "").strip()
        if cod_existente:
            return cod_existente
        novo = gerar_prontuario_aleatorio(db=db)
        if db is not None and getattr(paciente, "id", None):
            try:
                paciente.codigo_prontuario = novo
                db.add(paciente)
            except Exception:
                pass
        return novo

    if pac_id and db is not None:
        from app.models.tfd import Paciente
        p = db.get(Paciente, pac_id)
        if p:
            if (p.codigo_prontuario or "").strip():
                return p.codigo_prontuario.strip()
            novo = gerar_prontuario_aleatorio(db=db)
            p.codigo_prontuario = novo
            db.add(p)
            return novo

    return gerar_prontuario_aleatorio(db=db)


def gerar_exame_curto_aleatorio(
    db: Session | None = None,
    exame_id: int | None = None,
    usados: set[str] | None = None,
) -> str:
    """Gera código curto aleatório e imutável para solicitação no formato `SL-XXXXXX`."""
    _ = exame_id  # nunca deriva sequencialmente do ID
    for digitos in (6, 7, 8):
        for _ in range(40):
            cod = f"SL-{_gerar_digitos_aleatorios(digitos)}"
            if usados is not None and cod in usados:
                continue
            if db is not None:
                from app.models.tfd import ExameFila
                if db.exec(select(ExameFila.id).where(ExameFila.codigo_curto == cod)).first():
                    if usados is not None:
                        usados.add(cod)
                    continue
            if usados is not None:
                usados.add(cod)
            return cod
    cod = f"SL-{secrets.token_hex(4).upper()}"
    if usados is not None:
        usados.add(cod)
    return cod


def gerar_numero_pedido_aleatorio(
    db: Session | None = None,
    prefixo_ano_mes: bool = True,
    usados: set[str] | None = None,
) -> str:
    """Gera um número de solicitação/pedido aleatório com prefixo `SL` (ex.: `SL-2611-482917`)."""
    ym = datetime.now().strftime("%y%m")
    prefixo = f"SL-{ym}" if prefixo_ano_mes else "SL"
    for digitos in (6, 7, 8):
        for _ in range(40):
            cod = f"{prefixo}-{_gerar_digitos_aleatorios(digitos)}"
            if usados is not None and cod in usados:
                continue
            if db is not None:
                from app.models.tfd import ExameFila
                if db.exec(select(ExameFila.id).where(ExameFila.numero_pedido == cod)).first():
                    if usados is not None:
                        usados.add(cod)
                    continue
                try:
                    from app.models.lab_fase6 import SolicitacaoMestre
                    if db.exec(
                        select(SolicitacaoMestre.id).where(SolicitacaoMestre.codigo_solicitacao == cod)
                    ).first():
                        if usados is not None:
                            usados.add(cod)
                        continue
                except Exception:
                    pass
            if usados is not None:
                usados.add(cod)
            return cod
    cod = f"{prefixo}-{secrets.token_hex(4).upper()}"
    if usados is not None:
        usados.add(cod)
    return cod


def gerar_protocolo_lab_aleatorio(
    data_agendada: date | None = None,
    mestre_id: int | None = None,
    db: Session | None = None,
    usados: set[str] | None = None,
) -> str:
    """Gera um protocolo/número de solicitação laboratorial aleatório (ex.: `SL-2611-739204`)."""
    _ = mestre_id  # nunca deriva sequencialmente do ID
    dt = data_agendada if data_agendada else datetime.now().date()
    ym = dt.strftime("%y%m")
    for digitos in (6, 7, 8):
        for _ in range(40):
            cod = f"SL-{ym}-{_gerar_digitos_aleatorios(digitos)}"
            if usados is not None and cod in usados:
                continue
            if db is not None:
                try:
                    from app.models.lab_fase6 import SolicitacaoMestre
                    if db.exec(
                        select(SolicitacaoMestre.id).where(SolicitacaoMestre.codigo_solicitacao == cod)
                    ).first():
                        if usados is not None:
                            usados.add(cod)
                        continue
                except Exception:
                    pass
            if usados is not None:
                usados.add(cod)
            return cod
    cod = f"SL-{ym}-{secrets.token_hex(4).upper()}"
    if usados is not None:
        usados.add(cod)
    return cod
