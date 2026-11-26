from datetime import date

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.deps import get_db, require_superuser
from app.main import app
from app.models.tfd import Paciente
from app.models.user import User
from app.services.permissoes import TODAS_TELAS, tem_tela


@pytest.fixture(name="session")
def session_fixture():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        admin = User(
            id=1,
            username="admin",
            password_hash="hash",
            nome="Administrador",
            is_superuser=True,
            is_active=True,
            must_change_password=False,
        )
        p1 = Paciente(
            id=10,
            nome="Maria Oliveira",
            cpf="111.222.333-44",
            cns="700000000000001",
            telefone="(35) 99999-0001",
            nascimento=date(1985, 5, 20),
        )
        p2 = Paciente(
            id=11,
            nome="João Santos",
            cpf="555.666.777-88",
            cns="700000000000002",
        )
        db.add_all([admin, p1, p2])
        db.commit()
        yield db


@pytest.fixture(name="client")
def client_fixture(session: Session):
    admin = session.get(User, 1)
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[require_superuser] = lambda: admin
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_criar_e_editar_usuario_com_vinculo_paciente_e_busca(client: TestClient, session: Session):
    # 1. Criação vinculada a paciente do município (sem passar nome -> herda do paciente)
    res_criar = client.post(
        "/api/usuarios/",
        json={
            "username": "maria.oliveira",
            "nome": "",
            "area": "painel",
            "telas": ["dashboard", "tfd_pacientes"],
            "paciente_id": 10,
        },
    )
    assert res_criar.status_code == 201, res_criar.text

    # 2. Criação legada sem vínculo para testar edição posterior
    res_legado = client.post(
        "/api/usuarios/",
        json={
            "username": "joao.legado",
            "nome": "João Sem Vínculo",
            "area": "ferramentas",
            "telas": ["dashboard", "cfg_whatsapp"],
        },
    )
    assert res_legado.status_code == 201, res_legado.text

    # 3. Busca por CPF do paciente vinculado deve localizar maria.oliveira
    res_busca_cpf = client.get("/api/usuarios/?q=11122233344").json()
    assert res_busca_cpf["total"] == 1
    u_maria = res_busca_cpf["data"][0]
    assert u_maria["username"] == "maria.oliveira"
    assert u_maria["nome"] == "Maria Oliveira"
    assert u_maria["paciente_id"] == 10
    assert u_maria["paciente_nome"] == "Maria Oliveira"
    assert u_maria["paciente_cpf"] == "111.222.333-44"

    # 4. Filtro sem_vinculo deve listar admin e joao.legado
    res_sem = client.get("/api/usuarios/?filtro=sem_vinculo").json()
    usernames_sem = {u["username"] for u in res_sem["data"]}
    assert "joao.legado" in usernames_sem
    assert "maria.oliveira" not in usernames_sem

    # 5. Edição do usuário legado vinculando à pessoa #11
    joao = session.exec(select(User).where(User.username == "joao.legado")).first()
    res_edit = client.put(
        f"/api/usuarios/{joao.id}",
        json={"paciente_id": 11},
    )
    assert res_edit.status_code == 200, res_edit.text
    editado = res_edit.json()
    assert editado["paciente_id"] == 11
    assert editado["paciente_nome"] == "João Santos"
    assert editado["paciente_cpf"] == "555.666.777-88"

    # 6. Resumo atualizado
    resumo = client.get("/api/usuarios/resumo").json()
    assert resumo["total"] == 3
    assert resumo["com_vinculo"] == 2
    assert resumo["sem_vinculo"] == 1

    # 7. Erro esperado para paciente inexistente
    res_err = client.post(
        "/api/usuarios/",
        json={
            "username": "invalido.pac",
            "nome": "Teste",
            "area": "painel",
            "telas": ["dashboard"],
            "paciente_id": 999999,
        },
    )
    assert res_err.status_code == 400


def test_matriz_permissoes_cobre_novas_telas_e_heranca():
    telas_esperadas = {
        "tfd_motoristas",
        "tfd_relatorio_agendados",
        "auditoria",
        "cfg_whatsapp",
        "cfg_exames",
        "cfg_medicos",
        "cfg_unidades",
        "cfg_laboratorios",
        "cfg_dados",
    }
    assert telas_esperadas.issubset(TODAS_TELAS)

    user_tfd = User(username="u_tfd", password_hash="x", telas="tfd")
    assert tem_tela(user_tfd, "tfd_motoristas")
    assert tem_tela(user_tfd, "tfd_relatorio_agendados")

    user_cfg = User(username="u_cfg", password_hash="x", telas="integracoes")
    assert tem_tela(user_cfg, "cfg_whatsapp")
    assert tem_tela(user_cfg, "cfg_exames")
    assert tem_tela(user_cfg, "cfg_medicos")
    assert tem_tela(user_cfg, "cfg_unidades")
    assert tem_tela(user_cfg, "cfg_laboratorios")
    assert tem_tela(user_cfg, "cfg_dados")

    user_granular = User(username="u_gran", password_hash="x", telas="cfg_whatsapp,cfg_medicos")
    assert tem_tela(user_granular, "cfg_whatsapp")
    assert tem_tela(user_granular, "cfg_medicos")
    assert not tem_tela(user_granular, "cfg_backup")


def test_criar_usuario_com_todas_as_telas_mais_de_500_chars(session: Session):
    from app.schemas import UserCreate
    from app.services.permissoes import TODAS_TELAS
    from app.services.users import create_user

    todas = sorted(list(TODAS_TELAS))
    str_telas = ",".join(todas)
    assert len(str_telas) > 500

    data = UserCreate(
        username="super_todas_telas",
        password="Guape@2026#1",
        gerar_temporaria=False,
        nome="Usuario Com Muitas Telas",
        area="painel",
        telas=todas,
        is_superuser=True,
    )
    user, _ = create_user(session, data)
    assert user.id is not None
    assert len(user.telas) > 500
    assert user.telas == str_telas


def test_permissoes_estritas_nao_vazam_telas_nao_liberadas(session: Session):
    from app.services.dashboard_default import gerar_layout_padrao_para_usuario
    from app.services.permissoes import TODAS_TELAS, tem_tela

    for esperada in ("lab_auditoria_laudos", "cfg_importar", "admin_tickets", "lab_vagas", "lab_portal", "lab_orcamento"):
        assert esperada in TODAS_TELAS

    # Usuário novo com apenas lançamento PSF não deve acessar fila completa nem médico
    u_psf = User(username="psf_novo", password_hash="x", telas="dashboard,tfd_fila_lancamento")
    assert tem_tela(u_psf, "tfd_fila_lancamento")
    assert not tem_tela(u_psf, "tfd_exames")
    assert not tem_tela(u_psf, "tfd_medico")
    assert not tem_tela(u_psf, "tfd_agenda")

    # Usuário com apenas "usuarios" não deve ganhar auditoria, tickets ou módulos externos
    u_usr = User(username="u_usr", password_hash="x", telas="dashboard,usuarios")
    assert tem_tela(u_usr, "usuarios")
    assert not tem_tela(u_usr, "auditoria")
    assert not tem_tela(u_usr, "admin_tickets")
    assert not tem_tela(u_usr, "cfg_backup")
    assert not tem_tela(u_usr, "cfg_geral")

    # "integracoes" não deve vazar cfg_geral nem cfg_backup
    u_int = User(username="u_int", password_hash="x", telas="integracoes")
    assert tem_tela(u_int, "cfg_importar")
    assert tem_tela(u_int, "cfg_pec")
    assert not tem_tela(u_int, "cfg_geral")
    assert not tem_tela(u_int, "cfg_backup")

    # "tfd" não deve vazar telas APAC
    u_tfd = User(username="u_tfd_estrito", password_hash="x", telas="tfd")
    assert not tem_tela(u_tfd, "apac_solicitacao")
    assert not tem_tela(u_tfd, "apac_faturamento")

    # Dashboard padrão nunca gera tfd_resumo nem widgets de telas não liberadas
    u_med = User(username="med_estrito", password_hash="x", area="painel", medico_id=1, telas="dashboard,tfd_medico")
    layout_med = gerar_layout_padrao_para_usuario(u_med)
    refs_widgets = {it["ref"] for it in layout_med if it["tipo"] == "widget"}
    refs_atalhos = {it["ref"] for it in layout_med if it["tipo"] == "atalho"}
    assert "tfd_resumo" not in refs_atalhos
    assert "tempo-fila-indicadores" not in refs_widgets
    assert "resumo-tfd" not in refs_widgets
