import { Router } from 'express';
import controller from './health.controller.js';

/** Mounted at /api/health */
const router = Router();
router.get('/', controller.check);

export default router;
