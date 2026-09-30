# Plan v2 — Workflow gap fixes


## Context

The intended workflow is:

Applicant raises a ticket (campus) → auto-routed to a JE on that campus → JE submits estimate and documents → AE verifies and forwards → SE (≤ ₹50,000) → Dean (≤ ₹5,00,000) → Director (unlimited).

- APPROVE within the officer's limit goes to `APPROVED_FOR_TENDERING`.
- APPROVE above the officer's limit **automatically escalates** to the next officer.
- RETURN moves the ticket **one step back** to the desk that forwarded it.
- **Only the Director can deny.**
- Applicants and JEs see only public updates.
- Only the current desk holder can act.

I traced the backend state machine (`src/config/workflow.js`), the action endpoint, report submission, assignment, visibility, and the frontend `ActionPanel`. Most of the chain works: campus routing, JE report flow, AE forward, desk-ownership checks, limit checks from `financial_limits` (50,000 / 5,00,000 in migration 003), and message redaction. Three core rules differ from the spec. A few smaller issues sit around them.

---

## Bugs that break the stated workflow (fix these)

### B1. APPROVE above the limit is blocked instead of escalating — HIGH
- `workflow.js:157-160` (`availableActions`): when the estimate is above the limit, APPROVE is **disabled** with code `ABOVE_LIMIT` and the message "Forward it instead". `resolveAction` then throws.
- Spec: approving above your limit should escalate the ticket to the next officer automatically.
- **Fix** (`workflow.js` only; every caller routes through it):
  - In `availableActions`, keep APPROVE **enabled** when the estimate is above the limit. Add `escalates_to: NEXT_DESK[desk]` to the descriptor so the UI can label the button.
  - Keep the `ESTIMATE_MISSING` and `LIMIT_NOT_CONFIGURED` fail-closed cases unchanged.
  - In `resolveAction` `case APPROVE`: when `key && Number(estimate) > limit`, return `done(desk, NEXT_DESK[desk], STATUS_FOR_DESK[next], LOG_ACTION.FORWARDED)`. Set `t.action = ACTION.FORWARD` and `t.escalated = true`. Otherwise return the existing `APPROVED_FOR_TENDERING` result.
- **Follow-up in `actionController.js`:** use `t.action` (not the raw request `action`) when calling `planMessages`, `notifyTransition`, and `opensNewRequest`. With this, an escalation behaves exactly like a FORWARD. For example, a reply is still required when answering an open change request, and FORWARD notifications go out.
- **Frontend** `ActionPanel.tsx` `meta()`: when `a.escalates_to` is set, label the button "Approve (escalates to {desk})". Show the reply textarea for APPROVE-that-escalates when `replying`, in the same way as for FORWARD.

### B2. SE and Dean can deny; only the Director should — HIGH
- `workflow.js:92`: `CAN_REJECT = [SE, DEAN, DIRECTOR]`.
- **Fix:** change it to `[DESK.DIRECTOR]`. No other change is needed. The UI renders buttons from `available_actions`.

### B3. RETURN can skip desks; it should go back exactly one step — HIGH
- `workflow.js:165-172`: REQUEST_CHANGES targets are **every** lower desk that has an owner. For example, the Director can send a ticket straight to the JE, and the Dean can send it to the AE.
- Spec: Director → Dean → SE → AE → JE, one step at a time.
- **Fix:** add `PREV_DESK = { AE: JE, SE: AE, DEAN: SE, DIRECTOR: DEAN }`. Set targets to `[PREV_DESK[desk]]`, filtered by the existing `desk_owners` check.
- The `to_desk` field in the action payload stays in place (validation still requires it). It is now only allowed to be the previous desk.
- The frontend "Send to" select then shows one option. Optional: auto-select it in `ActionPanel` when `rc.targets.length === 1`.

---

## Secondary issues (same flow, lower impact)

### S1. SE and Dean still have a manual FORWARD button — decision needed
- The spec lists only approve and return for SE and Dean. With B1 in place, a manual FORWARD lets an SE send a ₹10,000 ticket to the Dean or Director without approving it.
- **Recommend:** limit `NEXT_DESK`-based FORWARD in `availableActions` to the AE (`if (next && desk === DESK.AE)`). SE and Dean then move tickets up only through APPROVE-escalation.
- `NEXT_DESK` stays unchanged, because escalation uses it.

### S2. Tickets can get stuck at the SYSADMIN fallback
- `deskModel.resolveDeskOwner` falls back to SYSADMIN when a desk has no active owner.
- `availableActions` requires `user.role === desk`, so the SYSADMIN holds the ticket but cannot act. The only way out is the admin override (`adminController.overrideTicketStatus`).
- **Fix (minimal):** none in code. Document it in the plan, and confirm the admin override UI can reassign or move the ticket.
- Alternative: make the action endpoint return `NO_DESK_OWNER` (409) instead of silently parking the ticket. The existing check at `actionController.js:87` already does this when the owner is null. You would only need to call `findDeskOwner` (no fallback) for the SE, Dean, and Director desks.
- Pick the alternative only if parking is unwanted.

### S3. JE-raised tickets skip campus routing
- `ticketController.js:70`: a JE raising a ticket in their own department is self-assigned, even when the ticket is on the other campus.
- **Fix:** also require a JE scope match for `campus`: check `user_scopes` for `campus IN (?, 'BOTH')`. Otherwise fall through to `assignTicket`.

### S4. AE manual assignment ignores campus
- `deskModel.getEligibleJe` accepts any JE in the department. The picker only labels someone as "other campus".
- By design (the comment references plan §3.2 picker), so leave it unless strict campus isolation is required. Noted only.

### S5. The SE queue filters by department, but SE desk resolution does not
- `getQueue` (SE) uses `t.department = ?`, while `findDeskOwner('SE')` can pick an SE from any department.
- The main board (`/tickets/desk`) keys on `current_desk_user_id`, so it works. The `queue` "pending" tab can miss tickets that are on this SE's desk.
- **Fix:** SE pending → `(t.department = ? OR t.current_desk_user_id = ?)`. This mirrors the AE branch.

### S6. Visibility — verified OK, with two notes
- Applicants: allow-list projection, only `PUBLIC_NOTE` messages, no audit trail. ✔
- JEs: `INTERNAL_REMARK` and `CHANGE_REQUEST` above rank 1 are hidden, authority audit remarks are neutralised, and `AUTHORITY_REMARKS` attachments are hidden. ✔
- Note 1: `REJECTION_REASON` has `visible_from_rank: 1`, so the applicant never sees why the ticket was denied. They only see what the officer puts in the optional public note. This is acceptable under "public updates only", so no change.
- Note 2: the Dean queue tab `high_value` hardcodes `200000` (`ticketController.js:216`). This is cosmetic. Optional: read it from `financial_limits`.

---

## Files to change
- `infra-backend-v2/src/config/workflow.js` — B1, B2, B3, S1 (most of the work).
- `infra-backend-v2/src/controllers/actionController.js` — B1 follow-up (use `t.action`).
- `infra-frontend/src/components/ticket/ActionPanel.tsx` — B1 label and reply box; B3 auto-select.
- `infra-backend-v2/src/controllers/ticketController.js` — S3, S5.
- `infra-backend-v2/scripts/test-workflow.mjs` — update the tests that currently encode the old behaviour:
  - line 36–37: SE and Dean lose REJECT (and FORWARD if S1 is applied);
  - lines 93–96 and 108–111: ABOVE_LIMIT becomes escalation;
  - lines 73–84: REQUEST_CHANGES targets become the single previous desk;
  - line 124: SE REJECT becomes `ACTION_NOT_ALLOWED`.

## Verification
1. Run `cd infra-backend-v2 && npm test`. The unit tests in `test-workflow.mjs` must pass after they are updated. Add these cases:
   - SE approves ₹60,000 → `PENDING_DEAN_APPROVAL` with log `FORWARDED`.
   - Dean approves ₹6,00,000 → `PENDING_DIRECTOR_APPROVAL`.
   - Director approves any amount → `APPROVED_FOR_TENDERING`.
   - SE and Dean REJECT → `ACTION_NOT_ALLOWED`.
   - Director REQUEST_CHANGES to JE → `INVALID_TARGET_DESK`.
2. Run `npm run test:integration:local` (docker MySQL on port 3307) for the end-to-end DB paths.
3. Manual run with seeded users (`scripts/seed-mock-users.mjs`):
   - Raise a NORTH ticket → it lands with the NORTH JE.
   - JE files a ₹3,00,000 estimate with a quote → it goes to the AE.
   - AE forwards → SE clicks Approve → the ticket escalates to the Dean.
   - Dean returns it → the ticket is back with the SE.
   - SE approves → the ticket escalates to the Dean again → the Dean approves → `APPROVED_FOR_TENDERING`.
   - Log in as the applicant and the JE: no internal remarks are visible.
