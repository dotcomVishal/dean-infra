// Guards that keep a development machine or a test run away from a real database.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Outside production the backend may only talk to a local database. Development
 * and CI always use a local container, so production credentials in a local
 * `.env` cannot reach the real server.
 */
export function assertHostAllowed(host = process.env.DB_HOST || 'localhost') {
  if (process.env.NODE_ENV === 'production') return;
  if (LOCAL_HOSTS.has(host)) return;
  throw new Error(
    `Refusing to connect to database host "${host}" while NODE_ENV is "${process.env.NODE_ENV ?? ''}". `
    + 'Only localhost, 127.0.0.1 and ::1 are allowed outside production.'
  );
}

/** Tests and seed scripts that write and delete rows run only against a database named *_test. */
export function assertTestDatabase(label = 'this script', name = process.env.DB_NAME) {
  if (process.env.NODE_ENV !== 'test' || !String(name ?? '').endsWith('_test')) {
    throw new Error(
      `${label} refuses to run: it needs NODE_ENV=test and a DB_NAME ending in "_test" `
      + `(got NODE_ENV=${process.env.NODE_ENV ?? ''}, DB_NAME=${name ?? ''}).`
    );
  }
}
