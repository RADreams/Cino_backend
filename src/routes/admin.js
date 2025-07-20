const express = require('express');
const multer = require('multer');
const router = express.Router();

// Import controllers and middleware
const adminController = require('../controllers/adminController');
const analyticsService = require('../services/analyticsService');
const { validate, adminValidation, fileValidation, analyticsValidation } = require('../middleware/validation');
const { strictLimiter } = require('../middleware/rateLimiter');
const { optionalAuth, adminLogin, requireAdmin, validateApiKey } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024, // 100MB default
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'video') {
      const allowedTypes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo'];
      cb(null, allowedTypes.includes(file.mimetype));
    } else if (file.fieldname === 'thumbnail' || file.fieldname === 'poster') {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      cb(null, allowedTypes.includes(file.mimetype));
    } else {
      cb(null, false);
    }
  }
});

// Apply strict rate limiting to all admin routes
router.use(strictLimiter);

// Add requireAdmin to all routes except /login
router.use((req, res, next) => {
  if (req.path === '/login') return next();
  return require('../middleware/auth').requireAdmin(req, res, next);
});

/**
 * @route   POST /api/admin/login
 * @desc    Admin login (for demo/testing)
 * @access  Public
 */
router.post('/login', adminLogin);

/**
 * @route   POST /api/admin/content
 * @desc    Create new content
 * @access  Admin
 */
router.post(
  '/content',
  validate(adminValidation.createContent),
  adminController.createContent
);

/**
 * @route   POST /api/admin/upload-video
 * @desc    Upload video and create episode
 * @access  Admin
 */
router.post(
  '/upload-video',
  upload.single('video'),
  fileValidation.videoUpload,
  validate(adminValidation.uploadVideo),
  adminController.uploadVideo
);

/**
 * @route   POST /api/admin/upload-thumbnail/:episodeId
 * @desc    Upload thumbnail for episode
 * @access  Admin
 */
router.post(
  '/upload-thumbnail/:episodeId',
  upload.single('thumbnail'),
  fileValidation.imageUpload,
  asyncHandler(async (req, res) => {
    const { episodeId } = req.params;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No thumbnail file provided'
      });
    }

    // Upload thumbnail to GCP
    const { uploadVideoToGCP } = require('../config/gcp');
    const fileName = `thumbnails/episode_${episodeId}_${Date.now()}.jpg`;
    
    try {
      const uploadResult = await uploadVideoToGCP(
        req.file.buffer,
        fileName,
        { contentType: req.file.mimetype }
      );

      // Update episode with thumbnail URL
      const Episode = require('../models/Episode');
      const episode = await Episode.findById(episodeId);
      
      if (!episode) {
        return res.status(404).json({
          success: false,
          error: 'Episode not found'
        });
      }

      episode.thumbnailUrl = uploadResult.publicUrl;
      await episode.save();

      res.status(200).json({
        success: true,
        message: 'Thumbnail uploaded successfully',
        data: {
          episodeId,
          thumbnailUrl: uploadResult.publicUrl
        }
      });

    } catch (error) {
      console.error('Thumbnail upload error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to upload thumbnail'
      });
    }
  })
);

/**
 * @route   PUT /api/admin/content/:contentId/feed-settings
 * @desc    Update content feed settings
 * @access  Admin
 */
router.put(
  '/content/:contentId/feed-settings',
  validate(adminValidation.updateFeedSettings),
  adminController.updateFeedSettings
);

/**
 * @route   POST /api/admin/content/:contentId/publish
 * @desc    Publish content
 * @access  Admin
 */
router.post(
  '/content/:contentId/publish',
  adminController.publishContent
);

/**
 * @route   GET /api/admin/content/:contentId/analytics
 * @desc    Get content analytics
 * @access  Admin
 */
router.get(
  '/content/:contentId/analytics',
  adminController.getContentAnalytics
);

/**
 * @route   GET /api/admin/analytics/platform
 * @desc    Get platform analytics
 * @access  Admin
 */
router.get(
  '/analytics/platform',
  adminController.getPlatformAnalytics
);

/**
 * @route   DELETE /api/admin/content/:contentId
 * @desc    Delete content
 * @access  Admin
 */
router.delete(
  '/content/:contentId',
  adminController.deleteContent
);

/**
 * @route   PUT /api/admin/episode/:episodeId
 * @desc    Update episode
 * @access  Admin
 */
router.put(
  '/episode/:episodeId',
  adminController.updateEpisode
);

/**
 * @route   GET /api/admin/content
 * @desc    Get all content (admin view)
 * @access  Admin
 */
router.get(
  '/content',
  adminController.getAllContent
);

/**
 * @route   PUT /api/admin/content/bulk-update
 * @desc    Bulk update content status
 * @access  Admin
 */
router.put(
  '/content/bulk-update',
  adminController.bulkUpdateContent
);

/**
 * @route   GET /api/admin/system/health
 * @desc    System health check
 * @access  Admin
 */
router.get(
  '/system/health',
  adminController.getSystemHealth
);

/**
 * @route   GET /api/admin/system/health
 * @desc    System health check
 * @access  Admin
 */
router.get(
  '/system/health',
  adminController.getSystemHealth
);

/**
 * @route   GET /api/admin/system/gcp-health
 * @desc    GCP service health check
 * @access  Admin
 */
router.get(
  '/system/gcp-health',
  asyncHandler(async (req, res) => {
    const gcpService = require('../services/gcpService');
    const healthStatus = await gcpService.healthCheck();
    
    res.status(healthStatus.status === 'healthy' ? 200 : 503).json({
      success: healthStatus.status === 'healthy',
      data: healthStatus
    });
  })
);

/**
 * @route   GET /api/admin/storage/stats
 * @desc    Get storage usage statistics
 * @access  Admin
 */
router.get(
  '/storage/stats',
  asyncHandler(async (req, res) => {
    const gcpService = require('../services/gcpService');
    const stats = await gcpService.getStorageStats();
    
    res.status(200).json({
      success: true,
      data: stats
    });
  })
);

/**
 * @route   POST /api/admin/analytics/track
 * @desc    Track analytics event (for testing)
 * @access  Admin
 */
router.post(
  '/analytics/track',
  validate(analyticsValidation.trackEvent),
  asyncHandler(async (req, res) => {
    const eventId = await analyticsService.trackEvent(req.body);
    
    res.status(200).json({
      success: true,
      message: 'Analytics event tracked',
      data: { eventId }
    });
  })
);

/**
 * @route   GET /api/admin/analytics/report
 * @desc    Generate analytics report
 * @access  Admin
 */
router.get(
  '/analytics/report',
  asyncHandler(async (req, res) => {
    const {
      startDate,
      endDate,
      userId,
      contentId,
      reportType = 'overview'
    } = req.query;

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    const report = await analyticsService.generateReport({
      startDate: start,
      endDate: end,
      userId,
      contentId,
      reportType
    });

    res.status(200).json({
      success: true,
      data: report
    });
  })
);

/**
 * @route   GET /api/admin/analytics/realtime
 * @desc    Get real-time analytics
 * @access  Admin
 */
router.get(
  '/analytics/realtime',
  asyncHandler(async (req, res) => {
    const realTimeData = await analyticsService.getRealTimeAnalytics();
    
    res.status(200).json({
      success: true,
      data: realTimeData
    });
  })
);

/**
 * @route   POST /api/admin/cache/clear
 * @desc    Clear application cache
 * @access  Admin
 */
router.post(
  '/cache/clear',
  asyncHandler(async (req, res) => {
    const cacheService = require('../services/cacheService');
    const clearedKeys = await cacheService.clearAllCache();
    
    res.status(200).json({
      success: true,
      message: 'Cache cleared successfully',
      data: { clearedKeys }
    });
  })
);

/**
 * @route   GET /api/admin/cache/stats
 * @desc    Get cache statistics
 * @access  Admin
 */
router.get(
  '/cache/stats',
  asyncHandler(async (req, res) => {
    const cacheService = require('../services/cacheService');
    const stats = await cacheService.getCacheStats();
    
    res.status(200).json({
      success: true,
      data: stats
    });
  })
);

/**
 * @route   POST /api/admin/cache/warm
 * @desc    Warm up cache with popular data
 * @access  Admin
 */
router.post(
  '/cache/warm',
  asyncHandler(async (req, res) => {
    const cacheService = require('../services/cacheService');
    const result = await cacheService.warmCache();
    
    res.status(200).json({
      success: true,
      message: result ? 'Cache warming completed' : 'Cache warming failed'
    });
  })
);

/**
 * @route   POST /api/admin/analytics/cleanup
 * @desc    Clean up old analytics data
 * @access  Admin
 */
router.post(
  '/analytics/cleanup',
  asyncHandler(async (req, res) => {
    const { daysToKeep = 365 } = req.body;
    const deletedCount = await analyticsService.cleanupOldData(daysToKeep);
    
    res.status(200).json({
      success: true,
      message: 'Analytics cleanup completed',
      data: { deletedRecords: deletedCount }
    });
  })
);

module.exports = router;