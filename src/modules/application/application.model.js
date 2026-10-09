const { Schema, model } = require('mongoose');
const { baseOptions, tsField } = require('../shared/schema.helpers');

// A company applying to become verified; moves through 8 verification stages (0-7)
const applicationSchema = new Schema({
  company: { type: String, required: true, trim: true, maxlength: 120 },
  contact: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, trim: true, lowercase: true, match: [/.+@.+\..+/, 'Enter a valid email.'] },
  phone: { type: String, required: true, trim: true, maxlength: 20 },
  city: { type: String, default: '' },
  years: { type: Number, default: 0, min: 0 },
  stage: { type: Number, default: 0, min: 0, max: 7 },
  stageTs: { type: Number, default: () => Date.now() },
  status: { type: String, enum: ['active', 'rejected', 'published'], default: 'active', index: true },
  companyId: { type: Schema.Types.ObjectId, ref: 'Company' }, // set when published
  notes: { type: String, default: '' }, // internal
  ts: tsField,
}, baseOptions);

const Application = model('Application', applicationSchema);

/** The last verification stage — an application must reach this to be published. */
Application.FINAL_STAGE = 7;

module.exports = Application;
