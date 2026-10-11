import { Router } from 'express';
import controller from './company.controller.js';
import { requireAdmin } from '../../middlewares/auth.middleware.js';

/** Mounted at /api/companies */
const publicRouter = Router();
publicRouter.get('/', controller.listPublished);

/** Mounted at /api/admin/companies */
const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.get('/', controller.list);
adminRouter.post('/', controller.create);
adminRouter.get('/:id', controller.getById);
adminRouter.patch('/:id', controller.update);
adminRouter.delete('/:id', controller.remove);

export { publicRouter, adminRouter };
