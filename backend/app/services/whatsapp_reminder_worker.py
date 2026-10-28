import logging
import threading
from datetime import datetime, date, timedelta
from typing import Any

from sqlalchemy import text
from sqlmodel import Session, select

from app.db.session import engine
from app.models.integracoes import IntegrationSettings, WhatsAppLog
from app.models.tfd import Paciente, ExameFila
from app.services.whatsapp import notificar_paciente_evento

logger = logging.getLogger("whatsapp_reminder_worker")

LEMBRETE_LOCK_ID = 847291993
_STOP_EVENT = threading.Event()
_WORKER_THREAD: threading.Thread | None = None


def executar_disparo_lembretes_dia_anterior(db: Session, target_date: date | None = None) -> dict:
    """Busca todos os exames agendados para o dia seguinte e envia mensagem de lembrete via WhatsApp."""
    if not target_date:
        target_date = date.today() + timedelta(days=1)

    c = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
    if not c or not getattr(c, "whatsapp_habilitado", False):
        return {"executado": False, "motivo": "whatsapp_desabilitado", "total_enviados": 0}

    if not getattr(c, "whatsapp_notificar_agendamento", True):
        return {"executado": False, "motivo": "notificacao_agendamento_desativada", "total_enviados": 0}

    total_elegiveis = 0
    total_enviados = 0
    total_ja_enviados = 0
    total_falhas = 0
    logs_gerados: list[dict] = []

    limite_24h = datetime.utcnow() - timedelta(hours=24)

    # 1. Exames TFD / Especialidades / Imagem
    exames_tfd = db.exec(
        select(ExameFila).where(
            ExameFila.ativo == True,
            ExameFila.status == "agendado",
            ExameFila.data_agendada == target_date,
        )
    ).all()

    # Agrupa por paciente para não disparar múltiplas mensagens
    pacientes_tfd: dict[int, list[ExameFila]] = {}
    for ex in exames_tfd:
        pacientes_tfd.setdefault(ex.paciente_id, []).append(ex)

    for pac_id, lista in pacientes_tfd.items():
        total_elegiveis += 1
        # Verifica se já recebeu lembrete recente nas últimas 24h
        ja_enviou = db.exec(
            select(WhatsAppLog).where(
                WhatsAppLog.paciente_id == pac_id,
                WhatsAppLog.tipo_evento.in_(["lembrete", "lembrete_dia_anterior"]),
                WhatsAppLog.criado_em >= limite_24h,
                WhatsAppLog.sucesso == True,
            )
        ).first()

        if ja_enviou:
            total_ja_enviados += 1
            continue

        paciente = db.get(Paciente, pac_id)
        if not paciente or not paciente.telefone:
            total_falhas += 1
            continue

        ex_principal = lista[0]
        res = notificar_paciente_evento(
            db=db,
            evento="lembrete_dia_anterior",
            exame=ex_principal,
            paciente=paciente,
            instrucoes_adicionais=getattr(ex_principal, "instrucoes_transporte", "") or "",
            lista_exames=lista,
        )
        if res.get("sucesso"):
            total_enviados += 1
        else:
            total_falhas += 1
        logs_gerados.append({"paciente_id": pac_id, "tipo": "tfd", "res": res})

    # 2. Exames Laboratoriais (SolicitacaoMestre)
    try:
        from app.models.lab_fase6 import SolicitacaoMestre
        mestres = db.exec(
            select(SolicitacaoMestre).where(
                SolicitacaoMestre.status == "agendado",
                SolicitacaoMestre.data_agendada == target_date,
            )
        ).all()

        for m in mestres:
            total_elegiveis += 1
            ja_enviou = db.exec(
                select(WhatsAppLog).where(
                    WhatsAppLog.paciente_id == m.paciente_id,
                    WhatsAppLog.tipo_evento.in_(["lembrete", "lembrete_dia_anterior"]),
                    WhatsAppLog.criado_em >= limite_24h,
                    WhatsAppLog.sucesso == True,
                )
            ).first()

            if ja_enviou:
                total_ja_enviados += 1
                continue

            paciente = db.get(Paciente, m.paciente_id)
            if not paciente or not paciente.telefone:
                total_falhas += 1
                continue

            res = notificar_paciente_evento(
                db=db,
                evento="lembrete_dia_anterior",
                exame=m,
                paciente=paciente,
                instrucoes_adicionais=getattr(m, "instrucoes_transporte", "") or "",
            )
            if res.get("sucesso"):
                total_enviados += 1
            else:
                total_falhas += 1
            logs_gerados.append({"paciente_id": m.paciente_id, "tipo": "lab", "res": res})
    except Exception as e_lab:
        logger.warning(f"Erro ao processar lembretes laboratoriais: {e_lab}")

    # 3. Viagens do Transporte Municipal (TFD) para o dia seguinte
    try:
        import os
        import secrets
        from app.models.tfd import Viagem, ViagemPaciente, Veiculo
        from app.services.whatsapp import gerar_texto_lembrete_viagem, disparar_whatsapp_gateway

        viagens = db.exec(
            select(Viagem).where(
                Viagem.data_viagem == target_date,
                Viagem.status != "cancelada",
            )
        ).all()

        app_url = os.getenv("APP_URL", "http://localhost:5173").rstrip("/")

        for viag in viagens:
            vps = db.exec(
                select(ViagemPaciente).where(
                    ViagemPaciente.viagem_id == viag.id,
                    ViagemPaciente.presente == True,
                )
            ).all()

            veic = db.get(Veiculo, viag.veiculo_id) if viag.veiculo_id else None

            for vp in vps:
                total_elegiveis += 1
                if not vp.token_confirmacao:
                    vp.token_confirmacao = secrets.token_urlsafe(24)
                    db.add(vp)
                    db.commit()
                    db.refresh(vp)

                # Se já confirmou ou já informou desistência, não envia novo lembrete
                if vp.status_confirmacao in ("confirmado", "desistiu"):
                    continue

                # Verifica se já recebeu lembrete recente nas últimas 24h
                ja_enviou = vp.lembrete_enviado or db.exec(
                    select(WhatsAppLog).where(
                        WhatsAppLog.paciente_id == vp.paciente_id,
                        WhatsAppLog.tipo_evento == "lembrete_viagem",
                        WhatsAppLog.criado_em >= limite_24h,
                        WhatsAppLog.sucesso == True,
                    )
                ).first()

                if ja_enviou:
                    total_ja_enviados += 1
                    continue

                paciente = db.get(Paciente, vp.paciente_id)
                if not paciente or not paciente.telefone:
                    total_falhas += 1
                    continue

                link_confirmacao = f"{app_url}/confirmar-presenca/{vp.token_confirmacao}"
                msg_texto = gerar_texto_lembrete_viagem(
                    paciente=paciente,
                    viagem=viag,
                    vp=vp,
                    veiculo=veic,
                    link_confirmacao=link_confirmacao,
                )

                res = disparar_whatsapp_gateway(
                    db=db,
                    telefone=paciente.telefone,
                    mensagem=msg_texto,
                    paciente_id=paciente.id,
                    exame_id=None,
                    paciente_nome=paciente.nome or "",
                    tipo_evento="lembrete_viagem",
                )

                if res.get("sucesso"):
                    total_enviados += 1
                    vp.lembrete_enviado = True
                    vp.lembrete_enviado_em = datetime.utcnow()
                    db.add(vp)
                    db.commit()
                else:
                    total_falhas += 1

                logs_gerados.append({"paciente_id": paciente.id, "tipo": "viagem", "res": res})
    except Exception as e_viag:
        logger.warning(f"Erro ao processar lembretes de viagem: {e_viag}")

    return {
        "executado": True,
        "data_alvo": target_date.isoformat(),
        "total_elegiveis": total_elegiveis,
        "total_enviados": total_enviados,
        "total_ja_enviados": total_ja_enviados,
        "total_falhas": total_falhas,
        "detalhes": logs_gerados,
    }


def _whatsapp_reminder_loop():
    """Loop em segundo plano que verifica e dispara lembretes diários para exames marcados para o dia seguinte."""
    logger.info("Worker de lembretes de exames via WhatsApp iniciado.")
    # Espera 30 segundos no boot inicial antes da primeira verificação
    _STOP_EVENT.wait(30)

    while not _STOP_EVENT.is_set():
        try:
            with Session(engine) as db:
                eh_lider = False
                try:
                    res = db.execute(text(f"SELECT pg_try_advisory_lock({LEMBRETE_LOCK_ID})")).scalar()
                    eh_lider = bool(res)
                except Exception:
                    # SQLite em ambiente de teste
                    eh_lider = True

                if not eh_lider:
                    _STOP_EVENT.wait(60)
                    continue

                try:
                    agora = datetime.now()
                    # Roda durante o dia (entre 08:00 e 20:00)
                    if 8 <= agora.hour <= 20:
                        executar_disparo_lembretes_dia_anterior(db)
                finally:
                    try:
                        db.execute(text(f"SELECT pg_advisory_unlock({LEMBRETE_LOCK_ID})"))
                    except Exception:
                        pass

        except Exception as e:
            logger.error(f"Erro no loop do worker de lembretes WhatsApp: {e}", exc_info=True)

        # Checa a cada 30 minutos
        _STOP_EVENT.wait(1800)

    logger.info("Worker de lembretes de exames via WhatsApp finalizado.")


def iniciar_worker_lembretes_whatsapp():
    """Inicia a thread do worker de lembretes periódicos de exames."""
    global _WORKER_THREAD, _STOP_EVENT
    if _WORKER_THREAD is not None and _WORKER_THREAD.is_alive():
        return

    _STOP_EVENT.clear()
    _WORKER_THREAD = threading.Thread(target=_whatsapp_reminder_loop, daemon=True, name="whatsapp_reminder_worker")
    _WORKER_THREAD.start()


def parar_worker_lembretes_whatsapp():
    """Para o worker de lembretes de forma graciosa."""
    global _STOP_EVENT, _WORKER_THREAD
    _STOP_EVENT.set()
    if _WORKER_THREAD is not None and _WORKER_THREAD.is_alive():
        _WORKER_THREAD.join(timeout=3)
    _WORKER_THREAD = None
