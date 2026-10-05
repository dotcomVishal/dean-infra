# Dean Infra

## Docker deployment (production-docker)

1. Copy and fill environment values:
   ```bash
   cp .env.example .env
   ```
2. Add Firebase admin key at repository root as `serviceAccountKey.json`.
3. Start full stack:
   ```bash
   docker compose up -d --build
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
2. Preflight: `docker`, `docker compose`, `git`, `curl` present; `.env` has `DB_ROOT_PASSWORD` and `DB_PASSWORD`; `infra-backend-v2/serviceAccountKey.json` exists.
3. `git fetch` and `git reset --hard origin/tazer`. The server checkout is deploy-only; edits to tracked files are discarded (and listed). `.env`, key files, `uploads/` and `backups/` are untracked and never touched.
4. Dumps the database to `backups/deanery_infra_<timestamp>.sql.gz` (keeps the last 7). It tries root first, then falls back to `MYSQL_USER` if root auth has drifted on a persistent volume.
5. `docker compose up -d --build --remove-orphans`. The backend applies new `migrations/*.sql` itself on boot.
6. Waits up to 180 s for `mysql`, `backend`, `frontend` and `proxy` to be healthy; on timeout prints logs and fails.
7. Smoke-tests `http://127.0.0.1:8085/api/health` through the proxy, then prunes dangling images.

Overrides: `DEPLOY_BRANCH`, `HEALTH_TIMEOUT`, `BACKUP_KEEP`, `SKIP_BACKUP=1`.

Rollback: `git reset --hard <previous sha>` (printed in the deploy log), then `./update.sh` with `DEPLOY_BRANCH` set to a branch at that sha, or restore a dump from `backups/` if a migration must be undone.

## Ports

- `80/443` -> reverse proxy
- `backend:5000` internal
- `frontend:5173` internal
- `mysql:3306` internal

## Notes

- Uploaded files persist in `infra-backend-v2/uploads`.
- MySQL data persists in the `mysql_data` named volume.

## Demo login (stand-in for LDAP)

The LDAP form on the login page signs in nine fixed demo accounts (`demo.applicant`, `demo.je`, `demo.ae`, `demo.se`, `demo.dean`, `demo.director`, `demo.clerical`, `demo.accountant`, `demo.sysadmin`). It is not real LDAP. A demo account only sees demo tickets, sends no mail, and cannot touch real tickets or users. The demo Sysadmin has the admin console read-only. Full design: `Agent/demo-plan.md`.

- Off by default. To turn it on, add to the root `.env` on the server, then `docker compose restart backend`:
  - `DEMO_LDAP_ENABLED=true`
  - `DEMO_LDAP_PASSWORD=<12+ characters>` (one shared password, never commit it)
- To turn it off, set `DEMO_LDAP_ENABLED=false` and restart. Demo accounts become inactive and demo sessions are signed out.
- Demo tickets are kept between sessions (hidden while the switch is off). They use the same ticket number sequence as real tickets.
- To delete the demo data for good: `docker compose exec backend npm run demo:reset -- --yes` (add `--purge-users` to remove the accounts too).
