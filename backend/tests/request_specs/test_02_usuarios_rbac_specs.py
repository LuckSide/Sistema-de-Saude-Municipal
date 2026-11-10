import asyncio
import pytest
from httpx import AsyncClient
from sqlmodel import Session, select
from app.models.user import User
from app.models.dashboard_prefs import UserDashboardPrefs


@pytest.mark.anyio
async def test_usuarios_criacao_e_reset_caminho_feliz(client: AsyncClient, admin_headers: dict, db: Session):
    """(a. feliz): admin cria conta e gera temporária; reset de senha gera nova temporária."""
    payload = {
        "username": "operador_novo_spec",
        "nome": "Operador Novo Spec",
        "area": "ferramentas",
        "is_superuser": False,
        "is_active": True,
        "telas": ["tfd", "tfd_pacientes"],
        "acoes": {"tfd": ["ver", "criar"]},
    }
    # Criação
    res_create = await client.post("/api/usuarios/", json=payload, headers=admin_headers)
    assert res_create.status_code == 201
    data_create = res_create.json()
    assert data_create.get("ok") is True
    assert "senha_temporaria" in data_create
    assert len(data_create["senha_temporaria"]) >= 8

    # Busca id do usuário criado no banco
    db.expire_all()
    user_db = db.exec(select(User).where(User.username == "operador_novo_spec")).first()
    assert user_db is not None
    assert user_db.must_change_password is True

    # Reset de senha
    res_reset = await client.post(f"/api/usuarios/{user_db.id}/reset-senha", headers=admin_headers)
    assert res_reset.status_code == 200
    data_reset = res_reset.json()
    assert data_reset.get("ok") is True
    assert "senha_temporaria" in data_reset

    # Cleanup via API
    await client.delete(f"/api/usuarios/{user_db.id}", headers=admin_headers)


@pytest.mark.anyio
async def test_usuarios_sem_permissao_erro_esperado(client: AsyncClient, create_test_user):
    """(b. erro esperado): usuário sem perfil de superuser tentando criar conta recebe 403."""
    _, op_headers = create_test_user("operador_sem_admin", "Senha123@", is_superuser=False, telas="tfd")
    
    payload = {
        "username": "invasor_user",
        "nome": "Invasor",
        "area": "ferramentas",
        "is_superuser": False,
    }
    res = await client.post("/api/usuarios/", json=payload, headers=op_headers)
    assert res.status_code == 403
    assert "superusers" in res.json().get("detail", "").lower()


@pytest.mark.anyio
async def test_usuarios_duplicidade_erro_esperado(client: AsyncClient, admin_headers: dict, create_test_user):
    """(b. erro esperado): tentar criar usuário com username já existente retorna 400."""
    create_test_user("user_existente_spec", "Senha123@")

    payload = {
        "username": "user_existente_spec",
        "nome": "Duplicado",
        "area": "ferramentas",
        "is_superuser": False,
    }
    res = await client.post("/api/usuarios/", json=payload, headers=admin_headers)
    assert res.status_code == 400
    assert "já existe" in res.json().get("detail", "").lower() or "duplicado" in res.json().get("detail", "").lower()


@pytest.mark.anyio
async def test_usuarios_concorrencia_criacao_simultanea_mesmo_username(client: AsyncClient, admin_headers: dict, db: Session):
    """(c. repetição / concorrência): 2 requisições simultâneas criando mesmo username: apenas 1 tem sucesso."""
    username_concorrente = "user_race_condition_spec"
    
    # Limpa se já existia
    existente = db.exec(select(User).where(User.username == username_concorrente)).first()
    if existente:
        prefs = db.get(UserDashboardPrefs, existente.id)
        if prefs:
            db.delete(prefs)
        db.delete(existente)
        db.commit()

    payload = {
        "username": username_concorrente,
        "nome": "Concorrente",
        "area": "ferramentas",
        "is_superuser": False,
    }

    # Dispara as duas requisições exatamente ao mesmo tempo via asyncio.gather
    req1 = client.post("/api/usuarios/", json=payload, headers=admin_headers)
    req2 = client.post("/api/usuarios/", json=payload, headers=admin_headers)
    res1, res2 = await asyncio.gather(req1, req2)

    status_codes = sorted([res1.status_code, res2.status_code])
    assert status_codes == [201, 400], f"Esperado [201, 400], obteve {status_codes}"

    # Cleanup
    user_criado = db.exec(select(User).where(User.username == username_concorrente)).first()
    if user_criado:
        await client.delete(f"/api/usuarios/{user_criado.id}", headers=admin_headers)


@pytest.mark.anyio
async def test_usuarios_limite_anti_lockout_admin(client: AsyncClient, admin_headers: dict, db: Session):
    """(d. limites / anti-lockout): admin não pode desativar a si mesmo, remover superuser ou se excluir."""
    admin = db.exec(select(User).where(User.username == "admin")).first()
    assert admin is not None

    # Tenta remover próprio superuser
    res_super = await client.put(f"/api/usuarios/{admin.id}", json={"is_superuser": False}, headers=admin_headers)
    assert res_super.status_code == 400
    assert "remover seu próprio superuser" in res_super.json().get("detail", "").lower()

    # Tenta inativar a si mesmo
    res_inativo = await client.put(f"/api/usuarios/{admin.id}", json={"is_active": False}, headers=admin_headers)
    assert res_inativo.status_code == 400
    assert "inativar a si mesmo" in res_inativo.json().get("detail", "").lower()

    # Tenta excluir a si mesmo
    res_delete = await client.delete(f"/api/usuarios/{admin.id}", headers=admin_headers)
    assert res_delete.status_code == 400
    assert "excluir a si mesmo" in res_delete.json().get("detail", "").lower()


@pytest.mark.anyio
async def test_usuarios_acesso_indevido_operador_editando_outro(client: AsyncClient, create_test_user, db: Session):
    """(e. acesso indevido): operador comum não pode editar atributos de outro usuário."""
    _, op1_headers = create_test_user("operador_comum_1", "Senha123@", is_superuser=False, telas="tfd")
    vitima, _ = create_test_user("vitima_user", "Senha123@", is_superuser=False, telas="tfd")

    res = await client.put(f"/api/usuarios/{vitima.id}", json={"is_superuser": True}, headers=op1_headers)
    assert res.status_code == 403
