"""API para Faturamento Oficial BPA (Boletim de Produção Ambulatorial) do SUS.

Módulo Unificado Municipal integrando:
- Produções Ambulatoriais Clínicas (BPA-C e BPA-I)
- Exames Laboratoriais (BPA-C e BPA-I)
- Viagens e Deslocamentos de Carro / TFD (Grupo 08)
- Críticas Preventivas CNES/BPA antes da exportação
- Demonstrativo Formal de Faturamento por CNES e Geral
"""

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlmodel import Session

from app.core.deps import get_db
from app.services.bpa_export_service import (
    gerar_bpa_completo_municipio,
    obter_demonstrativo_faturamento,
)
from app.services.cnes_criticas_service import auditar_criticas_bpa_competencia

router = APIRouter()


@router.get("/resumo")
def obter_resumo_bpa(
    competencia: str = Query(
        default="",
        description="Competência no formato YYYY-MM ou YYYYMM (ex: 2026-10)",
    ),
    unidade_saude_id: int | None = Query(
        default=None,
        description="ID da Unidade de Saúde para filtro específico ou None para todo o município",
    ),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Retorna o resumo estatístico e itens consolidados/individualizados da competência."""
    if not competencia:
        hoje = date.today()
        competencia = f"{hoje.year:04d}-{hoje.month:02d}"

    try:
        dados = gerar_bpa_completo_municipio(
            db,
            competencia,
            unidade_saude_id=unidade_saude_id,
            forcar=True,
            verificar_criticas=False,
        )
        return {
            "competencia": dados["competencia"],
            "competencia_aaaamm": dados["competencia_aaaamm"],
            "unidade_saude_id": dados["unidade_saude_id"],
            "cnes_exportado": dados["cnes_exportado"],
            "total_linhas": dados["total_linhas"],
            "total_folhas": dados["total_folhas"],
            "controle_verificador": dados["controle_verificador"],
            "total_procedimentos_bpa_c": dados["total_procedimentos_bpa_c"],
            "total_procedimentos_bpa_i": dados["total_procedimentos_bpa_i"],
            "total_exames": dados["total_exames"],
            "total_viagens_tfd": dados["total_viagens_tfd"],
            "total_ambulatorial": dados.get("total_ambulatorial", 0),
            "total_geral_itens": dados["total_geral_itens"],
            "valor_total_estimado": dados["valor_total_estimado"],
            "itens_bpa_c": dados["itens_bpa_c"],
            "itens_bpa_i": dados["itens_bpa_i"],
            "arquivo_nome_out": dados["arquivo_nome_out"],
            "arquivo_nome_csv": dados["arquivo_nome_csv"],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao processar BPA: {exc}")


@router.get("/criticas-preventivas")
def obter_criticas_preventivas_bpa(
    competencia: str = Query(
        default="",
        description="Competência no formato YYYY-MM ou YYYYMM (ex: 2026-10)",
    ),
    unidade_saude_id: int | None = Query(
        default=None,
        description="ID da Unidade de Saúde para filtro ou None para geral",
    ),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Auditoria preventiva abrangente de inconsistências CNES/BPA antes da exportação oficial."""
    if not competencia:
        hoje = date.today()
        competencia = f"{hoje.year:04d}-{hoje.month:02d}"

    try:
        return auditar_criticas_bpa_competencia(
            db=db,
            competencia=competencia,
            unidade_saude_id=unidade_saude_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao auditar críticas preventivas: {exc}")


@router.get("/demonstrativo-faturamento")
def obter_demonstrativo_faturamento_bpa(
    competencia: str = Query(
        default="",
        description="Competência no formato YYYY-MM ou YYYYMM",
    ),
    unidade_saude_id: int | None = Query(
        default=None,
        description="ID da Unidade de Saúde para filtro ou None para geral",
    ),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Retorna o demonstrativo formal de faturamento ambulatorial BPA por CNES e Geral."""
    if not competencia:
        hoje = date.today()
        competencia = f"{hoje.year:04d}-{hoje.month:02d}"

    try:
        return obter_demonstrativo_faturamento(
            db=db,
            competencia=competencia,
            unidade_saude_id=unidade_saude_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar demonstrativo de faturamento: {exc}")


@router.get("/download-out")
def download_arquivo_bpa_out(
    competencia: str = Query(
        default="",
        description="Competência no formato YYYY-MM ou YYYYMM",
    ),
    unidade_saude_id: int | None = Query(
        default=None,
        description="Filtro opcional por Unidade de Saúde",
    ),
    forcar: bool = Query(
        default=False,
        description="Se True, permite exportar em modo auditoria mesmo com críticas bloqueantes",
    ),
    db: Session = Depends(get_db),
):
    """Download do arquivo oficial do BPA em formato posicional (.OUT) para o SIA-SUS."""
    if not competencia:
        hoje = date.today()
        competencia = f"{hoje.year:04d}-{hoje.month:02d}"

    try:
        dados = gerar_bpa_completo_municipio(
            db,
            competencia,
            unidade_saude_id=unidade_saude_id,
            forcar=forcar,
            verificar_criticas=True,
        )
        nome_arquivo = dados["arquivo_nome_out"]
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
    except ValueError as val_err:
        raise HTTPException(status_code=422, detail=str(val_err))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao exportar BPA (.OUT): {exc}")


@router.get("/download-csv")
def download_planilha_bpa_csv(
    competencia: str = Query(
        default="",
        description="Competência no formato YYYY-MM ou YYYYMM",
    ),
    unidade_saude_id: int | None = Query(
        default=None,
        description="Filtro opcional por Unidade de Saúde",
    ),
    db: Session = Depends(get_db),
):
    """Download da planilha CSV de conferência do BPA."""
    if not competencia:
        hoje = date.today()
        competencia = f"{hoje.year:04d}-{hoje.month:02d}"

    try:
        dados = gerar_bpa_completo_municipio(
            db,
            competencia,
            unidade_saude_id=unidade_saude_id,
            forcar=True,
            verificar_criticas=False,
        )
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
