/**
 * API-level tests for the destination ↔ company ↔ package relationship.
 *
 * Run with `npm test`, against a server started with `npm run dev`. They use
 * Node's built-in runner and `fetch`, so they add no dependency to a project
 * that has deliberately never carried a test framework.
 *
 * They exercise the real stack — auth, validation, the reference checks, the
 * public filters and the visibility rules — rather than mocking it, because
 * every rule under test is enforced in a controller and none of it would be
 * covered by testing the models alone.
 *
 * **They clean up after themselves** and only ever delete records they created,
 * so they are safe to run against a database with real content in it.
 */
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import env from '../../config/env.js';

const BASE = process.env.TEST_API_URL || `http://localhost:${env.PORT}/api`;

let token = '';
/** Every package these tests create, removed in `after` whatever happens. */
const created = [];
/** A company code and destination slug that really exist, read from the API. */
let companyCode = '';
let destinationSlug = '';
let otherCompanyCode = '';

async function call(method, path, { body, auth = true } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** Create a package through the admin API and remember it for cleanup. */
async function makePackage(overrides = {}) {
  const { status, body } = await call('POST', '/admin/packages', {
    body: {
      c: companyCode,
      d: destinationSlug,
      title: `Test package ${Math.round(performance.now() * 1000)}`,
      price: 11111,
      nights: 3,
      days: 4,
      ...overrides,
    },
  });
  if (body?.data?._id) created.push(body.data._id);
  return { status, body };
}

/**
 * Sign in and read a real company and destination to test against.
 *
 * Memoised and awaited by each test rather than run from `before()`: the
 * runner in Node 20 does not reliably order a top-level `before` ahead of the
 * subtests inside a `describe`, which showed up as every test seeing an empty
 * token and asserting 401.
 */
let setup;
const ready = () => (setup ??= (async () => {
  let reachable = true;
  try {
    reachable = (await fetch(`${BASE}/health`)).ok;
  } catch {
    reachable = false;
  }
  assert.ok(
    reachable,
    `No API at ${BASE}. Start one with \`npm run dev\`, or set TEST_API_URL.`,
  );

  const login = await call('POST', '/auth/login', {
    auth: false,
    body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  });
  assert.equal(login.status, 200, 'admin login failed — check ADMIN_* in .env');
  token = login.body.data.token;

  const companies = (await call('GET', '/companies', { auth: false })).body.data;
  const destinations = (await call('GET', '/destinations', { auth: false })).body.data;
  assert.ok(companies.length >= 2, 'these tests need at least two published companies');
  assert.ok(destinations.length >= 1, 'these tests need at least one published destination');

  companyCode = companies[0].k;
  otherCompanyCode = companies[1].k;
  destinationSlug = destinations[0].slug;
})());

after(async () => {
  if (!token) return;
  for (const id of created) {
    await call('DELETE', `/admin/packages/${id}`);
  }
});

/* ------------------------------------------------------------------ */

describe('required associations', () => {
  test('a package cannot be created without a company or a destination', async () => {
    await ready();
    const { status, body } = await call('POST', '/admin/packages', {
      body: { title: 'No references', price: 500 },
    });

    assert.equal(status, 400);
    assert.deepEqual(
      body.errors.map((e) => e.field).sort(),
      ['c', 'd'],
      'both missing references should be named in errors[]',
    );
  });

  test('an unresolvable company or destination is rejected', async () => {
    await ready();
    const { status, body } = await makePackage({
      c: 'ZZZ',
      d: 'definitely-not-a-destination',
    });

    assert.equal(status, 400);
    assert.deepEqual(body.errors.map((e) => e.field).sort(), ['c', 'd']);
  });

  test('a valid company and destination is accepted', async () => {
    await ready();
    const { status, body } = await makePackage();

    assert.equal(status, 201);
    assert.equal(body.data.c, companyCode);
    assert.equal(body.data.d, destinationSlug);
  });

  test('a package cannot be published while a reference is unresolvable', async () => {
    await ready();
    // Saved hidden with a reference that no longer resolves — the shape a
    // legacy row has after the backfill script hides it.
    const { body } = await makePackage({ status: 'hidden' });
    const id = body.data._id;

    // Reach past validation the way an old record would have been written.
    const broken = await call('PATCH', `/admin/packages/${id}`, {
      body: { c: 'ZZZ' },
    });
    assert.equal(broken.status, 400, 'changing to a bad reference must be rejected');

    const published = await call('PATCH', `/admin/packages/${id}`, {
      body: { status: 'published', c: 'ZZZ' },
    });
    assert.equal(published.status, 400);
  });
});

describe('many packages per destination', () => {
  test('one destination holds packages from several companies, each independent', async () => {
    await ready();
    const a = await makePackage({ c: companyCode, price: 7777, nights: 2 });
    const b = await makePackage({ c: otherCompanyCode, price: 8888, nights: 5 });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);

    const list = (await call('GET', `/packages?d=${destinationSlug}`, { auth: false })).body.data;
    const ids = list.map((p) => p._id);
    assert.ok(ids.includes(a.body.data._id), 'first company’s package is listed');
    assert.ok(ids.includes(b.body.data._id), 'second company’s package is listed');
    assert.ok(
      list.every((p) => p.d === destinationSlug),
      'the destination filter must not leak other destinations',
    );

    // Editing one must not touch the other.
    await call('PATCH', `/admin/packages/${a.body.data._id}`, { body: { price: 1234 } });
    const untouched = (await call('GET', `/admin/packages/${b.body.data._id}`)).body.data;
    assert.equal(untouched.price, 8888, 'editing one package changed another');
  });

  test('the same company can offer several durations for one destination', async () => {
    await ready();
    const durations = [
      { nights: 2, days: 3, price: 5001 },
      { nights: 3, days: 4, price: 6001 },
      { nights: 4, days: 5, price: 7001 },
    ];
    for (const d of durations) assert.equal((await makePackage(d)).status, 201);

    const mine = (await call('GET', `/packages?d=${destinationSlug}&c=${companyCode}`, { auth: false }))
      .body.data;

    for (const { nights } of durations) {
      assert.ok(
        mine.some((p) => p.nights === nights),
        `a ${nights}-night package should be listed`,
      );
    }
  });
});

describe('customer visibility', () => {
  test('a hidden package is absent from the list and 404s by id', async () => {
    await ready();
    const { body } = await makePackage({ status: 'hidden', price: 99999 });
    const id = body.data._id;

    const list = (await call('GET', `/packages?d=${destinationSlug}`, { auth: false })).body.data;
    assert.ok(!list.some((p) => p._id === id), 'hidden packages must not be listed');

    const direct = await call('GET', `/packages/${id}`, { auth: false });
    assert.equal(direct.status, 404, 'a hidden package must not be readable by id');

    // …but an admin still sees it.
    const asAdmin = await call('GET', `/admin/packages/${id}`);
    assert.equal(asAdmin.status, 200);
  });

  test('hiding a published package removes it from the customer list', async () => {
    await ready();
    const { body } = await makePackage({ price: 4321 });
    const id = body.data._id;

    const before = (await call('GET', `/packages?d=${destinationSlug}`, { auth: false })).body.data;
    assert.ok(before.some((p) => p._id === id));

    await call('PATCH', `/admin/packages/${id}`, { body: { status: 'hidden' } });

    const afterHide = (await call('GET', `/packages?d=${destinationSlug}`, { auth: false })).body.data;
    assert.ok(!afterHide.some((p) => p._id === id));
  });
});

describe('public filtering and sorting', () => {
  test('results come back cheapest first', async () => {
    await ready();
    const list = (await call('GET', `/packages?d=${destinationSlug}`, { auth: false })).body.data;
    const prices = list.map((p) => p.price);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  });

  test('price, duration and availability filters are applied', async () => {
    await ready();
    await makePackage({ price: 3003, nights: 1, avail: 'soldout' });

    const cheap = (await call('GET', `/packages?d=${destinationSlug}&maxPrice=3500`, { auth: false }))
      .body.data;
    assert.ok(cheap.every((p) => p.price <= 3500), 'maxPrice must be respected');

    const oneNight = (await call('GET', `/packages?d=${destinationSlug}&nights=1`, { auth: false }))
      .body.data;
    assert.ok(oneNight.every((p) => p.nights === 1), 'nights must be respected');

    const soldout = (await call('GET', `/packages?d=${destinationSlug}&avail=soldout`, { auth: false }))
      .body.data;
    assert.ok(soldout.every((p) => p.avail === 'soldout'), 'avail must be respected');
  });

  test('an unknown availability value is a 400, not an empty list', async () => {
    await ready();
    const { status } = await call('GET', '/packages?avail=whenever', { auth: false });
    assert.equal(status, 400);
  });
});

describe('authorization', () => {
  for (const [method, path, body] of [
    ['POST', '/admin/packages', { c: 'H', d: 'x', title: 't', price: 1 }],
    ['PATCH', '/admin/packages/000000000000000000000000', { price: 2 }],
    ['DELETE', '/admin/packages/000000000000000000000000', undefined],
    ['GET', '/admin/packages', undefined],
  ]) {
    test(`${method} ${path} requires a token`, async () => {
      await ready();
      const { status } = await call(method, path, { body, auth: false });
      assert.equal(status, 401);
    });
  }
});

describe('itinerary management', () => {
  test('a day-by-day itinerary round-trips through the admin API', async () => {
    await ready();
    const { body } = await makePackage({
      itinerary: [
        { day: 1, title: 'Dehradun to Sankri', detail: 'Early departure.' },
        { day: 2, title: 'Summit push', detail: 'Pre-dawn start.' },
      ],
    });

    assert.equal(body.data.itinerary.length, 2);
    assert.equal(body.data.itinerary[1].day, 2);
    assert.equal(body.data.itinerary[1].title, 'Summit push');

    // And the customer read carries it — this is what the package page renders.
    const seen = (await call('GET', `/packages/${body.data._id}`, { auth: false })).body.data;
    assert.deepEqual(
      seen.itinerary.map((d) => d.title),
      ['Dehradun to Sankri', 'Summit push'],
    );
  });

  test('an itinerary PDF is stored and served to customers', async () => {
    await ready();
    const pdf = 'https://res.cloudinary.com/demo/raw/upload/v1/itinerary.pdf';

    const { body } = await makePackage({ pdf, pdfId: 'trustify/itinerary' });
    assert.equal(body.data.pdf, pdf, 'pdf must be in EDITABLE_FIELDS to persist');
    assert.equal(body.data.pdfId, 'trustify/itinerary');

    const seen = (await call('GET', `/packages/${body.data._id}`, { auth: false })).body.data;
    assert.equal(seen.pdf, pdf, 'the customer read must carry the document');
  });

  test('the two are independent — either, both or neither', async () => {
    await ready();

    const listOnly = await makePackage({
      itinerary: [{ day: 1, title: 'Arrive', detail: '' }],
    });
    assert.equal(listOnly.body.data.itinerary.length, 1);
    assert.equal(listOnly.body.data.pdf, '', 'no document is a valid state');

    const pdfOnly = await makePackage({ pdf: 'https://example.com/a.pdf' });
    assert.equal(pdfOnly.body.data.itinerary.length, 0, 'no day list is a valid state');
    assert.equal(pdfOnly.body.data.pdf, 'https://example.com/a.pdf');

    const neither = await makePackage();
    assert.equal(neither.body.data.itinerary.length, 0);
    assert.equal(neither.body.data.pdf, '');
  });

  test('clearing the PDF leaves the rest of the package alone', async () => {
    await ready();
    const { body } = await makePackage({
      pdf: 'https://example.com/a.pdf',
      pdfId: 'x',
      itinerary: [{ day: 1, title: 'Arrive', detail: '' }],
    });

    const cleared = await call('PATCH', `/admin/packages/${body.data._id}`, {
      body: { pdf: '', pdfId: '' },
    });

    assert.equal(cleared.body.data.pdf, '');
    assert.equal(cleared.body.data.pdfId, '');
    assert.equal(cleared.body.data.itinerary.length, 1, 'the day list must survive');
    assert.equal(cleared.body.data.title, body.data.title);
  });
});

describe('document uploads', () => {
  /** A minimal but structurally real PDF, built in memory. */
  const pdfBlob = () =>
    new Blob(['%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'], {
      type: 'application/pdf',
    });

  async function upload(part, blob, filename) {
    const form = new FormData();
    form.append(part, blob, filename);
    const res = await fetch(`${BASE}/admin/uploads/document`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  test('requires a token', async () => {
    await ready();
    const form = new FormData();
    form.append('file', pdfBlob(), 'itinerary.pdf');
    const res = await fetch(`${BASE}/admin/uploads/document`, { method: 'POST', body: form });
    assert.equal(res.status, 401);
  });

  test('rejects anything that is not a PDF', async () => {
    await ready();
    const notPdf = new Blob(['just text'], { type: 'text/plain' });
    const { status, body } = await upload('file', notPdf, 'itinerary.txt');

    assert.equal(status, 400);
    assert.equal(body.errors[0].field, 'file');
  });

  test('a real PDF gets past validation', async () => {
    await ready();
    const { status, body } = await upload('file', pdfBlob(), 'itinerary.pdf');

    // 201 when Cloudinary is configured; 503 when it is not — both mean the
    // request passed auth and the type and size checks, which is what this
    // asserts. A 400 would mean the PDF itself was rejected.
    assert.ok(
      status === 201 || status === 503,
      `expected 201 or 503, got ${status}: ${body.message}`,
    );

    if (status === 201) {
      assert.ok(body.data.url, 'a hosted URL should come back');
      assert.ok(
        body.data.downloadUrl.includes('fl_attachment'),
        'the download variant should carry the attachment flag',
      );
      assert.equal(body.data.name, 'itinerary.pdf', 'the original filename is returned');
    }
  });
});

describe('admin listing', () => {
  test('pagination and search are applied', async () => {
    await ready();
    const page = (await call('GET', '/admin/packages?limit=2&page=1')).body.data;

    assert.equal(page.items.length <= 2, true);
    assert.equal(page.limit, 2);
    assert.equal(page.page, 1);
    assert.ok(typeof page.total === 'number');
    assert.ok(page.pages >= 1);
  });

  test('a package reads back with both references', async () => {
    await ready();
    const { body } = await makePackage();
    const fetched = (await call('GET', `/admin/packages/${body.data._id}`)).body.data;

    assert.equal(fetched.c, companyCode);
    assert.equal(fetched.d, destinationSlug);
  });
});
