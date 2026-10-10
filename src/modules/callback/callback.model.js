import { Schema, model } from 'mongoose';
import { baseOptions, tsField } from '../shared/schema.helpers.js';

// A request to be called back
const callbackSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  phone: { type: String, required: true, trim: true, maxlength: 20 },
  slot: { type: String, enum: ['Morning', 'Afternoon', 'Evening', ''], default: '' },
  status: { type: String, enum: ['new', 'called', 'closed'], default: 'new', index: true },
  notes: { type: String, default: '' }, // internal
  ts: tsField,
}, baseOptions);

export default model('Callback', callbackSchema);
