const Review = require('./review.model');
const Company = require('../company/company.model');
const crudController = require('../shared/crud.controller');
const { PUBLIC_EXCLUDE } = require('../shared/schema.helpers');
const env = require('../../config/env');
const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');
const pick = require('../../utils/pick');

const EDITABLE_FIELDS = ['c', 'n', 'r', 'trip', 't', 'd', 'status'];
/** What a traveller may send. `status` is deliberately absent. */
const SUBMIT_FIELDS = ['c', 'n', 'r', 'trip', 't', 'd'];

const MAX_PUBLIC_RESULTS = 500;

/** GET /api/reviews?c=H — approved reviews, newest first. */
const listApproved = asyncHandler(async (req, res) => {
  const filter = { status: 'approved' };
  if (req.query.c) filter.c = String(req.query.c).toUpperCase();

  const reviews = await Review.find(filter)
    .select(PUBLIC_EXCLUDE)
    .sort({ ts: -1 })
    .limit(MAX_PUBLIC_RESULTS)
    .lean();

  ApiResponse.ok(res, reviews, 'Reviews fetched successfully');
});

/**
 * POST /api/reviews — the company code is checked before the review is stored.
 * Lands in `pending` unless the server runs with REVIEW_AUTO_APPROVE=true.
 */
const submit = asyncHandler(async (req, res) => {
  const data = pick(req.body, SUBMIT_FIELDS);

  const code = String(data.c || '').toUpperCase();
  if (!(await Company.exists({ k: code }))) throw ApiError.badRequest('Pick a company to review.');

  if (env.REVIEW_AUTO_APPROVE) data.status = 'approved';

  const review = await Review.create(data);
  ApiResponse.created(
    res,
    { _id: review._id, status: review.status },
    review.status === 'approved' ? 'Review published successfully' : 'Review submitted for moderation',
  );
});

module.exports = {
  ...crudController(Review, EDITABLE_FIELDS, { one: 'Review', many: 'Reviews' }),
  listApproved,
  submit,
  EDITABLE_FIELDS,
};
