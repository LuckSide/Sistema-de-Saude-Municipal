"""Middleware global de auditoria: registra escritas (POST/PUT/PATCH/DELETE em /api/*).

- Não quebra a requisição nunca (tudo em try/except).
- Pula login (/api/token/ tem senha), leituras e health/docs.
- Redige segredos; PII mínima p/ Patient (só id); multipart vira resumo.
- Actor via JWT (best-effort) + nome resolvido no banco.
"""

import json
import re
from datetime import datetime, timezone

MAX_REQ_BODY = 64 * 1024 * 1024
MAX_RESP_BODY = 64 * 1024
MAX_DETAILS = 20000
MAX_VALOR = 5000

SEGREDOS = {
    "password", "senha", "senha_atual", "nova_senha", "confirmar_senha",
    "secret", "client_secret", "token", "access_token", "refresh_token",
    "pec_senha", "pec_database_url", "pec_ssh_senha", "pec_ssh_chave_privada",
    "rnds_secret", "rnds_key_pem", "rnds_cert_pem", "database_url", "dsn",
    "authorization", "chave_privada", "private_key", "ssh_key", "api_key",
}

VERBOS = {"POST": "CREATE", "PUT": "UPDATE", "PATCH": "UPDATE", "DELETE": "DELETE"}

# segmento do path -> entidade (verbos especiais por entidade)
ENTIDADES = {
    "pacientes": "PATIENT",
    "viagens": "TRIP",
    "passageiros": "PASSENGER",
    "destinos": "DESTINATION",
    "veiculos": "VEHICLE",
    "exames": "EXAM",
    "tipos": "CATALOG",
    "procedimentos": "CATALOG",
    "especialidades": "CATALOG",
    "catalogo": "CATALOG",
    "faturamento": "BILLING",
    "solicitacoes": "REQUEST",
    "fila-psf": "QUEUE",
    "vagas": "SLOT",
    "auditoria": "AUDIT",
    "laboratorios": "LAB",
    "sigtap": "SIGTAP",
    "usuarios": "USER",
    "medicos": "DOCTOR",
    "unidades-saude": "UNIT",
    "viagens-fila": "TRIPQUEUE",
    "settings": "SETTINGS",
    "integracoes": "INTEGRATION",
    "update": "SYSTEM",
    "dashboard": "DASHBOARD",
    "painel": "REPORT",
    "resumo": "REPORT",
    "filtros-opcoes": "REPORT",
    "grade": "REPORT",
}

VERBOS_ENTIDADE = {
    "QUEUE": {"POST": "ADD", "DELETE": "REMOVE"},
}


def mascarar_cpf(valor: str) -> str:
    """Mascara CPF preservando os 3 dígitos iniciais e 2 finais para auditoria (LGPD)."""
    if not isinstance(valor, str):
        return valor
    v_clean = valor.strip()
    if re.match(r"^\d{3}\.\d{3}\.\d{3}-\d{2}$", v_clean):
        return f"{v_clean[:3]}.***.***-{v_clean[-2:]}"
    digitos = re.sub(r"\D", "", v_clean)
    if len(digitos) == 11:
        return f"{digitos[:3]}******{digitos[-2:]}"
    return valor


def redigir(obj):
    if isinstance(obj, dict):
        res = {}
        for k, v in obj.items():
            k_lower = str(k).lower()
            if k_lower in SEGREDOS or any(s in k_lower for s in ("senha", "secret", "password", "token", "chave_privada", "ssh_key")):
                res[k] = "***"
            elif ("cpf" in k_lower or "cns" in k_lower) and isinstance(v, str):
                res[k] = mascarar_cpf(v)
            else:
                res[k] = redigir(v)
        return res
    if isinstance(obj, list):
        return [redigir(v) for v in obj[:50]]
    if isinstance(obj, str):
        s_clean = obj.strip()
        if re.match(r"^\d{3}\.\d{3}\.\d{3}-\d{2}$", s_clean) or (len(re.sub(r"\D", "", s_clean)) == 11 and s_clean.isdigit()):
            return mascarar_cpf(s_clean)
        if len(obj) > MAX_VALOR:
            return obj[:MAX_VALOR] + "…"
    return obj


# entidade -> (model, campos ignorados no diff)
_DIFF_IGNORE = {
    "EXAM": (("app.models.tfd", "ExameFila"), {"public_token"}),
    "PATIENT": (("app.models.tfd", "Paciente"), set()),
    "TRIP": (("app.models.tfd", "Viagem"), set()),
    "PASSENGER": (("app.models.tfd", "ViagemPaciente"), set()),
    "DESTINATION": (("app.models.tfd", "Destino"), set()),
    "VEHICLE": (("app.models.tfd", "Veiculo"), set()),
    "USER": (("app.models.user", "User"), {"password_hash"}),
    "DOCTOR": (("app.models.cadastros_saude", "Medico"), set()),
    "UNIT": (("app.models.cadastros_saude", "UnidadeSaude"), set()),
}


def _serializar(v):
    from datetime import date, datetime

    if v is None:
        return ""
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, (bool, int, float, str)):
        return v
    return str(v)


def _snapshot(entidade: str, entity_id: int | None):
    """Estado anterior do registro p/ diff (antes da escrita)."""
    if not entity_id or entidade not in _DIFF_IGNORE:
        return None
    try:
        from sqlmodel import Session

        from app.db.session import engine

        (modulo, modelo), ignorar = _DIFF_IGNORE[entidade]
        import importlib

        Modelo = getattr(importlib.import_module(modulo), modelo)
        with Session(engine) as db:
            obj = db.get(Modelo, entity_id)
            if not obj:
                return None
            return {
                c: _serializar(getattr(obj, c, ""))
                for c in list(Modelo.model_fields)
                if c not in ignorar
            }
    except Exception:
        return None


def _diff(antes: dict | None, depois: dict | None) -> list[dict]:
    """Só campos efetivamente alterados: [{campo, de, para}] com mascaramento de segredos e PII."""
    if not antes or not isinstance(depois, dict):
        return []
    mudancas = []
    for k, v_novo in depois.items():
        if k.startswith("_"):
            continue
        v_antes = antes.get(k, "")
        if str(v_antes) != str(v_novo if v_novo is not None else ""):
            mudancas.append({
                "campo": k,
                "de": redigir({k: v_antes}).get(k, v_antes),
                "para": redigir({k: v_novo}).get(k, v_novo if v_novo is not None else ""),
            })
        if len(mudancas) >= 60:
            break
    return mudancas


def parse_device_from_ua(ua: str) -> str:
    """Extrai uma identificação concisa e amigável do dispositivo/navegador a partir do User-Agent."""
    if not ua or not ua.strip():
        return "Desconhecido"

    ua_lower = ua.lower()

    # 1. Sistema Operacional / Plataforma
    os_name = "Desconhecido"
    if "windows" in ua_lower:
        os_name = "Windows"
    elif "android" in ua_lower:
        os_name = "Android"
    elif "iphone" in ua_lower:
        os_name = "iPhone"
    elif "ipad" in ua_lower:
        os_name = "iPad"
    elif "macintosh" in ua_lower or "mac os x" in ua_lower:
        os_name = "macOS"
    elif "linux" in ua_lower:
        os_name = "Linux"

    # 2. Navegador
    browser = "Navegador"
    if "edg/" in ua_lower or "edge/" in ua_lower:
        browser = "Edge"
    elif "opr/" in ua_lower or "opera" in ua_lower:
        browser = "Opera"
    elif "chrome" in ua_lower and "chromium" not in ua_lower and "edg" not in ua_lower:
        browser = "Chrome"
    elif "firefox" in ua_lower:
        browser = "Firefox"
    elif "safari" in ua_lower and "chrome" not in ua_lower:
        browser = "Safari"

    # 3. Form factor (Tablet verificado antes de Mobile)
    form = "Desktop"
    if "ipad" in ua_lower or "tablet" in ua_lower:
        form = "Tablet"
    elif any(m in ua_lower for m in ("mobi", "iphone", "android", "ipod")):
        form = "Mobile"

    if os_name in ("iPhone", "iPad"):
        return f"{browser} no {os_name} ({form})"
    if os_name != "Desconhecido":
        return f"{browser} no {os_name} ({form})"
    return f"{browser} ({form})"


def registrar_log_pesquisa(
    modulo: str,
    termo: str,
    usuario_id: int | None = None,
    usuario_nome: str = "",
    user_agent: str = "",
    total_encontrados: int = 0,
) -> None:
    """Registra consultas e pesquisas textuais realizadas por usuários para análise de padrões."""
    if not termo or not termo.strip():
        return
    try:
        from sqlmodel import Session
        from app.db.session import engine
        from app.models.audit import AuditLog

        termo_limpo = termo.strip()
        # Mascaramento de CPF em logs de busca (LGPD)
        if re.match(r"^\d{3}\.\d{3}\.\d{3}-\d{2}$", termo_limpo) or (len(re.sub(r"\D", "", termo_limpo)) == 11 and termo_limpo.isdigit()):
            termo_limpo = mascarar_cpf(termo_limpo)
        device = parse_device_from_ua(user_agent)
        detalhes = {
            "modulo": modulo,
            "termo": termo_limpo[:120],
            "total_resultados": total_encontrados,
            "device": device,
        }
        with Session(engine) as db:
            db.add(AuditLog(
                user_id=usuario_id,
                user_name=(usuario_nome or "Usuário")[:120],
                action="SEARCH",
                entity=modulo.upper()[:40],
                entity_id=None,
                device=device[:150],
                details=json.dumps(detalhes, ensure_ascii=False)[:MAX_DETAILS],
                timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            ))
            db.commit()
    except Exception:
        pass


def registrar_log_exportacao(
    modulo: str,
    titulo: str,
    usuario_id: int | None = None,
    usuario_nome: str = "",
    total_linhas: int = 0,
    filtros: dict | None = None,
    user_agent: str = "",
) -> None:
    """Registra exportações de relatórios em Excel para auditoria estrita."""
    try:
        from sqlmodel import Session
        from app.db.session import engine
        from app.models.audit import AuditLog

        device = parse_device_from_ua(user_agent)
        detalhes = {
            "modulo": modulo,
            "titulo": titulo,
            "total_registros": total_linhas,
            "filtros": filtros or {},
            "device": device,
        }
        with Session(engine) as db:
            db.add(AuditLog(
                user_id=usuario_id,
                user_name=(usuario_nome or "Usuário")[:120],
                action="EXPORT_EXCEL",
                entity=modulo.upper()[:40],
                entity_id=None,
                device=device[:150],
                details=json.dumps(detalhes, ensure_ascii=False)[:MAX_DETAILS],
                timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            ))
            db.commit()
    except Exception:
        pass


def entidade_acao(path: str, metodo: str) -> tuple[str, str] | tuple[None, None]:
    segs = [s for s in path.split("/") if s and s != "api"]
    if not segs:
        return None, None
    if segs[0] in ("token", "docs", "openapi.json"):
        return None, None
    if "public" in segs:
        return None, None
    # REMOÇÃO DE LOGS DE LOGIN/AUTENTICAÇÃO:
    # Ignora criação de tokens e sessões puramente informativas para evitar ruído
    if segs[0] == "auth" or "token" in segs or "login" in segs:
        return None, None
    entidade = None
    for s in segs:
        if s in ENTIDADES:
            entidade = ENTIDADES[s]
            break
    if entidade is None:
        entidade = re.sub(r"[^A-Z0-9_]", "", segs[0].upper().replace("-", "_"))[:40] or "CUSTOM"
    if "regenerar-token" in segs:
        return "EXAM", "TOKEN"
    if "reset-senha" in segs or "primeira-troca" in segs or segs[-1] == "senha":
        return "USER", "PASSWORD"
    if "importar" in segs:
        return "INTEGRATION", "IMPORT"
    if "executar" in segs:
        return "SYSTEM", "UPDATE"
    verbo = VERBOS.get(metodo, metodo)
    override = VERBOS_ENTIDADE.get(entidade, {})
    return entidade, override.get(metodo, verbo)


def extrair_id(path: str, resp_body: bytes) -> int | None:
    for seg in reversed([s for s in path.split("/") if s]):
        if seg.isdigit():
            return int(seg)
    try:
        data = json.loads(resp_body.decode("utf-8", "ignore") or "null")
        if isinstance(data, dict) and isinstance(data.get("id"), int):
            return data["id"]
    except Exception:
        pass
    return None


class AuditMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        metodo = scope.get("method", "")
        path = scope.get("path", "")
        if metodo in ("GET", "HEAD", "OPTIONS") or not path.startswith("/api"):
            await self.app(scope, receive, send)
            return
        entidade, acao = entidade_acao(path, metodo)
        if entidade is None:
            await self.app(scope, receive, send)
            return

        # Estado anterior p/ diff amigável (PUT/PATCH/DELETE em registros;
        # PATIENT fica de fora por PII mínima — só o id).
        antes = None
        if metodo in ("PUT", "PATCH", "DELETE") and entidade != "PATIENT":
            try:
                antes = _snapshot(entidade, extrair_id(path, b""))
            except Exception:
                antes = None

        # Lê corpo p/ log e reencaminha (replay) ao downstream.
        corpo = b""
        while True:
            try:
                msg = await receive()
            except Exception:
                break
            if msg.get("type") != "http.request":
                break
            corpo += msg.get("body", b"")
            if not msg.get("more_body", False) or len(corpo) > MAX_REQ_BODY:
                break

        async def replay():
            return {"type": "http.request", "body": corpo, "more_body": False}

        status = 500
        resp_partes: list[bytes] = []
        resp_cortada = False

        async def send_wrap(message):
            nonlocal status, resp_cortada
            if message.get("type") == "http.response.start":
                status = message.get("status", 500)
            elif message.get("type") == "http.response.body":
                chunk = message.get("body", b"")
                if sum(map(len, resp_partes)) + len(chunk) <= MAX_RESP_BODY:
                    resp_partes.append(chunk)
                else:
                    resp_cortada = True
            await send(message)

        try:
            await self.app(scope, replay, send_wrap)
        finally:
            try:
                headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
                self._gravar(scope, headers, corpo, entidade, acao, status, b"".join(resp_partes), resp_cortada, antes)
            except Exception:
                pass

    def _gravar(self, scope, headers, corpo, entidade, acao, status, resp_body, resp_cortada, antes=None):
        from sqlmodel import Session

        from app.core.security import decode_token
        from app.db.session import engine
        from app.models.audit import AuditLog
        from app.services.users import get_by_username

        action = f"{entidade}_{acao}"
        entity_id = extrair_id(scope.get("path", ""), resp_body)
        device = parse_device_from_ua(headers.get("user-agent", ""))
        details: dict = {"status": status, "device": device}
        ctype = headers.get("content-type", "")
        corpo_json = None
        if "multipart" in ctype:
            details["upload"] = True
            details["bytes"] = len(corpo)
        elif entidade == "PATIENT":
            details["id"] = entity_id  # PII mínima (LGPD)
        elif corpo and len(corpo) <= MAX_REQ_BODY:
            try:
                corpo_json = redigir(json.loads(corpo.decode("utf-8")))
                details["body"] = corpo_json
            except Exception:
                txt = corpo.decode("utf-8", "ignore").strip()
                if txt:
                    details["body"] = redigir(txt[:MAX_VALOR])
        if metodo := scope.get("method", ""):
            if metodo in ("PUT", "PATCH") and isinstance(corpo_json, dict):
                details["mudancas"] = _diff(antes, corpo_json)
            elif metodo == "DELETE" and antes:
                details["removido"] = True
                details["antes"] = antes
        if resp_cortada:
            details["resposta_truncada"] = True

        user_id = None
        user_name = ""
        try:
            auth = headers.get("authorization", "")
            if auth.lower().startswith("bearer "):
                username = decode_token(auth[7:].strip()) or ""
                if username:
                    with Session(engine) as db:
                        u = get_by_username(db, username)
                        if u is not None:
                            user_id = u.id
                            user_name = (u.nome or u.username or "")[:120]
                        else:
                            user_name = username[:120]
        except Exception:
            pass

        with Session(engine) as db:
            db.add(AuditLog(
                user_id=user_id,
                user_name=user_name,
                action=action[:60],
                entity=entidade[:40],
                entity_id=entity_id,
                device=device[:150],
                details=json.dumps(details, ensure_ascii=False)[:MAX_DETAILS],
                timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            ))
            db.commit()
