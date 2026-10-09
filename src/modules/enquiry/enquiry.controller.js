const Enquiry = require('./enquiry.model');
const crudController = require('../shared/crud.controller');
const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const pick = require('../../utils/pick');

const EDITABLE_FIELDS = ['name', 'phone', 'date', 'pax', 'msg', 'company', 'ck', 'pkg', 'status', 'notes'];
/** `status` and `notes` stay internal, so the form cannot set them. */
const SUBMIT_FIELDS = ['name', 'phone', 'date', 'pax', 'msg', 'company', 'ck', 'pkg'];

/** POST /api/enquiries — a new lead, always starting at status "new". */
const submit = asyncHandler(async (req, res) => {
  const enquiry = await Enquiry.create(pick(req.body, SUBMIT_FIELDS));
  ApiResponse.created(res, { _id: enquiry._id, status: enquiry.status }, 'Enquiry submitted successfully');
});

module.exports = {
  ...crudController(Enquiry, EDITABLE_FIELDS, { one: 'Enquiry', many: 'Enquiries' }),
  submit,
  EDITABLE_FIELDS,
};
