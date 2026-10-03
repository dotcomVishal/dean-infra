// Structured (one JSON object per line) logger. stdout for info/warn, stderr for
// error, so `docker compose logs backend` stays greppable / shippable to a collector.
// Internal detail (SQL text, driver codes, stacks) belongs here and NEVER in a
// client response.
// Silent under `NODE_ENV=test` (npm test) unless LOG_IN_TEST is set.
const silent = () => process.env.NODE_ENV === 'test' && !process.env.LOG_IN_TEST;

const write = (level, msg, fields = {}) => {
  if (silent()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
};

/** Flatten an Error into loggable fields, including mysql2 / Firebase specifics. */
export const errorFields = (err) => {
  if (!err || typeof err !== 'object') return { error: { message: String(err) } };
  return {
    error: {
      name: err.name,
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState,
      sqlMessage: err.sqlMessage,
      stack: err.stack,
    },
  };
};

export const logger = {
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};

export default logger;
