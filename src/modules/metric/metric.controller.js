const Metric = require('./metric.model');
const crudController = require('../shared/crud.controller');
const { PUBLIC_EXCLUDE } = require('../shared/schema.helpers');
const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');

const EDITABLE_FIELDS = ['icon', 'value', 'label', 'order', 'status'];

/**
 * GET /api/metrics — published only, in display order.
 *
 * Sorted by `order` rather than `ts` (which is what every other public list
 * uses) because these are positional slots in a fixed strip, not a feed.
 */
const listPublished = asyncHandler(async (req, res) => {
  const metrics = await Metric.find({ status: 'published' })
    .select(PUBLIC_EXCLUDE)
    .sort({ order: 1, ts: 1 })
    .lean();

  ApiResponse.ok(res, metrics, 'Metrics fetched successfully');
});

module.exports = {
  ...crudController(Metric, EDITABLE_FIELDS, { one: 'Metric', many: 'Metrics' }),
  listPublished,
  EDITABLE_FIELDS,
};
