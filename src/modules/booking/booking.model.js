import { Schema, model } from 'mongoose';
import { baseOptions, tsField } from '../shared/schema.helpers.js';

/**
 * The booking lifecycle. Every transition is admin-driven and manual — nothing
 * in this application confirms a booking on its own.
 */
export const BOOKING_STATUSES = [
  'pending', // request received, awaiting review
  'contacted', // an admin has spoken to the customer
  'awaiting_payment', // the customer knows what to pay
  'confirmed', // explicitly confirmed by an admin
  'completed', // the trip has happened
  'cancelled',
  'rejected',
];

/**
 * Which statuses may follow which.
 *
 * Enforced server-side so a manipulated request body cannot jump a booking
 * straight to `confirmed`. The three terminal states have no exits: reopening
 * a cancelled booking is a new request, not an edit.
 */
export const BOOKING_TRANSITIONS = {
  pending: ['contacted', 'awaiting_payment', 'cancelled', 'rejected'],
  contacted: ['awaiting_payment', 'confirmed', 'cancelled', 'rejected'],
  awaiting_payment: ['confirmed', 'contacted', 'cancelled', 'rejected'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  rejected: [],
};

/**
 * Payment state, kept separate from the booking status because they answer
 * different questions: `status` is where the booking is in the workflow,
 * `payStatus` is what has actually been collected.
 *
 * `unpaid`, `partially_paid` and `paid` are **derived** from the recorded
 * payments — an admin cannot type them. The two an admin does set are
 * `not_required` (no money is owed) and `refunded`.
 */
export const PAYMENT_STATUSES = [
  'not_required',
  'unpaid',
  'partially_paid',
  'paid',
  'refunded',
];

export const PAYMENT_METHODS = [
  'cash',
  'bank_transfer',
  'upi',
  'cheque',
  'card_offline',
  'other',
];

/**
 * One payment or refund an admin verified **outside** this application.
 *
 * There is no gateway and no checkout: a row here is an admin asserting that
 * money moved, which is why `by` records who asserted it. Keeps its own `_id`
 * so a mistaken entry can be pointed at precisely.
 */
const paymentSchema = new Schema({
  kind: { type: String, enum: ['payment', 'refund'], default: 'payment' },
  amount: { type: Number, required: true, min: 0.01 },
  method: { type: String, enum: PAYMENT_METHODS, default: 'other' },
  /** Bank reference, UPI id, cheque number — whatever proves it externally. */
  reference: { type: String, trim: true, default: '', maxlength: 120 },
  /** When the money actually moved, epoch ms. Not when it was typed in. */
  at: { type: Number, required: true },
  note: { type: String, trim: true, default: '', maxlength: 500 },
  by: { type: Schema.Types.ObjectId, ref: 'Admin' },
  byName: { type: String, trim: true, default: '' },
  ts: { type: Number, default: () => Date.now() },
});

/**
 * One entry in the booking's audit trail.
 *
 * `byName` is denormalised on purpose: the trail has to stay readable after an
 * admin account is removed, and a dangling ObjectId reads as nobody.
 */
const historySchema = new Schema({
  at: { type: Number, default: () => Date.now() },
  by: { type: Schema.Types.ObjectId, ref: 'Admin' },
  byName: { type: String, trim: true, default: '' },
  action: { type: String, required: true, trim: true, maxlength: 60 },
  from: { type: String, trim: true, default: '' },
  to: { type: String, trim: true, default: '' },
  reason: { type: String, trim: true, default: '', maxlength: 500 },
}, { _id: false });

/**
 * What the package cost and said **at the moment of booking**.
 *
 * Copied rather than joined so the record stays truthful after the package is
 * re-priced, renamed or withdrawn. A booking is a historical fact; the package
 * is a current offer, and they drift.
 */
const snapshotSchema = new Schema({
  title: { type: String, default: '' },
  price: { type: Number, default: 0 }, // per person, at booking time
  nights: { type: Number, default: 0 },
  days: { type: Number, default: 0 },
  destName: { type: String, default: '' },
  companyName: { type: String, default: '' },
}, { _id: false });

const bookingSchema = new Schema({
  /** Human-quotable, unique. What the customer reads out on the phone. */
  ref: { type: String, required: true, unique: true, uppercase: true, trim: true },

  // ---- who ----
  member: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
  // Contact details as given on the request. Snapshotted for the same reason
  // as the package: the member may edit their profile afterwards, and the
  // admin needs the number they were actually given.
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, required: true, trim: true, maxlength: 20 },

  // ---- what ----
  pkg: { type: Schema.Types.ObjectId, ref: 'Package', required: true, index: true },
  c: { type: String, required: true, uppercase: true, trim: true, index: true }, // company code
  d: { type: String, required: true, lowercase: true, trim: true, index: true }, // destination slug
  snap: { type: snapshotSchema, default: () => ({}) },

  // ---- the request ----
  startDate: { type: String, trim: true, default: '' }, // YYYY-MM-DD
  pax: { type: Number, required: true, min: 1, max: 50 },
  /** The customer's own special requirements. Visible to both sides. */
  msg: { type: String, trim: true, default: '', maxlength: 2000 },

  // ---- lifecycle ----
  status: { type: String, enum: BOOKING_STATUSES, default: 'pending', index: true },
  payStatus: { type: String, enum: PAYMENT_STATUSES, default: 'unpaid', index: true },

  /** Total quoted, INR. Seeded from the snapshot and adjustable by an admin. */
  amount: { type: Number, default: 0, min: 0 },
  /** Advance the customer was asked for, if any. */
  advance: { type: Number, default: 0, min: 0 },
  payments: [paymentSchema],

  // ---- admin ----
  /** Internal. **Never leaves through a customer endpoint.** */
  notes: { type: String, trim: true, default: '', maxlength: 4000 },
  /** Customer-facing update, written by an admin and shown in My Bookings. */
  update: { type: String, trim: true, default: '', maxlength: 1000 },
  assignee: { type: Schema.Types.ObjectId, ref: 'Admin' },
  assigneeName: { type: String, trim: true, default: '' },
  history: [historySchema],

  ts: tsField,
}, baseOptions);

/** "My bookings, newest first" — the customer list's only query. */
bookingSchema.index({ member: 1, ts: -1 });
/** The admin queue, filtered by status. */
bookingSchema.index({ status: 1, ts: -1 });

/** Money actually received: payments less refunds. */
bookingSchema.methods.paidTotal = function paidTotal() {
  return (this.payments || []).reduce(
    (total, p) => total + (p.kind === 'refund' ? -p.amount : p.amount),
    0,
  );
};

/** What is still owed. Never negative — an overpayment is not a debt. */
bookingSchema.methods.balance = function balance() {
  return Math.max(0, (this.amount || 0) - this.paidTotal());
};

/**
 * Recompute `payStatus` from the recorded payments.
 *
 * `not_required` and `refunded` are admin declarations about the booking as a
 * whole, so they survive; everything else follows the money.
 */
bookingSchema.methods.syncPayStatus = function syncPayStatus() {
  if (this.payStatus === 'not_required' || this.payStatus === 'refunded') return this.payStatus;

  const paid = this.paidTotal();
  this.payStatus = paid <= 0 ? 'unpaid' : paid >= (this.amount || 0) ? 'paid' : 'partially_paid';
  return this.payStatus;
};

export default model('Booking', bookingSchema);
