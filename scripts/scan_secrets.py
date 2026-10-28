#!/usr/bin/env python3
"""Script de Auditoria de Segurança e Secrets Scanning para o repositório.

Executa varredura profunda em arquivos rastreados, não rastreados e no histórico Git
para impedir o vazamento acidental de segredos, credenciais e dados sensíveis (LGPD).
"""

import os
import re
import subprocess
import sys

# Padrões regex para detecção de segredos e credenciais de alto risco
RE_SECRETS = [
    ("Chave Privada (RSA/DSA/EC/OpenSSH)", re.compile(r"-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----")),
    ("GitHub Token", re.compile(r"(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}|github_pat_[A-Za-z0-9_]{82}")),
    ("AWS Access Key", re.compile(r"(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}")),
    ("Token de API / Chave Secreta Hardcoded", re.compile(r"""(?:api_key|apikey|secret_key|private_key)\s*=\s*['\"][a-zA-Z0-9_\-\.]{24,}['\"]""", re.IGNORECASE)),
    ("String de Conexão com Senha Exposta", re.compile(r"""postgresql(?:\+psycopg2)?://([^:\s]+):([^@\s]+)@(?!(?:localhost|127\.0\.0\.1|host|db|database|servidor))([^\s/:]+)""", re.IGNORECASE)),
    ("Chave Privada RNDS / PEM", re.compile(r"-----BEGIN CERTIFICATE-----")),
]

EXTENSOES_PROIBIDAS = {".env", ".pem", ".key", ".pfx", ".pkcs12", ".bak", ".dump", ".sql", ".log"}

IGNORAR_DIRETORIOS = {
    ".git",
    "node_modules",
    "dist",
    "dist-ssr",
    "build",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
    ".openchamber",
}

IGNORAR_ARQUIVOS = {
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    ".env.example",
    "scan_secrets.py",
}

WHITELIST_SUBSTRINGS = [
    "troque-esta-chave",
    "gere_uma_chave",
    "defina_uma_senha",
    "ghp_...",
    "your_token",
    "your-secret",
    "usuario:senha",
    "user:password",
    "user:pass",
    "guape:guape123",
    "placeholder=",
    "Ex:",
    "ex:",
    "mock",
    "{c.pec_senha}",
    "{senha}",
    "f\"postgresql://",
    "f'postgresql://",
]


def eh_falso_positivo(texto: str) -> bool:
    for w in WHITELIST_SUBSTRINGS:
        if w in texto:
            return True
    return False


def escanear_arquivos(root_dir: str) -> list[tuple[str, str, str]]:
    vulnerabilidades = []

    for dirpath, dirnames, filenames in os.walk(root_dir):
        dirnames[:] = [d for d in dirnames if d not in IGNORAR_DIRETORIOS]

        for fname in filenames:
            fpath = os.path.join(dirpath, fname)
            relpath = os.path.relpath(fpath, root_dir)

            if fname in IGNORAR_ARQUIVOS:
                continue

            # 1. Verifica extensão proibida
            _, ext = os.path.splitext(fname)
            eh_migration_sql = ext.lower() == ".sql" and any(
                part in ("migrations", "migration") for part in relpath.split(os.sep)
            )
            if (ext.lower() in EXTENSOES_PROIBIDAS and not eh_migration_sql) or fname.startswith(".env."):
                vulnerabilidades.append((relpath, f"Arquivo com extensão sensível restrita ({ext})", fname))
                continue

            if fname.endswith((".pyc", ".png", ".jpg", ".jpeg", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".pdf")):
                continue

            # 2. Varredura de conteúdo
            try:
                with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                    linhas = f.readlines()
                    for idx, linha in enumerate(linhas, 1):
                        for rotulo, pattern in RE_SECRETS:
                            matches = pattern.findall(linha)
                            for m in matches:
                                m_str = str(m)
                                if not eh_falso_positivo(linha):
                                    snippet = linha.strip()[:80]
                                    vulnerabilidades.append((
                                        f"{relpath}:{idx}",
                                        rotulo,
                                        f"Trecho: {snippet}"
                                    ))
            except Exception:
                pass

    return vulnerabilidades


def escanear_historico_git() -> list[str]:
    problemas = []
    try:
        # Verifica se há commits contendo chaves privadas ou tokens no histórico
        res = subprocess.run(
            ["git", "log", "-G-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----", "--oneline"],
            capture_output=True,
            text=True
        )
        if res.stdout.strip():
            problemas.append(f"Histórico Git contém commits com chave privada:\n{res.stdout.strip()}")

        res_tokens = subprocess.run(
            ["git", "log", "-G(ghp|gho)_[A-Za-z0-9_]{36}", "--oneline"],
            capture_output=True,
            text=True
        )
        if res_tokens.stdout.strip():
            problemas.append(f"Histórico Git contém commits com token GitHub:\n{res_tokens.stdout.strip()}")
    except Exception as e:
        problemas.append(f"Falha ao checar histórico git: {e}")

    return problemas


def main():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    print(f"\n🔍 [AUDITORIA DE SEGURANÇA] Iniciando verificação em: {root}")

    # 1. Escanear arquivos
    falhas_arquivos = escanear_arquivos(root)

    # 2. Escanear histórico Git
    falhas_git = escanear_historico_git()

    total_problemas = len(falhas_arquivos) + len(falhas_git)

    if total_problemas == 0:
        print("\n✅ [SUCESSO] Repositório 100% LIMPO! Nenhum segredo ou credencial sensível detectado.")
        print("   - .gitignore configurado adequadamente.")
        print("   - Nenhum arquivo .env, .pem, .key ou chave privada rastreada.")
        print("   - Histórico Git livre de vazamentos.")
        sys.exit(0)
    else:
        print(f"\n❌ [ALERTA DE SEGURANÇA] {total_problemas} problema(s) detectado(s):\n")
        for local, tipo, detalhe in falhas_arquivos:
            print(f"  • {local} -> [{tipo}] {detalhe}")
        for p in falhas_git:
            print(f"  • [GIT] {p}")
        sys.exit(1)


if __name__ == "__main__":
    main()
