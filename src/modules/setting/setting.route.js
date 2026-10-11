import { Router } from 'express';
import controller from './setting.controller.js';
import { requireAdmin } from '../../middlewares/auth.middleware.js';

/** Mounted at /api/settings. One flat `{ key: value }` object, read-only. */
const publicRouter = Router();
publicRouter.get('/', controller.listPublic);

/**
 * Mounted at /api/admin/settings.
 *
 * No POST and no DELETE: the key set is declared in the model, and `list`
 * creates any declared key that is missing. An admin edits values, never the
 * shape — a stray key would simply be ignored by the customer site.
 */
const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.get('/', controller.list);
adminRouter.get('/:id', controller.getById);
adminRouter.patch('/:id', controller.update);

export { publicRouter, adminRouter };
