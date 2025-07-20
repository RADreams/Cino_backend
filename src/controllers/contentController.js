const Content = require('../models/Content');
const Episode = require('../models/Episode');
const Watchlist = require('../models/Watchlist');
const { setCache, getCache, deleteCache } = require('../config/redis');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const feedService = require('../services/feedService');
const analyticsService = require('../services/analyticsService');

// Get content by ID
const getContentById = asyncHandler(async (req, res) => {
  const { contentId } = req.params;
  const { userId } = req.query;

  // Try cache first
  const cacheKey = `content:${contentId}:details`;
  let content = await getCache(cacheKey);

  if (!content) {
    content = await Content.findById(contentId)
      .populate('episodeIds', 'episodeNumber title thumbnailUrl duration status analytics')
      .lean();

    if (!content) {
      throw new AppError('Content not found', 404);
    }

    // Cache for 2 hours
    await setCache(cacheKey, content, 7200);
  }

  // Get user's progress if userId provided
  let userProgress = null;
  if (userId) {
    const progressData = await Watchlist.getUserProgress(userId, contentId);
    userProgress = progressData.reduce((acc, item) => {
      acc[item.episodeId.toString()] = {
        currentPosition: item.watchProgress.currentPosition,
        percentageWatched: item.watchProgress.percentageWatched,
        isCompleted: item.watchProgress.isCompleted,
        lastWatchedAt: item.sessionInfo.lastWatchedAt
      };
      return acc;
    }, {});

    // Track content view
    await analyticsService.trackEvent({
      userId,
      eventType: 'content_view',
      category: 'navigation',
      contentId: content._id,
      eventData: {
        totalEpisodes: content.totalEpisodes,
        contentType: content.type
      }
    });
  }

  // Format response
  const response = {
    ...content,
    episodes: content.episodeIds?.map(episode => ({
      ...episode,
      userProgress: userProgress?.[episode._id.toString()] || null
    })) || [],
    userProgress: userProgress || {}
  };

  res.status(200).json({
    success: true,
    data: response
  });
});

// Get all episodes for content
const getContentEpisodes = asyncHandler(async (req, res) => {
  const { contentId } = req.params;
  const { seasonNumber, page = 1, limit = 20, userId } = req.query;

  // Validate content exists
  const content = await Content.findById(contentId);
  if (!content) {
    throw new AppError('Content not found', 404);
  }

  // Build query
  const query = { contentId, status: 'published' };
  if (seasonNumber) {
    query.seasonNumber = parseInt(seasonNumber);
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [episodes, totalCount] = await Promise.all([
    Episode.find(query)
      .sort({ seasonNumber: 1, episodeNumber: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    Episode.countDocuments(query)
  ]);

  // Get user progress if userId provided
  let userProgress = {};
  if (userId) {
    const progressData = await Watchlist.getUserProgress(userId, contentId);
    userProgress = progressData.reduce((acc, item) => {
      acc[item.episodeId.toString()] = {
        currentPosition: item.watchProgress.currentPosition,
        percentageWatched: item.watchProgress.percentageWatched,
        isCompleted: item.watchProgress.isCompleted
      };
      return acc;
    }, {});
  }

  // Add progress to episodes
  const episodesWithProgress = episodes.map(episode => ({
    ...episode,
    userProgress: userProgress[episode._id.toString()] || {
      currentPosition: 0,
      percentageWatched: 0,
      isCompleted: false
    }
  }));

  res.status(200).json({
    success: true,
    data: {
      content: {
        _id: content._id,
        title: content.title,
        type: content.type,
        totalEpisodes: content.totalEpisodes
      },
      episodes: episodesWithProgress,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalItems: totalCount,
        hasNext: skip + episodes.length < totalCount,
        hasPrev: parseInt(page) > 1
      }
    }
  });
});

// Get content by genre
const getContentByGenre = asyncHandler(async (req, res) => {
  const { genre } = req.params;
  const { language, page = 1, limit = 20, sortBy = 'popularityScore' } = req.query;

  // Try cache first
  const cacheKey = `content:genre:${genre}:${language || 'all'}:${page}:${limit}:${sortBy}`;
  let result = await getCache(cacheKey);

  if (!result) {
    const query = {
      status: 'published',
      genre: { $in: [genre] }
    };

    if (language) {
      query.language = { $in: [language] };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Sort options
    const sortOptions = {
      popularityScore: { 'analytics.popularityScore': -1 },
      newest: { publishedAt: -1 },
      rating: { 'analytics.averageRating': -1 },
      views: { 'analytics.totalViews': -1 },
      alphabetical: { title: 1 }
    };

    const sort = sortOptions[sortBy] || sortOptions.popularityScore;

    const [content, totalCount] = await Promise.all([
      Content.find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .populate('episodeIds', 'episodeNumber title thumbnailUrl duration', null, { 
          sort: { episodeNumber: 1 }, 
          limit: 3 
        })
        .lean(),
      Content.countDocuments(query)
    ]);

    result = {
      content,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalItems: totalCount,
        hasNext: skip + content.length < totalCount,
        hasPrev: parseInt(page) > 1
      },
      genre,
      sortBy
    };

    // Cache for 1 hour
    await setCache(cacheKey, result, 3600);
  }

  res.status(200).json({
    success: true,
    data: result
  });
});

// Get content by type
const getContentByType = asyncHandler(async (req, res) => {
  const { type } = req.params;
  const { page = 1, limit = 20, sortBy = 'popularityScore', genre, language } = req.query;

  const validTypes = ['movie', 'series', 'web-series'];
  if (!validTypes.includes(type)) {
    throw new AppError('Invalid content type', 400);
  }

  // Try cache first
  const cacheKey = `content:type:${type}:${genre || 'all'}:${language || 'all'}:${page}:${limit}:${sortBy}`;
  let result = await getCache(cacheKey);

  if (!result) {
    const query = { status: 'published', type };
    
    if (genre) query.genre = { $in: [genre] };
    if (language) query.language = { $in: [language] };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Sort options
    const sortOptions = {
      popularityScore: { 'analytics.popularityScore': -1 },
      newest: { publishedAt: -1 },
      rating: { 'analytics.averageRating': -1 },
      views: { 'analytics.totalViews': -1 },
      alphabetical: { title: 1 }
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

    result = {
      content,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalItems: totalCount,
        hasNext: skip + content.length < totalCount,
        hasPrev: parseInt(page) > 1
      },
      type,
      sortBy
    };

    // Cache for 1 hour
    await setCache(cacheKey, result, 3600);
  }

  res.status(200).json({
    success: true,
    data: result
  });
});

// Search content
const searchContent = asyncHandler(async (req, res) => {
  const { q, genre, language, type, page = 1, limit = 20 } = req.query;
  const { userId } = req.query;

  if (!q || q.trim().length < 2) {
    throw new AppError('Search query must be at least 2 characters', 400);
  }

  // Try cache first
  const cacheKey = `search:${q}:${genre || 'all'}:${language || 'all'}:${type || 'all'}:${page}:${limit}`;
  let searchResults = await getCache(cacheKey);

  if (!searchResults) {
    const searchRegex = new RegExp(q.trim(), 'i');
    const query = {
      status: 'published',
      $or: [
        { title: searchRegex },
        { description: searchRegex },
        { tags: { $in: [searchRegex] } },
        { cast: { $in: [searchRegex] } },
        { director: searchRegex }
      ]
    };

    // Add filters
    if (genre) query.genre = { $in: [genre] };
    if (language) query.language = { $in: [language] };
    if (type) query.type = type;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [results, totalCount] = await Promise.all([
      Content.find(query)
        .sort({ 'analytics.popularityScore': -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('episodeIds', 'episodeNumber title thumbnailUrl duration', null, { 
          sort: { episodeNumber: 1 }, 
          limit: 1 
        })
        .lean(),
      Content.countDocuments(query)
    ]);

    searchResults = {
      results,
      query: q,
      totalResults: totalCount,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        hasNext: skip + results.length < totalCount,
        hasPrev: parseInt(page) > 1
      }
    };

    // Cache for 30 minutes
    await setCache(cacheKey, searchResults, 1800);
  }

  // Track search event
  if (userId) {
    await analyticsService.trackEvent({
      userId,
      eventType: 'search',
      category: 'user_interaction',
      eventData: {
        searchQuery: q,
        resultsCount: searchResults.results.length,
        filters: { genre, language, type }
      }
    });
  }

  res.status(200).json({
    success: true,
    data: searchResults
  });
});

// Get similar content
const getSimilarContent = asyncHandler(async (req, res) => {
  const { contentId } = req.params;
  const { limit = 10 } = req.query;

  // Try cache first
  const cacheKey = `similar:${contentId}:${limit}`;
  let similarContent = await getCache(cacheKey);

  if (!similarContent) {
    similarContent = await feedService.getSimilarContent(contentId, parseInt(limit));
    
    // Cache for 2 hours
    await setCache(cacheKey, similarContent, 7200);
  }

  res.status(200).json({
    success: true,
    data: similarContent
  });
});

// Get content analytics (public version)
const getContentAnalytics = asyncHandler(async (req, res) => {
  const { contentId } = req.params;

  const content = await Content.findById(contentId, 'analytics title type totalEpisodes').lean();
  
  if (!content) {
    throw new AppError('Content not found', 404);
  }

  // Get basic episode analytics
  const episodeAnalytics = await Episode.aggregate([
    { $match: { contentId: content._id } },
    {
      $group: {
        _id: null,
        totalEpisodes: { $sum: 1 },
        publishedEpisodes: { 
          $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] } 
        },
        totalViews: { $sum: '$analytics.totalViews' },
        averageCompletion: { $avg: '$analytics.completionRate' }
      }
    }
  ]);

  const analytics = {
    content: {
      title: content.title,
      type: content.type,
      totalEpisodes: content.totalEpisodes
    },
    analytics: {
      ...content.analytics,
      episodes: episodeAnalytics[0] || {
        totalEpisodes: 0,
        publishedEpisodes: 0,
        totalViews: 0,
        averageCompletion: 0
      }
    }
  };

  res.status(200).json({
    success: true,
    data: analytics
  });
});

// Get all available genres with content count
const getGenres = asyncHandler(async (req, res) => {
  // Try cache first
  const cacheKey = 'content:genres:list';
  let genres = await getCache(cacheKey);

  if (!genres) {
    const genreStats = await Content.aggregate([
      { $match: { status: 'published' } },
      { $unwind: '$genre' },
      {
        $group: {
          _id: '$genre',
          count: { $sum: 1 },
          totalViews: { $sum: '$analytics.totalViews' },
          avgRating: { $avg: '$analytics.averageRating' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    genres = genreStats.map(stat => ({
      genre: stat._id,
      contentCount: stat.count,
      totalViews: stat.totalViews,
      averageRating: Math.round(stat.avgRating * 10) / 10
    }));

    // Cache for 4 hours
    await setCache(cacheKey, genres, 14400);
  }

  res.status(200).json({
    success: true,
    data: genres
  });
});

// Get all available languages with content count
const getLanguages = asyncHandler(async (req, res) => {
  // Try cache first
  const cacheKey = 'content:languages:list';
  let languages = await getCache(cacheKey);

  if (!languages) {
    const languageStats = await Content.aggregate([
      { $match: { status: 'published' } },
      { $unwind: '$language' },
      {
        $group: {
          _id: '$language',
          count: { $sum: 1 },
          totalViews: { $sum: '$analytics.totalViews' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    languages = languageStats.map(stat => ({
      language: stat._id,
      contentCount: stat.count,
      totalViews: stat.totalViews
    }));

    // Cache for 4 hours
    await setCache(cacheKey, languages, 14400);
  }

  res.status(200).json({
    success: true,
    data: languages
  });
});

// Get latest/newest content
const getLatestContent = asyncHandler(async (req, res) => {
  const { limit = 20, type, genre, language } = req.query;

  // Try cache first
  const cacheKey = `content:latest:${type || 'all'}:${genre || 'all'}:${language || 'all'}:${limit}`;
  let latestContent = await getCache(cacheKey);

  if (!latestContent) {
    const query = { status: 'published' };
    
    if (type) query.type = type;
    if (genre) query.genre = { $in: [genre] };
    if (language) query.language = { $in: [language] };

    latestContent = await Content.find(query)
      .sort({ publishedAt: -1 })
      .limit(parseInt(limit))
      .populate('episodeIds', 'episodeNumber title thumbnailUrl duration', null, { 
        sort: { episodeNumber: 1 }, 
        limit: 1 
      })
      .lean();

    // Cache for 30 minutes
    await setCache(cacheKey, latestContent, 1800);
  }

  res.status(200).json({
    success: true,
    data: latestContent
  });
});

// Get content recommendations based on watch history
const getRecommendations = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { limit = 10, excludeWatched = true } = req.query;

  if (!userId) {
    throw new AppError('User ID is required', 400);
  }

  // Try cache first
  const cacheKey = `recommendations:${userId}:${limit}:${excludeWatched}`;
  let recommendations = await getCache(cacheKey);

  if (!recommendations) {
    recommendations = await feedService.generateHistoryBasedFeed(userId, parseInt(limit));
    
    // Cache for 1 hour
    await setCache(cacheKey, recommendations, 3600);
  }

  res.status(200).json({
    success: true,
    data: recommendations
  });
});

module.exports = {
  getContentById,
  getContentEpisodes,
  getContentByGenre,
  getContentByType,
  searchContent,
  getSimilarContent,
  getContentAnalytics,
  getGenres,
  getLanguages,
  getLatestContent,
  getRecommendations
};