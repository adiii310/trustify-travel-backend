import Metric from './metric.model.js';
import crudController from '../shared/crud.controller.js';
import { PUBLIC_EXCLUDE } from '../shared/schema.helpers.js';
import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';

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

export default {
  ...crudController(Metric, EDITABLE_FIELDS, { one: 'Metric', many: 'Metrics' }),
  listPublished,
  EDITABLE_FIELDS,
};
