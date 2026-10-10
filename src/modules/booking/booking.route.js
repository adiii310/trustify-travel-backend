import { Router } from 'express';
import controller from './booking.controller.js';
import { requireAdmin, requireCustomer } from '../../middlewares/auth.middleware.js';
import { formLimiter } from '../../middlewares/rateLimit.middleware.js';

/**
 * Mounted at /api/bookings.
 *
 * Unlike every other public router in this API these routes are **not** open:
 * a booking belongs to someone, so `requireCustomer` guards all of them and
 * each handler derives the member from the verified token.
 */
const publicRouter = Router();
publicRouter.use(requireCustomer);
publicRouter.get('/', controller.listMine);
publicRouter.post('/', formLimiter, controller.requestBooking);
publicRouter.get('/:id', controller.getMine);

/** Mounted at /api/admin/bookings */
const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.get('/', controller.list);
// Before /:id, or "stats" is read as a booking id and 404s on a cast error.
adminRouter.get('/stats', controller.stats);
adminRouter.get('/:id', controller.getById);
adminRouter.patch('/:id', controller.update);
adminRouter.patch('/:id/status', controller.setStatus);
adminRouter.patch('/:id/pay-status', controller.setPayStatus);
adminRouter.post('/:id/payments', controller.addPayment);
adminRouter.post('/:id/notes', controller.addNote);
adminRouter.delete('/:id', controller.remove);

export { publicRouter, adminRouter };
