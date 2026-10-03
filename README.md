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
2. Preflight: `docker`, `docker compose`, `git`, `curl` present; `.env` has `DB_PASSWORD`; `infra-backend-v2/serviceAccountKey.json` exists.
3. `git fetch` and `git reset --hard origin/tazer`. The server checkout is deploy-only; edits to tracked files are discarded (and listed). `.env`, key files, `uploads/` and `backups/` are untracked and never touched.
4. Stage A only (`COMPOSE_PROFILES=localdb`, MySQL in a container): dumps the database to `backups/infraseva_<timestamp>.sql.gz` (keeps the last 7) as `MYSQL_USER`. With an external database no dump is taken and a warning is printed; backups are a go-live gate.
5. `docker compose up -d --build --remove-orphans`. The backend applies new `migrations/*.sql` itself on boot.
6. Waits up to 180 s for `mysql` (Stage A only), `backend`, `frontend` and `proxy` to be healthy; on timeout prints logs and fails.
7. Smoke-tests `http://127.0.0.1:8085/api/health` through the proxy, then prunes dangling images.

Overrides: `DEPLOY_BRANCH`, `HEALTH_TIMEOUT`, `BACKUP_KEEP`, `SKIP_BACKUP=1`.

Rollback: `git reset --hard <previous sha>` (printed in the deploy log), then `./update.sh` with `DEPLOY_BRANCH` set to a branch at that sha, or restore a dump from `backups/` if a migration must be undone.

## Database

Every table is prefixed `infra_` and the backend owns the schema: `infra-backend-v2/migrations/001_infra_baseline.sql`
creates everything on first boot; later changes are new numbered, additive migrations. A migration containing
`DROP`, `TRUNCATE`, `USE` or `DELETE` without `WHERE` is refused unless it carries a reviewed
`-- destructive-ok: <reason>` line. Connections are forced to UTC (the institute server runs in IST).

- **Stage A (Azure):** `COMPOSE_PROFILES=localdb`, `DB_HOST=mysql`. MySQL runs in a container.
- **Stage B (institute server):** `DB_HOST=db.iitmandi.ac.in`, `DB_NAME=infraseva`, `COMPOSE_PROFILES` unset. After the first
  successful boot set `INFRA_EXPECT_EXISTING_DB=true` and leave it set. Production credentials live only in that server's `.env`.
- **Local development / tests:** a local container only. Outside `NODE_ENV=production` the backend refuses any host but
  `localhost`, `127.0.0.1`, `::1`. Test and seed scripts need `NODE_ENV=test` and a database named `*_test`.
  Reset a local development database once (drop and recreate it); the baseline then builds the schema.

```bash
docker compose -f docker-compose.test.yml up -d --wait
cd infra-backend-v2 && npm run test:unit && npm run test:integration:local
```

## Ticket lifecycle and mail

- **After approval** the assigned JE steps a ticket through publish tender, technical evaluation, financial evaluation
  and award (final amount and agency required), or cancels the tender. `POST /api/tickets/:id/lifecycle`.
- **Resolve** is available to the JE on any open ticket (a reason is required unless the work is complete). The ticket then
  waits for its confirmer: the person who raised it, or the AE when the JE raised it. The confirmer closes it or sends it back
  to the status it was resolved from. A cancelled tender can only be acknowledged. Seven days without an answer closes it
  automatically (`AUTO_CLOSE_DAYS`, checked hourly).
- **Mail** (plain text): the JE gets assignment, reassignment, change-request, approval, rejection and send-back mail, and
  reminders (0, 12, 24, 72 h, then daily) while the ticket waits on them. The person who raised a ticket gets received,
  rejected, resolved (then one reminder a day, seven mails at most) and closed. An AE gets one mail for a ticket that needs a JE
  and one for a resolve to confirm. AE, SE and Dean get a weekly digest, Monday 09:00 IST. The Director gets none.
- **Sysadmin:** `/admin/tickets` filters by status, campus, department, priority, type, dates and section, and exports the same
  filter as CSV. A real ticket can be deleted (hidden, with a reason) and restored; nothing is removed.

## Ports

- `80/443` -> reverse proxy
- `backend:5000` internal
- `frontend:5173` internal
- `mysql:3306` internal (Stage A only)

## Notes

- Uploads: 30 MB per file. The host-level proxy in front of `127.0.0.1:8085` is outside this repo and must allow
  100 MB bodies (`client_max_body_size 100m;`); check with `sudo nginx -T | grep -n client_max_body_size`.
  A 413 with an HTML body means that proxy still has nginx's 1 MB default.
- File types are decided by extension, then verified from the file's first bytes. Rejected uploads are logged
  (`upload rejected`, with extension, declared type, detected bytes) and show up as 415 in the access log:
  `docker compose logs backend | grep '"status":4' | grep upload`.
- Rate limits are per signed-in person (600 requests / 15 min; 3000 for file downloads) and per IP on sign-in.
  Set `TRUST_PROXY_HOPS` to the number of reverse proxies in front of the backend.

- Uploaded files persist in `infra-backend-v2/uploads`.
- MySQL data persists in the `mysql_data` named volume.
