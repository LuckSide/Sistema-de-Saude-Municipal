import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.core.deps import get_current_user_senha_ok, get_db
from app.main import app
from app.models.suporte import TicketSuporte
from app.models.user import User


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
            nome="Administrador Geral",
            is_superuser=True,
            is_active=True,
            must_change_password=False,
        )
        usuario_comum = User(
            id=2,
            username="atendente",
            password_hash="hash",
            nome="Atendente PSF",
            telas="tfd,lab",
            is_superuser=False,
            is_active=True,
            must_change_password=False,
        )
        db.add_all([admin, usuario_comum])
        db.commit()
        yield db


def test_fluxo_completo_tickets_suporte(session: Session):
    admin = session.get(User, 1)
    usuario_comum = session.get(User, 2)

    app.dependency_overrides[get_db] = lambda: session
    # 1. Usuário comum autenticado cria ticket
    app.dependency_overrides[get_current_user_senha_ok] = lambda: usuario_comum

    with TestClient(app) as client:
        # Tenta criar com descrição vazia -> deve falhar
        resp_erro = client.post(
            "/api/suporte/tickets",
            json={"tipo": "bug", "descricao": "   ", "pagina_url": "/tfd/viagens"},
        )
        assert resp_erro.status_code == 400

        # Cria ticket 1 (bug)
        resp1 = client.post(
            "/api/suporte/tickets",
            json={
                "tipo": "bug",
                "descricao": "Erro ao salvar motorista no quadro de viagens",
                "pagina_url": "/tfd/quadro",
            },
        )
        assert resp1.status_code == 201
        data1 = resp1.json()
        assert data1["id"] is not None
        assert data1["tipo"] == "bug"
        assert data1["usuario_id"] == 2
        assert data1["usuario_nome"] == "Atendente PSF"
        assert data1["status"] == "aberto"
        assert data1["pagina_url"] == "/tfd/quadro"
        ticket_id = data1["id"]

        # Cria ticket 2 (nova_funcionalidade)
        resp2 = client.post(
            "/api/suporte/tickets",
            json={
                "tipo": "nova_funcionalidade",
                "descricao": "Exportar relatório de agendados para PDF",
                "pagina_url": "/tfd/relatorio-agendados",
            },
        )
        assert resp2.status_code == 201
        ticket2_id = resp2.json()["id"]

        # Usuário comum tenta listar tickets -> 403 Forbidden
        resp_list_sem_perm = client.get("/api/suporte/tickets")
        assert resp_list_sem_perm.status_code == 403

        # Usuário comum tenta resolver ticket -> 403 Forbidden
        resp_patch_sem_perm = client.patch(
            f"/api/suporte/tickets/{ticket_id}/status",
            json={"status": "resolvido"},
        )
        assert resp_patch_sem_perm.status_code == 403

    # 2. Agora autenticado como Admin
    app.dependency_overrides[get_current_user_senha_ok] = lambda: admin

    with TestClient(app) as client:
        # Admin lista todos os tickets
        resp_list = client.get("/api/suporte/tickets")
        assert resp_list.status_code == 200
        todos = resp_list.json()
        assert len(todos) >= 2

        # Filtra por tipo=bug
        resp_filtro_tipo = client.get("/api/suporte/tickets?tipo=bug")
        assert resp_filtro_tipo.status_code == 200
        bugs = resp_filtro_tipo.json()
        assert len(bugs) == 1
        assert bugs[0]["tipo"] == "bug"
        assert bugs[0]["id"] == ticket_id

        # Filtra por status=aberto
        resp_abertos = client.get("/api/suporte/tickets?status=aberto")
        assert resp_abertos.status_code == 200
        assert len(resp_abertos.json()) == 2

        # Admin resolve ticket 1
        resp_resolve = client.patch(
            f"/api/suporte/tickets/{ticket_id}/status",
            json={
                "status": "resolvido",
                "resposta_admin": "Bug corrigido no backend na versão 1.0.5",
            },
        )
        assert resp_resolve.status_code == 200
        res_data = resp_resolve.json()
        assert res_data["status"] == "resolvido"
        assert res_data["resolvido_por"] == "Administrador Geral"
        assert res_data["resolvido_em"] is not None
        assert res_data["resposta_admin"] == "Bug corrigido no backend na versão 1.0.5"

        # Filtra por status=resolvido
        resp_resolvidos = client.get("/api/suporte/tickets?status=resolvido")
        assert resp_resolvidos.status_code == 200
        resolvidos = resp_resolvidos.json()
        assert len(resolvidos) == 1
        assert resolvidos[0]["id"] == ticket_id

        # Reabrir ticket
        resp_reabrir = client.patch(
            f"/api/suporte/tickets/{ticket_id}/status",
            json={"status": "em_analise"},
        )
        assert resp_reabrir.status_code == 200
        reaberto_data = resp_reabrir.json()
        assert reaberto_data["status"] == "em_analise"
        assert reaberto_data["resolvido_por"] is None
        assert reaberto_data["resolvido_em"] is None

        # Tentar status inválido -> 400
        resp_invalido = client.patch(
            f"/api/suporte/tickets/{ticket_id}/status",
            json={"status": "inexistente"},
        )
        assert resp_invalido.status_code == 400

        # Ticket inexistente -> 404
        resp_404 = client.patch(
            "/api/suporte/tickets/99999/status",
            json={"status": "resolvido"},
        )
        assert resp_404.status_code == 404

    app.dependency_overrides.clear()
