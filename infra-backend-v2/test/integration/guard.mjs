// Importing this file stops a test run that is not pointed at a throwaway
// database. With the college credentials in a .env file, an accidental
// `npm run test:integration` would otherwise insert and delete rows in the
// shared database.
import 'dotenv/config';

if (process.env.NODE_ENV !== 'test' || !/_ci$/.test(process.env.DB_NAME ?? '')) {
  console.error(
    `Refusing to run: tests need NODE_ENV=test and a DB_NAME ending in "_ci" ` +
    `(got NODE_ENV=${process.env.NODE_ENV}, DB_NAME=${process.env.DB_NAME}).`);
  process.exit(1);
}
