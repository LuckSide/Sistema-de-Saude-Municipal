from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session

from app.api.v1.apac import router as apac_router
from app.api.v1.auth import router as auth_router
from app.api.v1.auditoria import router as auditoria_router
from app.api.v1.backup import router as backup_router
from app.api.v1.cadastros_saude import router as cadastros_saude_router
from app.api.v1.dashboard import router as dashboard_router
from app.api.v1.indicadores import router as indicadores_router
from app.api.v1.integracoes import router as integracoes_router
from app.api.v1.lab import router as lab_router
from app.api.v1.lab_fase6 import router as lab_fase6_router
from app.api.v1.pec import router as pec_router
from app.api.v1.settings import router as settings_router
from app.api.v1.tfd import router as tfd_router
from app.api.v1.update import router as update_router
from app.api.v1.users import router as users_router
from app.core.config import settings
from app.core.audit import AuditMiddleware
from app.db.session import engine, init_db
from app.services.users import ensure_first_superuser
from app.services.pec_worker import iniciar_worker_pec, parar_worker_pec


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with Session(engine) as db:
        ensure_first_superuser(
            db, settings.FIRST_SUPERUSER, settings.FIRST_SUPERUSER_PASSWORD
        )
    iniciar_worker_pec()
    try:
        yield
    finally:
        parar_worker_pec()


app = FastAPI(title="Sistema de Saúde — API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=(), payment=(), usb=()"
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return resp


# Auditoria global de escritas (roda por fora; nunca quebra a requisição).
app.add_middleware(AuditMiddleware)

app.include_router(cadastros_saude_router, prefix="/api", tags=["cadastros_saude"])
app.include_router(auth_router, prefix="/api", tags=["auth"])
app.include_router(auditoria_router, prefix="/api", tags=["auditoria"])
app.include_router(dashboard_router, prefix="/api", tags=["dashboard"])
app.include_router(users_router, prefix="/api/usuarios", tags=["usuarios"])
app.include_router(tfd_router, prefix="/api/tfd", tags=["tfd"])
app.include_router(apac_router, prefix="/api/apac", tags=["apac"])
app.include_router(lab_router, prefix="/api/lab", tags=["lab"])
app.include_router(lab_fase6_router, prefix="/api", tags=["fase6"])
app.include_router(indicadores_router, prefix="/api", tags=["indicadores"])
app.include_router(integracoes_router, prefix="/api", tags=["integracoes"])
app.include_router(pec_router, prefix="/api", tags=["pec"])
app.include_router(settings_router, prefix="/api", tags=["settings"])
app.include_router(update_router, prefix="/api/update", tags=["update"])
app.include_router(backup_router, prefix="/api/backup", tags=["backup"])


# Compatibilidade de rotas legadas/diretas p/ fila de procedimentos e pacientes
@app.get("/api/fila", include_in_schema=False)
@app.get("/api/procedimentos", include_in_schema=False)
@app.get("/api/procedimentos/fila", include_in_schema=False)
def alias_fila(request: Request):
    from starlette.responses import RedirectResponse
    url = f"/api/tfd/exames?{request.query_params}" if request.query_params else "/api/tfd/exames"
    return RedirectResponse(url=url, status_code=307)


@app.get("/api/pacientes", include_in_schema=False)
@app.get("/api/pacientes/buscar", include_in_schema=False)
def alias_pacientes(request: Request):
    from starlette.responses import RedirectResponse
    destino = "/api/tfd/pacientes/buscar" if "buscar" in request.url.path else "/api/tfd/pacientes"
    url = f"{destino}?{request.query_params}" if request.query_params else destino
    return RedirectResponse(url=url, status_code=307)


@app.get("/health")
@app.get("/api/health")
def health():
    from app.core.version import APP_VERSION, commit_curto

    return {"status": "ok", "versao": APP_VERSION, "commit": commit_curto()}
