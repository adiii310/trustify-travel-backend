const Destination = require('./destination.model');
const crudController = require('../shared/crud.controller');
const { PUBLIC_EXCLUDE } = require('../shared/schema.helpers');
const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');

const EDITABLE_FIELDS = [
  'slug', 'name', 'region', 'n', 'rating', 'desc', 'best', 'diff', 'dur', 'budget', 'c1', 'c2',
  'featured', 'featuredRank', 'status',
];

/**
 * GET /api/destinations — published only, most-covered first.
 * Each item carries `id` mirroring `slug`, because the portal links by id.
 */
const listPublished = asyncHandler(async (req, res) => {
  const destinations = await Destination.find({ status: 'published' })
    .select(PUBLIC_EXCLUDE)
    .sort({ n: -1 })
    .lean();

  ApiResponse.ok(
    res,
    destinations.map((d) => ({ ...d, id: d.slug })),
    'Destinations fetched successfully',
  );
});

module.exports = {
  ...crudController(Destination, EDITABLE_FIELDS, { one: 'Destination', many: 'Destinations' }),
  listPublished,
  EDITABLE_FIELDS,
};
