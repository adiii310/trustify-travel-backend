// Creates or resets the admin account from ADMIN_* values in .env
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const env = require('./config/env');
const connectDB = require('./config/db');
const Admin = require('./modules/admin/admin.model');

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

if (require.main === module) {
  connectDB(env.MONGODB_URI)
    .then(ensureAdmin)
    .catch((e) => { console.error(e.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}

module.exports = ensureAdmin;
