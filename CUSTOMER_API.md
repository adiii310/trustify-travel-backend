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
  reviews:      (c)  => request('GET', c ? `/reviews?c=${encodeURIComponent(c)}` : '/reviews'),
  questions:    (c)  => request('GET', c ? `/questions?c=${encodeURIComponent(c)}` : '/questions'),

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
    "status": "published",
    "ts": 1791455437171                     // created, epoch ms
  }
]
```

`price` and `reviews` are display figures stored on the company record — `reviews` is **not** a live count of the `reviews` collection.

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
    "status": "published",
    "ts": 1791455437198
  }
]
```

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

## 6. Common workflows

### Load everything a homepage needs

```js
const [companies, destinations, reviews] = await Promise.all([
  api.companies(),
  api.destinations(),
  api.reviews(),           // latest approved reviews across all companies
]);
```

Three independent requests, no auth, no sequencing — fire them in parallel.

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

## 7. Gotchas

- **`ts` is epoch milliseconds**, not an ISO string. `new Date(record.ts)` works directly. The only ISO timestamp in the public API is `time` from `/health`.
- **Short field names are intentional** and match the existing site: `k` = company code, `c` = company code on a review/question, `n` = person's name, `r` = rating, `t` = review text, `q`/`a` = question/answer, `d` = display date, `n` on a *destination* = company count (a number, unrelated to the `n` on reviews).
- **Optional string fields can be missing entirely**, not `null` — notably `best`, `diff`, `dur`, `budget` on destinations. Use `??` / optional chaining, never `dest.best.length`.
- **Public reads strip `createdAt` / `updatedAt`.** You get `ts` instead. The admin API returns all three.
- **Lists are capped at 500** for reviews and questions, with no paging and no `total`. Companies and destinations are uncapped but also unpaged.
- **Reviews are validated against the company list; questions are not.** A bad `c` on a review is a 400; on a question it silently creates an orphan.
- **The six form endpoints share one rate-limit budget** of 20 per IP per 10 minutes. Behind a corporate NAT or a shared office IP, unrelated visitors consume each other's allowance.
- **`phone` is length-capped but not format-checked.** Validate it client-side or you will collect junk.
- **No endpoint returns a single record by id**, and there is no search, filter or sort parameter on any read beyond `?c=`. Do that work in the client.
- **No personalisation exists.** `/api/members` stores a name and email; nothing reads it back.

---

## 8. Endpoint summary

| Method | Path | Auth | Limited | Returns in `data` |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | — | — | `{ ok, time }` |
| GET | `/api/companies` | — | — | Company array, score desc |
| GET | `/api/destinations` | — | — | Destination array, `n` desc, each with `id` |
| GET | `/api/reviews?c=` | — | — | Approved review array, newest first, max 500 |
| GET | `/api/questions?c=` | — | — | Non-hidden question array, newest first, max 500 |
| POST | `/api/enquiries` | — | ✅ | `{ _id, status: "new" }` |
| POST | `/api/callbacks` | — | ✅ | `{ _id, status: "new" }` |
| POST | `/api/applications` | — | ✅ | `{ _id, status: "active" }` |
| POST | `/api/questions` | — | ✅ | `{ _id, status: "open" }` |
| POST | `/api/reviews` | — | ✅ | `{ _id, status: "pending" \| "approved" }` |
| POST | `/api/members` | — | ✅ | `{ _id, name, email }` |

The five ✅ rows plus `/api/members` share a single 20-per-10-minutes-per-IP budget.
