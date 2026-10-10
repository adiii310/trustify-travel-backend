import { Router } from 'express';
import controller from './enquiry.controller.js';
import { requireAdmin } from '../../middlewares/auth.middleware.js';
import { formLimiter } from '../../middlewares/rateLimit.middleware.js';

/** Mounted at /api/enquiries */
const publicRouter = Router();
publicRouter.post('/', formLimiter, controller.submit);

/** Mounted at /api/admin/enquiries */
const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.get('/', controller.list);
adminRouter.post('/', controller.create);
adminRouter.get('/:id', controller.getById);
adminRouter.patch('/:id', controller.update);
adminRouter.delete('/:id', controller.remove);

export { publicRouter, adminRouter };
