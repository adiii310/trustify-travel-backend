import { Schema, model } from 'mongoose';
import { baseOptions, tsField } from '../shared/schema.helpers.js';

// A traveller review of a company. Moderated unless REVIEW_AUTO_APPROVE is on.
const reviewSchema = new Schema({
  c: { type: String, required: true, uppercase: true, index: true }, // company short code
  n: { type: String, required: true, trim: true, maxlength: 80 }, // reviewer name
  r: { type: Number, required: true, min: 1, max: 5 }, // rating
  trip: { type: String, trim: true, maxlength: 120, default: '' },
  t: { type: String, required: true, trim: true, maxlength: 2000 }, // review text
  d: { type: String, default: '' }, // display date, e.g. "Sep 2024"
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  ts: tsField,
}, baseOptions);

export default model('Review', reviewSchema);
