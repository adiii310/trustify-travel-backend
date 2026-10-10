import { Schema, model } from 'mongoose';
import { baseOptions, tsField, visibilityField } from '../shared/schema.helpers.js';

// A destination page on the customer portal
const destinationSchema = new Schema({
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  region: { type: String, default: 'India' },
  n: { type: Number, default: 0, min: 0 }, // number of verified companies
  rating: { type: Number, default: 0, min: 0, max: 5 },
  desc: { type: String, default: '' },
  best: String,
  diff: String,
  dur: String,
  budget: String,
  c1: { type: String, default: '#2b4463' }, // card gradient start
  c2: { type: String, default: '#0a1424' }, // card gradient end
  // What there is to see. Rendered verbatim; an empty list hides the panel
  // rather than being filled in from anywhere else.
  highlights: [{ type: String, trim: true, maxlength: 120 }],
  // Optional cover photo, uploaded through POST /api/admin/uploads/image.
  // Empty string means "no photo" — the card falls back to the c1/c2 gradient,
  // which is why nothing in the stack treats a missing image as an error.
  img: { type: String, default: '', trim: true, maxlength: 500 }, // hosted URL
  imgId: { type: String, default: '', trim: true, maxlength: 300 }, // Cloudinary public_id
  featured: { type: Boolean, default: false, index: true }, // homepage "Popular Destinations"
  featuredRank: { type: Number, default: 0, min: 0 }, // ascending; ties fall back to n
  status: visibilityField,
  ts: tsField,
}, baseOptions);

export default model('Destination', destinationSchema);
