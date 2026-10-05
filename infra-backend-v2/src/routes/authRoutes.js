import express from 'express';
import { syncUser, demoLdapLogin } from '../controllers/authController.js';

const router = express.Router();

router.post('/sync', syncUser);
router.post('/ldap', demoLdapLogin);

export default router;