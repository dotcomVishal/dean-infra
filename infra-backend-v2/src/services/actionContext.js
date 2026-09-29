// Gathers everything the pure state machine needs about a ticket into the
// shape availableActions()/resolveAction() expect. Shared by the /actions
// endpoint (inside its transaction) and the details endpoint (read-only), so
// the buttons the UI is shown and the actions the server accepts come from
// the same inputs.
import { DESK_RANK, deskForStatus } from '../config/workflow.js';
import { findDeskOwner, findOwners } from '../models/deskModel.js';
import { loadLimits } from '../models/limitsModel.js';
import { latestEstimate } from '../models/reportModel.js';

const DESKS = ['JE', 'AE', 'SE', 'DEAN', 'DIRECTOR'];

/**
 * @param connection  pool or transaction connection
 * @param ticketRow   { id, status, department, campus, assigned_je_id, current_desk_user_id }
 * @param user        { id, role }
 * @returns {{ ticket, limits }}  ready for availableActions / resolveAction
 */
export async function loadActionContext(connection, ticketRow, user) {
  const desk = deskForStatus(ticketRow.status);

  // Tickets raised before current_desk_user_id existed have NULL: resolve the
  // owner on the fly so they stay actionable instead of being stranded.
  let currentDeskUserId = ticketRow.current_desk_user_id;
  if (currentDeskUserId == null && desk) {
    currentDeskUserId = (await findDeskOwner(connection, ticketRow, desk))?.id ?? null;
  }

  const ticket = { status: ticketRow.status, current_desk_user_id: currentDeskUserId };
  let limits = {};

  // Only do the extra reads when this user could actually be on the desk.
  if (desk && user.role === desk && currentDeskUserId === user.id) {
    ticket.estimate = await latestEstimate(connection, ticketRow.id);
    limits = await loadLimits(connection);
    const lower = DESKS.filter((d) => DESK_RANK[d] < DESK_RANK[desk]);
    ticket.desk_owners = await findOwners(connection, ticketRow, lower);
  }
  return { ticket, limits };
}
