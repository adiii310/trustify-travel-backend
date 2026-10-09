const { Router } = require('express');
const controller = require('./destination.controller');
const { requireAdmin } = require('../../middlewares/auth.middleware');

/** Mounted at /api/destinations */
const publicRouter = Router();
publicRouter.get('/', controller.listPublished);

/** Mounted at /api/admin/destinations */
const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.get('/', controller.list);
adminRouter.post('/', controller.create);
adminRouter.get('/:id', controller.getById);
adminRouter.patch('/:id', controller.update);
adminRouter.delete('/:id', controller.remove);

module.exports = { publicRouter, adminRouter };
