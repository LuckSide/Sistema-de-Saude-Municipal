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

    import re
    from pathlib import Path

    ssh_host_c = (ssh_host or "").strip()
    ssh_user_c = (ssh_user or "").strip()
    remote_host_c = (remote_host or "127.0.0.1").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,149}", ssh_host_c):
        raise ValueError("Host SSH inválido")
    if not re.fullmatch(r"[A-Za-z0-9._][A-Za-z0-9._-]{0,119}", ssh_user_c):
        raise ValueError("Usuário SSH inválido")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,149}", remote_host_c):
        raise ValueError("Host remoto do túnel inválido")
    ssh_port_i = int(ssh_port)
    local_port_i = int(local_port)
    remote_port_i = int(remote_port)
    if not (1 <= ssh_port_i <= 65535 and 1024 <= local_port_i <= 65535 and 1 <= remote_port_i <= 65535):
        raise ValueError("Porta SSH ou porta local do túnel fora do intervalo permitido")

    known_hosts_dir = Path(__file__).resolve().parent.parent.parent / "storage" / "ssh"
    try:
        known_hosts_dir.mkdir(parents=True, exist_ok=True)
        os.chmod(known_hosts_dir, 0o700)
        known_hosts_path = known_hosts_dir / "known_hosts"
    except OSError:
        known_hosts_path = Path(tempfile.gettempdir()) / "saude_pec_known_hosts"
    known_hosts_path.touch(exist_ok=True)
    try:
        os.chmod(known_hosts_path, 0o600)
    except OSError:
        pass

    temp_files = []
    env = os.environ.copy()
    err_tmp = None

    try:
        cmd = [
            "ssh",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", f"UserKnownHostsFile={known_hosts_path}",
            "-o", "ExitOnForwardFailure=yes",
            "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=3",
            "-o", f"ConnectTimeout={int(timeout)}",
            "-p", str(ssh_port_i),
            "-N",
            "-L", f"127.0.0.1:{local_port_i}:{remote_host_c}:{remote_port_i}",
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
            askpass.write("#!/bin/sh\nexec printenv SAUDE_SSH_ASKPASS_SECRET\n")
            askpass.close()
            os.chmod(askpass.name, 0o700)
            temp_files.append(askpass.name)
            env["SAUDE_SSH_ASKPASS_SECRET"] = ssh_pass
            env["SSH_ASKPASS"] = askpass.name
            env["SSH_ASKPASS_REQUIRE"] = "force"
            env["DISPLAY"] = ":0"
            cmd.extend(["-o", "PreferredAuthentications=password,keyboard-interactive"])

        cmd.extend(["--", f"{ssh_user_c}@{ssh_host_c}"])

        err_tmp = tempfile.TemporaryFile(mode="w+", encoding="utf-8", errors="replace")
        _TUNNEL_PROC = subprocess.Popen(
            cmd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=err_tmp,
        )

        # Aguarda a porta abrir (até timeout segundos)
        t_fim = time.monotonic() + timeout
        porta_abriu = False
        while time.monotonic() < t_fim:
            if _TUNNEL_PROC.poll() is not None:
                err_tmp.seek(0)
                err = err_tmp.read().strip()
                raise RuntimeError(f"SSH encerrou com erro: {err[:300]}")
            if verificar_porta_aberta("127.0.0.1", local_port_i, timeout=0.3):
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
                from urllib.parse import quote_plus
                dsn = f"postgresql://{quote_plus(usuario)}:{quote_plus(senha)}@127.0.0.1:{porta_local}/{quote_plus(banco)}"
                return True, dsn
        except Exception as e:
            logger.warning("Erro ao inicializar túnel SSH PEC: %s", e)
            return False, ""

    # Se SSH não estiver habilitado, usa conexão direta
    if getattr(cfg, "pec_database_url", ""):
        return True, cfg.pec_database_url
    elif usuario and senha and getattr(cfg, "pec_servidor_url", ""):
        from urllib.parse import quote_plus
        host = cfg.pec_servidor_url.replace("http://", "").replace("https://", "").split(":")[0].split("/")[0]
        dsn = f"postgresql://{quote_plus(usuario)}:{quote_plus(senha)}@{host}:5432/{quote_plus(banco)}"
        return True, dsn

    return False, ""
