const redisManager = require('../cache/redis');
const memcachedManager = require('../cache/memcached');

class LeaderboardModel {
    static getCacheManager(backend) {
        return backend === 'memcached' ? memcachedManager : redisManager;
    }

    static async incrementView(productId, backend, useLock = true) {
        const manager = this.getCacheManager(backend);
        if (backend === 'memcached') {
            return await manager.incrementView(productId, useLock);
        } else {
            return await manager.incrementView(productId);
        }
    }

    static async getTopProducts(backend, limit = 10) {
        const manager = this.getCacheManager(backend);
        return await manager.getLeaderboard(limit);
    }
}

module.exports = LeaderboardModel;
