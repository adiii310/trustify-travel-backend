import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';

import env from './config/env.js';
import apiRoutes from './routes/index.js';
import { notFound, errorHandler } from './middlewares/error.middleware.js';

const app = express();
app.set('trust proxy', 1);

// Security headers. Inline scripts are allowed because the portals and the API
// docs are each a single HTML file.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'"],
      'script-src-attr': ["'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      // Destination cover images are uploaded to Cloudinary and served from its
      // CDN, so the portals need it allowed alongside self-hosted assets.
      'img-src': ["'self'", 'data:', 'https://res.cloudinary.com'],
      'connect-src': ["'self'"],
    },
  },
}));

/**
 * CORS for the two frontends.
 *
 * `maxAge` is the important one in development. Every admin request carries an
 * `Authorization` header, which makes it a non-simple request, so the browser
 * preflights each one. Without a max-age Chrome caches a preflight for about
 * five seconds, and the admin dashboard fires fourteen parallel loads on
 * mount — so a cold load means fourteen preflights racing fourteen requests,
 * and a single one that does not land shows up as a CORS failure even though
 * the configuration is correct. Ten minutes collapses that to one.
 *
 * A rejected origin is logged rather than silently dropped: the browser
 * reports it to the user as "blocked by CORS policy" and the server otherwise
 * says nothing at all, which is the hardest version of this to diagnose.
 */
if (env.CORS_ORIGINS.length) {
  const allowed = new Set(env.CORS_ORIGINS);

  app.use('/api', cors({
    maxAge: 600,
    origin(origin, callback) {
      // No Origin header: curl, a server-side call, or a same-origin request.
      if (!origin || allowed.has(origin)) return callback(null, true);

      console.warn(
        `CORS: refused ${origin} — add it to CORS_ORIGINS in .env (currently: ${env.CORS_ORIGINS.join(', ')})`,
      );
      // `false`, not an error: the response simply carries no CORS header, and
      // the browser blocks it. Throwing here would turn a policy decision into
      // a 500 and bury the real reason.
      return callback(null, false);
    },
  }));
}

app.use(express.json({ limit: '100kb' }));
app.use(morgan(env.isProduction ? 'combined' : 'dev'));

// --- API -------------------------------------------------------------------
app.use('/api', apiRoutes);
app.use('/api', notFound); // anything under /api that matched no route

// --- static pages ----------------------------------------------------------
// ESM has no __dirname; derive it from this module's own URL.
const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'public');

// API reference for integrators, at /docs (/api-docs is an alias)
app.get(['/docs', '/api-docs'], (req, res) => res.sendFile(path.join(pub, 'docs', 'index.html')));

app.use(express.static(pub, { extensions: ['html'] }));
app.get('/admin*', (req, res) => res.sendFile(path.join(pub, 'admin', 'index.html')));
app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));

app.use(errorHandler);

export default app;
