/** tickets table access for the workflow. Rules live in config/workflow.js. */

const COLUMNS = `id, status, department, campus, applicant_id, assigned_je_id, assigned_ae_id, assigned_se_id,
  is_mock, current_desk_user_id, open_change_request_id`;

export async function lockById(connection, ticketId) {
  const [rows] = await connection.query(`SELECT ${COLUMNS} FROM infra_tickets WHERE id = ? FOR UPDATE`, [ticketId]);
  return rows[0] ?? null;
}

/** Locks the ticket only if it is assigned to this JE (ownership in the SELECT). */
export async function lockForJe(connection, ticketId, jeId) {
  const [rows] = await connection.query(
    `SELECT ${COLUMNS} FROM infra_tickets WHERE id = ? AND assigned_je_id = ? FOR UPDATE`,
    [ticketId, jeId]
  );
  return rows[0] ?? null;
}

/**
 * Compare-and-swap move: the WHERE repeats the status the caller validated
 * against, so a concurrent change makes affectedRows 0. Returns true if it applied.
 */
export async function applyTransition(connection, {
  ticketId, fromStatus, toStatus, currentDeskUserId, openChangeRequestId, assignedJeId,
  assignedAeId, assignedSeId,
}) {
  const setsAssignee = assignedJeId !== undefined;
  const setsAe = assignedAeId !== undefined;
  const setsSe = assignedSeId !== undefined;
  const [result] = await connection.query(
    `UPDATE infra_tickets
        SET status = ?, current_desk_user_id = ?, open_change_request_id = ?, status_changed_at = NOW()
            ${setsAssignee ? ', assigned_je_id = ?, assigned_at = NOW()' : ''}
            ${setsAe ? ', assigned_ae_id = ?' : ''}
            ${setsSe ? ', assigned_se_id = ?' : ''}
      WHERE id = ? AND status = ?`,
    [toStatus, currentDeskUserId, openChangeRequestId, ...(setsAssignee ? [assignedJeId] : []),
      ...(setsAe ? [assignedAeId] : []), ...(setsSe ? [assignedSeId] : []), ticketId, fromStatus]
  );
  return result.affectedRows === 1;
}

export async function setOpenChangeRequest(connection, ticketId, messageId) {
  await connection.query('UPDATE infra_tickets SET open_change_request_id = ? WHERE id = ?', [messageId, ticketId]);
}
