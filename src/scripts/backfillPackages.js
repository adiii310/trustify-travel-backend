/**
 * Audits every package's company and destination references, and optionally
 * repairs what it can.
 *
 *   npm run backfill:packages           report only, changes nothing
 *   npm run backfill:packages -- --fix  apply the repairs described below
 *
 * **This script deletes nothing.** Referential validation on
 * `POST`/`PATCH /api/admin/packages` only arrived with this feature, so rows
 * written before it can carry a missing or unresolvable `c` / `d`. Those rows
 * are real work an admin entered; the safe repair is to take them off the
 * public site so a traveller cannot open a package whose company or
 * destination does not exist, and leave them in place to be fixed by hand.
 *
 * What `--fix` does:
 *
 *   - a **published** package whose `c` or `d` is missing or unresolvable is
 *     set to `hidden`. It keeps every field, stays editable in the admin panel,
 *     and republishing it is blocked until both references resolve.
 *
 * What it deliberately does not do:
 *
 *   - guess a destination from the title. A wrong guess is worse than a hidden
 *     package: it puts a company on a destination page it never agreed to sell.
 *   - touch a package that is already `hidden`. It is not reachable by a
 *     traveller, so there is nothing to make safe.
 */
import mongoose from 'mongoose';
import { argv } from 'node:process';

import env from '../config/env.js';
import connectDB from '../config/db.js';
import { Package, Company, Destination } from '../models/index.js';

const APPLY = argv.includes('--fix');

/** Group rows by why they are broken, so the report is actionable. */
const describe = (pkg, companies, destinations) => {
  const problems = [];
  if (!pkg.c) problems.push('no company');
  else if (!companies.has(pkg.c)) problems.push(`company "${pkg.c}" does not exist`);
  if (!pkg.d) problems.push('no destination');
  else if (!destinations.has(pkg.d)) problems.push(`destination "${pkg.d}" does not exist`);
  return problems;
};

async function run() {
  await connectDB(env.MONGODB_URI);

  // Both reference sets are loaded once; the alternative is a lookup per
  // package, which is the N+1 this avoids.
  const [packages, companyCodes, destinationSlugs] = await Promise.all([
    Package.find().lean(),
    Company.find().select('k').lean(),
    Destination.find().select('slug').lean(),
  ]);

  const companies = new Set(companyCodes.map((c) => c.k));
  const destinations = new Set(destinationSlugs.map((d) => d.slug));

  const broken = [];
  for (const pkg of packages) {
    const problems = describe(pkg, companies, destinations);
    if (problems.length) broken.push({ pkg, problems });
  }

  console.log(`Packages:      ${packages.length}`);
  console.log(`Companies:     ${companies.size}`);
  console.log(`Destinations:  ${destinations.size}`);

  if (!broken.length) {
    console.log('\nEvery package resolves to a real company and destination. Nothing to do.');
    return;
  }

  console.log(`\n${broken.length} package(s) with unresolvable references:\n`);
  for (const { pkg, problems } of broken) {
    console.log(`  ${pkg._id}  [${pkg.status}]  ${pkg.title}`);
    console.log(`      ${problems.join('; ')}`);
  }

  const toHide = broken.filter(({ pkg }) => pkg.status === 'published');

  if (!toHide.length) {
    console.log('\nNone of them are published, so none are reachable by a traveller.');
    console.log('Fix their references in the admin panel; publishing is blocked until they resolve.');
    return;
  }

  if (!APPLY) {
    console.log(`\n${toHide.length} of them are PUBLISHED and visible on the customer site.`);
    console.log('Re-run with --fix to set those to hidden. Nothing is deleted.');
    return;
  }

  const result = await Package.updateMany(
    { _id: { $in: toHide.map(({ pkg }) => pkg._id) } },
    { $set: { status: 'hidden' } },
  );

  console.log(`\nSet ${result.modifiedCount} published package(s) to hidden.`);
  console.log('Every field is intact. Fix the references in the admin panel, then republish.');
}

run()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
