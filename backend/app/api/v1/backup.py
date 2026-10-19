from datetime import datetime
import gzip
import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.core.deps import get_db
from app.models.user import User
from app.services.backup_crypto import criptografar_dados, descriptografar_dados
from app.services.backup_service import gerar_dump_dados, restaurar_dump_dados
from app.services.permissoes import need_perm

router = APIRouter()


class ExportarBackupIn(BaseModel):
    senha: str = Field(min_length=1, description="Senha para criptografar o arquivo de backup")


@router.post("/exportar")
def exportar_backup(
    payload: ExportarBackupIn,
    db: Session = Depends(get_db),
    user: User = Depends(need_perm("usuarios")),
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao gerar backup: {e}",
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
    user: User = Depends(need_perm("usuarios")),
):
    """Restaura o sistema a partir de um arquivo .bak criptografado com atomicidade total."""
    if not senha or not senha.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A senha de descriptografia é obrigatória.",
        )

    conteudo_arquivo = await arquivo.read()
    if not conteudo_arquivo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O arquivo enviado está vazio.",
        )

    try:
        # 1. Descriptografa com AES-256-GCM
        dados_descriptografados = descriptografar_dados(conteudo_arquivo, senha.strip())

        # 2. Descomprime se for gzip (ou usa direto se JSON puro)
        if dados_descriptografados.startswith(b"\x1f\x8b"):
            dados_descriptografados = gzip.decompress(dados_descriptografados)

        dump = json.loads(dados_descriptografados.decode("utf-8"))

        # 3. Restauração atômica no banco de dados
        detalhes = restaurar_dump_dados(db, dump, autor_id=user.id or 0)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Arquivo de backup corrompido ou formato JSON inválido.",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro interno durante a restauração do banco: {e}",
        )

    return {
        "ok": True,
        "mensagem": "Backup restaurado com sucesso!",
        "detalhes": detalhes,
    }
