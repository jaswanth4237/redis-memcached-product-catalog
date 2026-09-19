const redisManager = require('../cache/redis');
const memcachedManager = require('../cache/memcached');

async function rateLimiterMiddleware(req, res, next) {
    // Allow health endpoint without rate limiting
    if (req.path === '/health') {
        return next();
    }

    const userId = req.headers['x-user-id'] || req.ip || 'anonymous';
    const backend = req.cacheBackend || 'redis';
    const limit = 100;
    const windowSec = 60;

    try {
        let current = 0;
        if (backend === 'memcached') {
            current = await memcachedManager.checkRateLimit(userId, limit, windowSec);
        } else {
            current = await redisManager.checkRateLimit(userId, limit, windowSec);
        }

        if (current > limit) {
            return res.status(429).json({
                error: 'Too Many Requests',
                message: `Rate limit exceeded. Maximum ${limit} requests allowed per minute.`,
            });
        }

        next();
    } catch (err) {
        console.error('Rate Limiter error:', err);
        next(); // Fail open in case of cache error
    }
}

module.exports = rateLimiterMiddleware;
