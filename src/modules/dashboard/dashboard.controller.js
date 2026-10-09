const M = require('../../models');
const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');

/** GET /api/admin/stats — the counters on the admin dashboard. */
const stats = asyncHandler(async (req, res) => {
  const [pendingReviews, openQuestions, newEnquiries, newCallbacks, pipeline, liveCompanies, members] =
    await Promise.all([
      M.Review.countDocuments({ status: 'pending' }),
      M.Question.countDocuments({ status: 'open' }),
      M.Enquiry.countDocuments({ status: 'new' }),
      M.Callback.countDocuments({ status: 'new' }),
      M.Application.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$stage', n: { $sum: 1 } } },
      ]),
      M.Company.countDocuments({ status: 'published' }),
      M.Member.countDocuments(),
    ]);

  ApiResponse.ok(
    res,
    {
      pendingReviews,
      openQuestions,
      newLeads: newEnquiries + newCallbacks,
      pipeline, // active applications grouped by verification stage
      liveCompanies,
      members,
    },
    'Stats fetched successfully',
  );
});

module.exports = { stats };
