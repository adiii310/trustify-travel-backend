const { Router } = require('express');
const controller = require('./auth.controller');
const { requireAdmin } = require('../../middlewares/auth.middleware');
const { loginLimiter } = require('../../middlewares/rateLimit.middleware');

/** Mounted at /api/auth */
const router = Router();
router.post('/login', loginLimiter, controller.login);
router.get('/me', requireAdmin, controller.me);

module.exports = router;
