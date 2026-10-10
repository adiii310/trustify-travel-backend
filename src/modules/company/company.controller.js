import Company from './company.model.js';
import crudController from '../shared/crud.controller.js';
import { PUBLIC_EXCLUDE } from '../shared/schema.helpers.js';
import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';

/** Fields an admin may set on create or update. Everything else is ignored. */
const EDITABLE_FIELDS = [
  'k', 'name', 'score', 'rating', 'dests', 'places', 'since', 'city', 'exp', 'price', 'reviews',
  'tags', 'about', 'breakdown', 'docs', 'policies', 'photos', 'featured', 'featuredRank', 'status',
];

/** GET /api/companies — published only, highest trust score first. */
const listPublished = asyncHandler(async (req, res) => {
  const companies = await Company.find({ status: 'published' })
    .select(PUBLIC_EXCLUDE)
    .sort({ score: -1 })
    .lean();

  ApiResponse.ok(res, companies, 'Companies fetched successfully');
});

export default {
  ...crudController(Company, EDITABLE_FIELDS, { one: 'Company', many: 'Companies' }),
  listPublished,
  EDITABLE_FIELDS,
};
