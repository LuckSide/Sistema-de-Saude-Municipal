"""Testes de compatibilidade de queries e-SUS PEC 3/4 vs PEC 5+ em pec_sync.py."""

import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from app.services.pec_sync import (
    _construir_query_enderecos_pec,
    _construir_query_pec,
    _resolver_tabela_vinculados_pec,
)


COLS_VINCULADOS_COMPLETO = {
    "co_cidadao",
    "ds_logradouro_domicilio",
    "ds_logradouro_tb_cidadao",
    "nu_numero_domicilio",
    "nu_numero_tb_cidadao",
    "ds_complemento_domicilio",
    "ds_complemento_tb_cidadao",
    "no_bairro_domicilio",
    "no_bairro_tb_cidadao",
    "ds_cep_domicilio",
    "ds_cep_tb_cidadao",
    "no_municipio_domicilio",
    "no_municipio_tb_cidadao",
    "nu_micro_area_domicilio",
    "nu_micro_area_tb_cidadao",
    "nu_cnes_vinc_equipe",
    "nu_ine_vinc_equipe",
    "no_equipe_vinc_equipe",
    "st_mudanca_territorio",
}

COLS_BASE_PEC = {
    "tb_cidadao": {
        "co_seq_cidadao",
        "no_cidadao",
        "nu_cpf",
        "nu_cns",
        "dt_nascimento",
        "st_faleceu",
        "st_ativo",
    },
    "tb_fat_cidadao_pec": {
        "co_seq_fat_cidadao_pec",
        "co_cidadao",
        "co_dim_unidade_saude_vinc",
        "co_dim_equipe_vinc",
        "st_mudou_se",
    },
    "tb_dim_unidade_saude": {"co_seq_dim_unidade_saude", "nu_cnes", "no_unidade_saude"},
    "tb_dim_equipe": {"co_seq_dim_equipe", "nu_ine", "no_equipe"},
}


def test_pec5_usa_tb_ods_cidadaos_vinculados():
    cols = {**COLS_BASE_PEC, "tb_ods_cidadaos_vinculados": COLS_VINCULADOS_COMPLETO}
    tabela, v_cols = _resolver_tabela_vinculados_pec(cols)
    assert tabela == "tb_ods_cidadaos_vinculados"
    assert "nu_cnes_vinc_equipe" in v_cols

    sql_main = _construir_query_pec(cols)
    assert "LEFT JOIN tb_ods_cidadaos_vinculados v ON v.co_cidadao = c.co_seq_cidadao" in sql_main
    assert "tb_acomp_cidadaos_vinculados" not in sql_main
    assert "v.nu_cnes_vinc_equipe" in sql_main
    assert "v.ds_logradouro_domicilio" in sql_main

    sql_end = _construir_query_enderecos_pec(cols)
    assert "LEFT JOIN tb_ods_cidadaos_vinculados v ON v.co_cidadao = c.co_seq_cidadao" in sql_end
    assert "tb_acomp_cidadaos_vinculados" not in sql_end


def test_pec4_legado_usa_tb_acomp_cidadaos_vinculados():
    cols = {**COLS_BASE_PEC, "tb_acomp_cidadaos_vinculados": COLS_VINCULADOS_COMPLETO}
    tabela, _ = _resolver_tabela_vinculados_pec(cols)
    assert tabela == "tb_acomp_cidadaos_vinculados"

    sql_main = _construir_query_pec(cols)
    assert "LEFT JOIN tb_acomp_cidadaos_vinculados v ON v.co_cidadao = c.co_seq_cidadao" in sql_main
    assert "tb_ods_cidadaos_vinculados" not in sql_main

    sql_end = _construir_query_enderecos_pec(cols)
    assert "LEFT JOIN tb_acomp_cidadaos_vinculados v ON v.co_cidadao = c.co_seq_cidadao" in sql_end


def test_fallback_sem_tabela_vinculados_nao_quebra():
    cols = {**COLS_BASE_PEC}
    tabela, v_cols = _resolver_tabela_vinculados_pec(cols)
    assert tabela is None
    assert v_cols == set()

    sql_main = _construir_query_pec(cols)
    assert "tb_ods_cidadaos_vinculados" not in sql_main
    assert "tb_acomp_cidadaos_vinculados" not in sql_main
    assert "v." not in sql_main
    assert "0 AS tem_vinculo_v" in sql_main

    sql_end = _construir_query_enderecos_pec(cols)
    assert "tb_ods_cidadaos_vinculados" not in sql_end
    assert "tb_acomp_cidadaos_vinculados" not in sql_end
    assert "v." not in sql_end


def test_colunas_parciais_em_tb_ods_cidadaos_vinculados():
    cols = {
        **COLS_BASE_PEC,
        "tb_ods_cidadaos_vinculados": {"co_cidadao", "ds_logradouro_domicilio", "nu_cnes_vinc_equipe"},
    }
    sql_main = _construir_query_pec(cols)
    assert "v.ds_logradouro_domicilio" in sql_main
    assert "v.nu_cnes_vinc_equipe" in sql_main
    # Colunas ausentes não devem ser referenciadas na query
    assert "v.ds_logradouro_tb_cidadao" not in sql_main
    assert "v.no_bairro_domicilio" not in sql_main
    assert "v.st_mudanca_territorio" not in sql_main
