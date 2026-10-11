import Content, { CONTENT_GROUPS } from './content.model.js';
import crudController from '../shared/crud.controller.js';
import { PUBLIC_EXCLUDE } from '../shared/schema.helpers.js';
import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';

const EDITABLE_FIELDS = ['group', 'icon', 'title', 'body', 'order', 'status'];

/**
 * GET /api/content — every published entry, **grouped by `group`**.
 *
 * Returns an object keyed by group rather than a flat array because the
 * customer site needs four of the five lists on its first paint (the homepage
 * alone uses `badge` and `step`). One request beats five, and a group with no
 * rows is present as an empty array so callers never branch on a missing key.
 *
 * `?group=` narrows it to one list and still returns the same object shape.
 */
const listPublished = asyncHandler(async (req, res) => {
  const filter = { status: 'published' };

  const requested = String(req.query.group || '').trim();
  const groups = CONTENT_GROUPS.includes(requested) ? [requested] : CONTENT_GROUPS;
  if (groups.length === 1) filter.group = groups[0];

  const rows = await Content.find(filter)
    .select(PUBLIC_EXCLUDE)
    .sort({ order: 1, ts: 1 })
    .lean();

  // Seed every requested group so the client never has to guard a missing key.
  const grouped = Object.fromEntries(groups.map((g) => [g, []]));
  for (const row of rows) grouped[row.group]?.push(row);

  ApiResponse.ok(res, grouped, 'Content fetched successfully');
});

export default {
  ...crudController(Content, EDITABLE_FIELDS, { one: 'Content item', many: 'Content' }),
  listPublished,
  EDITABLE_FIELDS,
};
