import pytest
from playwright.sync_api import sync_playwright
import psycopg2


def test_smoke_e2e_login_fila_acompanhamento():
    """Teste E2E de fumaça (Playwright): login admin -> fila de regulação -> portal público LGPD sem login."""
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        try:
            page = browser.new_page()

            # 1. Login no painel
            page.goto("http://localhost:5173/login")
            page.fill('input[placeholder="Digite seu usuário"]', "admin")
            page.fill('input[placeholder="Digite sua senha"]', "admin123")
            page.click('button:has-text("Entrar no painel")')
            page.wait_for_url("**/", timeout=15000)
            assert page.url.endswith("/") or "/dashboard" in page.url

            # 2. Fila de Regulação (TFD)
            page.goto("http://localhost:5173/fila-exames")
            page.wait_for_selector('h2:has-text("Fila de Procedimentos")', timeout=15000)
            page.wait_for_selector("table tbody tr", timeout=15000)
            linhas = page.locator("table tbody tr").count()
            assert linhas >= 1, "A tabela da fila de procedimentos deve carregar registros"

            # 3. Pacientes (TFD)
            page.goto("http://localhost:5173/tfd/pacientes")
            page.wait_for_selector("table tbody tr", timeout=15000)
            linhas_pac = page.locator("table tbody tr").count()
            assert linhas_pac >= 1, "A tabela de pacientes deve carregar registros"

            # 4. Portal Público LGPD (sessão anônima sem autenticação)
            conn = psycopg2.connect("postgresql://guape:guape123@127.0.0.1:5432/saude_guape")
            cur = conn.cursor()
            cur.execute("SELECT public_token FROM tfd_exames_fila WHERE ativo = true AND public_token IS NOT NULL LIMIT 1;")
            row = cur.fetchone()
            conn.close()
            assert row is not None, "Deve existir ao menos um exame ativo com public_token"
            token = row[0]

            anon_context = browser.new_context()
            page_pub = anon_context.new_page()
            page_pub.goto(f"http://localhost:5173/acompanhar/{token}")
            page_pub.wait_for_selector('text="Acompanhar pedido"', timeout=15000)

            conteudo = page_pub.locator("body").text_content() or ""
            assert "Acompanhar pedido" in conteudo
            assert "consulta sem login" in conteudo

            # Validação de conformidade LGPD: não deve vazar CPF na tela pública
            assert "CPF" not in conteudo

        finally:
            browser.close()
