import io
import zipfile
from datetime import date, datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import event
from sqlmodel import SQLModel, Session, create_engine, select

from app.api.v1.lab import arvore_sigtap, listar_cbos_sigtap, listar_sigtap
from app.api.v1.tfd import (
    catalogo_procedimentos,
    criar_especialidade,
    especialidades_por_cbo,
    filtros_opcoes,
    listar_especialidades,
    listar_exames,
    perfil_paciente,
    unificar_especialidades_duplicadas,
)
from app.models.audit import AuditLog
from app.models.cadastros_saude import UnidadeSaude
from app.models.integracoes import IntegrationSettings
from app.models.lab_exames import (
    SigtapCbo,
    SigtapFormaOrganizacao,
    SigtapGrupo,
    SigtapOcupacao,
    SigtapProcedimento,
    SigtapSubgrupo,
    SigtapVersao,
)
from app.models.settings import SystemSettings
from app.models.tfd import (
    Especialidade,
    ExameFila,
    Paciente,
    PacienteHistorico,
    ProcedimentoCatalogo,
    ViagemFila,
)
from app.models.user import User
from app.schemas.tfd import EspecialidadeIn
from app.services.cbo_normalizacao import (
    comparar_nomes_cbo,
    normalizar_fonetica_pt,
    sanitizar_texto_cbo,
    unificar_cbos_duplicados,
)
from app.services.pec_sync import aplicar_baixa_automatica_paciente, classificar_situacao_pec
from app.services.sigtap_hierarquia import obter_arvore_sigtap, seed_arvore_sigtap
from app.services.sigtap_import import importar_sigtap
from app.services import sigtap_sync


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def _sqlite_funcs(dbapi_connection, connection_record):
        if hasattr(dbapi_connection, "create_function"):
            def sqlite_to_char(val, fmt):
                if not val:
                    return ""
                s = str(val)
                if fmt == "YYYY-MM":
                    return s[:7]
                if fmt == "YYYY-MM-DD":
                    return s[:10]
                if fmt == "YYYY":
                    return s[:4]
                return s

            dbapi_connection.create_function("to_char", 2, sqlite_to_char)

    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        yield db


def _ator_admin():
    return User(id=1, nome="Admin Teste", email="admin@guape.mg.gov.br", is_superuser=True, ativo=True)


def _zip_sigtap_exemplo() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "tb_grupo.txt",
            "02PROCEDIMENTOS COM FINALIDADE DIAGNOSTICA\n"
            "03PROCEDIMENTOS CLINICOS\n",
        )
        zf.writestr(
            "tb_sub_grupo.txt",
            "0205DIAGNOSTICO POR ULTRASSONOGRAFIA\n"
            "0301CONSULTAS / ATENDIMENTOS / ACOMPANHAMENTOS\n",
        )
        zf.writestr(
            "tb_forma_organizacao.txt",
            "020501ULTRASSONOGRAFIA CARDIOVASCULAR\n"
            "030101CONSULTAS MEDICAS\n",
        )
        zf.writestr(
            "tb_ocupacao.txt",
            "225120Medico cardiologista\n"
            "225165Medico gastroenterologista\n",
        )
        # Formato posicional padrão SIGTAP para tb_procedimento (len >= 318: co[0:10], no[10:260], comp[260], sexo[261], campos numéricos[262:318])
        linha_p1 = (
            "0205010032"
            + "ECOCARDIOGRAFIA TRANSTORACICA".ljust(250)
            + "2"
            + "I"
            + "0" * 56
        )
        linha_p2 = (
            "0301010072"
            + "CONSULTA MEDICA EM ATENCAO ESPECIALIZADA".ljust(250)
            + "2"
            + "I"
            + "0" * 56
        )
        zf.writestr("tb_procedimento.txt", f"{linha_p1}\n{linha_p2}\n")
        zf.writestr(
            "rl_procedimento_ocupacao.txt",
            "0205010032225120\n"
            "0301010072225120\n"
            "0301010072225165\n",
        )
    return buf.getvalue()


# ==============================================================================
# 1. Baixa Automática por Óbito ou Mudança de Município (e-SUS PEC)
# ==============================================================================
def test_req1_classificacao_e_baixa_automatica_pec(session):
    # Classificação de situações do PEC
    sit_ob, det_ob, dt_ob = classificar_situacao_pec(
        {"st_faleceu_pec": 1, "dt_obito_pec": "2026-04-02", "no_municipio": "GUAPE"}
    )
    assert sit_ob == "obito"
    assert dt_ob == date(2026, 4, 2)
    assert "Óbito" in det_ob

    sit_mud, det_mud, _ = classificar_situacao_pec(
        {"ds_tipo_saida_pec": "Mudança de Território", "no_municipio": "Guapé"},
        municipio_sede="Guapé",
    )
    assert sit_mud == "mudanca_municipio"
    assert "Mudança de Município" in det_mud

    sit_outro_mun, _, _ = classificar_situacao_pec(
        {"no_municipio": "Boa Esperança"},
        municipio_sede="Guapé",
    )
    assert sit_outro_mun == "mudanca_municipio"

    sit_ok, _, _ = classificar_situacao_pec(
        {"st_faleceu_pec": 0, "no_municipio": "Guapé"},
        municipio_sede="Guapé",
    )
    assert sit_ok == "ativo"

    # Cria paciente com 2 pedidos ativos na fila, 1 já realizado, e 1 na fila de viagem
    pac = Paciente(nome="José da Silva", cpf="11122233344", nascimento=date(1950, 5, 10))
    session.add(pac)
    session.commit()
    session.refresh(pac)

    ex_aguard = ExameFila(
        paciente_id=pac.id,
        tipo_fila="EXAMES ESPECIALIZADOS",
        exame="ECOCARDIOGRAFIA TRANSTORACICA",
        status="aguardando",
        prioridade="rotina",
        data_pedido=date(2026, 3, 10),
        ativo=True,
    )
    ex_agend = ExameFila(
        paciente_id=pac.id,
        tipo_fila="CONSULTAS ESPECIALIZADAS",
        exame="CONSULTA MEDICA EM ATENCAO ESPECIALIZADA",
        especialidade="Médico Cardiologista",
        codigo_especialidade="225120",
        status="agendado",
        prioridade="urgente",
        data_pedido=date(2026, 3, 15),
        ativo=True,
    )
    ex_realizado = ExameFila(
        paciente_id=pac.id,
        tipo_fila="EXAMES ESPECIALIZADOS",
        exame="ELETROCARDIOGRAMA",
        status="realizado",
        prioridade="rotina",
        data_pedido=date(2026, 1, 10),
        ativo=True,
    )
    vf = ViagemFila(
        paciente_id=pac.id,
        especialidade="Cardiologia",
        destino="Alfenas",
        status="aguardando",
    )
    session.add_all([ex_aguard, ex_agend, ex_realizado, vf])
    session.commit()

    qtd_baixados = aplicar_baixa_automatica_paciente(
        session,
        pac,
        "obito",
        "Óbito identificado no e-SUS PEC em 02/04/2026.",
        data_obito=date(2026, 4, 2),
    )
    session.commit()

    assert qtd_baixados == 2
    session.refresh(pac)
    session.refresh(ex_aguard)
    session.refresh(ex_agend)
    session.refresh(ex_realizado)
    session.refresh(vf)

    assert pac.situacao_cadastral == "obito"
    assert pac.data_obito == date(2026, 4, 2)
    assert ex_aguard.ativo is False and ex_aguard.status == "cancelado"
    assert ex_agend.ativo is False and ex_agend.status == "cancelado"
    # Histórico de realizados permanece intacto
    assert ex_realizado.ativo is True and ex_realizado.status == "realizado"
    assert vf.status == "cancelado"

    # Prontuário e histórico exibidos no endpoint perfil_paciente
    perfil = perfil_paciente(pac.id, db=session, _=_ator_admin())
    assert perfil.paciente.situacao_cadastral == "obito"
    assert len(perfil.historico) == 1
    assert perfil.historico[0].tipo_evento == "OBITO_PEC"
    assert perfil.historico[0].exames_baixados_qtd == 2
    assert len(session.exec(select(AuditLog).where(AuditLog.action == "EXAM_REMOVE_AUTO")).all()) == 2


# ==============================================================================
# 2. Filtros Avançados de Idade na Fila de Exames
# ==============================================================================
def test_req2_filtro_avancado_idade_fila_exames(session):
    hoje = date.today()
    nasc_crianca = date(hoje.year - 8, 1, 15)
    nasc_adulto = date(hoje.year - 35, 1, 15)
    nasc_idoso = date(hoje.year - 72, 1, 15)

    p1 = Paciente(nome="Criança Teste", nascimento=nasc_crianca)
    p2 = Paciente(nome="Adulto Teste", nascimento=nasc_adulto)
    p3 = Paciente(nome="Idoso Teste", nascimento=nasc_idoso)
    session.add_all([p1, p2, p3])
    session.commit()
    for p in (p1, p2, p3):
        session.refresh(p)
        session.add(
            ExameFila(
                paciente_id=p.id,
                tipo_fila="CONSULTAS ESPECIALIZADAS",
                exame="CONSULTA ESPECIALIZADA",
                status="aguardando",
                prioridade="rotina",
                data_pedido=hoje,
                ativo=True,
            )
        )
    session.commit()

    ator = _ator_admin()
    res_idosos = listar_exames(status_="aguardando", idade_min=60, db=session, ator=ator)
    assert res_idosos["total"] == 1
    assert res_idosos["data"][0].paciente_nome == "Idoso Teste"

    res_criancas = listar_exames(status_="aguardando", idade_max=17, db=session, ator=ator)
    assert res_criancas["total"] == 1
    assert res_criancas["data"][0].paciente_nome == "Criança Teste"

    res_adultos = listar_exames(status_="aguardando", idade_min=20, idade_max=50, db=session, ator=ator)
    assert res_adultos["total"] == 1
    assert res_adultos["data"][0].paciente_nome == "Adulto Teste"


# ==============================================================================
# 3. Filtro de Especialidades Vinculado ao CBO
# ==============================================================================
def test_req3_filtro_especialidades_vinculado_ao_cbo(session):
    session.add_all([
        Especialidade(codigo_cbo="225120", nome="Médico Cardiologista", ativo=True),
        Especialidade(codigo_cbo="225165", nome="Médico Gastroenterologista", ativo=True),
        Especialidade(codigo_cbo="225270", nome="Médico Ortopedista", ativo=True),
        SigtapOcupacao(cbo="225120", descricao="Médico cardiologista", ativo=True),
        SigtapOcupacao(cbo="225165", descricao="Médico gastroenterologista", ativo=True),
        SigtapProcedimento(codigo="0205010032", descricao="ECOCARDIOGRAFIA TRANSTORACICA", grupo_codigo="02", subgrupo_codigo="0205"),
        SigtapCbo(procedimento_codigo="0205010032", cbo="225120", descricao="Médico cardiologista"),
        SigtapCbo(procedimento_codigo="0209010037", cbo="225165", descricao="Médico gastroenterologista"),
    ])
    pac = Paciente(nome="Paciente Filtro CBO", nascimento=date(1975, 4, 20))
    session.add(pac)
    session.commit()
    session.refresh(pac)

    session.add_all([
        ExameFila(
            paciente_id=pac.id,
            tipo_fila="CONSULTAS ESPECIALIZADAS",
            exame="CONSULTA CARDIOLOGIA",
            especialidade="Médico Cardiologista",
            codigo_especialidade="225120",
            status="aguardando",
            ativo=True,
        ),
        ExameFila(
            paciente_id=pac.id,
            tipo_fila="CONSULTAS ESPECIALIZADAS",
            exame="CONSULTA GASTRO",
            especialidade="Médico Gastroenterologista",
            codigo_especialidade="225165",
            status="aguardando",
            ativo=True,
        ),
    ])
    session.commit()

    # listar_especialidades com cbo deve retornar somente a especialidade do CBO informado
    res_esps = listar_especialidades(cbo="225120", db=session)
    assert res_esps["total"] == 1
    assert res_esps["data"][0].codigo_cbo == "225120"

    # /cbo-especialidades retorna especialidade + áreas/subgrupos SIGTAP autorizados
    det_cbo = especialidades_por_cbo(cbo="225120", db=session)
    assert det_cbo["cbo"] == "225120"
    assert len(det_cbo["especialidades"]) == 1
    assert det_cbo["especialidades"][0]["nome"] == "Médico Cardiologista"
    assert any(a["codigo"] == "02" for a in det_cbo["areas"])
    assert any(s["codigo"] == "0205" for s in det_cbo["subgrupos"])

    # filtros_opcoes com cbo restringe especialidades e procedimentos ao CBO escolhido
    opcoes = filtros_opcoes(status_="aguardando", cbo="225165", db=session)
    assert len(opcoes.cbos) == 2
    assert len(opcoes.especialidades) == 1
    assert opcoes.especialidades[0].value == "225165"
    assert len(opcoes.procedimentos) == 1
    assert "GASTRO" in opcoes.procedimentos[0].value


# ==============================================================================
# 4. Árvore SIGTAP Completa e Busca Automática DATASUS
# ==============================================================================
def test_req4_arvore_sigtap_e_auto_sync_datasus(session, monkeypatch):
    seed_arvore_sigtap(session)
    raw_zip = _zip_sigtap_exemplo()

    res_imp = importar_sigtap(
        session,
        [("tabela_sigtap.zip", raw_zip)],
        "2026-04",
        "Tester",
        simular=False,
        origem="upload",
    )
    assert res_imp["processados"] == 2
    assert res_imp["inseridos"] == 2

    proc_eco = session.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == "0205010032")).first()
    assert proc_eco is not None
    assert proc_eco.grupo_codigo == "02"
    assert proc_eco.subgrupo_codigo == "0205"
    assert proc_eco.forma_organizacao_codigo == "020501"

    # Árvore via service e endpoint /lab/sigtap/arvore
    arvore = arvore_sigtap(grupo_codigo="02", subgrupo_codigo="0205", db=session)
    assert any(g["codigo"] == "02" for g in arvore["grupos"])
    assert all(s["codigo"].startswith("02") for s in arvore["subgrupos"])
    assert any(c["cbo"] == "225120" for c in arvore["cbos"])

    # Filtro de listagem SIGTAP e catálogo por Área + Subgrupo + CBO
    listagem = listar_sigtap(grupo_codigo="02", subgrupo_codigo="0205", cbo="225120", db=session)
    assert listagem["total"] == 1
    assert listagem["data"][0].codigo == "0205010032"

    cat = catalogo_procedimentos(grupo_codigo="02", subgrupo_codigo="0205", cbo="225120", db=session)
    assert any(item["codigo_procedimento"] == "0205010032" for item in cat)
    assert not any(item["codigo_procedimento"] == "0301010072" for item in cat)

    # Rotina agendada automática DATASUS (com download mockado)
    session.add(IntegrationSettings(id=1, sigtap_sync_automatica=True, sigtap_sync_intervalo_horas=24))
    session.commit()

    monkeypatch.setattr(
        sigtap_sync,
        "baixar_tabela_unificada_datasus",
        lambda competencia=None, timeout=120: ("2026-05", "TabelaUnificada_202605.zip", raw_zip),
    )

    r1 = sigtap_sync.executar_sync_automatica_sigtap(session)
    assert r1["ok"] is True
    assert r1["status"] == "SUCESSO"
    assert r1["competencia"] == "2026-05"

    cfg = session.get(IntegrationSettings, 1)
    assert cfg.sigtap_sync_ultimo_status == "SUCESSO"
    assert cfg.sigtap_sync_ultima_competencia == "2026-05"

    # Segunda execução sem alteração de competência reconhece já sincronizada
    r2 = sigtap_sync.executar_sync_automatica_sigtap(session)
    assert r2["ok"] is True
    assert r2["status"] == "SEM_NOVIDADE"


# ==============================================================================
# 5. Normalização e Deduplicação de CBOs
# ==============================================================================
def test_req5_normalizacao_e_deduplicacao_cbos(session):
    # Acentuação, gênero e variação ortográfica ("gastrologista" vs "gastrolojista" vs "gastroenterologista")
    assert sanitizar_texto_cbo("Médico  Gastrolojista!!") == "medico gastrolojista"
    assert normalizar_fonetica_pt("Gastrolojista") == normalizar_fonetica_pt("Gastrologista")
    assert comparar_nomes_cbo("médico gastrologista", "Médico Gastroenterologista") >= 0.88
    assert comparar_nomes_cbo("Mediko Cardeologista", "Médico Cardiologista") >= 0.88

    # Criação impede duplicatas semânticas / mesmo CBO, mas permite especialidades distintas sem CBO
    e1 = criar_especialidade(
        EspecialidadeIn(codigo_cbo="225165", nome="Médico Gastroenterologista", ativo=True),
        db=session,
    )
    assert e1.id is not None

    with pytest.raises(HTTPException) as exc:
        criar_especialidade(
            EspecialidadeIn(codigo_cbo="", nome="medico gastrolojista", ativo=True),
            db=session,
        )
    assert exc.value.status_code == 400

    # Especialidades distintas com CBO vazio continuam permitidas (compatibilidade)
    e_fisio = criar_especialidade(EspecialidadeIn(codigo_cbo="", nome="Fisioterapia", ativo=True), db=session)
    e_fono = criar_especialidade(EspecialidadeIn(codigo_cbo="", nome="Fonoaudiologia", ativo=True), db=session)
    assert e_fisio.id != e_fono.id

    # Simula registros legados duplicados no banco + referência na fila e catálogo e roda unificação
    dup1 = Especialidade(codigo_cbo="225120", nome="Médico Cardiologista", ativo=True)
    dup2 = Especialidade(codigo_cbo="", nome="médico cardeologista", ativo=True)
    dup3 = Especialidade(codigo_cbo="225120", nome="Cardiologista", ativo=True)
    session.add_all([dup1, dup2, dup3])
    session.commit()
    for d in (dup1, dup2, dup3):
        session.refresh(d)

    proc = ProcedimentoCatalogo(
        codigo="0211020036",
        nome="ELETROCARDIOGRAMA",
        tipo_fila="EXAMES ESPECIALIZADOS",
        codigo_especialidade="225120",
        nome_especialidade="médico cardeologista",
    )
    session.add(proc)
    session.commit()

    # SigtapCbo duplicado para mesma tupla (procedimento_codigo, cbo)
    session.add_all([
        SigtapCbo(procedimento_codigo="0211020036", cbo="225120", descricao="Médico cardiologista"),
        SigtapCbo(procedimento_codigo="0211020036", cbo="225120", descricao="Médico cardiologista"),
    ])
    session.commit()

    res_unif = unificar_especialidades_duplicadas(db=session)
    assert res_unif["especialidades_mescladas"] >= 2
    assert res_unif["sigtap_cbos_removidos"] == 1

    cards = [
        e for e in session.exec(select(Especialidade)).all()
        if e.codigo_cbo == "225120" or "cardio" in e.nome.lower() or "cardeo" in e.nome.lower()
    ]
    assert len(cards) == 1
    assert cards[0].codigo_cbo == "225120"

    cbos_listados = listar_cbos_sigtap(q="gastrolojista", db=session, limit=100)
    assert any(item["cbo"] == "225165" for item in cbos_listados)
