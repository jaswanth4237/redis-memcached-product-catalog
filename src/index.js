const express = require('express');
const config = require('./config');
const pool = require('./db');
const seedDatabase = require('./seed');
const cacheBackendMiddleware = require('./middlewares/cacheBackend.middleware');
const rateLimiterMiddleware = require('./middlewares/rateLimiter.middleware');
const routes = require('./routes');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply MVC Middlewares
app.use(cacheBackendMiddleware);
app.use(rateLimiterMiddleware);

// Mount MVC Routes
app.use('/', routes);

async function startServer() {
    try {
        console.log('Verifying Database Connection & Seeding...');
        await seedDatabase();

        app.listen(config.port, () => {
            console.log(`Product Catalog API listening on port ${config.port}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

if (require.main === module) {
    startServer();
}

module.exports = app;
