const express = require('express');
const config = require('./config');
const db = require('./db');
const redisManager = require('./cache/redis');
const memcachedManager = require('./cache/memcached');
const { seedProducts } = require('./seed');

const app = express();
app.use(express.json());

// Helper serializer
function serializeProduct(row) {
    return {
        id: parseInt(row.id, 10),
        name: row.name,
        description: row.description,
        price: parseFloat(row.price),
        category: row.category,
        inventory: parseInt(row.inventory, 10),
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
    };
}

// Rate Limiter Middleware
app.use(async (req, res, next) => {
    if (req.path === '/health' || req.path === '/') {
        return next();
    }

    const userId = req.headers['x-user-id'] || 'default_user';
    const backend = (req.headers['x-cache-backend'] || 'redis').toLowerCase();

    try {
        let result;
        if (backend === 'memcached') {
            result = await memcachedManager.checkRateLimit(userId, 100, 60);
        } else {
            result = await redisManager.checkRateLimit(userId, 100, 60);
        }

        if (!result.allowed) {
            return res.status(429).json({ detail: 'Rate limit exceeded' });
        }
        next();
    } catch (err) {
        console.error('Rate limit middleware error:', err);
        next();
    }
});

// GET /health
app.get('/health', async (req, res) => {
    let dbOk = false;
    let redisOk = false;
    let memcachedOk = false;

    try {
        const dbRes = await db.query('SELECT 1;');
        dbOk = dbRes.rows.length > 0;
    } catch (e) {
        console.error('Health check DB error:', e.message);
    }

    try {
        const pong = await redisManager.client.ping();
        redisOk = pong === 'PONG';
    } catch (e) {
        console.error('Health check Redis error:', e.message);
    }

    try {
        memcachedOk = await memcachedManager.set('health', 'ok', 10);
    } catch (e) {
        console.error('Health check Memcached error:', e.message);
    }

    const isHealthy = dbOk && redisOk && memcachedOk;
    res.status(isHealthy ? 200 : 500).json({
        status: isHealthy ? 'healthy' : 'unhealthy',
        db: dbOk,
        redis: redisOk,
        memcached: memcachedOk,
    });
});

app.get('/', (req, res) => {
    res.json({ message: 'Product Catalog API (Node.js) is running.' });
});

// GET /products/:id
app.get('/products/:id', async (req, res) => {
    const productId = parseInt(req.params.id, 10);
    const backend = (req.headers['x-cache-backend'] || 'redis').toLowerCase();

    if (isNaN(productId)) {
        return res.status(400).json({ detail: 'Invalid product ID' });
    }

    // 1. Check Active Cache
    let cached = null;
    if (backend === 'memcached') {
        cached = await memcachedManager.getProduct(productId);
    } else {
        cached = await redisManager.getProduct(productId);
    }

    if (cached) {
        res.setHeader('X-Cache-Status', 'HIT');
        res.setHeader('X-Cache-Backend-Used', backend);
        return res.json(cached);
    }

    // 2. Database Fallback
    const dbRes = await db.query(
        'SELECT id, name, description, price, category, inventory, created_at, updated_at FROM products WHERE id = $1;',
        [productId]
    );

    if (dbRes.rows.length === 0) {
        return res.status(404).json({ detail: 'Product not found' });
    }

    const productData = serializeProduct(dbRes.rows[0]);

    // 3. Populate Active Cache
    if (backend === 'memcached') {
        await memcachedManager.setProduct(productId, productData, 300);
    } else {
        await redisManager.setProduct(productId, productData, 300);
    }

    res.setHeader('X-Cache-Status', 'MISS');
    res.setHeader('X-Cache-Backend-Used', backend);
    res.json(productData);
});

// POST /products/:id (Update product & invalidates cache)
app.post('/products/:id', async (req, res) => {
    const productId = parseInt(req.params.id, 10);
    const backend = (req.headers['x-cache-backend'] || 'redis').toLowerCase();
    const payload = req.body || {};

    if (isNaN(productId)) {
        return res.status(400).json({ detail: 'Invalid product ID' });
    }

    // 1. Update DB if fields supplied
    const fields = [];
    const params = [];
    let paramIdx = 1;

    if (payload.name !== undefined) {
        fields.push(`name = $${paramIdx++}`);
        params.push(payload.name);
    }
    if (payload.description !== undefined) {
        fields.push(`description = $${paramIdx++}`);
        params.push(payload.description);
    }
    if (payload.price !== undefined) {
        fields.push(`price = $${paramIdx++}`);
        params.push(payload.price);
    }
    if (payload.category !== undefined) {
        fields.push(`category = $${paramIdx++}`);
        params.push(payload.category);
    }
    if (payload.inventory !== undefined) {
        fields.push(`inventory = $${paramIdx++}`);
        params.push(payload.inventory);
    }

    if (fields.length > 0) {
        fields.push(`updated_at = CURRENT_TIMESTAMP`);
        params.push(productId);
        const query = `UPDATE products SET ${fields.join(', ')} WHERE id = $${paramIdx};`;
        await db.query(query, params);
    }

    // 2. Invalidate Cache
    if (backend === 'memcached') {
        await memcachedManager.invalidateProduct(productId);
    } else {
        await redisManager.invalidateProduct(productId);
    }

    // 3. Return fresh data
    const dbRes = await db.query(
        'SELECT id, name, description, price, category, inventory, created_at, updated_at FROM products WHERE id = $1;',
        [productId]
    );

    if (dbRes.rows.length === 0) {
        return res.status(404).json({ detail: 'Product not found' });
    }

    res.json(serializeProduct(dbRes.rows[0]));
});

// POST /products/:id/view (Increment view count for leaderboard)
app.post('/products/:id/view', async (req, res) => {
    const productId = parseInt(req.params.id, 10);
    const backend = (req.headers['x-cache-backend'] || 'redis').toLowerCase();
    const useLock = req.query.use_lock !== 'false';

    if (isNaN(productId)) {
        return res.status(400).json({ detail: 'Invalid product ID' });
    }

    let views = 0;
    if (backend === 'memcached') {
        views = await memcachedManager.incrementView(productId, useLock);
    } else {
        views = await redisManager.incrementView(productId);
    }

    res.json({
        status: 'success',
        product_id: productId,
        views,
        backend,
    });
});

// GET /leaderboard
app.get('/leaderboard', async (req, res) => {
    const backend = (req.headers['x-cache-backend'] || 'redis').toLowerCase();
    let leaderboard = [];

    if (backend === 'memcached') {
        leaderboard = await memcachedManager.getLeaderboard(10);
    } else {
        leaderboard = await redisManager.getLeaderboard(10);
    }

    res.json({ backend, leaderboard });
});

// Session Management Endpoints
app.get('/session/:id', async (req, res) => {
    const sessionId = req.params.id;
    const backend = (req.headers['x-cache-backend'] || 'redis').toLowerCase();
    let data = {};

    if (backend === 'memcached') {
        data = await memcachedManager.getSession(sessionId);
    } else {
        data = await redisManager.getSession(sessionId);
    }

    res.json({ session_id: sessionId, data, backend });
});

app.post('/session/:id', async (req, res) => {
    const sessionId = req.params.id;
    const backend = (req.headers['x-cache-backend'] || 'redis').toLowerCase();
    const data = req.body || {};

    if (backend === 'memcached') {
        await memcachedManager.setSession(sessionId, data);
    } else {
        await redisManager.setSession(sessionId, data);
    }

    res.json({ status: 'success', session_id: sessionId, backend });
});

app.patch('/session/:id', async (req, res) => {
    const sessionId = req.params.id;
    const backend = (req.headers['x-cache-backend'] || 'redis').toLowerCase();
    const data = req.body || {};

    for (const [field, val] of Object.entries(data)) {
        if (backend === 'memcached') {
            await memcachedManager.updateSessionField(sessionId, field, val);
        } else {
            await redisManager.updateSessionField(sessionId, field, val);
        }
    }

    let updated = {};
    if (backend === 'memcached') {
        updated = await memcachedManager.getSession(sessionId);
    } else {
        updated = await redisManager.getSession(sessionId);
    }

    res.json({ status: 'success', session_id: sessionId, data: updated, backend });
});

// Auto-seed database and start server
async function startServer() {
    try {
        await seedProducts(100000);
        app.listen(config.API_PORT, '0.0.0.0', () => {
            console.log(`Product Catalog API listening on port ${config.API_PORT}`);
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
