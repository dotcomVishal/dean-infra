// Registry: template name -> module. A mail is one file; to change its wording, edit that file.
import * as applicantReceived from './applicant/received.js';
import * as applicantResolved from './applicant/resolved.js';
import * as applicantRejected from './applicant/rejected.js';
import * as applicantClosed from './applicant/closed.js';
import * as jeAssigned from './je/assigned.js';
import * as jeTransferred from './je/transferred.js';
import * as jeReassignedAway from './je/reassigned-away.js';
import * as jeApproved from './je/approved.js';
import * as jeRejected from './je/rejected.js';
import * as jeSentBack from './je/sent-back.js';
import * as jeReminder from './je/reminder.js';
import * as jeClosed from './je/closed.js';
import * as deskChangesRequested from './desk/changes-requested.js';
import * as deskArrival from './desk/arrival.js';
import * as deskNeedsJe from './desk/needs-je.js';
import * as deskNewTicket from './desk/new-ticket.js';
import * as digest from './digest.js';

export const TEMPLATES = Object.freeze({
  'applicant/received': applicantReceived,
  'applicant/resolved': applicantResolved,
  'applicant/rejected': applicantRejected,
  'applicant/closed': applicantClosed,
  'je/assigned': jeAssigned,
  'je/transferred': jeTransferred,
  'je/reassigned-away': jeReassignedAway,
  'je/approved': jeApproved,
  'je/rejected': jeRejected,
  'je/sent-back': jeSentBack,
  'je/reminder': jeReminder,
  'je/closed': jeClosed,
  'desk/changes-requested': deskChangesRequested,
  'desk/arrival': deskArrival,
  'desk/needs-je': deskNeedsJe,
  'desk/new-ticket': deskNewTicket,
  digest,
});
