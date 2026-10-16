# 🏥 Sistema de Gestão — Secretaria Municipal de Saúde de Guapé

Sistema integrado de gestão para a Secretaria Municipal de Saúde de Guapé-MG, cobrindo regulação de exames e consultas, transporte sanitário (TFD), laboratório municipal, atenção primária (APS) e governança operacional.

![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React_18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_17-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)

---

## 📋 Índice

- [Visão Geral](#-visão-geral)
- [Stack Tecnológica](#-stack-tecnológica)
- [Módulos do Sistema](#-módulos-do-sistema)
- [Como Rodar](#-como-rodar)
- [Variáveis de Ambiente](#-variáveis-de-ambiente)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [API — Endpoints Principais](#-api--endpoints-principais)
- [Segurança e Conformidade](#-segurança-e-conformidade)
- [Credenciais Iniciais](#-credenciais-iniciais)

---

## 🎯 Visão Geral

O sistema atende às necessidades operacionais e administrativas da Secretaria de Saúde, integrando:

- **Regulação de exames e consultas** com fila de espera, priorização médica e acompanhamento público via QR Code
- **Transporte Sanitário (TFD)** com quadro semanal de viagens, controle de frota/motoristas e geração de documentos oficiais
- **Laboratório Municipal** com gestão de cotas, tabela SIGTAP oficial e faturamento BPA/SUS
- **Atenção Primária (APS)** com monitoramento dos indicadores do Novo Cofinanciamento (Portarias GM/MS 3.493/2024 e 6.907/2025)
- **Governança** com auditoria global, controle de acesso granular (RBAC) e auto-atualização

---

## 🛠 Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| **Backend** | Python 3.13 · FastAPI · SQLModel (SQLAlchemy + Pydantic v2) · Uvicorn |
| **Frontend** | React 18 · TypeScript 5.6 · Vite 6 |
| **Estilização** | Tailwind CSS 3.4 · Paleta temática SUS · Lucide Icons |
| **Tipografia** | Sora (display) · Public Sans (corpo) |
| **Banco Principal** | PostgreSQL 17 |
| **Banco PEC** | PostgreSQL do e-SUS APS (conexão read-only) |
| **Infraestrutura** | Docker · Docker Compose |
| **Autenticação** | JWT HS256 · bcrypt |

---

## 📦 Módulos do Sistema

### 🔐 Contas & Controle de Acesso

- Autenticação JWT com tokens Bearer
- RBAC granular por telas e ações (`ver`, `criar`, `editar`, `excluir`)
- Senha temporária no primeiro acesso com troca obrigatória
- Gestão de usuários com perfis e permissões em árvore hierárquica
- Proteção anti-lockout do administrador

### 🚑 TFD — Tratamento Fora do Domicílio

- **Fila de Exames/Consultas** — regulação com prioridade (rotina/urgente), filtros avançados, ações em lote, soft delete com justificativa
- **Painel Médico** — tela exclusiva para reguladores clínicos aprovarem/rejeitarem solicitações
- **Quadro Semanal de Viagens** — grid visual com Drag-and-Drop para alocar pacientes em veículos
- **Gestão de Viagens** — CRUD completo com passageiros, acompanhantes, Ordem de Circulação (.odt/.docx)
- **Agendamentos** — calendário em 3 modos (Mês/Semana/Dia), recepção, atendimento, falta e cancelamento com Undo
- **Frota & Motoristas** — cadastro com validação de CNH/DENATRAN, detecção de conflitos de horário
- **Destinos** — cidades de referência com códigos SIGTAP de deslocamento (blocos de 50km)
- **Faturamento TFD** — lançamentos BPA/APAC e diárias de transporte
- **Portal Público LGPD** — cidadão acompanha posição na fila via QR Code sem login (`/acompanhar/:token`)

### 🔬 Laboratório Municipal & BPA/SIGTAP

- **Marcação de Exames** — agendamento com verificação atômica de cotas e justificativa clínica obrigatória
- **Cotas & Vagas** — grade mensal por laboratório conveniado, liberação em lote
- **Tabela SIGTAP** — catálogo oficial DATASUS com importação de ZIP mensal (procedimentos, CBOs, CIDs)
- **Fila do PSF** — pedidos das UBSs aguardando liberação central
- **Auditoria Física** — conferência de laudos × agendados, identificação de glosas
- **Faturamento BPA** — consolidação mensal e exportação CSV/XLSX

### 📊 APS — Atenção Primária à Saúde

- 15 indicadores do Novo Cofinanciamento distribuídos em 3 blocos (Cuidado APS, Saúde Bucal, eMulti)
- Integração read-only com o Data Warehouse do e-SUS PEC
- Motor multi-fonte: `postgres` → `files` → `mock` → `auto`
- Cálculo de ISF (Indicador Sintético Final) e projeção de repasses
- Drill-down por equipe eSF e profissional

### 📈 Dashboard & Indicadores Executivos

- Widgets configuráveis por usuário (viagens do dia, fila, vagas lab, meta APS, auditoria recente)
- Gráficos de evolução histórica, volume por tipo de fila e top procedimentos
- Tendências com cálculo de variação percentual

### ⚙️ Governança & Configurações

- **Auditoria Global** — middleware ASGI em todas as mutações, diff campo-a-campo, redação de PII
- **Configurações** — identidade municipal (brasão/nome), regras operacionais, integrações PEC/RNDS
- **Cadastros** — Médicos (CRM/CBO) e Unidades de Saúde (CNES) com validações estritas
- **Importação em Lote** — upload de filas legadas via CSV/XLSX com de-para adaptativo
- **Auto-Update** — verificação no GitHub + execução via Docker socket

---

## 🚀 Como Rodar

### Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) e [Docker Compose](https://docs.docker.com/compose/install/) instalados

### Subir o ambiente

```bash
# 1. Clone o repositório
git clone <url-do-repo> && cd "Saude guape"

# 2. Configure as variáveis de ambiente
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 3. Suba os containers
docker compose up --build
```

### Acessos

| Serviço | URL |
|---------|-----|
| **Frontend** | http://localhost:5173 |
| **API** | http://localhost:8000 |
| **Swagger Docs** | http://localhost:8000/docs |
| **Health Check** | http://localhost:8000/health |

### Desenvolvimento local (sem Docker)

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev
```

---

## 🔑 Variáveis de Ambiente

### Backend (`backend/.env`)

| Variável | Descrição | Default |
|----------|-----------|---------|
| `DATABASE_URL` | DSN PostgreSQL principal | `postgresql://guape:guape@db:5432/guape` |
| `SECRET_KEY` | Chave para assinatura JWT (mín. 32 chars) | `changeme...` |
| `ALGORITHM` | Algoritmo JWT | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Validade do token | `480` (8h) |
| `FIRST_SUPERUSER` | Login do admin inicial | `admin` |
| `FIRST_SUPERUSER_PASSWORD` | Senha do admin inicial | `admin123` |
| `CORS_ORIGINS` | Origens permitidas | `http://localhost:5173` |
| `GITHUB_OWNER` | Usuário/org GitHub (auto-update) | — |
| `GITHUB_REPO` | Repositório GitHub | — |
| `UPDATE_ENABLED` | Habilitar auto-update | `false` |

### Frontend (`frontend/.env`)

| Variável | Descrição | Default |
|----------|-----------|---------|
| `VITE_API_URL` | Base URL da API | `/api` (proxy via Vite/Nginx) |

---

## 📂 Estrutura do Projeto

```
📁 Saude guape/
├── docker-compose.yml
│
├── 📁 backend/
│   ├── Dockerfile
│   ├── .env.example
│   └── app/
│       ├── main.py                     # FastAPI + lifespan + middlewares + routers
│       ├── core/
│       │   ├── config.py               # Settings via pydantic-settings
│       │   ├── security.py             # bcrypt + JWT (hash, verify, create/decode token)
│       │   ├── deps.py                 # get_current_user, require_superuser, require_senha_ok
│       │   ├── audit.py                # Middleware ASGI de auditoria global
│       │   ├── pagination.py           # Paginação padronizada genérica
│       │   └── version.py              # APP_VERSION + commit Git
│       ├── db/
│       │   ├── session.py              # Engine SQLModel + init_db (migrações idempotentes)
│       │   └── pec_views.py            # Views SQL para DW do e-SUS PEC
│       ├── models/
│       │   ├── user.py                 # User (RBAC: telas, ações, medico_id)
│       │   ├── tfd.py                  # Paciente, Viagem, ExameFila, Veiculo, Motorista, etc.
│       │   ├── lab_exames.py           # SigtapProcedimento, SigtapCbo, LabSolicitacao
│       │   ├── lab_fase6.py            # Laboratorio, VagaLab, FilaPsf, SolicMestre, ItemSolic
│       │   ├── audit.py                # AuditLog
│       │   ├── cadastros_saude.py      # Medico, UnidadeSaude
│       │   ├── dashboard_prefs.py      # UserDashboardPrefs
│       │   ├── integracoes.py          # IntegrationSettings (PEC + RNDS)
│       │   └── settings.py             # SystemSettings (cidade, brasão)
│       ├── schemas/
│       │   ├── __init__.py             # Auth, Users, Dashboard
│       │   ├── tfd.py                  # Paciente, Viagem, Exame, Faturamento, etc.
│       │   ├── lab.py                  # SIGTAP, Solicitações, BPA
│       │   ├── lab_fase6.py            # Laboratórios, Vagas, Fila PSF, Auditoria
│       │   └── cadastros_saude.py      # Médico, Unidade (validações CPF/CRM/CNES)
│       ├── services/
│       │   ├── users.py                # Auth, CRUD, senha temporária, seed
│       │   ├── tfd.py                  # Resumo TFD (KPIs)
│       │   ├── lab.py                  # Faturamento BPA, seed SIGTAP
│       │   ├── lab_fase6.py            # Agendamento atômico, cotas, auditoria lab
│       │   ├── pec.py                  # Conector e-SUS APS (15 indicadores)
│       │   ├── permissoes.py           # Motor RBAC hierárquico
│       │   ├── validacoes.py           # CPF, CNH, CRM, CNES, telefone, email
│       │   ├── sigtap_import.py        # Importador ZIP oficial SIGTAP/DATASUS
│       │   ├── importacao_filas.py     # Carga massiva CSV/XLSX
│       │   ├── ordem_circulacao.py     # Geração de Ordem de Viagem (.docx)
│       │   ├── preencher_odt.py        # Preenchimento do template ODT oficial
│       │   ├── seed_deslocamento.py    # 62 procedimentos de deslocamento SIGTAP
│       │   ├── auditoria_txt.py        # Tradução de logs técnicos para pt-BR
│       │   ├── export_xlsx.py          # Geração de planilhas Excel estilizadas
│       │   └── update.py              # Auto-update via GitHub
│       ├── api/v1/
│       │   ├── auth.py                 # POST /token, GET /me
│       │   ├── users.py                # CRUD usuários, reset senha, troca senha
│       │   ├── tfd.py                  # ~3200 linhas: pacientes, viagens, exames, frota, etc.
│       │   ├── lab.py                  # SIGTAP, solicitações, faturamento BPA
│       │   ├── lab_fase6.py            # Laboratórios, vagas, fila PSF, auditoria
│       │   ├── pec.py                  # Painel APS, indicadores, gráficos
│       │   ├── cadastros_saude.py      # Médicos e Unidades de Saúde
│       │   ├── dashboard.py            # Preferências de widgets
│       │   ├── indicadores.py          # KPIs executivos e séries temporais
│       │   ├── integracoes.py          # PEC/RNDS config + importação filas
│       │   ├── auditoria.py            # Logs, timeline, exportação
│       │   ├── settings.py             # Config municipal (público + protegido)
│       │   └── update.py               # Verificação e execução de updates
│       └── data/
│           └── sigtap_lab_seed.json    # Seed inicial de procedimentos
│
└── 📁 frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── .env.example
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js              # Paleta SUS + fontes Sora/Public Sans
    └── src/
        ├── App.tsx                     # Rotas + Guards (Protected, Guard, LabGuard, etc.)
        ├── main.tsx                    # Entry point React
        ├── index.css                   # Tailwind directives + scrollbar + animações
        ├── permissoes.ts               # Árvore RBAC de 6 módulos + EXCLUSIVAS
        ├── widgets.tsx                 # Registro de widgets do dashboard
        ├── hooks/
        │   ├── useAuth.tsx             # AuthProvider, login/logout, can(), canAny(), isMedico
        │   ├── useCidade.tsx           # Multi-tenancy: nome/brasão/favicon dinâmico
        │   └── useDisponibilidade.ts   # Conflitos de horário veículo × motorista
        ├── services/
        │   ├── api.ts                  # Axios + interceptores + tipos + submódulos de API
        │   ├── indicadores.ts          # Cálculo dos 7 indicadores Previne Brasil
        │   └── pec.ts                  # Integração direta PostgreSQL PEC
        ├── components/
        │   ├── Layout.tsx              # Shell: sidebar + header + UpdateBanner + Outlet
        │   ├── Sidebar.tsx             # Nav lateral com submenus, filtrada por permissões
        │   ├── ErrorBoundary.tsx        # Catch de erros React
        │   ├── PerfilPaciente.tsx       # Ficha 360° do paciente com timeline
        │   ├── PermissoesTree.tsx       # Árvore de checkboxes de permissões
        │   ├── TrocarSenhaModal.tsx     # Modal de troca voluntária de senha
        │   ├── UndoToast.tsx            # Toast com timer de 5s para desfazer ações
        │   ├── UpdateBanner.tsx         # Banner de nova versão disponível
        │   ├── Paginacao.tsx            # Paginação reutilizável
        │   ├── MonthPicker.tsx          # Seletor de competência mês/ano
        │   ├── GradeDias.tsx            # Calendário matricial de cotas/agendas
        │   ├── Timeline.tsx             # Linha do tempo com nós conectados
        │   ├── ExportarExcel.tsx        # Botão de exportação XLSX (SheetJS)
        │   ├── IndicadorDetalhe.tsx      # Detalhamento de indicador APS
        │   └── ui/
        │       ├── primitives.tsx       # Btn, Card, Badge, Input, Select, Modal, Skeleton
        │       └── combobox.tsx         # Select pesquisável com busca assíncrona
        ├── pages/
        │   ├── Login.tsx                # Tela de autenticação com identidade municipal
        │   ├── AlterarSenhaInicial.tsx  # Troca obrigatória de senha
        │   ├── Dashboard.tsx            # Painel com KPIs e widgets configuráveis
        │   ├── Indicadores.tsx          # Dashboard executivo de regulação
        │   ├── Usuarios.tsx             # CRUD de contas com PermissoesTree
        │   ├── Medicos.tsx              # Cadastro de médicos (CRM/CBO)
        │   ├── UnidadesSaude.tsx        # Cadastro de UBSs/PSFs (CNES)
        │   ├── Auditoria.tsx            # Trilha de auditoria com diff JSON
        │   ├── Configuracoes.tsx        # Config: município, PEC, RNDS, lote, update
        │   ├── PainelMedico.tsx         # Interface exclusiva do médico regulador
        │   ├── AcompanharExame.tsx       # Portal público LGPD (QR Code)
        │   ├── Placeholder.tsx          # Fallback de acesso negado
        │   ├── tfd/
        │   │   ├── TfdLayout.tsx        # Shell TFD com sub-rotas
        │   │   ├── TfdResumo.tsx        # KPIs operacionais do dia/mês
        │   │   ├── FilaExames.tsx       # Regulação: fila, filtros, lote, QR Code
        │   │   ├── QuadroViagens.tsx    # Grid semanal Drag-and-Drop
        │   │   ├── TfdViagens.tsx       # CRUD viagens + passageiros + documento oficial
        │   │   ├── Agendamentos.tsx     # Calendário Mês/Semana/Dia + atendimento
        │   │   ├── AgendaTfd.tsx        # Calendário mensal de rotas
        │   │   ├── TfdPacientes.tsx     # Diretório de pacientes
        │   │   ├── CatalogoExames.tsx   # Exames regulados pelo município
        │   │   ├── TfdDestinos.tsx      # Cidades de referência
        │   │   ├── TfdFrota.tsx         # Gestão de veículos
        │   │   ├── TfdMotoristas.tsx    # Cadastro de condutores
        │   │   └── TfdFaturamento.tsx   # Faturamento TFD/APAC
        │   ├── lab/
        │   │   ├── LabLayout.tsx        # Shell Lab com abas
        │   │   ├── LabMarcacao.tsx      # Marcação de exames laboratoriais
        │   │   ├── VagasAgenda.tsx      # Grade de cotas por laboratório
        │   │   ├── LabSigtap.tsx        # Catálogo SIGTAP + upload ZIP
        │   │   ├── FilaPsf.tsx          # Fila de pedidos dos PSFs
        │   │   ├── AuditLab.tsx         # Conferência física de laudos
        │   │   └── LabFaturamento.tsx   # Faturamento BPA/SUS
        │   └── aps/
        │       └── ApsPainel.tsx        # Indicadores APS + ISF + confete 🎉
        └── utils/
            ├── rotulos.ts              # Formatação pt-BR: datas, moeda, status, prioridade
            └── validacoes.ts           # CPF, CNS, máscaras, sanitização
```

---

## 🔗 API — Endpoints Principais

### Autenticação
| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/token/` | Login (retorna JWT) |
| `GET` | `/api/me` | Dados do usuário logado |
| `PUT` | `/api/usuarios/me/senha` | Troca voluntária de senha |
| `PUT` | `/api/usuarios/me/primeira-troca` | Troca obrigatória (1º acesso) |

### Usuários
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET/POST` | `/api/usuarios/` | Listar / Criar usuários |
| `PUT/DELETE` | `/api/usuarios/{id}` | Editar / Excluir |
| `POST` | `/api/usuarios/{id}/reset-senha` | Gerar senha temporária |

### TFD — Regulação & Viagens
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/tfd/resumo` | KPIs mensais do TFD |
| `GET/POST` | `/api/tfd/exames` | Fila de exames/consultas |
| `PUT` | `/api/tfd/exames/lote` | Ação em lote (até 200) |
| `PUT` | `/api/tfd/exames/{id}/prioridade` | Prioridade médica |
| `POST` | `/api/tfd/exames/{id}/recepcionar` | Check-in na recepção |
| `POST` | `/api/tfd/exames/{id}/atendimento-status` | Realizado / Faltou / Cancelou |
| `GET` | `/api/public/exames/{token}` | Portal público LGPD |
| `GET/POST` | `/api/tfd/viagens` | CRUD viagens |
| `GET` | `/api/tfd/viagens/semana` | Quadro semanal |
| `GET` | `/api/tfd/viagens/{id}/ordem-circulacao` | Download do documento oficial |
| `GET/POST` | `/api/tfd/pacientes` | CRUD pacientes |
| `GET` | `/api/tfd/pacientes/{id}/perfil` | Perfil 360° |

### Laboratório
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/lab/sigtap` | Catálogo SIGTAP |
| `POST` | `/api/lab/sigtap/importar` | Upload ZIP mensal |
| `GET/POST` | `/api/vagas` | Cotas de vagas |
| `POST` | `/api/vagas/lote-mes` | Liberação mensal em lote |
| `GET/POST` | `/api/exames/solicitacoes` | Agendamento mestre |
| `GET` | `/api/lab/prontos-faturar` | Produção pronta |
| `POST` | `/api/lab/marcar-faturado` | Faturar lote BPA |

### APS & PEC
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/painel` | Indicadores do Novo Cofinanciamento |
| `GET` | `/api/indicador/{codigo}` | Detalhe de indicador |
| `GET` | `/api/dimensoes` | Períodos, equipes e unidades |

### Configurações & Auditoria
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET/PUT` | `/api/settings` | Config municipal |
| `GET` | `/api/settings/public` | Nome/brasão (sem auth) |
| `GET` | `/api/auditoria/logs` | Trilha de auditoria |
| `GET` | `/api/auditoria/pacientes/{id}/timeline` | Timeline clínica |
| `GET` | `/api/update/status` | Verificar atualizações |
| `POST` | `/api/update/executar` | Executar auto-update |
| `GET` | `/health` | Status + versão + commit |

---

## 🔒 Segurança e Conformidade

| Aspecto | Implementação |
|---------|--------------|
| **Autenticação** | JWT HS256 com bcrypt, token de 8h, refresh via re-login |
| **RBAC** | Permissões por tela + ações granulares (`ver`, `criar`, `editar`, `excluir`) |
| **LGPD** | Portal público sem PII, redação de dados sensíveis na auditoria |
| **Auditoria** | Middleware ASGI global: diff antes/depois, redação de senhas/tokens |
| **Anti-lockout** | Admin não pode remover próprio superuser ou inativar-se |
| **Validações** | CPF (mod 11), CNH (DENATRAN), CRM (UF), CNES (7 dígitos), CNS (algoritmo MS) |
| **Headers HTTP** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store` |
| **Banco** | Porta restrita a `127.0.0.1`, `pool_pre_ping=True`, transações atômicas |

---

## 🔑 Credenciais Iniciais

| Campo | Valor |
|-------|-------|
| **Usuário** | `admin` |
| **Senha** | `admin123` |

> ⚠️ **Troque `SECRET_KEY` e `FIRST_SUPERUSER_PASSWORD`** em produção antes de expor o sistema. O admin será forçado a trocar a senha no primeiro acesso.

---

## 📄 Licença

Uso restrito à Secretaria Municipal de Saúde de Guapé-MG.
