"""Worker em segundo plano para verificação e importação periódica do SIGTAP/DATASUS."""

import logging
import threading
from datetime import datetime, timedelta

from sqlalchemy import text
from sqlmodel import Session, select

from app.db.session import engine
from app.models.integracoes import IntegrationSettings
from app.services.sigtap_sync import executar_sync_automatica_sigtap, is_sigtap_sync_running

logger = logging.getLogger("sigtap_worker")

SIGTAP_LEADER_LOCK = 847291995
_STOP_EVENT = threading.Event()
_WORKER_THREAD: threading.Thread | None = None


def _sigtap_sync_loop():
    """Loop periódico que verifica se a atualização automática do SIGTAP está vencida."""
    logger.info("Worker periódico SIGTAP/DATASUS iniciado.")
    # Aguarda 45 segundos após boot antes da primeira checagem
    _STOP_EVENT.wait(45)

    while not _STOP_EVENT.is_set():
        try:
            with Session(engine) as db:
                eh_lider = False
                try:
                    res = db.execute(text(f"SELECT pg_try_advisory_lock({SIGTAP_LEADER_LOCK})")).scalar()
                    eh_lider = bool(res)
                except Exception:
                    eh_lider = True

                if eh_lider:
                    try:
                        cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
                        if cfg and getattr(cfg, "sigtap_sync_automatica", True):
                            intervalo_horas = max(1, int(getattr(cfg, "sigtap_sync_intervalo_horas", 24) or 24))
                            ultima_exec = getattr(cfg, "sigtap_sync_ultima_execucao", None)
                            deve_rodar = (
                                ultima_exec is None
                                or datetime.utcnow() >= ultima_exec + timedelta(hours=intervalo_horas)
                            )
                            if deve_rodar and not is_sigtap_sync_running():
                                logger.info("Verificando atualizações da Tabela Unificada no portal DATASUS/SIGTAP...")
                                res_sync = executar_sync_automatica_sigtap(db)
                                logger.info(f"Resultado verificação SIGTAP/DATASUS: {res_sync.get('status')}")
                    finally:
                        try:
                            db.execute(text(f"SELECT pg_advisory_unlock({SIGTAP_LEADER_LOCK})"))
                        except Exception:
                            pass
        except Exception as e:
            logger.warning(f"Erro no loop periódico SIGTAP/DATASUS: {e}")

        # Verifica novamente a cada 15 minutos
        _STOP_EVENT.wait(900)

    logger.info("Worker periódico SIGTAP/DATASUS finalizado.")


def iniciar_worker_sigtap():
    """Inicia a thread de verificação periódica do SIGTAP caso não esteja ativa."""
    global _WORKER_THREAD, _STOP_EVENT
    if _WORKER_THREAD is not None and _WORKER_THREAD.is_alive():
        return
    _STOP_EVENT.clear()
    _WORKER_THREAD = threading.Thread(target=_sigtap_sync_loop, daemon=True, name="sigtap_datasus_worker")
    _WORKER_THREAD.start()


def parar_worker_sigtap():
    """Solicita parada graciosa do worker SIGTAP."""
    global _STOP_EVENT, _WORKER_THREAD
    _STOP_EVENT.set()
    if _WORKER_THREAD is not None and _WORKER_THREAD.is_alive():
        _WORKER_THREAD.join(timeout=3)
    _WORKER_THREAD = None
