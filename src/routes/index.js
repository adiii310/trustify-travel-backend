/**
 * The whole API surface in one place. Mounted at /api by src/app.js.
 *
 * Each section owns its own route file; this file only decides where it hangs.
 *   public  -> /api/<section>
 *   admin   -> /api/admin/<section>   (every route behind requireAdmin)
 *
 * Section route files export two routers rather than a default, so they are
 * imported as namespaces (`import * as company`).
 */
import { Router } from 'express';

import healthRoutes from '../modules/health/health.route.js';
import authRoutes from '../modules/admin/auth.route.js';
import dashboardRoutes from '../modules/dashboard/dashboard.route.js';

import * as company from '../modules/company/company.route.js';
import * as destination from '../modules/destination/destination.route.js';
import * as review from '../modules/review/review.route.js';
import * as question from '../modules/question/question.route.js';
import * as enquiry from '../modules/enquiry/enquiry.route.js';
import * as callback from '../modules/callback/callback.route.js';
import * as application from '../modules/application/application.route.js';
import * as member from '../modules/member/member.route.js';
import * as metric from '../modules/metric/metric.route.js';
import * as pkg from '../modules/package/package.route.js';
import * as content from '../modules/content/content.route.js';
import * as setting from '../modules/setting/setting.route.js';
import * as booking from '../modules/booking/booking.route.js';
import * as upload from '../modules/upload/upload.route.js';

const router = Router();

// --- open ------------------------------------------------------------------
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);

// --- customer portal -------------------------------------------------------
router.use('/companies', company.publicRouter);
router.use('/destinations', destination.publicRouter);
router.use('/reviews', review.publicRouter);
router.use('/questions', question.publicRouter);
router.use('/enquiries', enquiry.publicRouter);
router.use('/callbacks', callback.publicRouter);
router.use('/applications', application.publicRouter);
router.use('/members', member.publicRouter);
router.use('/metrics', metric.publicRouter);
router.use('/packages', pkg.publicRouter);
router.use('/content', content.publicRouter);
router.use('/settings', setting.publicRouter);
// Customer-owned, so guarded by requireCustomer inside its own router.
router.use('/bookings', booking.publicRouter);

// --- admin portal ----------------------------------------------------------
router.use('/admin', dashboardRoutes); // /admin/stats
router.use('/admin/companies', company.adminRouter);
router.use('/admin/destinations', destination.adminRouter);
router.use('/admin/reviews', review.adminRouter);
router.use('/admin/questions', question.adminRouter);
router.use('/admin/enquiries', enquiry.adminRouter);
router.use('/admin/callbacks', callback.adminRouter);
router.use('/admin/applications', application.adminRouter);
router.use('/admin/members', member.adminRouter);
// Note: /admin/metrics is the editable homepage strip; /admin/stats above is
// the dashboard's computed counters. Different things, deliberately different names.
router.use('/admin/metrics', metric.adminRouter);
router.use('/admin/packages', pkg.adminRouter);
router.use('/admin/content', content.adminRouter);
router.use('/admin/settings', setting.adminRouter);
router.use('/admin/bookings', booking.adminRouter);
// Image uploads for destination cover art. Admin-only, and the only multipart
// endpoint in the API — everything else is JSON.
router.use('/admin/uploads', upload.adminRouter);

export default router;
