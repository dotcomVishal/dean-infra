import rateLimit from 'express-rate-limit';

// X1: behind the institute's forwarder + dean-proxy the backend can see one
// address for every user, so an address-keyed bucket is shared by everybody.
// Signed-in traffic is therefore counted per user id (limiter runs after
// requireAuth). The address-keyed limiter below only guards rejected tokens.

const handler = (req, res) => res.status(429).json({
  success: false, code: 'RATE_LIMITED', message: 'Too many requests, please try again later.', requestId: req.id,
});

const WINDOW_MS = 15 * 60 * 1000;

const perUser = (max) => rateLimit({
  windowMs: WINDOW_MS,
  limit: max,
  handler,
  // requireAuth has run, so req.user is set. Fall back to the address only if a
  // router forgets the order (never happens on a protected route).
  keyGenerator: (req) => (req.user ? `u:${req.user.id}` : `ip:${req.ip}`),
  validate: { keyGeneratorIpFallback: false },
});

/** JSON API traffic of one signed-in user. */
export const userLimiter = perUser(Number(process.env.RATE_LIMIT_USER) || 600);

/** Attachment thumbnails: a ticket page fires one request per file, so own bucket. */
export const attachmentLimiter = perUser(Number(process.env.RATE_LIMIT_ATTACHMENT) || 3000);

/** Address-keyed. Counts only 401s (rejected tokens) and /api/auth, so a shared address is not starved. */
export const authFailureLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: Number(process.env.RATE_LIMIT_AUTH_FAILURES) || 300,
  handler,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
});
