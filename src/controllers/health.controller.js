const db = require('../db');
const redisManager = require('../cache/redis');
const memcachedManager = require('../cache/memcached');

class HealthController {
    static async checkHealth(req, res) {
        let dbStatus = false;
        let redisStatus = false;
        let memcachedStatus = false;

        try {
            await db.query('SELECT 1');
            dbStatus = true;
        } catch (e) { }

        try {
            await redisManager.client.ping();
            redisStatus = true;
        } catch (e) { }

        try {
            memcachedStatus = await new Promise((resolve) => {
                memcachedManager.client.stats((err) => resolve(!err));
            });
        } catch (e) { }

        const isHealthy = dbStatus && redisStatus && memcachedStatus;
        return res.status(isHealthy ? 200 : 503).json({
            status: isHealthy ? 'healthy' : 'unhealthy',
            db: dbStatus,
            redis: redisStatus,
            memcached: memcachedStatus,
        });
    }
}

module.exports = HealthController;
