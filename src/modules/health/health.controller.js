import ApiResponse from '../../utils/ApiResponse.js';

/** GET /api/health — liveness probe. Does not touch the database. */
const check = (req, res) => {
  ApiResponse.ok(res, { ok: true, time: new Date().toISOString() }, 'API is healthy');
};

export default { check };
