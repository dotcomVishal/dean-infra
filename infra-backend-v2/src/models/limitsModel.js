/** financial_limits as { KEY: number }. No hardcoded fallback: a missing row
 *  makes availableActions fail closed (LIMIT_NOT_CONFIGURED). */
export async function loadLimits(connection) {
  const [rows] = await connection.query('SELECT `key`, max_amount FROM infra_financial_limits');
  return Object.fromEntries(rows.map((r) => [r.key, Number(r.max_amount)]));
}
