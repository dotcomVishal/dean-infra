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

## Ports

- `80/443` -> reverse proxy
- `backend:5000` internal
- `frontend:5173` internal
- `mysql:3306` internal

## Notes

- Uploaded files persist in `infra-backend-v2/uploads`.
- MySQL data persists in the `mysql_data` named volume.
