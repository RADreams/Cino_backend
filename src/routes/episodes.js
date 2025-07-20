const express = require('express');
const router = express.Router();

// Import controllers and middleware
const episodeController = require('../controllers/episodeController');
const { validate, episodeValidation } = require('../middleware/validation');
const { videoLimiter, analyticsLimiter } = require('../middleware/rateLimiter');

/**
 * @route   GET /api/episodes/:episodeId
 * @desc    Get episode by ID
 * @access  Public
 */
router.get(
  '/:episodeId',
  validate(episodeValidation.getEpisode),
  episodeController.getEpisodeById
);

/**
 * @route   POST /api/episodes/:episodeId/start
 * @desc    Start watching episode
 * @access  Public
 */
router.post(
  '/:episodeId/start',
  videoLimiter,
  episodeController.startWatching
);

/**
 * @route   PUT /api/episodes/:episodeId/progress
 * @desc    Update watch progress
 * @access  Public
 */
router.put(
  '/:episodeId/progress',
  analyticsLimiter,
  validate(episodeValidation.updateWatchProgress),
  episodeController.updateWatchProgress
);

/**
 * @route   POST /api/episodes/:episodeId/complete
 * @desc    Mark episode as completed
 * @access  Public
 */
router.post(
  '/:episodeId/complete',
  episodeController.markCompleted
);

/**
 * @route   GET /api/episodes/:episodeId/analytics
 * @desc    Get episode analytics
 * @access  Public
 */
router.get(
  '/:episodeId/analytics',
  validate(episodeValidation.getEpisode),
  episodeController.getEpisodeAnalytics
);

/**
 * @route   POST /api/episodes/:episodeId/like
 * @desc    Like/Unlike episode
 * @access  Public
 */
router.post(
  '/:episodeId/like',
  episodeController.toggleLike
);

/**
 * @route   POST /api/episodes/:episodeId/share
 * @desc    Share episode
 * @access  Public
 */
router.post(
  '/:episodeId/share',
  episodeController.shareEpisode
);

/**
 * @route   GET /api/episodes/popular
 * @desc    Get popular episodes
 * @access  Public
 */
router.get(
  '/popular',
  episodeController.getPopularEpisodes
);

/**
 * @route   GET /api/episodes/content/:contentId
 * @desc    Get episodes by content ID
 * @access  Public
 */
router.get(
  '/content/:contentId',
  validate(episodeValidation.getEpisodesByContent),
  episodeController.getEpisodesByContent || ((req, res) => {
    // Fallback implementation
    const Episode = require('../models/Episode');
    const { asyncHandler } = require('../middleware/errorHandler');
    
    asyncHandler(async (req, res) => {
      const { contentId } = req.params;
      const { seasonNumber, page = 1, limit = 20 } = req.query;

      const query = { contentId, status: 'published' };
      if (seasonNumber) {
        query.seasonNumber = parseInt(seasonNumber);
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const episodes = await Episode.find(query)
        .sort({ seasonNumber: 1, episodeNumber: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

      res.status(200).json({
        success: true,
        data: episodes
      });
    })(req, res);
  })
);

module.exports = router;