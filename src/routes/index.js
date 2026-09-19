const express = require('express');
const healthRoutes = require('./health.routes');
const productRoutes = require('./product.routes');
const leaderboardRoutes = require('./leaderboard.routes');
const sessionRoutes = require('./session.routes');

const router = express.Router();

router.use('/', healthRoutes);
router.use('/products', productRoutes);
router.use('/leaderboard', leaderboardRoutes);
router.use('/session', sessionRoutes);

module.exports = router;
