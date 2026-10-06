# Dean Infra

## Docker deployment (production-docker)

1. Copy and fill environment values:
   ```bash
   cp .env.example .env
   ```
2. Add Firebase admin key as `infra-backend-v2/serviceAccountKey.json`.
3. Create the schema, then start the full stack (the database is the shared college MySQL set in `DB_*`):
   ```bash
   docker compose build
   docker compose run --rm --no-deps backend node scripts/migrate.mjs
   docker compose up -d
   ```
   For development, `docker-compose.dev.yml` adds a local MySQL that imitates the college database
   (IST clock, database `infraseva`, account without global privileges):
   ```bash
   dc() { docker compose -f docker-compose.yml -f docker-compose.dev.yml "$@"; }
   dc up -d --wait mysql && dc run --rm --no-deps backend node scripts/migrate.mjs && dc up -d --wait
   ```
4. Verify services:
   ```bash
   docker compose ps
   docker compose logs -f backend frontend proxy
   ```

## Updating production (`update.sh`)

`.github/workflows/deploy.yml` SSHes into the server on every push to `tazer` and runs
`~/dean-infra/update.sh`. You can run it by hand too; it is safe to repeat.

```bash
cd ~/dean-infra && ./update.sh
```

What it does, in order, stopping with a non-zero exit at the first failure:

1. Takes a lock (one deploy at a time).
2. Preflight: `docker`, `docker compose`, `git`, `curl` present; `.env` has `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`; `infra-backend-v2/serviceAccountKey.json` exists.
3. `git fetch` and `git reset --hard origin/tazer`. The server checkout is deploy-only; edits to tracked files are discarded (and listed). `.env`, key files, `uploads/` and `backups/` are untracked and never touched.
4. `docker compose build`, then runs the migration runner (`scripts/migrate.mjs`) and the schema check (`scripts/schema-fingerprint.mjs --check`) in throwaway containers. An unreachable database, a failing migration or an unexpected schema stops the deploy here, while the previous containers are still serving.
5. `docker compose up -d --remove-orphans`.
6. Waits up to 180 s for `backend`, `frontend` and `proxy` to be healthy; on timeout prints logs and fails.
7. Smoke-tests `http://127.0.0.1:8085/api/health` through the proxy (it also checks the database), then prunes dangling images.

The database is the shared college MySQL and is backed up by the college, not by this script. Uploaded files live on the application server and are not covered by that backup.

Overrides: `DEPLOY_BRANCH`, `HEALTH_TIMEOUT`.

Rollback: `git reset --hard <previous sha>` (printed in the deploy log), then `./update.sh` with `DEPLOY_BRANCH` set to a branch at that sha. A schema change in the shared database is never undone by rolling the code back: add a new numbered migration instead.

## Ports

- `80/443` -> reverse proxy
- `backend:5000` internal
- `frontend:5173` internal

## Notes

- Uploaded files persist in `infra-backend-v2/uploads`.
- Database: the shared college MySQL (`infraseva`). Module tables are prefixed `mnt_`, shared identity is `core_users`. See `Agent/analysis.md` for the naming rules.

## Demo login (stand-in for LDAP)

The LDAP form on the login page signs in nine fixed demo accounts (`demo.applicant`, `demo.je`, `demo.ae`, `demo.se`, `demo.dean`, `demo.director`, `demo.clerical`, `demo.accountant`, `demo.sysadmin`). It is not real LDAP. A demo account only sees demo tickets, sends no mail, and cannot touch real tickets or users. The demo Sysadmin has the admin console read-only. Full design: `Agent/demo-plan.md`.

- Off by default. To turn it on, add to the root `.env` on the server, then `docker compose restart backend`:
  - `DEMO_LDAP_ENABLED=true`
  - `DEMO_LDAP_PASSWORD=<12+ characters>` (one shared password, never commit it)
- To turn it off, set `DEMO_LDAP_ENABLED=false` and restart. Demo accounts become inactive and demo sessions are signed out.
- Demo tickets are kept between sessions (hidden while the switch is off). They use the same ticket number sequence as real tickets.
- To delete the demo data for good: `docker compose exec backend npm run demo:reset -- --yes` (add `--purge-users` to remove the accounts too).
