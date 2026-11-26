from datetime import datetime, timedelta, timezone
import ipaddress
import os
import re
import secrets
import socket
from urllib.parse import urlparse

import jwt
from jwt import ExpiredSignatureError, InvalidTokenError
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SENHA_MIN_CARACTERES = 8

_SENHAS_FRACAS = frozenset({
    "123456",
    "1234567",
    "12345678",
    "123456789",
    "1234567890",
    "000000",
    "0000000",
    "00000000",
    "111111",
    "11111111",
    "222222",
    "22222222",
    "333333",
    "33333333",
    "444444",
    "555555",
    "666666",
    "777777",
    "888888",
    "999999",
    "99999999",
    "987654",
    "98765432",
    "987654321",
    "senha",
    "senha123",
    "senha1234",
    "senha@123",
    "password",
    "password123",
    "password1234",
    "admin",
    "admin123",
    "admin1234",
    "admin@123",
    "guape",
    "guape123",
    "guape1234",
    "guape@123",
    "mudar123",
    "mudar1234",
    "mudar@123",
    "trocar123",
    "trocar1234",
    "trocar@123",
    "qwerty",
    "qwerty123",
    "qwerty1234",
    "abc123",
    "abc1234",
    "abc12345",
    "abcdef",
    "abcdefg",
    "abcdefgh",
    "1q2w3e4r",
    "1q2w3e4r5t",
    "qazwsx",
    "zxcvbn",
    "saude123",
    "saude1234",
    "saude@123",
    "saudeguape",
    "saudeguape123",
    "prefeitura",
    "prefeitura123",
    "teste123",
    "teste1234",
    "usuario123",
    "operador123",
    "letmein",
    "welcome",
})

_TRILHAS_TECLADO = (
    "qwertyuiop",
    "asdfghjkl",
    "zxcvbnm",
    "1234567890",
)


def _contem_sequencia_simples(normalizada: str) -> bool:
    """Detecta sequências crescentes/decrescentes de 4+ caracteres ou trilhas de teclado."""
    if len(normalizada) < 4:
        return False
    for i in range(len(normalizada) - 3):
        trecho = normalizada[i : i + 4]
        if all("0" <= c <= "9" for c in trecho) or all("a" <= c <= "z" for c in trecho):
            diffs = [ord(trecho[j + 1]) - ord(trecho[j]) for j in range(3)]
            if diffs == [1, 1, 1] or diffs == [-1, -1, -1]:
                return True
    for trilha in _TRILHAS_TECLADO:
        for base in (trilha, trilha[::-1]):
            for i in range(len(base) - 3):
                if base[i : i + 4] in normalizada:
                    return True
    return False


def validar_forca_senha(senha: str, username: str = "") -> None:
    """Valida a política de senhas fortes; lança ValueError em pt-BR se fraca."""
    if not isinstance(senha, str) or not senha.strip():
        raise ValueError("A senha não pode estar em branco.")
    if len(senha) < SENHA_MIN_CARACTERES:
        raise ValueError(f"A senha deve ter no mínimo {SENHA_MIN_CARACTERES} caracteres.")

    normalizada = "".join(senha.split()).lower()
    if len(set(normalizada)) <= 1:
        raise ValueError("A senha não pode ser composta por apenas um caractere repetido.")
    if normalizada in _SENHAS_FRACAS:
        raise ValueError("Esta senha é muito comum ou previsível. Escolha uma senha mais forte.")
    if normalizada.isdigit():
        raise ValueError("A senha não pode conter apenas números.")
    if _contem_sequencia_simples(normalizada):
        raise ValueError(
            "A senha não pode conter sequências simples (como 1234, abcd ou qwer)."
        )

    tem_letra = any(c.isalpha() for c in senha)
    tem_numero_ou_especial = any(
        c.isdigit() or (not c.isalnum() and not c.isspace()) for c in senha
    )
    if not (tem_letra and tem_numero_ou_especial):
        raise ValueError(
            "A senha deve combinar letras com pelo menos um número ou caractere especial."
        )

    u_norm = "".join((username or "").split()).lower()
    if len(u_norm) >= 3:
        u_letras = "".join(c for c in u_norm if c.isalpha())
        s_letras = "".join(c for c in normalizada if c.isalpha())
        if (
            normalizada == u_norm
            or re.fullmatch(rf"\d*{re.escape(u_norm)}\d*", normalizada)
            or (len(u_letras) >= 3 and s_letras == u_letras)
        ):
            raise ValueError(
                "A senha não pode ser igual ou baseada apenas no nome de usuário."
            )

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
