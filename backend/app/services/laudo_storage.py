"""Serviço de Armazenamento Seguro e Vinculação ao Prontuário de Laudos Laboratoriais.

Subagente 3: Segurança de Storage e Prontuário Clínico.
Implementa:
- Armazenamento de arquivos binários de PDF em diretório isolado do servidor;
- Verificação de integridade via hash SHA-256;
- Vinculação formal e auditável ao Prontuário Unificado (PEC) do Cidadão;
- Proteção de acesso: downloads permitidos apenas via endpoint autenticado com controle RBAC/RLS.
"""

from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import HTTPException
from sqlmodel import Session

from app.models.lab_fase6 import LabResultadoArquivo, SolicitacaoMestre
from app.models.tfd import Paciente, PacienteHistorico

logger = logging.getLogger("laudo_storage")

# Diretório base protegido para armazenamento de laudos
STORAGE_BASE_DIR = Path(__file__).resolve().parent.parent.parent / "storage" / "laudos"


def _garantir_diretorio(ano_mes: str) -> Path:
    """Garante que o diretório seguro do ano/mês exista no disco."""
    diretorio = STORAGE_BASE_DIR / ano_mes
    diretorio.mkdir(parents=True, exist_ok=True)
    return diretorio


def salvar_arquivo_laudo(
    db: Session,
    solicitacao_id: int,
    paciente_id: int,
    laboratorio_id: int,
    nome_original: str,
    conteudo_bytes: bytes,
    usuario_nome: str,
) -> LabResultadoArquivo:
    """Armazena o binário do laudo no disco protegido e cria o registro na tabela."""
    if not conteudo_bytes:
        raise HTTPException(status_code=400, detail="O arquivo de laudo enviado está vazio.")

    # Validação mínima de cabeçalho PDF (%PDF-)
    if not conteudo_bytes.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=400,
            detail="Arquivo inválido. O documento deve ser um arquivo PDF válido com cabeçalho padrão.",
        )

    tamanho = len(conteudo_bytes)
    sha256 = hashlib.sha256(conteudo_bytes).hexdigest()

    hoje = datetime.utcnow()
    comp_pasta = hoje.strftime("%Y-%m")
    pasta_destino = _garantir_diretorio(comp_pasta)

    # Nome seguro do arquivo: laudo_SL{solic_id}_{sha256[:12]}.pdf
    nome_sistema = f"laudo_SL_{solicitacao_id:06d}_{sha256[:12]}.pdf"
    caminho_completo = pasta_destino / nome_sistema

    try:
        with open(caminho_completo, "wb") as f:
            f.write(conteudo_bytes)
        logger.info(
            "Arquivo de laudo salvo com sucesso em %s (%d bytes, sha256=%s).",
            caminho_completo,
            tamanho,
            sha256[:12],
        )
    except Exception as e:
        logger.error("Erro ao gravar binário do laudo em disco: %s", e)
        raise HTTPException(status_code=500, detail="Falha ao gravar arquivo no storage do servidor.")

    # Registra no banco de dados
    obj_arquivo = LabResultadoArquivo(
        solicitacao_id=solicitacao_id,
        paciente_id=paciente_id,
        laboratorio_id=laboratorio_id,
        nome_arquivo_original=nome_original[:250],
        nome_arquivo_sistema=nome_sistema,
        caminho_storage=str(caminho_completo),
        sha256_hash=sha256,
        tamanho_bytes=tamanho,
        mime_type="application/pdf",
        enviado_por=usuario_nome or "Recepção do Laboratório",
        enviado_em=hoje,
        ativo=True,
    )
    db.add(obj_arquivo)
    db.commit()
    db.refresh(obj_arquivo)
    return obj_arquivo


def obter_caminho_arquivo_laudo(arquivo: LabResultadoArquivo) -> Optional[Path]:
    """Retorna o caminho do arquivo no sistema de arquivos se existente."""
    if not arquivo or not arquivo.caminho_storage:
        return None
    p = Path(arquivo.caminho_storage)
    if p.exists() and p.is_file():
        return p
    return None


def vincular_laudo_prontuario(
    db: Session,
    solicitacao: SolicitacaoMestre,
    paciente: Paciente,
    arquivo: LabResultadoArquivo,
    usuario_nome: str,
) -> None:
    """Homologa a conclusão dos exames e anexa o laudo permanentemente ao Prontuário do Paciente."""
    agora = datetime.utcnow()

    # Atualiza a SolicitacaoMestre
    solicitacao.status = "realizado"
    solicitacao.status_auditoria = "conferido_aprovado"
    solicitacao.laudo_arquivo_id = arquivo.id
    db.add(solicitacao)

    # Injeta registro formal de histórico no prontuário do paciente (integrado com base do PEC)
    prontuario_cod = getattr(paciente, "codigo_prontuario", "") or (
        f"PEC-{paciente.co_seq_cidadao_pec}" if getattr(paciente, "co_seq_cidadao_pec", None) else f"PR-{paciente.id:05d}"
    )

    evento_historico = PacienteHistorico(
        paciente_id=paciente.id or 0,
        tipo_evento="LAUDO_EXAME_REALIZADO",
        motivo="Resultado de Exames Laboratoriais Homologado",
        descricao=(
            f"Laudo laboratorial concluído e homologado para a solicitação SL-{solicitacao.id:06d}. "
            f"Arquivo anexado ao prontuário: {arquivo.nome_arquivo_original} (SHA256: {arquivo.sha256_hash[:8]})."
        ),
        origem="laboratorio_laudo",
        exames_baixados_qtd=1,
        exames_baixados_ids=f"SL-{solicitacao.id:06d}",
        registrado_por=usuario_nome or "Sistema de Conferência Laboratorial",
        registrado_em=agora,
    )
    db.add(evento_historico)
    db.commit()
    db.refresh(solicitacao)
    logger.info(
        "Solicitação SL-%06d marcada como realizada e vinculada ao prontuário %s do paciente #%d.",
        solicitacao.id,
        prontuario_cod,
        paciente.id,
    )
