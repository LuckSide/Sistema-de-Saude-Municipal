"""Versão do sistema + commit local (sem dependências externas)."""

from pathlib import Path
import subprocess

APP_VERSION = "1.0.0"

CANDIDATOS_REPO = ["/repo", "/app", "/code", "."]


def repo_dir() -> Path | None:
    for c in CANDIDATOS_REPO:
        p = Path(c)
        if (p / ".git").exists():
            return p
    return None


def commit_local() -> str | None:
    r = repo_dir()
    if not r:
        return None
    try:
        out = subprocess.run(
            ["git", "-C", str(r), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        sha = out.stdout.strip()
        return sha or None
    except Exception:
        return None


def commit_curto() -> str | None:
    sha = commit_local()
    return sha[:12] if sha else None
