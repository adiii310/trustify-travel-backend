import { Router } from 'express';
import controller from './dashboard.controller.js';
import { requireAdmin } from '../../middlewares/auth.middleware.js';

/** Mounted at /api/admin */
const router = Router();
router.get('/stats', requireAdmin, controller.stats);

export default router;
