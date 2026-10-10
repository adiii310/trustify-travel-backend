import Package, { AVAILABILITY } from './package.model.js';
import Company from '../company/company.model.js';
import Destination from '../destination/destination.model.js';
import crudController from '../shared/crud.controller.js';
import { PUBLIC_EXCLUDE } from '../shared/schema.helpers.js';
import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import ApiError from '../../utils/ApiError.js';
import pick from '../../utils/pick.js';

const EDITABLE_FIELDS = [
  'c', 'd', 'title', 'desc', 'nights', 'days', 'price',
  'inclusions', 'exclusions', 'itinerary', 'img', 'imgId', 'avail', 'status',
];

/** Public lists are capped like reviews and questions — see api.md §4. */
const MAX_PUBLIC_RESULTS = 200;

/* ------------------------------------------------------------------ *
 * Referential integrity
 *
 * Nothing in this API joins server-side, so a package's `c` and `d` are only
 * meaningful if they resolve. Checking them on write is what makes that true:
 * an unresolvable reference is rejected here rather than becoming a package
 * that no page can ever display.
 * ------------------------------------------------------------------ */

/**
 * Resolve the two references, or throw a 400 naming the offending field.
 *
 * Only the keys actually present are checked, so a `PATCH` that touches
 * neither does not have to re-prove references it is not changing. Both
 * lookups run concurrently — this is on the write path for every package.
 */
async function assertReferences({ c, d }) {
  const errors = [];

  const [company, destination] = await Promise.all([
    c === undefined ? null : Company.exists({ k: String(c).toUpperCase() }),
    d === undefined ? null : Destination.exists({ slug: String(d).toLowerCase() }),
  ]);

  if (c !== undefined && !company) {
    errors.push({ field: 'c', message: `No company has the short code "${c}".` });
  }
  if (d !== undefined && !destination) {
    errors.push({ field: 'd', message: `No destination has the slug "${d}".` });
  }

  if (errors.length) {
    throw ApiError.badRequest(errors.map((e) => e.message).join(' '), errors);
  }
}

/* ------------------------------------------------------------------ *
 * Admin writes
 *
 * These replace the generic create/update rather than wrapping them, because
 * both need the reference check to run *before* the document is written.
 * ------------------------------------------------------------------ */

/** POST /api/admin/packages */
const create = asyncHandler(async (req, res) => {
  const body = pick(req.body, EDITABLE_FIELDS);

  // Named explicitly rather than left to Mongoose: "Path `c` is required" does
  // not tell an admin that they have to pick a company.
  const missing = ['c', 'd'].filter((key) => !body[key]);
  if (missing.length) {
    throw ApiError.badRequest(
      'A package needs both a company and a destination.',
      missing.map((field) => ({
        field,
        message: field === 'c' ? 'Pick a company.' : 'Pick a destination.',
      })),
    );
  }

  await assertReferences(body);

  const doc = await Package.create(body);
  ApiResponse.created(res, doc, 'Package created successfully');
});

/**
 * PATCH /api/admin/packages/:id
 *
 * Two different checks, deliberately:
 *
 *   - a reference being **changed** must resolve, always;
 *   - the result must carry both references if it ends up **published**.
 *
 * That second rule is what lets a legacy package with a broken reference still
 * be edited and repaired — it can be saved while hidden, and only publishing
 * demands that both sides resolve. Validating everything on every write would
 * make the broken rows uneditable, which is the opposite of repairable.
 */
const update = asyncHandler(async (req, res) => {
  const body = pick(req.body, EDITABLE_FIELDS);

  const existing = await Package.findById(req.params.id).lean();
  if (!existing) throw ApiError.notFound('Package not found.');

  await assertReferences(body);

  const next = { ...existing, ...body };
  if (next.status === 'published') {
    const missing = ['c', 'd'].filter((key) => !next[key]);
    if (missing.length) {
      throw ApiError.badRequest(
        'A package cannot be published without both a company and a destination.',
        missing.map((field) => ({
          field,
          message: field === 'c' ? 'Pick a company.' : 'Pick a destination.',
        })),
      );
    }
    // The record may be published with references it was saved with long ago.
    await assertReferences({ c: next.c, d: next.d });
  }

  const doc = await Package.findByIdAndUpdate(
    req.params.id,
    { $set: body },
    { new: true, runValidators: true },
  );

  ApiResponse.ok(res, doc, 'Package updated successfully');
});

/* ------------------------------------------------------------------ *
 * Public reads
 * ------------------------------------------------------------------ */

/** Parse a positive number from the query string; `undefined` if unusable. */
const positive = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/**
 * GET /api/packages — published only, cheapest first.
 *
 * Filters, all optional and all combinable:
 *   ?d=kedarnath     destination slug      ?c=H         company short code
 *   ?minPrice=8000   per person, inclusive ?maxPrice=   per person, inclusive
 *   ?nights=3        exact nights          ?avail=open  open | limited | soldout
 *
 * Cheapest first rather than newest: every surface reading this is answering
 * "what does this cost", so the first row is the one the UI quotes.
 */
const listPublished = asyncHandler(async (req, res) => {
  const filter = { status: 'published' };

  if (req.query.d) filter.d = String(req.query.d).toLowerCase();
  if (req.query.c) filter.c = String(req.query.c).toUpperCase();

  if (req.query.avail) {
    const avail = String(req.query.avail);
    // An unknown value would silently match nothing, which reads as "this
    // destination has no packages" rather than "that filter is not a thing".
    if (!AVAILABILITY.includes(avail)) {
      throw ApiError.badRequest(
        `avail must be one of ${AVAILABILITY.join(', ')}.`,
        [{ field: 'avail', message: 'Unknown availability.' }],
      );
    }
    filter.avail = avail;
  }

  const nights = positive(req.query.nights);
  if (nights !== undefined) filter.nights = nights;

  const min = positive(req.query.minPrice);
  const max = positive(req.query.maxPrice);
  if (min !== undefined || max !== undefined) {
    filter.price = {};
    if (min !== undefined) filter.price.$gte = min;
    if (max !== undefined) filter.price.$lte = max;
  }

  const packages = await Package.find(filter)
    .select(PUBLIC_EXCLUDE)
    .sort({ price: 1 })
    .limit(MAX_PUBLIC_RESULTS)
    .lean();

  ApiResponse.ok(res, packages, 'Packages fetched successfully');
});

/**
 * GET /api/packages/:id — one package, for its detail and booking pages.
 *
 * The only public read keyed on an `_id`: a shared link has to keep working,
 * and a package has no other stable handle.
 */
const getPublishedById = asyncHandler(async (req, res) => {
  const pkg = await Package.findOne({ _id: req.params.id, status: 'published' })
    .select(PUBLIC_EXCLUDE)
    .lean();
  if (!pkg) throw ApiError.notFound('Package not found.');

  ApiResponse.ok(res, pkg, 'Package fetched successfully');
});

export default {
  ...crudController(Package, EDITABLE_FIELDS, { one: 'Package', many: 'Packages' }),
  // Both override the generic handlers: the reference check has to run before
  // the write, not after it.
  create,
  update,
  listPublished,
  getPublishedById,
  assertReferences,
  EDITABLE_FIELDS,
  MAX_PUBLIC_RESULTS,
};
