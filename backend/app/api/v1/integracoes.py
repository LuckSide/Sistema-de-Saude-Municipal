"""Integrações (admin): e-SUS APS/PEC, RNDS e importação de filas (CSV/XLSX).

Tudo restrito a superuser com senha OK. Segredos nunca retornam em claro.
"""

import os
import re
import time
from datetime import datetime

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
            # Se SSH estiver habilitado e host configurado, garante o túnel e aponta p/ a porta local
            if c.pec_ssh_habilitado and (c.pec_ssh_host or "").strip():
                from app.services.pec_tunnel import garantir_tunel_db

                ativo, dsn_tunel = garantir_tunel_db(c)
                if ativo and dsn_tunel:
                    dsn = dsn_tunel
            elif (c.pec_database_url or "").strip():
                dsn = c.pec_database_url.strip()
            elif (c.pec_usuario or "").strip() and (c.pec_senha or "").strip() and (c.pec_servidor_url or "").strip():
                host = c.pec_servidor_url.replace("http://", "").replace("https://", "").split(":")[0]
                banco = c.pec_banco_nome or "esus"
                dsn = f"postgresql://{c.pec_usuario}:{c.pec_senha}@{host}:5432/{banco}"
    except Exception:
        pass
    if fonte not in FONTES_PEC:
        fonte = "auto"
    return fonte, dsn


class IntegracoesOut(BaseModel):
    model_config = {"extra": "forbid"}

    pec_fonte: str = "auto"
    pec_servidor_url: str = ""
    pec_banco_nome: str = "esus"
    pec_usuario: str = ""
    pec_senha_configurada: bool = False
    pec_database_configurada: bool = False
    pec_database_resumo: str = ""
    # SSH Tunnel
    pec_ssh_habilitado: bool = False
    pec_ssh_host: str = ""
    pec_ssh_porta: int = 22
    pec_ssh_usuario: str = ""
    pec_ssh_senha_configurada: bool = False
    pec_ssh_chave_configurada: bool = False
    pec_porta_local: int = 5433
    pec_ssh_tunel_ativo: bool = False

    # Sincronização Periódica de Pacientes
    pec_sync_automatica: bool = True
    pec_sync_intervalo_horas: int = 6
    pec_sync_ultima_execucao: datetime | None = None
    pec_sync_ultimo_status: str = ""
    pec_sync_total_pacientes: int = 0
    pec_sync_em_execucao: bool = False

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
    pec_banco_nome: str | None = Field(default=None, max_length=80)
    pec_usuario: str | None = Field(default=None, max_length=120)
    pec_senha: str | None = Field(default=None, max_length=255)
    pec_database_url: str | None = Field(default=None, max_length=500)
    # SSH Tunnel
    pec_ssh_habilitado: bool | None = Field(default=None)
    pec_ssh_host: str | None = Field(default=None, max_length=150)
    pec_ssh_porta: int | None = Field(default=None)
    pec_ssh_usuario: str | None = Field(default=None, max_length=120)
    pec_ssh_senha: str | None = Field(default=None, max_length=255)
    pec_ssh_chave_privada: str | None = Field(default=None, max_length=8000)
    pec_porta_local: int | None = Field(default=None)


class PecSyncConfigIn(BaseModel):
    model_config = {"extra": "forbid"}

    pec_sync_automatica: bool | None = None
    pec_sync_intervalo_horas: int | None = Field(default=None, ge=1, le=168)


class RndsIn(BaseModel):
    model_config = {"extra": "forbid"}

    rnds_ambiente: str | None = Field(default=None, pattern="^(homologacao|producao)$")
    rnds_client_id: str | None = Field(default=None, max_length=120)
    rnds_secret: str | None = Field(default=None, max_length=255)
    rnds_cert_pem: str | None = Field(default=None, max_length=8000)
    rnds_key_pem: str | None = Field(default=None, max_length=8000)


def _out(c: IntegrationSettings) -> IntegracoesOut:
    from app.services.pec_tunnel import status_tunel
    from app.services.pec_sync import is_sync_running

    tunel_st = status_tunel(c.pec_porta_local or 5433)
    banco_configurado = bool((c.pec_database_url or "").strip()) or bool(
        c.pec_ssh_habilitado and (c.pec_ssh_host or "").strip() and (c.pec_usuario or "").strip()
    ) or bool(
        (c.pec_servidor_url or "").strip() and (c.pec_usuario or "").strip() and (c.pec_senha or "").strip()
    )
    resumo_banco = mascarar_dsn(c.pec_database_url or "")
    if not resumo_banco and c.pec_ssh_habilitado and (c.pec_ssh_host or "").strip():
        resumo_banco = f"Túnel SSH ({c.pec_ssh_usuario or 'master'}@{c.pec_ssh_host} -> 127.0.0.1:{c.pec_porta_local or 5433}/{c.pec_banco_nome or 'esus'})"
    elif not resumo_banco and c.pec_servidor_url:
        resumo_banco = f"{c.pec_servidor_url} ({c.pec_banco_nome or 'esus'})"

    return IntegracoesOut(
        pec_fonte=c.pec_fonte or "auto",
        pec_servidor_url=c.pec_servidor_url or "",
        pec_banco_nome=c.pec_banco_nome or "esus",
        pec_usuario=c.pec_usuario or "",
        pec_senha_configurada=bool((c.pec_senha or "").strip()),
        pec_database_configurada=banco_configurado,
        pec_database_resumo=resumo_banco,
        pec_ssh_habilitado=bool(c.pec_ssh_habilitado),
        pec_ssh_host=c.pec_ssh_host or "",
        pec_ssh_porta=c.pec_ssh_porta or 22,
        pec_ssh_usuario=c.pec_ssh_usuario or "",
        pec_ssh_senha_configurada=bool((c.pec_ssh_senha or "").strip()),
        pec_ssh_chave_configurada=bool((c.pec_ssh_chave_privada or "").strip()),
        pec_porta_local=c.pec_porta_local or 5433,
        pec_ssh_tunel_ativo=tunel_st.get("ativo", False),
        pec_sync_automatica=bool(c.pec_sync_automatica),
        pec_sync_intervalo_horas=c.pec_sync_intervalo_horas or 6,
        pec_sync_ultima_execucao=c.pec_sync_ultima_execucao,
        pec_sync_ultimo_status=c.pec_sync_ultimo_status or "",
        pec_sync_total_pacientes=c.pec_sync_total_pacientes or 0,
        pec_sync_em_execucao=is_sync_running(),
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
    if data.pec_banco_nome is not None:
        c.pec_banco_nome = data.pec_banco_nome.strip()
    if data.pec_usuario is not None:
        c.pec_usuario = data.pec_usuario.strip()
    if data.pec_senha is not None:
        c.pec_senha = data.pec_senha  # "" limpa; omitido mantém
    if data.pec_database_url is not None:
        c.pec_database_url = data.pec_database_url.strip()
    # SSH Tunnel
    if data.pec_ssh_habilitado is not None:
        c.pec_ssh_habilitado = data.pec_ssh_habilitado
    if data.pec_ssh_host is not None:
        c.pec_ssh_host = data.pec_ssh_host.strip()
    if data.pec_ssh_porta is not None:
        c.pec_ssh_porta = data.pec_ssh_porta
    if data.pec_ssh_usuario is not None:
        c.pec_ssh_usuario = data.pec_ssh_usuario.strip()
    if data.pec_ssh_senha is not None:
        c.pec_ssh_senha = data.pec_ssh_senha
    if data.pec_ssh_chave_privada is not None:
        c.pec_ssh_chave_privada = data.pec_ssh_chave_privada.strip()
    if data.pec_porta_local is not None:
        c.pec_porta_local = data.pec_porta_local

    db.add(c)
    db.commit()
    db.refresh(c)
    try:
        from app.services import pec as svc
        svc.limpar_cache()
    except Exception:
        pass
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
    try:
        from app.services import pec as svc
        svc.limpar_cache()
    except Exception:
        pass
    return _out(c)


@router.post("/integracoes/pec/testar")
def testar_pec(db: Session = Depends(get_db), user: User = Depends(need_perm("cfg_pec"))):
    """Testa conexão PEC efetiva (banco > env). Suporta Túnel SSH e Conexão Direta."""
    _ = user
    from app.services import pec as svc

    c = get_conf(db)
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
        if (svc.DATA_DIR / "painel.json").exists() or (svc.DATA_DIR / "painel.csv").exists():
            return {"ok": True, "fonte_efetiva": "files", "detalhe": "Auto: sem banco configurado, usando arquivos locais"}
        return {"ok": True, "fonte_efetiva": "mock", "detalhe": "Auto: sem banco nem arquivos, usando mock"}
    t0 = time.monotonic()
    try:
        from sqlalchemy import create_engine, text

        eng = create_engine(dsn, pool_pre_ping=True, connect_args={"connect_timeout": 6})
        with eng.connect() as conn:
            row_db = conn.execute(text("SELECT current_database(), current_user, version()")).first()
            total_cid = 0
            try:
                row_cid = conn.execute(text("SELECT count(*) FROM tb_cidadao")).scalar()
                total_cid = int(row_cid or 0)
            except Exception:
                pass
        ms = int((time.monotonic() - t0) * 1000)
        db_nome = row_db[0] if row_db else (c.pec_banco_nome or "esus")
        user_nome = row_db[1] if row_db else (c.pec_usuario or "painel_readonly")
        tunel_info = "via Túnel SSH Seguro" if c.pec_ssh_habilitado else "Conexão Direta"
        msg = f"Conexão com e-SUS PEC realizada com sucesso ({tunel_info})! Banco '{db_nome}', usuário '{user_nome}', {total_cid:,} cidadãos cadastrados ({ms}ms)."
        return {
            "ok": True,
            "fonte_efetiva": "postgres",
            "latencia_ms": ms,
            "banco": db_nome,
            "usuario": user_nome,
            "total_cidadaos": total_cid,
            "tunel_ssh": c.pec_ssh_habilitado,
            "detalhe": msg,
        }
    except Exception as e:
        msg = str(e).split("\n")[0][:250]
        return {"ok": False, "fonte_efetiva": "postgres", "detalhe": f"Falha de conexão com e-SUS PEC: {msg}"}


@router.post("/integracoes/pec/sincronizar")
def sincronizar_pec(
    background: bool = Query(default=True),
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("cfg_pec", "editar")),
):
    """Dispara a sincronização e consolidação de pacientes e prontuários do e-SUS PEC."""
    _ = user
    from app.services.pec_sync import is_sync_running, sincronizar_pacientes_pec
    from app.services.pec_worker import sincronizar_em_segundo_plano

    if is_sync_running():
        return {
            "ok": True,
            "status": "EM_EXECUCAO",
            "mensagem": "A sincronização de pacientes já está em andamento em segundo plano.",
        }

    if background:
        sincronizar_em_segundo_plano(origem="manual")
        return {
            "ok": True,
            "status": "EM_EXECUCAO",
            "mensagem": "Sincronização iniciada com sucesso em segundo plano.",
        }
    else:
        log = sincronizar_pacientes_pec(db, origem="manual")
        return {
            "ok": log.status == "SUCESSO",
            "status": log.status,
            "mensagem": log.mensagem,
            "total_lidos": log.total_lidos,
            "total_inseridos": log.total_inseridos,
            "total_atualizados": log.total_atualizados,
            "total_duplicados_mesclados": log.total_duplicados_mesclados,
            "duracao_segundos": log.duracao_segundos,
        }


@router.post("/integracoes/pec/sincronizar-enderecos")
def sincronizar_enderecos_pec(
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("cfg_pec", "editar")),
):
    """Atualiza os endereços dos pacientes locais a partir dos domicílios e cadastros territoriais do e-SUS PEC."""
    _ = user
    from app.services.pec_sync import atualizar_enderecos_pacientes_pec
    return atualizar_enderecos_pacientes_pec(db)


@router.get("/integracoes/pec/sync/status")
def status_sync_pec(db: Session = Depends(get_db), user: User = Depends(need_perm("cfg_pec"))):
    """Consulta o status atual do job de sincronização e o resumo da última execução."""
    _ = user
    from app.models.integracoes import PecSyncLog
    from app.services.pec_sync import is_sync_running

    c = get_conf(db)
    ultimo_log = db.exec(select(PecSyncLog).order_by(PecSyncLog.iniciado_em.desc())).first()

    return {
        "em_execucao": is_sync_running(),
        "automatica": bool(c.pec_sync_automatica),
        "intervalo_horas": c.pec_sync_intervalo_horas or 6,
        "ultima_execucao": c.pec_sync_ultima_execucao,
        "ultimo_status": c.pec_sync_ultimo_status or "",
        "total_pacientes": c.pec_sync_total_pacientes or 0,
        "ultimo_log": {
            "id": ultimo_log.id,
            "iniciado_em": ultimo_log.iniciado_em,
            "finalizado_em": ultimo_log.finalizado_em,
            "status": ultimo_log.status,
            "total_lidos": ultimo_log.total_lidos,
            "total_inseridos": ultimo_log.total_inseridos,
            "total_atualizados": ultimo_log.total_atualizados,
            "total_duplicados_mesclados": ultimo_log.total_duplicados_mesclados,
            "duracao_segundos": ultimo_log.duracao_segundos,
            "mensagem": ultimo_log.mensagem,
            "origem": ultimo_log.origem,
        } if ultimo_log else None,
    }


@router.get("/integracoes/pec/sync/logs")
def listar_logs_sync_pec(
    limite: int = Query(default=15, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("cfg_pec")),
):
    """Retorna os logs recentes de auditoria das sincronizações com o e-SUS PEC."""
    _ = user
    from app.models.integracoes import PecSyncLog

    logs = db.exec(select(PecSyncLog).order_by(PecSyncLog.iniciado_em.desc()).limit(limite)).all()
    return logs


@router.put("/integracoes/pec/sync/config")
def atualizar_config_sync_pec(
    data: PecSyncConfigIn,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("cfg_pec", "editar")),
):
    """Atualiza as configurações do agendamento periódico da sincronização PEC."""
    _ = user
    c = get_conf(db)
    if data.pec_sync_automatica is not None:
        c.pec_sync_automatica = data.pec_sync_automatica
    if data.pec_sync_intervalo_horas is not None:
        c.pec_sync_intervalo_horas = data.pec_sync_intervalo_horas
    db.add(c)
    db.commit()
    db.refresh(c)
    return {
        "ok": True,
        "pec_sync_automatica": c.pec_sync_automatica,
        "pec_sync_intervalo_horas": c.pec_sync_intervalo_horas,
    }


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
