"""Integrações (admin): e-SUS APS/PEC, RNDS e importação de filas (CSV/XLSX).

Tudo restrito a superuser com senha OK. Segredos nunca retornam em claro.
"""

import os
import re
import time

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.core.deps import get_db
from app.services.permissoes import need_any_perm, need_perm
from app.models.integracoes import IntegrationSettings
from app.models.user import User
from app.services.importacao_filas import MAX_BYTES, MAX_LINHAS, ler_csv, ler_xlsx, processar_linhas

router = APIRouter()

FONTES_PEC = ("auto", "postgres", "files", "mock")
AMBIENTES_RNDS = ("homologacao", "producao")
URL_RE = re.compile(r"^https?://[A-Za-z0-9._:-]{1,200}(/[A-Za-z0-9._~:/?#@!$&'()*+,;=-]{0,200})?$")


def get_conf(db: Session) -> IntegrationSettings:
    obj = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
    if not obj:
        obj = IntegrationSettings(id=1)
        db.add(obj)
        db.commit()
        db.refresh(obj)
    return obj


def mascarar_dsn(dsn: str) -> str:
    """Mostra só esquema + host + banco (sem usuário/senha)."""
    if not dsn:
        return ""
    m = re.match(r"^(\w+://)([^@]*@)?([^/]+)(/.*)?$", dsn.strip())
    if not m:
        return "configurado"
    return f"{m.group(1)}****@{m.group(3)}{m.group(4) or ''}"


def resumo_cert(pem: str) -> str:
    try:
        from cryptography import x509
        from cryptography.hazmat.backends import default_backend

        cert = x509.load_pem_x509_certificate(pem.encode(), default_backend())
        subj = cert.subject.rfc4514_string()
        return subj[:160]
    except Exception:
        return ""


def pec_efetivo(db: Session | None = None) -> tuple[str, str]:
    """(fonte, dsn) — banco prevalece quando preenchido; senão env."""
    fonte = (os.getenv("PEC_FONTE", "auto") or "auto").strip().lower()
    dsn = (os.getenv("PEC_DATABASE_URL", "") or "").strip()
    try:
        if db is None:
            from sqlmodel import Session as S

            from app.db.session import engine

            with S(engine) as s:
                c = s.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
        else:
            c = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
        if c:
            if (c.pec_fonte or "").strip() in FONTES_PEC:
                fonte = c.pec_fonte.strip()
            if (c.pec_database_url or "").strip():
                dsn = c.pec_database_url.strip()
    except Exception:
        pass
    if fonte not in FONTES_PEC:
        fonte = "auto"
    return fonte, dsn


class IntegracoesOut(BaseModel):
    model_config = {"extra": "forbid"}

    pec_fonte: str = "auto"
    pec_servidor_url: str = ""
    pec_usuario: str = ""
    pec_senha_configurada: bool = False
    pec_database_configurada: bool = False
    pec_database_resumo: str = ""
    rnds_ambiente: str = "homologacao"
    rnds_client_id: str = ""
    rnds_secret_configurado: bool = False
    rnds_cert_configurado: bool = False
    rnds_cert_resumo: str = ""
    rnds_key_configurada: bool = False


class PecIn(BaseModel):
    model_config = {"extra": "forbid"}

    pec_fonte: str | None = Field(default=None, pattern="^(auto|postgres|files|mock)$")
    pec_servidor_url: str | None = Field(default=None, max_length=255)
    pec_usuario: str | None = Field(default=None, max_length=120)
    pec_senha: str | None = Field(default=None, max_length=255)
    pec_database_url: str | None = Field(default=None, max_length=500)


class RndsIn(BaseModel):
    model_config = {"extra": "forbid"}

    rnds_ambiente: str | None = Field(default=None, pattern="^(homologacao|producao)$")
    rnds_client_id: str | None = Field(default=None, max_length=120)
    rnds_secret: str | None = Field(default=None, max_length=255)
    rnds_cert_pem: str | None = Field(default=None, max_length=8000)
    rnds_key_pem: str | None = Field(default=None, max_length=8000)


def _out(c: IntegrationSettings) -> IntegracoesOut:
    return IntegracoesOut(
        pec_fonte=c.pec_fonte or "auto",
        pec_servidor_url=c.pec_servidor_url or "",
        pec_usuario=c.pec_usuario or "",
        pec_senha_configurada=bool((c.pec_senha or "").strip()),
        pec_database_configurada=bool((c.pec_database_url or "").strip()),
        pec_database_resumo=mascarar_dsn(c.pec_database_url or ""),
        rnds_ambiente=c.rnds_ambiente or "homologacao",
        rnds_client_id=c.rnds_client_id or "",
        rnds_secret_configurado=bool((c.rnds_secret or "").strip()),
        rnds_cert_configurado=bool((c.rnds_cert_pem or "").strip()),
        rnds_cert_resumo=resumo_cert(c.rnds_cert_pem or "") if (c.rnds_cert_pem or "").strip() else "",
        rnds_key_configurada=bool((c.rnds_key_pem or "").strip()),
    )


@router.get("/integracoes", response_model=IntegracoesOut)
def ler_integracoes(db: Session = Depends(get_db), user: User = Depends(need_any_perm("cfg_filas", "cfg_pec", "cfg_rnds"))):
    _ = user
    return _out(get_conf(db))


@router.put("/integracoes/pec", response_model=IntegracoesOut)
def salvar_pec(data: PecIn, db: Session = Depends(get_db), user: User = Depends(need_perm("cfg_pec", "editar"))):
    _ = user
    c = get_conf(db)
    if data.pec_fonte is not None:
        c.pec_fonte = data.pec_fonte
    if data.pec_servidor_url is not None:
        url = data.pec_servidor_url.strip()
        if url and not URL_RE.match(url):
            raise HTTPException(status_code=400, detail="URL do servidor PEC inválida (use http(s)://...)")
        c.pec_servidor_url = url
    if data.pec_usuario is not None:
        c.pec_usuario = data.pec_usuario.strip()
    if data.pec_senha is not None:
        c.pec_senha = data.pec_senha  # "" limpa; omitido mantém
    if data.pec_database_url is not None:
        c.pec_database_url = data.pec_database_url.strip()
    db.add(c)
    db.commit()
    db.refresh(c)
    return _out(c)


@router.put("/integracoes/rnds", response_model=IntegracoesOut)
def salvar_rnds(data: RndsIn, db: Session = Depends(get_db), user: User = Depends(need_perm("cfg_rnds", "editar"))):
    _ = user
    c = get_conf(db)
    if data.rnds_ambiente is not None:
        c.rnds_ambiente = data.rnds_ambiente
    if data.rnds_client_id is not None:
        c.rnds_client_id = data.rnds_client_id.strip()
    if data.rnds_secret is not None:
        c.rnds_secret = data.rnds_secret
    if data.rnds_cert_pem is not None:
        pem = data.rnds_cert_pem.strip()
        if pem and "BEGIN CERTIFICATE" not in pem:
            raise HTTPException(status_code=400, detail="Certificado inválido (esperado PEM com BEGIN CERTIFICATE)")
        c.rnds_cert_pem = pem
    if data.rnds_key_pem is not None:
        key = data.rnds_key_pem.strip()
        if key and "PRIVATE KEY" not in key:
            raise HTTPException(status_code=400, detail="Chave privada inválida (esperado PEM com PRIVATE KEY)")
        c.rnds_key_pem = key
    db.add(c)
    db.commit()
    db.refresh(c)
    return _out(c)


@router.post("/integracoes/pec/testar")
def testar_pec(db: Session = Depends(get_db), user: User = Depends(need_perm("cfg_pec"))):
    """Testa conexão PEC efetiva (banco > env). Nunca expõe DSN."""
    _ = user
    from app.services import pec as svc

    fonte, dsn = pec_efetivo(db)
    if fonte == "mock":
        return {"ok": True, "fonte_efetiva": "mock", "detalhe": "Mock ativo (sem banco PEC)"}
    if fonte == "files":
        base_ok = (svc.DATA_DIR / "painel.json").exists() or (svc.DATA_DIR / "painel.csv").exists()
        return {
            "ok": base_ok,
            "fonte_efetiva": "files",
            "detalhe": "Arquivos locais encontrados" if base_ok else "Nenhum painel.json/csv em app/data/pec",
        }
    if not dsn:
        # auto sem DSN: resolve p/ files ou mock
        if (svc.DATA_DIR / "painel.json").exists() or (svc.DATA_DIR / "painel.csv").exists():
            return {"ok": True, "fonte_efetiva": "files", "detalhe": "Auto: sem banco, usando arquivos locais"}
        return {"ok": True, "fonte_efetiva": "mock", "detalhe": "Auto: sem banco nem arquivos, usando mock"}
    t0 = time.monotonic()
    try:
        from sqlalchemy import create_engine, text

        eng = create_engine(dsn, pool_pre_ping=True, connect_args={"connect_timeout": 5})
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        ms = int((time.monotonic() - t0) * 1000)
        return {"ok": True, "fonte_efetiva": "postgres", "latencia_ms": ms, "detalhe": f"SELECT 1 OK em {ms}ms"}
    except Exception as e:
        msg = str(e).split("\n")[0][:200]
        return {"ok": False, "fonte_efetiva": "postgres", "detalhe": f"Falha de conexão: {msg}"}


@router.post("/integracoes/rnds/validar")
def validar_rnds(db: Session = Depends(get_db), user: User = Depends(need_perm("cfg_rnds"))):
    """Valida configuração RNDS (campos + certificado). Sem chamada externa."""
    _ = user
    c = get_conf(db)
    pendencias: list[str] = []
    if not (c.rnds_client_id or "").strip():
        pendencias.append("Client ID não configurado")
    if not (c.rnds_secret or "").strip():
        pendencias.append("Secret não configurado")
    cert_info: dict = {"configurado": False}
    pem = (c.rnds_cert_pem or "").strip()
    if not pem:
        pendencias.append("Certificado X.509 não enviado")
    else:
        try:
            from cryptography import x509
            from cryptography.hazmat.backends import default_backend

            cert = x509.load_pem_x509_certificate(pem.encode(), default_backend())
            from datetime import datetime, timezone

            agora = datetime.now(timezone.utc)
            # cryptography retorna naive UTC; normaliza
            ini = cert.not_valid_before_utc if hasattr(cert, "not_valid_before_utc") else cert.not_valid_before.replace(tzinfo=timezone.utc)
            fim = cert.not_valid_after_utc if hasattr(cert, "not_valid_after_utc") else cert.not_valid_after.replace(tzinfo=timezone.utc)
            dias = (fim - agora).days
            cert_info = {
                "configurado": True,
                "subject": cert.subject.rfc4514_string()[:160],
                "issuer": cert.issuer.rfc4514_string()[:160],
                "valido_de": ini.date().isoformat(),
                "valido_ate": fim.date().isoformat(),
                "dias_restantes": dias,
                "expirado": dias < 0,
            }
            if dias < 0:
                pendencias.append("Certificado expirado")
            elif dias < 30:
                pendencias.append(f"Certificado expira em {dias} dias — renovar")
        except Exception:
            pendencias.append("Certificado ilegível (PEM inválido)")
    if (c.rnds_key_pem or "").strip():
        try:
            from cryptography.hazmat.backends import default_backend
            from cryptography.hazmat.primitives import serialization

            serialization.load_pem_private_key(
                c.rnds_key_pem.strip().encode(), password=None, backend=default_backend()
            )
            chave_ok = True
        except Exception:
            chave_ok = False
            pendencias.append("Chave privada ilegível (ou protegida por senha — envie sem senha)")
    else:
        chave_ok = False
    return {
        "ok": not pendencias,
        "ambiente": c.rnds_ambiente or "homologacao",
        "link": "configurado" if not pendencias else "pendente",
        "certificado": cert_info,
        "chave_configurada": chave_ok,
        "pendencias": pendencias,
    }


@router.post("/integracoes/filas/importar")
def importar_filas(
    file: UploadFile = File(...),
    simular: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("cfg_filas", "criar")),
):
    """Carga massiva de fila de espera (CSV/XLSX). `simular=true` não grava."""
    _ = user
    nome = (file.filename or "").strip()
    ext = nome.rsplit(".", 1)[-1].lower() if "." in nome else ""
    if ext not in ("csv", "xlsx", "xlsm"):
        raise HTTPException(status_code=400, detail="Envie .csv ou .xlsx")
    conteudo = file.file.read(MAX_BYTES + 1)
    if not conteudo:
        raise HTTPException(status_code=400, detail="Arquivo vazio")
    if len(conteudo) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="Arquivo acima de 10MB")
    try:
        linhas = ler_csv(conteudo) if ext == "csv" else ler_xlsx(conteudo)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not linhas:
        raise HTTPException(status_code=400, detail="Nenhuma linha de dados")
    if len(linhas) > MAX_LINHAS:
        raise HTTPException(status_code=400, detail=f"Acima de {MAX_LINHAS} linhas — divida o arquivo")
    try:
        resumo = processar_linhas(linhas, db)
        if simular:
            db.rollback()
        else:
            db.commit()
    except HTTPException:
        raise
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Falha ao importar")
    return {"simulacao": simular, "arquivo": nome[:120], **resumo}
