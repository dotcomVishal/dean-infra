import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { testRoleForAttachmentParam } from '../middleware/testRole.js';
import { downloadAttachment } from '../controllers/attachmentController.js';

const router = express.Router();

// Every role may hit this route; WHAT they may read is decided per file by the
// visibility matrix inside the controller.
router.use(requireAuth);
router.param('id', testRoleForAttachmentParam);
router.get('/:id', downloadAttachment);

export default router;
