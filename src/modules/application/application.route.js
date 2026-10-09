const { Router } = require('express');
const controller = require('./application.controller');
const { requireAdmin } = require('../../middlewares/auth.middleware');
const { formLimiter } = require('../../middlewares/rateLimit.middleware');

/** Mounted at /api/applications */
const publicRouter = Router();
publicRouter.post('/', formLimiter, controller.submit);

/** Mounted at /api/admin/applications */
const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.get('/', controller.list);
adminRouter.post('/', controller.create);
adminRouter.post('/:id/publish', controller.publish); // promote a verified applicant to a company
adminRouter.get('/:id', controller.getById);
adminRouter.patch('/:id', controller.update);
adminRouter.delete('/:id', controller.remove);

module.exports = { publicRouter, adminRouter };
