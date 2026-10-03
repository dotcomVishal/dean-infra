import mysql from 'mysql2/promise';
import logger, { errorFields } from '../utils/logger.js';
import { dbConfig, SESSION_INIT_SQL } from './dbConfig.js';

const pool = mysql.createPool({
  ...dbConfig(),
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  // The database may be on another machine; campus firewalls drop idle connections.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

// Queued before the connection is handed to any caller, so it always runs first.
pool.on('connection', (connection) => {
  connection.query(SESSION_INIT_SQL);
});

// Test connection on startup
(async () => {
  try {
    const connection = await pool.getConnection();
    logger.info('connected to MySQL');
    connection.release();
  } catch (error) {
    logger.error('database connection failed', errorFields(error));
  }
})();

export default pool;
