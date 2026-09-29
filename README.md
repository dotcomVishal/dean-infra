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
4. Dumps the database to `backups/deanery_infra_<timestamp>.sql.gz` (keeps the last 7).
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
