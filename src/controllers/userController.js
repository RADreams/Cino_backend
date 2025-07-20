const User = require('../models/User');
const { setCache, getCache, deleteCache } = require('../config/redis');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const analyticsService = require('../services/analyticsService');

// Create anonymous user
const createUser = asyncHandler(async (req, res) => {
  const { deviceInfo, preferences, location } = req.body;

  // Check if user already exists with this device ID
  if (deviceInfo?.deviceId) {
    const existingUser = await User.findOne({ 
      'deviceInfo.deviceId': deviceInfo.deviceId 
    });
    
    if (existingUser) {
      await existingUser.updateActivity();
      
      return res.status(200).json({
        success: true,
        message: 'User already exists',
        data: {
          userId: existingUser.userId,
          preferences: existingUser.preferences,
          analytics: existingUser.analytics
        }
      });
    }
  }

  // Create new anonymous user
  const userData = {
    deviceInfo: deviceInfo || {},
    preferences: preferences || {},
    location: location || { country: 'India' },
    isAnonymous: true
  };

  const user = await User.create(userData);

  // Cache user data
  await setCache(`user:${user.userId}`, user, 3600); // 1 hour cache

  // Track user creation event
  await analyticsService.trackEvent({
    userId: user.userId,
    eventType: 'app_open',
    category: 'user_interaction',
    deviceInfo,
    location
  });

  res.status(201).json({
    success: true,
    message: 'Anonymous user created successfully',
    data: {
      userId: user.userId,
      preferences: user.preferences,
      isNew: true
    }
  });
});

// Get user by ID
const getUserById = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  // Try cache first
  let user = await getCache(`user:${userId}`);
  
  if (!user) {
    user = await User.findByUserId(userId);
    
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Cache the user
    await setCache(`user:${userId}`, user, 3600);
  }

  // Update last seen
  if (typeof user.updateActivity === 'function') {
    await user.updateActivity();
  } else {
    // If from cache, update in database
    await User.findOneAndUpdate(
      { userId }, 
      { lastSeenAt: new Date(), 'analytics.lastActiveAt': new Date() }
    );
  }

  res.status(200).json({
    success: true,
    data: {
      userId: user.userId,
      preferences: user.preferences,
      analytics: user.analytics,
      engagement: user.engagement,
      lastSeenAt: user.lastSeenAt
    }
  });
});

// Update user profile (optional)
const updateUserProfile = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { username, fullName, email } = req.body;

  const user = await User.findByUserId(userId);
  
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Update profile
  if (username !== undefined) user.profile.username = username;
  if (fullName !== undefined) user.profile.fullName = fullName;
  if (email !== undefined) user.profile.email = email;
  
  // Mark as having profile if any data is provided
  if (username || fullName || email) {
    user.profile.hasProfile = true;
  }

  await user.save();

  // Update cache
  await setCache(`user:${userId}`, user, 3600);

  res.status(200).json({
    success: true,
    message: 'User profile updated successfully',
    data: {
      profile: user.profile,
      hasProfile: user.profile.hasProfile
    }
  });
});

// Update user preferences
const updateUserPreferences = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { preferences, location } = req.body;

  const user = await User.findByUserId(userId);
  
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Update preferences
  if (preferences) {
    Object.assign(user.preferences, preferences);
  }

  // Update location
  if (location) {
    Object.assign(user.location, location);
  }

  await user.save();

  // Update cache
  await setCache(`user:${userId}`, user, 3600);
  
  // Clear related caches
  await deleteCache(`feed:${userId}`);

  res.status(200).json({
    success: true,
    message: 'User preferences updated successfully',
    data: {
      preferences: user.preferences,
      location: user.location
    }
  });
});

// Update user analytics
const updateUserAnalytics = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { watchTime, videosWatched, genre } = req.body;

  const user = await User.findByUserId(userId);
  
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Update analytics
  if (watchTime) {
    user.analytics.totalWatchTime += watchTime;
  }

  if (videosWatched) {
    user.analytics.videosWatched += videosWatched;
  }

  // Update favorite genres
  if (genre) {
    const existingGenre = user.analytics.favoriteGenres.find(g => g.genre === genre);
    if (existingGenre) {
      existingGenre.count += 1;
    } else {
      user.analytics.favoriteGenres.push({ genre, count: 1 });
    }

    // Sort and keep top 10 genres
    user.analytics.favoriteGenres.sort((a, b) => b.count - a.count);
    user.analytics.favoriteGenres = user.analytics.favoriteGenres.slice(0, 10);
  }

  // Calculate average session duration
  user.analytics.totalSessions += 1;
  user.analytics.averageSessionDuration = 
    user.analytics.totalWatchTime / user.analytics.totalSessions;

  await user.save();

  // Update cache
  await setCache(`user:${userId}`, user, 3600);

  res.status(200).json({
    success: true,
    message: 'User analytics updated successfully',
    data: {
      analytics: user.analytics
    }
  });
});

// Get user statistics
const getUserStats = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  // Try cache first
  let stats = await getCache(`stats:${userId}`);

  if (!stats) {
    const user = await User.findByUserId(userId);
    
    if (!user) {
      throw new AppError('User not found', 404);
    }

    stats = {
      totalWatchTime: user.analytics.totalWatchTime,
      videosWatched: user.analytics.videosWatched,
      averageSessionDuration: user.analytics.averageSessionDuration,
      totalSessions: user.analytics.totalSessions,
      favoriteGenres: user.analytics.favoriteGenres,
      engagement: user.engagement,
      memberSince: user.firstSeenAt,
      lastActive: user.lastSeenAt
    };

    // Cache for 30 minutes
    await setCache(`stats:${userId}`, stats, 1800);
  }

  res.status(200).json({
    success: true,
    data: stats
  });
});

// Update user engagement
const updateUserEngagement = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { likes, shares, swipeRight, swipeLeft, videoCompletion } = req.body;

  const user = await User.findByUserId(userId);
  
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Update engagement metrics
  if (typeof likes === 'number') {
    user.engagement.likes += likes;
  }

  if (typeof shares === 'number') {
    user.engagement.shares += shares;
  }

  if (typeof swipeRight === 'number') {
    user.engagement.swipeRight += swipeRight;
  }

  if (typeof swipeLeft === 'number') {
    user.engagement.swipeLeft += swipeLeft;
  }

  if (typeof videoCompletion === 'number') {
    // Calculate moving average of video completion
    const totalCompletions = user.engagement.averageVideoCompletion * user.analytics.videosWatched;
    const newTotal = totalCompletions + videoCompletion;
    user.engagement.averageVideoCompletion = newTotal / (user.analytics.videosWatched + 1);
  }

  await user.save();

  // Update cache
  await setCache(`user:${userId}`, user, 3600);

  res.status(200).json({
    success: true,
    message: 'User engagement updated successfully',
    data: {
      engagement: user.engagement
    }
  });
});

// Get user recommendations based on preferences
const getUserRecommendations = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { limit = 10 } = req.query;

  const user = await User.findByUserId(userId);
  
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Try cache first
  const cacheKey = `recommendations:${userId}:${limit}`;
  let recommendations = await getCache(cacheKey);

  if (!recommendations) {
    const Content = require('../models/Content');
    
    // Get recommendations based on user preferences
    const query = {
      status: 'published',
      'feedSettings.isInRandomFeed': true
    };

    // Add genre preferences
    if (user.preferences.preferredGenres?.length > 0) {
      query.genre = { $in: user.preferences.preferredGenres };
    }

    // Add language preferences
    if (user.preferences.preferredLanguages?.length > 0) {
      query.language = { $in: user.preferences.preferredLanguages };
    }

    recommendations = await Content.find(query)
      .sort({ 'analytics.popularityScore': -1 })
      .limit(parseInt(limit))
      .populate('episodeIds', 'episodeNumber title thumbnail duration')
      .lean();

    // Cache for 1 hour
    await setCache(cacheKey, recommendations, 3600);
  }

  res.status(200).json({
    success: true,
    data: recommendations
  });
});

// Delete user (GDPR compliance)
const deleteUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const user = await User.findByUserId(userId);
  
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Delete user data
  await User.deleteOne({ userId });
  
  // Delete from cache
  await deleteCache(`user:${userId}`);
  await deleteCache(`stats:${userId}`);
  await deleteCache(`recommendations:${userId}:*`);
  await deleteCache(`feed:${userId}`);

  // Note: In production, you might want to:
  // 1. Anonymize analytics data instead of deleting
  // 2. Keep aggregated stats for business intelligence
  // 3. Follow data retention policies

  res.status(200).json({
    success: true,
    message: 'User deleted successfully'
  });
});

// Get active users count (for admin)
const getActiveUsersCount = asyncHandler(async (req, res) => {
  const { days = 7 } = req.query;

  // Try cache first
  const cacheKey = `active_users:${days}`;
  let count = await getCache(cacheKey);

  if (count === null) {
    const date = new Date();
    date.setDate(date.getDate() - parseInt(days));
    
    count = await User.countDocuments({
      lastSeenAt: { $gte: date },
      status: 'active'
    });

    // Cache for 15 minutes
    await setCache(cacheKey, count, 900);
  }

  res.status(200).json({
    success: true,
    data: {
      activeUsers: count,
      period: `${days} days`
    }
  });
});

module.exports = {
  createUser,
  getUserById,
  updateUserProfile,
  updateUserPreferences,
  updateUserAnalytics,
  getUserStats,
  updateUserEngagement,
  getUserRecommendations,
  deleteUser,
  getActiveUsersCount
};