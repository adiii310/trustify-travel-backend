import Callback from './callback.model.js';
import crudController from '../shared/crud.controller.js';
import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import pick from '../../utils/pick.js';

const EDITABLE_FIELDS = ['name', 'phone', 'slot', 'status', 'notes'];
const SUBMIT_FIELDS = ['name', 'phone', 'slot'];

/** POST /api/callbacks — a request to be called back, starting at status "new". */
const submit = asyncHandler(async (req, res) => {
  const callback = await Callback.create(pick(req.body, SUBMIT_FIELDS));
  ApiResponse.created(res, { _id: callback._id, status: callback.status }, 'Callback requested successfully');
});

export default {
  ...crudController(Callback, EDITABLE_FIELDS, { one: 'Callback', many: 'Callbacks' }),
  submit,
  EDITABLE_FIELDS,
};
