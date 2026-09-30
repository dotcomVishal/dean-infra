/** One audit row per movement (plan.md §3.1). Returns the new audit id. */
export async function insertAudit(connection, {
  ticketId, userId, action, remarks = null,
  fromStatus = null, toStatus = null, fromDesk = null, toDesk = null, visibility = 'ALL', isSelfAction = false,
}) {
  const [result] = await connection.query(
    `INSERT INTO audit_logs
       (ticket_id, user_id, action, remarks, from_status, to_status, from_desk, to_desk, visibility, is_self_action)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [ticketId, userId, action, remarks, fromStatus, toStatus, fromDesk, toDesk, visibility, isSelfAction ? 1 : 0]
  );
  return result.insertId;
}
