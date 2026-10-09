// Loads the sample companies, destinations, reviews and homepage metrics shown
// on the original site.
// Usage: npm run seed            (only fills empty collections)
//        npm run seed -- --fresh (wipes content collections first)
//
// Nothing is seeded as `featured`: with no featured records the homepage falls
// back to its original top-by-score / top-by-coverage ordering, so a fresh
// install looks exactly as it did before curation existed.
const mongoose = require('mongoose');
const env = require('./config/env');
const connectDB = require('./config/db');
const M = require('./models');
const ensureAdmin = require('./createAdmin');

const companies = [
  ['H', 'Holiday Heaven', 96, 4.8, 24, 'Jan 2023', 'Dehradun, Uttarakhand', 8, 10499, 2340, ['Custom Itineraries', '24x7 Support', 'Great Hotels', 'On-time Service']],
  ['W', 'Wander India', 94, 4.7, 18, 'Mar 2023', 'Haridwar, Uttarakhand', 6, 9499, 1786, ['Well Planned', 'Good Food', 'Clean Vehicles', 'Supportive Staff']],
  ['M', 'Mountain Miles', 93, 4.6, 26, 'Feb 2023', 'Rishikesh, Uttarakhand', 7, 9999, 1452, ['Experienced Team', 'Good Stays', 'Safe Travel', 'Value for Money']],
  ['D', 'Dream Trails', 92, 4.6, 26, 'Apr 2023', 'Dehradun, Uttarakhand', 5, 11499, 980, ['Scenic Routes', 'Small Groups', 'Local Guides']],
].map(([k, name, score, rating, dests, since, city, exp, price, reviews, tags]) =>
  ({ k, name, score, rating, dests, since, city, exp, price, reviews, tags }));

const destinations = [
  ['Kedarnath', 32, 4.7, '#8a6a52', '#2b4463'], ['Leh Ladakh', 28, 4.8, '#7d8fa8', '#28405f'],
  ['Spiti Valley', 18, 4.6, '#a7855f', '#2c4665'], ['Kashmir', 26, 4.7, '#6f9ac0', '#1f3f66'],
  ['Kerala', 22, 4.6, '#2f9c8a', '#14506a'], ['Thailand', 15, 4.5, '#a56cb0', '#2a2f6b'],
  ['Vietnam', 14, 4.5, '#5aa68f', '#1c4a5e'], ['Bali', 12, 4.5, '#c58a5a', '#294a6a'],
].map(([name, n, rating, c1, c2]) => ({
  slug: name.toLowerCase().replace(/ /g, '-'), name, n, rating, c1, c2,
  region: 'India', desc: `Verified travel companies for ${name}.`,
}));

// The homepage hero strip. Display text, not counts — see metric.model.js.
const metrics = [
  ['🏢', '450+', 'Verified Companies'],
  ['📍', '90+', 'Destinations'],
  ['💬', '50,000+', 'Verified Reviews'],
  ['🛡️', '9', 'Trust Parameters'],
].map(([icon, value, label], i) => ({ icon, value, label, order: i }));

const reviews = [
  ['H', 'Aarav S.', 5, '3N/4D Kedarnath', 'Well planned trip. Hotels matched the itinerary exactly and the guide was very helpful.'],
  ['H', 'Neha P.', 5, '3N/4D Kedarnath', 'Transparent pricing with no hidden charges. Support replied on WhatsApp at midnight.'],
  ['W', 'Rohit M.', 4, '4N/5D Kedarnath + Badrinath', 'Good stays and food. Pickup was 30 minutes late but they kept us informed.'],
  ['M', 'Kavya R.', 5, '3N/4D Kedarnath', 'Safe, well-managed trip for my parents. Would book again.'],
].map(([c, n, r, trip, t]) => ({ c, n, r, trip, t, d: 'Sep 2024', status: 'approved' }));

async function fill(Model, docs, fresh) {
  if (fresh) await Model.deleteMany({});
  if (await Model.estimatedDocumentCount()) return console.log(`${Model.modelName}: already has data, skipped`);
  await Model.insertMany(docs);
  console.log(`${Model.modelName}: added ${docs.length}`);
}

(async () => {
  const fresh = process.argv.includes('--fresh');
  await connectDB(env.MONGODB_URI);
  await fill(M.Company, companies, fresh);
  await fill(M.Destination, destinations, fresh);
  await fill(M.Review, reviews, fresh);
  await fill(M.Metric, metrics, fresh);
  await ensureAdmin();
})()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
