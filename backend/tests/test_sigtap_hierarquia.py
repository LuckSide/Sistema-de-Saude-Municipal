import pytest
from sqlmodel import SQLModel, create_engine, Session, select
from app.models.cadastros_saude import Medico
from app.models.lab_exames import SigtapProcedimento, SigtapCbo
from app.models.tfd import ProcedimentoCatalogo, TipoFila
from app.models.settings import SystemSettings
from app.models.user import User
from app.services.sigtap_hierarquia import (
    decompor_codigo_sigtap,
    obter_filtro_sigtap_por_tipo,
    validar_cbo_procedimento,
    seed_vivver_procedimentos,
    GRUPOS_SIGTAP,
    SUBGRUPOS_SIGTAP,
)
from app.schemas.tfd import ValidarCboIn
from app.api.v1.tfd import catalogo_procedimentos, validar_cbo_endpoint


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        yield db


def test_decompor_codigo_sigtap():
    # 1. Procedimento Laboratorial
    res_lab = decompor_codigo_sigtap("0202010120")
    assert res_lab["grupo_codigo"] == "02"
    assert res_lab["subgrupo_codigo"] == "0202"
    assert res_lab["eh_laboratorial"] is True
    assert res_lab["eh_cirurgico"] is False
    assert res_lab["eh_consulta"] is False
    assert "laboratório clínico" in res_lab["subgrupo_nome"].lower()

    # 2. Procedimento Cirúrgico (Ortopedia 0408)
    res_cir = decompor_codigo_sigtap("0408010010")
    assert res_cir["grupo_codigo"] == "04"
    assert res_cir["subgrupo_codigo"] == "0408"
    assert res_cir["eh_cirurgico"] is True
    assert res_cir["eh_laboratorial"] is False
    assert "Ortopédica" in res_cir["subgrupo_nome"]

    # 3. Consulta médica (0301)
    res_con = decompor_codigo_sigtap("0301010072")
    assert res_con["grupo_codigo"] == "03"
    assert res_con["subgrupo_codigo"] == "0301"
    assert res_con["eh_consulta"] is True
    assert res_con["eh_cirurgico"] is False
    assert res_con["eh_laboratorial"] is False

    # 4. Código curto ou inválido
    res_curto = decompor_codigo_sigtap("0")
    assert res_curto["grupo_codigo"] == ""
    assert res_curto["eh_laboratorial"] is False


def test_obter_filtro_sigtap_por_tipo():
    # 1. Filas de Exames Laboratoriais
    filtro_lab = obter_filtro_sigtap_por_tipo("EXAMES LABORATORIAIS")
    assert filtro_lab["apenas_laboratoriais"] is True
    assert filtro_lab["prefixos"] == ["0202"]
    assert filtro_lab["categoria"] == "LABORATORIAL"

    filtro_sangue = obter_filtro_sigtap_por_tipo("Exame de Sangue")
    assert filtro_sangue["apenas_laboratoriais"] is True

    # 2. Filas de Cirurgias: nunca traz 0202
    filtro_cir = obter_filtro_sigtap_por_tipo("Cirurgias Eletivas")
    assert filtro_cir["apenas_laboratoriais"] is False
    assert "04" in filtro_cir["prefixos"]
    assert "0202" in filtro_cir["excluir_prefixos"]
    assert filtro_cir["categoria"] == "CIRURGICO"

    # 3. Filas Especializadas (ex: Ultrassonografia, Tomografia, Consultas)
    filtro_usg = obter_filtro_sigtap_por_tipo("Ultrassonografia")
    assert "0205" in filtro_usg["prefixos"]
    assert "0202" in filtro_usg["excluir_prefixos"]

    filtro_tomo = obter_filtro_sigtap_por_tipo("Tomografia Computadorizada")
    assert "0206" in filtro_tomo["prefixos"]
    assert "0202" in filtro_tomo["excluir_prefixos"]

    filtro_cons = obter_filtro_sigtap_por_tipo("Consultas Especializadas")
    assert "0301" in filtro_cons["prefixos"]
    assert "0202" in filtro_cons["excluir_prefixos"]


def test_validar_cbo_procedimento_laboratorial(session):
    # Exames de laboratório clínico (0202) são livres na atenção primária
    p_lab = SigtapProcedimento(
        codigo="0202010120",
        descricao="HEMOGRAMA COMPLETO",
    )
    session.add(p_lab)
    session.commit()

    res = validar_cbo_procedimento(
        session,
        codigo_procedimento="0202010120",
        cbo_profissional="225125",
        medico_nome="Dr. Clínico Geral",
    )
    assert res["compativel"] is True
    assert res["exige_cbo_estrito"] is False
    assert res["alerta"] is None
    assert res["permite_responsavel_tecnico"] is True


def test_validar_cbo_procedimento_cirurgico_e_especializado(session):
    # Procedimento cirúrgico ortopédico
    proc_cir = SigtapProcedimento(
        codigo="0408010010",
        descricao="ARTROPLASTIA TOTAL DE QUADRIL",
    )
    # CBO oficial de Ortopedista: 225270
    cbo_orto = SigtapCbo(
        procedimento_codigo="0408010010",
        cbo="225270",
        descricao="MÉDICO ORTOPEDISTA E TRAUMATOLOGISTA",
    )
    session.add(proc_cir)
    session.add(cbo_orto)
    session.commit()

    # 1. Médico Ortopedista (CBO exato) -> Compatível
    res1 = validar_cbo_procedimento(
        session,
        codigo_procedimento="0408010010",
        cbo_profissional="225270",
        medico_nome="Dr. Ortopedista",
    )
    assert res1["compativel"] is True
    assert res1["exige_cbo_estrito"] is True
    assert res1["alerta"] is None

    # 2. Médico Cirurgião Geral (CBO da mesma família 2252) -> Compatível por família
    res2 = validar_cbo_procedimento(
        session,
        codigo_procedimento="0408010010",
        cbo_profissional="225225",  # Cirurgião Geral
        medico_nome="Dr. Cirurgião",
    )
    assert res2["compativel"] is True
    assert "mesma família médica" in res2["motivo"]

    # 3. Profissional com CBO divergente (ex: Dermatologista 225135) -> Não compatível, gera alerta
    res3 = validar_cbo_procedimento(
        session,
        codigo_procedimento="0408010010",
        cbo_profissional="225135",
        medico_nome="Dr. Dermatologista",
    )
    assert res3["compativel"] is False
    assert res3["alerta"] is not None
    assert "divergente dos CBOs requeridos no SIGTAP" in res3["alerta"]

    # 4. "Médico da Unidade / Responsável Técnico" -> Sempre aceito na atenção primária
    res4 = validar_cbo_procedimento(
        session,
        codigo_procedimento="0408010010",
        cbo_profissional="",
        medico_nome="Médico da Unidade / Responsável Técnico",
    )
    assert res4["compativel"] is True
    assert "Responsável Técnico" in res4["motivo"]


def test_catalogo_procedimentos_filtro_contextual(session):
    # Cria procedimentos de teste no catálogo e no SIGTAP
    # Procedimento laboratorial
    session.add(ProcedimentoCatalogo(
        codigo="0202010120",
        nome="HEMOGRAMA COMPLETO",
        tipo_fila="EXAMES LABORATORIAIS",
        ativo=True,
    ))
    # Procedimento cirúrgico
    session.add(ProcedimentoCatalogo(
        codigo="0408010010",
        nome="ARTROPLASTIA DE QUADRIL",
        tipo_fila="CIRURGIAS ELETIVAS",
        ativo=True,
    ))
    # Procedimento SIGTAP não cadastrado no catálogo local
    session.add(SigtapProcedimento(
        codigo="0202010317",
        descricao="DOSAGEM DE GLICOSE",
        instrumento="BPA-C",
    ))
    session.add(SigtapProcedimento(
        codigo="0401010015",
        descricao="BIOPSIA DE PELE E TECIDO CELULAR SUBCUTANEO",
        instrumento="BPA-C",
    ))
    session.commit()

    # Busca em fila de laboratório: deve trazer apenas 0202
    res_lab = catalogo_procedimentos(
        q="glicose",
        tipo_fila="EXAMES LABORATORIAIS",
        apenas_laboratoriais=None,
        db=session,
        _=None,
    )
    assert len(res_lab) > 0
    assert any("GLICOSE" in item["nome_procedimento"].upper() for item in res_lab)

    # Busca em fila de cirurgias: NUNCA deve trazer exame de sangue (0202)
    res_cir = catalogo_procedimentos(
        q="",
        tipo_fila="CIRURGIAS ELETIVAS",
        apenas_laboratoriais=None,
        db=session,
        _=None,
    )
    codigos_cir = [item["codigo_procedimento"] for item in res_cir]
    assert "0408010010" in codigos_cir
    # Certifica que nenhum exame de sangue (0202) vazou para a fila cirúrgica
    assert not any(c.startswith("0202") for c in codigos_cir)


def test_validar_cbo_endpoint(session):
    # Cria médico e procedimento
    med = Medico(
        nome="Dr. João Cardiologista",
        crm="CRM/MG 12345",
        cbo_codigo="225120",
        ativo=True,
    )
    session.add(med)
    proc = SigtapProcedimento(
        codigo="0211020036",
        descricao="ELETROCARDIOGRAMA",
    )
    cbo = SigtapCbo(
        procedimento_codigo="0211020036",
        cbo="225120",
        descricao="MÉDICO CARDIOLOGISTA",
    )
    session.add(proc)
    session.add(cbo)
    session.commit()
    session.refresh(med)

    payload = ValidarCboIn(
        codigo_procedimento="0211020036",
        medico_id=med.id,
    )
    res = validar_cbo_endpoint(payload=payload, db=session, _=None)
    assert res["compativel"] is True
    assert res["codigo_procedimento"] == "0211020036"
    assert res["exige_cbo_estrito"] is True


def test_seed_vivver_procedimentos(session):
    from app.models.tfd import Especialidade

    res = seed_vivver_procedimentos(session)
    assert res["ok"] is True
    assert res["inseridos"] > 0

    total_procs = session.exec(select(ProcedimentoCatalogo)).all()
    assert len(total_procs) >= res["inseridos"]

    total_tipos = session.exec(select(TipoFila)).all()
    assert len(total_tipos) > 0

    # Especialidades foram populadas e vinculadas aos procedimentos
    total_esps = session.exec(select(Especialidade)).all()
    assert len(total_esps) > 10
    assert any(e.nome == "Cardiologia" for e in total_esps)

    # Procedimentos têm nome_especialidade vinculado
    procs_com_esp = [p for p in total_procs if p.nome_especialidade]
    assert len(procs_com_esp) > 0

    # Idempotência: rodar novamente não deve duplicar
    res2 = seed_vivver_procedimentos(session)
    assert res2["ok"] is True
    assert res2["inseridos"] == 0


def test_catalogo_procedimentos_filtro_por_especialidade(session):
    session.add(ProcedimentoCatalogo(
        codigo="0211020036",
        nome="ELETROCARDIOGRAMA",
        tipo_fila="EXAMES CARDIOLOGICOS",
        nome_especialidade="Cardiologia",
        codigo_especialidade="225120",
        ativo=True,
    ))
    session.add(ProcedimentoCatalogo(
        codigo="0205020186",
        nome="ULTRASSONOGRAFIA DE ABDOMEN TOTAL",
        tipo_fila="ULTRASSONOGRAFIA",
        nome_especialidade="Ultrassonografia / Radiologia",
        codigo_especialidade="225320",
        ativo=True,
    ))
    session.commit()

    # Filtra por especialidade 'Cardiologia'
    res_cardio = catalogo_procedimentos(
        q="",
        tipo_fila="",
        apenas_laboratoriais=None,
        especialidade="Cardiologia",
        db=session,
        _=None,
    )
    assert len(res_cardio) == 1
    assert res_cardio[0]["codigo_procedimento"] == "0211020036"
    assert res_cardio[0]["especialidade"] == "Cardiologia"


def test_buscar_sigtap_automatico_tratamento_excecao(session):
    from fastapi import HTTPException
    from app.api.v1.lab import buscar_sigtap_automatico
    from unittest.mock import MagicMock

    ator = MagicMock(nome="Operador Teste", username="admin")

    # Chamada sem conexão / offline deve levantar 503 com mensagem amigável e link oficial
    with pytest.raises(HTTPException) as excinfo:
        buscar_sigtap_automatico(competencia="2026-10", simular=True, db=session, ator=ator)

    assert excinfo.value.status_code == 503
    assert "portal DATASUS/SIGTAP está temporariamente indisponível" in excinfo.value.detail
    assert "download.jsp" in excinfo.value.detail
    assert "importação manual" in excinfo.value.detail


