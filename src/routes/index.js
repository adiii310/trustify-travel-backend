/**
 * The whole API surface in one place. Mounted at /api by src/app.js.
 *
 * Each section owns its own route file; this file only decides where it hangs.
 *   public  -> /api/<section>
 *   admin   -> /api/admin/<section>   (every route behind requireAdmin)
 */
const { Router } = require('express');

const healthRoutes = require('../modules/health/health.route');
const authRoutes = require('../modules/admin/auth.route');
const dashboardRoutes = require('../modules/dashboard/dashboard.route');

const company = require('../modules/company/company.route');
const destination = require('../modules/destination/destination.route');
const review = require('../modules/review/review.route');
const question = require('../modules/question/question.route');
const enquiry = require('../modules/enquiry/enquiry.route');
const callback = require('../modules/callback/callback.route');
const application = require('../modules/application/application.route');
const member = require('../modules/member/member.route');
const metric = require('../modules/metric/metric.route');

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

module.exports = router;
