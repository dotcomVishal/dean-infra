import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimit.js';
import { requireRole } from '../middleware/rbac.js';
import { requireMockTesting } from '../middleware/testRole.js';
import {
  getAdminMetrics,
  getAllTickets,
  exportTickets,
  getTicketMasterDetails,
  overrideTicketStatus,
  getAllUsers,
  createUser,
  updateUser,
  getMasterAuditLogs,
  getActiveJes,
  getStaff,
  listTestTickets,
  createTestTicket,
  resetTestTicket,
  deleteTestTicket,
  previewDigest,
  getDeletionPreview,
  deleteTicket,
  listDeletedTickets,
} from '../controllers/adminController.js';

const router = express.Router();

// ALL admin endpoints strictly enforce authentication and SYSADMIN role
router.use(requireAuth);
router.use(userLimiter);
router.use(requireRole(['SYSADMIN']));

// Overview & Metrics
router.get('/metrics', getAdminMetrics);

// Tickets master control
router.get('/tickets', getAllTickets);
router.get('/tickets/export', exportTickets);
router.get('/tickets/:ticket_id/details', getTicketMasterDetails);
router.post('/tickets/:ticket_id/override', overrideTicketStatus);
router.get('/tickets/:ticket_id/delete-preview', getDeletionPreview);
router.delete('/tickets/:ticket_id', deleteTicket);
router.get('/deleted-tickets', listDeletedTickets);

// Users management
router.get('/users', getAllUsers);
router.post('/users', createUser);
router.patch('/users/:id', updateUser);
router.put('/users/:id', updateUser);

// Global audit trail
router.get('/audit-logs', getMasterAuditLogs);

// Weekly digest text for one user, for review before go-live (sends nothing)
router.post('/digest/preview', previewDigest);

// JE directory for reassignment
router.get('/jes', getActiveJes);

// Staff directory for any desk (override form)
router.get('/staff', getStaff);

// Sysadmin mock testing (404 when MOCK_TESTING_ENABLED=false)
router.get('/test-tickets', requireMockTesting, listTestTickets);
router.post('/test-tickets', requireMockTesting, createTestTicket);
router.post('/test-tickets/:ticket_id/reset', requireMockTesting, resetTestTicket);
router.delete('/test-tickets/:ticket_id', requireMockTesting, deleteTestTicket);

export default router;
