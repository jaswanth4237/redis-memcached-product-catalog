const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const redisManager = require('../src/cache/redis');

describe('RedisManager Unit & Integration Tests', () => {
    const testProductId = 99901;
    const testSessionId = `test_sess_redis_${Date.now()}`;
    const testUserId = `test_user_redis_${Date.now()}`;

    after(async () => {
        await redisManager.client.quit();
    });

    it('should set and get product from Redis cache', async () => {
        const dummyProduct = { id: testProductId, name: 'Redis Test Product', price: 99.99 };
        await redisManager.setProduct(testProductId, dummyProduct, 60);

        const cached = await redisManager.getProduct(testProductId);
        assert.ok(cached, 'Cached product should not be null');
        assert.strictEqual(cached.id, testProductId);
        assert.strictEqual(cached.name, 'Redis Test Product');
    });

    it('should invalidate product cache and publish invalidation event', async () => {
        await redisManager.invalidateProduct(testProductId);
        const cached = await redisManager.getProduct(testProductId);
        assert.strictEqual(cached, null, 'Product should be deleted from cache');
    });

    it('should atomically increment leaderboard views with ZINCRBY and retrieve with ZREVRANGE', async () => {
        const uniqueProdId = 88801;
        // Clean up previous test run if any
        await redisManager.client.zrem('leaderboard', uniqueProdId.toString());

        const score1 = await redisManager.incrementView(uniqueProdId);
        assert.strictEqual(score1, 1);

        const score2 = await redisManager.incrementView(uniqueProdId);
        assert.strictEqual(score2, 2);

        const leaderboard = await redisManager.getLeaderboard(10);
        assert.ok(Array.isArray(leaderboard));
        const found = leaderboard.find((item) => String(item.product_id) === String(uniqueProdId));
        assert.ok(found, 'Product should appear in leaderboard');
        assert.strictEqual(found.views, 2);
    });

    it('should execute atomic Lua script for rate limiting (INCR + EXPIRE)', async () => {
        const limit = 5;
        const windowSec = 10;

        // Make requests up to limit
        for (let i = 1; i <= limit; i++) {
            const res = await redisManager.checkRateLimit(testUserId, limit, windowSec);
            assert.strictEqual(res.allowed, true, `Request ${i} should be allowed`);
            assert.strictEqual(res.current, i);
        }

        // Next request should exceed limit
        const blocked = await redisManager.checkRateLimit(testUserId, limit, windowSec);
        assert.strictEqual(blocked.allowed, false, 'Request over limit should be blocked');
        assert.strictEqual(blocked.current, limit + 1);

        // Verify TTL is set on key
        const ttl = await redisManager.client.ttl(`rate:${testUserId}`);
        assert.ok(ttl > 0 && ttl <= windowSec, `TTL should be set between 1 and ${windowSec}`);
    });

    it('should store session as Redis Hash and support single-field updates', async () => {
        const initialSession = {
            username: 'redis_tester',
            cart_count: 3,
            is_active: 'true',
        };

        await redisManager.setSession(testSessionId, initialSession);
        const fetched = await redisManager.getSession(testSessionId);
        assert.strictEqual(fetched.username, 'redis_tester');
        assert.strictEqual(fetched.cart_count, '3');

        // Update single field without touching others
        await redisManager.updateSessionField(testSessionId, 'cart_count', 7);
        const updated = await redisManager.getSession(testSessionId);
        assert.strictEqual(updated.cart_count, '7', 'cart_count should be updated to 7');
        assert.strictEqual(updated.username, 'redis_tester', 'username should remain unchanged');
    });
});
