import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'deanery_infra',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test connection on startup
try {
  const connection = await pool.getConnection();
  console.log('Connected to MySQL Database (deanery_infra)');
  connection.release();
} catch (error) {
  console.error('Database connection failed:', error.message);
}

export default pool;