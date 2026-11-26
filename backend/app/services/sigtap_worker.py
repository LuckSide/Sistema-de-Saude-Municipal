"""Worker em segundo plano para verificação e importação periódica do SIGTAP/DATASUS."""

import logging
import threading
from datetime import datetime, timedelta

from sqlalchemy import text
from sqlmodel import Session, select

from app.db.session import engine
from app.models.integracoes import IntegrationSettings
from app.models.lab_exames import SigtapVersao
from app.services.sia_sync import executar_sync_automatica_sia, is_sia_sync_running
from app.services.sigtap_sync import executar_sync_automatica_sigtap, is_sigtap_sync_running

logger = logging.getLogger("sigtap_worker")

SIGTAP_LEADER_LOCK = 847291995
_STOP_EVENT = threading.Event()
_WORKER_THREAD: threading.Thread | None = None


def _sigtap_sync_loop():
    """Loop mensal com retry persistente para importação do SIGTAP/DATASUS.
    
    Diretriz Arquitetural (Subagente 4):
    - Executa apenas 1 vez por mês para acompanhar a publicação da Tabela Unificada pelo Ministério da Saúde.
    - Em caso de falha de rede/indisponibilidade do DATASUS, mantém retry persistente (a cada 30 min)
      até conseguir conectar e baixar com sucesso a competência do mês.
    """
    logger.info("Worker mensal SIGTAP/DATASUS iniciado com rotina de retry persistente.")
    # Aguarda 45 segundos após boot antes da primeira checagem
    _STOP_EVENT.wait(45)

    intervalo_espera_padrao = 3600  # 1 hora de polling para checagem de virada de mês
    intervalo_retry_falha = 1800    # 30 minutos em caso de falha de rede (retry persistente)

    while not _STOP_EVENT.is_set():
        proximo_wait = intervalo_espera_padrao
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
                            agora = datetime.utcnow()
                            comp_mes_atual = agora.strftime("%Y%m")
                            ultima_exec = getattr(cfg, "sigtap_sync_ultima_execucao", None)
                            ultimo_status = getattr(cfg, "sigtap_sync_ultimo_status", "")
                            ultima_comp = getattr(cfg, "sigtap_sync_ultima_competencia", "")
                            ultima_comp_norm = (ultima_comp or "").replace("-", "")

                            # Já sincronizou com sucesso a competência do mês corrente?
                            ja_sincronizado_mes = (
                                ultimo_status in ("SUCESSO", "SEM_NOVIDADE")
                                and (
                                    (ultima_exec is not None and ultima_exec.year == agora.year and ultima_exec.month == agora.month)
                                    or (ultima_comp_norm == comp_mes_atual)
                                )
                            )

                            if not ja_sincronizado_mes:
                                # Verifica se a versão desta competência já foi importada no banco
                                versao_mes = db.exec(
                                    select(SigtapVersao).where(
                                        (SigtapVersao.competencia == comp_mes_atual)
                                        | (SigtapVersao.competencia == agora.strftime("%Y-%m")),
                                        SigtapVersao.total_proc > 0,
                                    )
                                ).first()
                                if versao_mes:
                                    ja_sincronizado_mes = True
                                    if cfg:
                                        cfg.sigtap_sync_ultimo_status = "SEM_NOVIDADE"
                                        cfg.sigtap_sync_ultima_competencia = versao_mes.competencia
                                        db.add(cfg)
                                        db.commit()

                            if ja_sincronizado_mes:
                                logger.debug(
                                    f"SIGTAP do mês {comp_mes_atual} já sincronizado com sucesso. Aguardando próximo mês."
                                )
                                proximo_wait = intervalo_espera_padrao
                            else:
                                if not is_sigtap_sync_running():
                                    logger.info(
                                        f"Iniciando sincronização mensal do SIGTAP/DATASUS para competência {comp_mes_atual}..."
                                    )
                                    res_sync = executar_sync_automatica_sigtap(db)
                                    status = res_sync.get("status")

                                    if status in ("SUCESSO", "SEM_NOVIDADE"):
                                        logger.info(
                                            f"Sincronização mensal SIGTAP/DATASUS concluída com sucesso ({status}) para {comp_mes_atual}."
                                        )
                                        proximo_wait = intervalo_espera_padrao
                                    else:
                                        # Falha de rede ou DATASUS fora do ar: ativa retry persistente
                                        msg_erro = res_sync.get("mensagem", "Sem detalhes")
                                        logger.warning(
                                            f"DATASUS indisponível ou falha de rede para {comp_mes_atual}: {msg_erro}. "
                                            f"Entrando em retry persistente em {intervalo_retry_falha // 60} minutos."
                                        )
                                        proximo_wait = intervalo_retry_falha

                            # --- Sincronização mensal da Tabela SIA (DATASUS FTP) ---
                            if cfg and getattr(cfg, "sia_sync_automatica", True):
                                sia_ultima_exec = getattr(cfg, "sia_sync_ultima_execucao", None)
                                sia_ultimo_status = getattr(cfg, "sia_sync_ultimo_status", "")
                                sia_ultima_comp = (getattr(cfg, "sia_sync_ultima_competencia", "") or "").replace("-", "")

                                ja_sincronizado_sia = (
                                    sia_ultimo_status in ("SUCESSO", "SEM_NOVIDADE")
                                    and (
                                        (sia_ultima_exec is not None and sia_ultima_exec.year == agora.year and sia_ultima_exec.month == agora.month)
                                        or (sia_ultima_comp == comp_mes_atual)
                                    )
                                )
                                if not ja_sincronizado_sia:
                                    versao_sia = db.exec(
                                        select(SigtapVersao).where(
                                            (SigtapVersao.competencia == comp_mes_atual)
                                            | (SigtapVersao.competencia == agora.strftime("%Y-%m")),
                                            SigtapVersao.origem == "sia_ftp",
                                            SigtapVersao.total_proc > 0,
                                        )
                                    ).first()
                                    if versao_sia:
                                        ja_sincronizado_sia = True
                                        cfg.sia_sync_ultimo_status = "SEM_NOVIDADE"
                                        cfg.sia_sync_ultima_competencia = versao_sia.competencia
                                        db.add(cfg)
                                        db.commit()

                                if not ja_sincronizado_sia and not is_sia_sync_running():
                                    logger.info(
                                        f"Iniciando sincronização mensal da Tabela SIA (FTP DATASUS) para competência {comp_mes_atual}..."
                                    )
                                    res_sia = executar_sync_automatica_sia(db)
                                    st_sia = res_sia.get("status")
                                    if st_sia in ("SUCESSO", "SEM_NOVIDADE"):
                                        logger.info(
                                            f"Sincronização mensal Tabela SIA concluída com sucesso ({st_sia}) para {comp_mes_atual}."
                                        )
                                    else:
                                        logger.warning(
                                            f"FTP DATASUS SIA indisponível para {comp_mes_atual}: {res_sia.get('mensagem')}"
                                        )
                    finally:
                        try:
                            db.rollback()
                        except Exception:
                            pass
                        try:
                            db.execute(text(f"SELECT pg_advisory_unlock({SIGTAP_LEADER_LOCK})"))
                            db.commit()
                        except Exception:
                            pass
        except Exception as e:
            logger.warning(f"Erro no loop mensal SIGTAP/DATASUS: {e}. Novo retry persistente em {intervalo_retry_falha // 60}m.")
            proximo_wait = intervalo_retry_falha

        _STOP_EVENT.wait(proximo_wait)

    logger.info("Worker mensal SIGTAP/DATASUS finalizado.")


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
