const Memcached = require('memcached');
const config = require('../config');

class MemcachedManager {
    constructor(url = config.MEMCACHED_URL) {
        this.client = new Memcached(url, {
            retries: 3,
            retry: 50,
            remove: false,
            timeout: 2000,
        });
    }

    // Promise wrappers
    get(key) {
        return new Promise((resolve) => {
            this.client.get(key, (err, data) => {
                if (err || !data) return resolve(null);
                resolve(data);
            });
        });
    }

    set(key, value, lifetime = 300) {
        return new Promise((resolve) => {
            this.client.set(key, value, lifetime, (err) => {
                resolve(!err);
            });
        });
    }

    add(key, value, lifetime = 5) {
        return new Promise((resolve) => {
            this.client.add(key, value, lifetime, (err) => {
                // Returns true if added successfully, false if key already exists or error
                resolve(!err);
            });
        });
    }

    incr(key, amount = 1) {
        return new Promise((resolve) => {
            this.client.incr(key, amount, (err, result) => {
                if (err || result === false) return resolve(null);
                resolve(result);
            });
        });
    }

    del(key) {
        return new Promise((resolve) => {
            this.client.del(key, () => resolve(true));
        });
    }

    // Versioning helper
    async getVersion() {
        const ver = await this.get('product_version');
        return ver ? parseInt(ver, 10) : 1;
    }

    async bumpVersion() {
        const val = await this.incr('product_version', 1);
        if (val === null) {
            await this.set('product_version', '2', 0);
            return 2;
        }
        return val;
    }

    // Product Cache
    async getProduct(productId) {
        const ver = await this.getVersion();
        const key = `v${ver}:product:${productId}`;
        const data = await this.get(key);
        return data ? JSON.parse(data) : null;
    }

    async setProduct(productId, productData, ttl = 300) {
        const ver = await this.getVersion();
        const key = `v${ver}:product:${productId}`;
        await this.set(key, JSON.stringify(productData), ttl);
    }

    async invalidateProduct(productId) {
        // Cache Versioning Approach: increment global version key
        await this.bumpVersion();
    }

    // Leaderboard (with Distributed Lock via ADD command)
    async incrementView(productId, useLock = true) {
        const strId = String(productId);

        if (!useLock) {
            // Naive No-Lock Implementation (susceptible to race conditions)
            const val = await this.get('leaderboard');
            const lb = val ? JSON.parse(val) : {};
            const newCount = (lb[strId] || 0) + 1;
            lb[strId] = newCount;
            await this.set('leaderboard', JSON.stringify(lb), 0);
            return newCount;
        }

        // Distributed Lock Implementation using Memcached `add` (Set if Not Exists)
        const lockKey = 'lock:leaderboard';
        let acquired = false;
        const maxRetries = 200;

        for (let i = 0; i < maxRetries; i++) {
            if (await this.add(lockKey, '1', 5)) {
                acquired = true;
                break;
            }
            await new Promise((r) => setTimeout(r, 3)); // 3ms backoff
        }

        if (!acquired) {
            console.warn('Failed to acquire Memcached leaderboard lock after max retries');
            return await this.incrementView(productId, false);
        }

        try {
            const val = await this.get('leaderboard');
            const lb = val ? JSON.parse(val) : {};
            const newCount = (lb[strId] || 0) + 1;
            lb[strId] = newCount;
            await this.set('leaderboard', JSON.stringify(lb), 0);
            return newCount;
        } finally {
            await this.del(lockKey);
        }
    }

    async getLeaderboard(topN = 10) {
        const val = await this.get('leaderboard');
        if (!val) return [];
        const lb = JSON.parse(val);
        const sortedItems = Object.entries(lb)
            .map(([id, views]) => ({ product_id: id, views: parseInt(views, 10) }))
            .sort((a, b) => b.views - a.views)
            .slice(0, topN);
        return sortedItems;
    }

    // Rate Limiter using INCR and handling initialization race
    async checkRateLimit(userId, limit = 100, windowSeconds = 60) {
        const key = `rate:${userId}`;
        let val = await this.incr(key, 1);

        if (val === null) {
            // Key missing: initialize with add
            const added = await this.add(key, '1', windowSeconds);
            if (added) {
                val = 1;
            } else {
                // Race condition: another process created the key, so call incr
                const val2 = await this.incr(key, 1);
                val = val2 !== null ? val2 : 1;
            }
        }

        return { allowed: val <= limit, current: val };
    }

    // Session Store (Serialized JSON Strings)
    async getSession(sessionId) {
        const val = await this.get(`session:${sessionId}`);
        return val ? JSON.parse(val) : {};
    }

    async setSession(sessionId, data) {
        await this.set(`session:${sessionId}`, JSON.stringify(data), 0);
    }

    async updateSessionField(sessionId, field, value) {
        // Memcached requires full re-serialization for every update!
        const sessionData = await this.getSession(sessionId);
        sessionData[field] = String(value);
        await this.setSession(sessionId, sessionData);
    }
}

module.exports = new MemcachedManager();
