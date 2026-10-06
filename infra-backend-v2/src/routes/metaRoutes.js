import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimit.js';
import { UPLOAD_LIMITS } from '../middleware/upload.js';

const router = express.Router();
router.use(requireAuth);
router.use(userLimiter);

// The forms check files against these before sending, so a too-large upload is
// refused on the page instead of failing at the proxy with an unreadable error.
router.get('/upload-limits', (_req, res) => res.json({ success: true, limits: UPLOAD_LIMITS }));

export default router;
