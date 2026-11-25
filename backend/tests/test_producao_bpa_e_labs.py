"""Testes abrangentes das melhorias de Produção Ambulatorial (BPA-C/BPA-I), SIGTAP/SIA e Laboratórios."""

from datetime import date
import io
import json
import struct
import zipfile

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.v1.lab_fase6 import get_current_user as get_lab_current_user
from app.core.deps import get_current_user, get_db
from app.main import app
from app.models.cadastros_saude import EquipeSaude, Medico, UnidadeSaude
from app.models.integracoes import IntegrationSettings
from app.models.lab_exames import SigtapCid, SigtapProcedimento
from app.models.lab_fase6 import (
    FilaPsf,
    Laboratorio,
    LabContrato,
    LabContratoPrecoCustomizado,
    LabFeriadoBloqueio,
    LabFPOCompetencia,
    LabFPOItem,
    LabLoteArtefato,
    LabLoteItem,
    LabLoteLiberacao,
    LabPedidoAjuste,
    LabResultadoArquivo,
    SolicitacaoMestre,
    VagaLab,
)
from app.models.producao_ambulatorial import ProducaoAmbulatorial
from app.models.settings import SystemSettings
from app.models.tfd import Paciente
from app.models.user import User
from app.services.bpa_export_service import gerar_bpa_completo_municipio
from app.services.lab_fase6 import (
    criar_solicitacao_mestre,
    enriquecer_mestre,
    gerar_comprovante_agendamento,
)
from app.services.sia_sync import importar_tabela_sia
from app.services.sigtap_import import importar_sigtap


def _criar_dbf(fields: list[tuple[str, str, int, int]], rows: list[dict]) -> bytes:
    record_len = 1 + sum(f[2] for f in fields)
    header_len = 32 + len(fields) * 32 + 1
    num_records = len(rows)
    buf = io.BytesIO()
    buf.write(struct.pack("<BBBBIHH", 3, 26, 11, 25, num_records, header_len, record_len))
    buf.write(b"\x00" * 20)
    for name, typ, length, dec in fields:
        name_bytes = name.encode("ascii")[:11].ljust(11, b"\x00")
        fld = name_bytes + typ.encode("ascii") + b"\x00" * 4 + bytes([length, dec]) + b"\x00" * 14
        buf.write(fld)
    buf.write(b"\x0D")
    for row in rows:
        buf.write(b" ")
        for name, _typ, length, _dec in fields:
            val = str(row.get(name, "")).encode("latin-1")[:length].ljust(length, b" ")
            buf.write(val)
    buf.write(b"\x1A")
    return buf.getvalue()


@pytest.fixture
def ctx():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(IntegrationSettings(id=1))
        session.add(SystemSettings(id=1))

        unidade = UnidadeSaude(nome="UBS Centro", cnes="2146479", tipo="UBS", ativo=True)
        session.add(unidade)
        session.flush()

        equipe = EquipeSaude(
            unidade_saude_id=unidade.id,
            nome_equipe="ESF 01 Centro",
            ine="0001234567",
            ativo=True,
        )
        session.add(equipe)

        medico = Medico(
            nome="Dr. Carlos Andrade",
            cns="700508575563459",
            cbo_codigo="225142",
            cbo_descricao="Médico da Estratégia de Saúde da Família",
            unidade_saude_id=unidade.id,
            ativo=True,
        )
        session.add(medico)

        user_a = User(
            username="digitador_a",
            password_hash="x",
            nome="Maria Digitadora",
            area="recepcao",
            telas="producao_profissional",
            acoes='{"producao_profissional": ["ver", "criar", "editar", "excluir"]}',
            is_superuser=False,
            is_active=True,
        )
        user_b = User(
            username="digitador_b",
            password_hash="x",
            nome="Joao Digitador",
            area="recepcao",
            telas="producao_profissional",
            acoes='{"producao_profissional": ["ver", "criar", "editar", "excluir"]}',
            is_superuser=False,
            is_active=True,
        )
        admin = User(
            username="admin_geral",
            password_hash="x",
            nome="Administrador Geral",
            area="admin",
            telas="producao_profissional,usuarios,cfg_geral,lab_vagas,cfg_laboratorios",
            acoes="{}",
            is_superuser=True,
            is_active=True,
        )
        session.add_all([user_a, user_b, admin])

        pac = Paciente(
            nome="Ana Clara Souza",
            cpf="52998224725",
            cns="700508575563459",
            sexo="F",
            nascimento=date(1990, 6, 15),
            telefone="35999991111",
            endereco="Rua das Flores",
            endereco_numero="120",
            bairro="Centro",
            municipio="312810",
            cep="37177000",
        )
        session.add(pac)

        # Procedimento que aceita BPA-C e BPA-I e exige idade no BPA-C
        proc_misto = SigtapProcedimento(
            codigo="0301010072",
            descricao="CONSULTA MEDICA EM ATENCAO ESPECIALIZADA",
            complexidade="MC",
            instrumento="BPA-C",
            instrumentos_permitidos="BPA-C,BPA-I",
            sexo="I",
            idade_min=0,
            idade_max=130,
            qtd_maxima=10,
            valor_sa=10.0,
            exige_idade_bpa=True,
        )
        # Procedimento BPA-I rigoroso (CPF + CID + Serviço)
        proc_bpai = SigtapProcedimento(
            codigo="0205020143",
            descricao="ULTRASSONOGRAFIA OBSTETRICA",
            complexidade="MC",
            instrumento="BPA-I",
            instrumentos_permitidos="BPA-I",
            sexo="F",
            idade_min=10,
            idade_max=55,
            qtd_maxima=5,
            valor_sa=24.20,
            exige_cpf=True,
            exige_cns=True,
            exige_cid=True,
            exige_servico=True,
            servicos_permitidos_json=json.dumps([
                {
                    "servico_codigo": "121",
                    "servico_nome": "SERVICO DE DIAGNOSTICO POR IMAGEM",
                    "classificacao_codigo": "001",
                    "classificacao_nome": "ULTRASSONOGRAFIA",
                }
            ]),
        )
        session.add_all([proc_misto, proc_bpai])
        session.add(
            SigtapCid(
                procedimento_codigo="0205020143",
                cid="Z340",
                descricao="SUPERVISAO DE PRIMEIRA GRAVIDEZ NORMAL",
            )
        )
        session.add(
            SigtapCid(
                procedimento_codigo="9999999999",
                cid="J00",
                descricao="NASOFARINGITE AGUDA (RESFRIADO COMUM)",
            )
        )

        session.commit()

        estado_user = {"atual": admin}

        def _override_db():
            yield session

        def _override_user():
            return estado_user["atual"]

        app.dependency_overrides[get_db] = _override_db
        app.dependency_overrides[get_current_user] = _override_user
        app.dependency_overrides[get_lab_current_user] = _override_user

        try:
            yield {
                "session": session,
                "client": TestClient(app),
                "estado_user": estado_user,
                "user_a": user_a,
                "user_b": user_b,
                "admin": admin,
                "unidade": unidade,
                "equipe": equipe,
                "medico": medico,
                "pac": pac,
                "proc_misto": proc_misto,
                "proc_bpai": proc_bpai,
            }
        finally:
            app.dependency_overrides.clear()


def test_producao_historico_por_usuario_e_visao_admin(ctx):
    client: TestClient = ctx["client"]
    estado_user = ctx["estado_user"]
    user_a: User = ctx["user_a"]
    user_b: User = ctx["user_b"]
    admin: User = ctx["admin"]

    base_payload = {
        "unidade_saude_id": ctx["unidade"].id,
        "medico_id": ctx["medico"].id,
        "equipe_id": ctx["equipe"].id,
        "procedimento_codigo": ctx["proc_misto"].codigo,
        "data_atendimento": "2026-11-10",
        "instrumento_registro": "BPA-C",
        "quantidade": 2,
        "idade_paciente_informada": 42,
    }

    estado_user["atual"] = user_a
    r1 = client.post("/api/v1/producoes-ambulatoriais", json=base_payload)
    assert r1.status_code == 201, r1.text
    id_a = r1.json()["id"]

    estado_user["atual"] = user_b
    r2 = client.post(
        "/api/v1/producoes-ambulatoriais",
        json={**base_payload, "quantidade": 3, "idade_paciente_informada": 30},
    )
    assert r2.status_code == 201, r2.text

    # Digitador B só vê os seus lançamentos
    list_b = client.get("/api/v1/producoes-ambulatoriais", params={"competencia": "202611"})
    assert list_b.status_code == 200
    body_b = list_b.json()
    assert body_b["somente_proprios"] is True
    assert body_b["total"] == 1
    assert body_b["itens"][0]["usuario_id"] == user_b.id

    res_b = client.get("/api/v1/producoes-ambulatoriais/resumo-competencia", params={"competencia": "202611"})
    assert res_b.status_code == 200
    assert res_b.json()["total_procedimentos"] == 3

    # Digitador B não pode alterar nem excluir lançamento de Digitador A
    put_b = client.put(
        f"/api/v1/producoes-ambulatoriais/{id_a}",
        json={"quantidade": 5, "idade_paciente_informada": 42},
    )
    assert put_b.status_code == 403
    del_b = client.delete(f"/api/v1/producoes-ambulatoriais/{id_a}")
    assert del_b.status_code == 403

    # Admin enxerga todos os lançamentos e quem digitou
    estado_user["atual"] = admin
    list_adm = client.get("/api/v1/producoes-ambulatoriais", params={"competencia": "202611"})
    assert list_adm.status_code == 200
    body_adm = list_adm.json()
    assert body_adm["somente_proprios"] is False
    assert body_adm["total"] == 2
    assert {it["usuario_nome"] for it in body_adm["itens"]} == {"Maria Digitadora", "Joao Digitador"}

    res_adm = client.get("/api/v1/producoes-ambulatoriais/resumo-competencia", params={"competencia": "202611"})
    assert res_adm.status_code == 200
    assert res_adm.json()["total_procedimentos"] == 5

    # Edição pelo admin preserva usuario_id original (user_a)
    put_adm = client.put(
        f"/api/v1/producoes-ambulatoriais/{id_a}",
        json={"quantidade": 4, "idade_paciente_informada": 42},
    )
    assert put_adm.status_code == 200
    assert put_adm.json()["usuario_id"] == user_a.id
    assert put_adm.json()["usuario_nome"] == "Maria Digitadora"


def test_producao_validacoes_bpa_e_exportacao_out(ctx):
    client: TestClient = ctx["client"]
    session: Session = ctx["session"]
    pac: Paciente = ctx["pac"]

    # 1) BPA-C que exige idade rejeita envio sem idade_paciente_informada
    r_sem_idade = client.post(
        "/api/v1/producoes-ambulatoriais",
        json={
            "unidade_saude_id": ctx["unidade"].id,
            "medico_id": ctx["medico"].id,
            "procedimento_codigo": ctx["proc_misto"].codigo,
            "data_atendimento": "2026-11-12",
            "instrumento_registro": "BPA-C",
            "quantidade": 1,
        },
    )
    assert r_sem_idade.status_code == 422
    assert "idade" in r_sem_idade.json()["detail"].lower()

    # 2) Procedimento misto pode ser lançado explicitamente em BPA-I
    r_misto_bpai = client.post(
        "/api/v1/producoes-ambulatoriais",
        json={
            "unidade_saude_id": ctx["unidade"].id,
            "medico_id": ctx["medico"].id,
            "equipe_id": ctx["equipe"].id,
            "procedimento_codigo": ctx["proc_misto"].codigo,
            "data_atendimento": "2026-11-12",
            "instrumento_registro": "BPA-I",
            "quantidade": 1,
            "paciente_id": pac.id,
            "paciente_nome": pac.nome,
            "paciente_cpf": pac.cpf,
            "paciente_cns": pac.cns,
            "paciente_sexo": "F",
            "paciente_data_nascimento": "1990-06-15",
            "carater_atendimento": "02",
        },
    )
    assert r_misto_bpai.status_code == 201, r_misto_bpai.text
    assert r_misto_bpai.json()["instrumento_registro"] == "BPA-I"

    # 3) Procedimento com exige_cpf=True recusa falta de CPF sem marcar 'sem CPF'
    r_sem_cpf = client.post(
        "/api/v1/producoes-ambulatoriais",
        json={
            "unidade_saude_id": ctx["unidade"].id,
            "medico_id": ctx["medico"].id,
            "procedimento_codigo": ctx["proc_bpai"].codigo,
            "data_atendimento": "2026-11-12",
            "instrumento_registro": "BPA-I",
            "paciente_nome": pac.nome,
            "paciente_cpf": "",
            "paciente_sem_cpf": "N",
            "paciente_cns": pac.cns,
            "paciente_sexo": "F",
            "paciente_data_nascimento": "1990-06-15",
            "cid10": "Z340",
            "servico_codigo": "121",
            "classificacao_codigo": "001",
        },
    )
    assert r_sem_cpf.status_code == 422
    assert "cpf" in r_sem_cpf.json()["detail"].lower()

    # 4) Raça/cor 05 exige etnia
    r_sem_etnia = client.post(
        "/api/v1/producoes-ambulatoriais",
        json={
            "unidade_saude_id": ctx["unidade"].id,
            "medico_id": ctx["medico"].id,
            "procedimento_codigo": ctx["proc_bpai"].codigo,
            "data_atendimento": "2026-11-12",
            "instrumento_registro": "BPA-I",
            "paciente_nome": pac.nome,
            "paciente_cpf": pac.cpf,
            "paciente_cns": pac.cns,
            "paciente_sexo": "F",
            "paciente_data_nascimento": "1990-06-15",
            "paciente_raca_cor": "05",
            "cid10": "Z340",
            "servico_codigo": "121",
            "classificacao_codigo": "001",
        },
    )
    assert r_sem_etnia.status_code == 422
    assert "etnia" in r_sem_etnia.json()["detail"].lower()

    # 5) Endpoint de CIDs filtra somente CIDs compatíveis quando procedimento possui lista SIGTAP
    r_cids = client.get(
        "/api/v1/producoes-ambulatoriais/cids",
        params={"termo": "J00", "procedimento_codigo": ctx["proc_bpai"].codigo},
    )
    assert r_cids.status_code == 200
    assert r_cids.json() == []

    # 6) Lançamento válido BPA-C com idade e BPA-I completo + exportação .OUT
    assert client.post(
        "/api/v1/producoes-ambulatoriais",
        json={
            "unidade_saude_id": ctx["unidade"].id,
            "medico_id": ctx["medico"].id,
            "procedimento_codigo": ctx["proc_misto"].codigo,
            "data_atendimento": "2026-11-12",
            "instrumento_registro": "BPA-C",
            "quantidade": 1,
            "idade_paciente_informada": 55,
        },
    ).status_code == 201

    assert client.post(
        "/api/v1/producoes-ambulatoriais",
        json={
            "unidade_saude_id": ctx["unidade"].id,
            "medico_id": ctx["medico"].id,
            "equipe_id": ctx["equipe"].id,
            "procedimento_codigo": ctx["proc_bpai"].codigo,
            "data_atendimento": "2026-11-12",
            "instrumento_registro": "BPA-I",
            "paciente_id": pac.id,
            "paciente_nome": pac.nome,
            "paciente_cpf": pac.cpf,
            "paciente_cns": pac.cns,
            "paciente_sexo": "F",
            "paciente_data_nascimento": "1990-06-15",
            "paciente_raca_cor": "03",
            "carater_atendimento": "02",
            "cid10": "Z340",
            "servico_codigo": "121",
            "classificacao_codigo": "001",
        },
    ).status_code == 201

    bpa = gerar_bpa_completo_municipio(session, "202611", forcar=True)
    linhas = bpa["conteudo_out"].splitlines()
    regs_02 = [ln for ln in linhas if ln.startswith("02")]
    regs_03 = [ln for ln in linhas if ln.startswith("03")]
    assert len(regs_02) == 1
    assert regs_02[0][36:39] == "055"  # idade BPA-C exportada corretamente
    assert len(regs_03) >= 2
    assert all(len(r) == 351 for r in regs_03)


def test_importadores_sigtap_e_sia_atualizam_regras_bpa(ctx):
    session: Session = ctx["session"]
    client: TestClient = ctx["client"]

    # 1) Testa importação ZIP SIGTAP com múltiplos instrumentos, serviços e CID (layout posicional DATASUS)
    tb_proc_linha = (
        "0401010015"
        + "CURATIVO ESPECIAL GRAU II".ljust(250)
        + "2"
        + "I"
        + "0031"
        + "0000"
        + "0000"
        + "0000"
        + "0130"
        + "0000000000"
        + "0000001250"
        + "0000000000"
    )
    # Garante 312 caracteres exatos (266..270 = qt_dias_permanencia)
    tb_proc_linha = (
        "0401010015"
        + "CURATIVO ESPECIAL GRAU II".ljust(250)
        + "2"
        + "I"
        + "0031"
        + "0000"  # dias permanencia (266..270)
        + "0000"  # pontos (270..274)
        + "0000"  # idade min (274..278)
        + "0130"  # idade max (278..282)
        + "0000000000"  # vl_sh (282..292)
        + "0000001250"  # vl_sa (292..302)
        + "0000000000"  # vl_sp (302..312)
    )
    buf_zip = io.BytesIO()
    with zipfile.ZipFile(buf_zip, "w") as zf:
        zf.writestr("tb_procedimento.txt", tb_proc_linha + "\n")
        zf.writestr(
            "rl_procedimento_registro.txt",
            "040101001501\n040101001502\n",
        )
        zf.writestr("tb_servico.txt", "135" + "ATENDIMENTO DOMICILIAR".ljust(120) + "\n")
        zf.writestr(
            "tb_servico_classificacao.txt",
            "135002" + "CURATIVOS COMPLEXOS".ljust(150) + "\n",
        )
        zf.writestr(
            "rl_procedimento_servico.txt",
            "0401010015135002\n",
        )
        zf.writestr("tb_cid.txt", "L97 " + "ULCERA DOS MEMBROS INFERIORES".ljust(100) + "\n")
        zf.writestr("rl_procedimento_cid.txt", "0401010015L97 \n")

    res_sig = importar_sigtap(session, [("sigtap.zip", buf_zip.getvalue())], competencia="2026-11", usuario="admin", simular=False)
    assert res_sig["inseridos"] >= 1

    proc_zip = session.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == "0401010015")).first()
    assert proc_zip is not None
    assert proc_zip.instrumentos_permitidos == "BPA-C,BPA-I"
    assert proc_zip.exige_cid is True
    assert proc_zip.exige_servico is True
    servs = json.loads(proc_zip.servicos_permitidos_json)
    assert len(servs) == 1 and servs[0]["servico"] == "135"

    # API retorna formato normalizado para o frontend
    r_busca = client.get("/api/v1/producoes-ambulatoriais/procedimentos-sigtap", params={"termo": "0401010015"})
    assert r_busca.status_code == 200
    assert r_busca.json()[0]["servicos_permitidos"][0]["servico_codigo"] == "135"

    # 2) Testa importação DBF SIA (PA_CPFPCN, PA_CNSPCN, PA_IDEBPA)
    import os
    import tempfile

    dbf_proced = _criar_dbf(
        [
            ("PA_ID", "C", 9, 0),
            ("PA_DV", "C", 1, 0),
            ("PA_DC", "C", 60, 0),
            ("PA_CPX", "C", 2, 0),
            ("PA_SEXO", "C", 1, 0),
            ("PA_IDADEMN", "N", 3, 0),
            ("PA_IDADEMX", "N", 3, 0),
            ("PA_QTDMAX", "N", 6, 0),
            ("PA_SA", "N", 12, 2),
            ("PA_SP", "N", 12, 2),
            ("PA_SH", "N", 12, 2),
        ],
        [
            {
                "PA_ID": "040101001",
                "PA_DV": "5",
                "PA_DC": "CURATIVO ESPECIAL GRAU II",
                "PA_CPX": "2",
                "PA_SEXO": "I",
                "PA_IDADEMN": "0",
                "PA_IDADEMX": "130",
                "PA_QTDMAX": "31",
                "PA_SA": "12.50",
                "PA_SP": "0.00",
                "PA_SH": "0.00",
            }
        ],
    )
    dbf_pa = _criar_dbf(
        [
            ("PA_ID", "C", 9, 0),
            ("PA_DV", "C", 1, 0),
            ("PA_TPREG", "C", 2, 0),
            ("PA_CPFPCN", "C", 1, 0),
            ("PA_CNSPCN", "C", 1, 0),
            ("PA_IDEBPA", "C", 1, 0),
            ("PA_EXIGCBO", "C", 1, 0),
        ],
        [
            {
                "PA_ID": "040101001",
                "PA_DV": "5",
                "PA_TPREG": "02",
                "PA_CPFPCN": "S",
                "PA_CNSPCN": "S",
                "PA_IDEBPA": "S",
                "PA_EXIGCBO": "S",
            }
        ],
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        p_proced = os.path.join(tmpdir, "S_PROCED.DBF")
        p_pa = os.path.join(tmpdir, "S_PA.DBF")
        with open(p_proced, "wb") as f:
            f.write(dbf_proced)
        with open(p_pa, "wb") as f:
            f.write(dbf_pa)

        importar_tabela_sia(
            session,
            p_proced,
            p_pa,
            competencia="2026-11",
            usuario="admin",
        )

    session.refresh(proc_zip)
    assert proc_zip.exige_cpf is True
    assert proc_zip.exige_cns is True
    assert proc_zip.exige_idade_bpa is True
    assert proc_zip.exige_cbo is True


def test_lab_edicao_preserva_snapshot_e_acesso_e_exclusao_permanente(ctx):
    client: TestClient = ctx["client"]
    session: Session = ctx["session"]
    pac: Paciente = ctx["pac"]

    # 1) Cria laboratório sem acesso inicial
    r_cria = client.post(
        "/api/exames/laboratorios",
        json={
            "nome": "Lab Sao Judas",
            "responsavel_tecnico": "Dr. Roberto Antigo",
            "horario_funcionamento": "07:00 às 12:00",
            "cnpj": "11.111.111/0001-11",
            "cnes": "2146400",
            "telefone": "(35) 3856-1000",
            "endereco": "Rua A, 10",
            "criar_usuario_acesso": False,
        },
    )
    assert r_cria.status_code == 201, r_cria.text
    lab_id = r_cria.json()["id"]
    assert r_cria.json()["usuario_acesso"] is None

    # 2) Gera acesso pela primeira vez e depois regera senha
    r_acesso1 = client.post(f"/api/exames/laboratorios/{lab_id}/gerar-acesso")
    assert r_acesso1.status_code == 200, r_acesso1.text
    login1 = r_acesso1.json()["usuario_criado"]
    senha1 = r_acesso1.json()["senha_temporaria"]
    assert login1 and senha1

    r_acesso2 = client.post(f"/api/exames/laboratorios/{lab_id}/gerar-acesso")
    assert r_acesso2.status_code == 200
    assert r_acesso2.json()["usuario_criado"] == login1
    assert r_acesso2.json()["senha_temporaria"] != senha1

    # 3) Cria solicitação antiga antes da edição do laboratório
    hoje = date.today()
    session.add(VagaLab(laboratorio_id=lab_id, data=hoje, vagas_totais=10, vagas_ocupadas=0))
    session.commit()

    mestre_antigo = criar_solicitacao_mestre(
        session,
        paciente_id=pac.id,
        data_agendada=hoje,
        hora_agendada="07:30",
        laboratorio_id=lab_id,
        itens=[{"sigtap_id": ctx["proc_misto"].id, "quantidade": 1}],
        agendado_por="Recepcao",
    )

    # 4) Edita o laboratório para novos dados
    r_edit = client.put(
        f"/api/exames/laboratorios/{lab_id}",
        json={
            "nome": "Lab Vida Nova",
            "ativo": True,
            "responsavel_tecnico": "Dra. Fernanda Nova",
            "horario_funcionamento": "06:30 às 18:00",
            "cnpj": "22.222.222/0001-22",
            "cnes": "2146499",
            "telefone": "(35) 3856-2000",
            "endereco": "Av. Brasil, 500",
        },
    )
    assert r_edit.status_code == 200, r_edit.text
    assert r_edit.json()["nome"] == "Lab Vida Nova"

    # Pedido antigo continua preservando os dados da época do agendamento
    enr_antigo = enriquecer_mestre(session, mestre_antigo)
    assert enr_antigo["laboratorio_nome"] == "Lab Sao Judas"
    assert enr_antigo["laboratorio_responsavel"] == "Dr. Roberto Antigo"
    comp_antigo = gerar_comprovante_agendamento(session, mestre_antigo.id)
    assert comp_antigo["laboratorio_nome"] == "Lab Sao Judas"
    assert comp_antigo["laboratorio_responsavel"] == "Dr. Roberto Antigo"

    # Novo pedido passa a utilizar os novos dados do laboratório
    mestre_novo = criar_solicitacao_mestre(
        session,
        paciente_id=pac.id,
        data_agendada=hoje,
        hora_agendada="08:00",
        laboratorio_id=lab_id,
        itens=[{"sigtap_id": ctx["proc_misto"].id, "quantidade": 1}],
        agendado_por="Recepcao",
    )
    enr_novo = enriquecer_mestre(session, mestre_novo)
    assert enr_novo["laboratorio_nome"] == "Lab Vida Nova"
    assert enr_novo["laboratorio_responsavel"] == "Dra. Fernanda Nova"

    # 5) Exclusão permanente com solicitações vinculadas retorna 400 amigável (não 500 ImportError)
    r_del_bloq = client.delete(f"/api/exames/laboratorios/{lab_id}", params={"permanente": True})
    assert r_del_bloq.status_code == 400
    assert "solicitação" in r_del_bloq.json()["detail"].lower()

    # 6) Cria segundo laboratório sem pedidos mas com contratos/FPO/lotes/vagas/feriados/resultados e exclui permanentemente
    r_lab2 = client.post(
        "/api/exames/laboratorios",
        json={"nome": "Lab Temporario Excluir", "criar_usuario_acesso": True},
    )
    assert r_lab2.status_code == 201
    lab2_id = r_lab2.json()["id"]

    contrato = LabContrato(laboratorio_id=lab2_id, numero_contrato="CT-01", competencia_inicio="2026-01")
    session.add(contrato)
    session.flush()
    session.add(LabContratoPrecoCustomizado(contrato_id=contrato.id, sigtap_id=ctx["proc_misto"].id, codigo_sigtap=ctx["proc_misto"].codigo, valor_customizado=15.0))

    fpo = LabFPOCompetencia(laboratorio_id=lab2_id, contrato_id=contrato.id, competencia="2026-11")
    session.add(fpo)
    session.flush()
    session.add(LabFPOItem(fpo_id=fpo.id, sigtap_id=ctx["proc_misto"].id, codigo_procedimento=ctx["proc_misto"].codigo))

    lote = LabLoteLiberacao(codigo_lote="LOTE-202611-01", laboratorio_id=lab2_id, competencia="2026-11")
    session.add(lote)
    session.flush()
    fila = FilaPsf(paciente_id=pac.id, unidade_psf="PSF 1", lote_id=lote.id)
    session.add(fila)
    session.flush()
    session.add(LabLoteItem(lote_id=lote.id, fila_psf_id=fila.id, paciente_id=pac.id, solicitacao_mestre_id=mestre_novo.id, paciente_nome=pac.nome, data_agendada=hoje))
    session.add(LabLoteArtefato(lote_id=lote.id, tipo="remessa_txt", nome_arquivo="rem.txt", mime_type="text/plain", conteudo=b"remessa"))

    session.add(LabFeriadoBloqueio(laboratorio_id=lab2_id, data=date(2026, 12, 25), motivo="Natal"))
    session.add(VagaLab(laboratorio_id=lab2_id, data=date(2026, 12, 26), vagas_totais=5, vagas_ocupadas=0))
    session.add(LabPedidoAjuste(solicitacao_id=mestre_novo.id, laboratorio_id=lab2_id, tipo_ajuste="troca", justificativa="Teste", solicitado_por="lab"))
    session.add(LabResultadoArquivo(solicitacao_id=mestre_novo.id, paciente_id=pac.id, laboratorio_id=lab2_id, nome_arquivo_original="laudo.pdf", nome_arquivo_sistema="laudo_1.pdf", caminho_storage="/tmp/laudo.pdf", sha256_hash="abc", enviado_por="lab"))
    session.commit()

    r_del_ok = client.delete(f"/api/exames/laboratorios/{lab2_id}", params={"permanente": True})
    assert r_del_ok.status_code == 204, r_del_ok.text
    assert session.get(Laboratorio, lab2_id) is None
    session.refresh(fila)
    assert fila.lote_id is None
