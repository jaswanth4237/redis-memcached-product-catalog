const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const memcachedManager = require('../src/cache/memcached');

describe('MemcachedManager Unit & Integration Tests', () => {
    const testProductId = 99902;
    const testSessionId = `test_sess_mem_${Date.now()}`;
    const testUserId = `test_user_mem_${Date.now()}`;

    after(() => {
        memcachedManager.client.end();
    });

    it('should set and get product from Memcached using global versioning', async () => {
        const dummyProduct = { id: testProductId, name: 'Memcached Test Product', price: 49.99 };
        await memcachedManager.setProduct(testProductId, dummyProduct, 60);

        const cached = await memcachedManager.getProduct(testProductId);
        assert.ok(cached, 'Cached product should not be null');
        assert.strictEqual(cached.id, testProductId);
        assert.strictEqual(cached.name, 'Memcached Test Product');
    });

    it('should invalidate product cache by bumping global version', async () => {
        const initialVersion = await memcachedManager.getVersion();
        await memcachedManager.invalidateProduct(testProductId);
        const newVersion = await memcachedManager.getVersion();

        assert.strictEqual(newVersion, initialVersion + 1, 'Version should increment by 1');

        // Old key should now be effectively invalidated
        const cachedAfterInvalidate = await memcachedManager.getProduct(testProductId);
        assert.strictEqual(cachedAfterInvalidate, null, 'Product under new version should return null (cache miss)');
    });

    it('should acquire distributed lock via add, perform get-modify-set, and release lock', async () => {
        const uniqueProdId = 88802;

        const count1 = await memcachedManager.incrementView(uniqueProdId, true);
        assert.ok(count1 >= 1, 'First view count should be at least 1');

        const count2 = await memcachedManager.incrementView(uniqueProdId, true);
        assert.strictEqual(count2, count1 + 1, 'Second view count should increment by exactly 1');

        const leaderboard = await memcachedManager.getLeaderboard(10);
        assert.ok(Array.isArray(leaderboard));
        const found = leaderboard.find((item) => String(item.product_id) === String(uniqueProdId));
        assert.ok(found, 'Product should appear in leaderboard');
        assert.strictEqual(found.views, count2);
    });

    it('should execute rate limiter with incr and safe add initialization', async () => {
        const limit = 5;
        const windowSec = 10;

        // First request: initializes key using add
        const first = await memcachedManager.checkRateLimit(testUserId, limit, windowSec);
        assert.strictEqual(first.allowed, true);
        assert.strictEqual(first.current, 1);

        // Subsequent requests: increment counter
        for (let i = 2; i <= limit; i++) {
            const res = await memcachedManager.checkRateLimit(testUserId, limit, windowSec);
            assert.strictEqual(res.allowed, true, `Request ${i} should be allowed`);
            assert.strictEqual(res.current, i);
        }

        // Exceeding limit: blocked
        const blocked = await memcachedManager.checkRateLimit(testUserId, limit, windowSec);
        assert.strictEqual(blocked.allowed, false, 'Request over limit should be blocked');
        assert.strictEqual(blocked.current, limit + 1);
    });

    it('should store serialized JSON session and perform read-modify-write updates', async () => {
        const initialSession = {
            username: 'memcached_tester',
            cart_count: '1',
            role: 'editor',
        };

        await memcachedManager.setSession(testSessionId, initialSession);
        const fetched = await memcachedManager.getSession(testSessionId);
        assert.strictEqual(fetched.username, 'memcached_tester');
        assert.strictEqual(fetched.cart_count, '1');

        // Update single field via full object re-serialization
        await memcachedManager.updateSessionField(testSessionId, 'cart_count', '9');
        const updated = await memcachedManager.getSession(testSessionId);
        assert.strictEqual(updated.cart_count, '9', 'cart_count should be updated to 9');
        assert.strictEqual(updated.username, 'memcached_tester', 'username should remain intact');
        assert.strictEqual(updated.role, 'editor', 'role should remain intact');
    });
});
