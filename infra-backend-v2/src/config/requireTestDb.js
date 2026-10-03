// Side-effect import: put it right after `dotenv/config` in any script that
// writes or deletes rows. It stops the process unless the target is a test database.
import { assertTestDatabase } from './dbGuard.js';

assertTestDatabase('This script');
