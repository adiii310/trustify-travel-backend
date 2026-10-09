const { Router } = require('express');
const controller = require('./health.controller');

/** Mounted at /api/health */
const router = Router();
router.get('/', controller.check);

module.exports = router;
