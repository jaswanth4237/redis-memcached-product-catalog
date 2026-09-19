require('dotenv').config();

module.exports = {
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379/0',
  MEMCACHED_URL: process.env.MEMCACHED_URL || 'localhost:21211',
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/product_catalog',
  API_PORT: parseInt(process.env.API_PORT || '8000', 10),
};
