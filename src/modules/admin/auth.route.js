import { Router } from 'express';
import controller from './auth.controller.js';
import customerAuth from '../member/member.auth.controller.js';
import { requireAdmin, requireCustomer } from '../../middlewares/auth.middleware.js';
import { loginLimiter, formLimiter } from '../../middlewares/rateLimit.middleware.js';

/**
 * Mounted at /api/auth.
 *
 * Two audiences, one module. Admin routes sit at the root for backwards
 * compatibility — `/api/auth/login` has always been the admin login — and
 * customer routes live under `/customer`. They share the rate limiter and the
 * signing secret, but not a guard: see auth.middleware.js.
 */
const router = Router();

// --- admin ---
router.post('/login', loginLimiter, controller.login);
router.get('/me', requireAdmin, controller.me);

// --- customer ---
// Registration is a public write that creates a record, so it shares the form
// budget. Login carries the narrower credential-guessing budget.
router.post('/customer/register', formLimiter, customerAuth.register);
router.post('/customer/login', loginLimiter, customerAuth.login);
router.get('/customer/me', requireCustomer, customerAuth.me);
router.patch('/customer/me', requireCustomer, customerAuth.updateProfile);
router.post('/customer/password', requireCustomer, customerAuth.changePassword);

export default router;
