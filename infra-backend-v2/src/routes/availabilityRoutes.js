import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimit.js';
import { requireRole } from '../middleware/rbac.js';
import { markLeave, removeLeave, listAvailability } from '../controllers/availabilityController.js';

const router = express.Router();

// EVERY route below this line requires a valid token.
router.use(requireAuth);
router.use(userLimiter);

// Mark leave: self (JE/AE), or on behalf of a JE in scope (AE/SE/SYSADMIN).
router.post('/', requireRole(['JE', 'AE', 'SE', 'SYSADMIN']), markLeave);

// List leave: own, or (AE/SE/SYSADMIN) scoped/all.
router.get('/', requireRole(['JE', 'AE', 'SE', 'SYSADMIN']), listAvailability);

// Remove/end leave early: own, or (AE/SE/SYSADMIN) for a JE in scope.
router.delete('/:id', requireRole(['JE', 'AE', 'SE', 'SYSADMIN']), removeLeave);

export default router;
