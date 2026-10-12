const { describe, it } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const BASE_URL = process.env.API_URL || 'http://localhost:8000';

function request(path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const req = http.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = data ? JSON.parse(data) : {};
                } catch {
                    parsed = data;
                }
                resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
            });
        });
        req.on('error', reject);
        if (options.body) {
            req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
        }
        req.end();
    });
}

describe('Express API End-to-End Integration Tests', () => {
    it('GET /health should return 200 and healthy status for all services', async () => {
        const res = await request('/health');
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.body.status, 'healthy');
        assert.strictEqual(res.body.db, true);
        assert.strictEqual(res.body.redis, true);
        assert.strictEqual(res.body.memcached, true);
    });

    it('GET /products/:id should route via X-Cache-Backend header and cache response', async () => {
        const productId = 10;

        // Redis cache backend
        const resRedis1 = await request(`/products/${productId}`, {
            headers: { 'X-Cache-Backend': 'redis', 'X-User-ID': 'api_test_user_1' },
        });
        assert.strictEqual(resRedis1.statusCode, 200);
        assert.strictEqual(resRedis1.body._backend, 'redis');

        const resRedis2 = await request(`/products/${productId}`, {
            headers: { 'X-Cache-Backend': 'redis', 'X-User-ID': 'api_test_user_1' },
        });
        assert.strictEqual(resRedis2.statusCode, 200);
        assert.strictEqual(resRedis2.body._cached, true);
        assert.strictEqual(resRedis2.body._backend, 'redis');

        // Memcached cache backend
        const resMem1 = await request(`/products/${productId}`, {
            headers: { 'X-Cache-Backend': 'memcached', 'X-User-ID': 'api_test_user_2' },
        });
        assert.strictEqual(resMem1.statusCode, 200);
        assert.strictEqual(resMem1.body._backend, 'memcached');
    });

    it('POST /products/:id should update database and trigger cache invalidation', async () => {
        const productId = 15;
        const newName = `Updated Product ${Date.now()}`;

        const updateRes = await request(`/products/${productId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Cache-Backend': 'redis',
                'X-User-ID': 'api_test_updater',
            },
            body: { name: newName },
        });

        assert.strictEqual(updateRes.statusCode, 200);
        assert.strictEqual(updateRes.body._invalidated, true);
        assert.strictEqual(updateRes.body.name, newName);

        // Subsequent fetch should report _cached: false (cache miss caused by invalidation)
        const fetchRes = await request(`/products/${productId}`, {
            headers: { 'X-Cache-Backend': 'redis', 'X-User-ID': 'api_test_verifier' },
        });
        assert.strictEqual(fetchRes.statusCode, 200);
        assert.strictEqual(fetchRes.body._cached, false);
        assert.strictEqual(fetchRes.body.name, newName);
    });

    it('RateLimiterMiddleware should enforce 100 req/min limit and return 429 when exceeded', async () => {
        const uniqueUserId = `rate_limit_api_test_${Date.now()}`;
        const limit = 100;

        // Perform requests under limit
        for (let i = 0; i < limit; i++) {
            const res = await request('/products/1', {
                headers: { 'X-User-ID': uniqueUserId, 'X-Cache-Backend': 'redis' },
            });
            assert.strictEqual(res.statusCode, 200);
        }

        // 101st request should be rejected with 429 Too Many Requests
        const blockedRes = await request('/products/1', {
            headers: { 'X-User-ID': uniqueUserId, 'X-Cache-Backend': 'redis' },
        });
        assert.strictEqual(blockedRes.statusCode, 429);
        assert.strictEqual(blockedRes.body.error, 'Too Many Requests');
    });

    it('Leaderboard API should record views and return sorted leaderboard', async () => {
        const prodId = 777;

        const viewRes = await request(`/products/${prodId}/view`, {
            method: 'POST',
            headers: { 'X-Cache-Backend': 'redis', 'X-User-ID': 'viewer_1' },
        });
        assert.strictEqual(viewRes.statusCode, 200);
        assert.strictEqual(viewRes.body.message, 'View recorded');

        const lbRes = await request('/leaderboard', {
            headers: { 'X-Cache-Backend': 'redis', 'X-User-ID': 'viewer_2' },
        });
        assert.strictEqual(lbRes.statusCode, 200);
        assert.ok(Array.isArray(lbRes.body.leaderboard));
    });

    it('Session API should create, fetch, and patch user session', async () => {
        const sessId = `api_sess_${Date.now()}`;

        // Create session
        const createRes = await request(`/session/${sessId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Cache-Backend': 'redis',
                'X-User-ID': 'session_mgr',
            },
            body: { user: 'test_dev', theme: 'dark' },
        });
        assert.strictEqual(createRes.statusCode, 200);

        // Patch session field
        const patchRes = await request(`/session/${sessId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'X-Cache-Backend': 'redis',
                'X-User-ID': 'session_mgr',
            },
            body: { field: 'theme', value: 'light' },
        });
        assert.strictEqual(patchRes.statusCode, 200);

        // Fetch session
        const fetchRes = await request(`/session/${sessId}`, {
            headers: { 'X-Cache-Backend': 'redis', 'X-User-ID': 'session_mgr' },
        });
        assert.strictEqual(fetchRes.statusCode, 200);
        assert.strictEqual(fetchRes.body.session.theme, 'light');
        assert.strictEqual(fetchRes.body.session.user, 'test_dev');
    });
});
