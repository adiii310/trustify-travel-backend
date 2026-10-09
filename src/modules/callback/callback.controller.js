const Callback = require('./callback.model');
const crudController = require('../shared/crud.controller');
const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const pick = require('../../utils/pick');

const EDITABLE_FIELDS = ['name', 'phone', 'slot', 'status', 'notes'];
const SUBMIT_FIELDS = ['name', 'phone', 'slot'];

/** POST /api/callbacks — a request to be called back, starting at status "new". */
const submit = asyncHandler(async (req, res) => {
  const callback = await Callback.create(pick(req.body, SUBMIT_FIELDS));
  ApiResponse.created(res, { _id: callback._id, status: callback.status }, 'Callback requested successfully');
});

module.exports = {
  ...crudController(Callback, EDITABLE_FIELDS, { one: 'Callback', many: 'Callbacks' }),
  submit,
  EDITABLE_FIELDS,
};
