import { Router } from 'express';
import controller from './package.controller.js';
import { requireAdmin } from '../../middlewares/auth.middleware.js';

/** Mounted at /api/packages. Read-only — travellers never create a package. */
const publicRouter = Router();
publicRouter.get('/', controller.listPublished);
publicRouter.get('/:id', controller.getPublishedById);

/** Mounted at /api/admin/packages */
const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.get('/', controller.list);
adminRouter.post('/', controller.create);
adminRouter.get('/:id', controller.getById);
adminRouter.patch('/:id', controller.update);
adminRouter.delete('/:id', controller.remove);

export { publicRouter, adminRouter };
