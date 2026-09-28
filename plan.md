# Dean-Infra Ticket Portal — Review & Implementation Plan

Status: **plan only, nothing implemented.**
Branch reviewed: `tazer` @ `7c7df01`.
Scope: `infra-backend-v2/`, `infra-frontend/`, Docker/nginx config, `infra-backend-v2/staffDetails.md`.
Open questions answered on 2026-09-28; decisions are recorded in §6 and applied throughout.

---

## 0. Target workflow (from requirement)

```
Any signed-in user (students, faculty, staff — including JE/AE/SE …) raises ticket
(campus = NORTH | SOUTH, department, location, photos …)
        │
        ▼  auto-assign: JE of (campus, department) who is AVAILABLE, least loaded
        │  nobody available ─► UNASSIGNED, queued at the AE desk; AE chooses the JE
JE desk ── email on assignment, +12 h, then every +24 h until report submitted
        │  (AE copied on every reminder from the 4th onwards)
        │  JE submits report: nature of work, estimate amount, estimate docs, inspection photos
        ▼
AE desk ── Forward to SE | Request changes (→ JE)                    (no approve, no reject)
        ▼
SE desk ── Approve | Request changes (→ AE or JE) | Forward to Dean | Reject
        ▼
Dean desk ── Approve | Request changes (→ SE, AE or JE) | Forward to Director | Reject
        ▼
Director desk ── Approve | Request changes (→ Dean, SE, AE or JE) | Reject   (no forward)
        ▼
Approved ─► tendering (Clerical) ─► work in progress ─► bills (Accountant) ─► closed
```

"Request changes" goes to the desk the sender chooses, and the ticket moves to that desk. Every message records who sent it, to whom, and who can read it (§3.3, §3.6).

Two cross-cutting requirements:

1. **Clarity at every stage.** An internal user opening a ticket must immediately see what the issue is, where it is, what the JE found, how much it costs, what earlier desks said (and to whom), how long it has waited, and what their own options are.
2. **Authority-based visibility.** Higher authority sees more. Lower desks never see less than they need to act. The applicant sees only the stage, never the people handling it.

---

## 1. Findings — bugs and risks in the current code

Severity: **C** = critical (security or workflow bypass), **H** = high (wrong behaviour in normal use), **M** = medium, **L** = low / cleanup.

### 1.1 Security and access control

| # | Sev | Where | Problem | Fix |
|---|-----|-------|---------|-----|
| S1 | C | `src/controllers/ticketController.js` `publishTender` (≈L597), `awardTender` (≈L665) | No status check. Any CLERICAL user, or **any** JE (not only the assigned one), can move a ticket at `ASSIGNED_TO_JE` or `PENDING_*` straight to `TENDER_PUBLISHED` / `WORK_IN_PROGRESS`. This bypasses the whole approval chain. | Route through the state machine. Allow only from `APPROVED_FOR_TENDERING` (publish) and `TENDER_PUBLISHED` (award). Use compare-and-swap `UPDATE … WHERE status = ?`. Remove JE from these routes or check `assigned_je_id`. |
| S2 | C | `src/app.js:39` | `/uploads` is served statically with no auth and `Access-Control-Allow-Origin: *`. Estimate docs and site photos are readable by anyone who has or guesses the URL (paths are `/uploads/tickets/<id>/<folder>/<timestamp>-<name>`). | Serve files through an authenticated route `GET /api/attachments/:id` that applies the same visibility rules as ticket details. Stop static serving. |
| S3 | C | `src/middleware/upload.js` | No `fileFilter`. Any file type is accepted, including `.html` / `.svg`, and is served from the same origin as the app. This is stored XSS. | Allow-list MIME types and extensions (jpg, png, webp, heic, pdf, xlsx, docx). Serve with `Content-Disposition: attachment` for non-images and `X-Content-Type-Options: nosniff`. |
| S4 | C | `src/middleware/auth.js`, `src/controllers/authController.js` | A Firebase token is linked to a pre-seeded account by **email only**. `email_verified` is never checked. If any non-Google provider (email/password) is ever enabled in Firebase, anyone can claim `director@…` and become the Director. | Require `decodedToken.email_verified === true` and `firebase.sign_in_provider === 'google.com'`. Any Google account may sign in and raise tickets for now (Q6); no domain restriction. Keep sign-in behind one auth module, because LDAP will later **replace** Google sign-in completely. |
| S5 | H | `src/routes/ticketRoutes.js:167` (`/details`) | Only APPLICANT ownership is checked. Any JE can read any ticket. Any AE/SE can read tickets outside their scope. Clerical and Accountant can read tickets that are still at the JE stage. | Central `canViewTicket(user, ticket)` based on the visibility matrix in §3.6. |
| S6 | H | `src/routes/ticketRoutes.js:105` (`GET /:ticket_id/tenders`) | No `requireRole`. An APPLICANT can read tender data for any ticket id. | Apply `canViewTicket` and role check. |
| S7 | H | `reviewTicket` (≈L524) | No scope check. The Electrical AE can act on a Civil ticket at `PENDING_AE_APPROVAL`. | The reviewer must be the desk owner: `ticket.current_desk_user_id === req.user.id` (see §3.3). |
| S8 | H | `src/app.js:47` + `nginx-proxy.conf` | Express does not set `trust proxy`. Behind nginx every request has the proxy's IP, so the limit of **100 requests / 15 min is shared by the whole institute**. The portal locks up for everyone after light use. | `app.set('trust proxy', 1)` (or the exact hop count). Separate, stricter limiter for `/api/auth` only. Raise the general limit and key it by user id after auth. |
| S9 | M | `nginx-proxy.conf` | `Access-Control-Allow-Origin "*"` on every location, including `/api`. It overrides the correct `cors()` config in Express. | Remove the CORS headers from nginx. Let Express own CORS. |
| S10 | M | `Dockerfile.backend` | No `.dockerignore`. `COPY infra-backend-v2/` bakes `serviceAccountKey.json`, `uploads/` and `node_modules` into the image. | Add `.dockerignore`. |
| S11 | M | `docker-compose.yml` | Compose mounts the key at `/app/certs/serviceAccountKey.json`, but `src/config/firebase.js` reads `../../serviceAccountKey.json` (= `/app/backend/serviceAccountKey.json`). It works only because of S10. The root `serviceAccountKey.json` is a **directory** owned by root (Docker created it when the file was missing). | Read the path from `GOOGLE_APPLICATION_CREDENTIALS`. Fix the mount. Remove the stray directory. |
| S12 | M | many controllers | `res.status(500).json({ message: error.message })` leaks SQL errors. `syncUser` returns the raw Firebase error. | Log the details, return a generic message and a request id. |
| S13 | M | `docker-compose.yml` | Default DB passwords (`root123`, `deanery_pass`) are used if `.env` is missing. | Fail startup when secrets are missing. |
| S14 | L | `infra-frontend/public/sw.js` | The service worker caches `/uploads/*` (estimate docs, photos) with no eviction on logout. Shared lab PCs keep them. | Do not cache attachments, or clear the cache on logout. |

### 1.2 Workflow correctness

| # | Sev | Where | Problem | Fix |
|---|-----|-------|---------|-----|
| W1 | H | `src/config/workflow.js` `resolveTransition` | The model does not match the requirement. `APPROVE` auto-sanctions or auto-escalates by budget ceiling. SE/Dean cannot choose to forward a small job. SE/Dean cannot reject (only the Director can `DENY`). There is no "forward" action. | New action set per role (§3.3): `FORWARD`, `APPROVE`, `REQUEST_CHANGES`, `REJECT`. Keep the financial ceilings as a guard on `APPROVE` (Q2 = yes). |
| W2 | H | `workflow.js` `previousDesk` | `RETURN` goes down **one** desk (Director → Dean → SE → AE → JE). A Director asking for a revised estimate needs three more round trips before the JE sees it. | `REQUEST_CHANGES` takes a target desk chosen by the sender (any lower desk on the ticket's chain) and moves the ticket there directly (Q3). Record sender and target. |
| W3 | H | `ticketRoutes.js:270` | The JE sees `"[Internal Authority Decision Recorded]"` instead of the return remarks. The JE is asked to fix a report without being told what is wrong. | Change requests become addressed messages (`ticket_messages`, §3.1) with an explicit sender, recipient and visibility. The recipient always sees the message addressed to them. Internal remarks stay separate. |
| W4 | H | `src/controllers/ticketController.js` `createTicket` (≈L60) | JE auto-assignment ignores `is_active`, ignores campus (there is no campus field) and ignores availability. A deactivated JE can receive tickets. | New assignment algorithm (§3.2). |
| W5 | H | `src/cron/emailReminders.js` | Reminder cadence is 12 h, 24 h, then every **72 h** — the requirement is every 24 h. It measures from `tickets.created_at`, not from assignment. `RETURNED_TO_JE` tickets get no reminders. It fires only when `hoursPending ===` an exact integer, so any restart or a slow cron tick skips a reminder. There is no record of what was sent, so running two backend instances sends duplicates. | Reminder engine driven by a `notifications` table with `next_due_at` (§3.4). |
| W6 | H | `workflow.js` `resolveTenderUpdate` | The JE can move a ticket **backwards** (`WORK_IN_PROGRESS` → `TENDER_PUBLISHED`) and **reopen a `CLOSED` ticket**, because `CLOSED` is in `allowedCurrent` and any milestone is accepted. It also duplicates the Clerical publish/award path, so the same status has two owners. | One forward-only post-approval ladder. Clerical owns tender and award. JE owns "work completed". AE (or JE) closes. |
| W7 | M | `reviewTicket`, `resolveTransition` | Remarks are optional on return/deny at the API. Only the UI enforces them. | Require a message for `REQUEST_CHANGES` and `REJECT` in the backend. |
| W8 | M | `reviewTicket` ≈L555, `/details` | The latest report is chosen with `ORDER BY created_at DESC LIMIT 1`. Two rows in the same second give a random result. | `ORDER BY id DESC`. |
| W9 | M | `applyTenderUpdate`, `publishTender`, `awardTender`, `recordBill`, `overrideTicketStatus` | Audit action `PASSED` is reused for tender, award and bill events. The admin override logs `APPROVED`. The audit trail misrepresents what happened. | Extend the audit action enum (§3.1). |
| W10 | M | `adminController.overrideTicketStatus` | `new_status` is not validated. The override can reassign to an inactive JE or a JE of another department. It does not reset the reminder clock. | Validate against `STATUS`. Allow only active JEs in the matching scope. Log `OVERRIDE` / `REASSIGNED`. |
| W11 | M | `createTicket` | `department` is not validated (bad value → 500). "No JE available" → 500. | Validate with `zod` (already a dependency, never used). No JE available is not an error: the ticket becomes `UNASSIGNED` in the AE queue (Q8). |
| W12 | M | `recordBill`, `updateBillPayment` | No ticket status check, no check that `net = gross − deductions`, negative amounts accepted, `payment_status` not validated, no audit row on payment updates, no 404 for an unknown bill. | Validate. Allow bills only from `WORK_IN_PROGRESS` onwards. Audit every change. |
| W13 | L | `ticketRoutes.js:27` | `requireRole(['APPLICANT','STUDENT','FACULTY','STAFF', …])` — those roles do not exist in the `users.role` enum. | Remove them (see W15). |
| W14 | L | `ticketRoutes.js:64` | SYSADMIN is allowed by `requireRole` on `/review` but is always rejected by `resolveTransition`. | Remove SYSADMIN from the route. Admin uses `/override`. |
| W15 | H | `ticketRoutes.js:40` (`POST /`), `ticketRoutes.js:27` (`GET /applicant`) | Only `APPLICANT`, `JE` and `SYSADMIN` can create a ticket, and staff cannot open "My tickets". The requirement is that **anybody** can raise a ticket, including AE, SE, Clerical, Accountant, Dean and Director (Q6). | Raising a ticket and "My tickets" are open to every authenticated, active user. Being the applicant is a relation (`tickets.applicant_id`), not a role. |

### 1.3 Data and schema

| # | Sev | Where | Problem | Fix |
|---|-----|-------|---------|-----|
| D1 | H | `schema.sql` vs `migrations/002_*.sql` vs `src/config/autoMigrate.js` | Three different definitions of `tenders` and `bills`. Migration 002 has `portal_type ENUM('GEM','CPP','OFFLINE')`, `nit_published_date NOT NULL`, `estimated_amount NOT NULL`, no `remarks`; `bills` has `accountant_id` instead of `processed_by`, no `deductions` / `payment_date`, and `payment_status 'PENDING_AUDIT'`. A database built from 002 fails every `publishTender` and `recordBill` insert. | One migration system (numbered SQL files plus a `schema_migrations` table, run at startup). Delete the ad-hoc checks in `autoMigrate.js`. Rebuild `schema.sql` as the output of all migrations. |
| D2 | H | `ticketController.js` `safeInsertAttachment`, `createTicket` | Self-healing `ALTER TABLE` runs **inside a request transaction**. In MySQL, DDL causes an implicit commit, so the half-finished transaction is committed and the later rollback does nothing. | Remove all runtime DDL. Schema is owned by migrations only. |
| D3 | H | `createTicket`, `submitReport` | Files are moved into `uploads/tickets/<id>` before `COMMIT`. If the transaction rolls back, `cleanupTempFiles` looks only at the temp path. Orphaned files remain. | Move files after commit, or delete the moved paths on rollback. |
| D4 | M | `users` | No `campus`, no availability, no designation. `department` mixes wings (`Civil`) and non-wings (`Administration`, `General`). | See §3.1. |
| D5 | M | `tickets` | No `campus`, `building`, `category`, `priority`, `assigned_at`, `status_changed_at`, `current_desk_user_id`. Location is a free-text string with lat/lng embedded in it. | See §3.1. |
| D6 | M | `src/config/db.js` | `connectionLimit: 100` exceeds what a small MySQL needs. `dotenv.config()` is called in three places. | 10–20 connections. Load config once. |
| D7 | L | `schema.sql:124` | Mock users are seeded by the Docker entrypoint in production. | Move to `scripts/seed-*.mjs`. Real staff seed from `staffDetails.md` (§3.2). |

### 1.4 Frontend

| # | Sev | Where | Problem | Fix |
|---|-----|-------|---------|-----|
| F1 | C | `src/store/authStore.ts`, `src/pages/Login.tsx:28`, `src/services/api.ts` | The Firebase ID token is saved once in `localStorage` and never refreshed. It expires after 1 hour. The backend then returns **403** (not 401), so the interceptor never logs out. Every user is silently broken one hour after login. | Do not persist the token. Use `onIdTokenChanged` and fetch `auth.currentUser.getIdToken()` in the request interceptor (the SDK refreshes it). Backend returns 401 for invalid or expired tokens. |
| F2 | H | `src/pages/TicketDetails.tsx:88`, `src/pages/je/JeTicketDetails.tsx` | The progress tracker lists only six statuses. For `TENDER_PUBLISHED`, `WORK_IN_PROGRESS`, `CLOSED`, `RETURNED_TO_JE` and `DENIED`, `findIndex` returns −1 and nothing shows as done. It also draws SE/Dean/Director as "future" steps even when the ticket was approved at a lower desk. | Build the tracker from the audit trail (actual path taken) plus the remaining possible steps. |
| F3 | H | `TicketDetails.tsx:337`, `AuthorityDashboard.tsx:29` | Budget ceilings are hardcoded in two frontend files as well as in `workflow.js`. | Serve allowed actions and limits from the API (`ticket.available_actions`). |
| F4 | M | `src/routes/ProtectedRoute.tsx` | Redirects to `/unauthorized`, which does not exist. The catch-all then sends the user to `/`. | Add the page, or redirect to `/` with a message. |
| F5 | M | `authStore.ts` | The role is cached in `localStorage`. If an admin changes a role, the UI shows the wrong dashboard until logout. | Refresh `/auth/me` on app load. |
| F6 | M | `src/pages/Login.tsx:15` | The LDAP username/password form does nothing (`console.log` only). Users will try it. | Hide it until LDAP exists. When LDAP ships, it replaces the Google button (Q6). |
| F7 | L | many pages | `alert()` for errors and success. Many `any` types. | Toast component. Shared `Ticket` types generated from one source. |
| F8 | L | `RaiseTicket.tsx:87` | Location is sent as one concatenated string. | Send `campus`, `building`, `landmark`, `lat`, `lng` as separate fields. |
| F9 | M | navigation | Staff users have no route to "Raise ticket" or "My tickets" (W15). | Show "Raise ticket" and "My tickets" in the navigation for every role. |

### 1.5 Operations and quality

- **O1 (M)** `src/utils/mailer.js`: `secure: true` is hardcoded (breaks port 587) and `port` is a string. Mail is fire-and-forget with no retry. A lost assignment email is never known. → Use an outbox table (§3.4). Set `secure` from the port.
- **O2 (M)** No unit tests. `workflow.js` is pure and easy to test, but the `scripts/test-*.mjs` files are ad-hoc end-to-end scripts that need a live database. → `node --test` for the state machine, assignment and visibility. Keep the e2e scripts for CI with a throwaway MySQL.
- **O3 (L)** Deploy workflow runs on every push to `tazer` and calls `update.sh`, which is not in the repo. → Commit `update.sh`, or document it.
- **O4 (L)** No `.env.example` in the repo, although the README and `firebase.js` tell users to copy it.

---

## 2. Gap analysis against the requirement

| Requirement | Current state | Gap |
|---|---|---|
| Anybody can raise a ticket, including staff | Only APPLICANT, JE, SYSADMIN | Open ticket creation and "My tickets" to every role (W15, F9) |
| Ticket has campus (North/South) | No campus field anywhere | Add to schema, form, routing |
| Auto-assign JE by campus + availability | By department and load only; ignores `is_active` | Campus scope, availability, `UNASSIGNED` queue for the AE |
| Mail on assignment, +12 h, then every 24 h until report | Assignment mail yes; cadence 12/24/72 h from `created_at`; unreliable | Reminder engine; AE copied from the 4th reminder |
| JE report = estimate docs + inspection photos | Present (`site_photos`, `estimate_docs`) | Make both mandatory (Q5, configurable); keep version history visible |
| AE forwards to SE or sends back to JE | AE "approves" (may auto-sanction ≤ ₹25k) | New action set; AE cannot approve or reject |
| SE / Dean: approve, request changes, forward, reject | Approve (auto-escalate by amount) or return one level | New action set; change requests to a chosen lower desk |
| Director: approve, request changes, reject | Approve, return one level, deny | Rename / align |
| Clear record of who said what to whom | Remarks not addressed; JE blind to return reasons | `ticket_messages` with sender, recipient, visibility |
| AE per campus (Civil N / Civil S / Electrical both) | AE per department only | Desk routing table |
| Clear information at every stage | Partial; tracker broken | Stage "decision brief" UI |
| Higher authority sees more | Ad-hoc redaction; any JE/AE sees any ticket | Visibility matrix |
| Applicant sees stage only | Applicant sees JE name and more | Applicant view without names, phones or site photos |
| Notify the next desk | Only the JE is emailed | Email on every transition |

---

## 3. Target design

### 3.1 Data model changes (one new migration, `003_campus_desks_workflow.sql`)

`users`
- `campus ENUM('NORTH','SOUTH','BOTH') NULL` — scope for JE and AE.
- `designation VARCHAR(100)` — for example "Sr. Assistant Engineer (Civil)". Show it in the UI instead of the bare role code.
- Replace the single `department` scope for engineers with a `user_scopes` table (`user_id`, `department`, `campus`), because real staff cover several scopes (for example, the North Civil AE also handles North Horticulture, and the Horticulture JE covers both campuses).
- `APPLICANT` stays as the default role for new sign-ins, but it is no longer required to raise a ticket. Any active user can raise one (Q6).

`user_availability` (JE leave and unavailability)
- `id, user_id, start_at, end_at, reason, created_by`.
- A JE is available when `is_active = TRUE` and no row covers `NOW()`.
- JE can mark own leave. AE, SE and SYSADMIN can mark leave for JEs in their scope.

`tickets`
- `campus ENUM('NORTH','SOUTH') NOT NULL`
- `building VARCHAR(150)`, `landmark VARCHAR(255)`, `lat DECIMAL(9,6)`, `lng DECIMAL(9,6)`
- `category VARCHAR(50)` (for example plumbing, electrical fault, road, horticulture), `priority ENUM('LOW','NORMAL','URGENT')`
- `contact_phone VARCHAR(20)` — the applicant's phone, for the JE.
- `assigned_at DATETIME`, `status_changed_at DATETIME`
- `current_desk_user_id INT NULL` — the exact person who must act now.
- `open_change_request_id INT NULL` — the `ticket_messages` row the current desk must answer, if the ticket is at this desk because of a change request.

`ticket_messages` (replaces the planned `note_to_je`; one row per remark, change request or reply)
- `id, ticket_id, audit_log_id, author_user_id, author_desk, to_user_id NULL, to_desk NULL, kind ENUM('CHANGE_REQUEST','REPLY','INTERNAL_REMARK','REJECTION_REASON','PUBLIC_NOTE'), body, visible_from_rank, in_reply_to NULL, created_at`.
- Desk ranks: JE = 1, AE = 2, SE = 3, Dean = 4, Director = 5.
- `visible_from_rank` is stored when the row is written, so the reader rule is a plain comparison and the UI can print "Visible to: …" (rules in §3.6).
- `to_user_id` is resolved at write time (for example, the assigned JE or the AE of the ticket's scope), so the record says exactly who received it.

`reports` — keep all versions. Add `version INT`, `remarks TEXT` and `answers_message_id` (the change request this version responds to). Link attachments to a report (`attachments.report_id`), so each version shows its own photos and docs.

`audit_logs.action` — extend to:
`CREATED, ASSIGNED, REASSIGNED, REMINDER_SENT, SUBMITTED, FORWARDED, APPROVED, CHANGES_REQUESTED, REJECTED, TENDER_PUBLISHED, WORK_AWARDED, WORK_COMPLETED, BILL_RECORDED, BILL_UPDATED, CLOSED, OVERRIDE`.
Add `from_status`, `to_status`, `from_desk`, `to_desk`, and `visibility ENUM('ALL','INTERNAL','AUTHORITY')`. Free text moves to `ticket_messages`.

`notifications` (outbox and reminders)
- `id, ticket_id, user_id, kind, subject, body, next_due_at, sent_at, attempts, last_error, stop_when_status_not_in`.

`financial_limits` (Q2 = yes) — `key, max_amount`, editable by SYSADMIN, replacing the hardcoded `BUDGET_CEILING`.
- Approval keys: `SE_APPROVE`, `DEAN_APPROVE`. The Director has no limit. The AE has no approval power (Q1).
- `DIRECT_AWARD` — award without tender is allowed below this amount (Q9). Seed a nominal placeholder (₹10,000) until the real value is known.
- Seed SE and Dean with the current code values (₹50,000 and ₹5,00,000). Confirm the real values from the institute's delegation of financial powers later.

`app_settings` — `key, value`, editable by SYSADMIN. First entry: `REPORT_FILES_REQUIRED = true` (Q5), so the rule can change without a deploy.

Status enum — use the shorter set (Q12 = yes). The migration maps old values:
`UNASSIGNED (new), ASSIGNED_TO_JE, CHANGES_REQUESTED (was RETURNED_TO_JE), PENDING_AE, PENDING_SE, PENDING_DEAN, PENDING_DIRECTOR, APPROVED (was APPROVED_FOR_TENDERING), TENDER_PUBLISHED, WORK_IN_PROGRESS, WORK_COMPLETED, REJECTED (was DENIED), CLOSED`.
`CHANGES_REQUESTED` means "at the JE because of a change request". A change request to the AE, SE or Dean puts the ticket in `PENDING_AE` / `PENDING_SE` / `PENDING_DEAN` with `open_change_request_id` set.

### 3.2 Staff mapping and JE assignment

From `infra-backend-v2/staffDetails.md`:

| Scope | JE pool | AE desk |
|---|---|---|
| Civil — North | Deepak Chauhan | Siddarth Jamwal |
| Civil — South | Omjeet Thakur, Gavin Dhiman | Vikas Kumar Chaudhary |
| Electrical — North | Rishav Verma, Yashpal Thakur, Chirag Vaidya | Neeraj Chauhan |
| Electrical — South | Kapil Verma | Neeraj Chauhan |
| Horticulture — North | Munna Kumar | Siddarth Jamwal |
| Horticulture — South | Munna Kumar | Vikas Kumar Chaudhary |
| SE (all) | — | Vijay Kumar Sharma |
| Clerical | Anil Kumar, Aman Yadav, Lalit Kumar | — |
| Accountant | Jyoti Singh | — |
| Dean, Director | dummy accounts (Q7) | — |

- Junior Lab Assistants (Deen Dyal, Navish Sharma, Vishavjeet) do **not** receive tickets (Q4 = no). They can still sign in and raise tickets like any user.
- Dean and Director: seed dummy accounts now. SYSADMIN replaces the name and email through the sysadmin portal later (Q7). The seed must not overwrite accounts that SYSADMIN has already edited.
- Office Attendant (Vijay Kumar) needs no portal role.

Write a seed script `scripts/seed-staff.mjs` that reads a JSON version of this table (with emails) and creates `users` and `user_scopes`. Do not hard-code people in `schema.sql`.

**Assignment algorithm** (`services/assignment.js`, pure selection with the DB query separate):
1. Candidates = active JEs whose scope matches (`department`, `campus`) or (`department`, `BOTH`), and who have no `user_availability` row covering now.
2. Order by open tickets (`ASSIGNED_TO_JE`, `CHANGES_REQUESTED`) ascending, then `last_assigned_at` ascending (round robin on ties).
3. Lock with `SELECT … FOR UPDATE` on the chosen user row (or a per-scope lock) so two tickets created at the same time do not race.
4. **When nobody is available (Q8):** do not fall back to the other campus. Set the status to `UNASSIGNED`, set `current_desk_user_id` to the AE of the ticket's scope, and email the AE. The ticket waits in the AE's queue until the AE reviews it and chooses a JE (`ASSIGN_JE` action). The picker lists the JEs of the department, with available JEs of the ticket's campus first and each JE's leave and open-ticket count shown.
5. When a JE is marked unavailable, show the AE the JE's open tickets with a one-click "reassign all".

### 3.3 State machine (rewrite `src/config/workflow.js`)

Keep it pure, and keep the current good parts: the "is it your desk" guard, compare-and-swap updates, `WorkflowError`.

Actions per desk:

| Desk | FORWARD | APPROVE | REQUEST_CHANGES (send to) | REJECT | Other |
|---|---|---|---|---|---|
| AE (on `UNASSIGNED`) | — | — | — | — | `ASSIGN_JE` → ASSIGNED_TO_JE |
| JE | `SUBMIT_REPORT` → PENDING_AE | — | — | — | — |
| AE | → PENDING_SE | ✗ | JE | ✗ | — |
| SE | → PENDING_DEAN | ✓ (≤ `SE_APPROVE`) | AE or JE | ✓ | — |
| Dean | → PENDING_DIRECTOR | ✓ (≤ `DEAN_APPROVE`) | SE, AE or JE | ✓ | — |
| Director | ✗ | ✓ | Dean, SE, AE or JE | ✓ | — |

Rules:
- The actor must be `current_desk_user_id` (fixes S7), not just the right role.
- `REQUEST_CHANGES` needs `to_desk` (a desk ranked below the sender) and a message. The ticket moves straight to that desk, and `current_desk_user_id` becomes the person on that desk for this ticket (the assigned JE, the AE of the scope, the SE or the Dean). One `CHANGE_REQUEST` row is written to `ticket_messages` with sender, recipient and `visible_from_rank`.
- `REJECT` needs a message. The author may add an optional `PUBLIC_NOTE` for the applicant.
- A desk that receives a change request answers it with its normal actions:
  - JE: submits a new report version, which links to the change request (`reports.answers_message_id`). The reply is mandatory.
  - AE, SE, Dean: forward with a `REPLY` to the requester, or pass the request further down with their own `REQUEST_CHANGES` (for example, Dean → SE, then SE → JE). Both messages stay linked in a thread (`in_reply_to`).
- After the fix, the ticket climbs the normal chain (JE → AE → SE → …). Each desk on the way sees the open change request and the reply at the top of the page, so it can forward quickly. Proposed default; confirm (Q13).
- Above the desk's limit, `APPROVE` fails with `ABOVE_LIMIT` and the UI shows "forward instead" (Q2).
- New export `availableActions(user, ticket)` — returns the buttons and, for `REQUEST_CHANGES`, the list of allowed target desks. The frontend renders only from this list (fixes F3).
- The post-approval ladder is forward-only: `APPROVED → TENDER_PUBLISHED (Clerical) → WORK_IN_PROGRESS (Clerical award) → WORK_COMPLETED (JE) → CLOSED (AE)`. Direct award without tender is allowed only below `DIRECT_AWARD` (Q9).
- Every transition writes one audit row with `from_status`, `to_status`, `from_desk` and `to_desk`, writes its `ticket_messages` rows, sets `status_changed_at`, sets `current_desk_user_id`, and queues notifications, all in one transaction.

Desk resolution: `UNASSIGNED` and `PENDING_AE` → AE for (department, campus) from `user_scopes`; `PENDING_SE` → the SE; `PENDING_DEAN` → the Dean; `PENDING_DIRECTOR` → the Director. If the desk owner is inactive, fall back to SYSADMIN with an alert.

### 3.4 Notifications and reminders

- The **outbox**: every transition inserts `notifications` rows inside the same transaction. A worker (node-cron every minute) sends due rows, sets `sent_at`, and retries with backoff (`attempts`, `last_error`). An email is never lost because the process restarted.
- **JE reminders:** on assignment (and on `CHANGES_REQUESTED`), insert one reminder row with `next_due_at = assigned_at + 12 h`. When sent, if the ticket is still at the JE, set `next_due_at += 24 h`. Stop when the status leaves the JE stage. This is idempotent and survives restarts; with a `SELECT … FOR UPDATE SKIP LOCKED` claim it is safe with several instances.
- Each reminder writes `REMINDER_SENT` to the audit log, so authorities can see "JE reminded 4 times".
- **Escalation (Q10):** after the 4th reminder, copy the AE on every further reminder.
- **UNASSIGNED:** email the AE when a ticket enters the AE's queue without a JE. Remind the AE on the same 12 h / 24 h cadence until a JE is chosen.
- Emails on: assignment, reassignment, every move to a new desk (to the new desk owner), change requests (to the addressed desk, with the message and the sender's name), approved and rejected (to the applicant and the JE), tender and award (to the JE and AE).
- **Applicant emails** carry the stage in plain words and the portal link only. No staff names, phone numbers, amounts or internal remarks (Q11).
- Email body: a short summary and the portal link.
- Time zone: store UTC, show `Asia/Kolkata`. Set the mysql2 `timezone: 'Z'` explicitly.

### 3.5 "Clarity at every stage" — ticket page design

One ticket page for all internal roles (replacing the separate `TicketDetails`, `JeTicketDetails` and parts of `AdminTicketDetails`). Sections appear or hide by visibility (§3.6). The applicant gets a separate, simple view.

1. **Header strip:** ticket number, title, campus badge (NORTH / SOUTH), department, priority, current status in plain words ("Waiting for SE — Vijay Kumar Sharma, 2 days"), total age.
2. **Open change request banner** (when `open_change_request_id` is set): "Dean → SE, 3 Oct: *message*", with the thread of replies and further requests below it.
3. **Action panel** (only for the current desk owner): the buttons from `availableActions`. Each button has one line that says what it does ("Forward to Dean — Dean will decide"). For `REQUEST_CHANGES`: a "Send to" selector with only the allowed lower desks (showing the person's name), a message box, and a line "Visible to: JE, AE, SE, Dean, Director" that updates with the selection. A separate optional "Internal remark" box (visible only to the author's rank and above). Show the financial limit ("Your approval limit: ₹50,000 — this estimate: ₹1,20,000, so Approve is disabled").
4. **Decision brief** (top of the page for AE and above): the issue in two lines, location with a map pin, the JE's nature of work, estimate amount, photo thumbnails, estimate doc links, and the last message of each earlier desk.
5. **Path tracker** built from the audit log: the actual route with names, dates and time spent at each desk, including backward moves from change requests, then the remaining possible steps drawn as dashed (fixes F2).
6. **Report versions:** v1, v2 … with amount change ("₹80,000 → ₹65,000"), each with its own photos and docs, and the change request that caused it.
7. **Messages and timeline:** full audit trail, filtered by visibility. Each message shows sender → recipient ("Dean (Name) → JE (Name)"), its kind, and a "Visible to" chip. Reminders collapsed ("3 reminders sent").
8. **Post-approval block:** tender (NIT, portal, dates), award (agency, value), bills (gross, deductions, net, status), with "sanctioned vs awarded vs paid".

**Applicant view:** title, description, own photos, campus and location, and the stage in plain words ("Under JE inspection", "Under review", "Approved — tendering", "Work in progress", "Completed", "Rejected"). No staff names, phones, site photos, amounts or internal messages. If the applicant is also staff, the page shows whatever their staff role allows (§3.6), merged with the applicant view.

Dashboards per role show "My desk" (tickets waiting for me, oldest first, with age and SLA colour; for the AE this includes `UNASSIGNED` tickets), "Watching" (tickets I handled that moved on), "My tickets" (tickets I raised, for every role), and for SE/Dean/Director a summary by campus, department and stage.

### 3.6 Visibility matrix

| Data | Applicant (non-staff) | JE (assigned) | AE (scope) | SE | Dean | Director | Clerical | Accountant | SYSADMIN |
|---|---|---|---|---|---|---|---|---|---|
| Own ticket basics, applicant photos | ✓ own | ✓ | ✓ | ✓ | ✓ | ✓ | from APPROVED | from APPROVED | ✓ |
| Status | stage only, no names | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Names of people on the ticket (desk owner, assigned JE) | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Staff phone numbers | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Applicant contact phone | — (own) | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| JE report and estimate amount | — | ✓ own | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| JE site photos | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Estimate documents | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Change request / reply addressed to desk Y | — | if Y = JE | if Y ≤ AE | if Y ≤ SE | if Y ≤ Dean | ✓ | — | — | ✓ |
| Internal remark by desk X | — | if X = JE | if X ≤ AE | if X ≤ SE | if X ≤ Dean | ✓ | — | — | ✓ |
| Reminder count, time at each desk | — | own | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| Tender / award | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Bills | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rejection reason | public note only | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |

**Message rules** (`visible_from_rank`, written once when the message is created):
- `CHANGE_REQUEST` from X to Y: rank of Y. The recipient, every desk between Y and X (the ticket passes through them on the way back), X, and every desk above X can read it.
- `REPLY` from Y to X: rank of Y. Same readers as the request it answers.
- `INTERNAL_REMARK` by X: rank of X. X and every desk above X.
- `PUBLIC_NOTE`: also shown to the applicant.
- A JE other than the assigned JE never sees messages on the ticket. The AE sees messages only on tickets in the AE's scope.
- Every message in the UI prints its sender, recipient and "Visible to" list, so nobody has to guess who can read it.

**Which tickets are visible:** every user = tickets they raised (applicant view); JE = assigned to them (current or past); AE = own scope, including `UNASSIGNED`; SE, Dean, Director = all; Clerical, Accountant = approved or later. A staff member who raised a ticket sees the union of the applicant view and their staff view.

Rule of thumb: a desk sees its own messages, all messages from lower desks, and every message addressed to it or to a desk below it; it does not see internal remarks from higher desks. The matrix lives in one module (`services/visibility.js`) and is used by the details endpoint, the attachment endpoint, the queues and the email builder. The same function must be unit tested row by row.

---

## 4. Implementation phases

Each phase ends with passing tests and a working deploy. Do phase 1 first — it closes live holes without depending on the redesign.

**Phase 1 — Hotfixes on the current model (1–2 days)**
1. S1: status guard on `publishTender` and `awardTender`; drop JE from those routes.
2. S8: `trust proxy`; fix the rate limiter. S9: remove nginx CORS.
3. F1: token refresh via `onIdTokenChanged`; backend returns 401 on an expired token.
4. S4: check `email_verified` and the `google.com` provider. No domain restriction (Q6).
5. S5, S6, S7: basic scope checks (JE = assigned, AE and SE = same department, Clerical and Accountant = approved or later). Hide JE name, phone and site photos from the applicant (Q11).
6. W3: show return remarks to the JE.
7. W6: make the tender ladder forward-only; stop reopening `CLOSED`.
8. W15, F9: let every role raise a ticket and see "My tickets".
9. D2: remove runtime DDL.
Acceptance: e2e scripts pass; a manual check that a Clerical user cannot publish a tender for a `PENDING_AE_APPROVAL` ticket; an SE can raise a ticket.

**Phase 2 — Schema and migrations (1–2 days)**
1. D1: single migration runner with a `schema_migrations` table; reconcile `tenders` and `bills` with what the controllers write.
2. Migration 003 (§3.1), including the mapping of old status values to the new names (Q12).
3. `.env.example`, `.dockerignore`, fix S10, S11, S13.
4. `scripts/seed-staff.mjs` from `staffDetails.md`, with dummy Dean and Director accounts (Q7); seed `financial_limits` and `app_settings`.
Acceptance: a fresh database and an upgraded copy of the production database reach the same schema (compare `SHOW CREATE TABLE` output).

**Phase 3 — Campus, availability, assignment (2 days)**
1. Raise-ticket form: campus (required), building, landmark, map pin, category, priority, contact phone. `zod` validation on the backend.
2. `user_availability` API and a "Mark leave" UI for the JE and AE.
3. Assignment algorithm (§3.2); `UNASSIGNED` queue with the AE "Choose JE" picker (Q8); AE "reassign all" when a JE goes on leave.
Acceptance: unit tests for the selection function — unavailable JE skipped, `BOTH` scope matched, tie broken by round robin, nobody available gives `UNASSIGNED` at the correct AE.

**Phase 4 — Workflow rewrite (3 days)**
1. New `workflow.js` with `FORWARD / APPROVE / REQUEST_CHANGES / REJECT / ASSIGN_JE`, desk resolution, `availableActions` with allowed target desks.
2. `/review` becomes `/tickets/:id/actions` with `{ action, to_desk, message, internal_remark, public_note }`.
3. `ticket_messages` with sender, recipient and `visible_from_rank`; change-request threads.
4. Report versioning with `attachments.report_id` and `answers_message_id`; enforce `REPORT_FILES_REQUIRED` (Q5).
5. `financial_limits` guard on `APPROVE` and `DIRECT_AWARD` (Q2, Q9).
6. Full audit actions (W9), admin override validation (W10), bill validation (W12).
Acceptance: `node --test` table-driven tests for every (role × status × action × target desk) combination, including "wrong person at the right desk", "AE tries to approve", "SE sends changes to Dean (not allowed)" and "approve above limit".

**Phase 5 — Notifications (1–2 days)**
1. `notifications` outbox and worker; retries.
2. JE reminder schedule: +12 h, then every +24 h, stopping on report submission; AE copied from the 4th reminder (Q10).
3. `UNASSIGNED` emails and reminders to the AE.
4. Transition emails (§3.4); applicant emails with stage only.
Acceptance: test with a fake clock — reminder due times, AE copy starts at reminder 4, stop condition, no duplicates when two workers run; applicant email contains no staff names.

**Phase 6 — Visibility and file access (1–2 days)**
1. `services/visibility.js` and use in details, attachments, queues and emails.
2. S2 and S3: authenticated attachment download, file type allow-list; S14 service worker change.
Acceptance: matrix tests, including message visibility by rank and the staff-as-applicant case; direct `/uploads/...` URL returns 404; `.html` upload rejected; applicant cannot download JE site photos.

**Phase 7 — Frontend clarity (3–4 days)**
1. Unified ticket page (§3.5): header, change-request banner, action panel from `available_actions` with the "Send to" selector and "Visible to" line, decision brief, path tracker, report versions, messages and timeline.
2. Applicant view with stage only.
3. Role dashboards with "My desk", "My tickets" and ageing.
4. Remove hardcoded ceilings (F3); fix F4, F5, F6; replace `alert()` with toasts.
Acceptance: walk one ticket through every desk with seeded users. At each step, the person on the desk can say what the issue is, what it costs, and what the last desk said to whom, without scrolling past the first screen.

**Phase 8 — Hardening**
- S12 error handling with request ids; O1 mailer config; O2 CI with MySQL service container; O3 commit `update.sh`; structured logs.

**Later — LDAP (not scheduled)**
- Add an LDAP login behind the same auth module. When it ships, remove Google sign-in completely (Q6).

---

## 5. Test plan

- **Unit (`node --test`, no DB):** `workflow.js` transitions and `availableActions` (including allowed target desks); assignment selection; visibility matrix and message ranks; reminder scheduling with an injected clock.
- **Integration (throwaway MySQL in Docker):** extend `scripts/test-workflow.mjs` and `scripts/test-endpoints-e2e.mjs` for the new endpoints; concurrent-create test for the assignment lock; rollback test for file cleanup (D3).
- **Security checks:** each §1.1 item gets one regression test (for example, "APPLICANT GET /tickets/5/tenders → 403", "Electrical AE acts on Civil ticket → 403", "Clerical publish on PENDING ticket → 409", "AE APPROVE → 403").
- **Manual end-to-end:**
  - One North Civil ticket through the full chain.
  - One South Electrical ticket while Kapil Verma is on leave: the ticket is `UNASSIGNED` at Neeraj Chauhan, who chooses a JE.
  - One ticket where the Director requests changes from the SE, and the SE passes the request to the JE. Check that each message shows the correct sender, recipient and "Visible to" list, and that the AE sees the SE → JE request but not the Director's internal remark.
  - One ticket raised by a staff member (for example, the SE) — the SE sees both the applicant view and the SE view.
  - Applicant check: at every stage the applicant sees the stage only, with no names, phones or site photos.

---

## 6. Decisions (answered 2026-09-28)

- **Q1 — AE powers.** The AE can forward to the SE or send the ticket back to the JE for changes. The AE **cannot approve and cannot reject**.
- **Q2 — Financial limits.** Keep them, in `financial_limits`, editable by SYSADMIN. Real values still to be confirmed from the delegation of financial powers.
- **Q3 — Recommend changes.** The sender chooses the target desk from the desks below them: AE → JE; SE → AE or JE; Dean → SE, AE or JE; Director → Dean, SE, AE or JE. The ticket moves to that desk. Every message records who sent it, to whom, and who can view it (§3.1 `ticket_messages`, §3.6 message rules).
- **Q4 — Junior Lab Assistants.** No, they do not receive tickets.
- **Q5 — Mandatory report files.** Yes, at least one inspection photo and one estimate document for now. Kept as the setting `REPORT_FILES_REQUIRED`, because it may change.
- **Q6 — Who can sign in and raise tickets.** Any verified Google account for now. Anybody can raise a ticket, including staff. Later, LDAP replaces Google sign-in completely.
- **Q7 — Dean and Director.** Seed dummy accounts now. SYSADMIN replaces them through the sysadmin portal later.
- **Q8 — No JE available.** The ticket is queued at the AE as `UNASSIGNED`. The AE reviews it and chooses the JE. No automatic fallback to the other campus.
- **Q9 — Direct award without tender.** Allowed below a nominal amount for now (placeholder ₹10,000 in `financial_limits.DIRECT_AWARD`), subject to change.
- **Q10 — Escalation.** Copy the AE from the 4th JE reminder onwards.
- **Q11 — Applicant visibility.** The applicant sees only the stage ("Under JE inspection", …). No JE phone, no site photos, no names of the people handling it. A staff member who is also the applicant sees more through their staff role.
- **Q12 — Status names.** Yes, rename to the shorter set in §3.1.

### Still open

- **Q13 — Return path after a change request is answered.** After the JE (or a middle desk) answers a change request, does the ticket climb the normal chain (JE → AE → SE → …), or jump straight back to the desk that asked? *Default: climb the normal chain, with the open request and reply shown at the top for each desk on the way.*
- **Q14 — Placeholder values.** Real amounts for `SE_APPROVE`, `DEAN_APPROVE` and `DIRECT_AWARD`, and real names and emails for the Dean and Director. None of these block the build.
