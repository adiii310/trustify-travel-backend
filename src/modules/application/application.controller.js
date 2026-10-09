const Application = require('./application.model');
const Company = require('../company/company.model');
const crudController = require('../shared/crud.controller');
const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');
const pick = require('../../utils/pick');

const EDITABLE_FIELDS = [
  'company', 'contact', 'email', 'phone', 'city', 'years', 'stage', 'stageTs', 'status', 'notes',
];
/** An applicant supplies only their own details — never a stage or status. */
const SUBMIT_FIELDS = ['company', 'contact', 'email', 'phone', 'city', 'years'];
/** Company details the application itself does not carry, supplied at publish time. */
const PUBLISH_FIELDS = ['k', 'score', 'rating', 'price', 'dests', 'since', 'tags'];

/** POST /api/applications — a company applies for verification, at stage 0. */
const submit = asyncHandler(async (req, res) => {
  const application = await Application.create(pick(req.body, SUBMIT_FIELDS));
  ApiResponse.created(
    res,
    { _id: application._id, status: application.status },
    'Application submitted successfully',
  );
});

/**
 * POST /api/admin/applications/:id/publish
 * Turns a fully verified applicant into a live company and links the two.
 */
const publish = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id);
  if (!application) throw ApiError.notFound('Application not found.');
  if (application.status === 'published') throw ApiError.conflict('This company is already published.');
  if (application.stage < Application.FINAL_STAGE) {
    throw ApiError.badRequest('Finish every verification step before publishing.');
  }

  const company = await Company.create({
    name: application.company,
    city: application.city,
    exp: application.years,
    status: 'published',
    ...pick(req.body, PUBLISH_FIELDS),
  });

  application.status = 'published';
  application.companyId = company._id;
  await application.save();

  ApiResponse.created(res, company, 'Company published successfully');
});

module.exports = {
  ...crudController(Application, EDITABLE_FIELDS, { one: 'Application', many: 'Applications' }),
  submit,
  publish,
  EDITABLE_FIELDS,
};
