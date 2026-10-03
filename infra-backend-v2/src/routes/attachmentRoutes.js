import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { downloadLimiter } from '../middleware/rateLimit.js';
import { testRoleForAttachmentParam } from '../middleware/testRole.js';
import { hideDeletedAttachmentParam } from '../middleware/ticketGuard.js';
import { downloadAttachment } from '../controllers/attachmentController.js';

const router = express.Router();

// Every role may hit this route; WHAT they may read is decided per file by the
// visibility matrix inside the controller.
router.use(requireAuth, downloadLimiter);
router.param('id', testRoleForAttachmentParam);
router.param('id', hideDeletedAttachmentParam);
router.get('/:id', downloadAttachment);

export default router;
