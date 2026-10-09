const { Router } = require('express');
const controller = require('./review.controller');
const { requireAdmin } = require('../../middlewares/auth.middleware');
const { formLimiter } = require('../../middlewares/rateLimit.middleware');

/** Mounted at /api/reviews */
const publicRouter = Router();
publicRouter.get('/', controller.listApproved);
publicRouter.post('/', formLimiter, controller.submit);

/** Mounted at /api/admin/reviews */
const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.get('/', controller.list);
adminRouter.post('/', controller.create);
adminRouter.get('/:id', controller.getById);
adminRouter.patch('/:id', controller.update);
adminRouter.delete('/:id', controller.remove);

module.exports = { publicRouter, adminRouter };
