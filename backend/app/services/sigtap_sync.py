"""Serviço de descoberta e atualização automática da Tabela Unificada SIGTAP/DATASUS."""

from __future__ import annotations

from datetime import datetime
import ftplib
import io
import logging
import os
import re
import ssl
import threading
import urllib.parse
import urllib.request
from typing import Optional

from sqlalchemy import text
from sqlmodel import Session, select

from app.models.integracoes import IntegrationSettings
from app.models.lab_exames import SigtapVersao

logger = logging.getLogger("sigtap_sync")

ADVISORY_LOCK_SIGTAP = 847291994
_SIGTAP_LOCK = threading.Lock()
_SIGTAP_RUNNING = False

PORTAL_SIGTAP_URL = "http://sigtap.datasus.gov.br/tabela-unificada/app/download.jsp"
FTP_HOST = "ftp.datasus.gov.br"
FTP_DIR = "/dissemin/publicos/SIASUS/200801_/TabelaUnificada"


def is_sigtap_sync_running() -> bool:
    return _SIGTAP_RUNNING


def _baixar_url_zip(url: str, timeout: int = 8) -> Optional[bytes]:
    if not url or not url.lower().startswith(("http://", "https://", "ftp://")):
        return None
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/124.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        conteudo = resp.read()
        if conteudo and conteudo.startswith(b"PK"):
            return conteudo
    return None


def _descobrir_links_portal(competencia: str | None = None, timeout: int = 5) -> list[tuple[str, str]]:
    """Inspeciona o HTML da página oficial do DATASUS em busca dos pacotes .zip."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(
        PORTAL_SIGTAP_URL,
        headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/124.0"},
    )
    encontrados: list[tuple[str, str]] = []
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        raw = resp.read()
        if raw and raw.startswith(b"PK"):
            comp_tag = competencia or datetime.utcnow().strftime("%Y-%m")
            return [(comp_tag, PORTAL_SIGTAP_URL)]
        html = raw.decode("latin-1", "ignore")

    alvo_ym = competencia.replace("-", "") if competencia else ""
    for href in re.findall(r"""href=["']([^"']*TabelaUnificada[^"']*\.zip)["']""", html, re.IGNORECASE):
        full_url = urllib.parse.urljoin(PORTAL_SIGTAP_URL, href)
        m = re.search(r"TabelaUnificada_(\d{4})(\d{2})", href, re.IGNORECASE)
        comp_link = f"{m.group(1)}-{m.group(2)}" if m else (competencia or datetime.utcnow().strftime("%Y-%m"))
        if not alvo_ym or (m and f"{m.group(1)}{m.group(2)}" == alvo_ym):
            encontrados.append((comp_link, full_url))
    encontrados.sort(key=lambda x: x[0], reverse=True)
    return encontrados


def _descobrir_arquivos_ftp(competencia: str | None = None, timeout: int = 5) -> list[tuple[str, str]]:
    """Lista arquivos TabelaUnificada_*.zip no repositório FTP oficial do DATASUS."""
    alvo_ym = competencia.replace("-", "") if competencia else ""
    encontrados: list[tuple[str, str]] = []
    ftp = ftplib.FTP(FTP_HOST, timeout=timeout)
    try:
        ftp.login()
        ftp.cwd(FTP_DIR)
        nomes = ftp.nlst()
    finally:
        try:
            ftp.quit()
        except Exception:
            pass

    for nome in nomes:
        base = os.path.basename(nome)
        m = re.match(r"^TabelaUnificada_(\d{4})(\d{2}).*\.zip$", base, re.IGNORECASE)
        if not m:
            continue
        ym = f"{m.group(1)}{m.group(2)}"
        comp_link = f"{m.group(1)}-{m.group(2)}"
        if not alvo_ym or ym == alvo_ym:
            encontrados.append((comp_link, base))

    encontrados.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return encontrados


def _baixar_arquivo_ftp(nome_arquivo: str, timeout: int = 10) -> Optional[bytes]:
    buf = io.BytesIO()
    ftp = ftplib.FTP(FTP_HOST, timeout=timeout)
    try:
        ftp.login()
        ftp.cwd(FTP_DIR)
        ftp.retrbinary(f"RETR {nome_arquivo}", buf.write)
    finally:
        try:
            ftp.quit()
        except Exception:
            pass
    data = buf.getvalue()
    return data if data and data.startswith(b"PK") else None


def baixar_tabela_unificada_datasus(
    competencia: Optional[str] = None,
    timeout: int = 5,
) -> Optional[tuple[str, str, bytes]]:
    """Descobre e baixa o pacote .zip da Tabela Unificada do DATASUS/SIGTAP.

    Retorna `(competencia_aaaa_mm, nome_arquivo, raw_bytes)` ou `None` se indisponível.
    """
    comp_alvo = (competencia or "").strip() or None

    # 1. Tenta descobrir link direto na página oficial do SIGTAP DATASUS
    try:
        links = _descobrir_links_portal(comp_alvo, timeout=timeout)
        for comp_link, url in links[:3]:
            try:
                raw = _baixar_url_zip(url, timeout=timeout)
                if raw:
                    nome = os.path.basename(urllib.parse.urlparse(url).path) or f"TabelaUnificada_{comp_link.replace('-', '')}.zip"
                    return comp_link, nome, raw
            except Exception:
                continue
    except Exception:
        pass

    # 2. Tenta descobrir versão exata no diretório FTP DATASUS e baixar via HTTP/FTP
    try:
        arqs = _descobrir_arquivos_ftp(comp_alvo, timeout=timeout)
        for comp_link, nome in arqs[:2]:
            for url_dir in (f"http://{FTP_HOST}{FTP_DIR}/{nome}", f"ftp://{FTP_HOST}{FTP_DIR}/{nome}"):
                try:
                    raw = _baixar_url_zip(url_dir, timeout=timeout)
                    if raw:
                        return comp_link, nome, raw
                except Exception:
                    continue
            try:
                raw = _baixar_arquivo_ftp(nome, timeout=max(timeout, 8))
                if raw:
                    return comp_link, nome, raw
            except Exception:
                continue
    except Exception:
        pass

    # 3. Fallback direto para URLs padrão da competência solicitada (ou mês atual/anterior)
    if not comp_alvo:
        hoje = datetime.utcnow()
        candidatos_comp = [hoje.strftime("%Y-%m")]
        mes_ant = hoje.month - 1 or 12
        ano_ant = hoje.year if hoje.month > 1 else hoje.year - 1
        candidatos_comp.append(f"{ano_ant:04d}-{mes_ant:02d}")
    else:
        candidatos_comp = [comp_alvo]

    for comp in candidatos_comp:
        ano, mes = comp.split("-")
        for url in (
            f"ftp://{FTP_HOST}{FTP_DIR}/TabelaUnificada_{ano}{mes}.zip",
            f"http://{FTP_HOST}{FTP_DIR}/TabelaUnificada_{ano}{mes}.zip",
        ):
            try:
                raw = _baixar_url_zip(url, timeout=timeout)
                if raw:
                    return comp, f"TabelaUnificada_{ano}{mes}.zip", raw
            except Exception:
                continue

    return None


def executar_sync_automatica_sigtap(
    db: Session,
    competencia: Optional[str] = None,
    usuario: str = "Rotina Automática DATASUS",
    forcar: bool = False,
    simular: bool = False,
) -> dict:
    """Executa verificação e importação automática periódica do SIGTAP via DATASUS."""
    global _SIGTAP_RUNNING

    if not _SIGTAP_LOCK.acquire(blocking=False):
        return {"ok": False, "status": "EM_EXECUCAO", "mensagem": "Sincronização SIGTAP já está em andamento."}

    is_pg_locked = False
    try:
        res = db.execute(text(f"SELECT pg_try_advisory_lock({ADVISORY_LOCK_SIGTAP})")).scalar()
        if res is False:
            _SIGTAP_LOCK.release()
            return {"ok": False, "status": "EM_EXECUCAO", "mensagem": "Sincronização SIGTAP já em execução em outro worker."}
        if res is True:
            is_pg_locked = True
    except Exception:
        pass

    _SIGTAP_RUNNING = True
    try:
        from app.services.sigtap_import import importar_sigtap

        cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
        pacote = baixar_tabela_unificada_datasus(competencia=competencia)
        agora = datetime.utcnow()

        if not pacote:
            msg = "Portal DATASUS/SIGTAP indisponível ou nenhuma competência acessível no momento."
            if cfg:
                cfg.sigtap_sync_ultima_execucao = agora
                cfg.sigtap_sync_ultimo_status = "INDISPONIVEL"
                cfg.sigtap_sync_ultimo_erro = msg
                db.add(cfg)
                db.commit()
            return {"ok": False, "status": "INDISPONIVEL", "mensagem": msg}

        comp_encontrada, nome_arq, raw_bytes = pacote

        if not forcar and not simular:
            ja_importada = db.exec(
                select(SigtapVersao).where(
                    SigtapVersao.competencia == comp_encontrada,
                    SigtapVersao.total_proc > 0,
                )
            ).first()
            if ja_importada:
                if cfg:
                    cfg.sigtap_sync_ultima_execucao = agora
                    cfg.sigtap_sync_ultimo_status = "SEM_NOVIDADE"
                    cfg.sigtap_sync_ultima_competencia = comp_encontrada
                    cfg.sigtap_sync_ultimo_erro = ""
                    db.add(cfg)
                    db.commit()
                return {
                    "ok": True,
                    "status": "SEM_NOVIDADE",
                    "competencia": comp_encontrada,
                    "arquivo": nome_arq,
                    "mensagem": f"Competência {comp_encontrada} já importada anteriormente.",
                }

        stats = importar_sigtap(
            db,
            [(nome_arq, raw_bytes)],
            comp_encontrada,
            usuario,
            simular=simular,
            origem="datasus_auto" if not simular else "simulacao",
        )
        if cfg and not simular:
            cfg.sigtap_sync_ultima_execucao = agora
            cfg.sigtap_sync_ultimo_status = "SUCESSO"
            cfg.sigtap_sync_ultima_competencia = comp_encontrada
            cfg.sigtap_sync_ultimo_erro = ""
            db.add(cfg)
            db.commit()
        return {"ok": True, "status": "SUCESSO", **stats}
    except Exception as e:
        logger.warning(f"Erro na sincronização automática SIGTAP/DATASUS: {e}")
        try:
            cfg = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
            if cfg:
                cfg.sigtap_sync_ultima_execucao = datetime.utcnow()
                cfg.sigtap_sync_ultimo_status = "ERRO"
                cfg.sigtap_sync_ultimo_erro = str(e)[:500]
                db.add(cfg)
                db.commit()
        except Exception:
            pass
        return {"ok": False, "status": "ERRO", "mensagem": str(e)[:500]}
    finally:
        if is_pg_locked:
            try:
                db.execute(text(f"SELECT pg_advisory_unlock({ADVISORY_LOCK_SIGTAP})"))
            except Exception:
                pass
        _SIGTAP_RUNNING = False
        _SIGTAP_LOCK.release()
