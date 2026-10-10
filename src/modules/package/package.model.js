import { Schema, model } from 'mongoose';
import { baseOptions, tsField, visibilityField } from '../shared/schema.helpers.js';

/** One day of a package itinerary. Stored inline — it is never queried alone. */
const itineraryDaySchema = new Schema({
  day: { type: Number, required: true, min: 1, max: 60 },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  detail: { type: String, trim: true, maxlength: 1000, default: '' },
}, { _id: false });

/**
 * Whether a package can be booked right now.
 *
 * Separate from `status`, which is whether it is *listed* at all. A sold-out
 * package is still published — travellers can see it, compare it and enquire —
 * so the two must not be collapsed into one field.
 */
export const AVAILABILITY = ['open', 'limited', 'soldout'];

// A trip a company sells to a destination: the price, what is included, and the
// day-by-day plan. This is what the customer site books from.
//
// `c` and `d` are the whole relational model. They are short codes rather than
// ObjectIds because every customer-facing collection already references a
// company by its `k` code and a destination by its `slug`, and nothing in this
// API joins server-side. The references are validated on write instead — see
// package.controller.js — so an unresolvable one cannot be stored.
const packageSchema = new Schema({
  c: { type: String, required: true, uppercase: true, trim: true, index: true }, // company short code
  d: { type: String, required: true, lowercase: true, trim: true, index: true }, // destination slug
  title: { type: String, required: true, trim: true, maxlength: 140 },
  // One-line pitch for the package card. Empty hides the line rather than
  // falling back to the itinerary or the destination's own description.
  desc: { type: String, trim: true, default: '', maxlength: 400 },
  nights: { type: Number, default: 0, min: 0, max: 60 },
  days: { type: Number, default: 0, min: 0, max: 60 },
  price: { type: Number, required: true, min: 0 }, // per person, INR
  inclusions: [{ type: String, trim: true, maxlength: 200 }],
  exclusions: [{ type: String, trim: true, maxlength: 200 }],
  itinerary: [itineraryDaySchema],
  // The same itinerary as a downloadable PDF, uploaded through
  // POST /api/admin/uploads/document. Independent of `itinerary` above: a
  // package may have the day-by-day list, the document, both or neither, and
  // the customer page shows whichever it was given.
  pdf: { type: String, default: '', trim: true, maxlength: 500 }, // hosted URL
  pdfId: { type: String, default: '', trim: true, maxlength: 300 }, // Cloudinary public_id
  // Cover photo, uploaded through POST /api/admin/uploads/image. Empty means
  // the card falls back to the destination's own cover, then to its gradient.
  img: { type: String, default: '', trim: true, maxlength: 500 },
  imgId: { type: String, default: '', trim: true, maxlength: 300 },
  avail: { type: String, enum: AVAILABILITY, default: 'open', index: true },
  status: visibilityField,
  ts: tsField,
}, baseOptions);

/**
 * The customer destination page is the hot path: every published package for
 * one destination, cheapest first. This index covers the filter and the sort
 * together, so that query never collection-scans and never sorts in memory.
 */
packageSchema.index({ d: 1, status: 1, price: 1 });

/** The company profile's Packages tab. */
packageSchema.index({ c: 1, status: 1, price: 1 });

export default model('Package', packageSchema);
