from datetime import datetime, timedelta, timezone
import ipaddress
import os
import secrets
import socket
from urllib.parse import urlparse

import jwt
from jwt import ExpiredSignatureError, InvalidTokenError
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

_HOSTS_BLOQUEADOS = {
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
    "metadata.google.internal",
    "metadata",
}


def validar_url_externa_segura(
    url: str,
    *,
    exigir_https: bool = False,
    permitir_rede_privada: bool = False,
) -> str:
    """Valida URL de integração externa contra SSRF (metadata cloud, loopback e hosts locais)."""
    raw = (url or "").strip()
    if not raw:
        return ""
    parsed = urlparse(raw)
    esquemas = ("https",) if exigir_https else ("http", "https")
    if parsed.scheme.lower() not in esquemas or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("URL externa inválida ou com credenciais embutidas.")
    host = (parsed.hostname or "").strip().lower().rstrip(".")
    if not host or host in _HOSTS_BLOQUEADOS or host.endswith((".local", ".internal", ".localhost")):
        raise ValueError("Host interno/local não permitido para integração externa.")

    def _ip_proibido(ip_obj) -> bool:
        if ip_obj.is_loopback or ip_obj.is_link_local or ip_obj.is_multicast or ip_obj.is_unspecified:
            return True
        if not permitir_rede_privada and (ip_obj.is_private or ip_obj.is_reserved):
            return True
        return False

    try:
        ip_lit = ipaddress.ip_address(host)
    except ValueError:
        ip_lit = None

    if ip_lit is not None:
        if _ip_proibido(ip_lit):
            raise ValueError("Endereço IP interno/restrito não permitido.")
        return raw

    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
        for info in infos:
            addr = info[4][0].split("%")[0]
            try:
                ip_res = ipaddress.ip_address(addr)
            except ValueError:
                continue
            if _ip_proibido(ip_res):
                raise ValueError("Destino resolve para endereço IP restrito.")
    except socket.gaierror:
        # Ambientes isolados/offline podem não resolver DNS; validações sintáticas já foram aplicadas.
        pass
    return raw


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(subject: str, token_version: int = 1) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    return jwt.encode(
        {
            "sub": subject,
            "exp": expire,
            "tv": int(token_version or 1),
            "jti": secrets.token_hex(8),
        },
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


def decode_token_payload(token: str) -> dict | None:
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        if not payload.get("sub"):
            return None
        return payload
    except (ExpiredSignatureError, InvalidTokenError):
        return None


def decode_token(token: str) -> str | None:
    payload = decode_token_payload(token)
    return payload.get("sub") if payload else None
