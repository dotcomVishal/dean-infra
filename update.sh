#!/usr/bin/env bash
# ============================================================
#  Deanery Infra: production update (O3)
#
#  Called by .github/workflows/deploy.yml over SSH on every push to `tazer`:
#      cd ~/dean-infra && chmod +x ./update.sh && ./update.sh
#  Also safe to run by hand. Idempotent: running it twice is harmless.
#
#  Steps: lock -> preflight -> sync code -> back up DB -> build + start ->
#         wait for healthy -> smoke test -> prune.
#  Any failure exits non-zero (so the GitHub job goes red) and prints the
#  container logs. Schema changes need no step here: the backend applies
#  migrations/*.sql itself on boot (src/config/migrate.js).
#
#  Environment overrides:
#    DEPLOY_BRANCH   branch to deploy            (default: tazer)
#    HEALTH_TIMEOUT  seconds to wait for healthy (default: 180)
#    BACKUP_KEEP     DB dumps to keep            (default: 7)
#    SKIP_BACKUP=1   skip the pre-deploy DB dump
# ============================================================
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

BRANCH="${DEPLOY_BRANCH:-tazer}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"
PROXY_URL="http://127.0.0.1:8085/api/health"

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
grep -Eq "^DB_PASSWORD=.+" .env || fail "DB_PASSWORD is empty in .env (docker-compose.yml refuses to start without it)."

# Stage A (Azure) runs MySQL in a container (COMPOSE_PROFILES=localdb). Stage B uses the
# institute database over the network: no mysql container, no local dump.
LOCALDB=0
if [ -n "$(docker compose ps -q mysql 2>/dev/null)" ] || grep -Eq '^COMPOSE_PROFILES=.*localdb' .env; then
  LOCALDB=1
fi
mkdir -p infra-backend-v2/uploads backups

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

# NEVER run `docker volume prune`, `docker compose down -v` or `docker system prune --volumes`
# here: mysql_data holds the database (Stage A) and uploads/ is a bind mount.

# 4. Back up the database before new code (and its migrations) touch it.
if [ "$LOCALDB" = "0" ]; then
  log "Backup skipped"
  echo "WARNING: no backup is taken for the external database. Backups are a go-live gate (Master plan 2.5)."
elif [ "${SKIP_BACKUP:-0}" != "1" ] && [ -n "$(docker compose ps -q --status running mysql 2>/dev/null)" ]; then
  log "Backup database"
  DUMP="backups/infraseva_$(date +%Y%m%d_%H%M%S).sql.gz"
  TMP_DUMP="${DUMP}.tmp"
  if docker compose exec -T mysql sh -c \
    'mysqldump -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --single-transaction --routines --no-tablespaces "$MYSQL_DATABASE"' \
    | gzip > "$TMP_DUMP"; then
    :
  else
    rm -f "$TMP_DUMP" "$DUMP"
    fail "database backup failed; deploy aborted, nothing was changed"
  fi
  mv "$TMP_DUMP" "$DUMP"
  echo "Saved ${DUMP}"
  # shellcheck disable=SC2012
  ls -1t backups/infraseva_*.sql.gz 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm -f --
else
  log "Backup skipped (first deploy, database not running, or SKIP_BACKUP=1)"
fi

# 5. Build and start. --remove-orphans drops containers of services deleted from the compose file.
log "Build and start"
docker compose up -d --build --remove-orphans

# 6. Wait until every service reports healthy.
log "Wait for healthy (max ${HEALTH_TIMEOUT}s)"
deadline=$((SECONDS + HEALTH_TIMEOUT))
while :; do
  unhealthy=""
  svcs="backend frontend proxy"
  [ "$LOCALDB" = "1" ] && svcs="mysql ${svcs}"
  for svc in $svcs; do
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
