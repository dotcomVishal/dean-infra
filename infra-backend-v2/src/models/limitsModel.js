/** financial_limits as { KEY: number }. No hardcoded fallback: a missing row
 *  makes availableActions fail closed (LIMIT_NOT_CONFIGURED). */
export async function loadLimits(connection) {
  const [rows] = await connection.query('SELECT `key`, max_amount FROM financial_limits');
  return Object.fromEntries(rows.map((r) => [r.key, Number(r.max_amount)]));
}

/** The two limits a Sysadmin may edit. DEAN_HIGH_VALUE and DIRECT_AWARD are not part of this. */
export const EDITABLE_LIMITS = Object.freeze(['SE_APPROVE', 'DEAN_APPROVE']);

/** Editable limits with when each changed and who changed it. A missing row reads as null. */
export async function readEditableLimits(connection) {
  const [rows] = await connection.query(
    `SELECT l.\`key\`, l.max_amount, l.updated_at, u.name AS updated_by_name
       FROM financial_limits l LEFT JOIN users u ON u.id = l.updated_by
      WHERE l.\`key\` IN (?)`, [EDITABLE_LIMITS]);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  return Object.fromEntries(EDITABLE_LIMITS.map((key) => {
    const r = byKey[key];
    return [key, { amount: r ? Number(r.max_amount) : null, updated_at: r?.updated_at ?? null, updated_by: r?.updated_by_name ?? null }];
  }));
}

/** Writes both rows. A missing row is created rather than left failing closed. Caller owns the transaction. */
export async function saveLimits(connection, { SE_APPROVE, DEAN_APPROVE }, userId) {
  await connection.query(
    `INSERT INTO financial_limits (\`key\`, max_amount, updated_by) VALUES ('SE_APPROVE', ?, ?), ('DEAN_APPROVE', ?, ?)
     ON DUPLICATE KEY UPDATE max_amount = VALUES(max_amount), updated_by = VALUES(updated_by)`,
    [SE_APPROVE, userId, DEAN_APPROVE, userId]);
}
