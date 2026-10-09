const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const env = require('./config/env');
const apiRoutes = require('./routes');
const { notFound, errorHandler } = require('./middlewares/error.middleware');

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
      'img-src': ["'self'", 'data:'],
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
const pub = path.join(__dirname, '..', 'public');

// API reference for integrators, at /docs (/api-docs is an alias)
app.get(['/docs', '/api-docs'], (req, res) => res.sendFile(path.join(pub, 'docs', 'index.html')));

app.use(express.static(pub, { extensions: ['html'] }));
app.get('/admin*', (req, res) => res.sendFile(path.join(pub, 'admin', 'index.html')));
app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));

app.use(errorHandler);

module.exports = app;
