import { Router } from 'express';
import controller from './member.controller.js';
import { requireAdmin } from '../../middlewares/auth.middleware.js';
import { formLimiter } from '../../middlewares/rateLimit.middleware.js';

/** Mounted at /api/members */
const publicRouter = Router();
publicRouter.post('/', formLimiter, controller.signIn);

/** Mounted at /api/admin/members */
const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.get('/', controller.list);
adminRouter.post('/', controller.create);
adminRouter.get('/:id', controller.getById);
adminRouter.patch('/:id', controller.update);
adminRouter.delete('/:id', controller.remove);

export { publicRouter, adminRouter };
