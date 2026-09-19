const redisManager = require('../cache/redis');
const memcachedManager = require('../cache/memcached');

class SessionModel {
    static getCacheManager(backend) {
        return backend === 'memcached' ? memcachedManager : redisManager;
    }

    static async getSession(sessionId, backend) {
        const manager = this.getCacheManager(backend);
        return await manager.getSession(sessionId);
    }

    static async setSession(sessionId, sessionData, backend) {
        const manager = this.getCacheManager(backend);
        return await manager.setSession(sessionId, sessionData);
    }

    static async updateSessionField(sessionId, field, value, backend) {
        const manager = this.getCacheManager(backend);
        return await manager.updateSessionField(sessionId, field, value);
    }
}

module.exports = SessionModel;
