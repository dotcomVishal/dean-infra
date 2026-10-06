/** Next version number for a ticket's report. Call with the ticket row
 *  locked (FOR UPDATE); the (ticket_id, version) unique key is the backstop. */
export async function nextVersion(connection, ticketId) {
  const [rows] = await connection.query(
    'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM mnt_reports WHERE ticket_id = ?',
    [ticketId]
  );
  return Number(rows[0].next);
}

export async function insertReport(connection, {
  ticketId, jeId, version, natureOfWork, amount, remarks, answersMessageId,
}) {
  const [result] = await connection.query(
    `INSERT INTO mnt_reports
       (ticket_id, je_id, version, nature_of_work, estimated_amount, remarks, answers_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [ticketId, jeId, version, natureOfWork, amount, remarks, answersMessageId]
  );
  return result.insertId;
}

/** Newest version's estimate, or null if the JE never filed. */
export async function latestEstimate(connection, ticketId) {
  const [rows] = await connection.query(
    'SELECT estimated_amount FROM mnt_reports WHERE ticket_id = ? ORDER BY version DESC LIMIT 1',
    [ticketId]
  );
  return rows.length > 0 ? Number(rows[0].estimated_amount) : null;
}
