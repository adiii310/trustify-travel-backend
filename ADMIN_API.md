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

`companies` · `destinations` · `reviews` · `questions` · `enquiries` · `callbacks` · `applications` · `members` · `metrics` · `packages` · `content` · `settings` · `bookings`

> `bookings` has the generic list / get / patch / delete **plus** four routes of its own, because status, payments and notes each enforce a rule the generic `PATCH` deliberately cannot. See the booking section below.

> `settings` is **edit-only**: the backend declares the key set and creates any missing row when the list is read, so it has no `POST` and no `DELETE`.

> `GET /api/admin/metrics` is the editable homepage strip (a normal collection). `GET /api/admin/stats` is the dashboard's computed counters. Similar names, unrelated endpoints.
>
> `/api/admin/uploads/*` is **not** a collection — it has no list, no ids and stores nothing. See the two endpoints at the end of this section.

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

### Booking management

A booking is a customer request worked **manually** by the admin team: contact, payment collected offline, then explicit confirmation. Nothing in this API confirms a booking on its own, and no money moves through it.

`GET`, `PATCH` and `DELETE /api/admin/bookings/:id` work like any other collection, with one exception: **`PATCH` cannot set `status` or `payStatus`.** Both have their own routes, which is where the rules live.

#### `GET /api/admin/bookings`

Paginated and filterable beyond the generic list.

| Query | Meaning |
| --- | --- |
| `q` | Matches booking reference, customer name, email or phone |
| `status` / `payStatus` | Exact match |
| `d` / `c` | Destination slug / company short code |
| `from` / `to` | Created-at range, epoch ms |
| `page` / `limit` | 1-based; limit clamped to 1000 |

#### `GET /api/admin/bookings/stats`

The booking dashboard's counters, aggregated server-side from every row — one query, not a count per status.

```jsonc
// 200 — "Stats fetched successfully"
{
  "total": 37,
  "status": { "pending": 6, "contacted": 4, "awaiting_payment": 3,
              "confirmed": 18, "completed": 4, "cancelled": 1, "rejected": 1 },
  "payStatus": { "not_required": 1, "unpaid": 9, "partially_paid": 5, "paid": 21, "refunded": 1 },
  "quoted": 742310
}
```

Every known status is present as a key, so the dashboard never has to guard a missing one.

#### `PATCH /api/admin/bookings/:id/status`

```jsonc
{ "status": "confirmed" }
{ "status": "rejected", "reason": "Dates unavailable" }   // reason required
```

Two rules, both enforced here rather than in the UI:

| From | May become |
| --- | --- |
| `pending` | `contacted`, `awaiting_payment`, `cancelled`, `rejected` |
| `contacted` | `awaiting_payment`, `confirmed`, `cancelled`, `rejected` |
| `awaiting_payment` | `confirmed`, `contacted`, `cancelled`, `rejected` |
| `confirmed` | `completed`, `cancelled` |
| `completed` / `cancelled` / `rejected` | — terminal |

And: **confirming requires `payStatus` to be `paid`, `partially_paid` or `not_required`.** This is the rule the whole feature protects — a booking becomes confirmed because an admin verified a payment, never because a request arrived. Cancelling and rejecting require a `reason`, which goes into the audit trail.

#### `POST /api/admin/bookings/:id/payments`

Records money the admin verified **outside this application**. There is no gateway and no checkout.

```jsonc
{ "amount": 5000, "method": "upi", "reference": "UPI-A1B2",
  "at": 1791455437171, "note": "Confirmed on the bank statement" }

{ "kind": "refund", "amount": 5000, "reference": "REF-9" }
```

`method` is `cash` | `bank_transfer` | `upi` | `cheque` | `card_offline` | `other`.

- **`payStatus` is recalculated from the ledger** after every entry, so it can never disagree with the recorded payments.
- An amount of zero or less is a `400`; refunding more than was received is a `400`.
- The same `reference` **and** amount twice is a `409` — far more likely a double submit than two real payments.
- A refund sets `payStatus: "refunded"` and **keeps the original payments**, so the history stays intact.
- The whole change is one document write, which MongoDB applies atomically. No multi-document transaction is involved, because none is needed.

#### `PATCH /api/admin/bookings/:id/pay-status`

Only `not_required` and `unpaid` are accepted. `paid`, `partially_paid` and `refunded` are **derived** and setting them by hand is a `400` — that is how a booking would otherwise end up claiming money nobody recorded.

#### `POST /api/admin/bookings/:id/notes`

```jsonc
{ "text": "Called, left a voicemail." }
```

Appends a dated, attributed line to `notes` — the **internal** trail. `notes` is never returned by any customer endpoint; the customer-facing field is `update`, set through the generic `PATCH`.

#### `bookings` fields

| Field | Type | Notes |
| --- | --- | --- |
| `ref` | string | Unique, quotable, e.g. `TT-FN4R7B`. Generated; not editable. |
| `member` | ObjectId | The customer. Set from their token at request time. |
| `name` / `email` / `phone` | string | Contact details **as given on the request**, snapshotted. |
| `pkg` / `c` / `d` | ref | Package, company short code, destination slug — all validated. |
| `snap` | object | `{ title, price, nights, days, destName, companyName }` at booking time. |
| `startDate` / `pax` / `msg` | | The request itself. `msg` is the customer's own requirements. |
| `status` / `payStatus` | enum | **Own routes.** Not settable through `PATCH`. |
| `amount` / `advance` | number | Quoted total and advance asked for, INR. |
| `payments` | object[] | The ledger. Append-only through its own route. |
| `notes` | string | **Internal. Never leaves through a customer endpoint.** |
| `update` | string | Customer-facing note, shown in My Bookings. |
| `assignee` / `assigneeName` | | Who is handling it. |
| `history` | object[] | Audit trail: `{ at, byName, action, from, to, reason }`. |

Editable through `PATCH`: `startDate`, `pax`, `msg`, `amount`, `advance`, `notes`, `update`, `assignee`, `assigneeName`, `name`, `email`, `phone`.

**The snapshot is why booking history survives.** A package that is re-priced, renamed or withdrawn does not change what a past booking says. Render `snap`, never the package's current fields.

### `members` — now customer accounts too

The collection is unchanged except for three new fields: `username` (unique, optional), `phone` (unique, optional) and a bcrypt `passwordHash` that **no endpoint ever returns**.

`POST /api/members` still behaves exactly as it always has — identity capture, no password, no token. A member captured that way simply cannot sign in until they register, and registering with that email **upgrades the existing record** rather than creating a second one.

### `POST /api/admin/uploads/image`

Uploads one image to the project's Cloudinary account and returns where it landed. **The only `multipart/form-data` endpoint in the API** — everything else is JSON.

It stores nothing in the database. Writing the result onto a record is a separate `PATCH`, which is what lets the same endpoint serve any collection that grows an image later.

```js
const body = new FormData();
body.append('image', file);                 // the field MUST be named "image"

const res = await fetch(`${BASE}/admin/uploads/image`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },   // no Content-Type — the browser sets the boundary
  body,
});
const { data } = await res.json();

await api.update('destinations', id, { img: data.url, imgId: data.publicId });
```

```jsonc
// 201 — "Image uploaded successfully"
{
  "url": "https://res.cloudinary.com/…/trustify/destinations/ab12cd.jpg",
  "publicId": "trustify/destinations/ab12cd",
  "width": 1600,
  "height": 1067,
  "format": "jpg",
  "bytes": 214503
}
```

| Rule | Value |
| --- | --- |
| Field name | `image` — one file, anything else is a 400 |
| Accepted types | `image/jpeg`, `image/png`, `image/webp`, `image/avif` |
| Max size | 5 MB |
| Stored at | 1600px on the longest edge, format and quality chosen per browser |
| Authored as | **3:2 landscape, at least 1200×800** |

SVG is rejected on purpose: it can carry script and these files are served straight to browsers.

The aspect ratio is a recommendation, not a check — the server stores whatever it is given. The customer site paints the image into a 170px-tall card and across the full-width destination hero, both of which centre-crop, so a portrait or square upload loses its subject.

| Status | `message` |
| --- | --- |
| 201 | `Image uploaded successfully` |
| 400 | `That file type is not supported…` / `That image is too large. The limit is 5 MB.` / `Choose an image to upload.` |
| 401 | No or expired token |
| 503 | `Image uploads are not configured on this server.` — the `CLOUDINARY_*` variables are unset |

**Treat 503 as a disabled feature, not an outage.** Cover images are optional throughout the stack, so a backend without Cloudinary credentials is a working backend — hide or disable the upload control rather than failing the whole form.

### `POST /api/admin/uploads/destroy`

Removes a previously uploaded file. A `POST` with a JSON body rather than a `DELETE` with the id in the path, because a `publicId` contains the folder and therefore slashes.

```jsonc
// request
{ "publicId": "trustify/destinations/ab12cd" }

// 200 — "Image removed successfully"
{ "publicId": "trustify/destinations/ab12cd", "result": "ok" }
```

Deleting an id that is already gone is **not** an error — `result` comes back as `"not found"` and the status is still 200, because the caller's goal ("this file is not hosted any more") is satisfied either way.

This never touches the database. Clear `img` / `imgId` on the record yourself, and do it in that order — orphaning a file costs storage, while clearing the record first and failing the delete loses the id you needed.

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
| `dests` | number | | Destinations covered — a **display figure**. Default 0. |
| `about` | string | | Profile copy, max 3000. Empty hides the About panel. |
| `breakdown` | object[] | | `{ label, score }`; **any length**. Empty hides the breakdown panel. |
| `docs` | string[] | | Verified document names. Empty hides that tab. |
| `policies` | object[] | | `{ label, value }`. Empty hides that tab. |
| `photos` | string[] | | Hosted gallery image URLs. Empty hides that tab. |
| `places` | string[] | | Destination **slugs** this company runs trips to, lower-cased. Default `[]`. |
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

**`places` is the real company→destination link; `dests` is only a number.** `GET /api/destinations/:slug` builds its company list by matching the slug against `places`, so a company left with an empty `places` appears on no destination page however high its `dests` is. Nothing recalculates `dests` from `places` — set both.

Entries are stored lower-cased and must match a destination's `slug` exactly; an unknown slug is **not** rejected, it just never matches anything. Replace the whole array on `PATCH` — there is no add-one or remove-one operation.

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
| `highlights` | string[] | | What there is to see. Empty hides that panel. |
| `img` | string | | Cover photo URL, max 500. Default `""`. Set it from the upload endpoint below. |
| `imgId` | string | | The upload's `publicId`, max 300. Default `""`. Keep it so the old file can be removed. |
| `featured` | boolean | | Show in the homepage "Popular Destinations" grid. Default `false`. |
| `featuredRank` | number | | Position in that grid, **ascending**. Default 0. |
| `status` | enum | | `published` \| `hidden`. Default `published`. |

Search (`q`) matches `name`.

**The cover photo is optional and is stored as a plain URL.** This collection accepts JSON only — uploading the file is a separate call to `POST /api/admin/uploads/image` (below), which returns `{ url, publicId }`; write those into `img` / `imgId` yourself. Clearing a cover means sending `{ "img": "", "imgId": "" }`; the customer site falls back to the `c1`/`c2` gradient, so a destination with no photo is a finished destination, not a broken one.

`imgId` has no effect on rendering — it exists so that replacing or clearing a cover can delete the file it is abandoning via `POST /api/admin/uploads/destroy`. Overwrite `img` without it and the old file stays in storage forever.

`n` is the headline company count shown on the card and is admin-entered; the number of companies actually covering a destination is `companies.length` from `GET /api/destinations/:slug`. Nothing keeps them in step.

`featured` / `featuredRank` behave exactly as they do on companies, with the fallback being the original top-8-by-`n` ordering.

### `packages` — what a company sells for a destination

The relational core of the catalogue. A package belongs to exactly **one** company and **one** destination; a destination holds **many** packages, from one company or several, and the same company may list several durations for the same destination. They are independent records — editing one never touches another.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `c` | string | ✅ | Company short code (`k`). **Validated** — an unresolvable code is a 400. |
| `d` | string | ✅ | Destination slug. **Validated** — an unresolvable slug is a 400. |
| `title` | string | ✅ | Max 140. |
| `price` | number | ✅ | Per person, INR. Sorts the public list ascending. |
| `desc` | string | | One-line pitch for the card, max 400. |
| `nights` / `days` | number | | 0–60 each. |
| `inclusions` / `exclusions` | string[] | | Each entry max 200. |
| `itinerary` | object[] | | `{ day, title, detail }`; `day` 1–60, `title` required. |
| `img` / `imgId` | string | | Cover photo URL and its upload `publicId`. |
| `avail` | enum | | `open` \| `limited` \| `soldout`. Default `open`. |
| `status` | enum | | `published` \| `hidden`. Default `published`. |

Search (`q`) matches `title`.

**Both associations are enforced, and this is the one rule worth internalising.** Nothing in this API joins server-side, so a package's `c` and `d` are only meaningful if they resolve. Three checks make that true:

1. `POST` requires both, and rejects either if it does not resolve. The response names the offending field in `errors[]`, so a form can highlight it.
2. `PATCH` rejects a reference being *changed* to something unresolvable.
3. `PATCH` additionally refuses to leave the package `published` unless **both** references resolve.

That third rule is deliberately narrower than the second: a legacy row with a broken reference can still be saved while hidden, so it can be repaired. Validating everything on every write would make exactly the rows that need fixing uneditable.

```jsonc
// 400 — "A package needs both a company and a destination."
{ "errors": [ { "field": "c", "message": "Pick a company." },
              { "field": "d", "message": "Pick a destination." } ] }

// 400 — a reference that does not resolve
{ "errors": [ { "field": "d", "message": "No destination has the slug \"kedarkanta\"." } ] }
```

Pick both from `GET /api/admin/companies` and `GET /api/admin/destinations` rather than typing them — there is no reason for an admin to know a short code by heart, and a typo is a rejected save.

**`avail` is not `status`.** `status` decides whether the package is listed; `avail` decides whether it can be booked today. A sold-out package stays published so travellers can still compare it and enquire about the next departure.

**Legacy rows.** Referential validation arrived with this feature, so rows written before it may carry a broken reference. `npm run backfill:packages` audits them, and `-- --fix` sets any *published* broken row to `hidden`. It deletes nothing and changes nothing else — see the migration note at the end of this document.

### `content` — the five editable site lists

One collection serves five lists because every entry is the same ordered `{ icon, title, body }`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `group` | enum | ✅ | `badge` \| `step` \| `resource` \| `parameter` \| `interest`. |
| `title` | string | ✅ | Badge label, step title, FAQ question, parameter name or interest. Max 200. |
| `icon` | string | | Emoji. Used by `badge` and `step` only. |
| `body` | string | | Step detail or FAQ answer, max 2000. Empty for the title-only groups. |
| `order` | number | | Ascending; ties fall back to `ts`. |
| `status` | enum | | `published` \| `hidden`. Default `published`. |

Search (`q`) matches `title`. A group with no published rows means that section is **hidden** on the customer site, not that it falls back to built-in copy — the site ships none.

### `settings` — site-wide values

Edit-only. The backend declares the key set, and `GET /api/admin/settings` creates any declared key that has never been saved, so the list is never empty and an admin never has to invent a key name.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `key` | string | | Declared by the backend. Not meaningfully editable. |
| `value` | string | | Max 500. The only field you normally send. |
| `label` | string | | Admin-facing hint describing the key. |

Current keys: `site.name`, `site.tagline`, `site.whatsapp`, `site.whatsappMessage`. An empty `value` is an admin clearing it deliberately — the customer site hides whatever the key drives rather than substituting.

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
- **`places` is what puts a company on a destination page, not `dests`.** `dests` is a display number; `places` is the slug array `GET /api/destinations/:slug` filters on. An unknown slug in `places` is accepted silently and simply matches nothing, so pick from the live destination list rather than letting anyone type one.
- **A package's `c` and `d` are validated on write, unlike every other reference in this API.** Reviews and questions accept an unknown company code silently; packages do not, because a package that resolves to nothing is a page a traveller can reach and nothing can render. Pick both from the live lists.
- **Publishing a package is the strictest check.** A hidden package may be saved with a broken reference so it can be repaired; publishing it cannot.
- **A booking's `status` and `payStatus` are not editable through `PATCH`.** Both have dedicated routes that enforce the transition table and the payment ledger; the generic update silently ignores them.
- **Confirming a booking requires a recorded payment** (or `not_required`). This is deliberate and is the rule the booking workflow exists to protect.
- **`notes` is internal and `update` is not.** The customer endpoints return `update` and have never returned `notes` — the customer projection is built by naming what goes in, not by deleting what must stay out.
- **Customer tokens cannot reach admin routes.** Each token carries an audience claim; a customer token on `/api/admin/*` is a `403` before any lookup.
- **Image uploads are a separate multipart call.** The collection endpoints are JSON-only: `POST /api/admin/uploads/image` returns `{ url, publicId }` and you `PATCH` them onto the record as `img` / `imgId` yourself. A `503` there means the server has no Cloudinary credentials — the feature is off, not broken, because cover images are optional everywhere.
- **No `OPTIONS` handling needed on your side**; the backend answers preflights once the origin is allowlisted.
- **Deletes are permanent.** Confirm in the UI before calling `DELETE`.
- **`featured` / `featuredRank` may be missing from a record, not `false`/`0`.** Lists are read with `.lean()`, which does not apply schema defaults to stored documents, so companies and destinations created before these fields existed return without them. Read with `??` — subtracting two absent ranks gives `NaN`. Writing either field once fixes that record permanently; there is no backfill migration.
- **`featuredRank` and `metrics.order` are plain numbers with no uniqueness check.** Two records may share a position; the editor is responsible for assigning sensible values. Ties fall back to the collection's natural sort (`score`, `n`, `ts`).
- **Clearing every `featured` flag does not empty the homepage** — the customer site falls back to its original top-by-score / top-by-coverage ordering. "Nothing featured" means "not configured", not "show nothing".

---

## 9. Migrations and backfills

There is no migration framework: the backend is Mongoose with no schema migrations, and a new field is simply absent on older documents rather than needing a column added. Everything that reads one of these fields does so with `??`, which is why adding `desc`, `img`, `avail`, `about`, `breakdown`, `docs`, `policies`, `photos` and `highlights` needed no data change at all.

The one case that **does** need a step is referential integrity, because it is a rule rather than a field:

```bash
cd trustify-backend
npm run backfill:packages          # audit only — reports, changes nothing
npm run backfill:packages -- --fix # hide published packages with broken references
```

Packages written before validation existed can carry a missing or unresolvable `c` / `d`. The script reports every one, and with `--fix` sets any **published** broken row to `hidden` so a traveller cannot open a package whose company or destination does not exist.

**It deletes nothing**, touches no other field, and ignores already-hidden rows. It deliberately does not guess a destination from a title: a wrong guess puts a company on a destination page it never agreed to sell, which is worse than a hidden package. Repair the references in the admin panel and republish.

Run the audit after deploying, and again after any bulk import.

### Customer accounts and bookings

Also no migration. `username`, `phone` and `passwordHash` are new optional fields on `members`; existing rows have none and are untouched. Their unique indexes are **sparse**, so the many passwordless rows do not collide with each other.

`bookings` is a new collection — nothing to migrate into it.

The one thing worth knowing: a member captured by `POST /api/members` before accounts existed has no password and cannot sign in. That is the correct state, and registering with the same email upgrades the record in place. No backfill is needed or wanted.

---

## 10. Optional: stop serving the bundled admin portal

This backend still ships the old single-file admin portal at `/admin`. Now that the admin UI lives elsewhere, you can remove it — it is a live login form pointing at the same API.

In [`src/app.js`](src/app.js), delete this line:

```js
app.get('/admin*', (req, res) => res.sendFile(path.join(pub, 'admin', 'index.html')));
```

then delete the `public/admin/` folder. Nothing else references it; the API routes under `/api/admin/*` are unrelated and unaffected.

Leave it in place if you want a fallback UI while the new admin app is being built.
