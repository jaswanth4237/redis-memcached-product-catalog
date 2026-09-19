const express = require('express');
const SessionController = require('../controllers/session.controller');

const router = express.Router();

router.get('/:id', SessionController.getSession);
router.post('/:id', SessionController.setSession);
router.patch('/:id', SessionController.updateSessionField);

module.exports = router;
