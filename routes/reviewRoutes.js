const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  createReview,
  deleteReview,
  getReviewList,
  getReviewSummary,
  updateReview,
} = require('../controllers/reviewController');

const router = express.Router();

router.get('/reviews', authMiddleware, (req, res) => {
  if (req.user && req.user.role === 'admin') {
    return require('../controllers/reviewController').listReviewsAdmin(req, res);
  }
  return res.status(403).json({ message: 'Admin access required' });
});
router.get('/users/:userId/reviews', getReviewList);
router.get('/users/:userId/reviews/summary', getReviewSummary);
router.post('/reviews', authMiddleware, createReview);
router.patch('/reviews/:reviewId', authMiddleware, updateReview);
router.patch('/reviews/:reviewId/moderate', authMiddleware, (req, res) => {
  if (req.user && req.user.role === 'admin') {
    return require('../controllers/reviewController').moderateReview(req, res);
  }
  return res.status(403).json({ message: 'Admin access required' });
});
router.delete('/reviews/:reviewId', authMiddleware, deleteReview);

module.exports = router;
