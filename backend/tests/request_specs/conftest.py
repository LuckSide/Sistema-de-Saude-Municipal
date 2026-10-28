import pytest
import asyncio
from typing import AsyncGenerator, Generator
from httpx import ASGITransport, AsyncClient
from sqlmodel import Session, select

from app.main import app
from app.db.session import engine
from app.models.user import User
from app.core.security import create_access_token, hash_password


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest.fixture
def db() -> Generator[Session, None, None]:
    """Sessão direta com o banco de teste PostgreSQL para consulta e verificação de estado."""
    with Session(engine) as session:
        yield session


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Cliente HTTP assíncrono conectado diretamente à aplicação FastAPI via ASGI."""
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=30.0) as ac:
        yield ac


@pytest.fixture
def admin_headers(db: Session) -> dict[str, str]:
    """Headers de autorização para o superusuário admin."""
    admin = db.exec(select(User).where(User.username == "admin")).first()
    if not admin:
        admin = User(
            username="admin",
            password_hash=hash_password("admin123"),
            is_superuser=True,
            is_active=True,
            must_change_password=False,
            telas="aps,dashboard,integracoes,tfd,usuarios,lab,apac",
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
    token = create_access_token(admin.username)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def create_test_user(db: Session):
    """Fábrica de usuários com permissões específicas no banco de teste."""
    created_users: list[int] = []

    def _create(
        username: str,
        password: str = "SenhaTeste123@",
        is_superuser: bool = False,
        is_active: bool = True,
        must_change_password: bool = False,
        telas: str = "",
        acoes: str = "{}",
    ) -> tuple[User, dict[str, str]]:
        existing = db.exec(select(User).where(User.username == username)).first()
        if existing:
            existing.password_hash = hash_password(password)
            existing.is_superuser = is_superuser
            existing.is_active = is_active
            existing.must_change_password = must_change_password
            existing.telas = telas
            existing.acoes = acoes
            db.add(existing)
            db.commit()
            db.refresh(existing)
            user = existing
        else:
            user = User(
                username=username,
                password_hash=hash_password(password),
                is_superuser=is_superuser,
                is_active=is_active,
                must_change_password=must_change_password,
                telas=telas,
                acoes=acoes,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            created_users.append(user.id)

        token = create_access_token(user.username)
        return user, {"Authorization": f"Bearer {token}"}

    yield _create

    # Cleanup de usuários temporários de teste
    with Session(engine) as cleanup_db:
        for uid in created_users:
            u = cleanup_db.get(User, uid)
            if u:
                cleanup_db.delete(u)
        cleanup_db.commit()
