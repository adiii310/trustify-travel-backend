// Field definitions and options shared by every model, so the collections stay
// consistent with each other.

/** timestamps + no __v on every schema. */
const baseOptions = { timestamps: true, versionKey: false };

/** Epoch-ms creation stamp. Indexed because every list sorts on it. */
const tsField = { type: Number, default: () => Date.now(), index: true };

/** The published/hidden switch used by customer-facing content. */
const visibilityField = { type: String, enum: ['published', 'hidden'], default: 'published', index: true };

/** Public reads never expose Mongoose's own timestamps. */
const PUBLIC_EXCLUDE = '-createdAt -updatedAt';

export { baseOptions, tsField, visibilityField, PUBLIC_EXCLUDE };
