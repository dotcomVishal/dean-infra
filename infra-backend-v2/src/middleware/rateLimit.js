import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000;

const tooMany = (req, res) => res.status(429).json({
  success: false, code: 'RATE_LIMITED', message: 'Too many requests, please try again later.', requestId: req.id,
});

/** Unauthenticated endpoints (sign-in sync): strict, per client IP. */
export const authLimiter = rateLimit({
  windowMs: WINDOW_MS, max: 100, handler: tooMany,
});

// Everything below runs after requireAuth, so the bucket is the person, not the IP:
// behind a proxy (or the Vite dev proxy) every user would otherwise share one bucket.
const perUser = (req) => (req.user?.id != null ? `u:${req.user.id}` : ipKeyGenerator(req.ip));

/** General limit for authenticated API routes. A ticket page makes one request per attachment. */
export const userLimiter = rateLimit({
  windowMs: WINDOW_MS, max: 600, keyGenerator: perUser, handler: tooMany,
});

/** File downloads (the ticket page loads every photo): own, higher bucket. */
export const downloadLimiter = rateLimit({
  windowMs: WINDOW_MS, max: 3000, keyGenerator: perUser, handler: tooMany,
});
