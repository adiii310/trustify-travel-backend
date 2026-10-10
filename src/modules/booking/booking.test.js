/**
 * Customer authentication and the manual booking lifecycle, end to end.
 *
 * Run with `npm test` against a server started with `npm run dev`. Node's
 * built-in runner, `fetch`, no dependencies — see package.test.js for why.
 *
 * Every account and booking these tests create is removed in `after`, and
 * nothing else is touched, so they are safe against a database with real
 * content in it.
 */
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import env from '../../config/env.js';

const BASE = process.env.TEST_API_URL || `http://localhost:${env.PORT}/api`;
const PASSWORD = 'TrekTrek123';

let adminToken = '';
const createdMembers = [];
const createdBookings = [];

async function call(method, path, { body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** A unique-per-run identity, so repeated runs never collide. */
let seq = 0;
const identity = () => {
  const n = `${Date.now()}${(seq += 1)}`.slice(-11);
  return {
    name: 'Test Traveller',
    email: `t${n}@example.com`,
    username: `t${n}`,
    phone: `9${n.slice(-9)}`,
    password: PASSWORD,
  };
};

/** Register a customer and keep the id for cleanup. */
async function newCustomer(overrides = {}) {
  const who = { ...identity(), ...overrides };
  const { status, body } = await call('POST', '/auth/customer/register', { body: who });
  if (body?.data?.member?._id) createdMembers.push(body.data.member._id);
  return { who, status, body, token: body?.data?.token };
}

let setup;
const ready = () => (setup ??= (async () => {
  let reachable = true;
  try {
    reachable = (await fetch(`${BASE}/health`)).ok;
  } catch {
    reachable = false;
  }
  assert.ok(reachable, `No API at ${BASE}. Start one with \`npm run dev\`.`);

  const login = await call('POST', '/auth/login', {
    body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  });
  assert.equal(login.status, 200, 'admin login failed — check ADMIN_* in .env');
  adminToken = login.body.data.token;
})());

const createdPackages = [];

/**
 * A package these tests own, created once and torn down at the end.
 *
 * Deliberately not "the first published package": `package.test.js` runs in a
 * parallel process and creates and deletes its own fixtures, so a shared
 * package can vanish between being read and being booked. Owning one makes the
 * price deterministic too, which several assertions below rely on.
 */
let ownPackage;
const somePackage = () => (ownPackage ??= (async () => {
  const [company] = (await call('GET', '/companies')).body.data;
  const [destination] = (await call('GET', '/destinations')).body.data;
  assert.ok(company && destination, 'these tests need a published company and destination');

  const { status, body } = await call('POST', '/admin/packages', {
    token: adminToken,
    body: {
      c: company.k,
      d: destination.slug,
      title: `Booking test package ${Date.now()}`,
      price: 5000,
      nights: 3,
      days: 4,
      avail: 'open',
      status: 'published',
    },
  });
  assert.equal(status, 201, `could not create the test package: ${body.message}`);
  createdPackages.push(body.data._id);
  return body.data;
})());

async function newBooking(token, overrides = {}) {
  const pkg = await somePackage();
  const { status, body } = await call('POST', '/bookings', {
    token,
    body: { pkg: pkg._id, pax: 2, startDate: '2027-01-15', ...overrides },
  });
  if (body?.data?._id) createdBookings.push(body.data._id);
  return { pkg, status, body };
}

after(async () => {
  if (!adminToken) return;
  for (const id of createdBookings) {
    await call('DELETE', `/admin/bookings/${id}`, { token: adminToken });
  }
  for (const id of createdMembers) {
    await call('DELETE', `/admin/members/${id}`, { token: adminToken });
  }
  for (const id of createdPackages) {
    await call('DELETE', `/admin/packages/${id}`, { token: adminToken });
  }
});

/* ------------------------------------------------------------------ */

describe('customer registration', () => {
  test('creates an account and issues a token, without leaking the hash', async () => {
    await ready();
    const { status, body, who } = await newCustomer();

    assert.equal(status, 201);
    assert.ok(body.data.token, 'a token should be issued on registration');
    assert.equal(body.data.member.email, who.email);
    assert.ok(
      !JSON.stringify(body.data).includes('passwordHash'),
      'the password hash must never appear in a response',
    );
  });

  test('rejects a short password and an invalid email, naming both fields', async () => {
    await ready();
    const { status, body } = await call('POST', '/auth/customer/register', {
      body: { name: 'X', email: 'not-an-email', phone: '12', password: 'short' },
    });

    assert.equal(status, 400);
    const fields = body.errors.map((e) => e.field);
    for (const field of ['email', 'phone', 'password']) {
      assert.ok(fields.includes(field), `${field} should be reported`);
    }
  });

  test('a duplicate email, username or phone is a 409', async () => {
    await ready();
    const { who } = await newCustomer();

    for (const [field, overrides] of [
      ['email', { email: who.email }],
      ['username', { username: who.username }],
      ['phone', { phone: who.phone }],
    ]) {
      const fresh = { ...identity(), ...overrides };
      const { status, body } = await call('POST', '/auth/customer/register', { body: fresh });
      assert.equal(status, 409, `duplicate ${field} should conflict`);
      assert.equal(body.errors[0].field, field);
    }
  });

  test('upgrades a passwordless member captured by POST /members', async () => {
    await ready();
    const who = identity();

    // The legacy identity-capture endpoint, which still behaves as it always has.
    const captured = await call('POST', '/members', {
      body: { name: who.name, email: who.email },
    });
    assert.equal(captured.status, 201);
    assert.ok(!captured.body.data.token, 'identity capture must not issue a token');
    createdMembers.push(captured.body.data._id);

    const upgraded = await call('POST', '/auth/customer/register', { body: who });
    assert.equal(upgraded.status, 201, 'registering an already-captured email should work');
    assert.equal(
      upgraded.body.data.member._id,
      captured.body.data._id,
      'registration should upgrade the existing record, not create a second one',
    );
  });
});

describe('customer login', () => {
  test('works with email, username or phone', async () => {
    await ready();
    const { who } = await newCustomer();

    for (const identifier of [who.email, who.username, who.phone]) {
      const { status, body } = await call('POST', '/auth/customer/login', {
        body: { identifier, password: PASSWORD },
      });
      assert.equal(status, 200, `login by ${identifier} failed`);
      assert.equal(body.data.member.email, who.email, 'resolved to the wrong account');
    }
  });

  test('a wrong password and an unknown account are indistinguishable', async () => {
    await ready();
    const { who } = await newCustomer();

    const wrong = await call('POST', '/auth/customer/login', {
      body: { identifier: who.email, password: 'definitely-not-it' },
    });
    const unknown = await call('POST', '/auth/customer/login', {
      body: { identifier: 'nobody@nowhere.invalid', password: 'definitely-not-it' },
    });

    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.message, unknown.body.message);
  });

  test('profile and password changes are guarded and effective', async () => {
    await ready();
    const { who, token } = await newCustomer();

    const profile = await call('PATCH', '/auth/customer/me', {
      token, body: { name: 'Renamed Traveller' },
    });
    assert.equal(profile.status, 200);
    assert.equal(profile.body.data.member.name, 'Renamed Traveller');

    const wrongCurrent = await call('POST', '/auth/customer/password', {
      token, body: { currentPassword: 'nope', newPassword: 'BrandNewPass1' },
    });
    assert.equal(wrongCurrent.status, 401, 'the current password must be proved');

    const changed = await call('POST', '/auth/customer/password', {
      token, body: { currentPassword: PASSWORD, newPassword: 'BrandNewPass1' },
    });
    assert.equal(changed.status, 200);

    const relogin = await call('POST', '/auth/customer/login', {
      body: { identifier: who.email, password: 'BrandNewPass1' },
    });
    assert.equal(relogin.status, 200);
  });
});

describe('token separation', () => {
  test('a customer token cannot reach an admin route, and vice versa', async () => {
    await ready();
    const { token } = await newCustomer();

    assert.equal((await call('GET', '/admin/bookings', { token })).status, 403);
    assert.equal((await call('GET', '/admin/members', { token })).status, 403);
    assert.equal((await call('GET', '/bookings', { token: adminToken })).status, 401);
    assert.equal((await call('GET', '/bookings')).status, 401);
    assert.equal((await call('POST', '/bookings', { body: { pax: 1 } })).status, 401);
  });
});

describe('booking requests', () => {
  test('creates a pending booking with a unique reference and a price snapshot', async () => {
    await ready();
    const { token } = await newCustomer();
    const { pkg, status, body } = await newBooking(token);

    assert.equal(status, 201);
    assert.match(body.data.ref, /^TT-[A-Z2-9]{6}$/, 'reference should be quotable');
    assert.equal(body.data.status, 'pending', 'a request must never arrive confirmed');
    assert.equal(body.data.payStatus, 'unpaid');
    assert.equal(body.data.amount, pkg.price * 2, 'price comes from the package, times travellers');
    assert.equal(body.data.snap.title, pkg.title, 'the package title is snapshotted');
    assert.equal(body.data.snap.price, pkg.price);
  });

  test('the server prices the booking, ignoring anything the client sends', async () => {
    await ready();
    const { token } = await newCustomer();
    const { pkg, status, body } = await newBooking(token, {
      amount: 1, price: 1, status: 'confirmed',
    });

    assert.equal(status, 201, `booking request failed: ${body.message}`);
    assert.equal(body.data.amount, pkg.price * 2, 'a client-supplied amount must be ignored');
    assert.equal(body.data.status, 'pending', 'a client-supplied status must be ignored');
  });

  test('an unknown or unpublished package is rejected', async () => {
    await ready();
    const { token } = await newCustomer();
    const { status } = await call('POST', '/bookings', {
      token, body: { pkg: '000000000000000000000000', pax: 2 },
    });
    assert.equal(status, 400);
  });

  test('traveller count is validated', async () => {
    await ready();
    const { token } = await newCustomer();
    const pkg = await somePackage();

    for (const pax of [0, 51, 'two']) {
      const { status } = await call('POST', '/bookings', { token, body: { pkg: pkg._id, pax } });
      assert.equal(status, 400, `pax=${pax} should be rejected`);
    }
  });

  test('a customer sees only their own bookings', async () => {
    await ready();
    const mine = await newCustomer();
    const theirs = await newCustomer();

    const { body } = await newBooking(mine.token);
    const id = body.data._id;

    assert.equal(
      (await call('GET', `/bookings/${id}`, { token: theirs.token })).status,
      404,
      'another customer must not be able to read it',
    );
    assert.equal((await call('GET', '/bookings', { token: theirs.token })).body.data.length, 0);
    assert.equal((await call('GET', '/bookings', { token: mine.token })).body.data.length, 1);
  });
});

describe('booking lifecycle', () => {
  /** A booking plus the tokens needed to drive it. */
  async function scenario() {
    const { token } = await newCustomer();
    const { body } = await newBooking(token);
    return { token, booking: body.data, id: body.data._id };
  }

  test('illegal transitions are refused', async () => {
    await ready();
    const { id } = await scenario();

    for (const status of ['completed', 'pending']) {
      const { status: code } = await call('PATCH', `/admin/bookings/${id}/status`, {
        token: adminToken, body: { status },
      });
      assert.equal(code, 400, `pending → ${status} should be refused`);
    }
  });

  test('a booking cannot be confirmed until payment is recorded or waived', async () => {
    await ready();
    const { id } = await scenario();

    await call('PATCH', `/admin/bookings/${id}/status`, {
      token: adminToken, body: { status: 'contacted' },
    });

    const early = await call('PATCH', `/admin/bookings/${id}/status`, {
      token: adminToken, body: { status: 'confirmed' },
    });
    assert.equal(early.status, 400, 'confirming an unpaid booking must be refused');

    await call('POST', `/admin/bookings/${id}/payments`, {
      token: adminToken, body: { amount: 500, method: 'upi', reference: 'UPI-TEST-1' },
    });

    const now = await call('PATCH', `/admin/bookings/${id}/status`, {
      token: adminToken, body: { status: 'confirmed' },
    });
    assert.equal(now.status, 200);
    assert.equal(now.body.data.status, 'confirmed');
  });

  test('cancelling and rejecting require a reason', async () => {
    await ready();
    const { id } = await scenario();

    const noReason = await call('PATCH', `/admin/bookings/${id}/status`, {
      token: adminToken, body: { status: 'rejected' },
    });
    assert.equal(noReason.status, 400);

    const withReason = await call('PATCH', `/admin/bookings/${id}/status`, {
      token: adminToken, body: { status: 'rejected', reason: 'Dates unavailable' },
    });
    assert.equal(withReason.status, 200);
    assert.ok(
      withReason.body.data.history.some((h) => h.reason === 'Dates unavailable'),
      'the reason should be in the audit trail',
    );
  });

  test('the customer sees status changes but never the internal notes', async () => {
    await ready();
    const { token, id } = await scenario();

    await call('PATCH', `/admin/bookings/${id}/status`, {
      token: adminToken, body: { status: 'contacted' },
    });
    await call('POST', `/admin/bookings/${id}/notes`, {
      token: adminToken, body: { text: 'SECRET-INTERNAL-MARKER' },
    });
    await call('PATCH', `/admin/bookings/${id}`, {
      token: adminToken, body: { update: 'We have tried calling you.' },
    });

    const seen = (await call('GET', `/bookings/${id}`, { token })).body.data;
    assert.equal(seen.status, 'contacted', 'the admin status change should be visible');
    assert.equal(seen.update, 'We have tried calling you.');
    assert.ok(
      !JSON.stringify(seen).includes('SECRET-INTERNAL-MARKER'),
      'internal notes must never reach a customer',
    );
    for (const hidden of ['notes', 'history', 'assignee', 'payments']) {
      assert.ok(!(hidden in seen), `"${hidden}" must not be in the customer projection`);
    }
  });
});

describe('manual payment tracking', () => {
  async function bookingFor(amount) {
    const { token } = await newCustomer();
    const { body } = await newBooking(token);
    await call('PATCH', `/admin/bookings/${body.data._id}`, {
      token: adminToken, body: { amount },
    });
    return body.data._id;
  }

  test('partial then full payment moves the derived status and balance', async () => {
    await ready();
    const id = await bookingFor(10000);

    const part = await call('POST', `/admin/bookings/${id}/payments`, {
      token: adminToken, body: { amount: 4000, method: 'upi', reference: 'P-1' },
    });
    assert.equal(part.status, 201);
    assert.equal(part.body.data.payStatus, 'partially_paid');

    const rest = await call('POST', `/admin/bookings/${id}/payments`, {
      token: adminToken, body: { amount: 6000, method: 'bank_transfer', reference: 'P-2' },
    });
    assert.equal(rest.body.data.payStatus, 'paid');

    const admin = (await call('GET', `/admin/bookings/${id}`, { token: adminToken })).body.data;
    assert.equal(admin.paid, 10000);
    assert.equal(admin.balance, 0);
  });

  test('the derived payment statuses cannot be set by hand', async () => {
    await ready();
    const id = await bookingFor(10000);

    for (const payStatus of ['paid', 'partially_paid', 'refunded']) {
      const { status } = await call('PATCH', `/admin/bookings/${id}/pay-status`, {
        token: adminToken, body: { payStatus },
      });
      assert.equal(status, 400, `${payStatus} must follow the ledger, not an admin's typing`);
    }

    const waived = await call('PATCH', `/admin/bookings/${id}/pay-status`, {
      token: adminToken, body: { payStatus: 'not_required' },
    });
    assert.equal(waived.status, 200);
    assert.equal(waived.body.data.payStatus, 'not_required');
  });

  test('invalid amounts, duplicates and over-refunds are refused', async () => {
    await ready();
    const id = await bookingFor(10000);

    for (const amount of [0, -100, 'free']) {
      const { status } = await call('POST', `/admin/bookings/${id}/payments`, {
        token: adminToken, body: { amount },
      });
      assert.equal(status, 400, `amount=${amount} should be refused`);
    }

    await call('POST', `/admin/bookings/${id}/payments`, {
      token: adminToken, body: { amount: 2500, reference: 'DUP-1' },
    });
    const dupe = await call('POST', `/admin/bookings/${id}/payments`, {
      token: adminToken, body: { amount: 2500, reference: 'DUP-1' },
    });
    assert.equal(dupe.status, 409, 'the same reference and amount is a double submit');

    const over = await call('POST', `/admin/bookings/${id}/payments`, {
      token: adminToken, body: { kind: 'refund', amount: 99999 },
    });
    assert.equal(over.status, 400, 'cannot refund more than was received');
  });

  test('a refund keeps the original payments in the history', async () => {
    await ready();
    const id = await bookingFor(10000);

    await call('POST', `/admin/bookings/${id}/payments`, {
      token: adminToken, body: { amount: 10000, reference: 'FULL-1' },
    });
    const refunded = await call('POST', `/admin/bookings/${id}/payments`, {
      token: adminToken, body: { kind: 'refund', amount: 10000, reference: 'REF-1' },
    });

    assert.equal(refunded.body.data.payStatus, 'refunded');
    assert.equal(refunded.body.data.payments.length, 2, 'the original payment must survive');
    assert.ok(refunded.body.data.payments.some((p) => p.reference === 'FULL-1'));
  });
});

describe('admin booking APIs', () => {
  test('search, filter and pagination work', async () => {
    await ready();
    const { token } = await newCustomer();
    const { body } = await newBooking(token);
    const ref = body.data.ref;

    const byRef = (await call('GET', `/admin/bookings?q=${ref}`, { token: adminToken })).body.data;
    assert.equal(byRef.total, 1);
    assert.equal(byRef.items[0].ref, ref);

    const byStatus = (await call('GET', '/admin/bookings?status=pending&limit=5', { token: adminToken }))
      .body.data;
    assert.ok(byStatus.items.every((b) => b.status === 'pending'));
    assert.equal(byStatus.limit, 5);
    assert.ok(byStatus.items.length <= 5);
  });

  test('dashboard stats are computed from real rows', async () => {
    await ready();
    const before = (await call('GET', '/admin/bookings/stats', { token: adminToken })).body.data;

    const { token } = await newCustomer();
    await newBooking(token);

    const after = (await call('GET', '/admin/bookings/stats', { token: adminToken })).body.data;
    assert.equal(after.total, before.total + 1);
    assert.equal(after.status.pending, before.status.pending + 1);
  });

  test('every admin booking route rejects an unauthenticated call', async () => {
    await ready();
    for (const [method, path] of [
      ['GET', '/admin/bookings'],
      ['GET', '/admin/bookings/stats'],
      ['PATCH', '/admin/bookings/000000000000000000000000/status'],
      ['POST', '/admin/bookings/000000000000000000000000/payments'],
      ['POST', '/admin/bookings/000000000000000000000000/notes'],
    ]) {
      // `fetch` refuses a body on GET, and these are a mix of both verbs.
      const { status } = await call(method, path, method === 'GET' ? {} : { body: {} });
      assert.equal(status, 401, `${method} ${path} should require a token`);
    }
  });
});
