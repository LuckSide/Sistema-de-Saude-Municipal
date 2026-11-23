"""API para Faturamento Oficial BPA (Boletim de Produção Ambulatorial) do SUS.

Módulo Unificado Municipal (fora do escopo restrito do laboratório),
integrando Exames Laboratoriais (BPA-C e BPA-I) e Viagens/Transporte TFD (Grupo 08).
"""

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlmodel import Session

from app.core.deps import get_db
from app.services.bpa_export_service import gerar_bpa_completo_municipio

router = APIRouter()


@router.get("/resumo")
def obter_resumo_bpa(
    competencia: str = Query(
        default="",
        description="Competência no formato YYYY-MM ou YYYYMM (ex: 2026-10)",
    ),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Retorna o resumo estatístico e itens consolidados/individualizados da competência."""
    if not competencia:
        hoje = date.today()
        competencia = f"{hoje.year:04d}-{hoje.month:02d}"

    try:
        dados = gerar_bpa_completo_municipio(db, competencia)
        # Remove os payloads binários pesados do retorno do resumo JSON
        return {
            "competencia": dados["competencia"],
            "competencia_aaaamm": dados["competencia_aaaamm"],
            "total_linhas": dados["total_linhas"],
            "total_folhas": dados["total_folhas"],
            "controle_verificador": dados["controle_verificador"],
            "total_procedimentos_bpa_c": dados["total_procedimentos_bpa_c"],
            "total_procedimentos_bpa_i": dados["total_procedimentos_bpa_i"],
            "total_exames": dados["total_exames"],
            "total_viagens_tfd": dados["total_viagens_tfd"],
            "total_geral_itens": dados["total_geral_itens"],
            "valor_total_estimado": dados["valor_total_estimado"],
            "itens_bpa_c": dados["itens_bpa_c"],
            "itens_bpa_i": dados["itens_bpa_i"],
            "arquivo_nome_out": dados["arquivo_nome_out"],
            "arquivo_nome_csv": dados["arquivo_nome_csv"],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao processar BPA: {exc}")


@router.get("/download-out")
def download_arquivo_bpa_out(
    competencia: str = Query(
        default="",
        description="Competência no formato YYYY-MM ou YYYYMM",
    ),
    db: Session = Depends(get_db),
):
    """Download do arquivo oficial do BPA em formato posicional (.OUT) para o SIA-SUS."""
    if not competencia:
        hoje = date.today()
        competencia = f"{hoje.year:04d}-{hoje.month:02d}"

    try:
        dados = gerar_bpa_completo_municipio(db, competencia)
        nome_arquivo = f"PA312810.OUT"
        return Response(
            content=dados["conteudo_out_bytes"],
            media_type="text/plain; charset=iso-8859-1",
            headers={
                "Content-Disposition": f'attachment; filename="{nome_arquivo}"',
                "X-BPA-Competencia": dados["competencia_aaaamm"],
                "X-BPA-Linhas": str(dados["total_linhas"]),
                "X-BPA-Folhas": str(dados["total_folhas"]),
                "X-BPA-Controle": str(dados["controle_verificador"]),
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao exportar BPA (.OUT): {exc}")


@router.get("/download-csv")
def download_planilha_bpa_csv(
    competencia: str = Query(
        default="",
        description="Competência no formato YYYY-MM ou YYYYMM",
    ),
    db: Session = Depends(get_db),
):
    """Download da planilha CSV de conferência do BPA."""
    if not competencia:
        hoje = date.today()
        competencia = f"{hoje.year:04d}-{hoje.month:02d}"

    try:
        dados = gerar_bpa_completo_municipio(db, competencia)
        nome_arquivo = dados["arquivo_nome_csv"]
        return Response(
            content=dados["conteudo_csv_bytes"],
            media_type="text/csv; charset=utf-8-sig",
            headers={
                "Content-Disposition": f'attachment; filename="{nome_arquivo}"',
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao exportar planilha CSV: {exc}")
