"""Configuração de Produção para Gunicorn + Uvicorn Workers.

Dimensionado para suportar alta concorrência (100+ usuários simultâneos)
com reciclagem segura de workers e controle de concorrência.
"""

import multiprocessing
import os

# Número de workers: 2 * CPUs + 1 (mínimo 4)
cpu_count = multiprocessing.cpu_count()
default_workers = max(4, (cpu_count * 2) + 1)
workers = int(os.environ.get("GUNICORN_WORKERS", default_workers))

# Classe do worker ASGI
worker_class = "uvicorn.workers.UvicornWorker"

# Endereço de escuta
bind = os.environ.get("GUNICORN_BIND", "0.0.0.0:8000")

# Conexões simultâneas por worker (Uvicorn gerencia via asyncio)
worker_connections = int(os.environ.get("GUNICORN_WORKER_CONNECTIONS", 1000))

# Prevenção de vazamento de memória: reinicia o worker suavemente após N requisições
max_requests = int(os.environ.get("GUNICORN_MAX_REQUESTS", 1500))
max_requests_jitter = int(os.environ.get("GUNICORN_MAX_REQUESTS_JITTER", 200))

# Timeouts
timeout = int(os.environ.get("GUNICORN_TIMEOUT", 120))
keepalive = int(os.environ.get("GUNICORN_KEEPALIVE", 65))
graceful_timeout = int(os.environ.get("GUNICORN_GRACEFUL_TIMEOUT", 30))

# Logs
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("GUNICORN_LOG_LEVEL", "info")
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(L)ss'

# Headers e segurança de proxy reverso (Nginx)
forwarded_allow_ips = "*"
proxy_allow_ips = "*"
secure_scheme_headers = {
    "X-FORWARDED-PROTOCOL": "ssl",
    "X-FORWARDED-PROTO": "https",
    "X-FORWARDED-SSL": "on",
}
