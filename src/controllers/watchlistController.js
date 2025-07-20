const Watchlist = require('../models/Watchlist');
const Content = require('../models/Content');
const Episode = require('../models/Episode');
const User = require('../models/User');
const { setCache, getCache, deleteCache } = require('../config/redis');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const analyticsService = require('../services/analyticsService');

// Get user's watchlist
const getUserWatchlist = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { status, page = 1, limit = 20 } = req.query;

  // Build cache key
  const cacheKey = `watchlist:${userId}:${status || 'all'}:${page}:${limit}`;
  
  // Try cache first
  let watchlist = await getCache(cacheKey);

  if (!watchlist) {
    const query = { userId };
    if (status) {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    watchlist = await Watchlist.find(query)
      .sort({ 'sessionInfo.lastWatchedAt': -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('contentId', 'title thumbnail genre language type')
      .populate('episodeId', 'title episodeNumber thumbnailUrl duration')
      .lean();

    // Cache for 10 minutes
    await setCache(cacheKey, watchlist, 600);
  }

  res.status(200).json({
    success: true,
    data: {
      watchlist,
      page: parseInt(page),
      hasMore: watchlist.length === parseInt(limit)
    }
  });
});

// Get continue watching list
const getContinueWatching = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { limit = 10 } = req.query;

  // Try cache first
  const cacheKey = `continue_watching:${userId}:${limit}`;
  let continueWatching = await getCache(cacheKey);

  if (!continueWatching) {
    continueWatching = await Watchlist.getContinueWatching(userId, parseInt(limit));
    
    // Format data for better UX
    const formattedData = continueWatching.map(item => ({
      ...item.toObject(),
      resumeText: `Continue Episode ${item.episodeDetails.episodeNumber}`,
      progressText: `${Math.round(item.watchProgress.percentageWatched)}% watched`,
      timeLeft: Math.max(0, item.watchProgress.totalDuration - item.watchProgress.currentPosition)
    }));

    // Cache for 5 minutes (short cache as this changes frequently)
    await setCache(cacheKey, formattedData, 300);
    continueWatching = formattedData;
  }

  res.status(200).json({
    success: true,
    data: continueWatching
  });
});

// Get completed content
const getCompletedContent = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  // Try cache first
  const cacheKey = `completed:${userId}:${page}:${limit}`;
  let completedContent = await getCache(cacheKey);

  if (!completedContent) {
    const skip = (parseInt(page) - 1) * parseInt(limit);

    completedContent = await Watchlist.find({
      userId,
      'watchProgress.isCompleted': true
    })
      .sort({ 'sessionInfo.completedAt': -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('contentId', 'title thumbnail genre language type totalEpisodes')
      .populate('episodeId', 'title episodeNumber duration')
      .lean();

    // Group by content to show series completion status
    const contentMap = new Map();
    
    for (const item of completedContent) {
      const contentId = item.contentId._id.toString();
      
      if (!contentMap.has(contentId)) {
        contentMap.set(contentId, {
          content: item.contentId,
          completedEpisodes: [],
          totalCompleted: 0,
          lastCompleted: item.sessionInfo.completedAt
        });
      }
      
      const contentData = contentMap.get(contentId);
      contentData.completedEpisodes.push({
        episodeId: item.episodeId._id,
        episodeNumber: item.episodeDetails.episodeNumber,
        title: item.episodeId.title,
        completedAt: item.sessionInfo.completedAt
      });
      contentData.totalCompleted += 1;
    }

    completedContent = Array.from(contentMap.values())
      .sort((a, b) => new Date(b.lastCompleted) - new Date(a.lastCompleted));

    // Cache for 30 minutes
    await setCache(cacheKey, completedContent, 1800);
  }

  res.status(200).json({
    success: true,
    data: {
      completedContent,
      page: parseInt(page),
      hasMore: completedContent.length === parseInt(limit)
    }
  });
});

// Get user watch statistics
const getUserWatchStats = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { timeframe = 30 } = req.query; // days

  // Try cache first
  const cacheKey = `watch_stats:${userId}:${timeframe}`;
  let stats = await getCache(cacheKey);

  if (!stats) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(timeframe));

    // Get basic stats
    const [basicStats, genreStats, dailyStats] = await Promise.all([
      Watchlist.getUserStats(userId),
      Watchlist.aggregate([
        { $match: { userId, 'sessionInfo.lastWatchedAt': { $gte: startDate } } },
        {
          $lookup: {
            from: 'contents',
            localField: 'contentId',
            foreignField: '_id',
            as: 'content'
          }
        },
        { $unwind: '$content' },
        { $unwind: '$content.genre' },
        {
          $group: {
            _id: '$content.genre',
            watchTime: { $sum: '$watchProgress.currentPosition' },
            episodeCount: { $sum: 1 }
          }
        },
        { $sort: { watchTime: -1 } },
        { $limit: 10 }
      ]),
      Watchlist.aggregate([
        { $match: { userId, 'sessionInfo.lastWatchedAt': { $gte: startDate } } },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$sessionInfo.lastWatchedAt' }
            },
            watchTime: { $sum: '$watchProgress.currentPosition' },
            episodesWatched: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ])
    ]);

    stats = {
      overview: basicStats[0] || {
        totalVideosWatched: 0,
        completedVideos: 0,
        totalWatchTime: 0,
        averageCompletion: 0
      },
      favoriteGenres: genreStats,
      dailyActivity: dailyStats,
      timeframe: parseInt(timeframe)
    };

    // Calculate additional metrics
    const totalHours = Math.round(stats.overview.totalWatchTime / 3600);
    const completionRate = stats.overview.totalVideosWatched > 0 
      ? (stats.overview.completedVideos / stats.overview.totalVideosWatched * 100).toFixed(1)
      : 0;

    stats.overview.totalHours = totalHours;
    stats.overview.completionRate = parseFloat(completionRate);

    // Cache for 1 hour
    await setCache(cacheKey, stats, 3600);
  }

  res.status(200).json({
    success: true,
    data: stats
  });
});

// Add to watchlist (manually)
const addToWatchlist = asyncHandler(async (req, res) => {
  const { userId, contentId, episodeId, currentPosition = 0, watchedVia = 'manual' } = req.body;

  // Validate content and episode exist
  const [content, episode] = await Promise.all([
    Content.findById(contentId),
    Episode.findById(episodeId)
  ]);

  if (!content) {
    throw new AppError('Content not found', 404);
  }

  if (!episode) {
    throw new AppError('Episode not found', 404);
  }

  // Check if already exists
  const existingRecord = await Watchlist.findOne({ userId, episodeId });
  
  if (existingRecord) {
    return res.status(200).json({
      success: true,
      message: 'Already in watchlist',
      data: existingRecord
    });
  }

  // Create watchlist entry
  const watchlistEntry = await Watchlist.create({
    userId,
    contentId,
    episodeId,
    watchProgress: {
      currentPosition,
      totalDuration: episode.duration,
      percentageWatched: (currentPosition / episode.duration) * 100,
      isCompleted: false
    },
    episodeDetails: {
      episodeNumber: episode.episodeNumber,
      seasonNumber: episode.seasonNumber,
      episodeTitle: episode.title
    },
    userInteraction: {
      watchedVia
    }
  });

  // Clear cache
  await deleteCache(`watchlist:${userId}*`);
  await deleteCache(`continue_watching:${userId}*`);

  res.status(201).json({
    success: true,
    message: 'Added to watchlist successfully',
    data: watchlistEntry
  });
});

// Remove from watchlist
const removeFromWatchlist = asyncHandler(async (req, res) => {
  const { userId, episodeId } = req.params;

  const watchlistEntry = await Watchlist.findOne({ userId, episodeId });
  
  if (!watchlistEntry) {
    throw new AppError('Watchlist entry not found', 404);
  }

  await Watchlist.deleteOne({ userId, episodeId });

  // Clear cache
  await deleteCache(`watchlist:${userId}*`);
  await deleteCache(`continue_watching:${userId}*`);

  res.status(200).json({
    success: true,
    message: 'Removed from watchlist successfully'
  });
});

// Update watch progress
const updateWatchProgress = asyncHandler(async (req, res) => {
  const { userId, episodeId } = req.params;
  const { currentPosition, sessionDuration = 0, pauseCount = 0, seekCount = 0 } = req.body;

  const watchlistEntry = await Watchlist.findOne({ userId, episodeId });
  
  if (!watchlistEntry) {
    throw new AppError('Watchlist entry not found', 404);
  }

  // Update progress
  await watchlistEntry.updateProgress(currentPosition, sessionDuration);

  // Update engagement metrics
  if (pauseCount || seekCount) {
    await watchlistEntry.addEngagement({
      pauseCount: watchlistEntry.engagement.pauseCount + pauseCount,
      seekCount: watchlistEntry.engagement.seekCount + seekCount
    });
  }

  // Clear relevant caches
  await deleteCache(`continue_watching:${userId}*`);
  await deleteCache(`watch_stats:${userId}*`);

  res.status(200).json({
    success: true,
    message: 'Watch progress updated successfully',
    data: {
      currentPosition: watchlistEntry.watchProgress.currentPosition,
      percentageWatched: watchlistEntry.watchProgress.percentageWatched,
      isCompleted: watchlistEntry.watchProgress.isCompleted
    }
  });
});

// Rate content
const rateContent = asyncHandler(async (req, res) => {
  const { userId, contentId } = req.params;
  const { rating } = req.body;

  if (rating < 1 || rating > 5) {
    throw new AppError('Rating must be between 1 and 5', 400);
  }

  // Find any watchlist entry for this content
  const watchlistEntry = await Watchlist.findOne({ userId, contentId });
  
  if (!watchlistEntry) {
    throw new AppError('Must watch content before rating', 400);
  }

  // Update rating
  const previousRating = watchlistEntry.userInteraction.rating;
  await watchlistEntry.updateRating(rating);

  // Update content average rating
  const content = await Content.findById(contentId);
  if (content) {
    if (previousRating) {
      // Update existing rating
      const totalRatings = content.analytics.totalRatings;
      const currentTotal = content.analytics.averageRating * totalRatings;
      const newTotal = currentTotal - previousRating + rating;
      content.analytics.averageRating = newTotal / totalRatings;
    } else {
      // New rating
      const totalRatings = content.analytics.totalRatings + 1;
      const currentTotal = content.analytics.averageRating * content.analytics.totalRatings;
      const newTotal = currentTotal + rating;
      content.analytics.averageRating = newTotal / totalRatings;
      content.analytics.totalRatings = totalRatings;
    }
    
    await content.save();
  }

  // Track rating event
  await analyticsService.trackEvent({
    userId,
    eventType: 'rating',
    category: 'engagement',
    contentId,
    eventData: {
      rating,
      previousRating
    }
  });

  res.status(200).json({
    success: true,
    message: 'Content rated successfully',
    data: {
      rating,
      contentAverageRating: content?.analytics.averageRating || 0
    }
  });
});

// Get content progress summary
const getContentProgress = asyncHandler(async (req, res) => {
  const { userId, contentId } = req.params;

  // Try cache first
  const cacheKey = `content_progress:${userId}:${contentId}`;
  let progress = await getCache(cacheKey);

  if (!progress) {
    const [content, progressData] = await Promise.all([
      Content.findById(contentId),
      Watchlist.getUserProgress(userId, contentId)
    ]);

    if (!content) {
      throw new AppError('Content not found', 404);
    }

    // Calculate overall progress
    const totalEpisodes = content.totalEpisodes;
    const watchedEpisodes = progressData.length;
    const completedEpisodes = progressData.filter(p => p.watchProgress.isCompleted).length;
    
    const overallProgress = totalEpisodes > 0 ? (watchedEpisodes / totalEpisodes) * 100 : 0;
    const completionProgress = totalEpisodes > 0 ? (completedEpisodes / totalEpisodes) * 100 : 0;

    progress = {
      content: {
        _id: content._id,
        title: content.title,
        totalEpisodes: content.totalEpisodes,
        type: content.type
      },
      progress: {
        watchedEpisodes,
        completedEpisodes,
        totalEpisodes,
        overallProgress: Math.round(overallProgress),
        completionProgress: Math.round(completionProgress)
      },
      episodes: progressData.map(item => ({
        episodeId: item.episodeId._id,
        episodeNumber: item.episodeDetails.episodeNumber,
        title: item.episodeId.title,
        currentPosition: item.watchProgress.currentPosition,
        percentageWatched: Math.round(item.watchProgress.percentageWatched),
        isCompleted: item.watchProgress.isCompleted,
        lastWatchedAt: item.sessionInfo.lastWatchedAt
      }))
    };

    // Cache for 15 minutes
    await setCache(cacheKey, progress, 900);
  }

  res.status(200).json({
    success: true,
    data: progress
  });
});

// Clear watch history
const clearWatchHistory = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { contentId, older_than_days } = req.body;

  let deleteQuery = { userId };

  if (contentId) {
    deleteQuery.contentId = contentId;
  }

  if (older_than_days) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(older_than_days));
    deleteQuery['sessionInfo.lastWatchedAt'] = { $lt: cutoffDate };
  }

  const result = await Watchlist.deleteMany(deleteQuery);

  // Clear all related caches
  await deleteCache(`watchlist:${userId}*`);
  await deleteCache(`continue_watching:${userId}*`);
  await deleteCache(`completed:${userId}*`);
  await deleteCache(`watch_stats:${userId}*`);
  await deleteCache(`content_progress:${userId}*`);

  res.status(200).json({
    success: true,
    message: 'Watch history cleared successfully',
    data: {
      deletedEntries: result.deletedCount
    }
  });
});

module.exports = {
  getUserWatchlist,
  getContinueWatching,
  getCompletedContent,
  getUserWatchStats,
  addToWatchlist,
  removeFromWatchlist,
  updateWatchProgress,
  rateContent,
  getContentProgress,
  clearWatchHistory
};