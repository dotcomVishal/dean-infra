// First sign-in provisioning. Identity goes to core_users, shared by every module;
// no mnt_members row is written, and no row means APPLICANT.

/**
 * Create a core_users row for a Google account. Returns the id.
 * Another request, or another module, may create the same person at the same
 * moment: a duplicate-key error then means "it exists now", so read the row again.
 */
export async function provisionApplicant(db, { firebaseUid, name, email }) {
  try {
    const [result] = await db.query(
      'INSERT INTO core_users (firebase_uid, name, email, is_active) VALUES (?, ?, ?, TRUE)',
      [firebaseUid, name, email]
    );
    return result.insertId;
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    const [rows] = await db.query('SELECT id FROM core_users WHERE firebase_uid = ? OR email = ? LIMIT 1', [firebaseUid, email]);
    if (rows.length === 0) throw err;
    return rows[0].id;
  }
}
