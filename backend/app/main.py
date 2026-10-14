from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session

from app.api.v1.auth import router as auth_router
from app.api.v1.lab import router as lab_router
from app.api.v1.lab_fase6 import router as lab_fase6_router
from app.api.v1.indicadores import router as indicadores_router
from app.api.v1.pec import router as pec_router
from app.api.v1.settings import router as settings_router
from app.api.v1.tfd import router as tfd_router
from app.api.v1.update import router as update_router
from app.api.v1.users import router as users_router
from app.core.config import settings
from app.db.session import engine, init_db
from app.services.users import ensure_first_superuser


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with Session(engine) as db:
        ensure_first_superuser(
            db, settings.FIRST_SUPERUSER, settings.FIRST_SUPERUSER_PASSWORD
        )
    yield


app = FastAPI(title="Saúde Guapé — API", version="1.0.0", lifespan=lifespan)

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
    resp.headers["Referrer-Policy"] = "same-origin"
    resp.headers["Cache-Control"] = "no-store"
    return resp

app.include_router(auth_router, prefix="/api", tags=["auth"])
app.include_router(users_router, prefix="/api/usuarios", tags=["usuarios"])
app.include_router(tfd_router, prefix="/api/tfd", tags=["tfd"])
app.include_router(lab_router, prefix="/api/lab", tags=["lab"])
app.include_router(lab_fase6_router, prefix="/api", tags=["fase6"])
app.include_router(indicadores_router, prefix="/api", tags=["indicadores"])
app.include_router(pec_router, prefix="/api", tags=["pec"])
app.include_router(settings_router, prefix="/api", tags=["settings"])
app.include_router(update_router, prefix="/api/update", tags=["update"])


@app.get("/health")
def health():
    from app.core.version import APP_VERSION, commit_curto

    return {"status": "ok", "versao": APP_VERSION, "commit": commit_curto()}
