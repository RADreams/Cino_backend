const Content = require('../models/Content');
const Episode = require('../models/Episode');
const User = require('../models/User');
const Watchlist = require('../models/Watchlist');
const { setCache, getCache, deleteCache } = require('../config/redis');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const feedService = require('../services/feedService');
const analyticsService = require('../services/analyticsService');

// Get random feed for user
const getRandomFeed = asyncHandler(async (req, res) => {
  const { userId, limit = 20, offset = 0, genre, language } = req.query;

  // Build cache key
  const cacheKey = `feed:${userId || 'anonymous'}:${limit}:${offset}:${genre || 'all'}:${language || 'all'}`;
  
  // Try cache first
  let feedData = await getCache(cacheKey);

  if (!feedData) {
    // Get user preferences if userId provided
    let userPreferences = {};
    if (userId) {
      const user = await User.findByUserId(userId);
      if (user) {
        userPreferences = {
          genres: user.preferences.preferredGenres,
          languages: user.preferences.preferredLanguages
        };
      }
    }

    // Override with query parameters
    if (genre) userPreferences.genres = [genre];
    if (language) userPreferences.languages = [language];

    // Get feed content using feed service
    feedData = await feedService.generateRandomFeed({
      userPreferences,
      limit: parseInt(limit),
      offset: parseInt(offset),
      userId
    });

    // Cache for 15 minutes (shorter cache for personalized feeds)
    const cacheTime = userId ? 900 : 1800; // 15 min for users, 30 min for anonymous
    await setCache(cacheKey, feedData, cacheTime);
  }

  // Track feed view event
  if (userId) {
    await analyticsService.trackEvent({
      userId,
      eventType: 'content_view',
      category: 'navigation',
      eventData: {
        feedPosition: parseInt(offset),
        feedSize: feedData.length
      }
    });
  }

  res.status(200).json({
    success: true,
    data: {
      feed: feedData,
      hasMore: feedData.length === parseInt(limit),
      nextOffset: parseInt(offset) + parseInt(limit)
    }
  });
});

// Get content episodes (when user swipes right)
const getContentEpisodes = asyncHandler(async (req, res) => {
  const { contentId } = req.params;
  const { userId, seasonNumber } = req.query;

  // Validate content exists
  const content = await Content.findById(contentId);
  if (!content) {
    throw new AppError('Content not found', 404);
  }

  // Get episodes
  const episodes = await Episode.getEpisodesByContent(contentId, seasonNumber);

  // Get user's watch progress if userId provided
  let watchProgress = {};
  if (userId) {
    const progressData = await Watchlist.getUserProgress(userId, contentId);
    watchProgress = progressData.reduce((acc, item) => {
      acc[item.episodeId.toString()] = {
        currentPosition: item.watchProgress.currentPosition,
        percentageWatched: item.watchProgress.percentageWatched,
        isCompleted: item.watchProgress.isCompleted
      };
      return acc;
    }, {});
  }

  // Format episodes with watch progress
  const episodesWithProgress = episodes.map(episode => ({
    _id: episode._id,
    episodeId: episode.episodeId,
    episodeNumber: episode.episodeNumber,
    seasonNumber: episode.seasonNumber,
    title: episode.title,
    description: episode.description,
    thumbnailUrl: episode.thumbnailUrl,
    duration: episode.duration,
    streamUrl: episode.streamUrl,
    analytics: {
      totalViews: episode.analytics.totalViews,
      completionRate: episode.analytics.completionRate
    },
    watchProgress: watchProgress[episode._id.toString()] || {
      currentPosition: 0,
      percentageWatched: 0,
      isCompleted: false
    }
  }));

  // Track episode list view
  if (userId) {
    await analyticsService.trackEvent({
      userId,
      eventType: 'swipe_right',
      category: 'user_interaction',
      contentId,
      eventData: {
        totalEpisodes: episodes.length,
        currentSeason: seasonNumber || 1
      }
    });
  }

  res.status(200).json({
    success: true,
    data: {
      content: {
        _id: content._id,
        title: content.title,
        description: content.description,
        genre: content.genre,
        language: content.language,
        type: content.type,
        totalEpisodes: content.totalEpisodes,
        thumbnail: content.thumbnail,
        poster: content.poster
      },
      episodes: episodesWithProgress,
      seasons: content.seasons || []
    }
  });
});

// Get trending content
const getTrendingContent = asyncHandler(async (req, res) => {
  const { limit = 20, timeframe = 7 } = req.query;

  // Try cache first
  const cacheKey = `trending:${timeframe}:${limit}`;
  let trendingContent = await getCache(cacheKey);

  if (!trendingContent) {
    // Calculate trending based on recent views and engagement
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(timeframe));

    trendingContent = await Content.aggregate([
      {
        $match: {
          status: 'published',
          publishedAt: { $gte: startDate }
        }
      },
      {
        $addFields: {
          trendingScore: {
            $add: [
              { $multiply: ['$analytics.totalViews', 0.4] },
              { $multiply: ['$analytics.totalLikes', 0.3] },
              { $multiply: ['$analytics.totalShares', 0.2] },
              { $multiply: ['$analytics.completionRate', 100, 0.1] }
            ]
          }
        }
      },
      {
        $sort: { trendingScore: -1 }
      },
      {
        $limit: parseInt(limit)
      },
      {
        $lookup: {
          from: 'episodes',
          localField: 'episodeIds',
          foreignField: '_id',
          as: 'episodes',
          pipeline: [
            { $sort: { episodeNumber: 1 } },
            { $limit: 3 }, // First 3 episodes
            { $project: { episodeNumber: 1, title: 1, thumbnailUrl: 1, duration: 1 } }
          ]
        }
      }
    ]);

    // Cache for 1 hour
    await setCache(cacheKey, trendingContent, 3600);
  }

  res.status(200).json({
    success: true,
    data: trendingContent
  });
});

// Get popular content by genre
const getPopularByGenre = asyncHandler(async (req, res) => {
  const { genre } = req.params;
  const { limit = 20, language } = req.query;

  // Try cache first
  const cacheKey = `popular:genre:${genre}:${language || 'all'}:${limit}`;
  let popularContent = await getCache(cacheKey);

  if (!popularContent) {
    const query = {
      status: 'published',
      genre: { $in: [genre] }
    };

    if (language) {
      query.language = { $in: [language] };
    }

    popularContent = await Content.find(query)
      .sort({ 'analytics.popularityScore': -1 })
      .limit(parseInt(limit))
      .populate('episodeIds', 'episodeNumber title thumbnailUrl duration', null, { 
        sort: { episodeNumber: 1 }, 
        limit: 3 
      })
      .lean();

    // Cache for 2 hours
    await setCache(cacheKey, popularContent, 7200);
  }

  res.status(200).json({
    success: true,
    data: popularContent
  });
});

// Get personalized feed based on user history
const getPersonalizedFeed = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { limit = 20, excludeWatched = true } = req.query;

  const user = await User.findByUserId(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Try cache first
  const cacheKey = `personalized:${userId}:${limit}:${excludeWatched}`;
  let personalizedFeed = await getCache(cacheKey);

  if (!personalizedFeed) {
    // Get user's watch history and preferences
    const watchHistory = await Watchlist.getWatchedContent(userId);
    const watchedContentIds = watchHistory.map(item => item._id);

    // Build query based on user preferences
    const query = {
      status: 'published',
      'feedSettings.isInRandomFeed': true
    };

    // Exclude already watched content if requested
    if (excludeWatched === 'true' && watchedContentIds.length > 0) {
      query._id = { $nin: watchedContentIds };
    }

    // Prefer user's favorite genres
    if (user.analytics.favoriteGenres?.length > 0) {
      const favoriteGenres = user.analytics.favoriteGenres
        .slice(0, 5) // Top 5 genres
        .map(g => g.genre);
      
      query.genre = { $in: favoriteGenres };
    }

    // Prefer user's languages
    if (user.preferences.preferredLanguages?.length > 0) {
      query.language = { $in: user.preferences.preferredLanguages };
    }

    personalizedFeed = await Content.find(query)
      .sort({ 
        'analytics.popularityScore': -1,
        'feedSettings.feedPriority': -1
      })
      .limit(parseInt(limit))
      .populate('episodeIds', 'episodeNumber title thumbnailUrl duration', null, { 
        sort: { episodeNumber: 1 }, 
        limit: 1 // First episode only
      })
      .lean();

    // If not enough content, fill with general popular content
    if (personalizedFeed.length < parseInt(limit)) {
      const remaining = parseInt(limit) - personalizedFeed.length;
      const generalContent = await Content.find({
        status: 'published',
        'feedSettings.isInRandomFeed': true,
        _id: { 
          $nin: [
            ...personalizedFeed.map(c => c._id),
            ...(excludeWatched === 'true' ? watchedContentIds : [])
          ] 
        }
      })
        .sort({ 'analytics.popularityScore': -1 })
        .limit(remaining)
        .populate('episodeIds', 'episodeNumber title thumbnailUrl duration', null, { 
          sort: { episodeNumber: 1 }, 
          limit: 1 
        })
        .lean();

      personalizedFeed = [...personalizedFeed, ...generalContent];
    }

    // Cache for 30 minutes
    await setCache(cacheKey, personalizedFeed, 1800);
  }

  res.status(200).json({
    success: true,
    data: personalizedFeed
  });
});

// Get continue watching feed
const getContinueWatching = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { limit = 10 } = req.query;

  // Try cache first
  const cacheKey = `continue:${userId}:${limit}`;
  let continueWatching = await getCache(cacheKey);

  if (!continueWatching) {
    continueWatching = await Watchlist.getContinueWatching(userId, parseInt(limit));
    
    // Cache for 5 minutes (short cache as this changes frequently)
    await setCache(cacheKey, continueWatching, 300);
  }

  res.status(200).json({
    success: true,
    data: continueWatching
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

    searchResults = await Content.find(query)
      .sort({ 'analytics.popularityScore': -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('episodeIds', 'episodeNumber title thumbnailUrl duration', null, { 
        sort: { episodeNumber: 1 }, 
        limit: 1 
      })
      .lean();

    // Cache for 1 hour
    await setCache(cacheKey, searchResults, 3600);
  }

  // Track search event
  if (userId) {
    await analyticsService.trackEvent({
      userId,
      eventType: 'search',
      category: 'user_interaction',
      eventData: {
        searchQuery: q,
        resultsCount: searchResults.length,
        filters: { genre, language, type }
      }
    });
  }

  res.status(200).json({
    success: true,
    data: {
      results: searchResults,
      query: q,
      page: parseInt(page),
      hasMore: searchResults.length === parseInt(limit)
    }
  });
});

// Get featured content (for hero banners)
const getFeaturedContent = asyncHandler(async (req, res) => {
  const { limit = 5 } = req.query;

  // Try cache first
  const cacheKey = `featured_content:${limit}`;
  let featuredContent = await getCache(cacheKey);

  if (!featuredContent) {
    featuredContent = await Content.find({
      status: 'published',
      'feedSettings.isFeatured': true
    })
      .sort({ 'feedSettings.feedPriority': -1, 'analytics.popularityScore': -1 })
      .limit(parseInt(limit))
      .populate('episodeIds', 'episodeNumber title thumbnailUrl duration', null, { 
        sort: { episodeNumber: 1 }, 
        limit: 1 
      })
      .lean();

    // Cache for 1 hour
    await setCache(cacheKey, featuredContent, 3600);
  }

  res.status(200).json({
    success: true,
    data: featuredContent
  });
});

// Get editor's picks
const getEditorsPicks = asyncHandler(async (req, res) => {
  const { limit = 10 } = req.query;

  // Try cache first
  const cacheKey = `editors_picks:${limit}`;
  let editorsPicks = await getCache(cacheKey);

  if (!editorsPicks) {
    editorsPicks = await Content.find({
      status: 'published',
      'feedSettings.isEditorsPick': true
    })
      .sort({ 'feedSettings.feedPriority': -1 })
      .limit(parseInt(limit))
      .populate('episodeIds', 'episodeNumber title thumbnailUrl duration', null, { 
        sort: { episodeNumber: 1 }, 
        limit: 1 
      })
      .lean();

    // Cache for 2 hours
    await setCache(cacheKey, editorsPicks, 7200);
  }

  res.status(200).json({
    success: true,
    data: editorsPicks
  });
});

// Refresh feed cache (admin function)
const refreshFeedCache = asyncHandler(async (req, res) => {
  const { userId, type = 'all' } = req.body;

  const deletedKeys = [];

  if (type === 'all' || type === 'feed') {
    // Delete general feed caches
    const feedKeys = await deleteCache('feed:*');
    deletedKeys.push(...feedKeys);
  }

  if (type === 'all' || type === 'trending') {
    // Delete trending caches
    const trendingKeys = await deleteCache('trending:*');
    deletedKeys.push(...trendingKeys);
  }

  if (type === 'all' || type === 'popular') {
    // Delete popular caches
    const popularKeys = await deleteCache('popular:*');
    deletedKeys.push(...popularKeys);
  }

  if (userId) {
    // Delete user-specific caches
    const userKeys = await deleteCache(`*${userId}*`);
    deletedKeys.push(...userKeys);
  }

  res.status(200).json({
    success: true,
    message: 'Feed cache refreshed successfully',
    data: {
      deletedCacheKeys: deletedKeys.length,
      type
    }
  });
});

module.exports = {
  getRandomFeed,
  getContentEpisodes,
  getTrendingContent,
  getPopularByGenre,
  getPersonalizedFeed,
  getContinueWatching,
  searchContent,
  getFeaturedContent,
  getEditorsPicks,
  refreshFeedCache
};