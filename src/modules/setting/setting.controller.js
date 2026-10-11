import Setting, { SETTING_DEFAULTS } from './setting.model.js';
import crudController from '../shared/crud.controller.js';
import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';

const EDITABLE_FIELDS = ['key', 'value', 'label'];

/**
 * GET /api/settings — every setting as a flat `{ key: value }` object.
 *
 * Declared defaults fill in any key that has never been saved, so the response
 * always carries the complete set and the customer site needs no fallback of
 * its own. A key stored with an empty value stays empty — that is an admin
 * deliberately clearing it, not an absent setting.
 */
const listPublic = asyncHandler(async (req, res) => {
  const rows = await Setting.find().select('key value').lean();
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  const settings = Object.fromEntries(
    SETTING_DEFAULTS.map(({ key, value }) => [key, stored.get(key) ?? value]),
  );
  // Keys an admin added beyond the declared set still come through.
  for (const [key, value] of stored) settings[key] ??= value;

  ApiResponse.ok(res, settings, 'Settings fetched successfully');
});

/**
 * GET /api/admin/settings — the editable rows, one per declared key.
 *
 * Unlike the public read this returns records, not a map, because the admin
 * panel edits them like any other collection. Declared keys that have never
 * been saved are **created on read**, so the panel always has a row to edit
 * rather than an empty screen with no way to add the right key.
 */
const listForAdmin = asyncHandler(async (req, res, next) => {
  const existing = await Setting.find().select('key').lean();
  const have = new Set(existing.map((r) => r.key));

  const missing = SETTING_DEFAULTS.filter((s) => !have.has(s.key));
  if (missing.length) await Setting.insertMany(missing);

  return crudController(Setting, EDITABLE_FIELDS).list(req, res, next);
});

export default {
  ...crudController(Setting, EDITABLE_FIELDS, { one: 'Setting', many: 'Settings' }),
  list: listForAdmin,
  listPublic,
  EDITABLE_FIELDS,
};
