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

if (env.CORS_ORIGINS.length) app.use('/api', cors({ origin: env.CORS_ORIGINS }));

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
