import os
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

HEADER_MAGIC = b"SAUDE_BACKUP_V1\x00"  # 16 bytes
HEADER_LEN = 16
SALT_LEN = 16
NONCE_LEN = 12
TAG_LEN = 16
MIN_FILE_SIZE = HEADER_LEN + SALT_LEN + NONCE_LEN + TAG_LEN
PBKDF2_ITERATIONS = 100_000


def _derivar_chave(senha: str, salt: bytes) -> bytes:
    """Deriva chave de 256 bits (32 bytes) a partir da senha e salt via PBKDF2-HMAC-SHA256."""
    if not senha:
        raise ValueError("A senha não pode ser vazia.")
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    return kdf.derive(senha.encode("utf-8"))


def criptografar_dados(dados_bytes: bytes, senha: str) -> bytes:
    """Criptografa bytes de dados com AES-256-GCM derivando a chave da senha via PBKDF2.

    Estrutura do arquivo binário (.bak):
    - Cabeçalho mágico (16 bytes): b"SAUDE_BACKUP_V1\\x00"
    - Salt (16 bytes): os.urandom(16)
    - Nonce/IV (12 bytes): os.urandom(12)
    - Ciphertext com Tag GCM acoplada (retornada pelo AESGCM.encrypt).
    """
    if not senha:
        raise ValueError("A senha de backup não pode ser vazia.")

    salt = os.urandom(SALT_LEN)
    nonce = os.urandom(NONCE_LEN)
    chave = _derivar_chave(senha, salt)

    aesgcm = AESGCM(chave)
    ciphertext = aesgcm.encrypt(nonce, dados_bytes, associated_data=HEADER_MAGIC)

    return HEADER_MAGIC + salt + nonce + ciphertext


def descriptografar_dados(conteudo_arquivo: bytes, senha: str) -> bytes:
    """Descriptografa arquivo de backup criptografado (.bak) com AES-256-GCM.

    Valida o cabeçalho e integridade via GCM tag autenticada.
    """
    if not senha:
        raise ValueError("A senha de backup não pode ser vazia.")

    if len(conteudo_arquivo) < MIN_FILE_SIZE:
        raise ValueError("Arquivo de backup inválido ou formato incompatível.")

    cabecalho = conteudo_arquivo[:HEADER_LEN]
    if cabecalho != HEADER_MAGIC:
        raise ValueError("Arquivo de backup inválido ou formato incompatível.")

    salt = conteudo_arquivo[HEADER_LEN : HEADER_LEN + SALT_LEN]
    nonce = conteudo_arquivo[HEADER_LEN + SALT_LEN : HEADER_LEN + SALT_LEN + NONCE_LEN]
    ciphertext = conteudo_arquivo[HEADER_LEN + SALT_LEN + NONCE_LEN :]

    chave = _derivar_chave(senha, salt)
    aesgcm = AESGCM(chave)

    try:
        dados_descriptografados = aesgcm.decrypt(nonce, ciphertext, associated_data=HEADER_MAGIC)
    except InvalidTag:
        raise ValueError("Senha incorreta ou arquivo de backup corrompido/adulterado.")

    return dados_descriptografados
