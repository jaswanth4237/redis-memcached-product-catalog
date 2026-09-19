const ProductModel = require('../models/product.model');
const LeaderboardModel = require('../models/leaderboard.model');
const redisManager = require('../cache/redis');
const memcachedManager = require('../cache/memcached');

class ProductController {
    static getCacheManager(backend) {
        return backend === 'memcached' ? memcachedManager : redisManager;
    }

    static async getProduct(req, res) {
        try {
            const productId = parseInt(req.params.id, 10);
            if (isNaN(productId)) {
                return res.status(400).json({ error: 'Invalid product ID' });
            }

            const backend = req.cacheBackend;
            const cacheManager = ProductController.getCacheManager(backend);

            // Check cache first
            const cached = await cacheManager.getProduct(productId);
            if (cached) {
                return res.json({ ...cached, _cached: true, _backend: backend });
            }

            // Query database
            const product = await ProductModel.findById(productId);
            if (!product) {
                return res.status(404).json({ error: 'Product not found' });
            }

            // Populate cache with 300s TTL
            await cacheManager.setProduct(productId, product, 300);

            return res.json({ ...product, _cached: false, _backend: backend });
        } catch (err) {
            console.error('Error fetching product:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    static async updateProduct(req, res) {
        try {
            const productId = parseInt(req.params.id, 10);
            if (isNaN(productId)) {
                return res.status(400).json({ error: 'Invalid product ID' });
            }

            const { name, description, price, category, inventory } = req.body;
            const updatedProduct = await ProductModel.update(productId, {
                name,
                description,
                price,
                category,
                inventory,
            });

            if (!updatedProduct) {
                return res.status(404).json({ error: 'Product not found' });
            }

            const backend = req.cacheBackend;
            const cacheManager = ProductController.getCacheManager(backend);

            // Invalidate cache
            await cacheManager.invalidateProduct(productId);

            return res.json({ ...updatedProduct, _invalidated: true, _backend: backend });
        } catch (err) {
            console.error('Error updating product:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    static async recordView(req, res) {
        try {
            const productId = parseInt(req.params.id, 10);
            if (isNaN(productId)) {
                return res.status(400).json({ error: 'Invalid product ID' });
            }

            const backend = req.cacheBackend;
            const useLock = req.query.use_lock !== 'false';

            await LeaderboardModel.incrementView(productId, backend, useLock);

            return res.json({ message: 'View recorded', product_id: productId, backend });
        } catch (err) {
            console.error('Error recording view:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }
}

module.exports = ProductController;
