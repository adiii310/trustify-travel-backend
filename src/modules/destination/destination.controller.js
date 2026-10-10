import Destination from './destination.model.js';
import Company from '../company/company.model.js';
import crudController from '../shared/crud.controller.js';
import { PUBLIC_EXCLUDE } from '../shared/schema.helpers.js';
import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import ApiError from '../../utils/ApiError.js';

const EDITABLE_FIELDS = [
  'slug', 'name', 'region', 'n', 'rating', 'desc', 'best', 'diff', 'dur', 'budget', 'c1', 'c2',
  'highlights', 'img', 'imgId', 'featured', 'featuredRank', 'status',
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

/**
 * GET /api/destinations/:slug — one destination plus the published companies
 * that run trips to it.
 *
 * This is the only public read that joins two collections. It exists because
 * the detail page needs both halves to render anything at all, and the join is
 * one-sided: a company lists the destination slugs it covers in `places`, and
 * nothing on the destination points back. A hidden destination 404s here even
 * though companies may still list it.
 */
const getBySlug = asyncHandler(async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase().trim();

  const destination = await Destination.findOne({ slug, status: 'published' })
    .select(PUBLIC_EXCLUDE)
    .lean();
  if (!destination) throw ApiError.notFound('Destination not found.');

  const companies = await Company.find({ status: 'published', places: slug })
    .select(PUBLIC_EXCLUDE)
    .sort({ score: -1 })
    .lean();

  ApiResponse.ok(
    res,
    { ...destination, id: destination.slug, companies },
    'Destination fetched successfully',
  );
});

export default {
  ...crudController(Destination, EDITABLE_FIELDS, { one: 'Destination', many: 'Destinations' }),
  listPublished,
  getBySlug,
  EDITABLE_FIELDS,
};
