const mongoose = require('mongoose');
const Review = require('../models/review');
const User = require('../models/user');

const buildRatingSummary = (reviews = []) => {
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return {
      averageRating: 0,
      totalReviews: 0,
      ratingCount: 0,
    };
  }

  const total = reviews.reduce((sum, item) => sum + Number(item.rating || 0), 0);
  const averageRating = Number((total / reviews.length).toFixed(1));

  return {
    averageRating,
    totalReviews: reviews.length,
    ratingCount: reviews.length,
  };
};

const normalizeReviewInput = (input = {}) => {
  const rating = Number(input.rating);

  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw new Error('Rating must be between 1 and 5');
  }

  const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
  if (comment.length > 1000) {
    throw new Error('Review comment must be 1000 characters or less');
  }

  return {
    rating: Math.round(rating),
    comment,
  };
};

const normalizeModerationPayload = (input = {}) => {
  const allowedStatuses = ['active', 'hidden', 'flagged'];
  const status = String(input.status ?? '').trim();

  if (!allowedStatuses.includes(status)) {
    throw new Error('Review status must be one of active, hidden, or flagged');
  }

  const moderationNote = typeof input.moderationNote === 'string'
    ? input.moderationNote.trim()
    : '';

  if (moderationNote.length > 500) {
    throw new Error('Moderation note must be 500 characters or less');
  }

  return {
    status,
    moderationNote,
  };
};

const recomputeOwnerRating = async (reviewedUserId) => {
  const targetId = String(reviewedUserId);

  const [summary] = await Review.aggregate([
    {
      $match: {
        reviewedUserId: new mongoose.Types.ObjectId(targetId),
        status: { $ne: 'hidden' },
      },
    },
    {
      $group: {
        _id: null,
        totalReviews: { $sum: 1 },
        averageRating: { $avg: '$rating' },
      },
    },
  ]);

  const user = await User.findById(targetId);
  if (!user) {
    return null;
  }

  const totalReviews = summary?.totalReviews ?? 0;
  const averageRating = summary?.averageRating ?? 0;
  const latestReview = await Review.findOne({
    reviewedUserId: targetId,
    status: { $ne: 'hidden' },
  }).sort({ createdAt: -1 });

  user.averageRating = totalReviews ? Number(Number(averageRating).toFixed(1)) : 0;
  user.totalReviews = totalReviews;
  user.ratingCount = totalReviews;
  user.lastReviewedAt = latestReview ? latestReview.createdAt : null;
  await user.save();

  return {
    averageRating: user.averageRating,
    totalReviews: user.totalReviews,
    ratingCount: user.ratingCount,
    lastReviewedAt: user.lastReviewedAt,
  };
};

const serializeReview = (review) => {
  const reviewer = review.reviewerId && review.reviewerId._id ? review.reviewerId : null;
  const property = review.propertyId && review.propertyId._id ? review.propertyId : null;

  return {
    id: String(review._id),
    reviewerId: reviewer ? String(reviewer._id) : String(review.reviewerId || ''),
    reviewedUserId: String(review.reviewedUserId),
    propertyId: property ? String(property._id) : review.propertyId ? String(review.propertyId) : null,
    rating: Number(review.rating),
    comment: review.comment || '',
    status: review.status,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    reviewer: reviewer
      ? {
          id: String(reviewer._id),
          firstName: reviewer.firstName || '',
          lastName: reviewer.lastName || '',
          avatar: reviewer.avatar || null,
        }
      : null,
    property: property
      ? {
          id: String(property._id),
          name: property.name || 'Property',
        }
      : null,
  };
};

const getReviewList = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const reviews = await Review.find({
      reviewedUserId: userId,
      status: { $ne: 'hidden' },
    })
      .sort({ createdAt: -1 })
      .populate('reviewerId', 'firstName lastName avatar')
      .populate('propertyId', 'name');

    return res.status(200).json({
      success: true,
      reviews: reviews.map(serializeReview),
    });
  } catch (error) {
    console.error('List reviews error:', error.message);
    return res.status(500).json({ message: 'Unable to load reviews' });
  }
};

const getReviewSummary = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const reviews = await Review.find({
      reviewedUserId: userId,
      status: { $ne: 'hidden' },
    });

    return res.status(200).json({
      success: true,
      summary: buildRatingSummary(reviews),
    });
  } catch (error) {
    console.error('Review summary error:', error.message);
    return res.status(500).json({ message: 'Unable to load review summary' });
  }
};

const listReviewsAdmin = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const reviews = await Review.find(filter)
      .sort({ createdAt: -1 })
      .populate('reviewerId', 'firstName lastName avatar')
      .populate('reviewedUserId', 'firstName lastName role')
      .populate('propertyId', 'name');

    return res.status(200).json({
      success: true,
      reviews: reviews.map(serializeReview),
    });
  } catch (error) {
    console.error('Admin list reviews error:', error.message);
    return res.status(500).json({ message: 'Unable to load review moderation queue' });
  }
};

const createReview = async (req, res) => {
  try {
    const reviewerId = req.user.userId;
    const { reviewedUserId, propertyId, comment } = req.body;

    if (!mongoose.Types.ObjectId.isValid(reviewedUserId)) {
      return res.status(400).json({ message: 'Invalid reviewed user id' });
    }

    if (String(reviewedUserId) === String(reviewerId)) {
      return res.status(400).json({ message: 'You cannot review your own profile' });
    }

    const reviewedUser = await User.findById(reviewedUserId);
    if (!reviewedUser || !['landlord', 'propertyManager'].includes(reviewedUser.role)) {
      return res.status(404).json({ message: 'Reviewed profile not found' });
    }

    const existingReview = await Review.findOne({
      reviewerId,
      reviewedUserId,
    });

    if (existingReview) {
      return res.status(409).json({ message: 'You already reviewed this lister' });
    }

    if (propertyId && !mongoose.Types.ObjectId.isValid(propertyId)) {
      return res.status(400).json({ message: 'Invalid property id' });
    }

    const payload = normalizeReviewInput({ rating: req.body.rating, comment });

    const review = await Review.create({
      reviewerId,
      reviewedUserId,
      propertyId: propertyId || null,
      rating: payload.rating,
      comment: payload.comment,
      status: 'active',
    });

    await recomputeOwnerRating(reviewedUserId);

    return res.status(201).json({
      success: true,
      review: serializeReview(
        await Review.findById(review._id)
          .populate('reviewerId', 'firstName lastName avatar')
          .populate('propertyId', 'name'),
      ),
    });
  } catch (error) {
    if (error.message && /Rating must be between 1 and 5/i.test(error.message)) {
      return res.status(400).json({ message: error.message });
    }
    console.error('Create review error:', error.message);
    return res.status(500).json({ message: 'Unable to create review' });
  }
};

const updateReview = async (req, res) => {
  try {
    const review = await Review.findById(req.params.reviewId);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    if (String(review.reviewerId) !== String(req.user.userId)) {
      return res.status(403).json({ message: 'You can only edit your own review' });
    }

    const payload = normalizeReviewInput({
      rating: req.body.rating ?? review.rating,
      comment: req.body.comment ?? review.comment,
    });

    review.rating = payload.rating;
    review.comment = payload.comment;
    await review.save();
    await recomputeOwnerRating(review.reviewedUserId);

    return res.status(200).json({
      success: true,
      review: serializeReview(
        await Review.findById(review._id)
          .populate('reviewerId', 'firstName lastName avatar')
          .populate('propertyId', 'name'),
      ),
    });
  } catch (error) {
    if (error.message && /Rating must be between 1 and 5/i.test(error.message)) {
      return res.status(400).json({ message: error.message });
    }
    console.error('Update review error:', error.message);
    return res.status(500).json({ message: 'Unable to update review' });
  }
};

const deleteReview = async (req, res) => {
  try {
    const review = await Review.findById(req.params.reviewId);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    if (String(review.reviewerId) !== String(req.user.userId)) {
      return res.status(403).json({ message: 'You can only delete your own review' });
    }

    const reviewedUserId = String(review.reviewedUserId);
    await review.deleteOne();
    await recomputeOwnerRating(reviewedUserId);

    return res.status(200).json({
      success: true,
      message: 'Review removed successfully',
      reviewId: req.params.reviewId,
    });
  } catch (error) {
    console.error('Delete review error:', error.message);
    return res.status(500).json({ message: 'Unable to delete review' });
  }
};

const moderateReview = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const review = await Review.findById(req.params.reviewId);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    const payload = normalizeModerationPayload(req.body);
    review.status = payload.status;
    review.moderationNote = payload.moderationNote;
    await review.save();
    await recomputeOwnerRating(review.reviewedUserId);

    return res.status(200).json({
      success: true,
      review: serializeReview(
        await Review.findById(review._id)
          .populate('reviewerId', 'firstName lastName avatar')
          .populate('propertyId', 'name'),
      ),
    });
  } catch (error) {
    if (error.message && /status must be one of/i.test(error.message)) {
      return res.status(400).json({ message: error.message });
    }
    console.error('Moderate review error:', error.message);
    return res.status(500).json({ message: 'Unable to moderate review' });
  }
};

module.exports = {
  buildRatingSummary,
  normalizeReviewInput,
  normalizeModerationPayload,
  recomputeOwnerRating,
  getReviewList,
  getReviewSummary,
  listReviewsAdmin,
  createReview,
  updateReview,
  deleteReview,
  moderateReview,
};
