// Strict payload for POST /tickets/:ticket_id/actions (plan.md §4 Phase 4
// item 2). Runs before any DB transaction opens. `.strict()`: unknown keys
// are rejected, not silently stripped -- a zero-trust endpoint should not
// accept fields it does not understand.
import { z } from 'zod';

const blankToUndefined = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalText = (max) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

export const ACTION_ENDPOINT_ACTIONS = ['FORWARD', 'APPROVE', 'REQUEST_CHANGES', 'REJECT', 'ASSIGN_JE'];
const DESKS = ['JE', 'AE', 'SE', 'DEAN', 'DIRECTOR'];

export const actionSchema = z
  .object({
    action: z.enum(ACTION_ENDPOINT_ACTIONS),
    to_desk: z.preprocess(blankToUndefined, z.enum(DESKS).optional()),
    message: optionalText(5000),
    internal_remark: optionalText(5000),
    public_note: optionalText(2000),
    // ASSIGN_JE needs to say WHICH JE; not part of the generic payload.
    assignee_id: z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional()),
    // Multipart text field: true = the attached files are readable only by this desk and above.
    restricted_files: z.preprocess((v) => v === 'true' || v === true || v === '1', z.boolean().optional()),
  })
  .strict()
  .superRefine((data, ctx) => {
    const need = (field, msg) => ctx.addIssue({ code: 'custom', path: [field], message: msg });
    if (data.action === 'REQUEST_CHANGES') {
      if (!data.to_desk) need('to_desk', 'to_desk is required for REQUEST_CHANGES.');
      if (!data.message) need('message', 'message is required for REQUEST_CHANGES.');
    } else if (data.to_desk) {
      need('to_desk', 'to_desk is only valid for REQUEST_CHANGES.');
    }
    if (data.action === 'REJECT' && !data.message) need('message', 'message (the reason) is required for REJECT.');
    if (data.action === 'ASSIGN_JE' && data.restricted_files) need('restricted_files', 'ASSIGN_JE takes no files.');
    if (data.action === 'ASSIGN_JE') {
      if (!data.assignee_id) need('assignee_id', 'assignee_id is required for ASSIGN_JE.');
    } else if (data.assignee_id) {
      need('assignee_id', 'assignee_id is only valid for ASSIGN_JE.');
    }
  });
