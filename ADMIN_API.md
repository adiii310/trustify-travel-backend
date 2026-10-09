# Trustify Trips — Admin API integration guide

Everything an external admin frontend needs to talk to this backend: setup, auth, every endpoint, every editable field, and the common workflows.

The admin UI lives in its own project and runs on its own port. This backend only serves the API (plus the customer portal). All admin calls are cross-origin, so **start with the CORS step below — nothing works until that is set.**

For the public, unauthenticated endpoints the customer-facing site uses, see [`CUSTOMER_API.md`](CUSTOMER_API.md).

- **API base URL:** `http://localhost:5000/api` in development, `https://<your-api-host>/api` in production
- **Content type:** `application/json` on every request with a body
- **Auth:** `Authorization: Bearer <token>` on every `/api/admin/*` route and on `GET /api/auth/me`
- **Max request body:** 100 KB
- **Interactive reference:** the same API is browsable with a live request runner at `http://localhost:5000/docs`

---

## 1. Setup: allow your admin app's origin

The API rejects cross-origin browser calls unless the calling origin is allowlisted. In the backend's `.env`:

```bash
# comma-separated, no trailing slash, scheme + host + port must match exactly
CORS_ORIGINS=http://localhost:5173,https://admin.trustifytrips.in
```

Restart the backend after changing it.

If you skip this, every call fails in the browser before it reaches the server:

```
Access to fetch at 'http://localhost:5000/api/auth/login' from origin 'http://localhost:5173'
has been blocked by CORS policy: Response to preflight request doesn't pass access control
check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

Notes:

- `http://localhost:5173` and `http://127.0.0.1:5173` are **different origins**. List whichever your dev server actually prints, or both.
- A disallowed origin is not rejected with a JSON error — the server simply omits the CORS header and the browser blocks the response. You will see the error above in the console, never in your `catch` block as a status code.
- `PATCH` and `DELETE` (and anything sending `Authorization`) trigger a preflight `OPTIONS`. This is handled automatically once the origin is allowlisted; you do not need a route for it.
- Do not set `credentials: 'include'` — this API uses a bearer token, not cookies.

---

## 2. Response envelope

Every endpoint — success or failure — returns the same shape. Read the payload from `data`; show the user `message` when something fails. Branch on `success` or the HTTP status, never on the body shape.

**Success**

```jsonc
{
  "success": true,
  "statusCode": 200,
  "message": "Companies fetched successfully",
  "data": { }        // object, array, or null
}
```

**Failure**

```jsonc
{
  "success": false,
  "statusCode": 409,
  "message": "That k is already in use.",
  "errors": [ { "field": "k", "message": "Already in use." } ]
}
```

- `message` is always safe to show an end user as-is.
- `errors` carries `{ field, message }` entries when specific fields caused the failure — validation, duplicate key, bad ObjectId. Use it to highlight inputs in a form. It is an empty array otherwise, **never missing**.

### Status codes

| Status | Meaning |
| --- | --- |
| 200 | Read, update or delete succeeded |
| 201 | Something new was stored |
| 400 | Validation failed, bad ObjectId, malformed JSON, or body over 100 KB |
| 401 | Missing, invalid or expired token; wrong login credentials |
| 404 | Unknown route, or record not found |
| 409 | Unique field already in use, or application already published |
| 429 | Rate limit exceeded (login only) |
| 500 | Unexpected server error — message is generic, details are logged server-side |

---

## 3. Drop-in API client

```js
// api.js
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const TOKEN_KEY = 'tt_admin_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

/** Throws an Error carrying .status and .fieldErrors; returns the `data` payload. */
async function request(method, path, body) {
  const token = getToken();
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({}));

  // Token rejected: drop it and send the user back to the login screen.
  if (res.status === 401 && path !== '/auth/login') {
    clearToken();
    window.dispatchEvent(new CustomEvent('tt:signed-out'));
  }

  if (!res.ok) {
    const err = new Error(json.message || `Request failed with status ${res.status}`);
    err.status = res.status;
    err.fieldErrors = json.errors || [];
    throw err;
  }
  return json.data;
}

export const api = {
  get:    (p)    => request('GET', p),
  post:   (p, b) => request('POST', p, b),
  patch:  (p, b) => request('PATCH', p, b),
  delete: (p)    => request('DELETE', p),

  // auth
  login:  (email, password) => request('POST', '/auth/login', { email, password }),
  me:     ()     => request('GET', '/auth/me'),

  // admin
  stats:  ()                 => request('GET', '/admin/stats'),
  list:   (col, params = {}) => request('GET', `/admin/${col}?${new URLSearchParams(params)}`),
  one:    (col, id)          => request('GET', `/admin/${col}/${id}`),
  create: (col, body)        => request('POST', `/admin/${col}`, body),
  update: (col, id, body)    => request('PATCH', `/admin/${col}/${id}`, body),
  remove: (col, id)          => request('DELETE', `/admin/${col}/${id}`),
  publish:(id, body)         => request('POST', `/admin/applications/${id}/publish`, body),
};
```

Usage:

```js
const { token, admin } = await api.login('admin@trustifytrips.in', 'ChangeMe@123');
setToken(token);

const { items, total } = await api.list('reviews', { status: 'pending', limit: 25 });
await api.update('reviews', items[0]._id, { status: 'approved' });
```

---

## 4. Authentication

### `POST /api/auth/login`

Public. Rate limited to **10 attempts per IP per 15 minutes**.

```jsonc
// request
{ "email": "admin@trustifytrips.in", "password": "ChangeMe@123" }
```

```jsonc
// 200
{
  "success": true,
  "statusCode": 200,
  "message": "Signed in successfully",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "admin": {
      "_id": "66f0a1c2e4b0a1d2c3e4f625",
      "name": "Site Admin",
      "email": "admin@trustifytrips.in",
      "role": "admin"
    }
  }
}
```

| Status | `message` |
| --- | --- |
| 400 | `Enter your email and password.` |
| 401 | `Email or password is incorrect.` |
| 429 | `Too many sign-in attempts. Try again in 15 minutes.` |

An unknown email and a wrong password return the identical 401, so the endpoint cannot be used to discover which accounts exist. Surface it as one generic message.

### `GET /api/auth/me` 🔒

Returns the account behind the current token. Call it on app start to decide whether a stored token is still usable.

```jsonc
// 200
{ "success": true, "statusCode": 200, "message": "Admin fetched successfully",
  "data": { "admin": { "_id": "...", "name": "Site Admin", "email": "...", "role": "admin" } } }
```

### Token handling

- Send it as `Authorization: Bearer <token>` on every admin call.
- Tokens expire after `JWT_EXPIRES_IN` (default **7 days**). There is **no refresh endpoint** — on 401, clear the stored token and show the login screen again.
- Two distinct 401 messages: `Sign in to continue.` when the header is absent, `Your session expired. Sign in again.` when the token is present but rejected.
- Accounts are created server-side with `npm run create-admin`. There is no signup, no password-reset and no admin-management endpoint.
- `role` is `admin` or `editor` and is carried in the token, **but no route enforces it today** — any valid token has full access. If you need editor restrictions, enforce them in the backend, not only in the UI.

---

## 5. Admin endpoints

All require `Authorization: Bearer <token>`. `:collection` is one of:

`companies` · `destinations` · `reviews` · `questions` · `enquiries` · `callbacks` · `applications` · `members` · `metrics`

> `GET /api/admin/metrics` is the editable homepage strip (a normal collection). `GET /api/admin/stats` is the dashboard's computed counters. Similar names, unrelated endpoints.

### `GET /api/admin/stats`

Counters for the dashboard.

```jsonc
// 200 — "Stats fetched successfully"
{
  "pendingReviews": 7,     // reviews awaiting moderation
  "openQuestions": 3,      // questions with no answer yet
  "newLeads": 12,          // new enquiries + new callbacks, combined
  "pipeline": [            // ACTIVE applications grouped by verification stage
    { "_id": 0, "n": 4 },
    { "_id": 3, "n": 2 },
    { "_id": 7, "n": 1 }
  ],
  "liveCompanies": 4,      // published companies
  "members": 310
}
```

`pipeline` omits stages with no applications — do not index into it positionally. Build your stage chart from `0..7` and look each stage up:

```js
const byStage = Object.fromEntries(stats.pipeline.map((p) => [p._id, p.n]));
const counts = Array.from({ length: 8 }, (_, i) => byStage[i] || 0);
```

### `GET /api/admin/:collection`

Paginated list, **newest first** (by `ts` descending).

| Query | Type | Default | Notes |
| --- | --- | --- | --- |
| `status` | string | — | Exact match on the record's `status`. See each collection's values below. |
| `q` | string | — | Case-insensitive search. Matches whichever of `name`, `company`, `n`, `email`, `phone`, `city` exist on that collection. Regex characters are escaped, so raw user input is safe to pass. |
| `page` | number | `1` | 1-based. |
| `limit` | number | `50` | Maximum `1000`. Values above are clamped, not rejected. |

```jsonc
// 200 — "Reviews fetched successfully"
{
  "items": [ /* full records, including createdAt / updatedAt */ ],
  "total": 128,   // records matching the filter, not just this page
  "page": 1,
  "limit": 25,
  "pages": 6      // total pages for this filter
}
```

Unknown collection names return `404` with `No route for GET /api/admin/orders`.

### `GET /api/admin/:collection/:id`

Returns the complete document.

| Status | `message` |
| --- | --- |
| 400 | `Invalid _id: abc` — not a valid ObjectId (`errors[0].field` is `_id`) |
| 404 | `Company not found.` |

### `POST /api/admin/:collection`

Creates a record. **Only the editable fields listed in section 6 are accepted** — anything else in the body is dropped silently, so `_id`, `ts` and `createdAt` can never be forced. Unlike the public forms, admins *may* set `status` directly.

Returns `201` with the created record in `data`.

### `PATCH /api/admin/:collection/:id`

Partial update — send only the fields you are changing. Validators run on the update and the **full updated record** comes back in `data`, so you can drop it straight into your local state without a refetch.

```jsonc
// request
{ "status": "approved" }
```

### `DELETE /api/admin/:collection/:id`

Permanent — there is no soft delete and no undo.

```jsonc
// 200 — "Review deleted successfully"
{ "_id": "66f0a1c2e4b0a1d2c3e4f5c7" }
```

To take content off the public site without losing it, PATCH its `status` to `hidden` / `rejected` instead of deleting.

### `POST /api/admin/applications/:id/publish`

Turns a fully verified applicant into a live company. See the workflow in section 7.

```jsonc
// request — fields the application itself does not carry
{ "k": "D", "score": 92, "rating": 4.6, "price": 11499,
  "dests": 26, "since": "Apr 2023", "tags": ["Scenic Routes", "Local Guides"] }
```

| Status | `message` |
| --- | --- |
| 201 | `Company published successfully` — `data` is the new company record |
| 400 | `Finish every verification step before publishing.` — `stage` is below 7 |
| 404 | `Application not found.` |
| 409 | `This company is already published.` |

**Send `k` and `score`.** The application record has neither, and the Company model requires both — omitting them fails with a 400 validation error.

---

## 6. Collections reference

Fields marked **required** are rejected by the database when absent on create. Fields not listed here are ignored by `POST` and `PATCH`.

Every record also has `_id`, `ts` (creation time as a **Unix epoch in milliseconds**, a JS `Number` — not an ISO string), plus `createdAt` / `updatedAt` ISO strings.

### `companies` — verified travel companies on the public site

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `k` | string | ✅ | Short code / logo letter. **Unique**, upper-cased, max 3 chars. |
| `name` | string | ✅ | Max 120. |
| `score` | number | ✅ | Trust score, 0–100. Sorts the public list. |
| `rating` | number | | 0–5. Default 0. |
| `dests` | number | | Destinations covered. Default 0. |
| `since` | string | | e.g. `"Jan 2023"`. |
| `city` | string | | |
| `exp` | number | | Years in business. Default 0. |
| `price` | number | | 3N/4D price per person, INR. Default 0. |
| `reviews` | number | | Verified review count. Default 0. |
| `tags` | string[] | | Each max 40 chars. |
| `featured` | boolean | | Show in the homepage "Top Rated Companies" strip. Default `false`. |
| `featuredRank` | number | | Position in that strip, **ascending**. Default 0. |
| `status` | enum | | `published` \| `hidden`. Default `published`. |

Search (`q`) matches `name`, `city`.

`featured` / `featuredRank` are returned by the public `GET /api/companies` too, so the customer site curates its homepage from the list it already fetches. When no company is featured the site falls back to its original top-4-by-score ordering, so clearing every flag restores the default rather than emptying the section. `featuredRank` is not validated for uniqueness — two companies may share a rank, and ties fall back to `score`.

### `destinations`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `slug` | string | ✅ | **Unique**, lower-cased. The public endpoint also returns it as `id`. |
| `name` | string | ✅ | |
| `region` | string | | Default `"India"`. |
| `n` | number | | Verified companies covering it. Default 0. Sorts the public list. |
| `rating` | number | | 0–5. Default 0. |
| `desc` | string | | |
| `best` | string | | Best season, e.g. `"May - Oct"`. |
| `diff` | string | | Difficulty, e.g. `"Moderate"`. |
| `dur` | string | | Typical duration, e.g. `"3N/4D"`. |
| `budget` | string | | Typical budget range. |
| `c1` / `c2` | string | | Card gradient colours. Default `#2b4463` / `#0a1424`. |
| `featured` | boolean | | Show in the homepage "Popular Destinations" grid. Default `false`. |
| `featuredRank` | number | | Position in that grid, **ascending**. Default 0. |
| `status` | enum | | `published` \| `hidden`. Default `published`. |

Search (`q`) matches `name`.

`featured` / `featuredRank` behave exactly as they do on companies, with the fallback being the original top-8-by-`n` ordering.

### `reviews`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `c` | string | ✅ | Company short code, upper-cased. |
| `n` | string | ✅ | Reviewer name, max 80. |
| `r` | number | ✅ | Rating, 1–5. |
| `t` | string | ✅ | Review text, max 2000. |
| `trip` | string | | Package name, max 120. |
| `d` | string | | Display date, e.g. `"Sep 2024"`. |
| `status` | enum | | `pending` \| `approved` \| `rejected`. Default `pending`. |

Only `approved` reviews appear on the public site. Search (`q`) matches `n`.

### `questions`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `c` | string | ✅ | Company short code, upper-cased. |
| `n` | string | ✅ | Asker name, max 80. |
| `q` | string | ✅ | Question, max 1000. |
| `a` | string | | Answer, max 2000. Empty until answered. |
| `status` | enum | | `open` \| `answered` \| `hidden`. Default `open`. |

Everything except `hidden` is publicly visible — including unanswered questions. Search (`q`) matches `n`.

### `enquiries` — trip enquiry leads

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | ✅ | Max 80. |
| `phone` | string | ✅ | Max 20. |
| `date` | string | | Preferred travel date. |
| `pax` | number | | Travellers, 0–500. |
| `msg` | string | | Max 2000. |
| `company` | string | | Company name enquired about. |
| `ck` | string | | Company short code. |
| `pkg` | string | | Package name. |
| `status` | enum | | `new` \| `contacted` \| `booked` \| `closed`. Default `new`. |
| `notes` | string | | Internal. |

Search (`q`) matches `name`, `company`, `phone`.

### `callbacks`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | ✅ | Max 80. |
| `phone` | string | ✅ | Max 20. |
| `slot` | enum | | `Morning` \| `Afternoon` \| `Evening` \| `""`. Default `""`. |
| `status` | enum | | `new` \| `called` \| `closed`. Default `new`. |
| `notes` | string | | Internal. |

Search (`q`) matches `name`, `phone`.

### `applications` — companies applying for verification

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `company` | string | ✅ | Max 120. |
| `contact` | string | ✅ | Max 80. |
| `email` | string | ✅ | Validated, lower-cased. |
| `phone` | string | ✅ | Max 20. |
| `city` | string | | |
| `years` | number | | Years in business. Default 0. |
| `stage` | number | | Verification stage **0–7**. Default 0. Values outside the range are rejected. |
| `stageTs` | number | | Epoch ms the stage last changed — set it yourself when advancing a stage. |
| `status` | enum | | `active` \| `rejected` \| `published`. Default `active`. |
| `companyId` | ObjectId | | Set automatically when published. Read-only. |
| `notes` | string | | Internal. |

Search (`q`) matches `company`, `email`, `phone`, `city`.

### `members` — travellers who signed in on the customer portal

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | ✅ | Max 80. |
| `email` | string | ✅ | **Unique**, validated, lower-cased. |

Search (`q`) matches `name`, `email`.

### `metrics` — the homepage hero strip

The headline figures across the top of the customer homepage. Ordinary CRUD, so an admin can add, reorder, hide or delete entries.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `icon` | string | | Emoji, max 16 chars. Default `""`. |
| `value` | string | ✅ | Display **text**, max 20 — `"450+"`, `"50,000+"`. Not a number. |
| `label` | string | ✅ | Max 60 — `"Verified Companies"`. |
| `order` | number | | Position, **ascending**. Default 0; ties fall back to `ts`. |
| `status` | enum | | `published` \| `hidden`. Default `published`. |

Search (`q`) matches `label`.

**`value` is deliberately free text, not a computed count.** The site shows rounded marketing figures that do not track the row counts in this database; nothing recalculates them, so an admin who wants them accurate has to maintain them. The dashboard's own `liveCompanies` / `members` counters in `GET /api/admin/stats` are the real numbers if you want to show an admin what the true figures are.

Unlike every other public list, `GET /api/metrics` sorts by `order` ascending rather than `ts` descending — it is a fixed strip of positional slots, not a feed. The admin list endpoint still returns `ts` descending like all the others, so sort by `order` yourself when rendering the editor.

### Admin accounts

Not exposed as a collection. There is no endpoint to list, create or edit admins — accounts are managed server-side with `npm run create-admin`.

---

## 7. Common workflows

### Sign in and restore a session

```js
// on app start
if (getToken()) {
  try {
    const { admin } = await api.me();   // token still valid
    setUser(admin);
  } catch {
    clearToken();                        // expired — show the login screen
  }
}
```

### Moderate reviews

```js
const { items, total } = await api.list('reviews', { status: 'pending', limit: 50 });
await api.update('reviews', id, { status: 'approved' });   // or 'rejected'
```

Approved reviews appear on the public site immediately. Rejecting keeps the record for the audit trail; deleting removes it for good.

### Answer a question

```js
await api.update('questions', id, { a: 'Yes, pickup is included.', status: 'answered' });
```

Set `status` yourself — writing `a` alone leaves the question showing as `open`. Use `status: 'hidden'` to pull a question off the public site.

### Work the lead inbox

```js
const enquiries = await api.list('enquiries', { status: 'new' });
const callbacks = await api.list('callbacks', { status: 'new' });
await api.update('enquiries', id, { status: 'contacted', notes: 'Called, sending itinerary.' });
```

`stats.newLeads` is these two counts added together — query the collections separately to split them.

### Advance an application through verification

```js
await api.update('applications', id, { stage: 4, stageTs: Date.now() });
```

Stages run `0`–`7` (eight steps). `stageTs` is not updated automatically; send it with each stage change if you want to show "in this stage since…". To decline an applicant, PATCH `status: 'rejected'`.

### Publish a verified applicant as a company

```js
const app = await api.one('applications', id);
if (app.stage < 7) throw new Error('Finish every verification step first');

const company = await api.publish(id, {
  k: 'D',             // required by the Company model — pick an unused code
  score: 92,          // required by the Company model
  rating: 4.6,
  price: 11499,
  dests: 26,
  since: 'Apr 2023',
  tags: ['Scenic Routes', 'Local Guides'],
});
```

The server copies `company` → `name`, `city` and `years` → `exp` from the application, creates the company as `published`, marks the application `published`, and links them via `companyId`. It is a one-way, one-time action: a second call returns `409`.

A duplicate `k` returns `409 That k is already in use.` and **no company is created** — the application stays unpublished, so you can retry with a different code.

### Handle field errors in a form

```js
try {
  await api.create('companies', form);
} catch (e) {
  if (e.status === 400 || e.status === 409) {
    for (const { field, message } of e.fieldErrors) setFieldError(field, message);
  }
  toast(e.message);
}
```

---

## 8. Gotchas

- **`ts` is epoch milliseconds**, not an ISO string. `new Date(record.ts)` works directly; `createdAt` / `updatedAt` are ISO strings alongside it.
- **Short field names are intentional.** `k` = company code, `c` = company code on a review/question, `n` = person's name, `r` = rating, `t` = review text, `q`/`a` = question/answer, `d` = display date. They match what the public site already uses.
- **Reviews and questions reference companies by the `k` code, not by `_id`.** There is no join — fetch `companies` once and build a `k → name` lookup in the client.
- **`total` vs `items.length`.** `total` counts every record matching the filter; `items` is just the current page. Drive pagination from `total` / `pages`.
- **`limit` is capped at 1000** and silently clamped. Fetching a whole collection in one call works for the current data volume but will not scale — prefer real pagination.
- **Validation errors come from Mongoose**, so messages read like ``Path `name` is required.`` Prefer `errors[].field` for highlighting inputs and your own copy for the user-facing text, falling back to `message`.
- **Nothing is rate limited on admin routes** — only login (10 per 15 min) and the public forms.
- **No `OPTIONS` handling needed on your side**; the backend answers preflights once the origin is allowlisted.
- **Deletes are permanent.** Confirm in the UI before calling `DELETE`.
- **`featured` / `featuredRank` may be missing from a record, not `false`/`0`.** Lists are read with `.lean()`, which does not apply schema defaults to stored documents, so companies and destinations created before these fields existed return without them. Read with `??` — subtracting two absent ranks gives `NaN`. Writing either field once fixes that record permanently; there is no backfill migration.
- **`featuredRank` and `metrics.order` are plain numbers with no uniqueness check.** Two records may share a position; the editor is responsible for assigning sensible values. Ties fall back to the collection's natural sort (`score`, `n`, `ts`).
- **Clearing every `featured` flag does not empty the homepage** — the customer site falls back to its original top-by-score / top-by-coverage ordering. "Nothing featured" means "not configured", not "show nothing".

---

## 9. Optional: stop serving the bundled admin portal

This backend still ships the old single-file admin portal at `/admin`. Now that the admin UI lives elsewhere, you can remove it — it is a live login form pointing at the same API.

In [`src/app.js`](src/app.js), delete this line:

```js
app.get('/admin*', (req, res) => res.sendFile(path.join(pub, 'admin', 'index.html')));
```

then delete the `public/admin/` folder. Nothing else references it; the API routes under `/api/admin/*` are unrelated and unaffected.

Leave it in place if you want a fallback UI while the new admin app is being built.
