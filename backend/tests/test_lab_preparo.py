import pytest
from app.services.lab_preparo import determinar_preparo, obter_preparo_exame


def test_preparo_glicose_e_curva_glicemica():
    # Glicemia de jejum: 8 a 12h
    jejum, instrs, _ = determinar_preparo(["DOSAGEM DE GLICOSE"])
    assert "8 a 12 horas" in jejum
    assert any("8 a 12 horas" in i for i in instrs)
    assert any("72 horas" in i for i in instrs)

    # Curva glicêmica / TOTG: 8 a 12h + permanência no laboratório
    p = obter_preparo_exame("CURVA GLICEMICA (4 DOSAGENS)")
    assert p["id"] == "totg"
    assert "Repouso" in p["badge"]
    assert any("dextrosol" in i for i in p["instrucoes"])


def test_preparo_perfil_lipidico_consenso_sbc():
    # Perfil lipídico / colesterol / triglicérides não exige mais 12h de jejum
    jejum, instrs, _ = determinar_preparo(["COLESTEROL TOTAL", "TRIGLICERIDEOS", "HDL COLESTEROL"])
    assert "4 horas" in jejum
    assert any("Consenso Brasileiro" in i for i in instrs)
    assert any("12 horas não é mais obrigatório" in i for i in instrs)


def test_preparo_psa_prostata():
    p = obter_preparo_exame("ANTIGENO PROSTATICO ESPECIFICO (PSA TOTAL)")
    assert p["id"] == "psa"
    assert "Abstinência sexual" in p["badge"]
    assert any("ejaculação" in i for i in p["instrucoes"])
    assert any("bicicleta" in i for i in p["instrucoes"])
    assert any("toque retal" in i for i in p["instrucoes"])


def test_preparo_tireoide_e_levotiroxina():
    p = obter_preparo_exame("DOSAGEM DE TSH (HORMONIO TIREOESTIMULANTE)")
    assert p["id"] == "tireoide"
    assert "Levotiroxina" in p["badge"]
    assert any("Levotiroxina" in i for i in p["instrucoes"])
    assert any("NÃO tomar o comprimido antes" in i for i in p["instrucoes"])


def test_preparo_prolactina_e_cortisol():
    # Prolactina exige repouso no laboratório
    p_prl = obter_preparo_exame("DOSAGEM DE PROLACTINA")
    assert p_prl["id"] == "prolactina"
    assert any("repouso sentado" in i for i in p_prl["instrucoes"])

    # Cortisol exige coleta matutina rigorosa
    p_cort = obter_preparo_exame("DOSAGEM DE CORTISOL BASAL")
    assert p_cort["id"] == "cortisol"
    assert any("07:00 e 09:00" in i for i in p_cort["instrucoes"])


def test_preparo_urina_e_fezes():
    # Urina tipo 1 isolada não exige jejum alimentar
    jejum_urina, instrs_urina, _ = determinar_preparo(["SUMARIO DE URINA (EAS)"])
    assert "Sem necessidade de jejum" in jejum_urina
    assert any("jato médio" in i for i in instrs_urina)

    # Urina 24h
    p_24h = obter_preparo_exame("CLEARENCE DE CREATININA (URINA DE 24 HORAS)")
    assert p_24h["id"] == "urina_24h"
    assert any("geladeira" in i for i in p_24h["instrucoes"])

    # Sangue oculto nas fezes
    p_so = obter_preparo_exame("PESQUISA DE SANGUE OCULTO NAS FEZES")
    assert p_so["id"] == "sangue_oculto"
    assert any("carne vermelha" in i for i in p_so["instrucoes"])


def test_combinacao_multiplos_exames_diferentes_preparos():
    # Paciente que fará Glicose + PSA + TSH + Hemograma + Urina EAS
    exames = [
        "DOSAGEM DE GLICOSE",
        "ANTIGENO PROSTATICO ESPECIFICO (PSA TOTAL)",
        "DOSAGEM DE TSH",
        "HEMOGRAMA COMPLETO",
        "SUMARIO DE URINA (EAS)",
    ]
    jejum, instrs, orient = determinar_preparo(exames)

    # O jejum deve ser o maior necessário (8 a 12h da glicose)
    assert "8 a 12 horas" in jejum

    # Deve conter os cuidados de todos os exames envolvidos
    assert any("ejaculação" in i for i in instrs)  # PSA
    assert any("Levotiroxina" in i for i in instrs)  # TSH
    assert any("jato médio" in i for i in instrs)  # Urina
    assert any("8 a 12 horas" in i for i in instrs)  # Glicose
    assert len(orient) >= 3
