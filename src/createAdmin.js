// Creates or resets the admin account from ADMIN_* values in .env
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import env from './config/env.js';
import connectDB from './config/db.js';
import Admin from './modules/admin/admin.model.js';

const MIN_PASSWORD_LENGTH = 8;

async function ensureAdmin() {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env');
  if (ADMIN_PASSWORD.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await Admin.findOneAndUpdate(
    { email: ADMIN_EMAIL.toLowerCase() },
    { name: ADMIN_NAME, email: ADMIN_EMAIL.toLowerCase(), passwordHash, role: 'admin' },
    { upsert: true },
  );
  console.log(`Admin ready: ${ADMIN_EMAIL}`);
}

// ESM has no `require.main`; comparing the resolved entry path is the equivalent,
// so `npm run create-admin` connects but `import`ing this from seed.js does not.
const isEntryPoint = argv[1] && fileURLToPath(import.meta.url) === argv[1];

if (isEntryPoint) {
  connectDB(env.MONGODB_URI)
    .then(ensureAdmin)
    .catch((e) => { console.error(e.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}

export default ensureAdmin;
