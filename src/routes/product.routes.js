const express = require('express');
const ProductController = require('../controllers/product.controller');

const router = express.Router();

router.get('/:id', ProductController.getProduct);
router.post('/:id', ProductController.updateProduct);
router.post('/:id/view', ProductController.recordView);

module.exports = router;
