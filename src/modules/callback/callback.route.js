import { Router } from 'express';
import controller from './callback.controller.js';
import { requireAdmin } from '../../middlewares/auth.middleware.js';
import { formLimiter } from '../../middlewares/rateLimit.middleware.js';

/** Mounted at /api/callbacks */
const publicRouter = Router();
publicRouter.post('/', formLimiter, controller.submit);

/** Mounted at /api/admin/callbacks */
const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.get('/', controller.list);
adminRouter.post('/', controller.create);
adminRouter.get('/:id', controller.getById);
adminRouter.patch('/:id', controller.update);
adminRouter.delete('/:id', controller.remove);

export { publicRouter, adminRouter };
