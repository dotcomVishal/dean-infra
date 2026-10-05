import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';

// S12: every request gets an id the client can quote back to support.
// Always generated here -- a caller-supplied X-Request-Id is never trusted, so
// it cannot be used to forge or inject log lines.
export const requestId = (req, res, next) => {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    // Health checks poll every few seconds; keep them out of the log.
    if (req.originalUrl === '/api/health') return;
    logger.info('request', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0], // no query string: it may carry tokens
      status: res.statusCode,
      ms: Number(process.hrtime.bigint() - start) / 1e6,
      userId: req.user?.id,
      ip: req.ip, // X1: shows which address the backend sees behind the proxies
    });
  });
  next();
};

export default requestId;
