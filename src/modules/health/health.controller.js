const ApiResponse = require('../../utils/ApiResponse');

/** GET /api/health — liveness probe. Does not touch the database. */
const check = (req, res) => {
  ApiResponse.ok(res, { ok: true, time: new Date().toISOString() }, 'API is healthy');
};

module.exports = { check };
