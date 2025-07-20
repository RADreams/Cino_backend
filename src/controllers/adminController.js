const Content = require('../models/Content');
const Episode = require('../models/Episode');
const User = require('../models/User');
const Watchlist = require('../models/Watchlist');
const Analytics = require('../models/Analytics');
const { uploadVideoToGCP, deleteVideoFromGCP } = require('../config/gcp');
const gcpService = require('../services/gcpService');
const { deleteCache, flushCache } = require('../config/redis');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { v4: uuidv4 } = require('uuid');

// Create new content
const createContent = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    genre,
    language,
    type,
    category,
    releaseYear,
    rating,
    totalEpisodes = 1,
    cast,
    director,
    producer,
    tags,
    ageRating = 'all'
  } = req.body;

  // Generate unique content ID
  const contentId = `content_${Date.now()}_${uuidv4().slice(0, 8)}`;

  const content = await Content.create({
    contentId,
    title,
    description,
    genre,
    language,
    type,
    category,
    releaseYear,
    rating,
    totalEpisodes,
    cast: cast || [],
    director,
    producer,
    tags: tags || [],
    ageRating,
    status: 'draft',
    publishedAt: null
  });

  res.status(201).json({
    success: true,
    message: 'Content created successfully',
    data: content
  });
});

// Upload video and create episode
const uploadVideo = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No video file provided', 400);
  }

  const {
    title,
    description,
    contentId,
    episodeNumber,
    seasonNumber = 1,
    duration,
    genre,
    language,
    tags
  } = req.body;

  // Validate content exists
  let content;
  if (contentId) {
    content = await Content.findById(contentId);
    if (!content) {
      throw new AppError('Content not found', 404);
    }
  }

  // Generate unique filename
  const timestamp = Date.now();
  const fileName = `videos/${contentId || 'standalone'}/episode_${episodeNumber}_${timestamp}.mp4`;
  
  try {
    // Upload to GCP using the service
    const uploadResult = await gcpService.uploadVideo(
      req.file.buffer,
      {
        originalName: req.file.originalname,
        contentId: content?._id,
        episodeNumber: parseInt(episodeNumber),
        seasonNumber: parseInt(seasonNumber),
        quality: '720p'
      }
    );

    // Generate episode ID
    const episodeId = `episode_${timestamp}_${uuidv4().slice(0, 8)}`;

    // Create episode
    const episode = await Episode.create({
      episodeId,
      contentId: content?._id,
      episodeNumber: parseInt(episodeNumber),
      seasonNumber: parseInt(seasonNumber),
      title,
      description: description || '',
      videoUrl: uploadResult.publicUrl,
      thumbnailUrl: '', // Will be updated separately
      duration: parseInt(duration),
      fileInfo: {
        fileName: uploadResult.fileName,
        fileSize: uploadResult.size,
        contentType: req.file.mimetype,
        uploadedAt: uploadResult.uploadedAt
      },
      status: 'processing' // Will be updated to 'published' after processing
    });

    // Update content if exists
    if (content) {
      content.episodeIds.push(episode._id);
      
      // Update seasons structure
      let season = content.seasons.find(s => s.seasonNumber === parseInt(seasonNumber));
      if (!season) {
        season = {
          seasonNumber: parseInt(seasonNumber),
          title: `Season ${seasonNumber}`,
          episodes: []
        };
        content.seasons.push(season);
      }
      season.episodes.push(episode._id);
      
      await content.save();
    }

    // Clear relevant caches
    await deleteCache('feed:*');
    await deleteCache('trending:*');
    await deleteCache('popular:*');

    res.status(201).json({
      success: true,
      message: 'Video uploaded successfully',
      data: {
        episode,
        uploadResult: {
          fileName: uploadResult.fileName,
          publicUrl: uploadResult.publicUrl,
          size: uploadResult.size
        }
      }
    });

  } catch (error) {
    console.error('Video upload failed:', error);
    throw new AppError('Failed to upload video', 500);
  }
});

// Update content feed settings
const updateFeedSettings = asyncHandler(async (req, res) => {
  const { contentId } = req.params;
  const { isInRandomFeed, feedPriority = 1, feedWeight = 1, targetAudience = [] } = req.body;

  const content = await Content.findById(contentId);
  if (!content) {
    throw new AppError('Content not found', 404);
  }

  // Update feed settings
  content.feedSettings = {
    isInRandomFeed,
    feedPriority,
    feedWeight,
    targetAudience
  };

  await content.save();

  // Clear feed caches
  await deleteCache('feed:*');
  await deleteCache('trending:*');

  res.status(200).json({
    success: true,
    message: 'Feed settings updated successfully',
    data: content.feedSettings
  });
});

// Publish content
const publishContent = asyncHandler(async (req, res) => {
  const { contentId } = req.params;

  const content = await Content.findById(contentId);
  if (!content) {
    throw new AppError('Content not found', 404);
  }

  // Validate content has episodes
  if (content.episodeIds.length === 0) {
    throw new AppError('Cannot publish content without episodes', 400);
  }

  // Update content status
  content.status = 'published';
  content.publishedAt = new Date();
  await content.save();

  // Update all episodes status
  await Episode.updateMany(
    { _id: { $in: content.episodeIds } },
    { status: 'published', publishedAt: new Date() }
  );

  // Clear caches
  await deleteCache('feed:*');
  await deleteCache('trending:*');
  await deleteCache('popular:*');

  res.status(200).json({
    success: true,
    message: 'Content published successfully',
    data: content
  });
});

// Get content analytics
const getContentAnalytics = asyncHandler(async (req, res) => {
  const { contentId } = req.params;
  const { timeframe = 30 } = req.query; // days

  const content = await Content.findById(contentId);
  if (!content) {
    throw new AppError('Content not found', 404);
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(timeframe));

  // Get detailed analytics
  const [episodeAnalytics, userStats, viewsOverTime] = await Promise.all([
    // Episode-wise analytics
    Watchlist.aggregate([
      { $match: { contentId: content._id } },
      {
        $group: {
          _id: '$episodeId',
          totalViews: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' },
          averageCompletion: { $avg: '$watchProgress.percentageWatched' },
          totalWatchTime: { $sum: '$watchProgress.currentPosition' }
        }
      },
      {
        $lookup: {
          from: 'episodes',
          localField: '_id',
          foreignField: '_id',
          as: 'episode'
        }
      },
      { $unwind: '$episode' },
      {
        $addFields: {
          uniqueUserCount: { $size: '$uniqueUsers' }
        }
      },
      { $sort: { 'episode.episodeNumber': 1 } }
    ]),

    // User engagement stats
    Watchlist.aggregate([
      { $match: { contentId: content._id } },
      {
        $group: {
          _id: null,
          totalUniqueUsers: { $addToSet: '$userId' },
          averageRating: { $avg: '$userInteraction.rating' },
          totalLikes: { $sum: { $cond: ['$userInteraction.liked', 1, 0] } },
          totalShares: { $sum: { $cond: ['$userInteraction.shared', 1, 0] } },
          completionRate: { $avg: { $cond: ['$watchProgress.isCompleted', 1, 0] } }
        }
      },
      {
        $addFields: {
          uniqueUserCount: { $size: '$totalUniqueUsers' }
        }
      }
    ]),

    // Views over time
    Watchlist.aggregate([
      { 
        $match: { 
          contentId: content._id,
          'sessionInfo.lastWatchedAt': { $gte: startDate }
        } 
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$sessionInfo.lastWatchedAt' }
          },
          views: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' }
        }
      },
      {
        $addFields: {
          uniqueUserCount: { $size: '$uniqueUsers' }
        }
      },
      { $sort: { '_id': 1 } }
    ])
  ]);

  const analytics = {
    content: {
      title: content.title,
      status: content.status,
      publishedAt: content.publishedAt,
      totalEpisodes: content.totalEpisodes
    },
    overview: {
      ...content.analytics,
      ...(userStats[0] || {})
    },
    episodeBreakdown: episodeAnalytics,
    viewsOverTime,
    timeframe: parseInt(timeframe)
  };

  res.status(200).json({
    success: true,
    data: analytics
  });
});

// Get platform analytics
const getPlatformAnalytics = asyncHandler(async (req, res) => {
  const { timeframe = 30 } = req.query;
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(timeframe));

  const [userStats, contentStats, engagementStats, deviceStats] = await Promise.all([
    // User statistics
    User.aggregate([
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          activeUsers: {
            $sum: {
              $cond: [
                { $gte: ['$lastSeenAt', startDate] },
                1,
                0
              ]
            }
          },
          averageWatchTime: { $avg: '$analytics.totalWatchTime' },
          totalWatchTime: { $sum: '$analytics.totalWatchTime' }
        }
      }
    ]),

    // Content statistics
    Content.aggregate([
      {
        $group: {
          _id: null,
          totalContent: { $sum: 1 },
          publishedContent: {
            $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] }
          },
          totalViews: { $sum: '$analytics.totalViews' },
          totalLikes: { $sum: '$analytics.totalLikes' },
          averageRating: { $avg: '$analytics.averageRating' }
        }
      }
    ]),

    // Engagement over time
    Analytics.aggregate([
      {
        $match: {
          timestamp: { $gte: startDate },
          eventType: { $in: ['video_start', 'like', 'share', 'video_end'] }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            eventType: '$eventType'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          events: {
            $push: {
              eventType: '$_id.eventType',
              count: '$count'
            }
          }
        }
      },
      { $sort: { '_id': 1 } }
    ]),

    // Device/Platform breakdown
    User.aggregate([
      {
        $match: {
          lastSeenAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$deviceInfo.platform',
          userCount: { $sum: 1 },
          totalWatchTime: { $sum: '$analytics.totalWatchTime' }
        }
      }
    ])
  ]);

  res.status(200).json({
    success: true,
    data: {
      users: userStats[0] || {},
      content: contentStats[0] || {},
      engagement: engagementStats,
      devices: deviceStats,
      timeframe: parseInt(timeframe)
    }
  });
});

// Delete content
const deleteContent = asyncHandler(async (req, res) => {
  const { contentId } = req.params;
  const { deleteVideos = false } = req.body;

  const content = await Content.findById(contentId);
  if (!content) {
    throw new AppError('Content not found', 404);
  }

  // Get all episodes
  const episodes = await Episode.find({ contentId: content._id });

  // Delete videos from GCP if requested
  if (deleteVideos) {
    for (const episode of episodes) {
      try {
        await deleteVideoFromGCP(episode.fileInfo.fileName);
      } catch (error) {
        console.error(`Failed to delete video ${episode.fileInfo.fileName}:`, error);
      }
    }
  }

  // Delete episodes
  await Episode.deleteMany({ contentId: content._id });

  // Delete watchlist entries
  await Watchlist.deleteMany({ contentId: content._id });

  // Delete content
  await Content.deleteOne({ _id: content._id });

  // Clear caches
  await flushCache();

  res.status(200).json({
    success: true,
    message: 'Content deleted successfully',
    data: {
      deletedEpisodes: episodes.length,
      videosDeleted: deleteVideos
    }
  });
});

// Update episode
const updateEpisode = asyncHandler(async (req, res) => {
  const { episodeId } = req.params;
  const updates = req.body;

  const episode = await Episode.findById(episodeId);
  if (!episode) {
    throw new AppError('Episode not found', 404);
  }

  // Update episode
  Object.assign(episode, updates);
  await episode.save();

  res.status(200).json({
    success: true,
    message: 'Episode updated successfully',
    data: episode
  });
});

// Get all content (admin view)
const getAllContent = asyncHandler(async (req, res) => {
  const { 
    status, 
    type, 
    genre, 
    page = 1, 
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc' 
  } = req.query;

  // Build query
  const query = {};
  if (status) query.status = status;
  if (type) query.type = type;
  if (genre) query.genre = { $in: [genre] };

  // Build sort object
  const sort = {};
  sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [content, totalCount] = await Promise.all([
    Content.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('episodeIds', 'episodeNumber title status duration')
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
        hasNext: skip + content.length < totalCount,
        hasPrev: parseInt(page) > 1
      }
    }
  });
});

// Bulk update content status
const bulkUpdateContent = asyncHandler(async (req, res) => {
  const { contentIds, updates } = req.body;

  if (!Array.isArray(contentIds) || contentIds.length === 0) {
    throw new AppError('Content IDs array is required', 400);
  }

  const result = await Content.updateMany(
    { _id: { $in: contentIds } },
    updates
  );

  // If publishing, also update episodes
  if (updates.status === 'published') {
    await Episode.updateMany(
      { contentId: { $in: contentIds } },
      { status: 'published', publishedAt: new Date() }
    );
  }

  // Clear caches
  await deleteCache('feed:*');
  await deleteCache('trending:*');
  await deleteCache('popular:*');

  res.status(200).json({
    success: true,
    message: 'Bulk update completed successfully',
    data: {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount
    }
  });
});

// System health check
const getSystemHealth = asyncHandler(async (req, res) => {
  const [userCount, contentCount, episodeCount, analyticsCount] = await Promise.all([
    User.countDocuments(),
    Content.countDocuments(),
    Episode.countDocuments(),
    Analytics.countDocuments()
  ]);

  const health = {
    status: 'healthy',
    timestamp: new Date(),
    database: {
      users: userCount,
      content: contentCount,
      episodes: episodeCount,
      analytics: analyticsCount
    },
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0'
  };

  res.status(200).json({
    success: true,
    data: health
  });
});

module.exports = {
  createContent,
  uploadVideo,
  updateFeedSettings,
  publishContent,
  getContentAnalytics,
  getPlatformAnalytics,
  deleteContent,
  updateEpisode,
  getAllContent,
  bulkUpdateContent,
  getSystemHealth
};