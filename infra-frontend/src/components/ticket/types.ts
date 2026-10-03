import type { Attachment } from './Attachments';

export interface AvailableAction {
  action: string;
  enabled: boolean;
  code?: string;
  reason?: string;
  targets?: string[];
  escalates_to?: string;
}

export interface AvailableActions {
  desk: string | null;
  actions: AvailableAction[];
}

export interface ApprovalLimit {
  can_approve: boolean;
  unlimited: boolean;
  amount: number | null;
}

export interface TicketMessage {
  id: number;
  kind: 'CHANGE_REQUEST' | 'REPLY' | 'INTERNAL_REMARK' | 'REJECTION_REASON' | 'PUBLIC_NOTE';
  body: string;
  author_desk: string;
  to_desk: string | null;
  visible_from_rank: number;
  in_reply_to: number | null;
  created_at: string;
  author_name: string | null;
  to_name: string | null;
}

export interface AuditEntry {
  action: string;
  remarks: string | null;
  created_at: string;
  actor_role: string;
  actor_name?: string;
  is_self_action?: boolean;
  from_desk: string | null;
  to_desk: string | null;
}

export interface Report {
  id: number;
  version?: number;
  nature_of_work: string;
  estimated_amount: number | string;
  remarks?: string | null;
  created_at: string;
}

export interface Tender {
  id: number;
  nit_number?: string | null;
  portal_type: string;
  status?: string;
  tender_created_date?: string | null;
  tender_end_date?: string | null;
  technical_eval_at?: string | null;
  financial_eval_at?: string | null;
  awarded_agency?: string | null;
  award_amount?: number | string | null;
  awarded_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  remarks?: string | null;
}

export type LifecycleAction =
  | 'PUBLISH_TENDER' | 'START_TECHNICAL_EVAL' | 'START_FINANCIAL_EVAL' | 'AWARD' | 'CANCEL_TENDER' | 'RESOLVE';

/** The JE's steps after approval, straight from the server's rule table. */
export interface AvailableLifecycleAction {
  action: LifecycleAction;
  resolution?: 'COMPLETED' | 'OVERRIDE';
  requires: string[];
}

/** Present only for the person who must confirm a resolved ticket (applicant, or the AE when the JE raised it). */
export interface Confirmation {
  can_confirm: boolean;
  can_send_back: boolean;
  resolution_kind: 'COMPLETED' | 'TENDER_CANCELLED' | 'OVERRIDE' | null;
  auto_close_at: string | null;
}

/** Union of the staff payload and the (much smaller) applicant projection. */
export interface TicketDetail {
  id: number;
  title?: string | null;
  description: string;
  type?: string;
  priority?: string | null;
  department: string;
  campus?: string | null;
  landmark?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  status: string;
  stage_label?: string;
  created_at: string;
  updated_at?: string;
  status_changed_at?: string | null;
  assigned_at?: string | null;
  // Present only in the staff payload:
  applicant_id?: number;
  applicant_name?: string;
  applicant_email?: string;
  applicant_phone?: string;
  contact_phone?: string;
  open_change_request_id?: number | null;
  report?: Report | null;
  tenders?: Tender[];
  attachments: Attachment[];
  audit_logs?: AuditEntry[];
  messages?: TicketMessage[];
  reminder_count?: number | null;
  available_actions?: AvailableActions;
  approval_limit?: ApprovalLimit;
  desk_people?: Record<string, string>;
  assignees?: Assignees;
  available_lifecycle_actions?: AvailableLifecycleAction[];
  confirmation?: Confirmation;
  resolution_kind?: 'COMPLETED' | 'TENDER_CANCELLED' | 'OVERRIDE' | null;
  resolved_at?: string | null;
  applicant_sent_back_at?: string | null;
  reopen_count?: number;
}

export interface DeskHolder { id: number; name: string }
/** Staff only. A JE gets only their own desk and the desk now holding the ticket, without names. */
export interface Assignees {
  JE: DeskHolder | null;
  AE: DeskHolder | null;
  SE: DeskHolder | null;
  DEAN: DeskHolder | null;
  DIRECTOR: DeskHolder | null;
  current: { desk: string; id?: number; name?: string } | null;
}
