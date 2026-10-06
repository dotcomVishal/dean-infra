// One place that builds MySQL connection options. Kept apart from db.js so a
// script can import it without creating the pool.
//
// DB_HOST, DB_USER, DB_PASSWORD and DB_NAME are required: a missing variable
// must fail loudly, never fall back to some other database.

// Fixed per connection so the app does not depend on the server's time zone or
// sql_mode (the college server runs in IST; the code writes UTC).
export const SESSION_SQL =
  "SET time_zone = '+00:00', sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'";

export function buildConnectionOptions(extra = {}) {
  const missing = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    timezone: 'Z',
    ...extra,
  };
}

/** Open a single connection with the session settings applied. */
export async function openConnection(mysql, extra = {}) {
  const conn = await mysql.createConnection(buildConnectionOptions(extra));
  await conn.query(SESSION_SQL);
  return conn;
}
