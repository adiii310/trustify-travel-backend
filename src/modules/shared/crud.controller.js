const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');
const pick = require('../../utils/pick');

// Fields the admin search box (?q=) looks through, where the collection has them.
// Only string paths qualify — a regex cannot be cast to a Number, so including
// one (destinations have a numeric `n`) would fail the whole query with a 400.
const SEARCH_FIELDS = ['name', 'company', 'n', 'email', 'phone', 'city'];
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isSearchable = (Model, field) => Model.schema.path(field)?.instance === 'String';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

/**
 * Builds the five admin handlers every collection shares. A module spreads the
 * result into its own controller and adds whatever is specific to it:
 *
 *   module.exports = { ...crudController(Company, EDITABLE_FIELDS, labels), listPublished };
 *
 * `editableFields` is the whitelist for create and update — anything else in the
 * body is dropped, so clients can never set _id, ts or createdAt by hand.
 */
module.exports = function crudController(Model, editableFields, labels = {}) {
  const one = labels.one || Model.modelName;
  const many = labels.many || `${Model.modelName} records`;

  const onlyEditable = (body) => pick(body, editableFields);

  /** GET / — paginated, newest first, with optional status filter and search. */
  const list = asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);

    if (req.query.q) {
      const rx = new RegExp(escapeRegex(req.query.q), 'i');
      const searchable = SEARCH_FIELDS.filter((f) => isSearchable(Model, f));
      if (searchable.length) filter.$or = searchable.map((f) => ({ [f]: rx }));
    }

    const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const page = Math.max(Number(req.query.page) || 1, 1);

    const [items, total] = await Promise.all([
      Model.find(filter).sort({ ts: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Model.countDocuments(filter),
    ]);

    ApiResponse.ok(
      res,
      { items, total, page, limit, pages: Math.max(Math.ceil(total / limit), 1) },
      `${many} fetched successfully`,
    );
  });

  /** GET /:id */
  const getById = asyncHandler(async (req, res) => {
    const doc = await Model.findById(req.params.id).lean();
    if (!doc) throw ApiError.notFound(`${one} not found.`);
    ApiResponse.ok(res, doc, `${one} fetched successfully`);
  });

  /** POST / */
  const create = asyncHandler(async (req, res) => {
    const doc = await Model.create(onlyEditable(req.body));
    ApiResponse.created(res, doc, `${one} created successfully`);
  });

  /** PATCH /:id — partial update, validators run on the changed fields. */
  const update = asyncHandler(async (req, res) => {
    const doc = await Model.findByIdAndUpdate(
      req.params.id,
      { $set: onlyEditable(req.body) },
      { new: true, runValidators: true },
    );
    if (!doc) throw ApiError.notFound(`${one} not found.`);
    ApiResponse.ok(res, doc, `${one} updated successfully`);
  });

  /** DELETE /:id — permanent. */
  const remove = asyncHandler(async (req, res) => {
    const doc = await Model.findByIdAndDelete(req.params.id);
    if (!doc) throw ApiError.notFound(`${one} not found.`);
    ApiResponse.ok(res, { _id: doc._id }, `${one} deleted successfully`);
  });

  return { list, getById, create, update, remove };
};
