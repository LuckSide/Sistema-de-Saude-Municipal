from datetime import datetime
import gzip
import json
import logging
import zlib

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.core.deps import get_db, require_senha_ok, require_superuser
from app.models.user import User
from app.services.backup_crypto import criptografar_dados, descriptografar_dados
from app.services.backup_service import gerar_dump_dados, restaurar_dump_dados

logger = logging.getLogger("backup")
router = APIRouter()

MAX_BACKUP_UPLOAD_BYTES = 64 * 1024 * 1024
MAX_BACKUP_DECOMPRESSED_BYTES = 256 * 1024 * 1024


def _descomprimir_gzip_limitado(dados: bytes, limite: int = MAX_BACKUP_DECOMPRESSED_BYTES) -> bytes:
    """Descomprime payload gzip em blocos limitando o tamanho final contra zip/gzip bombs."""
    decomp = zlib.decompressobj(16 + zlib.MAX_WBITS)
    partes: list[bytes] = []
    total = 0
    for i in range(0, len(dados), 65536):
        chunk = decomp.decompress(dados[i : i + 65536], limite - total + 1)
        total += len(chunk)
        if total > limite:
            raise ValueError("Arquivo de backup excede o limite seguro após descompressão.")
        partes.append(chunk)
    resto = decomp.flush(limite - total + 1)
    total += len(resto)
    if total > limite:
        raise ValueError("Arquivo de backup excede o limite seguro após descompressão.")
    partes.append(resto)
    return b"".join(partes)


class ExportarBackupIn(BaseModel):
    senha: str = Field(min_length=1, description="Senha para criptografar o arquivo de backup")


@router.post("/exportar")
def exportar_backup(
    payload: ExportarBackupIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_superuser),
    _=Depends(require_senha_ok),
):
    """Gera um dump completo de todas as tabelas do sistema, comprime e criptografa com AES-256-GCM."""
    if not payload.senha or not payload.senha.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A senha para criptografia do backup é obrigatória.",
        )

    try:
        # 1. Coleta dados do banco
        dump_dados = gerar_dump_dados(db)

        # 2. Converte para JSON e comprime com gzip
        json_bytes = json.dumps(dump_dados, ensure_ascii=False).encode("utf-8")
        dados_comprimidos = gzip.compress(json_bytes)

        # 3. Criptografa com AES-256-GCM + PBKDF2
        arquivo_bak = criptografar_dados(dados_comprimidos, payload.senha.strip())
    except ValueError as e:
        logger.warning("Erro ao gerar backup: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e) or "Erro de validação. Verifique os parâmetros.",
        )
    except Exception as e:
        logger.exception("Falha interna ao gerar backup")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e) or "Falha interna ao gerar backup. Consulte os logs.",
        )

    data_formatada = datetime.now().strftime("%Y%m%d_%H%M%S")
    nome_arquivo = f"backup_sistema_{data_formatada}.bak"

    return Response(
        content=arquivo_bak,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{nome_arquivo}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.post("/restaurar")
async def restaurar_backup(
    arquivo: UploadFile = File(...),
    senha: str = Form(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_superuser),
    _=Depends(require_senha_ok),
):
    """Restaura o sistema a partir de um arquivo .bak criptografado com atomicidade total."""
    if not senha or not senha.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A senha de descriptografia é obrigatória.",
        )

    conteudo_arquivo = await arquivo.read(MAX_BACKUP_UPLOAD_BYTES + 1)
    if not conteudo_arquivo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O arquivo enviado está vazio.",
        )
    if len(conteudo_arquivo) > MAX_BACKUP_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Arquivo de backup excede o limite máximo de 64 MB.",
        )

    try:
        # 1. Descriptografa com AES-256-GCM
        dados_descriptografados = descriptografar_dados(conteudo_arquivo, senha.strip())

        # 2. Descomprime com proteção contra gzip bomb (ou usa direto se JSON puro)
        if dados_descriptografados.startswith(b"\x1f\x8b"):
            dados_descriptografados = _descomprimir_gzip_limitado(dados_descriptografados)
        elif len(dados_descriptografados) > MAX_BACKUP_DECOMPRESSED_BYTES:
            raise ValueError("Arquivo de backup excede o limite seguro de tamanho.")

        dump = json.loads(dados_descriptografados.decode("utf-8"))

        # 3. Restauração atômica no banco de dados
        detalhes = restaurar_dump_dados(db, dump, autor_id=admin.id or 0)
    except ValueError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e) or "Erro de validação. Verifique os parâmetros.",
        )
    except (json.JSONDecodeError, UnicodeDecodeError, gzip.BadGzipFile):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Arquivo de backup corrompido ou formato JSON inválido.",
        )
    except Exception as e:
        db.rollback()
        logger.exception("Falha inesperada durante restauração de backup")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e) or "Erro interno durante a restauração do banco. Consulte os logs.",
        )

    return {
        "ok": True,
        "mensagem": "Backup restaurado com sucesso!",
        "detalhes": detalhes,
    }
