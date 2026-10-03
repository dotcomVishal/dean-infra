import fs from 'fs';
import { assertHostAllowed } from './dbGuard.js';

/**
 * Connection options shared by the app pool and the migration runner.
 * Every connection is forced to UTC (the server clock may be in another zone),
 * utf8mb4, and gets a connect timeout. Throws when the host is not allowed.
 */
export function dbConfig(overrides = {}) {
  const host = process.env.DB_HOST || 'localhost';
  assertHostAllowed(host);
  return {
    host,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'infraseva',
    charset: 'utf8mb4',
    timezone: 'Z',
    connectTimeout: 10000,
    ...(process.env.DB_SSL_CA ? { ssl: { ca: fs.readFileSync(process.env.DB_SSL_CA) } } : {}),
    ...overrides,
  };
}

/** Run on every new connection: the database clock functions (NOW()) must agree with Node. */
export const SESSION_INIT_SQL = "SET time_zone = '+00:00'";
