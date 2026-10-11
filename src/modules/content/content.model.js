import { Schema, model } from 'mongoose';
import { baseOptions, tsField, visibilityField } from '../shared/schema.helpers.js';

/**
 * The five editable lists the customer site renders as site-wide content.
 *
 * One collection rather than five near-identical ones: every entry is an
 * ordered `{ icon, title, body }`, the admin panel gets one view with a group
 * filter instead of five, and adding a sixth list later is a new enum value
 * rather than a new module.
 */
export const CONTENT_GROUPS = [
  'badge', // homepage trust strip — icon + title
  'step', // the 8 verification steps — icon + title + body
  'resource', // /resources FAQ — title is the question, body the answer
  'parameter', // the 9 trust parameters named on /about — title only
  'interest', // trip-planner interest chips — title only
];

const contentSchema = new Schema({
  group: { type: String, required: true, enum: CONTENT_GROUPS, index: true },
  icon: { type: String, trim: true, default: '', maxlength: 16 }, // emoji
  title: { type: String, required: true, trim: true, maxlength: 200 },
  body: { type: String, trim: true, default: '', maxlength: 2000 },
  order: { type: Number, default: 0, min: 0 }, // ascending; ties fall back to ts
  status: visibilityField,
  ts: tsField,
}, baseOptions);

// Every public read is "this group, in display order".
contentSchema.index({ group: 1, order: 1 });

export default model('Content', contentSchema);
