import logging
import os
import socket
import subprocess
import tempfile
import time
from typing import Optional

logger = logging.getLogger("pec_tunnel")

_TUNNEL_PROC: Optional[subprocess.Popen] = None
_TUNNEL_PORT: int = 5433


def verificar_porta_aberta(host: str = "127.0.0.1", port: int = 5433, timeout: float = 1.0) -> bool:
    """Verifica se a porta local está aberta e aceitando conexões."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        res = s.connect_ex((host, port))
        return res == 0
    except Exception:
        return False
    finally:
        s.close()


def status_tunel(local_port: int = 5433) -> dict:
    """Retorna o status do túnel SSH local."""
    global _TUNNEL_PROC
    porta_ativa = verificar_porta_aberta("127.0.0.1", local_port, timeout=0.8)
    proc_ativo = _TUNNEL_PROC is not None and _TUNNEL_PROC.poll() is None
    return {
        "ativo": porta_ativa,
        "porta_local": local_port,
        "pid": _TUNNEL_PROC.pid if proc_ativo else None,
        "gerenciado": proc_ativo,
    }


def parar_tunel():
    """Finaliza o processo do túnel SSH se estiver em execução."""
    global _TUNNEL_PROC
    if _TUNNEL_PROC is not None:
        try:
            if _TUNNEL_PROC.poll() is None:
                _TUNNEL_PROC.terminate()
                _TUNNEL_PROC.wait(timeout=2)
        except Exception:
            try:
                _TUNNEL_PROC.kill()
            except Exception:
                pass
        _TUNNEL_PROC = None


def iniciar_tunel(
    ssh_host: str,
    ssh_port: int = 22,
    ssh_user: str = "master",
    ssh_pass: str = "",
    ssh_key: str = "",
    local_port: int = 5433,
    remote_host: str = "127.0.0.1",
    remote_port: int = 5432,
    timeout: int = 5,
) -> dict:
    """Inicia um túnel SSH seguro em segundo plano: 127.0.0.1:local_port -> remote_host:remote_port."""
    global _TUNNEL_PROC, _TUNNEL_PORT
    _TUNNEL_PORT = local_port

    # Se a porta já estiver aberta e respondendo, reutiliza
    if verificar_porta_aberta("127.0.0.1", local_port, timeout=0.5):
        return {
            "ok": True,
            "porta_local": local_port,
            "mensagem": f"Túnel SSH já ativo na porta {local_port}.",
            "reutilizado": True,
        }

    parar_tunel()

    temp_files = []
    env = os.environ.copy()

    try:
        cmd = [
            "ssh",
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "ExitOnForwardFailure=yes",
            "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=3",
            "-o", f"ConnectTimeout={timeout}",
            "-p", str(ssh_port),
            "-N",
            "-L", f"127.0.0.1:{local_port}:{remote_host}:{remote_port}",
        ]

        if ssh_key.strip():
            key_file = tempfile.NamedTemporaryFile("w", delete=False)
            key_file.write(ssh_key.strip() + "\n")
            key_file.close()
            os.chmod(key_file.name, 0o600)
            temp_files.append(key_file.name)
            cmd.extend(["-i", key_file.name, "-o", "PreferredAuthentications=publickey"])
        elif ssh_pass:
            askpass = tempfile.NamedTemporaryFile("w", delete=False)
            askpass.write(f"#!/bin/sh\necho \"{ssh_pass}\"\n")
            askpass.close()
            os.chmod(askpass.name, 0o755)
            temp_files.append(askpass.name)
            env["SSH_ASKPASS"] = askpass.name
            env["SSH_ASKPASS_REQUIRE"] = "force"
            env["DISPLAY"] = ":0"
            cmd.extend(["-o", "PreferredAuthentications=password,keyboard-interactive"])

        cmd.append(f"{ssh_user}@{ssh_host}")

        _TUNNEL_PROC = subprocess.Popen(
            cmd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        # Aguarda a porta abrir (até timeout segundos)
        t_fim = time.monotonic() + timeout
        porta_abriu = False
        while time.monotonic() < t_fim:
            if _TUNNEL_PROC.poll() is not None:
                _, err = _TUNNEL_PROC.communicate(timeout=1)
                raise RuntimeError(f"SSH encerrou com erro: {err.strip()}")
            if verificar_porta_aberta("127.0.0.1", local_port, timeout=0.3):
                porta_abriu = True
                break
            time.sleep(0.3)

        if not porta_abriu:
            parar_tunel()
            raise RuntimeError(f"Túnel SSH não abriu a porta {local_port} no tempo limite de {timeout}s.")

        return {
            "ok": True,
            "porta_local": local_port,
            "pid": _TUNNEL_PROC.pid,
            "mensagem": f"Túnel SSH estabelecido com sucesso na porta {local_port}.",
        }
    finally:
        for f in temp_files:
            try:
                os.unlink(f)
            except Exception:
                pass


def garantir_tunel_db(cfg=None) -> tuple[bool, str]:
    """Garante que o túnel SSH esteja ativo se configurado em IntegrationSettings.
    Retorna (ativo, dsn).
    """
    if cfg is None:
        try:
            from sqlmodel import Session, select
            from app.db.session import engine
            from app.models.integracoes import IntegrationSettings

            with Session(engine) as s:
                cfg = s.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
        except Exception:
            return False, ""

    if not cfg:
        return False, ""

    porta_local = getattr(cfg, "pec_porta_local", 5433) or 5433
    banco = getattr(cfg, "pec_banco_nome", "esus") or "esus"
    usuario = getattr(cfg, "pec_usuario", "") or "painel_readonly"
    senha = getattr(cfg, "pec_senha", "") or ""

    if getattr(cfg, "pec_ssh_habilitado", False):
        ssh_host = getattr(cfg, "pec_ssh_host", "") or ""
        ssh_port = getattr(cfg, "pec_ssh_porta", 22) or 22
        ssh_user = getattr(cfg, "pec_ssh_usuario", "") or "master"
        ssh_pass = getattr(cfg, "pec_ssh_senha", "") or ""
        ssh_key = getattr(cfg, "pec_ssh_chave_privada", "") or ""

        if not ssh_host:
            return False, ""

        try:
            res = iniciar_tunel(
                ssh_host=ssh_host,
                ssh_port=ssh_port,
                ssh_user=ssh_user,
                ssh_pass=ssh_pass,
                ssh_key=ssh_key,
                local_port=porta_local,
                remote_host="127.0.0.1",
                remote_port=5432,
            )
            if res.get("ok"):
                dsn = f"postgresql://{usuario}:{senha}@127.0.0.1:{porta_local}/{banco}"
                return True, dsn
        except Exception as e:
            logger.warning("Erro ao inicializar túnel SSH PEC: %s", e)
            return False, ""

    # Se SSH não estiver habilitado, usa conexão direta
    if getattr(cfg, "pec_database_url", ""):
        return True, cfg.pec_database_url
    elif usuario and senha and getattr(cfg, "pec_servidor_url", ""):
        host = cfg.pec_servidor_url.replace("http://", "").replace("https://", "").split(":")[0]
        dsn = f"postgresql://{usuario}:{senha}@{host}:5432/{banco}"
        return True, dsn

    return False, ""
