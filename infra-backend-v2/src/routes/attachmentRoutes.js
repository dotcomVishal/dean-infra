import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { attachmentLimiter } from '../middleware/rateLimit.js';
import { testRoleForAttachmentParam } from '../middleware/testRole.js';
import { demoAttachmentParam } from '../middleware/demoWorld.js';
import { downloadAttachment } from '../controllers/attachmentController.js';

const router = express.Router();

// Every role may hit this route; WHAT they may read is decided per file by the
// visibility matrix inside the controller.
router.use(requireAuth);
router.use(attachmentLimiter);
router.param('id', testRoleForAttachmentParam);
router.param('id', demoAttachmentParam);
router.get('/:id', downloadAttachment);

export default router;
