# Sistema de Gestão — Secretaria de Saúde de Guapé

Fase 1: Infra + Módulo de Contas.

## Subir

```bash
docker compose up --build
```

- Front: http://localhost:5173
- API: http://localhost:8000
- Docs: http://localhost:8000/docs

Login inicial: `admin` / `admin123`. Trocar após primeiro acesso.

## Estrutura

```
backend/app/
  main.py          -> FastAPI + routers + seed
  core/config.py   -> settings via env
  core/security.py -> hash bcrypt + JWT
  core/deps.py     -> current_user / superuser
  db/session.py    -> engine SQLModel
  models/user.py   -> tabela usuarios
  schemas/         -> pydantic in/out
  services/        -> regra negocio
  api/v1/          -> auth + users
frontend/src/
  pages/Login.tsx + Dashboard.tsx
  components/ui/*  -> shadcn mínimo
  services/api.ts  -> axios + JWT
  hooks/useAuth.tsx
```
