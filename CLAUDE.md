# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev            # nodemon on src/server.js (port 5000 by default)
npm start              # plain node
npm run seed           # sample data + admin account; `npm run seed -- --fresh` wipes content collections first
npm run create-admin   # create or reset the admin from ADMIN_* in .env
```

There is no test suite, linter, or build step — `src/` runs directly as CommonJS. Verify changes by hitting the API (`/docs` serves a reference page with a live request runner) or the portals at `/` and `/admin`.

Requires a running MongoDB and a `.env` (copy `.env.example`). Boot fails fast if `MONGODB_URI` or `JWT_SECRET` is missing.

## Architecture

Express + Mongoose API that also serves three static HTML portals from [public/](public/). One Node process does everything; there is no frontend build.

### Module layout

Every section of the app is a folder under [src/modules/](src/modules/) holding `<name>.model.js`, `<name>.controller.js`, `<name>.route.js` side by side. Sections: company, destination, review, question, enquiry, callback, application, member, plus admin (auth), dashboard, health.

Each route file exports **two routers** — `publicRouter` (mounted at `/api/<section>`) and `adminRouter` (mounted at `/api/admin/<section>`, with `adminRouter.use(requireAdmin)` as its first line). [src/routes/index.js](src/routes/index.js) is the only place that decides where they hang; it is the complete API surface in one file.

[src/models/index.js](src/models/index.js) is a barrel re-export used only by `seed.js`, `createAdmin.js` and the dashboard — modules import sibling models by path directly.

### The three invariants

1. **Envelopes.** Controllers never call `res.json()`. Success goes through [ApiResponse](src/utils/ApiResponse.js) (`ApiResponse.ok` / `.created`), failure by throwing an [ApiError](src/utils/ApiError.js) (`ApiError.badRequest`, `.notFound`, `.conflict`, …). Every handler is wrapped in [asyncHandler](src/utils/asyncHandler.js) so throws reach [error.middleware.js](src/middlewares/error.middleware.js), which also translates Mongoose `ValidationError`/`CastError`/duplicate-key `11000` and body-parser failures into the same shape. Unexpected errors are logged in full and returned as a generic 500.

2. **Field whitelists.** Each controller declares `EDITABLE_FIELDS` (what an admin may set) and, where a public write exists, a narrower `SUBMIT_FIELDS` that deliberately omits `status`/`stage`. Both are applied with [pick](src/utils/pick.js). Nothing else from the body is ever persisted, so `_id`, `ts` and `createdAt` can't be set by a client.

3. **Shared CRUD.** [crud.controller.js](src/modules/shared/crud.controller.js) is a factory returning `list / getById / create / update / remove`; controllers spread it and add their own public handlers:

   ```js
   module.exports = { ...crudController(Review, EDITABLE_FIELDS, { one: 'Review', many: 'Reviews' }), listApproved, submit, EDITABLE_FIELDS };
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

### Portals

[public/index.html](public/index.html), [public/admin/index.html](public/admin/index.html) and [public/docs/index.html](public/docs/index.html) are each one self-contained file with inline scripts (hence the `'unsafe-inline'` CSP allowance in [app.js](src/app.js)). They read `window.TT_API` — set to `/api` near the top of each file — and fall back to built-in demo data when that is absent. Hosting the portals on another origin means setting `CORS_ORIGINS` *and* editing `window.TT_API` in each file.

The catch-all `app.get('*')` serves the customer portal, so an unmatched `/api/...` path must be caught by `notFound` first — it is mounted directly after the API routes.

### Adding a section

Create the three files, spread `crudController` in the controller, mount both routers in [src/routes/index.js](src/routes/index.js), add the model to [src/models/index.js](src/models/index.js) if a script or the dashboard needs it, and document it in `CUSTOMER_API.md` / `ADMIN_API.md` / `public/docs/index.html`.

## Rate limiting

[rateLimit.middleware.js](src/middlewares/rateLimit.middleware.js): `loginLimiter` (10 per 15 min) on login, `formLimiter` (20 per 10 min, counted across *all* public forms per IP) on every public POST. Apply `formLimiter` to any new public write.

## Configuration

Nothing outside [src/config/env.js](src/config/env.js) reads `process.env`. Add new variables there, to `.env.example`, and to `assertRequired` if boot depends on them.
