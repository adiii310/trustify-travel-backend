import { Router } from 'express';
import controller from './upload.controller.js';
import { requireAdmin } from '../../middlewares/auth.middleware.js';

/**
 * There is no public router here on purpose — travellers never upload anything,
 * so an unauthenticated image sink would be storage anyone could fill.
 */

/** Mounted at /api/admin/uploads */
const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.post('/image', controller.imageUpload, controller.uploadImage);
adminRouter.post('/document', controller.documentUpload, controller.uploadDocument);
adminRouter.post('/destroy', controller.destroyImage);

export { adminRouter };
