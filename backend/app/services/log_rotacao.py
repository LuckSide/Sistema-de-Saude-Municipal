"""Serviço de Retenção, Rotação e Estatísticas da Trilha de Auditoria.

Gerencia o ciclo de vida dos registros de auditoria:
- Estatísticas de uso, consultas e exportações.
- Expurgamento e arquivamento compactado (.json.gz) de logs antigos (> 6 ou 12 meses).
- Limpeza de ruído e manutenção de performance de índices.
"""

import gzip
import json
import os
from datetime import datetime, timedelta, timezone
from sqlalchemy import func, delete, select
from sqlmodel import Session
from app.models.audit import AuditLog


def obter_estatisticas_auditoria(db: Session) -> dict:
    """Calcula estatísticas de volume, tipo de ações e métricas de desempenho dos logs."""
    total = int(db.scalar(select(func.count(AuditLog.id))) or 0)
    total_exportacoes = int(
        db.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "EXPORT_EXCEL")) or 0
    )
    total_pesquisas = int(
        db.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "SEARCH")) or 0
    )

    agora = datetime.now(timezone.utc).replace(tzinfo=None)
    trinta_dias_atras = agora - timedelta(days=30)
    ultimos_30_dias = int(
        db.scalar(select(func.count(AuditLog.id)).where(AuditLog.timestamp >= trinta_dias_atras)) or 0
    )

    primeiro_log = db.scalar(
        select(AuditLog.timestamp).order_by(AuditLog.timestamp.asc()).limit(1)
    )
    ultimo_log = db.scalar(
        select(AuditLog.timestamp).order_by(AuditLog.timestamp.desc()).limit(1)
    )

    # Top 5 ações mais frequentes
    from app.services.auditoria_txt import rotulo_acao
    top_acoes_raw = db.exec(
        select(AuditLog.action, func.count(AuditLog.id))
        .group_by(AuditLog.action)
        .order_by(func.count(AuditLog.id).desc())
        .limit(6)
    ).all()
    top_acoes = [
        {"acao": a, "rotulo": rotulo_acao(a), "total": c}
        for a, c in top_acoes_raw
    ]

    # Top 5 dispositivos mais utilizados
    top_devices_raw = db.exec(
        select(AuditLog.device, func.count(AuditLog.id))
        .where(AuditLog.device != "")
        .group_by(AuditLog.device)
        .order_by(func.count(AuditLog.id).desc())
        .limit(5)
    ).all()
    top_dispositivos = [
        {"device": d, "total": c}
        for d, c in top_devices_raw
    ]

    # Estimativa de espaço em disco (KB)
    tamanho_estimado_kb = round(total * 0.75, 1)
    tamanho_formatado = f"{tamanho_estimado_kb:.1f} KB"
    if tamanho_estimado_kb >= 1024:
        tamanho_formatado = f"{tamanho_estimado_kb / 1024:.2f} MB"

    return {
        "total_registros": total,
        "total_exportacoes": total_exportacoes,
        "total_pesquisas": total_pesquisas,
        "total_buscas": total_pesquisas,
        "ultimos_30_dias": ultimos_30_dias,
        "primeiro_registro": primeiro_log.isoformat() if primeiro_log else None,
        "ultimo_registro": ultimo_log.isoformat() if ultimo_log else None,
        "tamanho_estimado_kb": tamanho_estimado_kb,
        "tamanho_estimado_formatado": tamanho_formatado,
        "top_acoes": top_acoes,
        "top_dispositivos": top_dispositivos,
        "politica_retencao": "12 meses (automática no startup)",
    }


def executar_rotacao_logs(
    db: Session,
    meses_retencao: int = 6,
    arquivar: bool = True,
    diretorio_arquivo: str | None = None,
) -> dict:
    """
    Expurga logs com mais de N meses do banco de dados para evitar crescimento
    descontrolado. Opcionalmente gera arquivo .json.gz de arquivo histórico.
    """
    if meses_retencao < 1:
        meses_retencao = 6

    dias = meses_retencao * 30
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=dias)

    # Identifica registros antigos
    antigos = db.exec(
        select(AuditLog)
        .where(AuditLog.timestamp < cutoff)
        .order_by(AuditLog.timestamp.asc())
    ).all()

    total_antigos = len(antigos)
    if total_antigos == 0:
        return {
            "ok": True,
            "meses_retencao": meses_retencao,
            "data_corte": cutoff.strftime("%d/%m/%Y"),
            "expurgados": 0,
            "removidos": 0,
            "arquivo_compactado": None,
            "mensagem": f"Nenhum log anterior a {cutoff.strftime('%d/%m/%Y')} para expurgo.",
        }

    caminho_gz = None
    if arquivar:
        dir_base = diretorio_arquivo or os.path.normpath(
            os.path.join(os.path.dirname(__file__), "..", "data", "logs_archive")
        )
        os.makedirs(dir_base, exist_ok=True)
        nome_arq = f"audit_archive_{cutoff.strftime('%Y%m%d')}_{datetime.utcnow().strftime('%H%M%S')}.json.gz"
        caminho_gz = os.path.join(dir_base, nome_arq)

        # Serializa para json comprimido
        dados_export = [
            {
                "id": a.id,
                "user_id": a.user_id,
                "user_name": a.user_name,
                "action": a.action,
                "entity": a.entity,
                "entity_id": a.entity_id,
                "device": getattr(a, "device", ""),
                "details": a.details,
                "timestamp": a.timestamp.isoformat() if a.timestamp else None,
            }
            for a in antigos
        ]
        with gzip.open(caminho_gz, "wt", encoding="utf-8") as f:
            json.dump(dados_export, f, ensure_ascii=False)

    # Deleta do banco
    db.exec(delete(AuditLog).where(AuditLog.timestamp < cutoff))
    db.commit()

    # Grava auditoria da própria rotação
    try:
        detalhes_rotacao = {
            "meses_retencao": meses_retencao,
            "data_corte": cutoff.isoformat(),
            "expurgados": total_antigos,
            "arquivo_gz": caminho_gz,
        }
        db.add(AuditLog(
            user_id=None,
            user_name="Sistema (Auto-Rotacao)",
            action="AUDIT_ROTATION",
            entity="AUDIT",
            entity_id=None,
            device="Servidor / Background Worker",
            details=json.dumps(detalhes_rotacao, ensure_ascii=False),
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
        ))
        db.commit()
    except Exception:
        pass

    return {
        "ok": True,
        "meses_retencao": meses_retencao,
        "data_corte": cutoff.strftime("%d/%m/%Y"),
        "expurgados": total_antigos,
        "removidos": total_antigos,
        "arquivo_compactado": caminho_gz,
        "mensagem": f"{total_antigos} registros de auditoria expurgados com sucesso.",
    }
