# Trustify Trips — Customer API integration guide

Everything a customer-facing frontend needs: setup, every public endpoint, every field it returns, every form payload, and the common page-level workflows.

These endpoints are **unauthenticated** — no token, no login, no API key. They read published content and accept form submissions. Anything that moderates, edits or deletes lives behind the admin API; see [`ADMIN_API.md`](ADMIN_API.md).

- **API base URL:** `http://localhost:5000/api` in development, `https://<your-api-host>/api` in production
- **Content type:** `application/json` on every request with a body
- **Auth:** none on any endpoint in this document
- **Max request body:** 100 KB
- **Interactive reference:** the same API is browsable with a live request runner at `http://localhost:5000/docs`

---

## 1. Setup

### If your site is served by this backend

Nothing to configure. The bundled customer portal at `/` calls `/api/...` on the same origin and works out of the box.

### If your site runs on its own origin

Add it to the backend's `.env` — a different port counts as a different origin:

```bash
# comma-separated, no trailing slash, scheme + host + port must match exactly
CORS_ORIGINS=http://localhost:5173,https://trustifytrips.in,https://www.trustifytrips.in
```

Restart the backend afterwards. Skip this and every call fails in the browser before reaching the server:

```
Access to fetch at 'http://localhost:5000/api/companies' from origin 'http://localhost:5173'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the
requested resource.
```

Notes:

- `http://localhost:5173` and `http://127.0.0.1:5173` are **different origins**. List whichever your dev server prints, or both.
- Include the `www` and non-`www` production hosts if both resolve.
- A disallowed origin is not rejected with a JSON error — the server omits the CORS header and the browser blocks the response. You will see the error above in the console, never in your `catch` block as a status code.
- Do not set `credentials: 'include'` — these endpoints use no cookies.

> **Security note.** Everything here is public and unauthenticated, so an API host reachable from the browser is also reachable from a script. The form endpoints are rate limited (section 5) but have no CAPTCHA. If you expose this on the public internet, expect some spam in `enquiries`, `callbacks` and `reviews`, and keep review moderation on.

---

## 2. Response envelope

Every endpoint — success or failure — returns the same shape. Read the payload from `data`; show the user `message` when something fails. Branch on `success` or the HTTP status, never on the body shape.

**Success**

```jsonc
{
  "success": true,
  "statusCode": 200,
  "message": "Companies fetched successfully",
  "data": [ ]        // array, object, or null
}
```

**Failure**

```jsonc
{
  "success": false,
  "statusCode": 400,
  "message": "Name and email are required.",
  "errors": [ { "field": "email", "message": "Enter a valid email." } ]
}
```

- `message` is always safe to show an end user as-is.
- `errors` carries `{ field, message }` entries when specific fields caused the failure. Use it to highlight inputs in a form. It is an empty array otherwise, **never missing**.

### Status codes

| Status | Meaning |
| --- | --- |
| 200 | A read succeeded |
| 201 | A submission was stored |
| 400 | Validation failed, malformed JSON, or body over 100 KB |
| 404 | Unknown route |
| 429 | Too many form submissions from this IP (see section 5) |
| 500 | Unexpected server error — message is generic, details are logged server-side |

You will not see `401`, `403` or `409` on any endpoint in this guide.

---

## 3. Drop-in API client

```js
// api.js
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

/** Throws an Error carrying .status and .fieldErrors; returns the `data` payload. */
async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(json.message || `Request failed with status ${res.status}`);
    err.status = res.status;
    err.fieldErrors = json.errors || [];
    err.rateLimited = res.status === 429;
    throw err;
  }
  return json.data;
}

export const api = {
  // reads
  health:       ()   => request('GET', '/health'),
  companies:    ()   => request('GET', '/companies'),
  destinations: ()   => request('GET', '/destinations'),
  destination:  (slug) => request('GET', `/destinations/${encodeURIComponent(slug)}`),
  packages:     (q = {}) => request('GET', '/packages?' + new URLSearchParams(q)),
  package:      (id)  => request('GET', `/packages/${encodeURIComponent(id)}`),
  content:      ()    => request('GET', '/content'),
  settings:     ()    => request('GET', '/settings'),
  reviews:      (c)  => request('GET', c ? `/reviews?c=${encodeURIComponent(c)}` : '/reviews'),
  questions:    (c)  => request('GET', c ? `/questions?c=${encodeURIComponent(c)}` : '/questions'),
  metrics:      ()   => request('GET', '/metrics'),

  // submissions
  enquiry:     (b) => request('POST', '/enquiries', b),
  callback:    (b) => request('POST', '/callbacks', b),
  application: (b) => request('POST', '/applications', b),
  askQuestion: (b) => request('POST', '/questions', b),
  review:      (b) => request('POST', '/reviews', b),
  signIn:      (name, email) => request('POST', '/members', { name, email }),
};
```

Usage:

```js
const companies = await api.companies();
const reviews = await api.reviews('H');
await api.enquiry({ name: 'Aarav Sharma', phone: '9876543210', pax: 4, ck: 'H' });
```

---

## 4. Read endpoints

All reads are plain `GET`s with no auth and no pagination. They return only **published / approved** content — hidden and unmoderated records never appear.

### `GET /api/health`

Liveness probe. Does not touch the database.

```jsonc
// 200 — "API is healthy"
{ "ok": true, "time": "2026-10-08T09:21:44.512Z" }
```

### `GET /api/companies`

Every company with `status: "published"`, **sorted by `score` descending** (highest trust first). The full list comes back in one response — there is no paging.

```jsonc
// 200 — "Companies fetched successfully"
[
  {
    "_id": "6ac770cd8ea944a44e634fbc",
    "k": "H",                               // short code / logo letter — the join key
    "name": "Holiday Heaven",
    "score": 96,                            // trust score 0-100, drives the sort
    "rating": 4.8,                          // 0-5
    "dests": 24,                            // destinations covered
    "since": "Jan 2023",                    // verified since
    "city": "Dehradun, Uttarakhand",
    "exp": 8,                               // years in business
    "price": 10499,                         // 3N/4D price per person, INR
    "reviews": 2340,                        // verified review count
    "tags": ["Custom Itineraries", "24x7 Support", "Great Hotels"],
    "places": ["kedarnath", "leh-ladakh", "kashmir"],  // destination slugs it runs trips to
    "about": "A Dehradun based operator specialising in…",
    "breakdown": [ { "label": "Itinerary Quality", "score": 92 } ],  // any length
    "docs": ["GST Certificate", "Tourism License"],
    "policies": [ { "label": "Cancellation", "value": "Free up to 15 days before" } ],
    "photos": ["https://res.cloudinary.com/…/trip.jpg"],
    "featured": false,                      // admin picked it for the homepage strip
    "featuredRank": 0,                      // position within that strip, ascending
    "status": "published",
    "ts": 1791455437171                     // created, epoch ms
  }
]
```

`price` and `reviews` are display figures stored on the company record — `reviews` is **not** a live count of the `reviews` collection.

**`places` vs `dests`.** `dests` is a headline *number* an admin types in; `places` is the actual list of destination slugs the company sells trips to, and it is what `GET /api/destinations/:slug` filters on. Nothing keeps the two in step, so never derive one from the other — show `dests`, filter on `places`. Like `featured`, `places` **may be absent entirely** on a company saved before the field existed; read it as `company.places ?? []`.

**Curating the homepage.** `featured` / `featuredRank` let an admin choose which companies fill the homepage's "Top Rated Companies" strip. The endpoint still returns **every** published company in score order, so filter client-side off the list you already have rather than asking for a second one:

```js
const featured = companies.filter((c) => c.featured)
                          .sort((a, b) => a.featuredRank - b.featuredRank);
// Nothing curated yet? Fall back to the score order the API already applied.
const top = featured.length ? featured : companies.slice(0, 4);
```

Treat an empty featured set as "not configured", never as "show nothing" — a fresh install has no featured records.

**Both fields may be absent entirely, not `false`/`0`.** Lists are read with Mongoose's `.lean()`, which does not apply schema defaults to already-stored documents, so any company saved before curation existed comes back with no `featured` key at all. The sample above shows them because it is a freshly created record. Read them defensively — `a.featuredRank - b.featuredRank` over untouched records is `NaN`, which silently scrambles the order:

```js
const rank = (c) => c.featuredRank ?? 0;
featured.sort((a, b) => rank(a) - rank(b));
```

### `GET /api/destinations`

Published destinations, **sorted by `n` descending** (most verified companies first).

```jsonc
// 200 — "Destinations fetched successfully"
[
  {
    "_id": "6ac770cd8ea944a44e634fc4",
    "slug": "kedarnath",
    "id": "kedarnath",                      // mirror of slug — link by this
    "name": "Kedarnath",
    "region": "India",
    "n": 32,                                // verified companies covering it
    "rating": 4.7,
    "desc": "Verified travel companies for Kedarnath.",
    "c1": "#8a6a52",                        // card gradient start
    "c2": "#2b4463",                        // card gradient end
    "img": "https://res.cloudinary.com/…/kedarnath.jpg",  // optional cover photo
    "highlights": ["Kedarnath Temple", "Vasuki Tal"],
    "featured": false,                      // admin picked it for the homepage grid
    "featuredRank": 0,                      // position within that grid, ascending
    "status": "published",
    "ts": 1791455437198
  }
]
```

`featured` / `featuredRank` work exactly as they do on companies: they curate the homepage's "Popular Destinations" grid, the endpoint still returns everything published in `n` order, and an empty featured set means "not configured" — fall back to `slice(0, 8)`.

**Optional fields may be absent entirely, not `null`.** `best`, `diff`, `dur` and `budget` have no defaults, so a destination that was never given them simply has no such key — the sample above is a real response with all four missing. Always read them defensively:

```js
const season = dest.best ?? '—';
```

| Field | Meaning | Example |
| --- | --- | --- |
| `best` | Best season | `"May - Oct"` |
| `diff` | Difficulty | `"Moderate"` |
| `dur` | Typical duration | `"3N/4D"` |
| `budget` | Typical budget range | `"₹10,000 - ₹15,000"` |

**The cover photo is optional.** `img` is a hosted image URL an admin uploaded for the destination; `""` or a missing key both mean "no photo". Render it over the `c1`/`c2` gradient rather than instead of it, so a destination without one still looks finished and a slow or broken image never leaves an empty tile:

```css
background-image: url(<img>), linear-gradient(160deg, <c1>, <c2>);
background-size: cover;
```

Images are stored at most 1600px on the longest edge and delivered in whatever format the browser accepts. They are authored as **3:2 landscape** — assume a wide crop, not a square or a portrait.

### `GET /api/destinations/:slug`

One published destination **plus the published companies that run trips to it**, newest-verified-first by trust score. This is the only public read that joins two collections; it exists because a destination page needs both halves before it can render anything.

`:slug` is the destination's `slug` / `id` (`kedarnath`), not its `_id`, and is matched case-insensitively.

```jsonc
// 200 — "Destination fetched successfully"
{
  "_id": "6ac770cd8ea944a44e634fc4",
  "slug": "kedarnath",
  "id": "kedarnath",
  "name": "Kedarnath",
  "region": "India",
  "n": 32,
  "rating": 4.7,
  "desc": "Verified travel companies for Kedarnath.",
  "c1": "#8a6a52",
  "c2": "#2b4463",
  "img": "https://res.cloudinary.com/…/kedarnath.jpg",
  "status": "published",
  "ts": 1791455437198,
  "companies": [                            // same shape as GET /api/companies
    { "_id": "…", "k": "H", "name": "Holiday Heaven", "score": 96, "…": "…" }
  ]
}
```

Every optional field behaves exactly as it does in the list response above — `best`, `diff`, `dur`, `budget` and `img` may be absent.

- **A hidden or unknown destination is a `404`**, with the usual failure envelope. Handle it; an admin can hide a destination while people still hold links to it.
- **`companies` can legitimately be empty.** It is built by matching the slug against each published company's `places` array, and nothing requires a destination to have coverage. An empty array means "no verified company sells this yet", not an error.
- **`n` is not `companies.length`.** `n` is the admin-entered headline figure shown on the destination card; `companies.length` is what the API actually found. Show whichever the page is about and do not reconcile them.

### `GET /api/packages`

Published packages, **cheapest first**, capped at 200. This is the destination-to-package relationship made readable: a package belongs to exactly one destination and one company, and both references are validated when it is written, so every row here resolves to a real `destination.slug` and a real `company.k`.

Every filter is optional and they combine.

| Query | Meaning |
| --- | --- |
| `d` | Destination slug. The main one — a destination page passes this. |
| `c` | Company short code (`k`). |
| `minPrice` / `maxPrice` | Per person, INR, both inclusive. |
| `nights` | Exact number of nights. |
| `avail` | `open` \| `limited` \| `soldout`. |

```jsonc
// 200 — "Packages fetched successfully"
[
  {
    "_id": "6ac8caab2a8d0ce684259dd5",
    "c": "H",                               // company short code — always resolves
    "d": "kedarkantha",                     // destination slug — always resolves
    "title": "3D/2N Kedarkantha Weekend Summit",
    "desc": "Dehradun to Dehradun, two nights under canvas.",
    "nights": 2,
    "days": 3,
    "price": 7499,                          // per person, INR. Drives the sort.
    "inclusions": ["Dehradun pickup and drop", "Twin-sharing tents"],
    "exclusions": ["Personal trekking gear", "Travel insurance"],
    "itinerary": [
      { "day": 1, "title": "Dehradun to Sankri", "detail": "Early departure…" }
    ],
    "pdf": "https://res.cloudinary.com/…/kedarkantha-itinerary.pdf",  // optional
    "img": "https://res.cloudinary.com/…/kedarkantha.jpg",  // optional
    "avail": "open",
    "status": "published",
    "ts": 1791455437171
  }
]
```

- **One destination holds many packages, from one company or several.** The same company may list several durations for the same destination; they are independent records and editing one never touches another.
- **`avail` is not `status`.** `status` decides whether the package is listed at all; `avail` decides whether it can be booked today. A `soldout` package is still published, still returned here and still comparable — only the booking action changes.
- **`desc`, `img`, `pdf` and `avail` may be absent** on records saved before those fields existed. Read `avail` as `?? "open"`: the package is published and states no limit.

**The itinerary comes in two independent forms**, and a package may carry either, both or neither:

| Field | What it is |
| --- | --- |
| `itinerary` | The structured day-by-day list — `{ day, title, detail }`, in order. `day` is 1-based. |
| `pdf` | The same plan as a downloadable document, uploaded by an admin. |

Render each only if it has something in it. Neither is derived from the other, and an empty `itinerary` with a `pdf` present is a perfectly normal package — some operators publish only the document.

**To offer a download rather than an inline view**, insert Cloudinary's `fl_attachment` flag after `/upload/`:

```js
const view = pkg.pdf;
const download = pkg.pdf.replace('/upload/', '/upload/fl_attachment/');
```

A plain `<a download>` will not work here: browsers ignore that attribute on a cross-origin link, so the flag is the only thing that actually makes "Download" download. Leave a URL that is not a Cloudinary delivery URL untouched — an admin may paste any `https` address.
- **An unknown `avail` is a `400`, not an empty list** — a silently empty result reads as "this destination has nothing", which is a different and wrong answer.
- Results are capped at **200** with no paging. A destination with more than that is beyond what this endpoint can express.

### `GET /api/packages/:id`

One published package, by its `_id`. The only public read keyed on an id: a shared link has to keep working and a package has no other stable handle.

```jsonc
// 200 — "Package fetched successfully"
{ "_id": "…", "c": "H", "d": "kedarkantha", "…": "…" }
```

A hidden or unknown package is a **404**. Resolve `c` and `d` against `GET /api/companies` and `GET /api/destinations` — as everywhere else in this API, there is no server-side join.

### `GET /api/content`

Every published site-content list, **grouped**, each already in display order. One request rather than five: the homepage alone needs `badge` and `step`.

```jsonc
// 200 — "Content fetched successfully"
{
  "badge":     [ { "_id": "…", "group": "badge", "icon": "✔", "title": "Verified & Tested", "body": "", "order": 0, "status": "published", "ts": 1 } ],
  "step":      [ { "…": "…" } ],   // icon + title + body — the verification steps
  "resource":  [ { "…": "…" } ],   // title is the question, body the answer
  "parameter": [ { "…": "…" } ],   // trust-parameter names, title only
  "interest":  [ { "…": "…" } ]    // planner interest chips, title only
}
```

`?group=badge` narrows it and returns the same object shape. **Every requested group is always present**, as an empty array when it has no rows, so no caller has to guard a missing key. An empty group means the section is unconfigured — hide it rather than substituting copy.

### `GET /api/settings`

Site-wide values as a flat map. The server fills in every declared key from its own defaults, so this is **always complete**.

```jsonc
// 200 — "Settings fetched successfully"
{
  "site.name": "Trustify Trips",
  "site.tagline": "TRAVEL. VERIFIED.",
  "site.whatsapp": "",
  "site.whatsappMessage": "Hi Trustify Trips, I need help choosing a travel company."
}
```

A key present with an empty string is an admin clearing it deliberately — render nothing, never substitute. `site.whatsapp` empty means every WhatsApp button should be hidden rather than linking to `wa.me/`.

### `GET /api/reviews`

Reviews with `status: "approved"` only, **newest first**, capped at **500**.

| Query | Type | Notes |
| --- | --- | --- |
| `c` | string | Company short code. Case-insensitive — `?c=h` and `?c=H` both work. Omit for reviews across all companies. |

```jsonc
// 200 — "Reviews fetched successfully"
[
  {
    "_id": "6ac770cd8ea944a44e634fd6",
    "c": "H",                     // company short code
    "n": "Neha P.",               // reviewer name
    "r": 5,                       // rating 1-5
    "trip": "3N/4D Kedarnath",    // package name, may be ""
    "t": "Transparent pricing with no hidden charges.",
    "d": "Sep 2024",              // display date as typed, may be ""
    "status": "approved",
    "ts": 1791455437250
  }
]
```

`d` is a free-text display date, not a parseable timestamp. Use `ts` for sorting or relative times.

### `GET /api/questions`

Questions that are **not hidden** — both `open` (unanswered) and `answered`. Newest first, capped at **500**.

| Query | Type | Notes |
| --- | --- | --- |
| `c` | string | Company short code, case-insensitive. Omit for all companies. |

```jsonc
// 200 — "Questions fetched successfully"
[
  {
    "_id": "6ac770db5c53c81e63aeb36b",
    "c": "H",
    "n": "Priya K.",              // asker name
    "q": "Pickup from Haridwar?",
    "a": "",                      // answer — empty string until answered
    "status": "open",             // "open" | "answered"
    "ts": 1791455451036
  }
]
```

Unanswered questions are public the moment they are posted. Render `a` only when it is non-empty:

```jsx
{item.a ? <Answer text={item.a} /> : <Badge>Awaiting reply</Badge>}
```

A question an admin hides disappears from this endpoint entirely — treat a question vanishing between loads as normal, not an error.

---

### `GET /api/metrics`

The headline figures in the homepage hero strip, **published only, in `order` ascending**. Unpaged and uncapped; there are only ever a handful.

```jsonc
// 200 — "Metrics fetched successfully"
[
  {
    "_id": "6ac88014dcf36ec45a795af8",
    "icon": "🏢",                            // emoji, may be ""
    "value": "450+",                         // display TEXT, not a number
    "label": "Verified Companies",
    "order": 0,                              // ascending; ties fall back to ts
    "status": "published",
    "ts": 1791524884557
  }
]
```

**`value` is a string and is admin-entered.** It is deliberately not a live count of anything: the site shows rounded marketing figures (`"450+"`, `"50,000+"`) that do not track the row counts in this database. Render it verbatim — do not parse it, format it, or try to reconcile it with `/api/companies.length`.

The strip is fully admin-managed, so an admin can add, reorder, hide or remove entries. Render whatever arrives rather than assuming four, and **keep your own fallback copy** for an empty response:

```js
const metrics = (await api.metrics()).length ? await api.metrics() : DEFAULT_STATS;
```

## 5. Submission endpoints

Six `POST` endpoints accept form input. All six share **one rate limit: 20 submissions per IP per 10 minutes, counted across all of them combined** — 15 enquiries plus 5 callbacks exhausts the budget. Exceeding it returns:

```jsonc
// 429
{ "success": false, "statusCode": 429,
  "message": "Too many submissions. Try again in a few minutes.", "errors": [] }
```

Every response carries standard headers you can use to warn the user before they hit the wall:

```
RateLimit-Policy: 20;w=600
RateLimit-Limit: 20
RateLimit-Remaining: 7
RateLimit-Reset: 412        # seconds until the window resets
```

Read endpoints are **not** rate limited.

In every case the server accepts **only the fields listed** — anything else in the body is dropped silently. A visitor cannot set `status`, `notes`, `_id` or `ts` by adding them to the payload.

### `POST /api/enquiries` — trip enquiry

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | ✅ | Max 80 chars. |
| `phone` | string | ✅ | Max 20 chars. Not format-validated — validate in your form. |
| `date` | string | | Preferred travel date. Free text or `YYYY-MM-DD`; stored as given. |
| `pax` | number | | Travellers, 0–500. |
| `msg` | string | | Max 2000. |
| `company` | string | | Company name the enquiry is about. |
| `ck` | string | | Company short code — send this so the lead can be attributed. |
| `pkg` | string | | Package name the enquiry came from. |

```jsonc
// request
{ "name": "Aarav Sharma", "phone": "9876543210", "date": "2026-05-14", "pax": 4,
  "msg": "Looking for a 3N/4D Kedarnath package for a family of four.",
  "company": "Holiday Heaven", "ck": "H", "pkg": "3N/4D Kedarnath" }
```

```jsonc
// 201 — "Enquiry submitted successfully"
{ "_id": "6ac76482cdd65cc6a5198cca", "status": "new" }
```

### `POST /api/callbacks` — request a call back

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | ✅ | Max 80. |
| `phone` | string | ✅ | Max 20. |
| `slot` | enum | | `"Morning"`, `"Afternoon"`, `"Evening"` or `""`. Any other string is a 400. |

```jsonc
// 201 — "Callback requested successfully"
{ "_id": "6ac76482cdd65cc6a5198ccc", "status": "new" }
```

For "no preference", send `""` or omit the field — **not `null`**. Mongoose skips enum validation on `null`, so it is accepted (201) and stored as `null` instead of falling back to the `""` default, leaving the admin side with a third empty value to handle. A form `<select>` whose placeholder option has `value=""` does the right thing automatically.

### `POST /api/applications` — a travel company applies to get verified

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `company` | string | ✅ | Trading name, max 120. |
| `contact` | string | ✅ | Contact person, max 80. |
| `email` | string | ✅ | Must look like an email. Stored lower-cased. |
| `phone` | string | ✅ | Max 20. |
| `city` | string | | Operating city. |
| `years` | number | | Years in business, 0 or more. |

```jsonc
// 201 — "Application submitted successfully"
{ "_id": "6ac76482cdd65cc6a5198cce", "status": "active" }
```

The applicant then moves through eight verification stages in the admin portal. Nothing about that progress is readable from the public API — there is no "check my application status" endpoint. Tell applicants they will be contacted.

### `POST /api/questions` — ask a company a question

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `c` | string | ✅ | Company short code. Case-insensitive — `"h"` is stored as `"H"`. |
| `n` | string | ✅ | Asker name, max 80. |
| `q` | string | ✅ | Question, max 1000. |

```jsonc
// 201 — "Question posted successfully"
{ "_id": "6ac770db5c53c81e63aeb36b", "status": "open" }
```

**Posted questions are public immediately**, before any admin sees them. Refetch the question list after a successful post and the new entry will be there with an empty `a`. Unlike reviews, `c` is **not** validated against the company list — a typo creates a question attached to a code no company owns.

### `POST /api/reviews` — submit a review

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `c` | string | ✅ | Company short code. **Validated** — must match a real company. Case-insensitive. |
| `n` | string | ✅ | Reviewer name, max 80. |
| `r` | number | ✅ | Rating, 1–5. `0` and `6` are rejected. |
| `t` | string | ✅ | Review text, max 2000. |
| `trip` | string | | Package name, max 120. |
| `d` | string | | Display date, e.g. `"Sep 2024"`. |

Two possible successes, depending on the server's `REVIEW_AUTO_APPROVE` setting:

```jsonc
// 201 — "Review submitted for moderation"   (default: REVIEW_AUTO_APPROVE=false)
{ "_id": "6ac76482cdd65cc6a5198cd3", "status": "pending" }

// 201 — "Review published successfully"     (REVIEW_AUTO_APPROVE=true)
{ "_id": "6ac771011be3160678b6dd2c", "status": "approved" }
```

**Branch on the returned `status`, not on a hard-coded assumption** — the same build of your frontend must work against both settings:

```js
const { status } = await api.review(form);
toast(status === 'approved'
  ? 'Thanks! Your review is live.'
  : 'Thanks! Your review will appear once our team checks it.');
if (status === 'approved') refetchReviews();
```

An unknown company code returns `400 "Pick a company to review."` — populate the company picker from `GET /api/companies` and send the `k` value rather than letting people type a code.

### `POST /api/members` — traveller sign-in / sign-up

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | ✅ | Max 80. |
| `email` | string | ✅ | Must look like an email. Stored lower-cased and trimmed. |

```jsonc
// 201 — "Signed in successfully"
{ "_id": "6ac771241109bde99e93e863", "name": "Aarav Sharma", "email": "aarav@example.com" }
```

This is **identity capture, not authentication.** Understand before you build on it:

- It is an idempotent upsert keyed on email — a new traveller is created, an existing one has their `name` updated. `Aarav@Example.COM` and `aarav@example.com` are the same member.
- It **always returns `201`**, for both new and returning travellers. You cannot tell them apart from the response.
- It returns **no token and grants no access.** There is no password, no verification email, and nothing stops someone entering another person's address.
- There is no "my trips" or "my reviews" endpoint keyed to a member. Nothing in the public API is personalised.

Treat it as a newsletter-style capture. If you need real traveller accounts, that is a backend feature that does not exist yet.

---

## 6. Customer accounts and bookings

**This is the only authenticated part of the customer API.** Everything in section 4 and 5 is open; everything here needs a customer bearer token.

`POST /api/members` (section 5) is unchanged and still issues no token — it is identity capture for prefilling forms. Accounts are separate, and registering with an email that endpoint already captured **upgrades that record** rather than refusing: it is the same traveller, and they have never had a password.

### Tokens

```js
const { token, member } = await api.register({ name, email, phone, password });
// or
const { token, member } = await api.login({ identifier, password });

// Then, on the booking endpoints only:
headers: { Authorization: `Bearer ${token}` }
```

Admin tokens and customer tokens are **not interchangeable**: each carries an audience claim, and presenting one where the other belongs is a `403` / `401` before any lookup happens. Persist the token however your app persists sessions; it expires on the backend's `JWT_EXPIRES_IN` (7 days by default), and a `401` on any of these endpoints means sign in again.

### `POST /api/auth/customer/register`

```jsonc
// request — username is optional, everything else required
{ "name": "Aarav Shah", "email": "aarav@example.com", "phone": "9876543210",
  "username": "aarav", "password": "at least 8 chars" }

// 201 — "Account created successfully"
{ "token": "eyJ…", "member": { "_id": "…", "name": "Aarav Shah",
  "email": "aarav@example.com", "username": "aarav", "phone": "9876543210", "ts": 1791455437171 } }
```

| Status | Meaning |
| --- | --- |
| 400 | Validation failed. **Every** problem is in `errors[]`, not just the first. |
| 409 | The email, username or phone is already registered — `errors[0].field` says which. |

Phone numbers are normalised to digits, so `+91 98765 43210` and `9876543210` are the same account. The password hash is never returned by any endpoint.

### `POST /api/auth/customer/login`

One field takes **an email, a username or a phone number**. Which one it is is inferred from its shape, because travellers type what they remember.

```jsonc
{ "identifier": "aarav@example.com", "password": "…" }   // or "aarav", or "9876543210"
```

Every failure is the same `401` with the same message — a wrong password, an unknown identifier and an account that has never set a password are indistinguishable, so this cannot be used to discover who has an account. Rate limited to **10 attempts per IP per 15 minutes**.

### `GET /api/auth/customer/me` 🔒

Returns `{ member }`. Call it on start-up to check a restored token is still good; a `401` means sign out.

### `PATCH /api/auth/customer/me` 🔒

Updates `name`, `phone` and `username`. **`email` is deliberately not updatable** — it is the key registration matches on and the handle every historical booking was made under.

### `POST /api/auth/customer/password` 🔒

```jsonc
{ "currentPassword": "…", "newPassword": "at least 8 chars" }
```

Proves the current password (a wrong one is a `401`) and returns a fresh `{ token, member }`.

### `POST /api/bookings` 🔒

Requests a booking. **This is not a confirmation**: it creates a `pending` record, takes no payment and reserves nothing. The admin team reviews it and gets in touch.

```jsonc
// request
{ "pkg": "6ac8caab2a8d0ce684259dd5", "pax": 2,
  "startDate": "2027-01-15", "msg": "Two vegetarians, please.", "phone": "9876543210" }
```

- **The server prices the booking** from the package: `amount = package.price × pax`. An `amount`, `price` or `status` in the request body is ignored.
- The package must be **published and not sold out**; anything else is a `400`.
- `pax` is 1–50. `startDate` is `YYYY-MM-DD` or omitted.
- The customer is taken from the **token**. There is no customer id to send, and therefore none to manipulate.
- Rate limited with the other public forms: 20 per IP per 10 minutes.

### `GET /api/bookings` 🔒 and `GET /api/bookings/:id` 🔒

The signed-in traveller's own bookings, newest first, max 200. `?status=` filters. A booking belonging to someone else is a **404**, not a 403 — the API will not confirm that it exists.

```jsonc
// 200 — "Bookings fetched successfully"
[
  {
    "_id": "6ac8dc106472e74037682a7a",
    "ref": "TT-FN4R7B",                     // quotable, unique
    "pkg": "6ac8caab…", "c": "H", "d": "kedarkantha",
    "snap": {                               // as priced when booked, not today
      "title": "3D/2N Kedarkantha Weekend Summit", "price": 7499,
      "nights": 2, "days": 3,
      "destName": "Kedarkantha", "companyName": "Holiday Heaven"
    },
    "startDate": "2027-01-15",
    "pax": 2,
    "msg": "Two vegetarians, please.",
    "status": "pending",
    "payStatus": "unpaid",
    "amount": 14998,
    "advance": 0,
    "paid": 0,                              // verified by an admin, offline
    "balance": 14998,
    "update": "",                           // the team's note to the traveller
    "ts": 1791455437171
  }
]
```

**This is a narrower projection than the admin API returns.** The booking's internal notes, its audit trail, its assignee and the individual payment records are *absent* — the server builds this shape by naming what goes in, so a field added later stays invisible here until someone deliberately lists it.

| `status` | What it means to the traveller |
| --- | --- |
| `pending` | Request received, not yet reviewed |
| `contacted` | The team has been in touch |
| `awaiting_payment` | They know what to pay |
| `confirmed` | Explicitly confirmed by the team |
| `completed` | The trip has happened |
| `cancelled` / `rejected` | Not going ahead |

| `payStatus` | Meaning |
| --- | --- |
| `not_required` | Nothing to pay right now |
| `unpaid` / `partially_paid` / `paid` | Derived from payments the team verified **offline** |
| `refunded` | Refunded outside this application |

**`status` and `payStatus` are independent.** A booking can be `confirmed` while only partly paid, and `awaiting_payment` is a workflow stage rather than a payment state.

The snapshot is why booking history survives: a package that is re-priced, renamed or withdrawn does not change what a past booking says. Render `snap`, never the package's current fields.

**There is no online payment anywhere in this API.** No card details are collected or stored, and no endpoint moves money. Payment is arranged directly with the team and recorded by an admin after they verify it.

---

## 7. Common workflows

### Load everything a homepage needs

```js
const [companies, destinations, reviews, metrics] = await Promise.all([
  api.companies(),
  api.destinations(),
  api.reviews(),           // latest approved reviews across all companies
  api.metrics(),           // the admin-managed hero strip
]);

// The homepage strips are curated by an admin, with the old ordering as fallback.
const pick = (list, count) => {
  const featured = list.filter((x) => x.featured)
                       .sort((a, b) => a.featuredRank - b.featuredRank);
  return featured.length ? featured : list.slice(0, count);
};

const topCompanies = pick(companies, 4);        // already score desc
const popularDestinations = pick(destinations, 8); // already `n` desc
```

Four independent requests, no auth, no sequencing — fire them in parallel. Note that `companies` and `destinations` are the **same lists** the directory pages use, so a client with a cache needs no extra request to curate the homepage.

### Build a company detail page

```js
const [companies, reviews, questions] = await Promise.all([
  api.companies(),
  api.reviews(code),       // code is the company's `k`, e.g. 'H'
  api.questions(code),
]);
const company = companies.find((c) => c.k === code);
if (!company) return notFound();   // hidden or deleted since the list was built
```

There is no `GET /api/companies/:id`. Fetch the list and find the one you need — it is a small, fully published list. The same applies to destinations: match on `slug` / `id`.

### Resolve company names on reviews and questions

Reviews and questions reference a company by its `k` code, never by `_id`, and the API does no join. Build the lookup once:

```js
const companies = await api.companies();
const nameByCode = Object.fromEntries(companies.map((c) => [c.k, c.name]));
const label = nameByCode[review.c] ?? review.c;   // fall back to the raw code
```

A code with no matching company is possible — a company can be hidden while its approved reviews stay live. Always have a fallback.

### Submit a form and handle every outcome

```js
try {
  await api.enquiry(form);
  toast('Thanks! We will call you shortly.');
  resetForm();
} catch (e) {
  if (e.rateLimited) {
    toast('Too many submissions from this network. Please try again in a few minutes.');
  } else if (e.status === 400) {
    for (const { field, message } of e.fieldErrors) setFieldError(field, message);
    toast(e.message);
  } else {
    toast('Something went wrong. Please try again.');
  }
}
```

Disable the submit button while the request is in flight — double-clicks burn two of the twenty allowed submissions.

### Post a question and show it immediately

```js
await api.askQuestion({ c: company.k, n: name, q: text });
setQuestions(await api.questions(company.k));   // the new one is already there
```

### Keep a list fresh

There are no websockets and no change feed. Poll if you need freshness:

```js
useEffect(() => {
  const load = () => api.reviews(code).then(setReviews).catch(() => {});
  load();
  const t = setInterval(load, 30_000);
  return () => clearInterval(t);
}, [code]);
```

Reads are unlimited, but 30 seconds is plenty — this content changes at human moderation speed.

---

## 8. Gotchas

- **`ts` is epoch milliseconds**, not an ISO string. `new Date(record.ts)` works directly. The only ISO timestamp in the public API is `time` from `/health`.
- **Short field names are intentional** and match the existing site: `k` = company code, `c` = company code on a review/question, `n` = person's name, `r` = rating, `t` = review text, `q`/`a` = question/answer, `d` = display date, `n` on a *destination* = company count (a number, unrelated to the `n` on reviews).
- **Optional string fields can be missing entirely**, not `null` — notably `best`, `diff`, `dur`, `budget` on destinations. Use `??` / optional chaining, never `dest.best.length`.
- **Public reads strip `createdAt` / `updatedAt`.** You get `ts` instead. The admin API returns all three.
- **Lists are capped at 500** for reviews and questions, with no paging and no `total`. Companies and destinations are uncapped but also unpaged.
- **Reviews are validated against the company list; questions are not.** A bad `c` on a review is a 400; on a question it silently creates an orphan.
- **The six form endpoints share one rate-limit budget** of 20 per IP per 10 minutes. Behind a corporate NAT or a shared office IP, unrelated visitors consume each other's allowance.
- **`phone` is length-capped but not format-checked.** Validate it client-side or you will collect junk.
- **Only destinations have a by-key read.** `GET /api/destinations/:slug` takes the slug, not an `_id`; nothing else fetches one record, and there is no search, filter or sort parameter on any read beyond `?c=`. Do that work in the client.
- **Company-to-destination coverage lives on the company**, in `places` — an array of destination slugs. There is no reverse pointer on the destination, which is why `/api/destinations/:slug` exists at all. `places` may be absent on older records; read it as `?? []`.
- **A destination's cover image is optional.** `img` is `""` or missing for most records; always keep the `c1`/`c2` gradient behind it.
- **A package's `c` and `d` always resolve.** Both are validated when the package is written and a package cannot be published while either is unresolvable, so `GET /packages?d=<slug>` is a complete and correct answer to "what can I book here" — no client-side filtering is needed to make it safe.
- **`avail` is about booking, `status` is about listing.** Never hide a `soldout` package: travellers compare it and enquire about the next departure.
- **A package's two itinerary fields are independent.** `itinerary` (the day-by-day list) and `pdf` (the downloadable document) are set separately by an admin; show whichever arrived rather than treating one as a fallback for the other.
- **Packages are capped at 200** per response, like reviews and questions. Narrow with the filters rather than paging — there is no paging.
- **No personalisation exists.** `/api/members` stores a name and email; nothing reads it back.

---

## 9. Endpoint summary

| Method | Path | Auth | Limited | Returns in `data` |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | — | — | `{ ok, time }` |
| GET | `/api/companies` | — | — | Company array, score desc |
| GET | `/api/destinations` | — | — | Destination array, `n` desc, each with `id` |
| GET | `/api/destinations/:slug` | — | — | One destination + its covering `companies`, or 404 |
| GET | `/api/reviews?c=` | — | — | Approved review array, newest first, max 500 |
| GET | `/api/questions?c=` | — | — | Non-hidden question array, newest first, max 500 |
| GET | `/api/metrics` | — | — | Homepage hero metric array, `order` asc |
| GET | `/api/packages?d=&c=&minPrice=&maxPrice=&nights=&avail=` | — | — | Package array, cheapest first, max 200 |
| GET | `/api/packages/:id` | — | — | One package, or 404 |
| GET | `/api/content?group=` | — | — | Content lists grouped by `group` |
| GET | `/api/settings` | — | — | `{ key: value }`, always complete |
| POST | `/api/enquiries` | — | ✅ | `{ _id, status: "new" }` |
| POST | `/api/callbacks` | — | ✅ | `{ _id, status: "new" }` |
| POST | `/api/applications` | — | ✅ | `{ _id, status: "active" }` |
| POST | `/api/questions` | — | ✅ | `{ _id, status: "open" }` |
| POST | `/api/reviews` | — | ✅ | `{ _id, status: "pending" \| "approved" }` |
| POST | `/api/members` | — | ✅ | `{ _id, name, email }` — identity capture, **no token** |
| POST | `/api/auth/customer/register` | — | ✅ | `{ token, member }` |
| POST | `/api/auth/customer/login` | — | ✅ | `{ token, member }` — email, username or phone |
| GET | `/api/auth/customer/me` | 🔒 | — | `{ member }` |
| PATCH | `/api/auth/customer/me` | 🔒 | — | `{ member }` |
| POST | `/api/auth/customer/password` | 🔒 | — | `{ token, member }` |
| POST | `/api/bookings` | 🔒 | ✅ | The new booking, `status: "pending"` |
| GET | `/api/bookings?status=` | 🔒 | — | The caller's own bookings, newest first |
| GET | `/api/bookings/:id` | 🔒 | — | One of the caller's own, or 404 |

The five ✅ rows plus `/api/members` share a single 20-per-10-minutes-per-IP budget.
