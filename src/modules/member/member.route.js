const { Router } = require('express');
const controller = require('./member.controller');
const { requireAdmin } = require('../../middlewares/auth.middleware');
const { formLimiter } = require('../../middlewares/rateLimit.middleware');

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

module.exports = { publicRouter, adminRouter };
