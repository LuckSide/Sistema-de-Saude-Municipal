import ast
import importlib
import pathlib
import re
import sys
from fastapi.routing import APIRoute
import pytest


# Mapeamento de nomes de pacotes no requirements.txt para nomes de importação Python
# Exemplos: 'PyJWT' -> 'jwt', 'python-docx' -> 'docx', etc.
PACKAGE_TO_IMPORT_NAME = {
    "pyjwt": "jwt",
    "python-multipart": "multipart",
    "pydantic-settings": "pydantic_settings",
    "email-validator": "email_validator",
    "psycopg2-binary": "psycopg2",
    "python-docx": "docx",
    "passlib": "passlib",
    "bcrypt": "bcrypt",
    "fastapi": "fastapi",
    "uvicorn": "uvicorn",
    "sqlmodel": "sqlmodel",
    "urllib3": "urllib3",
    "msgpack": "msgpack",
    "openpyxl": "openpyxl",
    "gunicorn": "gunicorn",
}

# Dependências transitivas essenciais embutidas pelas bibliotecas acima (ex: FastAPI traz Starlette e Pydantic)
TRANSITIVE_CORE_ALLOWED = {
    "pydantic",
    "starlette",
    "sqlalchemy",
    "cryptography",  # trazido por PyJWT[crypto]
}


def obter_pacotes_declarados_requirements(requirements_path: pathlib.Path) -> set[str]:
    """Lê o backend/requirements.txt e extrai todos os nomes de pacotes declarados."""
    pacotes = set()
    if not requirements_path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {requirements_path}")

    conteudo = requirements_path.read_text(encoding="utf-8")
    for linha in conteudo.splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#"):
            continue
        # Remove extras como [crypto], [standard], [bcrypt]
        linha_sem_extras = re.sub(r"\[.*?\]", "", linha)
        # Extrai o nome do pacote antes de ==, >=, <=, ~=, etc.
        m = re.match(r"^([a-zA-Z0-9_\-\.]+)", linha_sem_extras)
        if m:
            nome_raw = m.group(1).lower().strip()
            # Mapeia para o nome do módulo importado
            nome_import = PACKAGE_TO_IMPORT_NAME.get(nome_raw, nome_raw.replace("-", "_"))
            pacotes.add(nome_import)
            pacotes.add(nome_raw.replace("-", "_"))
    return pacotes


def test_todas_dependencias_terceiros_estao_no_requirements():
    """Garante que NENHUM módulo de terceiro seja importado no código sem estar no requirements.txt.

    Isso evita que um desenvolvedor use uma biblioteca que funciona localmente mas derruba o
    container Docker em produção com 'ModuleNotFoundError' (ex: erro com httpx).
    """
    repo_root = pathlib.Path(__file__).resolve().parent.parent.parent
    requirements_file = repo_root / "backend" / "requirements.txt"
    app_dir = repo_root / "backend" / "app"

    assert requirements_file.exists(), f"requirements.txt não encontrado em {requirements_file}"
    assert app_dir.exists(), f"Diretório app não encontrado em {app_dir}"

    pacotes_permitidos = obter_pacotes_declarados_requirements(requirements_file)
    pacotes_permitidos.update(TRANSITIVE_CORE_ALLOWED)

    # Coleta de todos os imports em backend/app
    modulos_nao_declarados: dict[str, list[str]] = {}

    for py_file in app_dir.rglob("*.py"):
        rel_path = str(py_file.relative_to(repo_root))
        try:
            tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
        except SyntaxError as e:
            pytest.fail(f"Erro de sintaxe em {rel_path}: {e}")

        for node in ast.walk(tree):
            top_level = None
            if isinstance(node, ast.Import):
                for alias in node.names:
                    top_level = alias.name.split(".")[0]
            elif isinstance(node, ast.ImportFrom):
                if node.level == 0 and node.module:
                    top_level = node.module.split(".")[0]

            if top_level:
                # 1. É da stdlib do Python? (sys.stdlib_module_names no Python 3.10+)
                if top_level in sys.stdlib_module_names:
                    continue
                # 2. É módulo interno do app?
                if top_level == "app":
                    continue
                # 3. Está no requirements.txt?
                if top_level in pacotes_permitidos:
                    continue

                modulos_nao_declarados.setdefault(top_level, []).append(rel_path)

    if modulos_nao_declarados:
        detalhes = "\n".join(
            f"  - '{mod}' importado em: {', '.join(sorted(set(files)))}"
            for mod, files in modulos_nao_declarados.items()
        )
        msg = (
            f"\n\n[ERRO CRÍTICO DE DEPENDÊNCIA NÃO DECLARADA]\n"
            f"Foram encontrados módulos de terceiros importados em 'backend/app' que NÃO estão no 'backend/requirements.txt'!\n"
            f"Isso causará 'ModuleNotFoundError' no Docker/Produção.\n"
            f"Módulos detectados:\n{detalhes}\n\n"
            f"Para corrigir: Adicione a biblioteca ao 'backend/requirements.txt' ou substitua por módulos nativos da Standard Library (ex: urllib.request em vez de httpx/requests).\n"
        )
        pytest.fail(msg)


def test_import_de_todos_os_modulos_app_sem_erros():
    """Percorre e importa todos os módulos do backend/app para garantir que não haja erros de import."""
    repo_root = pathlib.Path(__file__).resolve().parent.parent.parent
    app_dir = repo_root / "backend" / "app"

    modulos_com_erro = []
    for py_file in sorted(app_dir.rglob("*.py")):
        rel = py_file.relative_to(repo_root / "backend")
        # Transforma 'app/services/whatsapp.py' em 'app.services.whatsapp'
        parts = list(rel.parts)
        if parts[-1] == "__init__.py":
            mod_name = ".".join(parts[:-1])
        else:
            parts[-1] = parts[-1].replace(".py", "")
            mod_name = ".".join(parts)

        try:
            importlib.import_module(mod_name)
        except Exception as e:
            modulos_com_erro.append(f"{mod_name} ({rel}): {type(e).__name__} - {e}")

    assert not modulos_com_erro, (
        "Falha ao importar os seguintes módulos da aplicação:\n" + "\n".join(modulos_com_erro)
    )


def test_rotas_criticas_registradas_no_app():
    """Garante que todas as rotas essenciais (Auth, Health, WhatsApp, TFD, APAC, Lab) estão devidamente registradas."""
    from app.main import app

    schema = app.openapi()
    rotas_registradas = set(schema.get("paths", {}).keys())

    rotas_obrigatorias = [
        "/api/auth/token",
        "/api/token/",
        "/api/me",
        "/api/health",
        "/api/whatsapp/preview",
        "/api/whatsapp/configuracao",
        "/api/whatsapp/testar",
        "/api/whatsapp/logs",
        "/api/tfd/exames",
        "/api/tfd/pacientes",
        "/api/apac/solicitacoes",
        "/api/lab/solicitacoes",
    ]

    for rota in rotas_obrigatorias:
        assert rota in rotas_registradas, (
            f"A rota essencial '{rota}' não foi encontrada registrada no FastAPI app.main!"
        )


def test_nenhum_arquivo_sensivel_ou_segredo_no_git():
    """Auditoria estrita: garante que nenhum arquivo proibido (.env, .pem, .key, .db, .sqlite3, etc.)

    esteja sendo rastreado pelo Git ou exista solto fora do .gitignore.
    """
    import subprocess

    repo_root = pathlib.Path(__file__).resolve().parent.parent.parent

    # Executa git ls-files para inspecionar arquivos rastreados
    res = subprocess.run(
        ["git", "ls-files"],
        cwd=str(repo_root),
        capture_output=True,
        text=True,
        check=True,
    )
    arquivos_rastreados = res.stdout.splitlines()

    arquivos_proibidos = []
    padroes_proibidos = [
        r"\.env$",
        r"\.env\.(?!example$)",
        r"\.pem$",
        r"\.key$",
        r"\.pfx$",
        r"\.dump$",
        r"\.sqlite3?$",
        r"\.db$",
        r"\.log$",
        r"\.DS_Store$",
    ]

    for f in arquivos_rastreados:
        for padrao in padroes_proibidos:
            if re.search(padrao, f, re.IGNORECASE):
                arquivos_proibidos.append(f)

    assert not arquivos_proibidos, (
        f"ALERTA DE SEGURANÇA: Os seguintes arquivos sensíveis estão sendo rastreados pelo Git!\n"
        + "\n".join(arquivos_proibidos)
    )
