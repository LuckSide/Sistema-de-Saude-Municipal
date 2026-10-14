"""Checagem de atualizações via GitHub + disparo de auto-update (só comandos whitelist)."""

import json
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import settings
from app.core.version import APP_VERSION, commit_local, repo_dir

_CACHE: dict = {"em": 0.0, "dados": None}
CACHE_SEGUNDOS = 300
LOG_PATH = Path("/tmp/atualizacao.log")


def _github_get(url: str) -> dict | list | None:
    req = urllib.request.Request(
        url, headers={"User-Agent": "saude-municipal-update", "Accept": "application/vnd.github+json"}
    )
    if settings.GITHUB_TOKEN:
        req.add_header("Authorization", f"Bearer {settings.GITHUB_TOKEN}")
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read().decode("utf-8"))
    except Exception:
        return None


def verificar_atualizacoes(forcar: bool = False) -> dict:
    agora = time.time()
    if not forcar and _CACHE["dados"] and (agora - _CACHE["em"]) < CACHE_SEGUNDOS:
        return _CACHE["dados"]

    owner, repo = settings.GITHUB_OWNER, settings.GITHUB_REPO
    branch = settings.UPDATE_BRANCH
    local = commit_local()
    remoto: str | None = None
    release: str | None = None
    release_url: str | None = None
    erro: str | None = None

    if not settings.UPDATE_ENABLED:
        erro = "Auto-update desabilitado (UPDATE_ENABLED=false)"

    if settings.UPDATE_ENABLED:
        # Compara SHA local x remoto (fonte: branch main)
        data = _github_get(f"https://api.github.com/repos/{owner}/{repo}/commits/{branch}")
        if isinstance(data, dict) and data.get("sha"):
            remoto = data["sha"]
        else:
            erro = "Falha ao consultar GitHub (rede ou repo inexistente)"
        # Release latest só p/ exibir tag/link (não bloqueia)
        rel = _github_get(f"https://api.github.com/repos/{owner}/{repo}/releases/latest")
        if isinstance(rel, dict) and rel.get("tag_name"):
            release = rel["tag_name"]
            release_url = rel.get("html_url")

    tem_update = bool(settings.UPDATE_ENABLED and local and remoto and local != remoto)
    out = {
        "versao": APP_VERSION,
        "atual": not tem_update,
        "tem_atualizacao": tem_update,
        "commit_local": local[:12] if local else None,
        "commit_remoto": remoto[:12] if remoto else None,
        "release": release,
        "release_url": release_url,
        "branch": branch,
        "repo": f"{owner}/{repo}",
        "verificado_em": datetime.now(timezone.utc).isoformat(),
        "erro": erro,
        "update_enabled": settings.UPDATE_ENABLED,
    }
    _CACHE["em"] = agora
    _CACHE["dados"] = out
    return out


def _script_path() -> Path | None:
    r = repo_dir()
    if r and (r / "backend" / "scripts" / "atualizar.sh").exists():
        return r / "backend" / "scripts" / "atualizar.sh"
    for c in (Path("/code/backend/scripts/atualizar.sh"), Path("backend/scripts/atualizar.sh")):
        if c.exists():
            return c
    return None


def iniciar_atualizacao() -> dict:
    """Dispara script em background (detached) e retorna na hora — sem travar request."""
    if not settings.UPDATE_ENABLED:
        raise ValueError("Auto-update desabilitado no servidor")
    script = _script_path()
    if not script:
        raise ValueError("Script atualizar.sh não encontrado (repo não montado em /repo?)")
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    log = open(LOG_PATH, "ab")
    try:
        subprocess.Popen(
            ["bash", str(script)],
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    finally:
        # log segue aberto pelo filho; fecha cópia do pai
        try:
            log.close()
        except Exception:
            pass
    _CACHE["dados"] = None
    return {"started": True, "detail": "Atualização iniciada em background. Containers reiniciam sozinhos."}


def ler_log(linhas: int = 200) -> str:
    try:
        texto = LOG_PATH.read_text(errors="replace").splitlines()
        return "\n".join(texto[-linhas:])
    except FileNotFoundError:
        return "(sem log ainda — nenhuma atualização executada)"
    except Exception as e:
        return f"(erro ao ler log: {e})"
