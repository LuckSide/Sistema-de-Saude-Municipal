import pytest
from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.deps import get_user_from_header_or_query
from app.core.security import create_access_token
from app.models.lab_exames import SigtapProcedimento
from app.models.tfd import ProcedimentoCatalogo
from app.models.user import User
from app.schemas.lab import SigtapIn
from app.schemas.tfd import ProcedimentoIn
from app.api.v1.lab import criar_sigtap
from app.api.v1.tfd import criar_procedimento


@pytest.fixture
def test_db():
    engine = create_engine("sqlite:///:memory:", echo=False)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        # Create test user
        user = User(
            username="analista_lab",
            nome="Analista de Laboratório",
            password_hash="hash",
            is_active=True,
            is_superuser=True,
            must_change_password=False,
            telas="lab,usuarios,tfd",
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        yield session


def test_autenticacao_header_ou_query_token(test_db):
    user = test_db.exec(select(User).where(User.username == "analista_lab")).first()
    token = create_access_token(user.username)

    # 1. Autenticação via Query param ?token=...
    u1 = get_user_from_header_or_query(token_query=token, auth_header=None, db=test_db)
    assert u1.username == "analista_lab"

    # 2. Autenticação via Header Authorization: Bearer ...
    u2 = get_user_from_header_or_query(token_query=None, auth_header=f"Bearer {token}", db=test_db)
    assert u2.username == "analista_lab"

    # 3. Falha quando token não é fornecido
    with pytest.raises(HTTPException) as exc:
        get_user_from_header_or_query(token_query=None, auth_header=None, db=test_db)
    assert exc.value.status_code == 401


def test_sigtap_sem_codigo_especifico_e_codigo_faturamento(test_db):
    user = test_db.exec(select(User).where(User.username == "analista_lab")).first()

    # Seed de procedimento padrão para faturamento
    proc_fat = SigtapProcedimento(
        codigo="0202010473",
        descricao="HEMOGRAMA COMPLETO",
        complexidade="MC",
        instrumento="BPA-C",
        valor_sa=4.11,
        valor_sp=0.0,
        valor_sh=0.0,
        competencia="2026-11",
    )
    test_db.add(proc_fat)
    test_db.commit()

    # Criação de procedimento com 'sem_codigo_especifico=True' e 'codigo_faturamento_sigtap'
    data = SigtapIn(
        codigo="",  # deve auto-gerar 99...
        descricao="PAINEL METABÓLICO AVANÇADO (SEM CÓDIGO SUS PRÓPRIO)",
        complexidade="MC",
        instrumento="BPA-C",
        sem_codigo_especifico=True,
        codigo_faturamento_sigtap="0202010473",
    )

    criado = criar_sigtap(data=data, db=test_db, user=user)

    assert criado.sem_codigo_especifico is True
    assert criado.codigo_faturamento_sigtap == "0202010473"
    assert criado.codigo.startswith("99")
    assert criado.descricao == "PAINEL METABÓLICO AVANÇADO (SEM CÓDIGO SUS PRÓPRIO)"
    # Herdou valor do exame de faturamento
    assert criado.valor_sa == 4.11


def test_procedimento_catalogo_sem_codigo_especifico(test_db):
    data = ProcedimentoIn(
        codigo="",
        nome="ECOCARDIOGRAMA COM CONTRASTE MIOCÁRDICO",
        tipo_fila="EXAMES CARDIOLÓGICOS",
        codigo_curto="ECO-CONT",
        sem_codigo_especifico=True,
        codigo_faturamento_sigtap="0205020186",
        ativo=True,
    )
    criado = criar_procedimento(data=data, db=test_db, _=None)
    assert criado.sem_codigo_especifico is True
    assert criado.codigo_faturamento_sigtap == "0205020186"
    assert criado.codigo.startswith("99")
    assert "ECOCARDIOGRAMA" in criado.nome
