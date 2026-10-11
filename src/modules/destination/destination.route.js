import { Router } from 'express';
import controller from './destination.controller.js';
import { requireAdmin } from '../../middlewares/auth.middleware.js';

/** Mounted at /api/destinations */
const publicRouter = Router();
publicRouter.get('/', controller.listPublished);
// By slug, not by _id: the customer site routes on /destinations/<slug>.
publicRouter.get('/:slug', controller.getBySlug);

/** Mounted at /api/admin/destinations */
const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.get('/', controller.list);
adminRouter.post('/', controller.create);
adminRouter.get('/:id', controller.getById);
adminRouter.patch('/:id', controller.update);
adminRouter.delete('/:id', controller.remove);

export { publicRouter, adminRouter };
