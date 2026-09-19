const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
};
