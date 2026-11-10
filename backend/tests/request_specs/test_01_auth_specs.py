import pytest
from httpx import AsyncClient
from sqlmodel import Session, select
from app.models.user import User
from app.core.security import hash_password


@pytest.mark.anyio
async def test_auth_login_caminho_feliz(client: AsyncClient, create_test_user):
    """(a. feliz): quando credenciais válidas forem enviadas em POST /api/token/, retorna JWT e versão."""
    user, _ = create_test_user("user_login_ok", "SenhaForte123@")
    response = await client.post("/api/token/", data={"username": "user_login_ok", "password": "SenhaForte123@"})
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"].lower() == "bearer"
    assert "versao" in data
    assert data["must_change_password"] is False


@pytest.mark.anyio
async def test_auth_primeira_troca_senha_caminho_feliz(client: AsyncClient, create_test_user, db: Session):
    """(a. feliz): quando usuário no primeiro acesso fizer primeira troca, atualiza senha e libera o acesso."""
    user, headers = create_test_user("user_primeiro_acesso", "Temp12345@", must_change_password=True)
    
    payload = {
        "senha_atual": "Temp12345@",
        "nova_senha": "NovaSenhaDefinitiva123@",
        "confirmar_senha": "NovaSenhaDefinitiva123@",
    }
    response = await client.put("/api/usuarios/me/primeira-troca", json=payload, headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data.get("ok") is True

    # Verifica no banco real se must_change_password virou False
    db.expire_all()
    user_db = db.exec(select(User).where(User.username == "user_primeiro_acesso")).first()
    assert user_db.must_change_password is False


@pytest.mark.anyio
async def test_auth_credenciais_incorretas_erro_esperado(client: AsyncClient, create_test_user):
    """(b. erro esperado): quando credenciais forem incorretas ou usuário inativo, retorna 401."""
    create_test_user("user_inativo_teste", "Senha123@", is_active=False)

    # Senha incorreta
    res1 = await client.post("/api/token/", data={"username": "user_login_ok", "password": "SenhaErradaTotal"})
    assert res1.status_code == 401
    assert "inválidos" in res1.json().get("detail", "").lower()

    # Usuário inativo
    res2 = await client.post("/api/token/", data={"username": "user_inativo_teste", "password": "Senha123@"})
    assert res2.status_code == 401


@pytest.mark.anyio
async def test_auth_primeira_troca_confirmacao_divergente_erro_esperado(client: AsyncClient, create_test_user):
    """(b. erro esperado): quando a nova senha não confere com a confirmação, retorna 400."""
    _, headers = create_test_user("user_confirm_err", "Temp12345@", must_change_password=True)
    payload = {
        "senha_atual": "Temp12345@",
        "nova_senha": "NovaSenha123@",
        "confirmar_senha": "OutraSenhaTotalmenteDiferente",
    }
    response = await client.put("/api/usuarios/me/primeira-troca", json=payload, headers=headers)
    assert response.status_code == 400
    assert "confirmação" in response.json().get("detail", "").lower() or "não conferem" in response.json().get("detail", "").lower()


@pytest.mark.anyio
async def test_auth_repeticao_primeira_troca_com_senha_antiga(client: AsyncClient, create_test_user):
    """(c. repetição): quando primeira troca for submetida 2 vezes com senha antiga, a 2ª chamada falha com 400."""
    _, headers = create_test_user("user_repeticao_troca", "TempOriginal123@", must_change_password=True)
    payload = {
        "senha_atual": "TempOriginal123@",
        "nova_senha": "DefinitivaForte123@",
        "confirmar_senha": "DefinitivaForte123@",
    }
    # 1ª vez: sucesso
    res1 = await client.put("/api/usuarios/me/primeira-troca", json=payload, headers=headers)
    assert res1.status_code == 200

    # 2ª vez com o mesmo payload (senha antiga já foi descartada): deve recusar com 400
    res2 = await client.put("/api/usuarios/me/primeira-troca", json=payload, headers=headers)
    assert res2.status_code == 400
    assert "incorreta" in res2.json().get("detail", "").lower() or "inválida" in res2.json().get("detail", "").lower()


@pytest.mark.anyio
async def test_auth_limite_troca_pendente_bloqueia_rotas_protegidas(client: AsyncClient, create_test_user):
    """(d. limites): quando usuário estiver com troca de senha pendente, rotas protegidas retornam 403."""
    _, headers = create_test_user("user_bloqueado_troca", "Temp123@", must_change_password=True, telas="tfd")
    
    # Rota operacional protegida com require_senha_ok
    response = await client.get("/api/tfd/pacientes", headers=headers)
    assert response.status_code == 403
    assert "troca de senha" in response.json().get("detail", "").lower()


@pytest.mark.anyio
async def test_auth_acesso_indevido_token_invalido_ou_ausente(client: AsyncClient):
    """(e. acesso indevido): quando o token for forjado, adulterado ou ausente, retorna 401."""
    # Sem header
    res_sem = await client.get("/api/me")
    assert res_sem.status_code == 401

    # Token adulterado
    res_forjado = await client.get("/api/me", headers={"Authorization": "Bearer token_falso_adulterado_xyz"})
    assert res_forjado.status_code == 401
