function cacheBackendMiddleware(req, res, next) {
    const backendHeader = req.headers['x-cache-backend'];
    if (backendHeader && backendHeader.toLowerCase() === 'memcached') {
        req.cacheBackend = 'memcached';
    } else {
        req.cacheBackend = 'redis';
    }
    next();
}

module.exports = cacheBackendMiddleware;
