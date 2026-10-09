/**
 * Convenience barrel for scripts and the dashboard, which need several models at
 * once. Each schema is defined in its own module:
 *
 *   src/modules/<name>/<name>.model.js
 */
module.exports = {
  Company: require('../modules/company/company.model'),
  Destination: require('../modules/destination/destination.model'),
  Review: require('../modules/review/review.model'),
  Question: require('../modules/question/question.model'),
  Enquiry: require('../modules/enquiry/enquiry.model'),
  Callback: require('../modules/callback/callback.model'),
  Application: require('../modules/application/application.model'),
  Member: require('../modules/member/member.model'),
  Admin: require('../modules/admin/admin.model'),
};
