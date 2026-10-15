"""Auditoria: trilha de ações (superuser) + linha do tempo do paciente."""

import re
from datetime import date, datetime, time

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import Session, select

from app.core.deps import get_current_user_senha_ok as get_user_ok, get_db, require_superuser
from app.core.pagination import paginar
from app.models.audit import AuditLog
from app.models.tfd import ExameFila, Paciente, Viagem, ViagemPaciente
from app.models.user import User
from app.services.permissoes import need_perm

router = APIRouter()


class LogOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    user_id: int | None
    user_name: str
    action: str
    entity: str
    entity_id: int | None
    details: str
    timestamp: datetime


class EventoOut(BaseModel):
    data: str
    tipo: str
    titulo: str
    detalhe: str = ""
    usuario: str = ""
    status: str = ""


class TimelineOut(BaseModel):
    paciente: dict = Field(default_factory=dict)
    status_atual: str = ""
    eventos: list[EventoOut] = []


@router.get("/auditoria/logs", response_model=dict)
def listar_logs(
    data_de: date | None = Query(default=None),
    data_ate: date | None = Query(default=None),
    usuario: str = Query(default="", max_length=120),
    acao: str = Query(default="", max_length=60),
    entidade: str = Query(default="", max_length=40),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(require_superuser),
):
    _ = user
    if data_de and data_ate and data_de > data_ate:
        raise HTTPException(status_code=400, detail="Período inválido")
    q = select(AuditLog)
    if data_de:
        q = q.where(AuditLog.timestamp >= datetime.combine(data_de, time.min))
    if data_ate:
        q = q.where(AuditLog.timestamp <= datetime.combine(data_ate, time.max))
    if usuario.strip():
        q = q.where(AuditLog.user_name.ilike(f"%{usuario.strip()}%"))
    if acao.strip():
        q = q.where(AuditLog.action == acao.strip().upper())
    if entidade.strip():
        q = q.where(AuditLog.entity == entidade.strip().upper())
    total = db.exec(select(func.count()).select_from(q.subquery())).one() or 0
    meta = paginar(total, page, limit)
    rows = db.exec(
        q.order_by(AuditLog.timestamp.desc()).offset(meta["offset"]).limit(limit)
    ).all()
    return {
        "data": [LogOut.model_validate(r).model_dump() for r in rows],
        "total": meta["total"],
        "page": meta["page"],
        "pages": meta["pages"],
    }


@router.get("/auditoria/filtros")
def filtros_logs(
    db: Session = Depends(get_db),
    user: User = Depends(require_superuser),
):
    _ = user
    acoes = list(db.exec(select(AuditLog.action).distinct().order_by(AuditLog.action).limit(200)).all())
    entidades = list(db.exec(select(AuditLog.entity).distinct().order_by(AuditLog.entity).limit(200)).all())
    usuarios = list(db.exec(select(AuditLog.user_name).distinct().order_by(AuditLog.user_name).limit(200)).all())
    return {"acoes": acoes, "entidades": entidades, "usuarios": [u for u in usuarios if u]}


STATUS_TXT = {
    "aguardando": "Na fila",
    "agendado": "Agendado",
    "realizado": "Realizado",
    "cancelado": "Removido",
}


def _chave_data(s: str) -> str:
    """Ordena ISO (AAAA-MM-DD[THH:mm]) e BR (DD/MM/AAAA[ HH:mm:ss]) juntos."""
    t = (s or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$", t)
    if m:
        a, me, d, h, mi, ss = m.groups()
        return f"{a}{me}{d}{h or '00'}{mi or '00'}{ss or '00'}"
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$", t)
    if m:
        d, me, a, h, mi, ss = m.groups()
        return f"{a}{me}{d}{h or '00'}{mi or '00'}{ss or '00'}"
    return t


@router.get("/auditoria/pacientes/{pid}/timeline", response_model=TimelineOut)
def timeline_paciente(
    pid: int,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("tfd_pacientes")),
):
    _ = user
    pac = db.get(Paciente, pid)
    if not pac:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    eventos: list[EventoOut] = []
    if pac.created_at:
        eventos.append(EventoOut(
            data=pac.created_at.date().isoformat(), tipo="cadastro",
            titulo="Paciente cadastrado no sistema", detalhe=pac.nome, usuario="sistema",
        ))
    exames = db.exec(
        select(ExameFila).where(ExameFila.paciente_id == pid).order_by(ExameFila.data_pedido)
    ).all()
    removidos = {e.id for e in exames if e.id and not e.ativo}
    for e in exames:
        eventos.append(EventoOut(
            data=e.data_pedido.isoformat(), tipo="fila",
            titulo=f"Entrada na fila: {e.exame[:80]}",
            detalhe=f"Prioridade {e.prioridade}" + (f" · {e.tipo_fila}" if e.tipo_fila else ""),
            status="aguardando",
        ))
        if e.data_agendada:
            eventos.append(EventoOut(
                data=e.data_agendada.isoformat(), tipo="agendamento",
                titulo=f"Exame agendado{(f' — {e.destino}' if e.destino else '')}",
                detalhe=e.exame[:80], status="agendado",
            ))
        if not e.ativo:
            # Remoção da fila: ator + perfil + carimbo + motivo (soft delete).
            quando = ""
            try:
                quando = e.removido_em.strftime("%d/%m/%Y %H:%M:%S") if e.removido_em else ""
            except Exception:
                quando = ""
            eventos.append(EventoOut(
                data=quando or e.data_pedido.isoformat(), tipo="remocao",
                titulo="Remoção da Fila de Espera",
                detalhe=f"{e.exame[:80]}" + (f" · Motivo: {e.motivo_remocao[:200]}" if e.motivo_remocao else ""),
                usuario=e.removido_por or "sistema",
            ))
    viagens = db.exec(
        select(Viagem, ViagemPaciente)
        .join(ViagemPaciente, ViagemPaciente.viagem_id == Viagem.id)
        .where(ViagemPaciente.paciente_id == pid)
        .order_by(Viagem.data_viagem)
    ).all()
    for v, _vp in viagens:
        eventos.append(EventoOut(
            data=v.data_viagem.isoformat(), tipo="transporte",
            titulo=f"Transporte: {v.destino[:80]}",
            detalhe=f"Saída {v.hora_saida or '—'}" + (f" · {v.motorista}" if v.motorista else "") + f" · {v.status}",
            status="agendado",
        ))
    # Trilha com ator (vai enriquecendo a partir da ativação da auditoria)
    eids = {e.id for e in exames if e.id}
    logs = db.exec(
        select(AuditLog)
        .where(
            ((AuditLog.entity == "PATIENT") & (AuditLog.entity_id == pid))
            | ((AuditLog.entity == "EXAM") & (AuditLog.entity_id.in_(eids) if eids else False))
        )
        .order_by(AuditLog.timestamp)
        .limit(500)
    ).all()
    for lg in logs:
        # Remoção já tem evento dedicado (com motivo) — evita duplicar.
        if lg.entity == "EXAM" and lg.entity_id in removidos and lg.action in ("EXAM_DELETE", "EXAM_REMOVE"):
            continue
        eventos.append(EventoOut(
            data=lg.timestamp.date().isoformat(), tipo="movimentacao",
            titulo=f"{lg.action} · {lg.entity}#{lg.entity_id or '—'}",
            detalhe=(lg.details or "")[:200], usuario=lg.user_name or "sistema",
        ))
    eventos.sort(key=lambda e: _chave_data(e.data))
    status_atual = ""
    ativos = [e for e in exames if e.ativo]
    base_status = ativos or exames
    if base_status:
        ult = max(base_status, key=lambda e: (e.data_agendada or e.data_pedido))
        status_atual = STATUS_TXT.get(ult.status, ult.status)
    return TimelineOut(
        paciente={"id": pac.id, "nome": pac.nome},
        status_atual=status_atual,
        eventos=eventos,
    )


@router.get("/auditoria/logs/exportar")
def exportar_logs(
    data_de: date | None = Query(default=None),
    data_ate: date | None = Query(default=None),
    usuario: str = Query(default="", max_length=120),
    acao: str = Query(default="", max_length=60),
    entidade: str = Query(default="", max_length=40),
    db: Session = Depends(get_db),
    user: User = Depends(require_superuser),
):
    """Trilha de auditoria em XLSX respeitando os filtros ativos."""
    from app.services.export_xlsx import resposta_xlsx

    rows = list(db.exec(
        _filtros_logs(db, data_de, data_ate, usuario, acao, entidade)
        .order_by(AuditLog.timestamp.desc())
    ).all())[:20000]
    linhas = _linhas_export(rows)
    return resposta_xlsx(
        "Auditoria — trilha de ações", user.nome or user.username,
        _COLS_AUDIT, linhas, "auditoria",
    )


def _filtros_logs(db, data_de, data_ate, usuario, acao, entidade):
    q = select(AuditLog)
    if data_de:
        q = q.where(AuditLog.timestamp >= datetime.combine(data_de, time.min))
    if data_ate:
        q = q.where(AuditLog.timestamp <= datetime.combine(data_ate, time.max))
    if (usuario or "").strip():
        q = q.where(AuditLog.user_name.ilike(f"%{usuario.strip()}%"))
    if (acao or "").strip():
        q = q.where(AuditLog.action == acao.strip().upper())
    if (entidade or "").strip():
        q = q.where(AuditLog.entity == entidade.strip().upper())
    return q


def _linhas_export(rows) -> list[dict]:
    """Uma linha por mudança + Raw Payload na íntegra em todas."""
    import json as _json

    from app.services.auditoria_txt import fmt_valor, parse_details, rotulo_acao, rotulo_campo

    linhas = []
    for r in rows:
        det = parse_details(r.details)
        quando = r.timestamp.strftime("%d/%m/%Y %H:%M") if r.timestamp else ""
        base = {
            "quando": quando,
            "usuario": r.user_name or "",
            "acao": f"{rotulo_acao(r.action)} ({r.action})",
            "registro": f"{r.entity}#{r.entity_id or '—'}",
            "raw": r.details or "",
        }
        mudancas = det.get("mudancas") or []
        if mudancas:
            for m in mudancas:
                linhas.append({
                    **base,
                    "campo": rotulo_campo(m.get("campo", "")),
                    "de": fmt_valor(m.get("de", "")),
                    "para": fmt_valor(m.get("para", "")),
                })
        else:
            corpo = det.get("body")
            if isinstance(corpo, dict) and corpo:
                for k, v in corpo.items():
                    linhas.append({
                        **base,
                        "campo": rotulo_campo(k),
                        "de": "—",
                        "para": fmt_valor(v),
                    })
            else:
                linhas.append({**base, "campo": "", "de": "", "para": ""})
    return linhas


_COLS_AUDIT = [
    {"chave": "quando", "rotulo": "Data/hora", "largura": 18},
    {"chave": "usuario", "rotulo": "Usuário", "largura": 26},
    {"chave": "acao", "rotulo": "Ação", "largura": 30},
    {"chave": "registro", "rotulo": "Registro (ID)", "largura": 18},
    {"chave": "campo", "rotulo": "Campo", "largura": 26},
    {"chave": "de", "rotulo": "Valor Anterior", "largura": 26},
    {"chave": "para", "rotulo": "Valor Novo", "largura": 26},
    {"chave": "raw", "rotulo": "Raw Payload / Request Body", "largura": 60},
]


@router.get("/auditoria/logs/exportar-csv")
def exportar_logs_csv(
    data_de: date | None = Query(default=None),
    data_ate: date | None = Query(default=None),
    usuario: str = Query(default="", max_length=120),
    acao: str = Query(default="", max_length=60),
    entidade: str = Query(default="", max_length=40),
    db: Session = Depends(get_db),
    user: User = Depends(require_superuser),
):
    """Trilha em CSV (mesmas colunas traduzidas + Raw Payload)."""
    import csv as _csv
    import io as _io

    from fastapi import Response

    _ = user
    rows = list(db.exec(
        _filtros_logs(db, data_de, data_ate, usuario, acao, entidade)
        .order_by(AuditLog.timestamp.desc())
    ).all())[:20000]
    buf = _io.StringIO()
    w = _csv.writer(buf, delimiter=";", quoting=_csv.QUOTE_MINIMAL)
    w.writerow(["Data/hora", "Usuário", "Ação", "Registro (ID)", "Campo",
                "Valor Anterior", "Valor Novo", "Raw Payload / Request Body"])
    for lin in _linhas_export(rows):
        w.writerow([lin["quando"], lin["usuario"], lin["acao"], lin["registro"],
                    lin["campo"], lin["de"], lin["para"], lin["raw"]])
    return Response(
        content="\ufeff" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="auditoria.csv"',
            "Cache-Control": "no-store",
        },
    )


# ---------- Registro relacionado (navegação a partir do log) ----------
_RESOLVER_PERM = {
    "EXAM": "tfd_exames",
    "PATIENT": "tfd_pacientes",
    "TRIP": "tfd_viagens",
    "PASSENGER": "tfd_viagens",
    "DESTINATION": "tfd_destinos",
    "VEHICLE": "tfd_frota",
    "USER": "usuarios",
    "DOCTOR": "usuarios",
    "UNIT": "usuarios",
    "TRIPQUEUE": "tfd_viagens",
    "CATALOG": "tfd_catalogo",
    "BILLING": "tfd_faturamento",
}

_RESOLVER_ROTA = {
    "EXAM": "/fila-exames",
    "PATIENT": "/tfd/pacientes",
    "TRIP": "/tfd/viagens",
    "PASSENGER": "/tfd/viagens",
    "DESTINATION": "/tfd/destinos",
    "VEHICLE": "/tfd/frota",
    "USER": "/usuarios",
    "DOCTOR": "/configuracoes?aba=medicos",
    "UNIT": "/configuracoes?aba=unidades",
    "TRIPQUEUE": "/tfd/quadro",
    "CATALOG": "/tfd/catalogo",
    "BILLING": "/tfd/faturamento",
}


@router.get("/auditoria/registros/{entity}/{entity_id}")
def resolver_registro(
    entity: str,
    entity_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_superuser),
):
    """Localiza o registro de um evento p/ 'Ver registro relacionado'.

    Exige a tela da entidade (+ audiência de auditoria) ou superuser.
    Nunca expõe segredos; registros removidos retornam histórico do log.
    """
    import re as _re

    from app.services.permissoes import tem_tela

    ent = (entity or "").strip().upper()
    if not _re.fullmatch(r"[A-Z_]{1,40}", ent) or ent not in _RESOLVER_PERM or entity_id < 1:
        raise HTTPException(404, "Sem registro relacionado")
    if not bool(getattr(user, "is_superuser", False)):
        if not tem_tela(user, "usuarios"):
            raise HTTPException(403, "Você não tem permissão para visualizar este registro.")
        if not tem_tela(user, _RESOLVER_PERM[ent]):
            raise HTTPException(403, "Você não tem permissão para visualizar este registro.")
    rota = _RESOLVER_ROTA[ent]

    def saida(existe=True, inativo=False, titulo="", subtitulo="", pai=None):
        out = {"entity": ent, "entity_id": entity_id, "existe": existe,
               "inativo": inativo, "rota": rota if existe else None,
               "titulo": titulo, "subtitulo": subtitulo or ""}
        if pai:
            out["pai"] = pai
        return out

    if ent == "EXAM":
        from app.models.tfd import ExameFila

        o = db.get(ExameFila, entity_id)
        if not o:
            return saida(False, subtitulo="Registro removido — consulte o histórico no log.")
        return saida(True, inativo=not o.ativo,
                    titulo=o.exame or f"Pedido #{o.id}",
                    subtitulo="Removido da fila (inativo)" if not o.ativo else f"Status {o.status}")
    if ent == "PATIENT":
        from app.models.tfd import Paciente

        o = db.get(Paciente, entity_id)
        if not o:
            return saida(False, subtitulo="Registro removido — consulte o histórico no log.")
        return saida(True, titulo=o.nome)
    if ent == "TRIP":
        from app.models.tfd import Viagem

        o = db.get(Viagem, entity_id)
        if not o:
            return saida(False, subtitulo="Registro removido — consulte o histórico no log.")
        return saida(True, titulo=f"{o.destino} · {o.data_viagem}")
    if ent == "PASSENGER":
        from app.models.tfd import Viagem, ViagemPaciente

        o = db.get(ViagemPaciente, entity_id)
        if not o:
            return saida(False, subtitulo="Registro removido — consulte o histórico no log.")
        v = db.get(Viagem, o.viagem_id)
        return saida(True, titulo=f"Passageiro #{o.id}",
                    subtitulo=f"Viagem {v.destino} · {v.data_viagem}" if v else "",
                    pai={"rota": "/tfd/viagens", "titulo": f"Viagem {v.destino}"} if v else None)
    if ent == "DESTINATION":
        from app.models.tfd import Destino

        o = db.get(Destino, entity_id)
        if not o:
            return saida(False, subtitulo="Registro removido — consulte o histórico no log.")
        return saida(True, titulo=o.nome_destino)
    if ent == "VEHICLE":
        from app.models.tfd import Veiculo

        o = db.get(Veiculo, entity_id)
        if not o:
            return saida(False, subtitulo="Registro removido — consulte o histórico no log.")
        return saida(True, titulo=f"{o.placa} · {o.modelo or o.tipo}")
    if ent == "USER":
        from app.models.user import User as UserModel

        o = db.get(UserModel, entity_id)
        if not o:
            return saida(False, subtitulo="Conta removida — consulte o histórico no log.")
        return saida(True, titulo=o.nome or o.username, subtitulo=o.username)
    if ent == "DOCTOR":
        from app.models.cadastros_saude import Medico

        o = db.get(Medico, entity_id)
        if not o:
            return saida(False, subtitulo="Registro removido — consulte o histórico no log.")
        return saida(True, titulo=o.nome, subtitulo="Inativo" if not o.ativo else "")
    if ent == "UNIT":
        from app.models.cadastros_saude import UnidadeSaude

        o = db.get(UnidadeSaude, entity_id)
        if not o:
            return saida(False, subtitulo="Registro removido — consulte o histórico no log.")
        return saida(True, titulo=o.nome, subtitulo="Inativa" if not o.ativo else "")
    if ent == "TRIPQUEUE":
        from app.models.tfd import ViagemFila

        o = db.get(ViagemFila, entity_id)
        if not o:
            return saida(False, subtitulo="Registro removido — consulte o histórico no log.")
        pac = db.get(Paciente, o.paciente_id)
        return saida(True, titulo=f"{pac.nome if pac else '?'} → {o.destino}",
                    subtitulo=f"Status {o.status}")
    if ent == "CATALOG":
        from app.models.tfd import Especialidade, ProcedimentoCatalogo, TipoFila

        for modelo, rot, campo in (
            (TipoFila, "Tipo de fila", "nome"),
            (ProcedimentoCatalogo, "Procedimento", "nome"),
            (Especialidade, "Especialidade", "nome"),
        ):
            o = db.get(modelo, entity_id)
            if o:
                return saida(True, titulo=f"{rot}: {getattr(o, campo, '') or getattr(o, 'codigo', '')}")
        return saida(False, subtitulo="Registro removido — consulte o histórico no log.")
    if ent == "BILLING":
        from app.models.tfd import Faturamento

        o = db.get(Faturamento, entity_id)
        if not o:
            return saida(False, subtitulo="Registro removido — consulte o histórico no log.")
        return saida(True, titulo=f"{o.procedimento[:60]}",
                    subtitulo=f"Competência {o.competencia} · {o.status}")
    raise HTTPException(404, "Sem registro relacionado")
