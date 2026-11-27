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


def test_geradores_aleatorios_nao_sao_procedurais():
    from datetime import date
    import re
    from app.services.geradores import (
        gerar_exame_curto_aleatorio,
        gerar_numero_pedido_aleatorio,
        gerar_prontuario_aleatorio,
        gerar_protocolo_lab_aleatorio,
    )

    pronts = [gerar_prontuario_aleatorio(None, pac_id=i) for i in range(1, 21)]
    assert all(re.match(r"^PR-\d{6}$", p) for p in pronts)
    # Nunca procedural a partir do ID
    assert "PR-00001" not in pronts
    assert "PR-000001" not in pronts
    assert "1" not in pronts
    # Não sequencial (diferenças não são todas +1)
    nums_pr = [int(p.split("-")[1]) for p in pronts]
    assert len(set(nums_pr)) >= 18
    assert not all(nums_pr[i + 1] - nums_pr[i] == 1 for i in range(len(nums_pr) - 1))

    curtos = [gerar_exame_curto_aleatorio(None, exame_id=i) for i in range(1, 21)]
    assert all(re.match(r"^SL-\d{6}$", c) for c in curtos)
    assert "SL-000001" not in curtos
    nums_sl = [int(c.split("-")[1]) for c in curtos]
    assert len(set(nums_sl)) >= 18

    pedidos = [gerar_numero_pedido_aleatorio(None) for _ in range(20)]
    assert all(re.match(r"^SL-\d{4}-\d{6}$", p) for p in pedidos)
    assert len(set(pedidos)) >= 18

    prots = [gerar_protocolo_lab_aleatorio(date(2026, 11, 20), mestre_id=i) for i in range(1, 21)]
    assert all(re.match(r"^SL-2611-\d{6}$", p) for p in prots)
    assert "SL-2611-000001" not in prots
    assert len(set(prots)) >= 18


def test_reset_pacientes_pec_modo_seguro_e_total():
    import bcrypt
    from datetime import date
    import pytest
    from fastapi import HTTPException
    from sqlalchemy.pool import StaticPool
    from sqlmodel import Session, SQLModel, create_engine, select

    if not hasattr(bcrypt, "__about__"):
        bcrypt.__about__ = type("About", (), {"__version__": getattr(bcrypt, "__version__", "4.0.0")})()

    from app.core.security import hash_password
    from app.models.audit import AuditLog
    from app.models.lab_fase6 import FilaPsf, Laboratorio, SolicitacaoMestre, VagaLab
    from app.models.tfd import ExameFila, Paciente
    from app.models.user import User
    from app.services.pec_sync import (
        obter_preview_reset_pacientes_pec,
        resetar_e_ressincronizar_pacientes_pec,
    )

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    with Session(engine) as db:
        admin = User(
            username="admin_reset_pec",
            password_hash=hash_password("senha_forte_123"),
            is_superuser=True,
            must_change_password=False,
        )
        db.add(admin)

        p1 = Paciente(nome="PACIENTE SEM VINCULO", cpf="11122233344", co_seq_cidadao_pec=101)
        p2 = Paciente(nome="PACIENTE COM FILA", cpf="55566677788", co_seq_cidadao_pec=102)
        db.add_all([p1, p2])
        db.flush()

        lab = Laboratorio(nome="Lab Teste", ativo=True)
        db.add(lab)
        db.flush()
        vaga = VagaLab(laboratorio_id=lab.id, data=date(2026, 11, 20), vagas_totais=10, vagas_ocupadas=1)
        db.add(vaga)

        fp = FilaPsf(
            codigo_solicitacao="SL-2611-482917",
            paciente_id=p2.id,
            especialidade="ROTINA",
            data_solicitacao=date(2026, 11, 10),
        )
        db.add(fp)
        db.flush()
        sm = SolicitacaoMestre(
            codigo_solicitacao="SL-2611-482917",
            paciente_id=p2.id,
            data_agendada=date(2026, 11, 20),
            laboratorio_id=lab.id,
            origem_fila_id=fp.id,
        )
        db.add(sm)
        db.add(ExameFila(paciente_id=p2.id, exame="CARDIO", data_pedido=date(2026, 11, 10)))
        db.commit()

        prev = obter_preview_reset_pacientes_pec(db)
        assert prev["total_pacientes"] == 2
        assert prev["pacientes_sem_vinculo"] == 1
        assert prev["pacientes_com_vinculo"] == 1
        assert "lab_fila_psf" in prev["tabelas_vinculadas"]

        # Senha errada -> 403
        with pytest.raises(HTTPException) as exc:
            resetar_e_ressincronizar_pacientes_pec(
                db,
                limpar_vinculos_operacionais=False,
                disparar_sync=False,
                admin=admin,
                senha="errada",
                confirmacao_explicita=True,
            )
        assert exc.value.status_code == 403

        # Modo seguro: remove p1, preserva p2
        r_seg = resetar_e_ressincronizar_pacientes_pec(
            db,
            limpar_vinculos_operacionais=False,
            disparar_sync=False,
            admin=admin,
            senha="senha_forte_123",
            confirmacao_explicita=True,
        )
        assert r_seg["ok"] is True
        assert r_seg["pacientes_removidos"] == 1
        assert r_seg["pacientes_preservados"] == 1
        assert len(db.exec(select(Paciente)).all()) == 1

        # Modo total: limpa vínculos operacionais, zera vagas e remove p2 também
        r_tot = resetar_e_ressincronizar_pacientes_pec(
            db,
            limpar_vinculos_operacionais=True,
            disparar_sync=False,
            admin=admin,
            senha="senha_forte_123",
            confirmacao_explicita=True,
        )
        assert r_tot["ok"] is True
        assert r_tot["pacientes_removidos"] == 1
        assert len(db.exec(select(Paciente)).all()) == 0
        assert len(db.exec(select(FilaPsf)).all()) == 0
        assert len(db.exec(select(SolicitacaoMestre)).all()) == 0
        assert len(db.exec(select(ExameFila)).all()) == 0
        db.refresh(vaga)
        assert vaga.vagas_ocupadas == 0
        logs = db.exec(select(AuditLog).where(AuditLog.action == "DATA_PEC_RESET_RESYNC")).all()
        assert len(logs) == 2


def test_paciente_mae_pai_e_pec_no_pai():
    """Garante que PacienteIn/Out suportam nascimento, nome_mae e nome_pai e PEC adapta query."""
    from datetime import date
    from app.schemas.tfd import PacienteIn, PacienteOut
    from app.models.tfd import Paciente

    p_in = PacienteIn(
        nome="JOAO DA SILVA",
        nascimento=date(1990, 5, 10),
        nome_mae="MARIA DA SILVA",
        nome_pai="JOSE DA SILVA",
    )
    pac = Paciente(**p_in.model_dump())
    pac.id = 1
    out = PacienteOut.model_validate(pac, from_attributes=True)
    assert out.nascimento == date(1990, 5, 10)
    assert out.nome_mae == "MARIA DA SILVA"
    assert out.nome_pai == "JOSE DA SILVA"

    cols_com_pai = {
        **COLS_BASE_PEC,
        "tb_cidadao": {*COLS_BASE_PEC["tb_cidadao"], "no_pai"},
    }
    sql_com = _construir_query_pec(cols_com_pai)
    sql_sem = _construir_query_pec(COLS_BASE_PEC)
    assert "c.no_pai" in sql_com
    assert "'' AS no_pai" in sql_sem
