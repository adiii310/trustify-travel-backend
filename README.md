# Trustify Trips — backend

Node.js + Express + MongoDB API that powers both portals:

| URL | What it is |
| --- | --- |
| `http://localhost:5000/` | Customer portal (`public/index.html`) |
| `http://localhost:5000/admin` | Admin portal (`public/admin/index.html`) |
| `http://localhost:5000/docs` | Full API reference for integrators |
| `http://localhost:5000/api/...` | REST API |

Both portals are single HTML files. They detect `window.TT_API = '/api'` (set at the top of each file here) and talk to this server. The same files opened anywhere else fall back to their built-in demo data.

## Setup

Requirements: Node.js 18+ and MongoDB 6+ (local, Docker, or MongoDB Atlas).

```bash
cp .env.example .env        # then edit MONGODB_URI, JWT_SECRET and the ADMIN_* values
npm install
npm run seed                # sample companies, destinations, reviews + your admin account
npm run dev                 # or: npm start
```

Sign in to `/admin` with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`. To change the password later, edit `.env` and run `npm run create-admin`.

Quick MongoDB with Docker: `docker run -d -p 27017:27017 --name mongo mongo:7`

## Project structure

`src/` is **ES modules** (`"type": "module"` in `package.json`) and runs straight from source — there is no build step and no transpiler. Relative imports therefore need their `.js` extension, and a directory import needs its `index.js` spelled out: `import M from './models/index.js'`, never `'./models'`. `__dirname` and `require.main` do not exist; `app.js` and `createAdmin.js` derive both from `import.meta.url`.

Each section of the app owns a folder under `src/modules/`, holding its model, controller and routes side by side. To change how reviews work, everything is in `src/modules/review/`.

```
src/
  server.js                      Boot: check env, connect Mongo, listen
  app.js                         Express app: security headers, API, static pages
  config/
    env.js                       Every environment variable, read once
    db.js                        Mongo connection
    cloudinary.js                Image hosting, configured only if CLOUDINARY_* is set
  utils/
    ApiResponse.js               The success envelope used by every endpoint
    ApiError.js                  The failure envelope, thrown from anywhere
    asyncHandler.js              Forwards async errors to the error middleware
    pick.js                      Whitelist body fields
  middlewares/
    auth.middleware.js           signToken + requireAdmin guard
    error.middleware.js          Turns any error into the ApiError envelope
    rateLimit.middleware.js      Login and form limiters
  routes/index.js                Where every module's routes are mounted
  modules/
    shared/
      crud.controller.js         list / getById / create / update / remove factory
      schema.helpers.js          Options and fields shared by all schemas
    company/
      company.model.js           Mongoose schema
      company.controller.js      Handlers (public + admin)
      company.route.js           publicRouter and adminRouter
    destination/  review/  question/  enquiry/  callback/  application/  member/
                                 ... same three files each
    upload/                      Cloudinary image uploads (admin only, multipart)
    admin/                       admin.model.js, auth.controller.js, auth.route.js
    dashboard/                   /api/admin/stats
    health/                      /api/health
  models/index.js                Barrel re-export, for scripts and the dashboard
  seed.js                        Sample data (`npm run seed -- --fresh` to reset)
  createAdmin.js                 Create or reset the admin account
public/
  index.html                     Customer portal
  admin/index.html               Admin portal
  docs/index.html                API reference served at /docs
```

### Adding a new section

1. Create `src/modules/<name>/` with `<name>.model.js`, `<name>.controller.js` and `<name>.route.js`.
2. In the controller, spread `crudController(Model, EDITABLE_FIELDS, labels)` for the admin handlers and add whatever public handlers the section needs.
3. Mount the routers in `src/routes/index.js`.

## Data model

| Collection | Key fields | Status values |
| --- | --- | --- |
| companies | `k` (short code), name, score, rating, price, city, exp, tags, `places` (destination slugs covered) | published, hidden |
| destinations | slug, name, region, n, rating, best, budget, c1/c2 colours, `img` cover photo | published, hidden |
| reviews | `c` (company code), n, r (1–5), trip, t | pending, approved, rejected |
| questions | `c`, n, q, a (answer) | open, answered, hidden |
| enquiries | name, phone, date, pax, company, pkg, notes | new, contacted, booked, closed |
| callbacks | name, phone, slot, notes | new, called, closed |
| applications | company, contact, email, phone, stage (0–7) | active, rejected, published |
| members | name, email (unique) | — |
| admins | name, email, passwordHash, role | — |

The short field names (`k`, `c`, `n`, `r`, `t`) match what the customer portal already uses, so no frontend rewrite was needed.

## API

Integration guides for frontend developers:

| Document | For |
| --- | --- |
| [`CUSTOMER_API.md`](CUSTOMER_API.md) | The public, unauthenticated endpoints the customer site uses |
| [`ADMIN_API.md`](ADMIN_API.md) | The token-protected admin endpoints, for the separate admin app |
| **`/docs`** | The same reference in the browser, with a live request runner |

### Response format

Every endpoint returns the same envelope, built by `ApiResponse` / `ApiError`:

```jsonc
// success
{ "success": true,  "statusCode": 200, "message": "Companies fetched successfully", "data": [ ... ] }

// failure — `message` is always safe to show a user,
// `errors` carries { field, message } when one field caused it
{ "success": false, "statusCode": 400, "message": "Name and email are required.", "errors": [] }
```

Read the payload from `data`; branch on `success` or the HTTP status, never on the body shape.

### Public (customer portal)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| GET | `/api/companies` | Published companies, highest trust score first |
| GET | `/api/destinations` | Published destinations |
| GET | `/api/destinations/:slug` | One destination plus the companies covering it; 404 if hidden or unknown |
| GET | `/api/reviews?c=H` | Approved reviews, optional company filter |
| GET | `/api/questions?c=H` | Visible questions with answers |
| POST | `/api/enquiries` | `{name, phone, date?, pax?, msg?, company?, ck?, pkg?}` |
| POST | `/api/callbacks` | `{name, phone, slot?}` |
| POST | `/api/applications` | `{company, contact, email, phone, city?, years?}` |
| POST | `/api/reviews` | `{c, n, r, t, trip?}` — goes to moderation unless `REVIEW_AUTO_APPROVE=true` |
| POST | `/api/questions` | `{c, n, q}` |
| POST | `/api/members` | `{name, email}` — creates or updates the traveller |

POST routes accept only the listed fields and are rate limited to 20 per IP every 10 minutes.

### Admin (requires `Authorization: Bearer <token>`)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/login` | `{email, password}` → `{token, admin}`; 10 tries per 15 min |
| GET | `/api/auth/me` | Current admin |
| GET | `/api/admin/stats` | Dashboard counts |
| GET | `/api/admin/:collection?status=&q=&page=&limit=` | List with filters and paging; `data` is `{items, total, page, limit, pages}` |
| GET | `/api/admin/:collection/:id` | One record |
| POST | `/api/admin/:collection` | Create |
| PATCH | `/api/admin/:collection/:id` | Update (only editable fields) |
| DELETE | `/api/admin/:collection/:id` | Delete |
| POST | `/api/admin/applications/:id/publish` | `{k, score, price?, dests?, since?, tags?}` — turns an applicant at stage 7 into a live company |
| POST | `/api/admin/uploads/image` | `multipart/form-data` with one `image` part → `{url, publicId, …}`. 503 when `CLOUDINARY_*` is unset |
| POST | `/api/admin/uploads/destroy` | `{publicId}` — removes a hosted image |

`:collection` is one of companies, destinations, reviews, questions, enquiries, callbacks, applications, members, metrics. Each has its own route file under `src/modules/`; they share handlers through `crudController`, so they behave identically. `/api/admin/uploads/*` is not a collection — it has no list, no ids and writes no record.

Status codes: 400 validation, 401 auth, 404 missing, 409 duplicate, 429 rate limited.

## Deploying

- Set `NODE_ENV=production`, a strong `JWT_SECRET`, and an Atlas `MONGODB_URI`.
- Change the admin password from the example value before going live.
- If you host the portals on a different domain from the API, list that domain in `CORS_ORIGINS` and set `window.TT_API` in each HTML file to the full API URL (for example `https://api.trustifytrips.in/api`).
- Replace the placeholder WhatsApp number `919999999999` in `public/index.html`.
- Destination cover images need `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`. All three or none: with them unset the upload endpoint answers 503 and every other route is unaffected, because a cover photo is optional throughout the stack.
