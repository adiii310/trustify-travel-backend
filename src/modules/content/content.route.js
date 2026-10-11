import { Router } from 'express';
import controller from './content.controller.js';
import { requireAdmin } from '../../middlewares/auth.middleware.js';

/** Mounted at /api/content. Read-only — this is editorial copy, never user input. */
const publicRouter = Router();
publicRouter.get('/', controller.listPublished);

/** Mounted at /api/admin/content */
const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.get('/', controller.list);
adminRouter.post('/', controller.create);
adminRouter.get('/:id', controller.getById);
adminRouter.patch('/:id', controller.update);
adminRouter.delete('/:id', controller.remove);

export { publicRouter, adminRouter };
