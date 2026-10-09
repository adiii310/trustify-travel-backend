const Question = require('./question.model');
const crudController = require('../shared/crud.controller');
const { PUBLIC_EXCLUDE } = require('../shared/schema.helpers');
const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const pick = require('../../utils/pick');

const EDITABLE_FIELDS = ['c', 'n', 'q', 'a', 'status'];
/** A traveller may ask, but never answer or hide. */
const SUBMIT_FIELDS = ['c', 'n', 'q'];

const MAX_PUBLIC_RESULTS = 500;

/** GET /api/questions?c=H — everything except hidden, so open and answered both show. */
const listVisible = asyncHandler(async (req, res) => {
  const filter = { status: { $ne: 'hidden' } };
  if (req.query.c) filter.c = String(req.query.c).toUpperCase();

  const questions = await Question.find(filter)
    .select(PUBLIC_EXCLUDE)
    .sort({ ts: -1 })
    .limit(MAX_PUBLIC_RESULTS)
    .lean();

  ApiResponse.ok(res, questions, 'Questions fetched successfully');
});

/** POST /api/questions — visible immediately, with an empty answer. */
const submit = asyncHandler(async (req, res) => {
  const question = await Question.create(pick(req.body, SUBMIT_FIELDS));
  ApiResponse.created(res, { _id: question._id, status: question.status }, 'Question posted successfully');
});

module.exports = {
  ...crudController(Question, EDITABLE_FIELDS, { one: 'Question', many: 'Questions' }),
  listVisible,
  submit,
  EDITABLE_FIELDS,
};
