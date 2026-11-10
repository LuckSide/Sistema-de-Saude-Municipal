"""Teste de Carga com Locust — Simulação de 30 a 100 Usuários Simultâneos.

Simula o fluxo real de trabalho dos operadores de PSF, reguladores e médicos:
1. Autenticação e obtenção do Bearer Token (/api/token/)
2. Consulta e paginação na Fila de Espera (Demanda Reprimida)
3. Alternância dinâmica entre tipos de fila e especialidades canônicas
4. Visão Semanal e Quadro Diário de Viagens e Frota
5. Calendário de Vagas e Solicitações de Exames Laboratoriais
6. Autocomplete e busca de Pacientes e Médicos
7. Resumo e Indicadores do Município
8. Exportação de Relatórios e Planilhas

Execução via linha de comando:
    locust -f locustfile.py --headless -u 30 -r 5 --run-time 1m --host http://localhost:8000
"""

import os
import random
from datetime import date, timedelta
from locust import HttpUser, between, events, task


# Datas de referência dinâmicas
def _segunda_feira_atual() -> str:
    hoje = date.today()
    segunda = hoje - timedelta(days=hoje.weekday())
    return segunda.isoformat()


def _mes_atual() -> str:
    return date.today().strftime("%Y-%m")


ESPECIALIDADES_TESTE = [
    "Cardiologia",
    "Ortopedia",
    "Oftalmologia",
    "Neurologia",
    "Urologia",
    "Dermatologia",
    "Ginecologia",
    "Pediatria",
    "Endocrinologia",
    "Otorrinolaringologia",
]

TIPOS_FILA_TESTE = [
    "CONSULTAS ESPECIALIZADAS",
    "EXAMES DE IMAGEM",
    "ELETIVO",
    "CIRURGIA ELETIVA",
    "TRATAMENTO FORA DO DOMICÍLIO",
]

TERMOS_BUSCA = [
    "Maria",
    "José",
    "Silva",
    "Santos",
    "Oliveira",
    "Souza",
    "Pereira",
    "Lucas",
    "Ana",
    "João",
]


class OperadorSaudeUser(HttpUser):
    # Think time realista entre interações humanas (1 a 3 segundos)
    wait_time = between(1.0, 3.0)

    token: str = ""

    def on_start(self):
        """Autentica o operador/médico e configura o Bearer token."""
        username = os.environ.get("LOCUST_USER", "admin")
        password = os.environ.get("LOCUST_PASSWORD", "admin123")

        resp = self.client.post(
            "/api/token/",
            data={"username": username, "password": password},
            name="Auth - Login Operador",
        )
        if resp.status_code == 200:
            dados = resp.json()
            self.token = dados.get("access_token", "")
            self.client.headers["Authorization"] = f"Bearer {self.token}"
        else:
            print(f"[Locust] Falha no login: HTTP {resp.status_code} - {resp.text}")

    # ---------- 1. Fila de Espera (Demanda Reprimida) ----------
    @task(6)
    def consultar_fila_aguardando(self):
        self.client.get(
            "/api/tfd/exames?page=1&limit=50&status=aguardando",
            name="Fila - Demanda Reprimida Aguardando",
        )

    @task(4)
    def consultar_fila_por_tipo(self):
        tipo = random.choice(TIPOS_FILA_TESTE)
        self.client.get(
            f"/api/tfd/exames?tipo_fila={tipo}&status=aguardando&limit=50",
            name="Fila - Filtro por Tipo",
        )

    @task(4)
    def consultar_fila_por_especialidade(self):
        esp = random.choice(ESPECIALIDADES_TESTE)
        self.client.get(
            f"/api/tfd/exames?especialidade={esp}&status=aguardando&limit=50",
            name="Fila - Filtro por Especialidade",
        )

    @task(2)
    def consultar_fila_agendados(self):
        self.client.get(
            "/api/tfd/exames?status=agendado&limit=50",
            name="Fila - Agendados",
        )

    # ---------- 2. Viagens e Visão Semanal ----------
    @task(5)
    def visao_semanal_viagens(self):
        segunda = _segunda_feira_atual()
        self.client.get(
            f"/api/tfd/viagens/semana?inicio={segunda}",
            name="TFD - Visão Semanal Viagens",
        )

    @task(3)
    def quadro_diario_viagens(self):
        hoje = date.today().isoformat()
        self.client.get(
            f"/api/tfd/viagens/dia?data={hoje}",
            name="TFD - Quadro Diário",
        )

    @task(2)
    def listar_viagens_mes(self):
        mes = _mes_atual()
        self.client.get(
            f"/api/tfd/viagens?mes={mes}&limit=50",
            name="TFD - Lista Viagens do Mês",
        )

    # ---------- 3. Exames Laboratoriais e Vagas ----------
    @task(4)
    def grade_vagas_laboratorio(self):
        mes = _mes_atual()
        self.client.get(
            f"/api/vagas/grade?month={mes}",
            name="Lab - Grade Mensal de Vagas",
        )

    @task(3)
    def listar_solicitacoes_laboratorio(self):
        self.client.get(
            "/api/exames/solicitacoes?page=1&limit=50",
            name="Lab - Solicitações Mestre",
        )

    @task(3)
    def catalogo_procedimentos_sigtap(self):
        self.client.get(
            "/api/tfd/exames/catalogo?apenas_laboratoriais=true",
            name="Lab - Catálogo SIGTAP Laboratorial",
        )

    # ---------- 4. Autocomplete e Cadastros de Apoio ----------
    @task(3)
    def busca_autocomplete_pacientes(self):
        termo = random.choice(TERMOS_BUSCA)
        self.client.get(
            f"/api/tfd/pacientes?q={termo}&limit=15",
            name="Busca - Autocomplete Pacientes",
        )

    @task(2)
    def carregar_medicos_ativos(self):
        self.client.get(
            "/api/medicos?somente_ativos=true",
            name="Cadastros - Médicos Ativos",
        )

    @task(2)
    def carregar_unidades_saude(self):
        self.client.get(
            "/api/unidades-saude?somente_ativos=true",
            name="Cadastros - Unidades PSF Ativas",
        )

    # ---------- 5. Dashboard, Indicadores e Exportações ----------
    @task(2)
    def indicadores_resumo(self):
        self.client.get(
            "/api/tfd/resumo",
            name="Dashboard - Resumo Geral TFD",
        )

    @task(1)
    def exportar_fila_aguardando(self):
        self.client.get(
            "/api/tfd/exames/exportar?status=aguardando",
            name="Exportação - Fila Demanda Reprimida",
        )


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Exibe sumário consolidado de métricas ao término do teste."""
    print("\n" + "=" * 60)
    print("      RELATÓRIO CONSOLIDADO DO TESTE DE CARGA (LOCUST)     ")
    print("=" * 60)
    stats = environment.runner.stats.total
    if stats.num_requests > 0:
        p95 = stats.get_response_time_percentile(0.95)
        p99 = stats.get_response_time_percentile(0.99)
        avg = stats.avg_response_time
        rps = stats.total_rps
        falhas = stats.num_failures
        perc_falhas = (falhas / stats.num_requests) * 100

        print(f"Total de Requisições:   {stats.num_requests:,}")
        print(f"Total de Falhas:        {falhas} ({perc_falhas:.2f}%)")
        print(f"Throughput Médio:       {rps:.2f} req/s")
        print(f"Tempo Médio de Resposta: {avg:.1f} ms")
        print(f"Percentil 95 (p95):     {p95:.1f} ms")
        print(f"Percentil 99 (p99):     {p99:.1f} ms")
    else:
        print("Nenhuma requisição concluída.")
    print("=" * 60 + "\n")
