// Every environment variable is read here once, so nothing else in the codebase
// touches process.env directly.
import 'dotenv/config';

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

// An Origin header is scheme + host + port only. A trailing slash or a stray
// path makes the entry match nothing, so normalise it away rather than failing
// every request with an unexplained CORS error.
const origins = (v) => list(v).map((o) => o.replace(/\/+$/, ''));

const env = {
  PORT: Number(process.env.PORT) || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  MONGODB_URI: process.env.MONGODB_URI,

  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

  CORS_ORIGINS: origins(process.env.CORS_ORIGINS),
  REVIEW_AUTO_APPROVE: process.env.REVIEW_AUTO_APPROVE === 'true',

  // Image hosting for destination cover art. Optional: with these unset the
  // upload endpoint answers 503 and every other route is unaffected, because a
  // cover image is itself optional.
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || '',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || '',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || '',
  CLOUDINARY_FOLDER: process.env.CLOUDINARY_FOLDER || 'trustify/destinations',

  ADMIN_NAME: process.env.ADMIN_NAME || 'Site Admin',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
};

env.isProduction = env.NODE_ENV === 'production';

/**
 * Whether image uploads can work. All three credentials are needed; one or two
 * of them is a misconfiguration, not a partial capability.
 */
env.hasCloudinary = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
);

/** Fail fast on boot rather than on the first request. */
env.assertRequired = () => {
  const missing = ['MONGODB_URI', 'JWT_SECRET'].filter((k) => !env[k]);
  if (missing.length) {
    console.error(`Missing ${missing.join(' and ')}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
};

export default env;
