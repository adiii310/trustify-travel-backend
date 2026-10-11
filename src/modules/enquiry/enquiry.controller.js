import Enquiry from './enquiry.model.js';
import crudController from '../shared/crud.controller.js';
import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import pick from '../../utils/pick.js';

const EDITABLE_FIELDS = ['name', 'phone', 'date', 'pax', 'msg', 'company', 'ck', 'pkg', 'status', 'notes'];
/** `status` and `notes` stay internal, so the form cannot set them. */
const SUBMIT_FIELDS = ['name', 'phone', 'date', 'pax', 'msg', 'company', 'ck', 'pkg'];

/** POST /api/enquiries — a new lead, always starting at status "new". */
const submit = asyncHandler(async (req, res) => {
  const enquiry = await Enquiry.create(pick(req.body, SUBMIT_FIELDS));
  ApiResponse.created(res, { _id: enquiry._id, status: enquiry.status }, 'Enquiry submitted successfully');
});

export default {
  ...crudController(Enquiry, EDITABLE_FIELDS, { one: 'Enquiry', many: 'Enquiries' }),
  submit,
  EDITABLE_FIELDS,
};
