import mysql from 'mysql2/promise';
import logger, { errorFields } from '../utils/logger.js';
import { buildConnectionOptions, SESSION_SQL } from './dbOptions.js';

const pool = mysql.createPool(buildConnectionOptions({
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_LIMIT) || 15,
  queueLimit: 0,
  enableKeepAlive: true,
  idleTimeout: 60000,
}));

// Fix the time zone and sql_mode on every new connection, before any other
// statement (mysql2 runs commands on a connection in the order they are queued).
pool.on('connection', (connection) => {
  connection.query(SESSION_SQL, (error) => {
    if (error) logger.error('database session setup failed', errorFields(error));
  });
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
