const express = require('express');
const router = express.Router();

// Import controllers and middleware
const watchlistController = require('../controllers/watchlistController');
const { validate, watchlistValidation } = require('../middleware/validation');
const { generalLimiter, analyticsLimiter } = require('../middleware/rateLimiter');

// Apply rate limiting to all watchlist routes
router.use(generalLimiter);

/**
 * @route   GET /api/watchlist/:userId
 * @desc    Get user's watchlist
 * @access  Public
 */
router.get(
  '/:userId',
  validate(watchlistValidation.getWatchlist),
  watchlistController.getUserWatchlist
);

/**
 * @route   GET /api/watchlist/:userId/continue
 * @desc    Get continue watching list
 * @access  Public
 */
router.get(
  '/:userId/continue',
  watchlistController.getContinueWatching
);

/**
 * @route   GET /api/watchlist/:userId/completed
 * @desc    Get completed content
 * @access  Public
 */
router.get(
  '/:userId/completed',
  watchlistController.getCompletedContent
);

/**
 * @route   GET /api/watchlist/:userId/stats
 * @desc    Get user watch statistics
 * @access  Public
 */
router.get(
  '/:userId/stats',
  watchlistController.getUserWatchStats
);

/**
 * @route   POST /api/watchlist
 * @desc    Add to watchlist
 * @access  Public
 */
router.post(
  '/',
  validate(watchlistValidation.addToWatchlist),
  watchlistController.addToWatchlist
);

/**
 * @route   DELETE /api/watchlist/:userId/:episodeId
 * @desc    Remove from watchlist
 * @access  Public
 */
router.delete(
  '/:userId/:episodeId',
  watchlistController.removeFromWatchlist
);

/**
 * @route   PUT /api/watchlist/:userId/:episodeId/progress
 * @desc    Update watch progress
 * @access  Public
 */
router.put(
  '/:userId/:episodeId/progress',
  analyticsLimiter,
  validate(watchlistValidation.updateWatchProgress),
  watchlistController.updateWatchProgress
);

/**
 * @route   POST /api/watchlist/:userId/:contentId/rate
 * @desc    Rate content
 * @access  Public
 */
router.post(
  '/:userId/:contentId/rate',
  validate(watchlistValidation.rateContent),
  watchlistController.rateContent
);

/**
 * @route   GET /api/watchlist/:userId/:contentId/progress
 * @desc    Get content progress summary
 * @access  Public
 */
router.get(
  '/:userId/:contentId/progress',
  watchlistController.getContentProgress
);

/**
 * @route   DELETE /api/watchlist/:userId/clear
 * @desc    Clear watch history
 * @access  Public
 */
router.delete(
  '/:userId/clear',
  watchlistController.clearWatchHistory
);

module.exports = router;