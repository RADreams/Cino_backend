const { setCache, getCache, deleteCache, getRedisClient } = require('../config/redis');

class CacheService {
  constructor() {
    this.defaultTTL = 3600; // 1 hour
    this.keyPrefix = 'shorts_app:';
  }

  /**
   * Generate cache key with prefix
   */
  _generateKey(key) {
    return `${this.keyPrefix}${key}`;
  }

  /**
   * Set cache with automatic key prefixing
   */
  async set(key, value, ttl = this.defaultTTL) {
    try {
      const cacheKey = this._generateKey(key);
      return await setCache(cacheKey, value, ttl);
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  /**
   * Get cache with automatic key prefixing
   */
  async get(key) {
    try {
      const cacheKey = this._generateKey(key);
      return await getCache(cacheKey);
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  /**
   * Delete cache with automatic key prefixing
   */
  async delete(key) {
    try {
      const cacheKey = this._generateKey(key);
      return await deleteCache(cacheKey);
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  /**
   * Cache user-specific data
   */
  async setUserCache(userId, dataType, value, ttl = 1800) { // 30 minutes default
    const key = `user:${userId}:${dataType}`;
    return this.set(key, value, ttl);
  }

  /**
   * Get user-specific cache
   */
  async getUserCache(userId, dataType) {
    const key = `user:${userId}:${dataType}`;
    return this.get(key);
  }

  /**
   * Delete user-specific cache
   */
  async deleteUserCache(userId, dataType = '*') {
    if (dataType === '*') {
      // Delete all user cache
      return this.deletePattern(`user:${userId}:*`);
    }
    
    const key = `user:${userId}:${dataType}`;
    return this.delete(key);
  }

  /**
   * Cache content data
   */
  async setContentCache(contentId, dataType, value, ttl = 7200) { // 2 hours default
    const key = `content:${contentId}:${dataType}`;
    return this.set(key, value, ttl);
  }

  /**
   * Get content cache
   */
  async getContentCache(contentId, dataType) {
    const key = `content:${contentId}:${dataType}`;
    return this.get(key);
  }

  /**
   * Cache feed data
   */
  async setFeedCache(userId, feedType, value, ttl = 900) { // 15 minutes default
    const key = userId ? `feed:${userId}:${feedType}` : `feed:anonymous:${feedType}`;
    return this.set(key, value, ttl);
  }

  /**
   * Get feed cache
   */
  async getFeedCache(userId, feedType) {
    const key = userId ? `feed:${userId}:${feedType}` : `feed:anonymous:${feedType}`;
    return this.get(key);
  }

  /**
   * Cache episode data
   */
  async setEpisodeCache(episodeId, dataType, value, ttl = 3600) { // 1 hour default
    const key = `episode:${episodeId}:${dataType}`;
    return this.set(key, value, ttl);
  }

  /**
   * Get episode cache
   */
  async getEpisodeCache(episodeId, dataType) {
    const key = `episode:${episodeId}:${dataType}`;
    return this.get(key);
  }

  /**
   * Cache analytics data
   */
  async setAnalyticsCache(dataType, value, ttl = 1800) { // 30 minutes default
    const key = `analytics:${dataType}`;
    return this.set(key, value, ttl);
  }

  /**
   * Get analytics cache
   */
  async getAnalyticsCache(dataType) {
    const key = `analytics:${dataType}`;
    return this.get(key);
  }

  /**
   * Cache with automatic refresh
   */
  async setWithAutoRefresh(key, value, ttl, refreshFunction) {
    await this.set(key, value, ttl);
    
    // Set up auto-refresh (in production, use a job queue)
    setTimeout(async () => {
      try {
        const newValue = await refreshFunction();
        await this.set(key, newValue, ttl);
      } catch (error) {
        console.error('Auto-refresh error:', error);
      }
    }, (ttl - 300) * 1000); // Refresh 5 minutes before expiry
  }

  /**
   * Get or set cache (cache-aside pattern)
   */
  async getOrSet(key, fetchFunction, ttl = this.defaultTTL) {
    try {
      // Try to get from cache first
      let value = await this.get(key);
      
      if (value !== null) {
        return value;
      }

      // If not in cache, fetch the data
      value = await fetchFunction();
      
      if (value !== null && value !== undefined) {
        // Store in cache for next time
        await this.set(key, value, ttl);
      }

      return value;
    } catch (error) {
      console.error('Cache get-or-set error:', error);
      // If cache fails, still try to fetch the data
      try {
        return await fetchFunction();
      } catch (fetchError) {
        console.error('Fetch function error:', fetchError);
        throw fetchError;
      }
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async deletePattern(pattern) {
    try {
      const client = getRedisClient();
      if (!client) return false;

      const fullPattern = this._generateKey(pattern);
      const keys = await client.keys(fullPattern);
      
      if (keys.length > 0) {
        await client.del(keys);
        return keys.length;
      }
      
      return 0;
    } catch (error) {
      console.error('Cache pattern delete error:', error);
      return false;
    }
  }

  /**
   * Increment counter in cache
   */
  async increment(key, increment = 1, ttl = this.defaultTTL) {
    try {
      const client = getRedisClient();
      if (!client) return null;

      const cacheKey = this._generateKey(key);
      const newValue = await client.incrBy(cacheKey, increment);
      
      // Set expiry if it's a new key
      if (newValue === increment) {
        await client.expire(cacheKey, ttl);
      }
      
      return newValue;
    } catch (error) {
      console.error('Cache increment error:', error);
      return null;
    }
  }

  /**
   * Cache with tags for bulk invalidation
   */
  async setWithTags(key, value, tags = [], ttl = this.defaultTTL) {
    try {
      await this.set(key, value, ttl);
      
      // Store key-tag relationships
      const client = getRedisClient();
      if (client && tags.length > 0) {
        for (const tag of tags) {
          const tagKey = this._generateKey(`tag:${tag}`);
          await client.sAdd(tagKey, this._generateKey(key));
          await client.expire(tagKey, ttl + 300); // Tags expire 5 minutes later
        }
      }
      
      return true;
    } catch (error) {
      console.error('Cache set with tags error:', error);
      return false;
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags) {
    try {
      const client = getRedisClient();
      if (!client) return false;

      const keysToDelete = new Set();
      
      for (const tag of tags) {
        const tagKey = this._generateKey(`tag:${tag}`);
        const taggedKeys = await client.sMembers(tagKey);
        
        taggedKeys.forEach(key => keysToDelete.add(key));
        
        // Delete the tag set itself
        await client.del(tagKey);
      }
      
      if (keysToDelete.size > 0) {
        await client.del([...keysToDelete]);
        return keysToDelete.size;
      }
      
      return 0;
    } catch (error) {
      console.error('Cache invalidate by tags error:', error);
      return false;
    }
  }

  /**
   * Cache warming - preload frequently accessed data
   */
  async warmCache() {
    try {
      console.log('Starting cache warming...');
      
      // Warm up popular content
      const Content = require('../models/Content');
      const popularContent = await Content.find({ 
        status: 'published',
        'analytics.popularityScore': { $gt: 0 }
      })
        .sort({ 'analytics.popularityScore': -1 })
        .limit(50)
        .lean();

      for (const content of popularContent) {
        await this.setContentCache(content._id, 'details', content, 7200);
      }

      // Warm up trending data
      const trendingContent = await Content.find({
        status: 'published',
        'analytics.trendingScore': { $gt: 0 }
      })
        .sort({ 'analytics.trendingScore': -1 })
        .limit(20)
        .lean();

      await this.set('trending:content', trendingContent, 3600);

      console.log('Cache warming completed');
      return true;
    } catch (error) {
      console.error('Cache warming error:', error);
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    try {
      const client = getRedisClient();
      if (!client) return null;

      const info = await client.info('memory');
      const dbSize = await client.dbSize();
      
      // Get our app-specific keys
      const appKeys = await client.keys(this._generateKey('*'));
      
      return {
        totalKeys: dbSize,
        appKeys: appKeys.length,
        memoryUsage: this._parseMemoryInfo(info),
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Cache stats error:', error);
      return null;
    }
  }

  /**
   * Parse Redis memory info
   */
  _parseMemoryInfo(info) {
    const lines = info.split('\r\n');
    const memoryInfo = {};
    
    lines.forEach(line => {
      if (line.includes('used_memory:')) {
        memoryInfo.usedMemory = parseInt(line.split(':')[1]);
      } else if (line.includes('used_memory_human:')) {
        memoryInfo.usedMemoryHuman = line.split(':')[1];
      } else if (line.includes('used_memory_peak:')) {
        memoryInfo.peakMemory = parseInt(line.split(':')[1]);
      }
    });
    
    return memoryInfo;
  }

  /**
   * Clear all application cache
   */
  async clearAllCache() {
    try {
      const client = getRedisClient();
      if (!client) return false;

      const appKeys = await client.keys(this._generateKey('*'));
      
      if (appKeys.length > 0) {
        await client.del(appKeys);
        console.log(`Cleared ${appKeys.length} cache keys`);
        return appKeys.length;
      }
      
      return 0;
    } catch (error) {
      console.error('Clear all cache error:', error);
      return false;
    }
  }

  /**
   * Cache health check
   */
  async healthCheck() {
    try {
      const client = getRedisClient();
      if (!client) return { status: 'unhealthy', message: 'Redis client not available' };

      // Test basic operations
      const testKey = this._generateKey('health_check');
      const testValue = { timestamp: Date.now() };
      
      await client.set(testKey, JSON.stringify(testValue), { EX: 10 });
      const retrieved = await client.get(testKey);
      await client.del(testKey);
      
      if (retrieved && JSON.parse(retrieved).timestamp === testValue.timestamp) {
        return { status: 'healthy', message: 'Cache is working properly' };
      } else {
        return { status: 'unhealthy', message: 'Cache test failed' };
      }
    } catch (error) {
      return { status: 'unhealthy', message: error.message };
    }
  }
}

module.exports = new CacheService();