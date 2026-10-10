import { Schema, model } from 'mongoose';
import { baseOptions, tsField } from '../shared/schema.helpers.js';

/**
 * The settings the customer site reads, and the copy shown next to each one in
 * the admin panel.
 *
 * Declared here rather than discovered from the rows so that `GET /api/settings`
 * always answers with the full set: a key nobody has saved yet comes back as its
 * default, which is what lets the frontend render without a fallback of its own.
 */
export const SETTING_DEFAULTS = [
  { key: 'site.name', value: 'Trustify Trips', label: 'Site name' },
  { key: 'site.tagline', value: 'TRAVEL. VERIFIED.', label: 'Tagline, shown under the logo' },
  { key: 'site.whatsapp', value: '', label: 'WhatsApp number, digits only with country code' },
  {
    key: 'site.whatsappMessage',
    value: 'Hi Trustify Trips, I need help choosing a travel company.',
    label: 'Pre-filled WhatsApp message',
  },
];

export const SETTING_KEYS = SETTING_DEFAULTS.map((s) => s.key);

// One editable site-wide value. Always a string: anything list-shaped belongs in
// the `content` collection, which is ordered and individually publishable.
const settingSchema = new Schema({
  key: { type: String, required: true, unique: true, trim: true, maxlength: 60 },
  value: { type: String, default: '', trim: true, maxlength: 500 },
  label: { type: String, default: '', trim: true, maxlength: 140 }, // admin-facing hint
  ts: tsField,
}, baseOptions);

export default model('Setting', settingSchema);
