const express = require('express');
const router = express.Router();

// Import controllers and middleware
const feedController = require('../controllers/feedController');
const { validate, feedValidation, contentValidation } = require('../middleware/validation');
const { feedLimiter, searchLimiter } = require('../middleware/rateLimiter');

/**
 * @route   GET /api/feed/random
 * @desc    Get random feed for user
 * @access  Public
 */
router.get(
  '/random',
  feedLimiter,
  validate(feedValidation.getFeed),
  feedController.getRandomFeed
);

/**
 * @route   POST /api/feed/personalized
 * @desc    Get personalized feed with user preferences
 * @access  Public
 */
router.post(
  '/personalized',
  feedLimiter,
  validate(feedValidation.getFeedWithPreferences),
  feedController.getPersonalizedFeed
);

/**
 * @route   GET /api/feed/content/:contentId/episodes
 * @desc    Get content episodes (when user swipes right)
 * @access  Public
 */
router.get(
  '/content/:contentId/episodes',
  feedLimiter,
  validate(contentValidation.getContent),
  feedController.getContentEpisodes
);

/**
 * @route   GET /api/feed/trending
 * @desc    Get trending content
 * @access  Public
 */
router.get(
  '/trending',
  feedLimiter,
  feedController.getTrendingContent
);

/**
 * @route   GET /api/feed/popular/:genre
 * @desc    Get popular content by genre
 * @access  Public
 */
router.get(
  '/popular/:genre',
  feedLimiter,
  validate(contentValidation.getContentByGenre),
  feedController.getPopularByGenre
);

/**
 * @route   GET /api/feed/personalized/:userId
 * @desc    Get personalized feed based on user history
 * @access  Public
 */
router.get(
  '/personalized/:userId',
  feedLimiter,
  feedController.getPersonalizedFeed
);

/**
 * @route   GET /api/feed/continue/:userId
 * @desc    Get continue watching feed
 * @access  Public
 */
router.get(
  '/continue/:userId',
  feedLimiter,
  feedController.getContinueWatching
);

/**
 * @route   GET /api/feed/search
 * @desc    Search content
 * @access  Public
 */
router.get(
  '/search',
  searchLimiter,
  validate(contentValidation.searchContent),
  feedController.searchContent
);

/**
 * @route   GET /api/feed/featured
 * @desc    Get featured content (for hero banners)
 * @access  Public
 */
router.get(
  '/featured',
  feedLimiter,
  feedController.getFeaturedContent
);

/**
 * @route   GET /api/feed/editors-picks
 * @desc    Get editor's picks
 * @access  Public
 */
router.get(
  '/editors-picks',
  feedLimiter,
  feedController.getEditorsPicks
);

/**
 * @route   POST /api/feed/refresh-cache
 * @desc    Refresh feed cache (admin function)
 * @access  Public (should be protected in production)
 */
router.post(
  '/refresh-cache',
  feedController.refreshFeedCache
);

module.exports = router;