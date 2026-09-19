const Redis = require('ioredis');
const config = require('../config');

class RedisManager {
    constructor(url = config.REDIS_URL) {
        this.client = new Redis(url, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => Math.min(times * 50, 2000),
        });

        this.client.on('error', (err) => {
            console.error('Redis Client Error:', err.message);
        });
    }

    // Product Cache
    async getProduct(productId) {
        const data = await this.client.get(`product:${productId}`);
        return data ? JSON.parse(data) : null;
    }

    async setProduct(productId, productData, ttl = 300) {
        await this.client.setex(`product:${productId}`, ttl, JSON.stringify(productData));
    }

    async invalidateProduct(productId) {
        const key = `product:${productId}`;
        await this.client.del(key);
        await this.client.publish('product_invalidation', key);
    }

    // Leaderboard (ZSET)
    async incrementView(productId) {
        const score = await this.client.zincrby('leaderboard', 1, productId.toString());
        return parseFloat(score);
    }

    async getLeaderboard(topN = 10) {
        const results = await this.client.zrevrange('leaderboard', 0, topN - 1, 'WITHSCORES');
        const leaderboard = [];
        for (let i = 0; i < results.length; i += 2) {
            leaderboard.push({
                product_id: results[i],
                views: parseInt(results[i + 1], 10),
            });
        }
        return leaderboard;
    }

    // Rate Limiting (Lua script)
    async checkRateLimit(userId, limit = 100, windowSeconds = 60) {
        const luaScript = `
      local key = KEYS[1]
      local limit = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      local current = redis.call('INCR', key)
      if current == 1 then
          redis.call('EXPIRE', key, window)
      end
      return current
    `;
        const key = `rate:${userId}`;
        const current = await this.client.eval(luaScript, 1, key, limit, windowSeconds);
        const count = parseInt(current, 10);
        return { allowed: count <= limit, current: count };
    }

    // Session Store (Hashes)
    async getSession(sessionId) {
        return await this.client.hgetall(`session:${sessionId}`);
    }

    async setSession(sessionId, data) {
        if (Object.keys(data).length > 0) {
            const stringifiedData = {};
            for (const [k, v] of Object.entries(data)) {
                stringifiedData[k] = String(v);
            }
            await this.client.hset(`session:${sessionId}`, stringifiedData);
        }
    }

    async updateSessionField(sessionId, field, value) {
        // Touches ONLY one field in Redis Hash
        await this.client.hset(`session:${sessionId}`, field, String(value));
    }
}

module.exports = new RedisManager();
