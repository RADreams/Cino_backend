const Episode = require('../models/Episode');
const Content = require('../models/Content');
const Watchlist = require('../models/Watchlist');
const User = require('../models/User');
const { setCache, getCache } = require('../config/redis');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const videoService = require('../services/videoService');
const analyticsService = require('../services/analyticsService');

// Get episode by ID
const getEpisodeById = asyncHandler(async (req, res) => {
  const { episodeId } = req.params;
  const { userId, quality } = req.query;

  // Try cache first
  const cacheKey = `episode:${episodeId}:${quality || 'auto'}`;
  let episode = await getCache(cacheKey);

  if (!episode) {
    episode = await Episode.findById(episodeId)
      .populate('contentId', 'title genre language type rating')
      .lean();

    if (!episode) {
      throw new AppError('Episode not found', 404);
    }

    // Cache for 1 hour
    await setCache(cacheKey, episode, 3600);
  }

  // Get optimal video quality based on user preference
  let videoUrl = episode.videoUrl;
  let selectedQuality = '720p';

  if (quality && episode.qualityOptions?.length > 0) {
    const qualityOption = episode.qualityOptions.find(q => q.resolution === quality);
    if (qualityOption) {
      videoUrl = qualityOption.url;
      selectedQuality = qualityOption.resolution;
    }
  } else if (userId) {
    // Get user data usage preference
    const user = await User.findByUserId(userId);
    if (user && episode.qualityOptions?.length > 0) {
      const optimalQuality = episode.getOptimalQuality(user.preferences.dataUsage);
      videoUrl = optimalQuality.url;
      selectedQuality = optimalQuality.resolution;
    }
  }

  // Get watch progress if user ID provided
  let watchProgress = null;
  if (userId) {
    const watchRecord = await Watchlist.findOne({ userId, episodeId });
    if (watchRecord) {
      watchProgress = {
        currentPosition: watchRecord.watchProgress.currentPosition,
        percentageWatched: watchRecord.watchProgress.percentageWatched,
        isCompleted: watchRecord.watchProgress.isCompleted,
        lastWatchedAt: watchRecord.sessionInfo.lastWatchedAt
      };
    }
  }

  // Get next and previous episodes
  const [nextEpisode, previousEpisode] = await Promise.all([
    Episode.getNextEpisode(episode.contentId, episode.episodeNumber, episode.seasonNumber),
    Episode.getPreviousEpisode(episode.contentId, episode.episodeNumber, episode.seasonNumber)
  ]);

  // Track episode view
  if (userId) {
    await analyticsService.trackEvent({
      userId,
      eventType: 'content_view',
      category: 'video_playback',
      contentId: episode.contentId,
      episodeId: episode._id,
      eventData: {
        quality: selectedQuality,
        episodeNumber: episode.episodeNumber,
        seasonNumber: episode.seasonNumber
      }
    });
  }

  res.status(200).json({
    success: true,
    data: {
      episode: {
        ...episode,
        videoUrl,
        selectedQuality
      },
      watchProgress,
      navigation: {
        nextEpisode: nextEpisode ? {
          _id: nextEpisode._id,
          episodeNumber: nextEpisode.episodeNumber,
          title: nextEpisode.title,
          thumbnailUrl: nextEpisode.thumbnailUrl
        } : null,
        previousEpisode: previousEpisode ? {
          _id: previousEpisode._id,
          episodeNumber: previousEpisode.episodeNumber,
          title: previousEpisode.title,
          thumbnailUrl: previousEpisode.thumbnailUrl
        } : null
      }
    }
  });
});

// Start watching episode
const startWatching = asyncHandler(async (req, res) => {
  const { episodeId } = req.params;
  const { userId, quality = 'auto', watchedVia = 'feed' } = req.body;

  if (!userId) {
    throw new AppError('User ID is required', 400);
  }

  const episode = await Episode.findById(episodeId);
  if (!episode) {
    throw new AppError('Episode not found', 404);
  }

  // Increment view count
  await episode.incrementViews(userId);

  // Create or update watchlist entry
  const existingRecord = await Watchlist.findOne({ userId, episodeId });
  
  if (existingRecord) {
    // Update existing record
    existingRecord.sessionInfo.totalSessions += 1;
    existingRecord.sessionInfo.lastWatchedAt = new Date();
    existingRecord.userInteraction.quality = quality;
    existingRecord.userInteraction.watchedVia = watchedVia;
    await existingRecord.save();
  } else {
    // Create new watchlist entry
    await Watchlist.create({
      userId,
      contentId: episode.contentId,
      episodeId: episode._id,
      watchProgress: {
        currentPosition: 0,
        totalDuration: episode.duration,
        percentageWatched: 0,
        isCompleted: false
      },
      episodeDetails: {
        episodeNumber: episode.episodeNumber,
        seasonNumber: episode.seasonNumber,
        episodeTitle: episode.title
      },
      userInteraction: {
        quality,
        watchedVia
      }
    });
  }

  // Track video start event
  await analyticsService.trackEvent({
    userId,
    eventType: 'video_start',
    category: 'video_playback',
    contentId: episode.contentId,
    episodeId: episode._id,
    eventData: {
      quality,
      episodeNumber: episode.episodeNumber,
      watchedVia
    }
  });

  res.status(200).json({
    success: true,
    message: 'Started watching episode',
    data: {
      episodeId: episode._id,
      streamUrl: episode.streamUrl,
      startPosition: existingRecord?.watchProgress.currentPosition || 0
    }
  });
});

// Update watch progress
const updateWatchProgress = asyncHandler(async (req, res) => {
  const { episodeId } = req.params;
  const { 
    userId, 
    currentPosition, 
    sessionDuration = 0,
    pauseCount = 0,
    seekCount = 0,
    bufferingTime = 0
  } = req.body;

  if (!userId) {
    throw new AppError('User ID is required', 400);
  }

  const episode = await Episode.findById(episodeId);
  if (!episode) {
    throw new AppError('Episode not found', 404);
  }

  // Find watchlist record
  let watchRecord = await Watchlist.findOne({ userId, episodeId });
  
  if (!watchRecord) {
    // Create new record if doesn't exist
    watchRecord = await Watchlist.create({
      userId,
      contentId: episode.contentId,
      episodeId: episode._id,
      watchProgress: {
        currentPosition: 0,
        totalDuration: episode.duration
      },
      episodeDetails: {
        episodeNumber: episode.episodeNumber,
        seasonNumber: episode.seasonNumber,
        episodeTitle: episode.title
      }
    });
  }

  // Update progress
  await watchRecord.updateProgress(currentPosition, sessionDuration);
  
  // Update engagement metrics
  if (pauseCount || seekCount || bufferingTime) {
    await watchRecord.addEngagement({
      pauseCount: watchRecord.engagement.pauseCount + pauseCount,
      seekCount: watchRecord.engagement.seekCount + seekCount,
      bufferingTime: watchRecord.engagement.bufferingTime + bufferingTime
    });
  }

  // Update episode analytics
  await episode.updateWatchTime(sessionDuration, userId);

  // Track progress event
  await analyticsService.trackEvent({
    userId,
    eventType: 'video_progress',
    category: 'video_playback',
    contentId: episode.contentId,
    episodeId: episode._id,
    eventData: {
      currentPosition,
      totalDuration: episode.duration,
      percentageWatched: watchRecord.watchProgress.percentageWatched,
      sessionDuration
    }
  });

  res.status(200).json({
    success: true,
    message: 'Watch progress updated',
    data: {
      currentPosition: watchRecord.watchProgress.currentPosition,
      percentageWatched: watchRecord.watchProgress.percentageWatched,
      isCompleted: watchRecord.watchProgress.isCompleted
    }
  });
});

// Mark episode as completed
const markCompleted = asyncHandler(async (req, res) => {
  const { episodeId } = req.params;
  const { userId, finalPosition, totalWatchTime } = req.body;

  if (!userId) {
    throw new AppError('User ID is required', 400);
  }

  const episode = await Episode.findById(episodeId);
  if (!episode) {
    throw new AppError('Episode not found', 404);
  }

  // Find and update watchlist record
  const watchRecord = await Watchlist.findOne({ userId, episodeId });
  if (watchRecord) {
    await watchRecord.markAsCompleted();
    
    if (finalPosition) {
      watchRecord.watchProgress.currentPosition = finalPosition;
      await watchRecord.save();
    }
  }

  // Update episode analytics
  if (totalWatchTime) {
    await episode.updateWatchTime(totalWatchTime, userId);
  }

  // Update user analytics
  const user = await User.findByUserId(userId);
  if (user) {
    await user.incrementWatchTime(totalWatchTime || episode.duration);
  }

  // Track completion event
  await analyticsService.trackEvent({
    userId,
    eventType: 'video_end',
    category: 'video_playback',
    contentId: episode.contentId,
    episodeId: episode._id,
    eventData: {
      finalPosition,
      totalWatchTime,
      completionRate: 100
    }
  });

  res.status(200).json({
    success: true,
    message: 'Episode marked as completed',
    data: {
      completedAt: new Date(),
      nextEpisode: await Episode.getNextEpisode(
        episode.contentId, 
        episode.episodeNumber, 
        episode.seasonNumber
      )
    }
  });
});

// Get episode analytics
const getEpisodeAnalytics = asyncHandler(async (req, res) => {
  const { episodeId } = req.params;

  const episode = await Episode.findById(episodeId);
  if (!episode) {
    throw new AppError('Episode not found', 404);
  }

  // Get detailed analytics
  const [dropOffData, contentAnalytics] = await Promise.all([
    Watchlist.getDropOffAnalytics(episodeId),
    Watchlist.getContentAnalytics(episode.contentId)
  ]);

  res.status(200).json({
    success: true,
    data: {
      episode: {
        title: episode.title,
        episodeNumber: episode.episodeNumber,
        duration: episode.duration
      },
      analytics: episode.analytics,
      dropOffAnalysis: dropOffData,
      contentAnalytics: contentAnalytics[0] || {}
    }
  });
});

// Like/Unlike episode
const toggleLike = asyncHandler(async (req, res) => {
  const { episodeId } = req.params;
  const { userId } = req.body;

  if (!userId) {
    throw new AppError('User ID is required', 400);
  }

  const episode = await Episode.findById(episodeId);
  if (!episode) {
    throw new AppError('Episode not found', 404);
  }

  // Find watchlist record
  let watchRecord = await Watchlist.findOne({ userId, episodeId });
  
  if (!watchRecord) {
    // Create new record if doesn't exist
    watchRecord = await Watchlist.create({
      userId,
      contentId: episode.contentId,
      episodeId: episode._id,
      watchProgress: {
        totalDuration: episode.duration
      },
      episodeDetails: {
        episodeNumber: episode.episodeNumber,
        seasonNumber: episode.seasonNumber,
        episodeTitle: episode.title
      }
    });
  }

  // Toggle like status
  const wasLiked = watchRecord.userInteraction.liked;
  await watchRecord.toggleLike();

  // Update episode like count
  if (watchRecord.userInteraction.liked && !wasLiked) {
    episode.analytics.likes += 1;
  } else if (!watchRecord.userInteraction.liked && wasLiked) {
    episode.analytics.likes -= 1;
  }
  await episode.save();

  // Track like event
  await analyticsService.trackEvent({
    userId,
    eventType: 'like',
    category: 'engagement',
    contentId: episode.contentId,
    episodeId: episode._id,
    eventData: {
      likeStatus: watchRecord.userInteraction.liked
    }
  });

  res.status(200).json({
    success: true,
    message: watchRecord.userInteraction.liked ? 'Episode liked' : 'Episode unliked',
    data: {
      liked: watchRecord.userInteraction.liked,
      totalLikes: episode.analytics.likes
    }
  });
});

// Share episode
const shareEpisode = asyncHandler(async (req, res) => {
  const { episodeId } = req.params;
  const { userId, shareMethod = 'copy_link' } = req.body;

  const episode = await Episode.findById(episodeId)
    .populate('contentId', 'title genre');
    
  if (!episode) {
    throw new AppError('Episode not found', 404);
  }

  // Generate share link
  const shareUrl = `${process.env.APP_URL || 'https://app.example.com'}/watch/${episodeId}`;
  
  // Update share count
  episode.analytics.shares += 1;
  await episode.save();

  // Update watchlist if user exists
  if (userId) {
    let watchRecord = await Watchlist.findOne({ userId, episodeId });
    if (watchRecord) {
      watchRecord.userInteraction.shared = true;
      await watchRecord.save();
    }

    // Track share event
    await analyticsService.trackEvent({
      userId,
      eventType: 'share',
      category: 'engagement',
      contentId: episode.contentId,
      episodeId: episode._id,
      eventData: {
        shareMethod
      }
    });
  }

  res.status(200).json({
    success: true,
    message: 'Episode shared successfully',
    data: {
      shareUrl,
      shareText: `Watch "${episode.title}" - ${episode.contentId.title}`,
      totalShares: episode.analytics.shares
    }
  });
});

// Get popular episodes
const getPopularEpisodes = asyncHandler(async (req, res) => {
  const { limit = 20, timeframe = 7 } = req.query;

  // Try cache first
  const cacheKey = `popular_episodes:${timeframe}:${limit}`;
  let popularEpisodes = await getCache(cacheKey);

  if (!popularEpisodes) {
    popularEpisodes = await Episode.getPopularEpisodes(parseInt(limit));
    
    // Cache for 2 hours
    await setCache(cacheKey, popularEpisodes, 7200);
  }

  res.status(200).json({
    success: true,
    data: popularEpisodes
  });
});

module.exports = {
  getEpisodeById,
  startWatching,
  updateWatchProgress,
  markCompleted,
  getEpisodeAnalytics,
  toggleLike,
  shareEpisode,
  getPopularEpisodes
};