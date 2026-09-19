const LeaderboardModel = require('../models/leaderboard.model');

class LeaderboardController {
    static async getLeaderboard(req, res) {
        try {
            const backend = req.cacheBackend;
            const topProducts = await LeaderboardModel.getTopProducts(backend, 10);
            return res.json({ leaderboard: topProducts, _backend: backend });
        } catch (err) {
            console.error('Error fetching leaderboard:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }
}

module.exports = LeaderboardController;
