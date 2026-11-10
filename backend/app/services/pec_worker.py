import logging
import threading
from datetime import datetime, timedelta

from sqlalchemy import text
from sqlmodel import Session, select

from app.db.session import engine
from app.models.integracoes import IntegrationSettings
from app.services.pec_sync import is_sync_running, sincronizar_pacientes_pec

logger = logging.getLogger("pec_worker")

SCHEDULER_LEADER_LOCK = 847291991
_STOP_EVENT = threading.Event()
_WORKER_THREAD: threading.Thread | None = None


def _pec_sync_loop():
    """Loop em segundo plano que verifica periodicamente se é hora de executar a sincronização.
    Utiliza eleição de líder via PostgreSQL advisory lock para que apenas um worker do cluster
    execute as checagens e a sincronização.
    """
    logger.info("Worker de sincronização periódica do e-SUS PEC iniciado.")
    # Aguarda 15 segundos no boot inicial antes da primeira verificação
    _STOP_EVENT.wait(15)

    while not _STOP_EVENT.is_set():
        try:
            with Session(engine) as db:
                eh_lider = False
                try:
                    res = db.execute(text(f"SELECT pg_try_advisory_lock({SCHEDULER_LEADER_LOCK})")).scalar()
                    eh_lider = bool(res)
                except Exception:
                    # SQLite em testes
                    eh_lider = True

                if not eh_lider:
                    # Outro processo do Gunicorn já é o líder do agendador
                    _STOP_EVENT.wait(60)
                    continue

                try:
                    cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
                    if cfg and cfg.pec_sync_automatica and (cfg.pec_database_url or cfg.pec_ssh_habilitado):
                        intervalo_horas = cfg.pec_sync_intervalo_horas or 6
                        ultima_exec = cfg.pec_sync_ultima_execucao

                        deve_rodar = False
                        if not ultima_exec:
                            deve_rodar = True
                        else:
                            proxima_exec = ultima_exec + timedelta(hours=intervalo_horas)
                            if datetime.utcnow() >= proxima_exec:
                                deve_rodar = True

                        if deve_rodar and not is_sync_running():
                            logger.info("Iniciando rotina agendada de sincronização de pacientes com o e-SUS PEC...")
                            sincronizar_pacientes_pec(db, origem="agendado")
                            try:
                                from app.services.pec import atualizar_cache_indicadores
                                logger.info("Atualizando cache local de indicadores do e-SUS PEC...")
                                atualizar_cache_indicadores(db)
                            except Exception as ex_ind:
                                logger.warning(f"Erro ao atualizar cache de indicadores no worker: {ex_ind}")
                finally:
                    try:
                        db.execute(text(f"SELECT pg_advisory_unlock({SCHEDULER_LEADER_LOCK})"))
                    except Exception:
                        pass

        except Exception as e:
            logger.error(f"Erro no loop do worker PEC: {e}", exc_info=True)

        # Checa a cada 60 segundos
        _STOP_EVENT.wait(60)

    logger.info("Worker de sincronização do e-SUS PEC finalizado.")


def iniciar_worker_pec():
    """Inicia a thread do worker de sincronização periódica se ainda não estiver ativa."""
    global _WORKER_THREAD, _STOP_EVENT
    if _WORKER_THREAD is not None and _WORKER_THREAD.is_alive():
        return

    _STOP_EVENT.clear()
    _WORKER_THREAD = threading.Thread(target=_pec_sync_loop, daemon=True, name="pec_sync_worker")
    _WORKER_THREAD.start()


def parar_worker_pec():
    """Para o worker de sincronização de forma graciosa."""
    global _STOP_EVENT, _WORKER_THREAD
    _STOP_EVENT.set()
    if _WORKER_THREAD is not None and _WORKER_THREAD.is_alive():
        _WORKER_THREAD.join(timeout=3)
    _WORKER_THREAD = None


def sincronizar_em_segundo_plano(origem: str = "manual"):
    """Dispara uma thread avulsa para rodar a sincronização imediatamente em segundo plano."""
    def _run():
        with Session(engine) as db:
            sincronizar_pacientes_pec(db, origem=origem)
            try:
                from app.services.pec import atualizar_cache_indicadores
                atualizar_cache_indicadores(db)
            except Exception as ex_ind:
                logger.warning(f"Erro ao atualizar cache de indicadores: {ex_ind}")

    t = threading.Thread(target=_run, daemon=True, name=f"pec_sync_{origem}")
    t.start()
