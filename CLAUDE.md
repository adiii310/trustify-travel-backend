# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev            # nodemon on src/server.js (port 5000 by default)
npm start              # plain node
npm run seed           # sample data + admin account; `npm run seed -- --fresh` wipes content collections first
npm run create-admin   # create or reset the admin from ADMIN_* in .env
```

There is no test suite, linter, or build step — `src/` runs directly as **ES modules** (`"type": "module"`). Verify changes by hitting the API (`/docs` serves a reference page with a live request runner) or the portals at `/` and `/admin`.

Three ESM consequences that bite, since nothing here transpiles:

- **Relative imports need their `.js` extension**, and a directory needs its `index.js` spelled out — `'./models/index.js'`, never `'./models'`. Node throws `ERR_MODULE_NOT_FOUND` at boot, not at the call site.
- **No `__dirname`, no `require.main`.** [app.js](src/app.js) derives the public directory from `import.meta.url`; [createAdmin.js](src/createAdmin.js) compares it against `process.argv[1]` to tell "run directly" from "imported by seed.js".
- **Default vs named exports are not interchangeable.** Controllers default-export one object (`import controller from './x.controller.js'`); route files named-export `publicRouter` / `adminRouter`, which is why [routes/index.js](src/routes/index.js) imports them as namespaces (`import * as company`).

Requires a running MongoDB and a `.env` (copy `.env.example`). Boot fails fast if `MONGODB_URI` or `JWT_SECRET` is missing.

## Architecture

Express + Mongoose API that also serves three static HTML portals from [public/](public/). One Node process does everything; there is no frontend build.

### Module layout

Every section of the app is a folder under [src/modules/](src/modules/) holding `<name>.model.js`, `<name>.controller.js`, `<name>.route.js` side by side. Sections: company, destination, review, question, enquiry, callback, application, member, metric, plus admin (auth), dashboard, health and upload.

Each route file exports **two routers** — `publicRouter` (mounted at `/api/<section>`) and `adminRouter` (mounted at `/api/admin/<section>`, with `adminRouter.use(requireAdmin)` as its first line). The exception is [upload](src/modules/upload/), which exports only an `adminRouter`: travellers never upload anything, and an unauthenticated image sink is storage anyone can fill. [src/routes/index.js](src/routes/index.js) is the only place that decides where they hang; it is the complete API surface in one file.

[src/models/index.js](src/models/index.js) is a barrel re-export used only by `seed.js`, `createAdmin.js` and the dashboard — modules import sibling models by path directly.

### The three invariants

1. **Envelopes.** Controllers never call `res.json()`. Success goes through [ApiResponse](src/utils/ApiResponse.js) (`ApiResponse.ok` / `.created`), failure by throwing an [ApiError](src/utils/ApiError.js) (`ApiError.badRequest`, `.notFound`, `.conflict`, …). Every handler is wrapped in [asyncHandler](src/utils/asyncHandler.js) so throws reach [error.middleware.js](src/middlewares/error.middleware.js), which also translates Mongoose `ValidationError`/`CastError`/duplicate-key `11000` and body-parser failures into the same shape. Unexpected errors are logged in full and returned as a generic 500.

2. **Field whitelists.** Each controller declares `EDITABLE_FIELDS` (what an admin may set) and, where a public write exists, a narrower `SUBMIT_FIELDS` that deliberately omits `status`/`stage`. Both are applied with [pick](src/utils/pick.js). Nothing else from the body is ever persisted, so `_id`, `ts` and `createdAt` can't be set by a client.

3. **Shared CRUD.** [crud.controller.js](src/modules/shared/crud.controller.js) is a factory returning `list / getById / create / update / remove`; controllers spread it and add their own public handlers:

   ```js
   export default { ...crudController(Review, EDITABLE_FIELDS, { one: 'Review', many: 'Reviews' }), listApproved, submit, EDITABLE_FIELDS };
   ```

   `list` handles `?status=`, `?q=`, `?page=`, `?limit=` and returns `{items, total, page, limit, pages}`. Its search only probes fields whose schema path is a `String` — a regex against a numeric path would 400 the whole query.

### Schema conventions

[schema.helpers.js](src/modules/shared/schema.helpers.js) supplies `baseOptions` (`timestamps`, no `__v`), `tsField` (indexed epoch-ms, what every list sorts on — distinct from Mongoose's `createdAt`), `visibilityField` (published/hidden), and `PUBLIC_EXCLUDE` (`-createdAt -updatedAt`, applied via `.select()` on every public read). New models should use all of them.

Customer-facing collections use deliberately short field names (`k` company code, `c` company ref, `n` name/count, `r` rating, `t` text) because the portal HTML was written against them first. Keep them.

### Auth

JWT bearer only, admin-side. [auth.middleware.js](src/middlewares/auth.middleware.js) verifies the token and re-fetches the Admin on every request, setting `req.admin`. There is no customer auth: `POST /api/members` is an idempotent upsert on email that captures identity and issues nothing.

### Flows worth knowing

- **Review moderation** — `POST /api/reviews` validates the company code exists, then lands `pending` unless `REVIEW_AUTO_APPROVE=true`.
- **Application → company** — an applicant walks stages 0–7 (`Application.FINAL_STAGE`); `POST /api/admin/applications/:id/publish` refuses below the final stage, creates a `Company` from the application plus publish-time fields, and back-links `companyId`.
- **Company → destination** — a company lists the destination slugs it sells in `company.places`, and nothing on the destination points back. `GET /api/destinations/:slug` is the only public read that joins two collections, and it exists for exactly this reason. `company.dests` beside it is a headline *number* an admin types in; nothing keeps the two in step, so never derive one from the other.
- **Cover images** — `POST /api/admin/uploads/image` is the only multipart endpoint in the API. It streams one file to Cloudinary and returns `{url, publicId}`; it writes no record, so the caller PATCHes those onto `destination.img` / `imgId` itself. With the `CLOUDINARY_*` variables unset it answers 503 and nothing else changes — a cover photo is optional everywhere, so an unconfigured server is a working server.

### Portals

[public/index.html](public/index.html), [public/admin/index.html](public/admin/index.html) and [public/docs/index.html](public/docs/index.html) are each one self-contained file with inline scripts (hence the `'unsafe-inline'` CSP allowance in [app.js](src/app.js)). They read `window.TT_API` — set to `/api` near the top of each file — and fall back to built-in demo data when that is absent. Hosting the portals on another origin means setting `CORS_ORIGINS` *and* editing `window.TT_API` in each file.

The catch-all `app.get('*')` serves the customer portal, so an unmatched `/api/...` path must be caught by `notFound` first — it is mounted directly after the API routes.

### Adding a section

Create the three files, spread `crudController` in the controller, mount both routers in [src/routes/index.js](src/routes/index.js) (as a namespace import), add the model to [src/models/index.js](src/models/index.js) if a script or the dashboard needs it, and document it in `CUSTOMER_API.md` / `ADMIN_API.md` / `public/docs/index.html`. Each of those three has a counterpart checked into a frontend repo — see the root `CLAUDE.md`.

## Rate limiting

[rateLimit.middleware.js](src/middlewares/rateLimit.middleware.js): `loginLimiter` (10 per 15 min) on login, `formLimiter` (20 per 10 min, counted across *all* public forms per IP) on every public POST. Apply `formLimiter` to any new public write.

## Configuration

Nothing outside [src/config/env.js](src/config/env.js) reads `process.env`. Add new variables there, to `.env.example`, and to `assertRequired` if boot depends on them.

`CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` are deliberately **not** in `assertRequired`: all three or none, and none is a valid configuration. `env.hasCloudinary` is the flag callers check, and [config/cloudinary.js](src/config/cloudinary.js) only configures the SDK when it is true.
