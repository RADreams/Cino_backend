const Content = require('../models/Content');
const Episode = require('../models/Episode');
const User = require('../models/User');
const Watchlist = require('../models/Watchlist');
const { setCache, getCache } = require('../config/redis');

class FeedService {
  /**
   * Generate random feed for user based on preferences and algorithm
   */
  async generateRandomFeed(options = {}) {
    const {
      userPreferences = {},
      limit = 20,
      offset = 0,
      userId = null,
      excludeWatched = false
    } = options;

    try {
      // Get user's watch history if userId provided
      let watchedContentIds = [];
      if (userId && excludeWatched) {
        const watchHistory = await Watchlist.distinct('contentId', { userId });
        watchedContentIds = watchHistory;
      }

      // Build base query
      const baseQuery = {
        status: 'published',
        'feedSettings.isInRandomFeed': true
      };

      // Exclude watched content if requested
      if (watchedContentIds.length > 0) {
        baseQuery._id = { $nin: watchedContentIds };
      }

      // Get content pools for algorithm
      const [
        personalizedContent,
        trendingContent,
        popularContent,
        freshContent
      ] = await Promise.all([
        this._getPersonalizedContent(baseQuery, userPreferences, limit * 0.4),
        this._getTrendingContent(baseQuery, limit * 0.3),
        this._getPopularContent(baseQuery, limit * 0.2),
        this._getFreshContent(baseQuery, limit * 0.1)
      ]);

      // Combine and shuffle content
      let feedContent = [
        ...personalizedContent,
        ...trendingContent,
        ...popularContent,
        ...freshContent
      ];

      // Remove duplicates
      feedContent = this._removeDuplicates(feedContent);

      // Apply feed algorithm
      feedContent = this._applyFeedAlgorithm(feedContent, userPreferences);

      // Shuffle for variety
      feedContent = this._shuffleArray(feedContent);

      // Apply offset and limit
      const paginatedContent = feedContent.slice(offset, offset + limit);

      // Get first episode for each content
      const feedWithEpisodes = await this._attachFirstEpisodes(paginatedContent);

      return feedWithEpisodes;

    } catch (error) {
      console.error('Feed generation error:', error);
      throw error;
    }
  }

  /**
   * Get personalized content based on user preferences
   */
  async _getPersonalizedContent(baseQuery, userPreferences, limit) {
    const query = { ...baseQuery };

    // Add genre preferences
    if (userPreferences.genres && userPreferences.genres.length > 0) {
      query.genre = { $in: userPreferences.genres };
    }

    // Add language preferences
    if (userPreferences.languages && userPreferences.languages.length > 0) {
      query.language = { $in: userPreferences.languages };
    }

    const content = await Content.find(query)
      .sort({ 
        'feedSettings.feedPriority': -1,
        'analytics.popularityScore': -1 
      })
      .limit(Math.ceil(limit))
      .lean();

    return this._addContentSource(content, 'personalized');
  }

  /**
   * Get trending content
   */
  async _getTrendingContent(baseQuery, limit) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const query = {
      ...baseQuery,
      publishedAt: { $gte: sevenDaysAgo }
    };

    const content = await Content.find(query)
      .sort({ 'analytics.trendingScore': -1 })
      .limit(Math.ceil(limit))
      .lean();

    return this._addContentSource(content, 'trending');
  }

  /**
   * Get popular content
   */
  async _getPopularContent(baseQuery, limit) {
    const content = await Content.find(baseQuery)
      .sort({ 'analytics.popularityScore': -1 })
      .limit(Math.ceil(limit))
      .lean();

    return this._addContentSource(content, 'popular');
  }

  /**
   * Get fresh/new content
   */
  async _getFreshContent(baseQuery, limit) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const query = {
      ...baseQuery,
      publishedAt: { $gte: thirtyDaysAgo }
    };

    const content = await Content.find(query)
      .sort({ publishedAt: -1 })
      .limit(Math.ceil(limit))
      .lean();

    return this._addContentSource(content, 'fresh');
  }

  /**
   * Apply feed algorithm for better content distribution
   */
  _applyFeedAlgorithm(content, userPreferences) {
    return content.map(item => {
      let algorithmScore = 0;

      // Base score from content analytics
      algorithmScore += (item.analytics.popularityScore || 0) * 0.3;
      algorithmScore += (item.analytics.trendingScore || 0) * 0.2;
      algorithmScore += (item.feedSettings.feedPriority || 1) * 10;
      algorithmScore += (item.feedSettings.feedWeight || 1) * 5;

      // Boost for user preferences
      if (userPreferences.genres && userPreferences.genres.length > 0) {
        const genreMatch = item.genre.some(g => userPreferences.genres.includes(g));
        if (genreMatch) algorithmScore += 20;
      }

      if (userPreferences.languages && userPreferences.languages.length > 0) {
        const languageMatch = item.language.some(l => userPreferences.languages.includes(l));
        if (languageMatch) algorithmScore += 15;
      }

      // Boost for recency
      const daysSincePublished = (Date.now() - new Date(item.publishedAt)) / (1000 * 60 * 60 * 24);
      if (daysSincePublished < 7) {
        algorithmScore += 10;
      } else if (daysSincePublished < 30) {
        algorithmScore += 5;
      }

      // Boost for completion rate
      algorithmScore += (item.analytics.completionRate || 0) * 0.1;

      // Add some randomness to prevent repetitive feeds
      algorithmScore += Math.random() * 10;

      return {
        ...item,
        _algorithmScore: algorithmScore
      };
    }).sort((a, b) => b._algorithmScore - a._algorithmScore);
  }

  /**
   * Remove duplicate content
   */
  _removeDuplicates(content) {
    const seen = new Set();
    return content.filter(item => {
      const id = item._id.toString();
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    });
  }

  /**
   * Shuffle array for variety
   */
  _shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Add content source for analytics
   */
  _addContentSource(content, source) {
    return content.map(item => ({
      ...item,
      _feedSource: source
    }));
  }

  /**
   * Attach first episode to each content
   */
  async _attachFirstEpisodes(content) {
    const contentIds = content.map(c => c._id);
    
    // Get first episode for each content
    const episodes = await Episode.aggregate([
      {
        $match: {
          contentId: { $in: contentIds },
          status: 'published'
        }
      },
      {
        $sort: { contentId: 1, seasonNumber: 1, episodeNumber: 1 }
      },
      {
        $group: {
          _id: '$contentId',
          firstEpisode: { $first: '$$ROOT' }
        }
      }
    ]);

    // Create episode map
    const episodeMap = episodes.reduce((map, item) => {
      map[item._id.toString()] = item.firstEpisode;
      return map;
    }, {});

    // Attach episodes to content
    return content.map(contentItem => {
      const episode = episodeMap[contentItem._id.toString()];
      
      return {
        _id: contentItem._id,
        contentId: contentItem.contentId,
        title: contentItem.title,
        description: contentItem.description,
        genre: contentItem.genre,
        language: contentItem.language,
        type: contentItem.type,
        category: contentItem.category,
        thumbnail: contentItem.thumbnail,
        poster: contentItem.poster,
        rating: contentItem.rating,
        totalEpisodes: contentItem.totalEpisodes,
        analytics: {
          totalViews: contentItem.analytics.totalViews,
          totalLikes: contentItem.analytics.totalLikes,
          averageRating: contentItem.analytics.averageRating,
          popularityScore: contentItem.analytics.popularityScore
        },
        feedSettings: contentItem.feedSettings,
        firstEpisode: episode ? {
          _id: episode._id,
          episodeId: episode.episodeId,
          episodeNumber: episode.episodeNumber,
          title: episode.title,
          thumbnailUrl: episode.thumbnailUrl,
          duration: episode.duration,
          streamUrl: episode.streamUrl || episode.videoUrl
        } : null,
        _feedSource: contentItem._feedSource,
        _algorithmScore: contentItem._algorithmScore
      };
    });
  }

  /**
   * Generate feed for discovery (no personalization)
   */
  async generateDiscoveryFeed(options = {}) {
    const { limit = 20, genre, language, type } = options;

    const query = {
      status: 'published',
      'feedSettings.isInRandomFeed': true
    };

    if (genre) query.genre = { $in: [genre] };
    if (language) query.language = { $in: [language] };
    if (type) query.type = type;

    const content = await Content.find(query)
      .sort({ 'analytics.popularityScore': -1, publishedAt: -1 })
      .limit(limit)
      .lean();

    return this._attachFirstEpisodes(content);
  }

  /**
   * Get similar content based on a given content
   */
  async getSimilarContent(contentId, limit = 10) {
    const sourceContent = await Content.findById(contentId);
    if (!sourceContent) {
      throw new Error('Source content not found');
    }

    const query = {
      _id: { $ne: contentId },
      status: 'published',
      $or: [
        { genre: { $in: sourceContent.genre } },
        { cast: { $in: sourceContent.cast || [] } },
        { director: sourceContent.director },
        { category: sourceContent.category }
      ]
    };

    const similarContent = await Content.find(query)
      .sort({ 'analytics.popularityScore': -1 })
      .limit(limit)
      .lean();

    return this._attachFirstEpisodes(similarContent);
  }

  /**
   * Generate feed based on watch history
   */
  async generateHistoryBasedFeed(userId, limit = 20) {
    // Get user's watch history
    const watchHistory = await Watchlist.aggregate([
      { $match: { userId } },
      {
        $lookup: {
          from: 'contents',
          localField: 'contentId',
          foreignField: '_id',
          as: 'content'
        }
      },
      { $unwind: '$content' },
      {
        $group: {
          _id: null,
          genres: { $addToSet: '$content.genre' },
          languages: { $addToSet: '$content.language' },
          categories: { $addToSet: '$content.category' }
        }
      }
    ]);

    if (!watchHistory.length) {
      return this.generateDiscoveryFeed({ limit });
    }

    const preferences = watchHistory[0];
    const flatGenres = preferences.genres.flat();
    const flatLanguages = preferences.languages.flat();

    return this.generateRandomFeed({
      userPreferences: {
        genres: flatGenres,
        languages: flatLanguages
      },
      limit,
      userId,
      excludeWatched: true
    });
  }

  /**
   * Cache feed for performance
   */
  async getCachedFeed(cacheKey, generator, cacheTime = 900) {
    let feed = await getCache(cacheKey);
    
    if (!feed) {
      feed = await generator();
      await setCache(cacheKey, feed, cacheTime);
    }
    
    return feed;
  }
}

module.exports = new FeedService();