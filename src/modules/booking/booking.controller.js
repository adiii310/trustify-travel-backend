import { randomBytes } from 'node:crypto';

import Booking, {
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from './booking.model.js';
import Package from '../package/package.model.js';
import Company from '../company/company.model.js';
import Destination from '../destination/destination.model.js';
import crudController from '../shared/crud.controller.js';
import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import ApiError from '../../utils/ApiError.js';
import pick from '../../utils/pick.js';

/** What an admin may edit directly. Status and payments have their own routes. */
const EDITABLE_FIELDS = [
  'startDate', 'pax', 'msg', 'amount', 'advance',
  'notes', 'update', 'assignee', 'assigneeName', 'name', 'email', 'phone',
];

const MAX_CUSTOMER_RESULTS = 200;

/* ------------------------------------------------------------------ *
 * Booking references
 * ------------------------------------------------------------------ */

// No I, O, 0 or 1 — a reference gets read down a phone line.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const makeRef = () => {
  const bytes = randomBytes(6);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `TT-${out}`;
};

/**
 * A reference no booking already has.
 *
 * The unique index is the real guarantee; this just avoids surfacing a
 * collision as a 409 to a customer who did nothing wrong. Six characters from
 * a 32-letter alphabet is ~10^9 — retries are a formality.
 */
async function uniqueRef() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ref = makeRef();
    if (!(await Booking.exists({ ref }))) return ref;
  }
  throw ApiError.internal('Could not allocate a booking reference. Try again.');
}

/* ------------------------------------------------------------------ *
 * Projections
 * ------------------------------------------------------------------ */

/**
 * The only shape of a booking a customer may see.
 *
 * Built by naming what goes **in** rather than deleting what must stay out: a
 * field added to the model later is invisible to customers until someone
 * deliberately lists it here, which is the safe direction for a document that
 * holds internal notes, an audit trail and who recorded which payment.
 */
function toCustomerJSON(booking) {
  const b = booking.toObject ? booking.toObject() : booking;
  const paid = (b.payments || []).reduce(
    (total, p) => total + (p.kind === 'refund' ? -p.amount : p.amount),
    0,
  );

  return {
    _id: b._id,
    ref: b.ref,
    pkg: b.pkg,
    c: b.c,
    d: b.d,
    snap: b.snap,
    startDate: b.startDate,
    pax: b.pax,
    msg: b.msg,
    status: b.status,
    payStatus: b.payStatus,
    amount: b.amount,
    advance: b.advance,
    paid,
    balance: Math.max(0, (b.amount || 0) - paid),
    /** The admin's customer-facing note. `notes` — the internal one — is absent. */
    update: b.update,
    ts: b.ts,
  };
}

/* ------------------------------------------------------------------ *
 * Customer endpoints
 *
 * Every one of these derives the member from `req.member`, set by
 * `requireCustomer` from the verified token. A `member` in the request body is
 * never read, so there is no id to manipulate.
 * ------------------------------------------------------------------ */

/**
 * POST /api/bookings — request a booking. Requires a customer token.
 *
 * Creates a `pending` request and nothing more: no payment is taken, no
 * availability is held, and the booking is explicitly not confirmed. The admin
 * team takes it from here.
 */
const requestBooking = asyncHandler(async (req, res) => {
  const pax = Number(req.body?.pax);
  const startDate = String(req.body?.startDate || '').trim();
  const msg = String(req.body?.msg || '').trim();
  const packageId = String(req.body?.pkg || '').trim();

  const errors = [];
  if (!packageId) errors.push({ field: 'pkg', message: 'Pick a package.' });
  if (!Number.isFinite(pax) || pax < 1 || pax > 50) {
    errors.push({ field: 'pax', message: 'Enter between 1 and 50 travellers.' });
  }
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    errors.push({ field: 'startDate', message: 'Use the date picker.' });
  }
  if (errors.length) throw ApiError.badRequest(errors[0].message, errors);

  // The price is re-read from the package, never taken from the request: a
  // client-supplied amount is a client-chosen amount.
  const pkg = await Package.findOne({ _id: packageId, status: 'published' }).lean();
  if (!pkg) {
    throw ApiError.badRequest('That package is no longer available.', [
      { field: 'pkg', message: 'Not available.' },
    ]);
  }
  if (pkg.avail === 'soldout') {
    throw ApiError.badRequest(
      'That package is sold out. Send an enquiry and the operator will offer you the next departure.',
      [{ field: 'pkg', message: 'Sold out.' }],
    );
  }

  const [company, destination] = await Promise.all([
    Company.findOne({ k: pkg.c }).select('name').lean(),
    Destination.findOne({ slug: pkg.d }).select('name').lean(),
  ]);

  const member = req.member;
  const phone = String(req.body?.phone || member.phone || '').replace(/\D/g, '');
  if (phone.length < 7) {
    throw ApiError.badRequest('We need a phone number to call you on.', [
      { field: 'phone', message: 'Enter a valid phone number.' },
    ]);
  }

  const booking = await Booking.create({
    ref: await uniqueRef(),
    member: member._id,
    name: String(req.body?.name || member.name).trim(),
    email: member.email,
    phone,
    pkg: pkg._id,
    c: pkg.c,
    d: pkg.d,
    snap: {
      title: pkg.title,
      price: pkg.price,
      nights: pkg.nights,
      days: pkg.days,
      destName: destination?.name || pkg.d,
      companyName: company?.name || pkg.c,
    },
    startDate,
    pax,
    msg,
    amount: pkg.price * pax,
    status: 'pending',
    payStatus: 'unpaid',
    history: [{ action: 'created', to: 'pending', byName: member.name }],
  });

  ApiResponse.created(res, toCustomerJSON(booking), 'Booking request submitted successfully');
});

/** GET /api/bookings — the signed-in customer's own bookings, newest first. */
const listMine = asyncHandler(async (req, res) => {
  const filter = { member: req.member._id };

  if (req.query.status) {
    const status = String(req.query.status);
    if (!BOOKING_STATUSES.includes(status)) {
      throw ApiError.badRequest(`status must be one of ${BOOKING_STATUSES.join(', ')}.`, [
        { field: 'status', message: 'Unknown status.' },
      ]);
    }
    filter.status = status;
  }

  const bookings = await Booking.find(filter)
    .sort({ ts: -1 })
    .limit(MAX_CUSTOMER_RESULTS)
    .lean();

  ApiResponse.ok(res, bookings.map(toCustomerJSON), 'Bookings fetched successfully');
});

/**
 * GET /api/bookings/:id — one of the signed-in customer's own bookings.
 *
 * The member id is part of the query rather than checked afterwards, so
 * another customer's booking is a 404 and not a 403 — which would confirm the
 * booking exists.
 */
const getMine = asyncHandler(async (req, res) => {
  const booking = await Booking.findOne({
    _id: req.params.id,
    member: req.member._id,
  }).lean();

  if (!booking) throw ApiError.notFound('Booking not found.');
  ApiResponse.ok(res, toCustomerJSON(booking), 'Booking fetched successfully');
});

/* ------------------------------------------------------------------ *
 * Admin endpoints
 * ------------------------------------------------------------------ */

/** Append one audit entry, attributed to the acting admin. */
const record = (booking, admin, entry) => {
  booking.history.push({ by: admin?._id, byName: admin?.name || '', ...entry });
};

/**
 * GET /api/admin/bookings — paginated, filterable, searchable.
 *
 * Not `crudController.list`: that one searches a shared field list and knows
 * nothing about payment status, destination, company or a date range.
 */
const list = asyncHandler(async (req, res) => {
  const filter = {};

  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.payStatus) filter.payStatus = String(req.query.payStatus);
  if (req.query.d) filter.d = String(req.query.d).toLowerCase();
  if (req.query.c) filter.c = String(req.query.c).toUpperCase();

  const from = Number(req.query.from);
  const to = Number(req.query.to);
  if (Number.isFinite(from) || Number.isFinite(to)) {
    filter.ts = {};
    if (Number.isFinite(from)) filter.ts.$gte = from;
    if (Number.isFinite(to)) filter.ts.$lte = to;
  }

  if (req.query.q) {
    const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ ref: rx }, { name: rx }, { email: rx }, { phone: rx }];
  }

  const limit = Math.min(Number(req.query.limit) || 50, 1000);
  const page = Math.max(Number(req.query.page) || 1, 1);

  const [items, total] = await Promise.all([
    Booking.find(filter).sort({ ts: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Booking.countDocuments(filter),
  ]);

  ApiResponse.ok(
    res,
    { items, total, page, limit, pages: Math.max(Math.ceil(total / limit), 1) },
    'Bookings fetched successfully',
  );
});

/**
 * GET /api/admin/bookings/stats — the booking dashboard's counters.
 *
 * One `$group` over the whole collection rather than a `countDocuments` per
 * status: seven round trips to answer one question is the N+1 this avoids.
 */
const stats = asyncHandler(async (req, res) => {
  const [byStatus, byPayStatus, money] = await Promise.all([
    Booking.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Booking.aggregate([{ $group: { _id: '$payStatus', n: { $sum: 1 } } }]),
    Booking.aggregate([{ $group: { _id: null, quoted: { $sum: '$amount' } } }]),
  ]);

  // Seed every known status so the dashboard never has to guard a missing key.
  const status = Object.fromEntries(BOOKING_STATUSES.map((s) => [s, 0]));
  for (const row of byStatus) if (row._id in status) status[row._id] = row.n;

  const payStatus = Object.fromEntries(PAYMENT_STATUSES.map((s) => [s, 0]));
  for (const row of byPayStatus) if (row._id in payStatus) payStatus[row._id] = row.n;

  ApiResponse.ok(
    res,
    {
      total: Object.values(status).reduce((a, b) => a + b, 0),
      status,
      payStatus,
      quoted: money[0]?.quoted || 0,
    },
    'Stats fetched successfully',
  );
});

/** GET /api/admin/bookings/:id — the complete record, audit trail included. */
const getById = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id).lean();
  if (!booking) throw ApiError.notFound('Booking not found.');

  const paid = (booking.payments || []).reduce(
    (t, p) => t + (p.kind === 'refund' ? -p.amount : p.amount),
    0,
  );
  ApiResponse.ok(
    res,
    { ...booking, paid, balance: Math.max(0, (booking.amount || 0) - paid) },
    'Booking fetched successfully',
  );
});

/**
 * PATCH /api/admin/bookings/:id — edit the permitted fields.
 *
 * `status` and `payStatus` are **not** among them: both have dedicated routes
 * that enforce their own rules, and allowing them here would be the hole those
 * rules exist to close.
 */
const update = asyncHandler(async (req, res) => {
  const body = pick(req.body, EDITABLE_FIELDS);

  const booking = await Booking.findById(req.params.id);
  if (!booking) throw ApiError.notFound('Booking not found.');

  const changed = Object.keys(body).filter(
    (key) => String(booking[key] ?? '') !== String(body[key] ?? ''),
  );
  Object.assign(booking, body);

  // Re-derive: raising the quoted amount can take a paid booking back to
  // partially paid, and that must not need a second admin action.
  booking.syncPayStatus();

  if (changed.length) {
    record(booking, req.admin, { action: 'updated', to: changed.join(', ') });
  }
  await booking.save();

  ApiResponse.ok(res, booking, 'Booking updated successfully');
});

/**
 * PATCH /api/admin/bookings/:id/status — move it through the workflow.
 *
 * Two rules, both enforced here rather than in the UI:
 *
 *   1. the transition must be one `BOOKING_TRANSITIONS` allows;
 *   2. confirming requires money to be settled or explicitly not required.
 *
 * The second is the business rule this whole feature exists to protect: a
 * booking becomes confirmed because an admin verified a payment, never because
 * a request was submitted.
 */
const setStatus = asyncHandler(async (req, res) => {
  const to = String(req.body?.status || '');
  const reason = String(req.body?.reason || '').trim();

  if (!BOOKING_STATUSES.includes(to)) {
    throw ApiError.badRequest(`status must be one of ${BOOKING_STATUSES.join(', ')}.`, [
      { field: 'status', message: 'Unknown status.' },
    ]);
  }

  const booking = await Booking.findById(req.params.id);
  if (!booking) throw ApiError.notFound('Booking not found.');

  const from = booking.status;
  if (from === to) {
    throw ApiError.badRequest(`This booking is already ${to.replace(/_/g, ' ')}.`);
  }

  const allowed = BOOKING_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw ApiError.badRequest(
      allowed.length
        ? `A ${from.replace(/_/g, ' ')} booking can only become: ${allowed.join(', ')}.`
        : `A ${from.replace(/_/g, ' ')} booking cannot change status.`,
      [{ field: 'status', message: 'Not a valid transition.' }],
    );
  }

  if (to === 'confirmed' && !['paid', 'partially_paid', 'not_required'].includes(booking.payStatus)) {
    throw ApiError.badRequest(
      'Record the payment before confirming, or mark the booking as not requiring one.',
      [{ field: 'status', message: 'Payment not recorded.' }],
    );
  }

  if ((to === 'cancelled' || to === 'rejected') && !reason) {
    throw ApiError.badRequest(`Give a reason for ${to === 'rejected' ? 'rejecting' : 'cancelling'} this booking.`, [
      { field: 'reason', message: 'A reason is required.' },
    ]);
  }

  booking.status = to;
  record(booking, req.admin, { action: 'status', from, to, reason });
  await booking.save();

  ApiResponse.ok(res, booking, `Booking marked ${to.replace(/_/g, ' ')}`);
});

/**
 * POST /api/admin/bookings/:id/payments — record money received outside the app.
 *
 * This is bookkeeping, not a transaction: there is no gateway, and a row here
 * is an admin stating that they verified a payment. `payStatus` is recalculated
 * from the resulting total, so it can never disagree with the ledger.
 *
 * The whole change is one document write, which MongoDB applies atomically —
 * no multi-document transaction is needed, and a replica-set session would add
 * a failure mode without removing one.
 */
const addPayment = asyncHandler(async (req, res) => {
  const amount = Number(req.body?.amount);
  const kind = req.body?.kind === 'refund' ? 'refund' : 'payment';
  const method = PAYMENT_METHODS.includes(req.body?.method) ? req.body.method : 'other';
  const at = Number(req.body?.at) || Date.now();
  const reference = String(req.body?.reference || '').trim();
  const note = String(req.body?.note || '').trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    throw ApiError.badRequest('Enter the amount received.', [
      { field: 'amount', message: 'Must be more than zero.' },
    ]);
  }

  const booking = await Booking.findById(req.params.id);
  if (!booking) throw ApiError.notFound('Booking not found.');

  if (kind === 'refund' && amount > booking.paidTotal()) {
    throw ApiError.badRequest('You cannot refund more than has been received.', [
      { field: 'amount', message: `At most ${booking.paidTotal()}.` },
    ]);
  }

  // The same amount, method and reference on the same day is far more likely to
  // be a double submit than two real payments. A blank reference cannot be
  // judged this way, so it is left alone.
  if (reference && booking.payments.some((p) => p.reference === reference && p.amount === amount)) {
    throw ApiError.conflict('A payment with that reference and amount is already recorded.', [
      { field: 'reference', message: 'Already recorded.' },
    ]);
  }

  booking.payments.push({
    kind, amount, method, reference, at, note,
    by: req.admin?._id, byName: req.admin?.name || '',
  });

  const before = booking.payStatus;
  // A refund is a statement about the booking, not just the ledger.
  if (kind === 'refund') booking.payStatus = 'refunded';
  else if (booking.payStatus === 'refunded' || booking.payStatus === 'not_required') {
    booking.payStatus = 'unpaid'; // money is moving again; let the ledger decide
    booking.syncPayStatus();
  } else booking.syncPayStatus();

  record(booking, req.admin, {
    action: kind === 'refund' ? 'refunded' : 'payment',
    from: before,
    to: booking.payStatus,
    reason: `${amount} via ${method}${reference ? ` (${reference})` : ''}`,
  });

  await booking.save();
  ApiResponse.created(res, booking, kind === 'refund' ? 'Refund recorded' : 'Payment recorded');
});

/**
 * PATCH /api/admin/bookings/:id/pay-status — the two an admin may declare.
 *
 * `unpaid`, `partially_paid` and `paid` are derived from the ledger and are
 * rejected here: setting them by hand is how a booking ends up claiming money
 * that was never recorded.
 */
const setPayStatus = asyncHandler(async (req, res) => {
  const to = String(req.body?.payStatus || '');

  if (!['not_required', 'unpaid'].includes(to)) {
    throw ApiError.badRequest(
      'Only "not_required" and "unpaid" can be set directly — the others follow the recorded payments.',
      [{ field: 'payStatus', message: 'Record a payment instead.' }],
    );
  }

  const booking = await Booking.findById(req.params.id);
  if (!booking) throw ApiError.notFound('Booking not found.');

  if (to === 'not_required' && booking.paidTotal() > 0) {
    throw ApiError.badRequest('Payments are already recorded against this booking.');
  }

  const from = booking.payStatus;
  booking.payStatus = to;
  if (to === 'unpaid') booking.syncPayStatus();

  record(booking, req.admin, { action: 'pay-status', from, to: booking.payStatus });
  await booking.save();

  ApiResponse.ok(res, booking, 'Payment status updated');
});

/** POST /api/admin/bookings/:id/notes — append an internal note to the trail. */
const addNote = asyncHandler(async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) {
    throw ApiError.badRequest('Write the note first.', [
      { field: 'text', message: 'Cannot be empty.' },
    ]);
  }

  const booking = await Booking.findById(req.params.id);
  if (!booking) throw ApiError.notFound('Booking not found.');

  const stamp = `[${new Date().toISOString().slice(0, 10)} ${req.admin?.name || 'admin'}] ${text}`;
  booking.notes = booking.notes ? `${booking.notes}\n${stamp}` : stamp;
  record(booking, req.admin, { action: 'note', reason: text.slice(0, 200) });
  await booking.save();

  ApiResponse.created(res, booking, 'Note added');
});

export default {
  // crudController supplies `remove`; create/list/get/update are all specific
  // enough here to be written out.
  ...crudController(Booking, EDITABLE_FIELDS, { one: 'Booking', many: 'Bookings' }),
  requestBooking,
  listMine,
  getMine,
  list,
  stats,
  getById,
  update,
  setStatus,
  addPayment,
  setPayStatus,
  addNote,
  toCustomerJSON,
  EDITABLE_FIELDS,
};
