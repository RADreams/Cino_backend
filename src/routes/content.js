const express = require('express');
const router = express.Router();

// Import controllers and middleware
const { validate, contentValidation } = require('../middleware/validation');
const { generalLimiter } = require('../middleware/rateLimiter');
const Content = require('../models/Content');
const { asyncHandler } = require('../middleware/errorHandler');

// Apply rate limiting to all content routes
router.use(generalLimiter);

/**
 * @route   GET /api/content/:contentId
 * @desc    Get content by ID
 * @access  Public
 */
router.get(
  '/:contentId',
  validate(contentValidation.getContent),
  asyncHandler(async (req, res) => {
    const { contentId } = req.params;

    const content = await Content.findById(contentId)
      .populate('episodeIds', 'episodeNumber title thumbnailUrl duration status')
      .lean();

    if (!content) {
      return res.status(404).json({
        success: false,
        error: 'Content not found'
      });
    }

    res.status(200).json({
      success: true,
      data: content
    });
  })
);

/**
 * @route   GET /api/content/:contentId/episodes
 * @desc    Get all episodes for content
 * @access  Public
 */
router.get(
  '/:contentId/episodes',
  validate(contentValidation.getContent),
  asyncHandler(async (req, res) => {
    const { contentId } = req.params;
    const { seasonNumber } = req.query;

    const Episode = require('../models/Episode');
    
    const query = { contentId, status: 'published' };
    if (seasonNumber) {
      query.seasonNumber = parseInt(seasonNumber);
    }

    const episodes = await Episode.find(query)
      .sort({ seasonNumber: 1, episodeNumber: 1 })
      .lean();

    res.status(200).json({
      success: true,
      data: episodes
    });
  })
);

/**
 * @route   GET /api/content/genre/:genre
 * @desc    Get content by genre
 * @access  Public
 */
router.get(
  '/genre/:genre',
  validate(contentValidation.getContentByGenre),
  asyncHandler(async (req, res) => {
    const { genre } = req.params;
    const { language, page = 1, limit = 20 } = req.query;

    const query = {
      status: 'published',
      genre: { $in: [genre] }
    };

    if (language) {
      query.language = { $in: [language] };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [content, totalCount] = await Promise.all([
      Content.find(query)
        .sort({ 'analytics.popularityScore': -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('episodeIds', 'episodeNumber title thumbnailUrl duration', null, { 
          sort: { episodeNumber: 1 }, 
          limit: 3 
        })
        .lean(),
      Content.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        content,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCount / parseInt(limit)),
          totalItems: totalCount,
          hasNext: skip + content.length < totalCount
        }
      }
    });
  })
);

/**
 * @route   GET /api/content/type/:type
 * @desc    Get content by type (movie, series, web-series)
 * @access  Public
 */
router.get(
  '/type/:type',
  asyncHandler(async (req, res) => {
    const { type } = req.params;
    const { page = 1, limit = 20, sortBy = 'popularityScore' } = req.query;

    const validTypes = ['movie', 'series', 'web-series'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid content type'
      });
    }

    const query = { status: 'published', type };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Sort options
    const sortOptions = {
      popularityScore: { 'analytics.popularityScore': -1 },
      newest: { publishedAt: -1 },
      rating: { 'analytics.averageRating': -1 },
      views: { 'analytics.totalViews': -1 }
    };

    const sort = sortOptions[sortBy] || sortOptions.popularityScore;

    const [content, totalCount] = await Promise.all([
      Content.find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .populate('episodeIds', 'episodeNumber title thumbnailUrl duration', null, { 
          sort: { episodeNumber: 1 }, 
          limit: 1 
        })
        .lean(),
      Content.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        content,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCount / parseInt(limit)),
          totalItems: totalCount,
          hasNext: skip + content.length < totalCount
        }
      }
    });
  })
);

/**
 * @route   GET /api/content/search
 * @desc    Search content (alias for feed search)
 * @access  Public
 */
router.get('/search', (req, res) => {
  // Redirect to feed search
  res.redirect(307, `/api/feed/search?${req.url.split('?')[1] || ''}`);
});

/**
 * @route   GET /api/content/:contentId/similar
 * @desc    Get similar content
 * @access  Public
 */
router.get(
  '/:contentId/similar',
  validate(contentValidation.getContent),
  asyncHandler(async (req, res) => {
    const { contentId } = req.params;
    const { limit = 10 } = req.query;

    const feedService = require('../services/feedService');
    const similarContent = await feedService.getSimilarContent(contentId, parseInt(limit));

    res.status(200).json({
      success: true,
      data: similarContent
    });
  })
);

/**
 * @route   GET /api/content/:contentId/analytics
 * @desc    Get content analytics (basic version)
 * @access  Public
 */
router.get(
  '/:contentId/analytics',
  validate(contentValidation.getContent),
  asyncHandler(async (req, res) => {
    const { contentId } = req.params;

    const content = await Content.findById(contentId, 'analytics title type').lean();
    
    if (!content) {
      return res.status(404).json({
        success: false,
        error: 'Content not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        title: content.title,
        type: content.type,
        analytics: content.analytics
      }
    });
  })
);

module.exports = router;