const { generateSignedUrl } = require('../config/gcp');
const { setCache, getCache } = require('../config/redis');
const storageService = require('./storageService');

class VideoService {
  /**
   * Get streaming URL for video with optimization
   */
  async getStreamingUrl(episode, userPreferences = {}) {
    try {
      const { dataUsage = 'medium', platform = 'web' } = userPreferences;
      
      // Get optimal quality based on user preferences
      const optimalQuality = this._getOptimalQuality(episode, dataUsage, platform);
      
      // Generate streaming URL
      let streamUrl;
      
      if (optimalQuality.url) {
        streamUrl = optimalQuality.url;
      } else {
        streamUrl = episode.videoUrl;
      }

      // Add streaming parameters for Cloudflare optimization
      const params = new URLSearchParams({
        quality: optimalQuality.resolution,
        platform,
        t: Date.now(), // Cache busting
        preload: episode.streamingOptions?.isPreloadEnabled ? '1' : '0',
        cf_cache: '1' // Enable Cloudflare caching
      });

      return {
        streamUrl: `${streamUrl}?${params.toString()}`,
        quality: optimalQuality.resolution,
        fileSize: optimalQuality.fileSize,
        bitrate: optimalQuality.bitrate,
        preloadDuration: episode.streamingOptions?.preloadDuration || 10,
        cdnOptimized: true
      };

    } catch (error) {
      console.error('Error getting streaming URL:', error);
      throw error;
    }
  }

  /**
   * Get optimal video quality based on user preferences and device
   */
  _getOptimalQuality(episode, dataUsage, platform) {
    if (!episode.qualityOptions || episode.qualityOptions.length === 0) {
      return {
        resolution: '720p',
        url: episode.videoUrl,
        fileSize: episode.fileInfo?.fileSize || 0,
        bitrate: 'auto'
      };
    }

    // Enhanced quality mapping based on data usage and platform
    const qualityMap = {
      low: {
        mobile: ['480p'],
        web: ['480p', '720p'],
        tablet: ['480p', '720p']
      },
      medium: {
        mobile: ['720p', '480p'],
        web: ['720p', '1080p', '480p'],
        tablet: ['720p', '1080p']
      },
      high: {
        mobile: ['720p', '1080p'],
        web: ['1080p', '720p', '4k'],
        tablet: ['1080p', '720p']
      }
    };

    const deviceType = this._getDeviceType(platform);
    const preferredQualities = qualityMap[dataUsage]?.[deviceType] || qualityMap.medium.web;

    // Find best available quality
    for (const quality of preferredQualities) {
      const option = episode.qualityOptions.find(q => q.resolution === quality);
      if (option) {
        return option;
      }
    }

    // Fallback to first available quality
    return episode.qualityOptions[0];
  }

  /**
   * Determine device type from platform
   */
  _getDeviceType(platform) {
    if (platform === 'android' || platform === 'ios') {
      return 'mobile';
    } else if (platform === 'tablet') {
      return 'tablet';
    }
    return 'web';
  }

  /**
   * Generate signed URL for secure video access (for premium content)
   */
  async getSignedStreamingUrl(episode, expiresIn = 3600) {
    try {
      const cacheKey = `signed_url:${episode._id}:${expiresIn}`;
      
      // Check cache first
      let signedUrl = await getCache(cacheKey);
      
      if (!signedUrl) {
        if (storageService.getProvider() === 'gcp') {
          signedUrl = await generateSignedUrl(episode.fileInfo.fileName, expiresIn);
        } else {
          // For Cloudflare R2, use their signed URL method
          signedUrl = await storageService.getSignedUrl(episode.fileInfo.fileName, {
            expiresIn
          });
        }
        
        if (signedUrl) {
          // Cache for 80% of expiry time
          const cacheTime = Math.floor(expiresIn * 0.8);
          await setCache(cacheKey, signedUrl, cacheTime);
        }
      }

      return signedUrl;
    } catch (error) {
      console.error('Error generating signed URL:', error);
      throw error;
    }
  }

  /**
   * Enhanced preload video metadata for better UX
   */
  async preloadVideoData(episodes, userPreferences = {}) {
    const preloadPromises = episodes.map(async (episode) => {
      try {
        const [metadata, streamingUrl] = await Promise.all([
          this.getVideoMetadata(episode),
          this.getStreamingUrl(episode, { 
            ...userPreferences, 
            dataUsage: 'low' // Use low quality for preload
          })
        ]);

        return {
          episodeId: episode._id,
          metadata,
          preloadUrl: streamingUrl.streamUrl,
          estimatedSize: this._estimatePreloadSize(episode, 'low'),
          priority: episode._prefetchPriority || 1
        };
      } catch (error) {
        console.error(`Preload failed for episode ${episode._id}:`, error);
        return {
          episodeId: episode._id,
          metadata: null,
          preloadUrl: null,
          error: error.message
        };
      }
    });

    const results = await Promise.allSettled(preloadPromises);
    
    return results.map(result => 
      result.status === 'fulfilled' ? result.value : { error: 'Preload failed' }
    );
  }

  /**
   * Estimate preload size for bandwidth optimization
   */
  _estimatePreloadSize(episode, quality = 'low') {
    const qualitySizeMultipliers = {
      '480p': 0.5,  // 0.5 MB per minute
      '720p': 1.2,  // 1.2 MB per minute
      '1080p': 2.5, // 2.5 MB per minute
      '4k': 6.0     // 6.0 MB per minute
    };

    const qualityToUse = quality === 'low' ? '480p' : quality === 'medium' ? '720p' : '1080p';
    const multiplier = qualitySizeMultipliers[qualityToUse] || 1.2;
    const durationInMinutes = (episode.duration || 1800) / 60;
    const estimatedSizeMB = durationInMinutes * multiplier;

    return {
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      estimatedSizeBytes: Math.round(estimatedSizeMB * 1024 * 1024),
      quality: qualityToUse,
      duration: episode.duration
    };
  }

  /**
   * Get video metadata with enhanced caching
   */
  async getVideoMetadata(episode) {
    try {
      const cacheKey = `video_metadata:${episode._id}`;
      
      // Check cache first
      let metadata = await getCache(cacheKey);
      
      if (!metadata) {
        // Get metadata from storage service
        if (episode.fileInfo?.fileName) {
          metadata = await storageService.getFileMetadata(episode.fileInfo.fileName);
        }

        // Fallback to episode data
        if (!metadata) {
          metadata = {
            name: episode.fileInfo?.fileName || episode.title,
            size: episode.fileInfo?.fileSize || 0,
            contentType: episode.fileInfo?.contentType || 'video/mp4',
            duration: episode.duration,
            provider: storageService.getProvider()
          };
        }

        // Enhanced metadata with compression info
        if (episode.qualityOptions && episode.qualityOptions.length > 0) {
          metadata.qualities = episode.qualityOptions.map(q => ({
            resolution: q.resolution,
            fileSize: q.fileSize,
            bitrate: q.bitrate,
            compressionRatio: this._calculateCompressionRatio(episode.fileInfo?.fileSize, q.fileSize)
          }));
        }

        if (metadata) {
          // Cache for 6 hours
          await setCache(cacheKey, metadata, 21600);
        }
      }

      return metadata;
    } catch (error) {
      console.error('Error getting video metadata:', error);
      return {
        name: episode.title || 'Unknown',
        size: episode.fileInfo?.fileSize || 0,
        contentType: 'video/mp4',
        duration: episode.duration || 0,
        error: error.message
      };
    }
  }

  /**
   * Calculate compression ratio
   */
  _calculateCompressionRatio(originalSize, compressedSize) {
    if (!originalSize || !compressedSize) return 0;
    return Math.round(((originalSize - compressedSize) / originalSize) * 100);
  }

  /**
   * Generate video thumbnail URL with CDN optimization
   */
  generateThumbnailUrl(episode, timestamp = 0) {
    if (episode.thumbnailUrl) {
      // Add CDN optimization parameters
      const url = new URL(episode.thumbnailUrl);
      url.searchParams.set('t', timestamp.toString());
      url.searchParams.set('w', '854'); // Width
      url.searchParams.set('h', '480'); // Height
      url.searchParams.set('f', 'webp'); // Format optimization
      url.searchParams.set('q', '85'); // Quality
      return url.toString();
    }

    // Generate placeholder thumbnail
    return this._generatePlaceholderThumbnail(episode, timestamp);
  }

  /**
   * Generate placeholder thumbnail
   */
  _generatePlaceholderThumbnail(episode, timestamp) {
    // Use a service like placeholder.com or generate based on episode data
    const colors = ['FF6B6B', '4ECDC4', '45B7D1', 'FFA07A', '98D8C8'];
    const colorIndex = Math.abs(episode._id.toString().charCodeAt(0)) % colors.length;
    const color = colors[colorIndex];
    
    return `https://via.placeholder.com/854x480/${color}/FFFFFF?text=${encodeURIComponent(episode.title || 'Episode')}`;
  }

  /**
   * Get video processing status with enhanced info
   */
  async getProcessingStatus(episode) {
    const status = {
      status: episode.status,
      progress: this._calculateProcessingProgress(episode),
      availableQualities: episode.qualityOptions?.map(q => q.resolution) || [],
      processingTime: episode.updatedAt ? episode.updatedAt - episode.createdAt : 0,
      optimization: {
        qualitiesGenerated: episode.qualityOptions?.length || 0,
        hasThumbnail: !!episode.thumbnailUrl,
        hasAdaptiveBitrate: episode.streamingOptions?.adaptiveBitrate || false,
        compressionEnabled: (episode.qualityOptions?.length || 0) > 1
      }
    };

    // Add estimated completion time if processing
    if (episode.status === 'processing') {
      status.estimatedCompletion = this._estimateProcessingCompletion(episode);
    }

    return status;
  }

  /**
   * Calculate processing progress
   */
  _calculateProcessingProgress(episode) {
    switch (episode.status) {
      case 'published':
        return 100;
      case 'processing':
        // Estimate based on qualities generated
        const targetQualities = 2; // 480p, 720p
        const currentQualities = episode.qualityOptions?.length || 0;
        return Math.min(90, (currentQualities / targetQualities) * 90);
      case 'draft':
        return 0;
      default:
        return 0;
    }
  }

  /**
   * Estimate processing completion time
   */
  _estimateProcessingCompletion(episode) {
    const fileSize = episode.fileInfo?.fileSize || 0;
    const duration = episode.duration || 0;
    
    // Rough estimation: 1 minute of processing per 1 minute of video
    const estimatedMinutes = Math.max(1, Math.ceil(duration / 60));
    
    return {
      estimatedMinutes,
      estimatedCompletion: new Date(Date.now() + estimatedMinutes * 60 * 1000)
    };
  }

  /**
   * Enhanced video optimization with space-saving focus
   */
  async optimizeForStreaming(episode, options = {}) {
    const {
      targetQualities = ['480p', '720p'], // Reduced for development
      enableAdaptiveBitrate = true,
      generateThumbnails = true,
      prioritizeSpaceSaving = true
    } = options;

    try {
      const optimizationResult = {
        episodeId: episode._id,
        originalFileSize: episode.fileInfo?.fileSize || 0,
        optimizedQualities: [],
        thumbnails: [],
        status: 'processing',
        spaceSaving: {
          enabled: prioritizeSpaceSaving,
          strategy: 'aggressive_compression'
        }
      };

      // Enhanced quality generation with space optimization
      for (const quality of targetQualities) {
        const optimizedQuality = await this._generateOptimizedQuality(episode, quality, {
          prioritizeSpaceSaving
        });
        
        optimizationResult.optimizedQualities.push(optimizedQuality);
      }

      // Generate thumbnails at specific intervals
      if (generateThumbnails) {
        const thumbnailTimestamps = this._calculateThumbnailTimestamps(episode.duration);
        
        for (const timestamp of thumbnailTimestamps) {
          optimizationResult.thumbnails.push({
            timestamp,
            url: this.generateThumbnailUrl(episode, timestamp),
            size: '854x480'
          });
        }
      }

      // Calculate total space savings
      const totalOriginalSize = episode.fileInfo?.fileSize * targetQualities.length;
      const totalOptimizedSize = optimizationResult.optimizedQualities.reduce(
        (sum, q) => sum + q.fileSize, 0
      );
      
      optimizationResult.spaceSaving.totalSaved = totalOriginalSize - totalOptimizedSize;
      optimizationResult.spaceSaving.percentageSaved = 
        Math.round((optimizationResult.spaceSaving.totalSaved / totalOriginalSize) * 100);

      optimizationResult.status = 'completed';
      return optimizationResult;

    } catch (error) {
      console.error('Video optimization error:', error);
      throw error;
    }
  }

  /**
   * Generate optimized quality with space-saving focus
   */
  async _generateOptimizedQuality(episode, quality, options = {}) {
    const { prioritizeSpaceSaving } = options;
    
    // Space-optimized settings
    const qualitySettings = {
      '480p': {
        resolution: '854x480',
        bitrate: prioritizeSpaceSaving ? '600k' : '800k',
        targetSize: 0.4 // 40% of original
      },
      '720p': {
        resolution: '1280x720',
        bitrate: prioritizeSpaceSaving ? '1200k' : '1500k',
        targetSize: 0.6 // 60% of original
      },
      '1080p': {
        resolution: '1920x1080',
        bitrate: prioritizeSpaceSaving ? '2400k' : '3000k',
        targetSize: 0.8 // 80% of original
      }
    };

    const settings = qualitySettings[quality] || qualitySettings['720p'];
    const originalSize = episode.fileInfo?.fileSize || 0;
    
    return {
      resolution: quality,
      url: `${episode.videoUrl.replace('.mp4', `_${quality}.mp4`)}`,
      fileSize: Math.round(originalSize * settings.targetSize),
      bitrate: settings.bitrate,
      compressionRatio: Math.round((1 - settings.targetSize) * 100),
      optimizationLevel: prioritizeSpaceSaving ? 'aggressive' : 'standard'
    };
  }

  /**
   * Calculate thumbnail timestamps
   */
  _calculateThumbnailTimestamps(duration) {
    if (!duration || duration < 60) return [5]; // Just one thumbnail for short videos
    
    const thumbnailCount = Math.min(10, Math.max(3, Math.floor(duration / 300))); // Every 5 minutes, max 10
    const interval = duration / (thumbnailCount + 1);
    
    return Array.from({ length: thumbnailCount }, (_, i) => Math.round(interval * (i + 1)));
  }

  /**
   * Generate adaptive streaming manifest optimized for CDN
   */
  async generateStreamingManifest(episode, format = 'hls', options = {}) {
    try {
      if (!episode.qualityOptions || episode.qualityOptions.length === 0) {
        throw new Error('No quality options available for streaming manifest');
      }

      const { cdnOptimization = true } = options;

      const manifest = {
        format,
        episodeId: episode._id,
        duration: episode.duration,
        provider: storageService.getProvider(),
        cdnOptimized: cdnOptimization,
        variants: episode.qualityOptions.map(quality => ({
          resolution: quality.resolution,
          bitrate: quality.bitrate,
          url: cdnOptimization ? this._addCDNOptimization(quality.url) : quality.url,
          bandwidth: this._getBandwidthForQuality(quality.resolution),
          fileSize: quality.fileSize
        }))
      };

      if (format === 'hls') {
        return this._generateHLSManifest(manifest);
      } else if (format === 'dash') {
        return this._generateDASHManifest(manifest);
      }

      return manifest;
    } catch (error) {
      console.error('Manifest generation error:', error);
      throw error;
    }
  }

  /**
   * Add CDN optimization parameters
   */
  _addCDNOptimization(url) {
    const optimizedUrl = new URL(url);
    optimizedUrl.searchParams.set('cf_cache', '1');
    optimizedUrl.searchParams.set('cf_compress', '1');
    optimizedUrl.searchParams.set('cf_minify', '1');
    return optimizedUrl.toString();
  }

  /**
   * Enhanced HLS manifest generation
   */
  _generateHLSManifest(manifest) {
    let hlsContent = '#EXTM3U\n#EXT-X-VERSION:6\n\n';
    
    // Add bandwidth-optimized streams
    manifest.variants
      .sort((a, b) => a.bandwidth - b.bandwidth)
      .forEach(variant => {
        hlsContent += `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${variant.resolution}`;
        if (manifest.cdnOptimized) {
          hlsContent += `,CODECS="avc1.64001e,mp4a.40.2"`;
        }
        hlsContent += `\n${variant.url}\n\n`;
      });

    return {
      type: 'hls',
      content: hlsContent,
      variants: manifest.variants.length,
      cdnOptimized: manifest.cdnOptimized
    };
  }

  /**
   * Enhanced DASH manifest generation
   */
  _generateDASHManifest(manifest) {
    return {
      type: 'dash',
      mediaPresentationDuration: `PT${manifest.duration}S`,
      cdnOptimized: manifest.cdnOptimized,
      representations: manifest.variants.map(variant => ({
        id: variant.resolution,
        bandwidth: variant.bandwidth,
        width: this._getWidthForResolution(variant.resolution),
        height: this._getHeightForResolution(variant.resolution),
        baseURL: variant.url,
        fileSize: variant.fileSize
      }))
    };
  }

  /**
   * Get bandwidth for quality (optimized values)
   */
  _getBandwidthForQuality(quality) {
    const bandwidths = {
      '480p': 800000,   // Reduced for space saving
      '720p': 1500000,  // Reduced for space saving
      '1080p': 3000000, // Reduced for space saving
      '4k': 8000000     // Reduced for space saving
    };

    return bandwidths[quality] || 1500000;
  }

  /**
   * Get width for resolution
   */
  _getWidthForResolution(resolution) {
    const widths = {
      '480p': 854,
      '720p': 1280,
      '1080p': 1920,
      '4k': 3840
    };

    return widths[resolution] || 1280;
  }

  /**
   * Get height for resolution
   */
  _getHeightForResolution(resolution) {
    const heights = {
      '480p': 480,
      '720p': 720,
      '1080p': 1080,
      '4k': 2160
    };

    return heights[resolution] || 720;
  }

  /**
   * Track video playback quality changes for optimization
   */
  async trackQualityChange(userId, episodeId, fromQuality, toQuality, reason) {
    try {
      const qualityChangeEvent = {
        userId,
        episodeId,
        fromQuality,
        toQuality,
        reason,
        timestamp: new Date(),
        provider: storageService.getProvider()
      };

      // Cache quality preferences
      const userQualityKey = `user_quality:${userId}`;
      await setCache(userQualityKey, {
        preferredQuality: toQuality,
        lastChanged: new Date(),
        reason
      }, 7200); // 2 hours

      console.log('Quality change tracked:', qualityChangeEvent);
      return qualityChangeEvent;
    } catch (error) {
      console.error('Quality change tracking error:', error);
    }
  }

  /**
   * Get enhanced video statistics
   */
  async getVideoStatistics(episodeId) {
    try {
      const cacheKey = `video_stats:${episodeId}`;
      
      let stats = await getCache(cacheKey);
      
      if (!stats) {
        // Get episode data
        const Episode = require('../models/Episode');
        const Watchlist = require('../models/Watchlist');
        
        const [episode, watchData] = await Promise.all([
          Episode.findById(episodeId).lean(),
          Watchlist.find({ episodeId }).lean()
        ]);

        if (!episode) {
          return null;
        }

        // Calculate statistics
        stats = {
          totalViews: watchData.length,
          uniqueUsers: [...new Set(watchData.map(w => w.userId))].length,
          averageWatchTime: watchData.reduce((sum, w) => sum + w.watchProgress.currentPosition, 0) / watchData.length || 0,
          completionRate: (watchData.filter(w => w.watchProgress.isCompleted).length / watchData.length) * 100 || 0,
          qualityDistribution: this._calculateQualityDistribution(watchData),
          deviceDistribution: this._calculateDeviceDistribution(watchData),
          dropOffPoints: this._calculateDropOffPoints(watchData, episode.duration),
          optimization: {
            spaceSavingEnabled: (episode.qualityOptions?.length || 0) > 1,
            compressionRatio: this._calculateAverageCompressionRatio(episode),
            cdnEnabled: true
          }
        };

        // Cache for 1 hour
        await setCache(cacheKey, stats, 3600);
      }

      return stats;
    } catch (error) {
      console.error('Error getting video statistics:', error);
      return null;
    }
  }

  /**
   * Calculate quality distribution
   */
  _calculateQualityDistribution(watchData) {
    const qualityCount = {};
    watchData.forEach(w => {
      const quality = w.userInteraction?.quality || '720p';
      qualityCount[quality] = (qualityCount[quality] || 0) + 1;
    });
    return qualityCount;
  }

  /**
   * Calculate device distribution
   */
  _calculateDeviceDistribution(watchData) {
    const deviceCount = {};
    watchData.forEach(w => {
      const device = w.userInteraction?.device || 'unknown';
      deviceCount[device] = (deviceCount[device] || 0) + 1;
    });
    return deviceCount;
  }

  /**
   * Calculate drop-off points
   */
  _calculateDropOffPoints(watchData, duration) {
    const intervals = 10; // Divide video into 10 parts
    const intervalSize = duration / intervals;
    const dropOffs = new Array(intervals).fill(0);

    watchData.forEach(w => {
      const watchedPercentage = w.watchProgress.percentageWatched;
      const intervalIndex = Math.min(Math.floor((watchedPercentage / 100) * intervals), intervals - 1);
      
      if (watchedPercentage < 100) { // Only count if not completed
        dropOffs[intervalIndex] += 1;
      }
    });

    return dropOffs.map((count, index) => ({
      intervalStart: index * intervalSize,
      intervalEnd: (index + 1) * intervalSize,
      dropOffCount: count,
      percentage: Math.round((count / watchData.length) * 100) || 0
    }));
  }

  /**
   * Calculate average compression ratio for episode
   */
  _calculateAverageCompressionRatio(episode) {
    if (!episode.qualityOptions || episode.qualityOptions.length === 0) {
      return 0;
    }

    const originalSize = episode.fileInfo?.fileSize || 0;
    if (!originalSize) return 0;

    const totalCompressedSize = episode.qualityOptions.reduce((sum, q) => sum + (q.fileSize || 0), 0);
    const averageCompressedSize = totalCompressedSize / episode.qualityOptions.length;
    
    return Math.round(((originalSize - averageCompressedSize) / originalSize) * 100);
  }

  /**
   * Format bytes to human readable format
   */
  formatBytes(bytes, decimals = 2) {
    if (!bytes) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  /**
   * Health check for video service
   */
  async healthCheck() {
    try {
      const storageHealth = await storageService.healthCheck();
      
      return {
        status: storageHealth.status === 'healthy' ? 'healthy' : 'degraded',
        provider: storageService.getProvider(),
        features: {
          multiQuality: true,
          cdnOptimization: true,
          adaptiveStreaming: true,
          spaceSaving: true
        },
        storage: storageHealth,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date()
      };
    }
  }
}

module.exports = new VideoService();