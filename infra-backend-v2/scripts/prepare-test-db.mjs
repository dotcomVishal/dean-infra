// Brings an EMPTY MySQL up to the current schema for CI / local integration tests:
// it just runs the migration runner server.js runs on every boot.
// Refuses unless NODE_ENV=test and DB_NAME ends with `_test`. The database itself
// is created by the service container (MYSQL_DATABASE) or by hand.
import 'dotenv/config';
import '../src/config/requireTestDb.js';
import { runMigrations } from '../src/config/migrate.js';

await runMigrations({ expectExisting: false });
console.log('prepare-test-db: schema ready.');
