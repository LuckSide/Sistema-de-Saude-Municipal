import io
import os
import struct
import tempfile
import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.integracoes import IntegrationSettings
from app.models.lab_exames import SigtapProcedimento, SigtapVersao
from app.models import tfd  # noqa: F401
from app.services.sia_sync import (
    descobrir_pacotes_sia_ftp,
    importar_tabela_sia,
    iterar_dbf,
)


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        cfg = IntegrationSettings(id=1)
        s.add(cfg)
        s.commit()
        yield s


def _create_dbf(fields, rows):
    record_len = 1 + sum(f[2] for f in fields)
    header_len = 32 + len(fields) * 32 + 1
    num_records = len(rows)
    buf = io.BytesIO()
    buf.write(struct.pack("<BBBBIHH", 3, 26, 11, 23, num_records, header_len, record_len))
    buf.write(b"\x00" * 20)
    for name, typ, length, dec in fields:
        name_bytes = name.encode("ascii")[:11].ljust(11, b"\x00")
        fld = name_bytes + typ.encode("ascii") + b"\x00" * 4 + bytes([length, dec]) + b"\x00" * 14
        buf.write(fld)
    buf.write(b"\x0D")

    for row in rows:
        buf.write(b" ")
        for name, typ, length, dec in fields:
            val = str(row.get(name, "")).encode("latin-1")[:length].ljust(length, b" ")
            buf.write(val)
    buf.write(b"\x1A")
    return buf.getvalue()


def test_iterar_dbf_parse():
    fields = [
        ("PA_ID", "C", 9, 0),
        ("PA_DV", "C", 1, 0),
        ("PA_DC", "C", 60, 0),
        ("PA_SA", "N", 12, 2),
        ("PA_CMP", "C", 6, 0),
    ]
    rows = [
        {"PA_ID": "020201018", "PA_DV": "0", "PA_DC": "COLESTEROL TOTAL", "PA_SA": "3.51", "PA_CMP": "202611"},
        {"PA_ID": "020201020", "PA_DV": "1", "PA_DC": "GLICEMIA DE JEJUM", "PA_SA": "1.85", "PA_CMP": "202611"},
    ]
    data = _create_dbf(fields, rows)
    with tempfile.NamedTemporaryFile(suffix=".dbf", delete=False) as f:
        f.write(data)
        f.flush()
        f_name = f.name

    try:
        registros = list(iterar_dbf(f_name))
        assert len(registros) == 2
        assert registros[0]["PA_ID"] == "020201018"
        assert registros[0]["PA_DV"] == "0"
        assert registros[0]["PA_DC"] == "COLESTEROL TOTAL"
        assert registros[0]["PA_SA"] == "3.51"
        assert registros[1]["PA_ID"] == "020201020"
    finally:
        if os.path.exists(f_name):
            os.remove(f_name)


def test_importar_tabela_sia_e_preservar_customizacoes(session):
    """Testa que a importação do SIA atualiza valores oficiais mas preserva

    estritamente o valor_combinado e os tipos_fila_permitidos locais.
    """
    # 1. Cria procedimento prévio com customizações locais de Guapé
    p_existente = SigtapProcedimento(
        codigo="0202010180",
        descricao="COLESTEROL TOTAL (NOME ANTIGO)",
        complexidade="MC",
        instrumento="BPA-C",
        valor_sa=2.00,
        valor_sp=0.00,
        valor_sh=0.00,
        valor_combinado=8.50,  # Preço acordado no laboratório conveniado
        tipos_fila_permitidos="rotina,urgencia",  # Restrito a rotina e urgência
        competencia="2026-10",
    )
    session.add(p_existente)
    session.commit()

    # 2. Cria DBFs simulados do SIA (S_PROCED e S_PA)
    fields_proced = [
        ("PA_ID", "C", 9, 0),
        ("PA_DV", "C", 1, 0),
        ("PA_DC", "C", 60, 0),
        ("PA_CPX", "C", 4, 0),
        ("PA_TPREG", "C", 10, 0),
        ("PA_SEXO", "C", 1, 0),
        ("PA_IDADEMN", "N", 3, 0),
        ("PA_IDADEMX", "N", 3, 0),
        ("PA_QTDMAX", "N", 6, 0),
        ("PA_SA", "N", 12, 2),
        ("PA_SP", "N", 12, 2),
        ("PA_SH", "N", 12, 2),
        ("PA_CMP", "C", 6, 0),
    ]
    rows_proced = [
        {
            "PA_ID": "020201018",
            "PA_DV": "0",
            "PA_DC": "DOSAGEM DE COLESTEROL TOTAL",
            "PA_CPX": "2",
            "PA_TPREG": "01",
            "PA_SEXO": "A",
            "PA_IDADEMN": "0",
            "PA_IDADEMX": "130",
            "PA_QTDMAX": "99",
            "PA_SA": "3.51",  # Novo valor oficial SUS
            "PA_SP": "0.00",
            "PA_SH": "0.00",
            "PA_CMP": "202611",
        },
        {
            "PA_ID": "020201020",
            "PA_DV": "1",
            "PA_DC": "DOSAGEM DE GLICOSE",
            "PA_CPX": "2",
            "PA_TPREG": "01",
            "PA_SEXO": "A",
            "PA_IDADEMN": "0",
            "PA_IDADEMX": "130",
            "PA_QTDMAX": "99",
            "PA_SA": "1.85",
            "PA_SP": "0.00",
            "PA_SH": "0.00",
            "PA_CMP": "202611",
        },
    ]

    fields_pa = [
        ("PA_ID", "C", 9, 0),
        ("PA_DV", "C", 1, 0),
        ("PA_DOC", "C", 1, 0),
        ("PA_IDEBPA", "C", 1, 0),
        ("PA_CMP", "C", 6, 0),
    ]
    rows_pa = [
        {"PA_ID": "020201018", "PA_DV": "0", "PA_DOC": "B", "PA_IDEBPA": "N", "PA_CMP": "202611"},
        {"PA_ID": "020201020", "PA_DV": "1", "PA_DOC": "B", "PA_IDEBPA": "S", "PA_CMP": "202611"},
    ]

    proced_bytes = _create_dbf(fields_proced, rows_proced)
    pa_bytes = _create_dbf(fields_pa, rows_pa)

    with tempfile.TemporaryDirectory() as tmp_dir:
        proced_path = os.path.join(tmp_dir, "S_PROCED.DBF")
        pa_path = os.path.join(tmp_dir, "S_PA.DBF")
        with open(proced_path, "wb") as f:
            f.write(proced_bytes)
        with open(pa_path, "wb") as f:
            f.write(pa_bytes)

        stats = importar_tabela_sia(
            db=session,
            proced_dbf_path=proced_path,
            pa_dbf_path=pa_path,
            competencia="2026-11",
            nome_arquivo="BDSIA202611a.exe",
            usuario="Auditor Testes",
            simular=False,
        )

        assert stats["total"] == 2
        assert stats["inseridos"] == 1
        assert stats["atualizados"] == 1
        assert stats["preservados_valor_combinado"] == 1
        assert stats["preservados_tipos_fila"] == 1

        # 3. Verifica se as customizações locais foram preservadas
        proc_atualizado = session.exec(
            select(SigtapProcedimento).where(SigtapProcedimento.codigo == "0202010180")
        ).first()
        assert proc_atualizado is not None
        assert proc_atualizado.descricao == "DOSAGEM DE COLESTEROL TOTAL"
        assert proc_atualizado.valor_sa == 3.51
        assert proc_atualizado.valor_combinado == 8.50  # PRESERVADO!
        assert proc_atualizado.tipos_fila_permitidos == "rotina,urgencia"  # PRESERVADO!
        assert proc_atualizado.instrumento == "BPA-C"

        # 4. Verifica procedimento inserido
        proc_novo = session.exec(
            select(SigtapProcedimento).where(SigtapProcedimento.codigo == "0202010201")
        ).first()
        assert proc_novo is not None
        assert proc_novo.descricao == "DOSAGEM DE GLICOSE"
        assert proc_novo.valor_sa == 1.85
        assert proc_novo.instrumento == "BPA-I"  # PA_IDEBPA == 'S' -> BPA-I

        # 5. Verifica versão registrada em sigtap_versoes
        versao = session.exec(
            select(SigtapVersao).where(SigtapVersao.competencia == "2026-11", SigtapVersao.origem == "sia_ftp")
        ).first()
        assert versao is not None
        assert versao.origem == "sia_ftp"
        assert versao.arquivo == "BDSIA202611a.exe"
        assert versao.total_proc == 2
        assert versao.usuario == "Auditor Testes"


def test_executar_sync_automatica_sia_sem_novidade(session, monkeypatch):
    """Verifica que se a competência já foi importada, retorna SEM_NOVIDADE e não reimporta desnecessariamente."""
    versao_existente = SigtapVersao(
        competencia="2026-11",
        origem="sia_ftp",
        arquivo="BDSIA202611a.exe",
        total_proc=100,
        inseridos=100,
        atualizados=0,
    )
    session.add(versao_existente)
    session.commit()

    monkeypatch.setattr(
        "app.services.sia_sync.descobrir_pacotes_sia_ftp",
        lambda competencia=None: [{"competencia": "2026-11", "arquivo": "BDSIA202611a.exe", "ano": 2026, "mes": 11, "rev": "a"}],
    )

    from app.services.sia_sync import executar_sync_automatica_sia

    res = executar_sync_automatica_sia(session, competencia="2026-11", forcar=False)
    assert res["ok"] is True
    assert res["status"] == "SEM_NOVIDADE"
    assert "já importada" in res["mensagem"]

    cfg = session.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
    assert cfg.sia_sync_ultimo_status == "SEM_NOVIDADE"
    assert cfg.sia_sync_ultima_competencia == "2026-11"


def test_api_lab_sia_endpoints(session, monkeypatch):
    """Testa os endpoints de status e execução da Tabela SIA."""
    from app.api.v1.lab import status_auto_sync_sia, atualizar_config_auto_sync_sia, SiaAutoSyncConfigIn, executar_auto_sync_sia_agora

    class MockUser:
        id = 1
        username = "admin"
        nome = "Administrador"

    st = status_auto_sync_sia(db=session, _=MockUser())
    assert "sia_sync_automatica" in st
    assert st["sia_sync_automatica"] is True

    # Atualiza configuração
    up = atualizar_config_auto_sync_sia(SiaAutoSyncConfigIn(sia_sync_automatica=False), db=session, _=MockUser())
    assert up["ok"] is True
    assert up["sia_sync_automatica"] is False

    # Executa com mock do sync
    monkeypatch.setattr(
        "app.services.sia_sync.executar_sync_automatica_sia",
        lambda db, competencia=None, usuario=None, forcar=False: {"ok": True, "status": "SUCESSO", "competencia": "2026-11"},
    )
    res_exec = executar_auto_sync_sia_agora(competencia="2026-11", forcar=True, db=session, ator=MockUser())
    assert res_exec["ok"] is True
    assert res_exec["status"] == "SUCESSO"


def test_sia_sync_sexo_respeita_limite_varchar10(session):
    """Garante que valores não-M/F em PA_SEXO (ex: 'I', '', 'N') respeitam VARCHAR(10) no PostgreSQL."""
    fields_proced = [
        ("PA_ID", "C", 9, 0),
        ("PA_DV", "C", 1, 0),
        ("PA_DC", "C", 40, 0),
        ("PA_CPX", "C", 1, 0),
        ("PA_TPREG", "C", 4, 0),
        ("PA_SEXO", "C", 1, 0),
        ("PA_IDADEMN", "N", 3, 0),
        ("PA_IDADEMX", "N", 3, 0),
        ("PA_QTDMAX", "N", 3, 0),
        ("PA_SA", "N", 8, 2),
        ("PA_SP", "N", 8, 2),
        ("PA_SH", "N", 8, 2),
        ("PA_CMP", "C", 6, 0),
    ]
    rows_proced = [
        {
            "PA_ID": "030101007",
            "PA_DV": "2",
            "PA_DC": "CONSULTA MEDICA EM ATENCAO ESPECIALIZADA",
            "PA_CPX": "2",
            "PA_TPREG": "02",
            "PA_SEXO": "I",
            "PA_IDADEMN": "0",
            "PA_IDADEMX": "130",
            "PA_QTDMAX": "10",
            "PA_SA": "10.00",
            "PA_SP": "0.00",
            "PA_SH": "0.00",
            "PA_CMP": "202611",
        },
        {
            "PA_ID": "020201029",
            "PA_DV": "5",
            "PA_DC": "DOSAGEM DE CREATININA",
            "PA_CPX": "2",
            "PA_TPREG": "01",
            "PA_SEXO": "",
            "PA_IDADEMN": "0",
            "PA_IDADEMX": "130",
            "PA_QTDMAX": "99",
            "PA_SA": "1.85",
            "PA_SP": "0.00",
            "PA_SH": "0.00",
            "PA_CMP": "202611",
        },
    ]
    proced_bytes = _create_dbf(fields_proced, rows_proced)
    with tempfile.TemporaryDirectory() as tmp_dir:
        proced_path = os.path.join(tmp_dir, "S_PROCED.DBF")
        with open(proced_path, "wb") as f:
            f.write(proced_bytes)
        stats = importar_tabela_sia(
            db=session,
            proced_dbf_path=proced_path,
            pa_dbf_path=None,
            competencia="2026-11",
            nome_arquivo="BDSIA202611a.exe",
            usuario="Teste",
            simular=False,
        )
        assert stats["total"] == 2
        for p in session.exec(select(SigtapProcedimento)).all():
            assert len(p.sexo) <= 10
            assert len(p.instrumento) <= 10
            assert len(p.competencia) <= 7
            assert p.sexo == "Ambos"

