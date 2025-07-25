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
      excludeWatched = false,
      enablePrefetch = true // New option for prefetch
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

      // Enhanced prefetch logic for smooth experience
      if (enablePrefetch && feedWithEpisodes.length > 0) {
        console.log('🚀 Starting prefetch for next episodes...');
        
        // Prefetch logic for next 5-7 episodes
        const prefetchData = await this._prefetchNextEpisodes(feedWithEpisodes, userId);
        
        // Add prefetch data to response
        feedWithEpisodes.forEach((item, index) => {
          if (prefetchData[index]) {
            item._prefetchData = prefetchData[index];
          }
        });
      }

      return feedWithEpisodes;

    } catch (error) {
      console.error('Feed generation error:', error);
      throw error;
    }
  }

  /**
   * Enhanced prefetch logic for next 5-7 episodes
   */
  async _prefetchNextEpisodes(feedContent, userId = null) {
    const prefetchCount = 7; // Prefetch next 7 episodes
    const prefetchData = [];

    try {
      // Process each content item in the feed
      for (let i = 0; i < Math.min(feedContent.length, prefetchCount); i++) {
        const contentItem = feedContent[i];
        
        try {
          // Get next episodes for this content
          const nextEpisodes = await this._getNextEpisodes(
            contentItem._id, 
            contentItem.firstEpisode?.episodeNumber || 1,
            5 // Get next 5 episodes
          );

          // Get user's progress for prefetch optimization
          let watchProgress = null;
          if (userId && nextEpisodes.length > 0) {
            watchProgress = await this._getUserProgressForEpisodes(
              userId, 
              nextEpisodes.map(ep => ep._id)
            );
          }

          // Prepare prefetch URLs with optimized quality
          const prefetchEpisodes = nextEpisodes.map(episode => {
            const userProgress = watchProgress?.[episode._id.toString()];
            
            return {
              _id: episode._id,
              episodeId: episode.episodeId,
              episodeNumber: episode.episodeNumber,
              title: episode.title,
              duration: episode.duration,
              thumbnailUrl: episode.thumbnailUrl,
              // Use lower quality for prefetch to save bandwidth
              prefetchUrl: this._getPrefetchUrl(episode, 'low'),
              streamUrl: this._getPrefetchUrl(episode, 'medium'),
              watchProgress: userProgress || {
                currentPosition: 0,
                percentageWatched: 0,
                isCompleted: false
              },
              prefetchPriority: i + 1 // Higher priority for earlier episodes
            };
          });

          prefetchData.push({
            contentId: contentItem._id,
            nextEpisodes: prefetchEpisodes,
            totalEpisodesAvailable: nextEpisodes.length,
            prefetchStrategy: 'sequential',
            estimatedBandwidth: this._calculatePrefetchBandwidth(prefetchEpisodes)
          });

        } catch (episodeError) {
          console.error(`Prefetch failed for content ${contentItem._id}:`, episodeError);
          
          // Add empty prefetch data to maintain array consistency
          prefetchData.push({
            contentId: contentItem._id,
            nextEpisodes: [],
            totalEpisodesAvailable: 0,
            prefetchStrategy: 'none',
            error: 'Prefetch failed'
          });
        }
      }

      // Background prefetch caching (don't await this)
      this._cachePrefetchData(prefetchData, userId);

      console.log(`✅ Prefetch completed for ${prefetchData.length} content items`);
      return prefetchData;

    } catch (error) {
      console.error('Prefetch process error:', error);
      return [];
    }
  }

  /**
   * Get next episodes for a content
   */
  async _getNextEpisodes(contentId, currentEpisodeNumber, limit = 5) {
    return Episode.find({
      contentId,
      status: 'published',
      episodeNumber: { $gt: currentEpisodeNumber }
    })
    .sort({ seasonNumber: 1, episodeNumber: 1 })
    .limit(limit)
    .select('episodeId episodeNumber seasonNumber title duration thumbnailUrl videoUrl qualityOptions streamingOptions')
    .lean();
  }

  /**
   * Get user progress for multiple episodes
   */
  async _getUserProgressForEpisodes(userId, episodeIds) {
    const progressData = await Watchlist.find({
      userId,
      episodeId: { $in: episodeIds }
    })
    .select('episodeId watchProgress')
    .lean();

    return progressData.reduce((acc, item) => {
      acc[item.episodeId.toString()] = {
        currentPosition: item.watchProgress.currentPosition,
        percentageWatched: item.watchProgress.percentageWatched,
        isCompleted: item.watchProgress.isCompleted
      };
      return acc;
    }, {});
  }

  /**
   * Get prefetch URL with quality optimization
   */
  _getPrefetchUrl(episode, quality = 'low') {
    // Quality mapping for prefetch optimization
    const qualityMapping = {
      low: '480p',
      medium: '720p',
      high: '1080p'
    };

    const targetQuality = qualityMapping[quality] || '480p';

    // Check if episode has quality options
    if (episode.qualityOptions && episode.qualityOptions.length > 0) {
      const qualityOption = episode.qualityOptions.find(q => q.resolution === targetQuality);
      if (qualityOption) {
        return qualityOption.url;
      }
      
      // Fallback to lowest quality for prefetch
      const lowestQuality = episode.qualityOptions.sort((a, b) => {
        const resolutionOrder = { '480p': 1, '720p': 2, '1080p': 3, '4k': 4 };
        return resolutionOrder[a.resolution] - resolutionOrder[b.resolution];
      })[0];
      
      return lowestQuality.url;
    }

    // Fallback to main video URL
    return episode.videoUrl;
  }

  /**
   * Calculate estimated bandwidth for prefetch
   */
  _calculatePrefetchBandwidth(prefetchEpisodes) {
    let totalSize = 0;
    
    prefetchEpisodes.forEach(episode => {
      // Estimate size based on duration and quality
      // Assuming 480p = ~1MB per minute
      const estimatedSizePerMinute = 1024 * 1024; // 1MB
      const durationInMinutes = (episode.duration || 1800) / 60;
      totalSize += durationInMinutes * estimatedSizePerMinute;
    });

    return {
      totalEstimatedSize: totalSize,
      formattedSize: this._formatBytes(totalSize),
      estimatedDownloadTime: Math.ceil(totalSize / (1024 * 1024 * 2)), // Assuming 2MB/s connection
      prefetchParts: prefetchEpisodes.length
    };
  }

  /**
   * Format bytes to human readable format
   */
  _formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Cache prefetch data for future use
   */
  async _cachePrefetchData(prefetchData, userId) {
    try {
      const cacheKey = `prefetch:${userId || 'anonymous'}:${Date.now()}`;
      
      // Cache prefetch data for 10 minutes
      await setCache(cacheKey, {
        data: prefetchData,
        timestamp: new Date(),
        userId: userId || null
      }, 600);

      // Store prefetch URLs in separate cache for quick access
      for (const item of prefetchData) {
        if (item.nextEpisodes.length > 0) {
          const episodeCacheKey = `prefetch:episode:${item.contentId}`;
          await setCache(
            episodeCacheKey, 
            item.nextEpisodes.slice(0, 3), // Cache first 3 episodes
            1200 // 20 minutes
          );
        }
      }

    } catch (error) {
      console.error('Failed to cache prefetch data:', error);
    }
  }

  /**
   * Get cached prefetch data
   */
  async getCachedPrefetchData(contentId, userId = null) {
    try {
      const cacheKey = `prefetch:episode:${contentId}`;
      const cachedData = await getCache(cacheKey);
      
      if (cachedData) {
        console.log(`📦 Returning cached prefetch data for content ${contentId}`);
        return cachedData;
      }

      return null;
    } catch (error) {
      console.error('Failed to get cached prefetch data:', error);
      return null;
    }
  }

  /**
   * Smart prefetch based on user behavior
   */
  async smartPrefetch(userId, contentId, currentEpisodeNumber) {
    try {
      // Get user's viewing pattern
      const userPattern = await this._getUserViewingPattern(userId);
      
      // Determine prefetch count based on user behavior
      let prefetchCount = 3; // Default
      
      if (userPattern.averageEpisodesPerSession > 5) {
        prefetchCount = 7; // User binges, prefetch more
      } else if (userPattern.averageEpisodesPerSession < 2) {
        prefetchCount = 2; // User watches less, prefetch less
      }

      // Get next episodes with smart count
      const nextEpisodes = await this._getNextEpisodes(
        contentId, 
        currentEpisodeNumber, 
        prefetchCount
      );

      // Prioritize based on user preferences
      const prioritizedEpisodes = await this._prioritizeEpisodes(nextEpisodes, userPattern);

      return {
        episodes: prioritizedEpisodes,
        strategy: 'smart',
        basedOn: {
          averageSession: userPattern.averageEpisodesPerSession,
          prefetchCount,
          userPriorities: userPattern.preferences
        }
      };

    } catch (error) {
      console.error('Smart prefetch error:', error);
      return { episodes: [], strategy: 'fallback' };
    }
  }

  /**
   * Get user viewing pattern for smart prefetch
   */
  async _getUserViewingPattern(userId) {
    try {
      const recentSessions = await Watchlist.aggregate([
        {
          $match: {
            userId,
            'sessionInfo.lastWatchedAt': {
              $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
            }
          }
        },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$sessionInfo.lastWatchedAt' } }
            },
            episodesWatched: { $sum: 1 },
            totalWatchTime: { $sum: '$watchProgress.currentPosition' },
            genres: { $addToSet: '$contentId' }
          }
        },
        {
          $group: {
            _id: null,
            averageEpisodesPerSession: { $avg: '$episodesWatched' },
            averageWatchTime: { $avg: '$totalWatchTime' },
            totalSessions: { $sum: 1 }
          }
        }
      ]);

      const pattern = recentSessions[0] || {
        averageEpisodesPerSession: 3,
        averageWatchTime: 1200,
        totalSessions: 1
      };

      return pattern;
    } catch (error) {
      console.error('Failed to get user viewing pattern:', error);
      return {
        averageEpisodesPerSession: 3,
        averageWatchTime: 1200,
        totalSessions: 1
      };
    }
  }

  /**
   * Prioritize episodes based on user pattern
   */
  async _prioritizeEpisodes(episodes, userPattern) {
    // Simple prioritization - can be enhanced with ML
    return episodes.map((episode, index) => ({
      ...episode,
      prefetchPriority: userPattern.averageEpisodesPerSession > 5 ? index + 1 : episodes.length - index,
      estimatedWatchLikelihood: Math.max(0.9 - (index * 0.1), 0.3) // Decreasing likelihood
    }));
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
          streamUrl: episode.streamUrl || episode.videoUrl,
          qualityOptions: episode.qualityOptions || []
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
      excludeWatched: true,
      enablePrefetch: true // Enable prefetch for history-based feeds
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