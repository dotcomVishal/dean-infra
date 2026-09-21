import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  getAdminMetrics,
  getAllTickets,
  getTicketMasterDetails,
  overrideTicketStatus,
  getAllUsers,
  createUser,
  updateUser,
  getMasterAuditLogs,
  getActiveJes,
} from '../controllers/adminController.js';

const router = express.Router();

// ALL admin endpoints strictly enforce authentication and SYSADMIN role
router.use(requireAuth);
router.use(requireRole(['SYSADMIN']));

// Overview & Metrics
router.get('/metrics', getAdminMetrics);

// Tickets master control
router.get('/tickets', getAllTickets);
router.get('/tickets/:ticket_id/details', getTicketMasterDetails);
router.post('/tickets/:ticket_id/override', overrideTicketStatus);

// Users management
router.get('/users', getAllUsers);
router.post('/users', createUser);
router.patch('/users/:id', updateUser);

// Global audit trail
router.get('/audit-logs', getMasterAuditLogs);

// JE directory for reassignment
router.get('/jes', getActiveJes);

export default router;
