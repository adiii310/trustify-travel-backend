const Company = require('./company.model');
const crudController = require('../shared/crud.controller');
const { PUBLIC_EXCLUDE } = require('../shared/schema.helpers');
const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');

/** Fields an admin may set on create or update. Everything else is ignored. */
const EDITABLE_FIELDS = [
  'k', 'name', 'score', 'rating', 'dests', 'since', 'city', 'exp', 'price', 'reviews', 'tags', 'status',
];

/** GET /api/companies — published only, highest trust score first. */
const listPublished = asyncHandler(async (req, res) => {
  const companies = await Company.find({ status: 'published' })
    .select(PUBLIC_EXCLUDE)
    .sort({ score: -1 })
    .lean();

  ApiResponse.ok(res, companies, 'Companies fetched successfully');
});

module.exports = {
  ...crudController(Company, EDITABLE_FIELDS, { one: 'Company', many: 'Companies' }),
  listPublished,
  EDITABLE_FIELDS,
};
