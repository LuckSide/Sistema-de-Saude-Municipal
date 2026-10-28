from unittest.mock import patch, MagicMock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from app.models.integracoes import PecIndicadorCache
from app.services.pec import (
    dimensoes,
    ubs_list,
    postgres_painel,
    evolucao_indicador,
    atualizar_cache_indicadores,
    resolver_painel,
)


@pytest.fixture
def memory_db():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        # Popula cache com alguns indicadores
        session.add_all([
            PecIndicadorCache(
                indicador_id="CITO",
                nome="Citopatológico",
                meta=40,
                numerador=45,
                denominador=100,
                resultado=45,
                periodo="2026-T1",
                ubs="todas",
                equipe="todas",
            ),
            PecIndicadorCache(
                indicador_id="DM",
                nome="Diabéticos",
                meta=50,
                numerador=60,
                denominador=100,
                resultado=60,
                periodo="2026-T1",
                ubs="todas",
                equipe="todas",
            ),
            PecIndicadorCache(
                indicador_id="CITO",
                nome="Citopatológico",
                meta=40,
                numerador=40,
                denominador=100,
                resultado=40,
                periodo="2025-T4",
                ubs="todas",
                equipe="todas",
            ),
        ])
        session.commit()
        yield session


def test_dimensoes_com_cache(memory_db):
    res = dimensoes(db=memory_db)
    assert "periodos" in res
    assert "2026-T1" in res["periodos"]
    assert "equipes" in res
    assert "ubs" in res


def test_ubs_list_com_cache(memory_db):
    res = ubs_list(db=memory_db)
    assert res["lgpd_ok"] is True
    assert "ubs" in res
    assert len(res["ubs"]) > 0


def test_postgres_painel_com_cache(memory_db):
    res = postgres_painel("2026-T1", "", "", db=memory_db)
    assert res is not None
    assert res["fonte"] == "postgres"
    assert res["periodo"] == "2026-T1"
    assert "kpis" in res
    codigos = {k["codigo"] for k in res["kpis"]}
    assert "CITO" in codigos or "CANCER" in codigos


def test_evolucao_indicador_com_cache(memory_db):
    res = evolucao_indicador("CITO", "", "", db=memory_db)
    assert res["indicador"] == "CITO"
    assert len(res["serie"]) >= 1


def test_resolver_painel(memory_db):
    res = resolver_painel("2026-T1", "", "", db=memory_db)
    assert res is not None
    assert "kpis" in res
