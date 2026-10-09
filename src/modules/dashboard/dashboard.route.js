const { Router } = require('express');
const controller = require('./dashboard.controller');
const { requireAdmin } = require('../../middlewares/auth.middleware');

/** Mounted at /api/admin */
const router = Router();
router.get('/stats', requireAdmin, controller.stats);

module.exports = router;
