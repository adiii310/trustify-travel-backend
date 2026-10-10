import Member from './member.model.js';
import crudController from '../shared/crud.controller.js';
import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import ApiError from '../../utils/ApiError.js';
import pick from '../../utils/pick.js';

const EDITABLE_FIELDS = ['name', 'email'];

/**
 * POST /api/members — traveller sign-in. Idempotent upsert keyed on email:
 * creates the member, or updates the name of one who already exists.
 * This is identity capture only — it issues no token and grants no access.
 */
const signIn = asyncHandler(async (req, res) => {
  const { name, email } = pick(req.body, EDITABLE_FIELDS);
  if (!name || !email) throw ApiError.badRequest('Name and email are required.');

  const member = await Member.findOneAndUpdate(
    { email: String(email).toLowerCase().trim() },
    { $set: { name }, $setOnInsert: { ts: Date.now() } },
    { upsert: true, new: true, runValidators: true },
  );

  ApiResponse.created(
    res,
    { _id: member._id, name: member.name, email: member.email },
    'Signed in successfully',
  );
});

export default {
  ...crudController(Member, EDITABLE_FIELDS, { one: 'Member', many: 'Members' }),
  signIn,
  EDITABLE_FIELDS,
};
