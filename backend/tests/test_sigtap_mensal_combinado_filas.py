import json
from datetime import date, datetime
import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.lab_exames import SigtapProcedimento, SigtapVersao
from app.models.settings import SystemSettings
from app.models.tfd import Paciente, ExameFila, TipoFila
from app.services.lab import seed_sigtap
from app.services.lab_contratos_service import resolver_preco_procedimento
from app.services.sigtap_import import importar_sigtap
from app.api.v1.settings import (
    ExamesPermitidosIn,
    obter_exames_permitidos,
    salvar_exames_permitidos,
)
from app.api.v1.lab import listar_sigtap
from app.models.user import User


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        # Cria SystemSettings padrão
        cfg = SystemSettings(id=1, cidade="Guapé", uf="MG")
        s.add(cfg)
        s.commit()
        yield s


def _mock_user():
    return User(
        id=1,
        username="admin",
        role="admin",
        ativo=True,
        permissoes_json=json.dumps({"cfg_geral": ["ver", "editar"], "lab_sigtap": ["ver", "editar"]}),
    )


def test_sigtap_layout_valores_corretos(session):
    """Verifica que o layout de 10 posições extrai corretamente os valores oficiais do SUS sem corromper."""
    # tb_procedimento.txt simulado:
    # 0..10: 0202020380
    # 10..260: HEMOGRAMA COMPLETO (250 chars)
    # 260: 2 (MC)
    # 261: I (Indiferente)
    # 262..266: 0001
    # 266..270: 0000
    # 270..274: 0000
    # 274..278: 0000
    # 278..282: 9999
    # 282..292: 0000000000 (VL_SH = 0.00)
    # 292..302: 0000000411 (VL_SA = 4.11)
    # 302..312: 0000000000 (VL_SP = 0.00)
    # 312..314: 01 (Financ)
    # 314..320: 000001 (Rubrica)
    # 320..326: 202611 (Competência)
    cod = "0202020380"
    nome = "HEMOGRAMA COMPLETO".ljust(250)
    line = f"{cod}{nome}2I0001000000000000999900000000000000000411000000000001000001202611"
    assert len(line) >= 312

    import io
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("tb_procedimento.txt", line.encode("latin-1"))

    stats = importar_sigtap(session, [("TabelaUnificada_202611.zip", buf.getvalue())], "2026-11", "admin", simular=False)
    assert stats["inseridos"] == 1

    proc = session.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == cod)).first()
    assert proc is not None
    assert proc.valor_sh == 0.0
    assert proc.valor_sa == 4.11
    assert proc.valor_sp == 0.0


def test_seed_sigtap_valores_padrao(session):
    """Verifica que o seed carrega procedimentos com valores SA/SP oficiais e atualiza valores zerados."""
    novos = seed_sigtap(session)
    assert novos > 0

    hemo = session.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == "0202020380")).first()
    assert hemo is not None
    assert hemo.valor_sa == 4.11

    glic = session.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == "0202010473")).first()
    assert glic is not None
    assert glic.valor_sa == 1.85


def test_valor_combinado_local_precedencia(session):
    """Verifica que o valor combinado local prevalece sobre o valor padrão da tabela SIGTAP."""
    proc = SigtapProcedimento(
        codigo="0202020380",
        descricao="HEMOGRAMA COMPLETO",
        valor_sa=4.11,
        valor_sp=0.0,
        valor_combinado=12.50,
    )
    session.add(proc)
    session.commit()
    session.refresh(proc)

    valor_un, origem, _ = resolver_preco_procedimento(
        session,
        laboratorio_id=1,
        sigtap_id=proc.id,
        data_referencia=date.today(),
        proc_padrao=proc,
    )
    assert valor_un == 12.50
    assert origem == "combinado_local"


def test_configuracao_exames_por_tipo_fila_e_valores_combinados(session):
    """Testa salvar e obter exames configurados por tipo de fila e valores combinados locais."""
    seed_sigtap(session)
    user = _mock_user()

    # Salva configuração restringindo a Fila de Rotina a 2 exames e definindo valor combinado
    payload = ExamesPermitidosIn(
        codigos=["0202020380", "0202010473", "0202010295"],
        exames_por_tipo_fila={
            "EX. LAB. PSF ROTINA": ["0202020380", "0202010473"],
            "EX. LAB. PSF PRIORIDADE": ["0202020380", "0202010473", "0202010295"],
        },
        valores_combinados={
            "0202020380": 10.00,
            "0202010473": 5.50,
        },
    )
    salvar_res = salvar_exames_permitidos(payload, db=session, _user=user)
    assert salvar_res["ok"] is True
    assert salvar_res["total_habilitados"] == 3

    # Obtém dados da tela
    dados = obter_exames_permitidos(db=session, _user=user)
    assert dados["total_habilitados"] == 3
    assert "EX. LAB. PSF ROTINA" in dados["exames_por_tipo_fila"]
    assert dados["exames_por_tipo_fila"]["EX. LAB. PSF ROTINA"] == ["0202010473", "0202020380"]
    assert dados["valores_combinados"]["0202020380"] == 10.00

    # Verifica que listar_sigtap filtra os exames quando tipo_fila é informado
    lista_rotina = listar_sigtap(tipo_fila="EX. LAB. PSF ROTINA", db=session, _=user)
    codigos_retornados = [p.codigo for p in lista_rotina["data"]]
    assert len(codigos_retornados) == 2
    assert "0202020380" in codigos_retornados
    assert "0202010473" in codigos_retornados
    assert "0202010295" not in codigos_retornados

    # Verifica que o valor_combinado está exposto no retorno de listar_sigtap
    hemo_item = next(p for p in lista_rotina["data"] if p.codigo == "0202020380")
    assert hemo_item.valor_combinado == 10.00
