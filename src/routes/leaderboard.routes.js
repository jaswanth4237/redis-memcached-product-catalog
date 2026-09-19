const express = require('express');
const LeaderboardController = require('../controllers/leaderboard.controller');

const router = express.Router();

router.get('/', LeaderboardController.getLeaderboard);

module.exports = router;
