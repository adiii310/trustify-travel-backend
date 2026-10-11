// Loads the sample companies, destinations, reviews and homepage metrics shown
// on the original site.
// Usage: npm run seed            (only fills empty collections)
//        npm run seed -- --fresh (wipes content collections first)
//
// Nothing is seeded as `featured`: with no featured records the homepage falls
// back to its original top-by-score / top-by-coverage ordering, so a fresh
// install looks exactly as it did before curation existed.
import mongoose from 'mongoose';
import env from './config/env.js';
import connectDB from './config/db.js';
import M from './models/index.js';
import ensureAdmin from './createAdmin.js';
import { SETTING_DEFAULTS } from './modules/setting/setting.model.js';

const TRUST_PARAMETERS = [
  'Itinerary Quality', 'Accommodation', 'Transport', 'Pricing Transparency', 'Customer Support',
  'Safety', 'Meals', 'Tour Management', 'Value For Money',
];

// `places` is the destination-slug list each company actually runs trips to —
// it is what GET /api/destinations/:slug filters on, so the detail pages are
// empty without it. `dests` beside it stays the headline display figure.
const companies = [
  ['H', 'Holiday Heaven', 96, 4.8, 24, 'Jan 2023', 'Dehradun, Uttarakhand', 8, 10499, 2340, ['Custom Itineraries', '24x7 Support', 'Great Hotels', 'On-time Service'], ['kedarnath', 'leh-ladakh', 'spiti-valley', 'kashmir'],
    'A Dehradun based operator specialising in Himalayan pilgrimage and adventure circuits. Known for transparent pricing, well planned itineraries and round-the-clock trip managers.',
    [-4, -6, -8, -1, 0, 0, -16, -5, -7]],
  ['W', 'Wander India', 94, 4.7, 18, 'Mar 2023', 'Haridwar, Uttarakhand', 6, 9499, 1786, ['Well Planned', 'Good Food', 'Clean Vehicles', 'Supportive Staff'], ['kedarnath', 'kashmir', 'kerala', 'thailand'],
    'Haridwar based team running small-group yatras and weekend Himalayan escapes. Strong on food quality and vehicle hygiene, with a dedicated on-ground coordinator per batch.',
    [-2, -5, -4, -3, -2, -1, 2, -6, 1]],
  ['M', 'Mountain Miles', 93, 4.6, 26, 'Feb 2023', 'Rishikesh, Uttarakhand', 7, 9999, 1452, ['Experienced Team', 'Good Stays', 'Safe Travel', 'Value for Money'], ['kedarnath', 'spiti-valley', 'leh-ladakh', 'vietnam'],
    'Rishikesh based adventure specialist with certified trek leaders and a documented safety protocol for every high-altitude route they operate.',
    [1, -4, 0, -6, -3, 4, -9, 2, 3]],
  ['D', 'Dream Trails', 92, 4.6, 26, 'Apr 2023', 'Dehradun, Uttarakhand', 5, 11499, 980, ['Scenic Routes', 'Small Groups', 'Local Guides'], ['kerala', 'bali', 'thailand', 'kashmir'],
    'Dehradun based operator focused on small-group departures and scenic road circuits, with local guides on every route and a fixed no-shopping-stop policy.',
    [-3, -2, -5, 0, -4, 1, -8, -1, 2]],
].map(([k, name, score, rating, dests, since, city, exp, price, reviews, tags, places, about, offsets]) => ({
  k, name, score, rating, dests, since, city, exp, price, reviews, tags, places, about,
  // Per-parameter scores spread around the headline figure. Real stored values,
  // not something the frontend derives — it has no basis to derive them from.
  breakdown: TRUST_PARAMETERS.map((label, i) => ({
    label,
    score: Math.max(60, Math.min(99, score + (offsets[i] ?? 0))),
  })),
  docs: ['GST Certificate', 'Company Registration', 'Tourism License', 'Insurance Policy'],
  policies: [
    { label: 'Cancellation', value: 'Free up to 15 days before departure' },
    { label: 'Refunds', value: 'Processed within 7 working days' },
    { label: 'Payment', value: '25% to book, balance before departure' },
    { label: 'Reschedule', value: 'One free date change up to 10 days prior' },
  ],
}));

const destinations = [
  ['Kedarnath', 32, 4.7, '#8a6a52', '#2b4463', 'Uttarakhand, India', 'May – Oct', 'Moderate', '3 – 5 Days', '₹9,000 – ₹18,000',
    'One of the twelve Jyotirlingas, set at 3,583 m in the Garhwal Himalayas. Reached by a 16 km trek from Gaurikund or by helicopter from Phata and Sersi.',
    ['Kedarnath Temple', 'Vasuki Tal', 'Bhairavnath Temple', 'Gaurikund trek']],
  ['Leh Ladakh', 28, 4.8, '#7d8fa8', '#28405f', 'Ladakh, India', 'Jun – Sep', 'Challenging', '6 – 9 Days', '₹22,000 – ₹45,000',
    'High-altitude desert of monasteries, cobalt lakes and mountain passes. Pangong Tso, Nubra Valley and Khardung La define the classic circuit.',
    ['Pangong Tso', 'Nubra Valley', 'Khardung La', 'Thiksey Monastery']],
  ['Spiti Valley', 18, 4.6, '#a7855f', '#2c4665', 'Himachal Pradesh, India', 'May – Oct', 'Challenging', '7 – 9 Days', '₹18,000 – ₹32,000',
    'A cold desert valley of thousand-year-old monasteries, fossil villages and some of the darkest night skies in India.',
    ['Key Monastery', 'Chandratal Lake', 'Langza', 'Pin Valley']],
  ['Kashmir', 26, 4.7, '#6f9ac0', '#1f3f66', 'Jammu & Kashmir, India', 'Mar – Oct', 'Easy', '5 – 7 Days', '₹16,000 – ₹30,000',
    'Shikara rides on Dal Lake, meadows at Gulmarg and Pahalgam, and the Mughal gardens of Srinagar.',
    ['Dal Lake', 'Gulmarg Gondola', 'Betaab Valley', 'Sonmarg']],
  ['Kerala', 22, 4.6, '#2f9c8a', '#14506a', 'Kerala, India', 'Sep – Mar', 'Easy', '5 – 7 Days', '₹14,000 – ₹26,000',
    'Backwater houseboats in Alleppey, tea estates at Munnar and the beaches of Varkala and Kovalam.',
    ['Alleppey houseboat', 'Munnar tea estates', 'Thekkady', 'Varkala']],
  ['Thailand', 15, 4.5, '#a56cb0', '#2a2f6b', 'Southeast Asia', 'Nov – Mar', 'Easy', '5 – 8 Days', '₹38,000 – ₹70,000',
    'Bangkok temples and markets paired with island time in Phuket, Krabi and Phi Phi.',
    ['Grand Palace', 'Phi Phi Islands', 'Krabi', 'Chiang Mai']],
  ['Vietnam', 14, 4.5, '#5aa68f', '#1c4a5e', 'Southeast Asia', 'Oct – Apr', 'Easy', '6 – 9 Days', '₹45,000 – ₹80,000',
    'Limestone karsts of Ha Long Bay, the lantern streets of Hoi An and the energy of Ho Chi Minh City.',
    ['Ha Long Bay', 'Hoi An', 'Sapa', 'Cu Chi Tunnels']],
  ['Bali', 12, 4.5, '#c58a5a', '#294a6a', 'Indonesia', 'Apr – Oct', 'Easy', '5 – 8 Days', '₹55,000 – ₹95,000',
    'Rice terraces in Ubud, cliff temples at Uluwatu and the beach clubs of Seminyak and Canggu.',
    ['Ubud rice terraces', 'Uluwatu Temple', 'Nusa Penida', 'Mount Batur']],
].map(([name, n, rating, c1, c2, region, best, diff, dur, budget, desc, highlights]) => ({
  slug: name.toLowerCase().replace(/ /g, '-'),
  name, n, rating, c1, c2, region, best, diff, dur, budget, desc, highlights,
}));

// The homepage hero strip. Display text, not counts — see metric.model.js.
const metrics = [
  ['🏢', '450+', 'Verified Companies'],
  ['📍', '90+', 'Destinations'],
  ['💬', '50,000+', 'Verified Reviews'],
  ['🛡️', '9', 'Trust Parameters'],
].map(([icon, value, label], i) => ({ icon, value, label, order: i }));

// Site-wide content the customer pages render. It lives here rather than in the
// frontend because the frontend now shows nothing it was not given — an empty
// collection is an empty section on the site, not a cue to invent copy.
const content = [
  ...[
    ['✔', 'Verified & Tested'], ['👤', 'Background Checked'], ['📄', 'Transparent Pricing'],
    ['⚙', 'Service Tested'], ['🎧', 'Best Customer Support'],
  ].map(([icon, title], order) => ({ group: 'badge', icon, title, order })),

  ...[
    ['📝', 'Application', 'The company applies with its basic details.'],
    ['🪪', 'Document Verification', 'GST, registration and tourism licences are checked.'],
    ['🔍', 'Background Check', 'Owners, history and complaints are reviewed.'],
    ['📦', 'Package Analysis', 'Itineraries and pricing are checked for transparency.'],
    ['🕵️', 'Mystery Booking', 'Our team books and experiences a real trip.'],
    ['💬', 'Customer Feedback', 'Traveller reviews are verified and analysed.'],
    ['✅', 'Final Inspection', 'A final review of service quality and safety.'],
    ['🏅', 'Trust Score', 'A score out of 100 is published and re-evaluated regularly.'],
  ].map(([icon, title, body], order) => ({ group: 'step', icon, title, body, order })),

  ...[
    ['How to choose a trustworthy travel company', 'Check that the company shows a verified registration, a real office address and a clear cancellation policy. Compare itineraries line by line, not just the headline price.'],
    ['Kedarnath yatra checklist', 'Carry a rain jacket, warm layers, a valid photo ID, your yatra registration and any regular medicines. Book stays before the peak season from May to June.'],
    ['How the Trust Score works', 'Each company is scored out of 100 across 9 parameters, including itinerary quality, safety, transparency and support, after documents, mystery bookings and customer feedback are checked.'],
    ['Spotting hidden charges', 'Ask what is not included: entry fees, permits, heater or oxygen charges, and pony or helicopter costs. A trustworthy company lists inclusions and exclusions in writing.'],
    ['Best time to visit popular destinations', 'Kedarnath and Spiti are best from May to October, Leh Ladakh from June to September, Kerala from September to March and Bali from April to October.'],
    ['Travel safety basics', "Share your itinerary with family, keep digital copies of documents, buy travel insurance and confirm the operator's emergency contact before you leave."],
  ].map(([title, body], order) => ({ group: 'resource', title, body, order })),

  ...TRUST_PARAMETERS.map((title, order) => ({ group: 'parameter', title, order })),

  ...[
    'Pilgrimage', 'Trekking', 'Photography', 'Food', 'Wildlife',
    'Beaches', 'Heritage', 'Adventure sports', 'Offbeat stays', 'Shopping',
  ].map((title, order) => ({ group: 'interest', title, order })),
];

// Three tiers per company/destination pair, mirroring what the site used to
// generate client-side — only now it is stored, editable and really priced.
const PACKAGE_TIERS = [
  {
    suffix: 'Explorer', nights: 3, days: 4, mult: 1,
    inclusions: ['Airport / station pickup and drop', 'Hotels and camps on twin sharing', 'Breakfast and dinner', 'Registered local guide', 'All transfers in a private vehicle'],
  },
  {
    suffix: 'Classic', nights: 4, days: 5, mult: 1.4,
    inclusions: ['Everything in the Explorer package', 'One extra night at a premium stay', 'All meals through the trip', 'Dedicated trip manager', 'Sightseeing entry tickets'],
  },
  {
    suffix: 'Premium', nights: 5, days: 6, mult: 2.1,
    inclusions: ['Everything in the Classic package', '4-star stays throughout', 'Private cab at your disposal', 'Priority / VIP access where available', '24x7 on-call trip manager'],
  },
];

const PACKAGE_EXCLUSIONS = [
  'Flights and train fare to the base city', 'Travel insurance',
  'Personal expenses, tips and laundry', 'Anything not listed under inclusions',
];

/** Rough cost index per destination, applied to the company's base price. */
const DEST_INDEX = {
  kedarnath: 1, 'leh-ladakh': 2.3, 'spiti-valley': 1.9, kashmir: 1.7,
  kerala: 1.5, meghalaya: 1.8, rajasthan: 1.6, thailand: 3.4, vietnam: 4.2, bali: 5.1,
};

const buildPackages = () => companies.flatMap((company) =>
  company.places.flatMap((slug) => {
    const dest = destinations.find((d) => d.slug === slug);
    if (!dest) return [];

    return PACKAGE_TIERS.map((tier) => ({
      c: company.k,
      d: slug,
      title: `${tier.nights}N/${tier.days}D ${dest.name} ${tier.suffix}`,
      nights: tier.nights,
      days: tier.days,
      price: Math.round((company.price * (DEST_INDEX[slug] ?? 1) * tier.mult) / 100) * 100 - 1,
      inclusions: tier.inclusions,
      exclusions: PACKAGE_EXCLUSIONS,
      itinerary: [
        { day: 1, title: `Arrival in ${dest.name}`, detail: 'Pickup from the arrival point, transfer to the hotel, briefing with your trip manager and an easy evening to settle in.' },
        ...Array.from({ length: Math.max(tier.days - 2, 0) }, (_, i) => {
          const spot = dest.highlights[i % Math.max(dest.highlights.length, 1)];
          return {
            day: i + 2,
            title: spot ? `${spot} day` : `Exploring ${dest.name}`,
            detail: spot
              ? `After breakfast, head out to ${spot} with your guide. Free time in the afternoon, dinner back at the stay.`
              : 'A full day of guided sightseeing with time to explore on your own.',
          };
        }),
        { day: tier.days, title: 'Departure', detail: 'Breakfast, checkout and transfer to your departure point.' },
      ],
    }));
  }));

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
  await fill(M.Content, content, fresh);
  // Built from the seeded companies and destinations, so it has to run after them.
  await fill(M.Package, buildPackages(), fresh);
  await fill(M.Setting, SETTING_DEFAULTS, fresh);
  await ensureAdmin();
})()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
