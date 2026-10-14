#!/bin/bash
# Auto-update: git pull + rebuild Docker. Chamado via POST /api/update/executar (background).
# Só comandos fixos (whitelist) — sem input do usuário.
set -uo pipefail
LOG="${LOG_PATH:-/tmp/atualizacao.log}"
REPO="${REPO_DIR:-/repo}"
OWNER="${GITHUB_OWNER:-LuckSide}"
REPONAME="${GITHUB_REPO:-Sistema-de-Saude-Municipal}"
BRANCH="${UPDATE_BRANCH:-main}"

# Blindagem: owner/repo/branch só aceitam chars seguros (sem injeção de comando/URL).
[[ "$OWNER" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "ERRO: GITHUB_OWNER inválido"; exit 1; }
[[ "$REPONAME" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "ERRO: GITHUB_REPO inválido"; exit 1; }
[[ "$BRANCH" =~ ^[A-Za-z0-9_./-]+$ ]] || { echo "ERRO: UPDATE_BRANCH inválido"; exit 1; }
[[ "$LOG" != *".."* ]] || { echo "ERRO: LOG_PATH inválido"; exit 1; }

for c in "$REPO" /app /code .; do
  if [ -d "$c/.git" ]; then REPO="$c"; break; fi
done

exec >>"$LOG" 2>&1
echo "=== update $(date -u +%FT%TZ) repo=$REPO branch=$BRANCH ==="
cd "$REPO" || { echo "ERRO: repo não encontrado"; exit 1; }

if ! git pull origin "$BRANCH"; then
  echo "git pull falhou (sem chave SSH?) — tentando fetch https anônimo…"
  git fetch "https://github.com/$OWNER/$REPONAME.git" "$BRANCH" || { echo "ERRO: fetch falhou"; exit 1; }
  git merge --ff-only FETCH_HEAD || { echo "ERRO: merge --ff-only falhou (mudança local?)"; exit 1; }
fi
echo "HEAD atual: $(git rev-parse --short HEAD)"

if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
echo ">> $DC pull"
$DC -f docker-compose.yml pull || echo "AVISO: pull falhou (segue p/ build local)"
echo ">> $DC up -d --build"
$DC -f docker-compose.yml up -d --build || { echo "ERRO: up --build falhou"; exit 1; }
echo "=== fim OK $(date -u +%FT%TZ) ==="
