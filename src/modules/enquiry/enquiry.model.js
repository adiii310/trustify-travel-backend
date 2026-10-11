import { Schema, model } from 'mongoose';
import { baseOptions, tsField } from '../shared/schema.helpers.js';

// A trip enquiry lead from the customer portal
const enquirySchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  phone: { type: String, required: true, trim: true, maxlength: 20 },
  date: String, // preferred travel date
  pax: { type: Number, min: 0, max: 500 },
  msg: { type: String, maxlength: 2000, default: '' },
  company: String, // company name enquired about
  ck: String, // company short code
  pkg: String, // package name
  status: { type: String, enum: ['new', 'contacted', 'booked', 'closed'], default: 'new', index: true },
  notes: { type: String, default: '' }, // internal
  ts: tsField,
}, baseOptions);

export default model('Enquiry', enquirySchema);
