# Bugs & Errors — Ticket Workflow Audit

Checked against the intended workflow. The state machine itself (`infra-backend-v2/src/config/workflow.js`) matches the spec: AE forwards only, SE/Dean escalate when over limit, only the Director can REJECT, and REQUEST_CHANGES goes exactly one desk back. Most real failures come from **desk-owner resolution** (who counts as "the AE" for a ticket), **user/scope data**, and **the upload path**.

## A. Tickets not visible / not actionable for the AE (critical)

### A1. Admin-created staff never get `campus` or `user_scopes`, so the AE is never found
- `src/controllers/adminController.js:353-383` (`createUser`) inserts `users` with no `campus` and no `user_scopes` row. `updateUser` (385-432) cannot set either. No API or UI (`AdminUsers.tsx`) manages scopes.
- Routing needs scopes: `resolveAeForScope` (`src/models/deskModel.js:14-26`) joins `user_scopes`, and `pickAvailableJe` (`src/services/assignment.js:42-60`) needs `EXISTS user_scopes`.
- Result: an AE or JE added via the admin panel is invisible to routing. A JE is never auto-assigned, and the AE desk resolves to `null`.
- Only `scripts/seed-staff.mjs` and the backfill in migration 004 create scopes, and the backfill only runs once.

### A2. Missing AE falls back to SYSADMIN, and then the ticket is dead
- `resolveDeskOwner` (`deskModel.js:73-79`) and `assignTicket` (`assignment.js:92-97`) fall back to SYSADMIN, so `current_desk_user_id` = the sysadmin.
- `availableActions` (`workflow.js:128-131`) needs `user.role === desk` (`AE`) **and** `current_desk_user_id === user.id`. The sysadmin fails the role check. The real AE fails the id check.
- `POST /:ticket_id/actions` (`src/routes/ticketRoutes.js` "4.5") only allows `['AE','SE','DEAN','DIRECTOR']`, so SYSADMIN cannot act either.
- Result: after a JE files a report, the ticket sits at `PENDING_AE_APPROVAL` and nobody can move it. The AE's "My desk" (`deskController.js` `owner = t.current_desk_user_id = ?`) does not show it. This matches "ticket isn't visible to AE".
- The same thing happens for `UNASSIGNED` tickets: the sysadmin cannot ASSIGN_JE.

### A3. Stale `current_desk_user_id` is never re-resolved
- `loadActionContext` (`src/services/actionContext.js:24-27`) re-resolves the owner only when `current_desk_user_id` is NULL.
- If scopes are fixed later, or the AE is replaced or deactivated, existing tickets keep pointing at the old person or at SYSADMIN. They stay stuck (see A2).

### A4. Admin override leaves the desk owner wrong
- `overrideTicketStatus` (`adminController.js:229-300`) updates `status` and/or `assigned_je_id` but never `current_desk_user_id`.
- Reassigning the JE: the new JE sees the ticket (`/je/dashboard` filters by `assigned_je_id`). But `applyReportSubmission` (`ticketController.js:326-331`) uses `current_desk_user_id ?? assigned_je_id`, which is still the old JE, so the new JE gets `NOT_YOUR_DESK`.
- Forcing a status (for example `PENDING_SE_APPROVAL`) leaves the desk pointing at the previous holder, so the SE cannot act.
- `new_status` is not validated against the status enum or the workflow.

### A5. AE queue ignores campus
- `getQueue` AE branch (`ticketController.js:197-210`) filters by `t.department = ?` only. The North AE sees South tickets (and the reverse) in "pending", but gets no buttons on them, because the desk owner is the other AE. This is confusing and hides which tickets are really theirs.
- The SE branch (211-218) has the same department-only filter.

### A6. Horticulture has no AE unless the seed script ran
- Horticulture AE coverage exists only through `EXTRA_AE_SCOPES` in `scripts/seed-staff.mjs:75-78`. Migration 004's backfill does not add it.
- Without that seed run, every Horticulture ticket hits A2.

### A7. Dean/Director are dummy accounts
- `seed-staff.mjs:66-69` seeds `dean.dummy@campus.edu` and `director.dummy@campus.edu`. Nobody can sign in to them with Google (`auth.js` requires `google.com` + verified email).
- A real Dean or Director signing in with their own email is auto-provisioned as `APPLICANT` (`src/middleware/auth.js`, auto-provision branch).
- Result: every ticket escalated above ₹50k is stuck at a desk nobody can open.

## B. Applicant cannot upload / raise ticket with photos

### B1. nginx has no `client_max_body_size`, so the default is 1 MB (critical)
- Neither `nginx.conf` nor `nginx-proxy.conf` sets `client_max_body_size`. Any request over 1 MB gets `413 Request Entity Too Large` from nginx before it reaches the backend.
- Phone photos are usually 2-8 MB, so a raise-ticket request with even one photo fails. JE reports (`site_photos` + `estimate_docs`) fail the same way.
- Multer allows 30 MB per file (`src/middleware/upload.js:52-56`), so the two limits disagree.
- nginx's 413 body is HTML, so `RaiseTicket.tsx` shows only the generic "Failed to submit the ticket".

### B2. Frontend accepts every image, backend accepts only a few
- `RaiseTicket.tsx` uses `accept="image/*"`. The backend allow-list (`upload.js:30-39`) permits only jpg/jpeg/png/webp/heic.
- A GIF, BMP, AVIF, `.heif`, or `.jpg` with an unusual MIME type makes multer reject the **whole ticket** with 415. The ticket is not saved without the file.

### B3. "Add more photos" replaces the earlier selection
- `RaiseTicket.tsx` `handleFileChange` calls `setFiles(selectedFiles)` instead of appending. Picking photos a second time with the "+" tile throws away the first ones.
- The input is never reset, so choosing the same file again does not fire `onChange`.

### B4. Orphan files on failed ticket creation
- `createTicket` (`ticketController.js:104-113`) moves files into `uploads/tickets/<id>/` inside the transaction. On rollback, `cleanupTempFiles` only removes temp paths, which are already moved.
- The moved files are left on disk under a ticket id that was never committed. The same happens in `submitReport` (427-435).

## C. Workflow deviations from spec

### C1. AE can assign a JE from the wrong campus
- `getEligibleJe` (`deskModel.js:89-97`) checks department only, not campus. On an `UNASSIGNED` ticket the AE can assign a North JE to a South ticket. The spec says campus-specific routing.

### C2. Extra FORWARD for SE/Dean within their limit
- `availableActions` (`workflow.js:142-143`) always offers FORWARD for SE→Dean and Dean→Director, even when the estimate is within the officer's limit.
- The spec says an approval within limit goes straight to `APPROVED_FOR_TENDERING`. Forwarding past your own authority is not in the spec. Confirm whether it is intended.

### C3. Only one AE per scope ever receives tickets
- `resolveAeForScope` (`deskModel.js:14-26`) uses `ORDER BY ... u.id ASC LIMIT 1`. A second AE on the same campus and department never gets a ticket, and if the first one is deactivated the fallback is not load-aware.

## Suggested fix order (not implemented)
1. B1 (nginx body size): unblocks uploads immediately.
2. A1 + A2 + A3: scope management in admin create/update, and re-resolve the desk owner when the stored owner is not the right role or is inactive.
3. A4, A7, A5, then the rest.

