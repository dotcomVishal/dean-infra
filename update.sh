#!/usr/bin/env bash
# ============================================================
#  Deanery Infra: production update (O3)
#
#  Called by .github/workflows/deploy.yml over SSH on every push to `tazer`:
#      cd ~/dean-infra && chmod +x ./update.sh && ./update.sh
#  Also safe to run by hand. Idempotent: running it twice is harmless.
#
#  Steps: lock -> preflight -> sync code -> build -> migrate -> schema check ->
#         start -> wait for healthy -> smoke test -> prune.
#  The database is the shared college MySQL (DB_* in .env); it is backed up by the
#  college, not here. Migrate and schema check run before the running containers
#  are replaced: an unreachable database, a failing migration or an unexpected
#  schema stops the deploy while the previous containers are still serving.
#  Any failure exits non-zero (so the GitHub job goes red) and prints the
#  container logs.
#
#  Environment overrides:
#    DEPLOY_BRANCH   branch to deploy            (default: tazer)
#    HEALTH_TIMEOUT  seconds to wait for healthy (default: 180)
# ============================================================
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

BRANCH="${DEPLOY_BRANCH:-tazer}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
PROXY_URL="http://127.0.0.1:8140/api/health"

log()  { printf '\n==> %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

# 1. One deploy at a time (two quick pushes must not overlap).
exec 9>.update.lock
flock -n 9 || fail "another update.sh is already running"

# 2. Preflight: fail fast with an actionable message, before touching anything.
log "Preflight"
command -v docker >/dev/null || fail "docker is not installed"
docker compose version >/dev/null 2>&1 || fail "the 'docker compose' plugin is not installed"
command -v git  >/dev/null || fail "git is not installed"
command -v curl >/dev/null || fail "curl is not installed"

[ -f .env ] || fail ".env is missing. Create it from .env.example (secrets are never in git)."
[ -f infra-backend-v2/serviceAccountKey.json ] \
  || fail "infra-backend-v2/serviceAccountKey.json is missing (Firebase Admin key, see README)."
for var in DB_HOST DB_NAME DB_USER DB_PASSWORD; do
  grep -Eq "^${var}=.+" .env || fail "${var} is empty in .env (docker-compose.yml refuses to start without it)."
done
mkdir -p infra-backend-v2/uploads

# DB_HOST=mysql means "use the bundled MySQL": load docker-compose.dev.yml for every compose call
# in this script, whether or not .env also carries COMPOSE_FILE.
if grep -Eq '^DB_HOST=mysql[[:space:]]*$' .env; then
  export COMPOSE_FILE="docker-compose.yml:docker-compose.dev.yml"
  BUNDLED_DB=1
  grep -Eq '^DEV_DB_ROOT_PASSWORD=.+' .env || fail "DEV_DB_ROOT_PASSWORD is empty in .env (needed by the bundled MySQL)."
  echo "DB_HOST=mysql: using the bundled MySQL (docker-compose.dev.yml)"
fi

# 3. Sync code. The server checkout is deploy-only, so it is made to match origin exactly.
#    Secrets (.env, key files), uploads/ and backups/ are untracked/ignored and are not touched.
log "Sync code to origin/${BRANCH}"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "WARNING: tracked files were modified on the server; they are discarded:"
  git status --short --untracked-files=no
fi
git fetch --prune origin "$BRANCH"
git checkout -q "$BRANCH" 2>/dev/null || git checkout -q -b "$BRANCH" "origin/$BRANCH"
PREVIOUS="$(git rev-parse --short HEAD)"
git reset --hard "origin/$BRANCH"
echo "Deploying $(git rev-parse --short HEAD) (was ${PREVIOUS})"

docker compose config -q || fail "docker-compose.yml / .env does not validate"

# 4. Build, then migrate and check the schema BEFORE the running containers are replaced.
log "Build"
docker compose build

# A stack that includes docker-compose.dev.yml (COMPOSE_FILE in .env) has its own mysql service.
# Start it first: the migration runs with --no-deps and would not.
if [ "${BUNDLED_DB:-0}" = "1" ]; then
  log "Start local MySQL"
  docker compose up -d --wait mysql || { docker compose logs --tail=40 mysql || true; fail "local MySQL did not start or become healthy"; }
fi

log "Migrate database"
docker compose run --rm --no-deps backend node scripts/migrate.mjs \
  || fail "migration failed; the previous containers are still running. Previous commit was ${PREVIOUS}."

log "Check schema"
docker compose run --rm --no-deps backend node scripts/schema-fingerprint.mjs --check \
  || fail "schema check failed; services were not restarted. Previous commit was ${PREVIOUS}."

# 5. Start. --remove-orphans drops containers of services deleted from the compose file.
log "Start"
docker compose up -d --remove-orphans

# 6. Wait until every service reports healthy.
log "Wait for healthy (max ${HEALTH_TIMEOUT}s)"
deadline=$((SECONDS + HEALTH_TIMEOUT))
while :; do
  unhealthy=""
  for svc in backend frontend proxy; do
    cid="$(docker compose ps -q "$svc")"
    state="$([ -n "$cid" ] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" || echo missing)"
    [ "$state" = "healthy" ] || [ "$state" = "running" ] || unhealthy="${unhealthy} ${svc}=${state}"
  done
  [ -z "$unhealthy" ] && break
  if [ "$SECONDS" -ge "$deadline" ]; then
    docker compose ps
    docker compose logs --tail=80 backend proxy || true
    fail "not healthy after ${HEALTH_TIMEOUT}s:${unhealthy}. Previous commit was ${PREVIOUS}."
  fi
  sleep 3
done

# 7. Smoke test through the same path users take (proxy -> backend).
log "Smoke test ${PROXY_URL}"
curl -fsS --retry 5 --retry-delay 2 --retry-connrefused "$PROXY_URL" >/dev/null \
  || { docker compose logs --tail=80 backend proxy || true; fail "smoke test failed"; }

# 8. Housekeeping: drop dangling images left by the rebuild.
docker image prune -f >/dev/null

log "Done: $(git rev-parse --short HEAD) is live"
