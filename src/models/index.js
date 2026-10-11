/**
 * Convenience barrel for scripts and the dashboard, which need several models at
 * once. Each schema is defined in its own module:
 *
 *   src/modules/<name>/<name>.model.js
 */
import Company from '../modules/company/company.model.js';
import Destination from '../modules/destination/destination.model.js';
import Review from '../modules/review/review.model.js';
import Question from '../modules/question/question.model.js';
import Enquiry from '../modules/enquiry/enquiry.model.js';
import Callback from '../modules/callback/callback.model.js';
import Application from '../modules/application/application.model.js';
import Member from '../modules/member/member.model.js';
import Metric from '../modules/metric/metric.model.js';
import Package from '../modules/package/package.model.js';
import Content from '../modules/content/content.model.js';
import Setting from '../modules/setting/setting.model.js';
import Booking from '../modules/booking/booking.model.js';
import Admin from '../modules/admin/admin.model.js';

export {
  Company,
  Destination,
  Review,
  Question,
  Enquiry,
  Callback,
  Application,
  Member,
  Metric,
  Package,
  Content,
  Setting,
  Booking,
  Admin,
};

export default {
  Company,
  Destination,
  Review,
  Question,
  Enquiry,
  Callback,
  Application,
  Member,
  Metric,
  Package,
  Content,
  Setting,
  Booking,
  Admin,
};
