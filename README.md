# 🏥 Sistema Integrado de Gestão da Saúde Municipal

Sistema completo e integrado de gestão para Secretarias Municipais de Saúde, cobrindo regulação de exames e consultas (TFD), gestão de viagens e frotas, laboratório municipal e faturamento BPA/SUS, controle de APAC de alta complexidade, farmácia básica e validade de medicamentos, oxigenoterapia e equipamentos respiratórios domiciliares, monitoramento da Atenção Primária à Saúde (APS / Novo Cofinanciamento e-SUS PEC), mensageria via WhatsApp, portais públicos com QR Code e governança com auditoria global.

> 💡 **Origem & Liberdade de Uso Público:** Este projeto foi originalmente concebido e desenvolvido em Guapé-MG para a Secretaria Municipal de Saúde de Guapé. Sua arquitetura foi projetada para atender a **qualquer município brasileiro**, sendo parametrizável (identidade visual, brasão, unidades, frotas e regras locais) e **livre para ser utilizado, adaptado e implantado exclusivamente para fins públicos e não comerciais**.

---

![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python_3.13-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/React_18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript_5.6-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite_6-646CFF?logo=vite&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_17-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_3.4-06B6D4?logo=tailwindcss&logoColor=white)
![Nginx](https://img.shields.io/badge/Nginx_1.31-009639?logo=nginx&logoColor=white)

---

## 📋 Índice

1. [Visão Geral & Módulos](#-visão-geral--módulos)
2. [Stack Tecnológica](#-stack-tecnológica)
3. [Guia de Instalação Didático](#-guia-de-instalação-didático)
   - [Opção 1: Inicialização Rápida com Docker (Recomendado)](#opção-1-inicialização-rápida-com-docker-recomendado-para-testes-e-desenvolvimento)
   - [Opção 2: Implantação em Produção (Docker Compose Prod + Nginx + SSL)](#opção-2-implantação-em-produção-docker-compose-prod--nginx--ssl)
   - [Opção 3: Execução Local Bare-Metal (Sem Docker)](#opção-3-execução-local-bare-metal-sem-docker)
4. [Primeiro Acesso e Configuração Inicial](#-primeiro-acesso-e-configuração-inicial)
5. [Variáveis de Ambiente (.env)](#-variáveis-de-ambiente-env)
6. [Módulos do Sistema em Detalhes](#-módulos-do-sistema-em-detalhes)
7. [Estrutura do Projeto](#-estrutura-do-projeto)
8. [API — Endpoints Principais](#-api--endpoints-principais)
9. [Controle de Acesso (RBAC) e Permissões](#-controle-de-acesso-rbac-e-permissões)
10. [Segurança, Governança e LGPD](#-segurança-governança-e-lgpd)
11. [Solução de Problemas (Troubleshooting)](#-solução-de-problemas-troubleshooting)
12. [Licença e Termos de Uso](#-licença-e-termos-de-uso)

---

## 🎯 Visão Geral & Módulos

O sistema unifica a operação diária das secretarias de saúde em uma única plataforma web ágil, segura e compatível com as normas do SUS:

- 🚑 **Regulação & TFD:** Fila de espera centralizada, classificação de risco médica (rotina/urgente), detecção de pedidos duplicados, ações em lote, agendamentos, recepção com check-in, relatório analítico e portal público com QR Code.
- 🚌 **Viagens e Frotas Sanitárias:** Quadro semanal de viagens com alocação por Drag-and-Drop, controle de veículos, verificação de CNH e conflitos de escala de motoristas, geração de Ordem de Circulação oficial (.docx/.odt) e confirmação de presença do paciente sem login via link público ou QR Code.
- 🔬 **Laboratório Municipal & BPA/SUS:** Recepção e coleta de amostras, marcação com validação atômica de cotas, fila de pedidos de PSF, controle de lotes e orçamento, auditoria física de laudos com glosas, faturamento consolidado BPA e catálogo SIGTAP oficial sincronizado.
- 📋 **APAC (Alta Complexidade):** Gestão de laudos de solicitação, fluxo de regulação/autorização médica, controle de faixas de numeração do SUS e geração de arquivo magnético de remessa para o SIA/SUS.
- 💨 **Oxigenoterapia & Equipamentos Respiratórios:** Gestão de cilindros de O2, concentradores e aparelhos (CPAP/BiPAP), controle de comodato/empréstimo domiciliar com termo oficial, relatórios de consumo e requisição de Autorização de Fornecimento (AF).
- 💊 **Farmácia Municipal Básica & Insumos:** Catálogo de medicamentos com controle por lotes e validade, alertas preventivos de vencimento, controle de insumos internos e painel TV / consulta pública em tempo real para cidadãos.
- 📊 **Atenção Primária (APS) & e-SUS PEC:** Monitoramento contínuo dos 15 indicadores do Novo Cofinanciamento da Atenção Primária (Portarias GM/MS 3.493/2024 e 6.907/2025), sincronização em segundo plano com o banco do e-SUS PEC, desduplicação de pacientes e baixas automáticas de procedimentos realizados.
- 📲 **Comunicação & Notificações WhatsApp:** Envio direto de mensagens a pacientes e worker em background para disparo automático de lembretes de consultas, exames e viagens na véspera do atendimento.
- 🛡 **Governança & Auditoria:** Middleware ASGI de auditoria em todas as alterações (diff antes/depois com tradução em português claro), backup completo do banco com criptografia AES-256-GCM, auto-atualização integrada e controle de acesso hierárquico (RBAC).

---

## 🛠 Stack Tecnológica

| Camada | Tecnologia | Detalhes |
|--------|------------|----------|
| **Backend** | Python 3.13 · FastAPI 0.143 | Async ASGI, injeção de dependências, endpoints REST documentados via Swagger |
| **ORM / Banco** | SQLModel 0.0.47 · SQLAlchemy | Validação integrada com Pydantic v2, pool de alta concorrência (`pool_pre_ping=True`) |
| **Frontend** | React 18.3 · TypeScript 5.6 · Vite 6 | SPA modular, componentização moderna, renderização otimizada com lazy loading |
| **Estilização & UI** | Tailwind CSS 3.4 · Lucide Icons | Paleta temática do SUS, tipografia Sora (display) e Public Sans (corpo), acessível |
| **Banco Principal** | PostgreSQL 17 Alpine | Execução com extensão `pg_stat_statements`, parâmetros ajustados para concorrência |
| **Servidor Web & Proxy** | Nginx 1.31 · Gunicorn 23 · Uvicorn | Reverse proxy com buffers otimizados, rate limiting e terminação SSL/TLS |
| **Workers em Background** | Python Threads assíncronas | Sincronizador PEC, sincronizador SIGTAP e lembretes automáticos via WhatsApp |
| **Segurança & Criptografia**| PyJWT · Passlib / bcrypt · Cryptography | Autenticação JWT HS256, hash de senha com salt, backups criptografados com AES-GCM |

---

## 🚀 Guia de Instalação Didático

Escolha a modalidade de instalação mais adequada para a sua necessidade:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Qual o seu objetivo?                                                   │
├────────────────────────────────────────────────────────────────────────┤
│ • Testar, avaliar ou desenvolver:  ==> Opção 1 (Docker Rápido)         │
│ • Servidor de Produção Oficial:    ==> Opção 2 (Docker Compose Prod)   │
│ • Desenvolvimento sem Docker:      ==> Opção 3 (Ambiente Bare-Metal)   │
└────────────────────────────────────────────────────────────────────────┘
```

---

### Opção 1: Inicialização Rápida com Docker (Recomendado para Testes e Desenvolvimento)

Essa é a forma mais simples e rápida de rodar o sistema completo. Três containers serão provisionados automaticamente:
1. `sistema-saude-db`: PostgreSQL 17
2. `sistema-saude-api`: Backend FastAPI (com reload ativado e sincronizado com o código local)
3. `sistema-saude-web`: Frontend React empacotado com Nginx interno

#### Passo 1: Pré-requisitos
Certifique-se de ter instalado em sua máquina:
- [Git](https://git-scm.com/)
- [Docker](https://docs.docker.com/get-docker/) (versão 24 ou superior)
- [Docker Compose](https://docs.docker.com/compose/install/) (versão 2.20 ou superior)

#### Passo 2: Clonar o repositório
Abra o terminal e execute:
```bash
git clone https://github.com/LuckSide/Sistema-de-Saude-Municipal.git "Saude guape"
cd "Saude guape"
```

#### Passo 3: Configurar as variáveis de ambiente
Copie o modelo de variáveis de ambiente para a raiz do projeto (o Docker Compose lê o arquivo `.env` na raiz):
```bash
cp .env.example .env
```

*(Opcional)* Se desejar, abra o arquivo `.env` para ajustar senhas ou parâmetros. Para desenvolvimento local inicial, os padrões predefinidos já são suficientes.

#### Passo 4: Subir os containers
Execute o comando de build e subida do Docker Compose:
```bash
docker compose up --build
```
> 💡 *Dica:* Para rodar em segundo plano (modo daemon), use `docker compose up -d --build`.

#### Passo 5: Verificar o status dos serviços
Abra uma nova aba do terminal e confirme que todos os containers estão saudáveis:
```bash
docker compose ps
```
Aguarde até que o container do banco indique `(healthy)`. O backend inicializará o banco de dados e criará automaticamente o usuário administrador inicial.

#### Passo 6: Acessar a aplicação
- **Interface do Sistema (Frontend):** [http://localhost:5173](http://localhost:5173)
- **API Swagger / Documentação Interativa:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Verificação de Saúde (Health Check):** [http://localhost:8000/health](http://localhost:8000/health)

---

### Opção 2: Implantação em Produção (Docker Compose Prod + Nginx + SSL)

O arquivo [docker-compose.prod.yml](file:///home/mateus/Documentos/Saude%20guape/docker-compose.prod.yml) é configurado com hardening de segurança para servidores municipais:
- Nginx com terminação HTTPS (porta 443 com redirecionamento automático da porta 80), HTTP/2, Gzip e Rate Limiting.
- Gunicorn com multi-workers ASGI para alto volume de requisições simultâneas.
- PostgreSQL com tuning de buffers (`shared_buffers=512MB`, `effective_cache_size=1536MB`, conexões seguras).
- Isolamento de rede em rede interna do Docker (`app-network`).
- Limites estritos de CPU e Memória para evitar esgotamento de recursos.

#### Passo 1: Preparar o arquivo `.env` com credenciais seguras
Copie o template e gere credenciais criptográficas reais:
```bash
cp .env.example .env
```

Edite o `.env` e preencha obrigatoriamente:
1. **SECRET_KEY:** Gere uma chave aleatória de no mínimo 32 caracteres hexadecimais:
   ```bash
   openssl rand -hex 32
   ```
2. **POSTGRES_PASSWORD:** Defina uma senha forte exclusiva para o banco.
3. **FIRST_SUPERUSER_PASSWORD:** Defina uma senha inicial robusta para o administrador.
4. **PORT_HTTP** e **PORT_HTTPS:** Mantenha `80` e `443` (ou defina portas alternativas caso utilize um proxy reverso externo como Traefik ou Cloudflare Tunnel).

#### Passo 2: Configurar os Certificados SSL (HTTPS)
O Nginx de produção espera os certificados no diretório `./nginx/certs/`:
- Certificado completo: `./nginx/certs/fullchain.pem`
- Chave privada: `./nginx/certs/privkey.pem`

Crie o diretório e posicione os certificados:
```bash
mkdir -p nginx/certs
# Copie seus certificados gerados via Let's Encrypt / Certbot para a pasta:
# cp /etc/letsencrypt/live/seudominio.gov.br/fullchain.pem nginx/certs/fullchain.pem
# cp /etc/letsencrypt/live/seudominio.gov.br/privkey.pem nginx/certs/privkey.pem
```

> ⚠️ *Para testes locais com SSL autoassinado, gere certificados temporários com:*
> ```bash
> openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
>   -keyout nginx/certs/privkey.pem \
>   -out nginx/certs/fullchain.pem \
>   -subj "/CN=localhost"
> ```

#### Passo 3: Iniciar o ambiente de produção
Suba todos os serviços em modo daemon:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

#### Passo 4: Monitorar logs e integridade
```bash
# Ver status dos serviços
docker compose -f docker-compose.prod.yml ps

# Visualizar logs em tempo real
docker compose -f docker-compose.prod.yml logs -f backend
```

---

### Opção 3: Execução Local Bare-Metal (Sem Docker)

Caso prefira rodar os serviços diretamente na sua máquina hospedeira sem Docker:

#### Pré-requisitos
- **Python 3.13+** instalado (`python3 --version`)
- **Node.js 20+** e **npm** instalados (`node --version`)
- **PostgreSQL 16+** instalado e em execução no host

#### 1. Configurar o Banco de Dados Local
No terminal do PostgreSQL (`psql`):
```sql
CREATE USER guape WITH PASSWORD 'guape123';
CREATE DATABASE saude_guape OWNER guape;
GRANT ALL PRIVILEGES ON DATABASE saude_guape TO guape;
```

#### 2. Configurar e Iniciar o Backend
```bash
cd backend

# Criar e ativar o ambiente virtual (venv)
python3 -m venv venv
source venv/bin/activate  # No Windows: venv\Scripts\activate

# Instalar dependências
pip install --upgrade pip
pip install -r requirements.txt

# Configurar o arquivo .env do backend
cp .env.example .env

# Executar a API em modo de desenvolvimento
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
> As tabelas do banco serão criadas e populadas automaticamente no primeiro startup.

#### 3. Configurar e Iniciar o Frontend
Em outro terminal:
```bash
cd frontend

# Instalar dependências Node
npm install

# Iniciar o servidor Vite de desenvolvimento
npm run dev
```
> O servidor de desenvolvimento do Vite (na porta 5173) possui proxy automático configurado em `vite.config.ts`, encaminhando chamadas `/api` diretamente para `http://localhost:8000`.

---

## 🔑 Primeiro Acesso e Configuração Inicial

### 1. Credenciais Padrão do Administrador

| Campo | Valor Inicial | Observação |
|-------|---------------|------------|
| **Usuário** | `admin` | Superusuário inicial |
| **Senha** | `admin123` | *(ou a definida em `FIRST_SUPERUSER_PASSWORD` no `.env`)* |

> 🔒 **Troca Obrigatória de Senha:** No primeiro acesso, o sistema redireciona automaticamente o administrador para a tela `/alterar-senha-inicial`. É exigida uma nova senha segura de no mínimo 6 caracteres.

### 2. Personalização Municipal (Identidade Visual)
Acesse o menu **Configurações > Geral** (`/configuracoes?aba=geral`) para parametrizar o sistema com a identidade do seu município:
- **Nome do Município:** Ex.: *Guapé*
- **UF:** Ex.: *MG*
- **Subtítulo:** Ex.: *Secretaria Municipal de Saúde*
- **URL do Brasão Municipal:** Link para imagem PNG/SVG ou data-URI (será exibido no topo da barra lateral e nos relatórios oficiais)
- **URL do Ícone/Favicon:** Personalização da aba do navegador

### 3. Carga Inicial de Dados
Para o pleno funcionamento dos módulos operacionais, siga os passos recomendados:
1. **Tabela SIGTAP do DATASUS:**
   - Acesse **Laboratório > Tabela SIGTAP** (`/lab/sigtap`) ou **Configurações > Procedimentos**.
   - O sistema sincroniza automaticamente via worker diário, mas você também pode clicar no botão de sincronização direta ou carregar manualmente o arquivo `.zip` oficial baixado do DATASUS.
2. **Unidades de Saúde (PSFs / UBSs):**
   - Acesse **Configurações > Unidades de Saúde** (`/configuracoes?aba=unidades`) e cadastre as UBSs com código CNES oficial.
3. **Médicos e Profissionais:**
   - Acesse **Configurações > Médicos** (`/configuracoes?aba=medicos`) e vincule os profissionais aos respectivos registros CRM e CBOs.
4. **Integração com o e-SUS PEC (Opcional):**
   - Acesse **Configurações > Integração PEC** (`/configuracoes?aba=pec`), informe a string de conexão PostgreSQL do seu servidor PEC e ative a sincronização automática.

---

## 🔐 Variáveis de Ambiente (.env)

O arquivo `.env` na raiz controla as configurações centrais do sistema:

### Banco de Dados & Infraestrutura

| Variável | Descrição | Valor Padrão | Obrigatória em Produção? |
|----------|-----------|--------------|--------------------------|
| `POSTGRES_USER` | Usuário do banco PostgreSQL | `guape` | Sim |
| `POSTGRES_PASSWORD` | Senha do banco PostgreSQL | `guape123` | **Sim (Definir senha forte)** |
| `POSTGRES_DB` | Nome da base de dados | `saude_guape` | Sim |
| `DATABASE_URL` | DSN de conexão SQLAlchemy | *(calculada via compose)* | Apenas em bare-metal |
| `DB_POOL_SIZE` | Tamanho do pool de conexões | `30` | Não |
| `DB_MAX_OVERFLOW` | Conexões excedentes sob pico | `50` | Não |
| `DB_POOL_TIMEOUT` | Timeout para obter conexão | `30` (segundos) | Não |
| `DB_POOL_RECYCLE` | Tempo de reciclagem da conexão | `1800` (30 min) | Não |

### Autenticação & Segurança (FastAPI)

| Variável | Descrição | Valor Padrão | Observação |
|----------|-----------|--------------|------------|
| `SECRET_KEY` | Chave de assinatura dos tokens JWT | *chave-padrao* | **Obrigatória em prod (mín. 32 chars)** |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Tempo de expiração do token | `480` (8 horas) | Sessão renovada a cada login |
| `FIRST_SUPERUSER` | Nome de login do superuser inicial | `admin` | Criado no primeiro boot |
| `FIRST_SUPERUSER_PASSWORD` | Senha inicial do superuser | `admin123` | **Troca forçada no 1º acesso** |

### Servidor Web & Portas

| Variável | Descrição | Valor Padrão |
|----------|-----------|--------------|
| `PORT_HTTP` | Porta externa HTTP para redirecionamento | `80` |
| `PORT_HTTPS` | Porta externa HTTPS segura | `443` |
| `GUNICORN_WORKERS` | Número de workers Gunicorn em produção | `4` (ou `(2 x CPUs) + 1`) |

### Integrações Opcionais (PEC, WhatsApp, RNDS, Auto-Update)

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PEC_DATABASE_URL` | DSN de leitura do banco PostgreSQL do e-SUS PEC | *Vazio* (ou configurável via tela) |
| `PEC_FONTE` | Modo de dados do PEC (`auto`, `postgres`, `files`, `mock`) | `auto` |
| `OXIGENIO_SEED_ENABLED` | Carrega dados semente da planilha de oxigênio | `false` |
| `UPDATE_ENABLED` | Permite disparar atualização de versão via UI | `false` |
| `GITHUB_OWNER` | Dono do repositório no GitHub | `LuckSide` |
| `GITHUB_REPO` | Nome do repositório no GitHub | `Sistema-de-Saude-Municipal` |
| `GITHUB_TOKEN` | Token de leitura caso o repositório seja privado | *Opcional* |

---

## 📦 Módulos do Sistema em Detalhes

### 1. 🚑 Tratamento Fora do Domicílio (TFD) & Regulação
- **Fila de Espera Centralizada:** Listagem de pedidos de exames e consultas especializadas com paginação eficiente, busca rápida por nome, CPF e CNS, além de filtros por unidade solicitante, especialidade e status.
- **Classificação de Risco & Painel Médico:** Triagem clínica com separação entre *Rotina* e *Urgente*. Médico regulador possui painel exclusivo (`/painel-medico`) para avaliar, autorizar, priorizar ou justificar indeferimentos.
- **Detecção Inteligente de Duplicidades:** Avisos em tempo real ao cadastrar solicitações para evitar marcações repetidas do mesmo exame para o mesmo paciente.
- **Ações em Lote:** Seleção múltipla para autorização, agendamento ou cancelamento com justificativa em massa (suporte a até 200 itens por operação).
- **Entrada Descentralizada pelos PSFs:** Unidades básicas contam com tela simplificada (`/tfd/solicitacoes/nova`) com permissão restrita para lançar novos pedidos sem interferir na agenda central.
- **Agendamentos com Calendário Interativo:** Visualização em modo Mês, Semana e Dia, recepção com check-in e registro de atendimento (Realizado, Falta ou Cancelamento) com botão *Undo* de 5 segundos.
- **Comprovante de Agendamento com QR Code:** Modal de visualização e impressão direta do comprovante de comparecimento contendo QR Code exclusivo.
- **Portal Público LGPD:** Pacientes acompanham a evolução da sua posição na fila pelo celular (`/acompanhar/:token`) escaneando o QR Code do seu comprovante, sem expor dados pessoais ou requerer login.

### 2. 🚌 Gestão de Viagens e Frota Sanitária
- **Quadro Semanal Interativo:** Grid visual com dias da semana e alocação de passageiros e acompanhantes nos veículos via interface Drag-and-Drop.
- **Gestão de Veículos & Motoristas:** Cadastro de veículos da frota municipal e condutores com validação estrita de CNH (DENATRAN), vencimento de habilitação e alerta automático de conflitos de horários em viagens simultâneas.
- **Documento Oficial de Viagem:** Emissão com um clique da Ordem de Circulação em formato `.docx` e preenchimento de modelo oficial `.odt` com lista de passageiros, destinos e horários.
- **Confirmação Pública de Presença:** Envio de link individual para o WhatsApp do paciente para que ele confirme ou justifique desistência da viagem (`/confirmar-presenca/:token`), liberando a vaga para a fila de espera.
- **Leitor Rápido de QR Code:** Suporte ao uso da câmera do celular/tablet na recepção ou pelo motorista para registrar a entrada do passageiro no veículo.

### 3. 🔬 Laboratório Municipal & Faturamento BPA
- **Recepção e Coleta de Amostras:** Guichê dedicado para entrada de pacientes, conferência de pedidos e registro da coleta laboratorial.
- **Marcação com Cotas Atômicas:** Reserva de vagas com bloqueio atômico de concorrência, impedindo agendamentos além do limite contratado daquele laboratório conveniado.
- **Fila dos PSFs:** Pedidos solicitados nas unidades aguardam liberação pelo laboratório central de regulação.
- **Tabela SIGTAP DATASUS:** Catálogo oficial com hierarquia completa (Grupo, Subgrupo, Forma de Organização e Procedimentos), valores ambulatoriais e CBOs vinculados normalizados.
- **Controle de Orçamento e Lotes:** Monitoramento financeiro dos contratos de laboratório e acompanhamento dos lotes mensais autorizados.
- **Auditoria Física & Faturamento BPA:** Conferência dos laudos entregues contra os agendamentos realizados, identificação de glosas e exportação do Boletim de Produção Ambulatorial (BPA/SUS) consolidado em planilhas Excel (.xlsx) e CSV.

### 4. 📋 APAC — Alta Complexidade Ambulatorial
- **Laudos e Solicitações:** Emissão e gestão de Laudos de Solicitação de APAC (Nefrologia, Oncologia, Cirurgias Eletivas, etc.) com procedimentos principais e secundários, CID principal e justificativa clínica.
- **Impressão Padronizada:** Geração do formulário oficial de Laudo de Solicitação de APAC pronto para impressão e assinatura médica.
- **Regulação de APAC:** Fluxo de autorização pelo médico auditor municipal, com controle de carátres de atendimento e prazos de validade.
- **Faixas de Numeração Oficial:** Cadastro das faixas de números autorizadas pelo gestor estadual/SUS com controle de estoque e consumo sequencial.
- **Faturamento SIA/SUS:** Fechamento de lotes mensais e geração do arquivo magnético de remessa para importação nos programas de faturamento do Ministério da Saúde.

### 5. 💨 Oxigenoterapia Domiciliar & Equipamentos
- **Controle de Cilindros & Gases Medicinais:** Rastreamento de cilindros de oxigênio (P40, P10, etc.) próprios e em comodato, controle de recargas, recolhimento de vazios e saldo em estoque.
- **Gestão de Equipamentos:** Cadastro e rastreamento de Concentradores de O2, aparelhos CPAP e BiPAP com número de série, patrimônio e histórico de manutenção.
- **Empréstimos & Comodato:** Registro de cessão para pacientes em tratamento domiciliar com emissão de Termo de Responsabilidade e Comprovante de Empréstimo.
- **Fornecedores & Contratos:** Gestão das empresas licitadas fornecedoras de gases medicinais e insumos respiratórios.
- **Requisição AF:** Relatórios analíticos de consumo e emissão de Requisições de Autorização de Fornecimento de oxigênio.

### 6. 💊 Farmácia Municipal Básica & Insumos
- **Estoque de Medicamentos por Lote:** Cadastro do catálogo municipal com controle físico de quantidade em estoque, lote de fabricação e data de validade.
- **Painel de Validade Preventivo:** Semáforo visual com contagem regressiva e alertas de medicamentos vencidos ou a vencer em 30, 60 e 90 dias.
- **Insumos Hospitalares Internos:** Controle de materiais descartáveis, seringas, fitas de glicemia e insumos fornecidos às unidades de saúde.
- **Painel TV & Consulta Pública:** Links públicos protegidos por token (`/farmacia/publico/:token` e `/farmacia/painel-tv/:token`) com layout de alta legibilidade para TVs nas salas de espera e consulta em smartphones, mostrando a disponibilidade de remédios em tempo real.

### 7. 📊 Atenção Primária (APS) & e-SUS PEC
- **15 Indicadores do Novo Cofinanciamento:** Painel gerencial cobrindo os 3 blocos estabelecidos pelo Ministério da Saúde (Cuidado APS, Saúde Bucal e eMulti) pelas Portarias GM/MS 3.493/2024 e 6.907/2025.
- **Sincronizador Automático em Background (`pec_worker`):** Leitura periódica do banco PostgreSQL oficial do e-SUS PEC com suporte a túnel seguro SSH/VPN.
- **Desduplicação e Limpeza de Cadastros:** Higienização de cidadãos inelegíveis ou duplicados, integrando o cadastro do PEC ao prontuário municipal.
- **Baixas Automáticas de Fila:** Quando uma consulta ou exame regulado pelo TFD é registrado no e-SUS PEC por uma equipe de saúde da família, o sistema dá baixa automática na fila do TFD.
- **Projeção de ISF:** Cálculo do Indicador Sintético Final e estimativa de repasses financeiros federais.

### 8. 📲 Mensageria & Notificações WhatsApp
- **Lembretes Automáticos:** Worker em segundo plano (`whatsapp_reminder_worker`) que executa diariamente buscando todos os agendamentos de exames e viagens da data seguinte e envia mensagem de lembrete diretamente ao cidadão.
- **Botão WhatsApp Direto:** Acesso com um clique a partir do cadastro do paciente ou do agendamento para abrir conversa já formatada com os dados do atendimento no WhatsApp Web ou aplicativo móvel.

---

## 📂 Estrutura do Projeto

```
📁 Saude guape/
├── 📄 docker-compose.yml              # Ambiente de desenvolvimento / testes rápidos
├── 📄 docker-compose.prod.yml         # Ambiente de produção otimizado com Nginx + SSL
├── 📄 .env.example                    # Modelo mestre de variáveis de ambiente
├── 📄 pytest.ini                      # Configuração dos testes automatizados backend
│
├── 📁 nginx/                          # Configurações do Nginx em produção
│   ├── 📄 nginx.conf                  # Proxy reverso, gzip, rate-limiting e regras TLS
│   └── 📁 certs/                      # Diretório de certificados SSL (fullchain.pem / privkey.pem)
│
├── 📁 backend/
│   ├── 📄 Dockerfile                  # Build multi-stage enxuto baseado em python:3.13-alpine
│   ├── 📄 requirements.txt            # Dependências Python travadas
│   ├── 📄 gunicorn_conf.py            # Configurações do servidor ASGI de produção
│   └── 📁 app/
│       ├── 📄 main.py                 # Ponto de entrada FastAPI, middlewares e background workers
│       ├── 📁 core/
│       │   ├── 📄 config.py           # Leitura e validação de configurações com pydantic-settings
│       │   ├── 📄 security.py         # Criptografia, geração e decodificação de JWTs com bcrypt
│       │   ├── 📄 deps.py             # Dependências FastAPI (get_db, require_superuser, auth)
│       │   ├── 📄 audit.py            # Middleware ASGI de trilha de auditoria global
│       │   └── 📄 version.py          # Controle de versão e commit Git
│       ├── 📁 db/
│       │   ├── 📄 session.py          # Conexão SQLModel, pool e migração DDL automática
│       │   └── 📄 pec_views.py        # Views SQL para leitura do banco do e-SUS PEC
│       ├── 📁 models/
│       │   ├── 📄 user.py             # Modelo User e perfis de acesso
│       │   ├── 📄 tfd.py              # Paciente, Viagem, ExameFila, Veiculo, Motorista, Destino
│       │   ├── 📄 lab_exames.py       # SIGTAP Procedimentos, CBOs e Solicitações de Laboratório
│       │   ├── 📄 lab_fase6.py        # Laboratorio, VagaLab, FilaPsf, Lotes e Orçamentos
│       │   ├── 📄 apac.py             # SolicitacaoAPAC, FaixaNumeracao, LoteFaturamentoAPAC
│       │   ├── 📄 oxigenio.py         # Cilindro, EquipamentoRespiratorio, Emprestimo, Licitação
│       │   ├── 📄 farmacia.py         # Medicamento, Movimentação, InsumoInterno, LinkPublico
│       │   ├── 📄 cadastros_saude.py  # Medico (CRM/CBO) e UnidadeSaude (CNES)
│       │   ├── 📄 integracoes.py      # IntegrationSettings (PEC, RNDS, WhatsApp) e Logs
│       │   └── 📄 audit.py            # AuditLog (histórico completo de mutações)
│       ├── 📁 api/v1/
│       │   ├── 📄 auth.py             # POST /api/token/ e perfil do usuário autenticado
│       │   ├── 📄 users.py            # CRUD de usuários, reset e troca de senhas
│       │   ├── 📄 tfd.py              # Regulação, fila, agendamentos, viagens e portais públicos
│       │   ├── 📄 lab.py              # Marcação de exames laboratoriais e tabela SIGTAP
│       │   ├── 📄 lab_fase6.py        # Cotas de vagas, fila PSF, orçamentos e auditoria
│       │   ├── 📄 apac.py             # Laudos de solicitação, regulação e faturamento APAC
│       │   ├── 📄 oxigenio.py         # Gestão de gases, equipamentos, comodato e relatórios AF
│       │   ├── 📄 farmacia.py         # Estoque de farmácia, validade, insumos e painel TV
│       │   ├── 📄 pec.py              # Painel APS e indicadores do Novo Cofinanciamento
│       │   ├── 📄 cadastros_saude.py  # Médicos e Unidades Básicas de Saúde
│       │   ├── 📄 whatsapp.py         # Mensageria e testes de conexão com WhatsApp
│       │   ├── 📄 backup.py           # Exportação e restauração de snapshots criptografados
│       │   ├── 📄 auditoria.py        # Consulta a logs de auditoria e timeline clínica
│       │   ├── 📄 settings.py         # Configurações do município (brasão, cores, título)
│       │   └── 📄 update.py           # Verificação e execução de auto-update
│       └── 📁 services/
│           ├── 📄 pec_worker.py       # Worker assíncrono de sincronização contínua com o PEC
│           ├── 📄 pec_sync.py         # Lógica de integração e desduplicação de pacientes
│           ├── 📄 sigtap_worker.py    # Worker de atualização da base SIGTAP do DATASUS
│           ├── 📄 sigtap_hierarquia.py# Navegação na árvore oficial de procedimentos do SUS
│           ├── 📄 whatsapp_reminder_worker.py # Worker de disparo diário de lembretes
│           ├── 📄 backup_crypto.py    # Criptografia simétrica com chave derivada (AES-GCM)
│           ├── 📄 backup_service.py   # Extração e restauração de dumps JSON compactados
│           ├── 📄 ordem_circulacao.py # Geração da Ordem de Viagem oficial em Word (.docx)
│           ├── 📄 preencher_odt.py    # Preenchimento de modelo aberto ODT
│           ├── 📄 export_xlsx.py      # Exportador universal de relatórios em Excel estilizado
│           └── 📄 validacoes.py       # Validadores de CPF, CNS, CNH, CRM, CNES e emails
│
├── 📁 frontend/
│   ├── 📄 Dockerfile                  # Build multi-stage com Node 22 e servidor Nginx slim
│   ├── 📄 nginx.conf                  # Configurações do Nginx embutido no container web
│   ├── 📄 package.json                # Dependências React 18, Vite 6 e Tailwind CSS
│   ├── 📄 vite.config.ts              # Bundler Vite com proxy reverso local para o backend
│   └── 📁 src/
│       ├── 📄 App.tsx                 # Roteamento SPA com lazy loading e guards de permissão
│       ├── 📄 permissoes.ts           # Definição formal da árvore de permissões RBAC
│       ├── 📁 components/             # Componentes reutilizáveis
│       │   ├── 📄 Layout.tsx          # Shell estrutural com Sidebar e Topbar
│       │   ├── 📄 Sidebar.tsx         # Navegação lateral dinâmica filtrada por papéis
│       │   ├── 📄 PerfilPaciente.tsx  # Prontuário e linha do tempo de 360° do cidadão
│       │   ├── 📄 BotaoWhatsApp.tsx   # Gatilho de disparo de mensagens pré-formatadas
│       │   ├── 📄 ModalLeituraRapidaQR.tsx # Leitor de QR Code usando a câmera
│       │   ├── 📄 ComprovanteExameModal.tsx # Emissão do comprovante de agendamento
│       │   └── 📄 AlertaPedidoDuplicado.tsx # Aviso de prevenção de solicitações idênticas
│       ├── 📁 pages/
│       │   ├── 📁 tfd/                # Telas de Regulação, Agendamento, Fila, Frota e Viagens
│       │   ├── 📁 lab/                # Telas de Marcação, Recepção, Vagas, SIGTAP e Lotes
│       │   ├── 📁 apac/               # Telas de Solicitação, Regulação e Faturamento APAC
│       │   ├── 📁 oxigenio/           # Painel de Estoque, Equipamentos, Empréstimos e Fornecedores
│       │   ├── 📁 farmacia/           # Medicamentos, Controle de Validade, Insumos e Painel TV
│       │   ├── 📁 aps/                # Painel de Indicadores APS do Novo Cofinanciamento
│       │   ├── 📄 Dashboard.tsx       # Visão executiva com cards operacionais customizáveis
│       │   ├── 📄 Configuracoes.tsx   # Painel central de integrações, município e backups
│       │   ├── 📄 Auditoria.tsx       # Interface de trilha de auditoria com diff JSON
│       │   ├── 📄 AcompanharExame.tsx # Portal público de consulta da fila via QR Code
│       │   └── 📄 ConfirmarPresencaViagem.tsx # Portal público de confirmação de presença
│       └── 📁 services/
│           └── 📄 api.ts              # Cliente Axios tipado com tratamento unificado de erros
│
└── 📁 scripts/                        # Scripts de utilidade e auditoria de segurança
    └── 📄 scan_secrets.py             # Scanner contra vazamento acidental de credenciais
```

---

## 🔗 API — Endpoints Principais

A documentação interativa completa (OpenAPI / Swagger UI) fica disponível em `/docs`. Abaixo estão os principais endpoints agrupados por módulo:

### Autenticação & Usuários
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/token/` | Autenticação com usuário/senha (retorna JWT Bearer) |
| `GET` | `/api/me` | Retorna o perfil, permissões e dados do usuário conectado |
| `PUT` | `/api/usuarios/me/senha` | Troca voluntária da senha atual |
| `PUT` | `/api/usuarios/me/primeira-troca` | Troca obrigatória de senha no primeiro login |
| `GET/POST`| `/api/usuarios/` | Listagem e cadastro de usuários do sistema |
| `POST` | `/api/usuarios/{id}/reset-senha` | Gera nova senha temporária para o usuário |

### TFD — Regulação, Viagens & Portais Públicos
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/tfd/resumo` | KPIs operacionais do TFD (pendentes, agendados, viagens) |
| `GET/POST`| `/api/tfd/exames` | Fila de espera de exames e consultas especializadas |
| `PUT` | `/api/tfd/exames/lote` | Ação em lote (autorizar, agendar, alterar status) |
| `PUT` | `/api/tfd/exames/{id}/prioridade`| Alteração da prioridade clínica (médico regulador) |
| `GET/POST`| `/api/tfd/viagens` | CRUD de viagens municipais |
| `GET` | `/api/tfd/viagens/semana` | Dados do quadro semanal para o Grid Drag-and-Drop |
| `GET` | `/api/tfd/viagens/{id}/ordem-circulacao` | Download da Ordem de Circulação oficial (.docx) |
| `GET` | `/api/tfd/public/exames/{token}` | **Público:** Posição na fila de espera via QR Code |
| `GET` | `/api/tfd/public/viagem-confirmacao/{token}` | **Público:** Dados da viagem para confirmação |
| `POST`| `/api/tfd/public/viagem-confirmacao/{token}` | **Público:** Confirmação ou recusa de presença |

### Laboratório Municipal & Faturamento BPA
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET/POST`| `/api/vagas` | Consulta e criação de cotas de vagas laboratoriais |
| `POST` | `/api/vagas/lote-mes` | Liberação mensal de vagas em lote |
| `GET/POST`| `/api/exames/solicitacoes` | Agendamento atômico de pedidos laboratoriais |
| `GET` | `/api/lab/sigtap` | Catálogo de procedimentos da tabela SIGTAP |
| `POST` | `/api/lab/sigtap/sincronizar` | Disparo manual da sincronização com o DATASUS |
| `GET` | `/api/lab/prontos-faturar` | Relação de exames concluídos prontos para o BPA |
| `POST` | `/api/lab/marcar-faturado` | Fechamento de lote e geração de remessa BPA |

### APAC — Alta Complexidade
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET/POST`| `/api/apac/solicitacoes` | Listagem e criação de Laudos de Solicitação de APAC |
| `GET` | `/api/apac/solicitacoes/{id}` | Detalhes completos do laudo com procedimentos secundários |
| `POST` | `/api/apac/solicitacoes/{id}/autorizar` | Autorização do laudo pelo médico regulador |
| `POST` | `/api/apac/solicitacoes/{id}/gerar-laudo-pdf` | Geração do formulário oficial para impressão |
| `GET/POST`| `/api/apac/faixas` | Gestão das faixas de numeração autorizadas do SUS |
| `POST` | `/api/apac/faturamento/gerar-remessa` | Geração do arquivo magnético de remessa SIA/SUS |

### Oxigenoterapia & Equipamentos Respiratórios
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/oxigenio/resumo-estoque` | Balanço consolidado de cilindros, recargas e equipamentos |
| `GET/POST`| `/api/oxigenio/equipamentos` | Cadastro e consulta de concentradores, CPAP e BiPAP |
| `GET/POST`| `/api/oxigenio/emprestimos` | Empréstimos em comodato para pacientes domiciliares |
| `POST` | `/api/oxigenio/trocas` | Registro de troca de cilindro vazio por cheio no domicílio |
| `GET` | `/api/oxigenio/relatorios/requisicao-af` | Relatório consolidado para autorização de fornecimento |

### Farmácia Básica Municipal
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET/POST`| `/api/farmacia/medicamentos` | Catálogo de remédios, estoque físico e lote/validade |
| `GET` | `/api/farmacia/validade/painel` | Painel de monitoramento de remédios vencidos ou a vencer |
| `GET/POST`| `/api/farmacia/insumos` | Gestão de materiais descartáveis e de uso interno |
| `GET` | `/api/farmacia/publico/{token}` | **Público:** Consulta em tempo real para cidadãos e TVs |

### Governança, Backups, APS & WhatsApp
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/painel` | Indicadores consolidados do Novo Cofinanciamento da APS |
| `GET` | `/api/auditoria/logs` | Trilha de auditoria global com diff das alterações |
| `POST` | `/api/backup/exportar` | Download de snapshot completo criptografado (AES-256-GCM) |
| `POST` | `/api/backup/restaurar` | Restauração segura do banco de dados a partir de arquivo |
| `POST` | `/api/whatsapp/enviar-lembretes-amanha` | Disparo manual da rotina de lembretes da véspera |
| `GET` | `/health` | Status de saúde da API, versão e hash do commit atual |

---

## 🛡 Controle de Acesso (RBAC) e Permissões

O sistema possui uma estrutura hierárquica e granular de permissões dividida em 6 grandes módulos. Cada tela pode receber individualmente permissões para **Ver**, **Criar**, **Editar** e **Excluir**:

```
├── 📊 Painel (dashboard)
│   └── Indicadores e Agenda (dash_indicadores)
│
├── 🚑 Transporte · TFD (tfd)
│   ├── Resumo TFD (tfd_resumo)
│   ├── Viagens (tfd_viagens)
│   ├── Viagens — Alterar datas passadas (tfd_viagens_passadas) *Exclusiva
│   ├── Pacientes (tfd_pacientes)
│   ├── Fila de Espera e Regulação (tfd_exames)
│   ├── Lançamento Exclusivo PSF (tfd_fila_lancamento) *Exclusiva
│   ├── Agenda e Recepção (tfd_agenda)
│   ├── Relatório de Agendados (tfd_relatorio_agendados)
│   ├── Painel Médico Regulador (tfd_medico) *Exclusiva
│   ├── Catálogo de Procedimentos (tfd_catalogo)
│   ├── Destinos de Viagem (tfd_destinos)
│   ├── Frota de Veículos (tfd_frota)
│   ├── Motoristas (tfd_motoristas)
│   └── Faturamento TFD (tfd_faturamento)
│
├── 🔬 Exames Laboratoriais (lab)
│   ├── Recepção e Coleta (lab_recepcao) *Exclusiva
│   ├── Marcação de Exames de Sangue (lab_marcacao)
│   ├── Fila de Pedidos PSF (lab_fila)
│   ├── Vagas e Agenda (lab_agenda / lab_vagas)
│   ├── Auditoria de Laudos e Glosas (lab_audit)
│   ├── Faturamento BPA (lab_faturamento)
│   ├── Tabela SIGTAP (lab_sigtap)
│   └── Controle de Orçamento e Lotes (lab_orcamento)
│
├── 📋 APAC · Alta Complexidade (apac)
│   ├── Laudos e Solicitações (apac_solicitacao)
│   ├── Regulação e Autorização Médica (apac_regulacao) *Exclusiva
│   └── Faturamento APAC SIA/SUS (apac_faturamento)
│
├── 💨 Oxigênio & Equipamentos (oxigenio)
│   ├── Estoque e Licitações (oxigenio_estoque)
│   ├── Gestão de Equipamentos (oxigenio_equipamentos)
│   ├── Empréstimos e Comodato (oxigenio_emprestimos)
│   ├── Empresas Fornecedoras (oxigenio_empresas)
│   └── Relatórios e Requisições AF (oxigenio_relatorios)
│
├── 💊 Farmácia Municipal & Insumos (farmacia)
│   ├── Medicamentos & Estoque (farmacia_estoque)
│   ├── Controle de Validade & Lotes (farmacia_validade)
│   ├── Painéis TV & Consulta Pública (farmacia_links)
│   └── Insumos & Materiais Internos (farmacia_insumos)
│
├── 📈 Atenção Primária · APS Previne (aps)
│
└── ⚙️ Configurações & Contas (integracoes / usuarios)
    ├── Gestão de Usuários (usuarios)
    ├── Trilha de Auditoria (auditoria) *Exclusivo Superuser
    └── Backup e Restauração Criptografados (cfg_backup) *Exclusivo Superuser
```
> *\*Telas exclusivas:* Por segurança clínica e operacional, telas marcadas como exclusivas exigem concessão nominal na árvore do usuário (não são herdadas automaticamente pelo módulo pai).

---

## 🔒 Segurança, Governança e LGPD

- **Em Conformidade com a LGPD:** Os links públicos de consulta da fila de espera (`/acompanhar/:token`) e de confirmação de presença (`/confirmar-presenca/:token`) utilizam tokens seguros não enumeráveis gerados com entropia criptográfica. Nenhum dado sensível como CPF completo, RG ou histórico clínico desnecessário é exposto publicamente.
- **Auditoria Transparente (Middleware ASGI):** Todas as mutações de dados (`POST`, `PUT`, `PATCH`, `DELETE`) passam por auditoria automática. O sistema armazena quem alterou, quando, qual endereço IP e o diff completo (valor antigo versus novo), traduzindo termos técnicos para texto compreensível em português.
- **Proteção Anti-Lockout:** O sistema impede que o último administrador ativo remova seu próprio perfil de superusuário ou inative a própria conta, evitando travamentos acidentais na gestão.
- **Validações Estritas de Documentos:**
  - **CPF e CNS:** Algoritmo oficial de verificação de dígitos e regras do Ministério da Saúde.
  - **CNH:** Validação de formato e regras do DENATRAN.
  - **CRM:** Validação combinada de número e Unidade Federativa.
  - **CNES:** Validação padrão de 7 dígitos numéricos do Cadastro Nacional de Estabelecimentos de Saúde.
- **Backups Criptografados com Senha:** As cópias de segurança geradas pelo painel administrativo são compactadas com gzip e criptografadas com o padrão militar AES-256-GCM. Nenhuma informação de saúde pode ser restaurada ou lida sem a senha definida pelo administrador no momento da exportação.
- **Cabeçalhos de Segurança HTTP:**
  - `Content-Security-Policy` estrito
  - `X-Frame-Options: DENY` (anti-clickjacking)
  - `X-Content-Type-Options: nosniff` (anti-MIME-sniffing)
  - `Strict-Transport-Security` (forçamento de HTTPS em produção)
  - `Referrer-Policy: strict-origin-when-cross-origin`

---

## ❓ Solução de Problemas (Troubleshooting)

### 1. A porta 5173, 8000 ou 5432 já está em uso
**Causa:** Outro serviço (como um PostgreSQL local ou outro container) já está escutando na porta.
**Solução:**
- Verifique quem está usando a porta: `sudo lsof -i :5432` ou `sudo netstat -tlpn | grep 5432`.
- Altere a porta mapeada no arquivo `docker-compose.yml` (exemplo: mudar de `"5173:80"` para `"5174:80"`).

### 2. Erro de execução em produção: `CRITICAL SECURITY FAILURE: SECRET_KEY padrão detectada`
**Causa:** Por segurança estrita, o sistema recusa-se a inicializar em modo de produção caso a `SECRET_KEY` seja a chave padrão de exemplo.
**Solução:**
- Abra o terminal do servidor e gere uma nova chave:
  ```bash
  openssl rand -hex 32
  ```
- Cole o valor resultante na variável `SECRET_KEY` no seu arquivo `.env` e reinicie os containers.

### 3. Falha de conexão entre o Docker e o e-SUS PEC no mesmo servidor
**Causa:** O container Docker não consegue alcançar o PostgreSQL do e-SUS PEC usando `localhost` ou `127.0.0.1` porque cada container possui sua própria interface de rede interna.
**Solução:**
- Utilize `host.docker.internal` como endereço do host na string de conexão do PEC.
- Certifique-se de que o arquivo `postgresql.conf` do e-SUS PEC possua `listen_addresses = '*'` e que o arquivo `pg_hba.conf` do PEC permita a faixa de IP da rede bridge do Docker (ex.: `172.17.0.0/16`).

### 4. Como resetar o banco de dados em ambiente de desenvolvimento
Caso deseje zerar o banco de testes e reconstruir do zero:
```bash
# Derrubar os containers e apagar o volume do banco de dados
docker compose down -v

# Subir novamente recriando as tabelas e o administrador inicial
docker compose up --build
```

---

## 📄 Licença e Termos de Uso

Este sistema foi concebido e desenvolvido originalmente em Guapé-MG para a **Secretaria Municipal de Saúde de Guapé**.

O código foi arquitetado de forma modular e aberta para permitir que qualquer prefeitura, consórcio intermunicipal ou secretaria de saúde do Brasil possa utilizá-lo gratuitamente, sob os seguintes termos:

- 🏛 **Livre Utilização Pública:** Qualquer órgão público, secretaria ou município brasileiro pode utilizar, implantar, adaptar e estudar o sistema para modernizar seus serviços de saúde.
- 🚫 **Estritamente Não Comercial:** É vedada qualquer forma de comercialização, revenda, licenciamento pago, empacotamento em produtos proprietários ou exploração comercial deste código, seja em sua forma original ou derivada.
- 🤝 **Compartilhamento de Melhorias:** Sugestões, correções e novas funcionalidades que beneficiem o Sistema Único de Saúde (SUS) são encorajadas a serem submetidas de volta à comunidade.
