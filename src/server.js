// Boot sequence only: check the environment, connect to Mongo, start listening.
// The Express app itself lives in src/app.js.
const env = require('./config/env');
const connectDB = require('./config/db');
const app = require('./app');

env.assertRequired();

connectDB(env.MONGODB_URI)
  .then(() => {
    app.listen(env.PORT, () => {
      console.log(`Customer portal: http://localhost:${env.PORT}`);
      console.log(`Admin portal:    http://localhost:${env.PORT}/admin`);
      console.log(`API docs:        http://localhost:${env.PORT}/docs`);
      console.log(env.CORS_ORIGINS.length
        ? `CORS allowed:    ${env.CORS_ORIGINS.join(', ')}`
        : 'CORS allowed:    same-origin only (CORS_ORIGINS is empty)');
    });
  })
  .catch((err) => {
    console.error('Could not connect to MongoDB:', err.message);
    process.exit(1);
  });

module.exports = app;
