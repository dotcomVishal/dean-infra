# Progress — Phase 1 (Hotfixes)

Status: **complete**. Branch: `tazer`. Scope: patch current model only, per `plan.md` §4 Phase 1. No schema changes, no new tables, no new endpoints.

## Security & Infrastructure

- **S1** — `infra-backend-v2/src/controllers/ticketController.js`
  - `publishTender`: refuses unless ticket is `APPROVED_FOR_TENDERING`; compare-and-swap `UPDATE ... WHERE status = 'APPROVED_FOR_TENDERING'`.
  - `awardTender`: refuses unless ticket is `APPROVED_FOR_TENDERING` or `TENDER_PUBLISHED`; compare-and-swap on the same status just validated.
  - Both now map `WorkflowError` to their `status`/`code` instead of a raw 500, and no longer leak `error.message`.
  - `infra-backend-v2/src/routes/ticketRoutes.js`: dropped `JE` from `POST /:ticket_id/tenders` and `POST /:ticket_id/tenders/award` — Clerical/SYSADMIN only.
- **S8** — `infra-backend-v2/src/app.js`: added `app.set('trust proxy', 1)` so the rate limiter keys off the real client IP behind nginx, not the proxy's.
- **S9** — `nginx-proxy.conf`: removed the `Access-Control-Allow-*` headers and the OPTIONS short-circuit. CORS is now owned solely by Express's `cors()` config.
- **D2** — `ticketController.js`: removed the runtime `ALTER TABLE` self-healing in `safeInsertAttachment` and `createTicket`. Both now do a single plain insert; schema drift is a migration problem, not a request-time one.

## Authentication

- **F1** — Firebase ID token refresh:
  - `infra-frontend/src/store/authStore.ts`: added an `onIdTokenChanged` listener that keeps `token` current in memory and logs out if Firebase reports no user. The persisted (localStorage) slice now excludes `token` (`partialize`) so a stale token is never replayed after a reload.
  - `infra-frontend/src/services/api.ts`: request interceptor now awaits `auth.currentUser.getIdToken()` (SDK-refreshed) instead of reading the token captured once at login, falling back to the store only in the brief window before Firebase restores its session.
  - `infra-backend-v2/src/middleware/auth.js`: an invalid/expired token now returns **401** (was 403), so the existing frontend response interceptor's `status === 401` check actually fires and logs the user out instead of leaving them stuck.
- **S4** — Google-only, verified-email sign-in enforced at both entry points:
  - `infra-backend-v2/src/middleware/auth.js` (every authenticated request).
  - `infra-backend-v2/src/controllers/authController.js` `syncUser` (the account-linking point).
  - Both reject unless `decodedToken.email_verified === true` and `decodedToken.firebase.sign_in_provider === 'google.com'`. No domain restriction (per plan Q6).

## Workflow & Visibility

- **S5 / S7** — Scope checks:
  - `ticketRoutes.js` `/:ticket_id/details`: JE restricted to their own assigned ticket; AE/SE restricted to their own department; Clerical/Accountant restricted to tickets at `APPROVED_FOR_TENDERING` or later.
  - `ticketController.js` `reviewTicket`: AE/SE must match the ticket's department (Dean/Director/SYSADMIN remain institute-wide) — closes the "Electrical AE acting on a Civil ticket" gap.
- **S6** — `ticketRoutes.js` `GET /:ticket_id/tenders`: was wide open (no role check at all); now requires an internal role and applies the same JE/AE/SE scope rule as `/details`.
- **W3** — `ticketRoutes.js` `/:ticket_id/details`: JE's audit-log view now includes `RETURNED` remarks instead of masking them as `[Internal Authority Decision Recorded]` — the JE can see exactly what needs fixing.
- **W6** — `infra-backend-v2/src/config/workflow.js` `resolveTenderUpdate`: replaced the "any milestone from a fixed list of current states" check with a strict forward-only ladder (`APPROVED_FOR_TENDERING → TENDER_PUBLISHED → WORK_IN_PROGRESS → CLOSED`). A milestone must be strictly ahead of the current position; `CLOSED` is terminal and accepts nothing further, so a closed ticket can no longer be reopened or pushed backward.
- **W15** — `ticketRoutes.js`: removed the role allow-list on `POST /` (raise ticket) and `GET /applicant` (My tickets) — every authenticated, active user can now raise a ticket and see their own.

## Not touched in this phase (deferred per plan.md)

S2, S3, S10–S14, W1, W2, W4, W5, W7–W14, F2–F9, all of §3 (schema), D1/D3–D7, O1–O4 — these need the schema/workflow redesign in later phases and were left alone to keep this patch surgical.
