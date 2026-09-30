import mysql from 'mysql2/promise';
import logger, { errorFields } from '../utils/logger.js';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'deanery_infra',
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0
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