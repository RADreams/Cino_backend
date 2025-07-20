const express = require('express');
const router = express.Router();

// Import controllers and middleware
const userController = require('../controllers/userController');
const { validate, userValidation } = require('../middleware/validation');
const { generalLimiter, analyticsLimiter } = require('../middleware/rateLimiter');

// Apply rate limiting to all user routes
router.use(generalLimiter);

/**
 * @route   POST /api/users
 * @desc    Create anonymous user
 * @access  Public
 */
router.post(
  '/',
  validate(userValidation.createUser),
  userController.createUser
);

/**
 * @route   GET /api/users/:userId
 * @desc    Get user by ID
 * @access  Public
 */
router.get(
  '/:userId',
  validate(userValidation.getUserById),
  userController.getUserById
);

/**
 * @route   PUT /api/users/:userId/profile
 * @desc    Update user profile (optional)
 * @access  Public
 */
router.put(
  '/:userId/profile',
  userController.updateUserProfile
);

/**
 * @route   PUT /api/users/:userId/preferences
 * @desc    Update user preferences
 * @access  Public
 */
router.put(
  '/:userId/preferences',
  validate(userValidation.updateUser),
  userController.updateUserPreferences
);

/**
 * @route   PUT /api/users/:userId/analytics
 * @desc    Update user analytics
 * @access  Public
 */
router.put(
  '/:userId/analytics',
  analyticsLimiter,
  userController.updateUserAnalytics
);

/**
 * @route   GET /api/users/:userId/stats
 * @desc    Get user statistics
 * @access  Public
 */
router.get(
  '/:userId/stats',
  validate(userValidation.getUserById),
  userController.getUserStats
);

/**
 * @route   PUT /api/users/:userId/engagement
 * @desc    Update user engagement metrics
 * @access  Public
 */
router.put(
  '/:userId/engagement',
  analyticsLimiter,
  userController.updateUserEngagement
);

/**
 * @route   GET /api/users/:userId/recommendations
 * @desc    Get user recommendations
 * @access  Public
 */
router.get(
  '/:userId/recommendations',
  validate(userValidation.getUserById),
  userController.getUserRecommendations
);

/**
 * @route   DELETE /api/users/:userId
 * @desc    Delete user (GDPR compliance)
 * @access  Public
 */
router.delete(
  '/:userId',
  validate(userValidation.getUserById),
  userController.deleteUser
);

/**
 * @route   GET /api/users/active/count
 * @desc    Get active users count (for admin/analytics)
 * @access  Public
 */
router.get(
  '/active/count',
  userController.getActiveUsersCount
);

module.exports = router;