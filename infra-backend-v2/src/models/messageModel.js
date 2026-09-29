/** ticket_messages access (plan.md §3.1). Visibility RULES are in
 *  config/workflow.js (canReadMessage); this file only moves rows. */

/** Insert the planned messages; returns their ids in the same order.
 *  Each spec already carries visible_from_rank and (resolved) to_user_id. */
export async function insertMessages(connection, { ticketId, auditLogId, authorUserId, specs }) {
  const ids = [];
  for (const s of specs) {
    const [result] = await connection.query(
      `INSERT INTO ticket_messages
         (ticket_id, audit_log_id, author_user_id, author_desk, to_user_id, to_desk,
          kind, body, visible_from_rank, in_reply_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ticketId, auditLogId, authorUserId, s.author_desk, s.to_user_id ?? null, s.to_desk ?? null,
       s.kind, s.body, s.visible_from_rank, s.in_reply_to ?? null]
    );
    ids.push(result.insertId);
  }
  return ids;
}

export async function getMessage(connection, id) {
  const [rows] = await connection.query(
    'SELECT id, ticket_id, author_desk, to_desk, kind, in_reply_to FROM ticket_messages WHERE id = ?',
    [id]
  );
  return rows[0] ?? null;
}

/** The open request and every ancestor, keyed by id (for nextOpenRequestId). */
export async function getThread(connection, openId) {
  const byId = {};
  let id = openId;
  while (id != null && byId[id] === undefined) {
    const m = await getMessage(connection, id);
    if (!m) break;
    byId[id] = m;
    id = m.in_reply_to;
  }
  return byId;
}

/** Every message on a ticket with sender/recipient names, oldest first.
 *  Callers MUST filter through canReadMessage before returning to a client. */
export async function listForTicket(connection, ticketId) {
  const [rows] = await connection.query(
    `SELECT m.id, m.kind, m.body, m.author_desk, m.to_desk, m.visible_from_rank, m.in_reply_to, m.created_at,
            a.name AS author_name, t.name AS to_name
       FROM ticket_messages m
       JOIN users a ON a.id = m.author_user_id
       LEFT JOIN users t ON t.id = m.to_user_id
      WHERE m.ticket_id = ?
      ORDER BY m.id ASC`,
    [ticketId]
  );
  return rows;
}
