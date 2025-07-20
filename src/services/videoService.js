const { getVideoStreamUrl, generateSignedUrl, getVideoMetadata } = require('../config/gcp');
const { setCache, getCache } = require('../config/redis');

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
        streamUrl = getVideoStreamUrl(episode.fileInfo.fileName);
      }

      // Add streaming parameters
      const params = new URLSearchParams({
        quality: optimalQuality.resolution,
        platform,
        t: Date.now(), // Cache busting
        preload: episode.streamingOptions?.isPreloadEnabled ? '1' : '0'
      });

      return {
        streamUrl: `${streamUrl}?${params.toString()}`,
        quality: optimalQuality.resolution,
        fileSize: optimalQuality.fileSize,
        bitrate: optimalQuality.bitrate,
        preloadDuration: episode.streamingOptions?.preloadDuration || 10
      };

    } catch (error) {
      console.error('Error getting streaming URL:', error);
      throw error;
    }
  }

  /**
   * Get optimal video quality based on user preferences
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

    // Quality mapping based on data usage
    const qualityMap = {
      low: ['480p', '720p', '1080p'],
      medium: ['720p', '1080p', '480p'],
      high: ['1080p', '720p', '480p']
    };

    // Platform-specific adjustments
    if (platform === 'mobile') {
      qualityMap.low = ['480p'];
      qualityMap.medium = ['720p', '480p'];
      qualityMap.high = ['720p', '1080p'];
    }

    const preferredQualities = qualityMap[dataUsage] || qualityMap.medium;

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
   * Generate signed URL for secure video access
   */
  async getSignedStreamingUrl(episode, expiresIn = 3600) {
    try {
      const cacheKey = `signed_url:${episode._id}:${expiresIn}`;
      
      // Check cache first
      let signedUrl = await getCache(cacheKey);
      
      if (!signedUrl) {
        signedUrl = await generateSignedUrl(episode.fileInfo.fileName, expiresIn);
        
        // Cache for 80% of expiry time
        const cacheTime = Math.floor(expiresIn * 0.8);
        await setCache(cacheKey, signedUrl, cacheTime);
      }

      return signedUrl;
    } catch (error) {
      console.error('Error generating signed URL:', error);
      throw error;
    }
  }

  /**
   * Preload video metadata for better UX
   */
  async preloadVideoData(episodes) {
    const preloadPromises = episodes.map(async (episode) => {
      try {
        const metadata = await this.getVideoMetadata(episode);
        return {
          episodeId: episode._id,
          metadata,
          preloadUrl: await this.getStreamingUrl(episode, { dataUsage: 'low' })
        };
      } catch (error) {
        console.error(`Preload failed for episode ${episode._id}:`, error);
        return {
          episodeId: episode._id,
          metadata: null,
          preloadUrl: null
        };
      }
    });

    return Promise.allSettled(preloadPromises);
  }

  /**
   * Get video metadata with caching
   */
  async getVideoMetadata(episode) {
    try {
      const cacheKey = `video_metadata:${episode._id}`;
      
      // Check cache first
      let metadata = await getCache(cacheKey);
      
      if (!metadata) {
        metadata = await getVideoMetadata(episode.fileInfo.fileName);
        
        if (metadata) {
          // Cache for 24 hours
          await setCache(cacheKey, metadata, 86400);
        }
      }

      return metadata || {
        name: episode.fileInfo.fileName,
        size: episode.fileInfo.fileSize,
        contentType: episode.fileInfo.contentType || 'video/mp4',
        duration: episode.duration
      };
    } catch (error) {
      console.error('Error getting video metadata:', error);
      return null;
    }
  }

  /**
   * Generate video thumbnail URL
   */
  generateThumbnailUrl(episode, timestamp = 0) {
    // This would typically involve a video processing service
    // For now, return existing thumbnail or generate a placeholder
    if (episode.thumbnailUrl) {
      return episode.thumbnailUrl;
    }

    // Generate thumbnail URL based on video URL
    const baseUrl = episode.videoUrl.split('.').slice(0, -1).join('.');
    return `${baseUrl}_thumb_${timestamp}.jpg`;
  }

  /**
   * Get video processing status
   */
  async getProcessingStatus(episode) {
    // This would check with video processing service
    // For now, return based on episode status
    return {
      status: episode.status,
      progress: episode.status === 'published' ? 100 : 
                episode.status === 'processing' ? 50 : 0,
      availableQualities: episode.qualityOptions?.map(q => q.resolution) || [],
      processingTime: episode.updatedAt - episode.createdAt
    };
  }

  /**
   * Optimize video for streaming
   */
  async optimizeForStreaming(episode, options = {}) {
    const {
      targetQualities = ['480p', '720p', '1080p'],
      enableAdaptiveBitrate = true,
      generateThumbnails = true
    } = options;

    try {
      // This would typically call a video processing service
      // For now, simulate the optimization process
      const optimizationResult = {
        episodeId: episode._id,
        originalFileSize: episode.fileInfo.fileSize,
        optimizedQualities: [],
        thumbnails: [],
        status: 'processing'
      };

      // Simulate quality generation
      for (const quality of targetQualities) {
        optimizationResult.optimizedQualities.push({
          resolution: quality,
          url: `${episode.videoUrl.replace('.mp4', `_${quality}.mp4`)}`,
          fileSize: this._estimateFileSize(episode.fileInfo.fileSize, quality),
          bitrate: this._getBitrateForQuality(quality)
        });
      }

      // Simulate thumbnail generation
      if (generateThumbnails) {
        const thumbnailCount = Math.min(10, Math.floor(episode.duration / 60));
        for (let i = 0; i < thumbnailCount; i++) {
          const timestamp = Math.floor((episode.duration / thumbnailCount) * i);
          optimizationResult.thumbnails.push({
            timestamp,
            url: this.generateThumbnailUrl(episode, timestamp)
          });
        }
      }

      return optimizationResult;
    } catch (error) {
      console.error('Video optimization error:', error);
      throw error;
    }
  }

  /**
   * Estimate file size for different qualities
   */
  _estimateFileSize(originalSize, quality) {
    const qualityMultipliers = {
      '480p': 0.3,
      '720p': 0.6,
      '1080p': 1.0,
      '4k': 2.5
    };

    return Math.floor(originalSize * (qualityMultipliers[quality] || 1.0));
  }

  /**
   * Get bitrate for quality
   */
  _getBitrateForQuality(quality) {
    const bitrates = {
      '480p': '1000k',
      '720p': '2500k',
      '1080p': '5000k',
      '4k': '15000k'
    };

    return bitrates[quality] || 'auto';
  }

  /**
   * Generate adaptive streaming manifest (HLS/DASH)
   */
  async generateStreamingManifest(episode, format = 'hls') {
    try {
      if (!episode.qualityOptions || episode.qualityOptions.length === 0) {
        throw new Error('No quality options available for streaming manifest');
      }

      const manifest = {
        format,
        episodeId: episode._id,
        duration: episode.duration,
        variants: episode.qualityOptions.map(quality => ({
          resolution: quality.resolution,
          bitrate: quality.bitrate,
          url: quality.url,
          bandwidth: this._getBandwidthForQuality(quality.resolution)
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
   * Generate HLS manifest
   */
  _generateHLSManifest(manifest) {
    let hlsContent = '#EXTM3U\n#EXT-X-VERSION:3\n\n';

    manifest.variants.forEach(variant => {
      hlsContent += `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${variant.resolution}\n`;
      hlsContent += `${variant.url}\n\n`;
    });

    return hlsContent;
  }

  /**
   * Generate DASH manifest
   */
  _generateDASHManifest(manifest) {
    // Simplified DASH manifest structure
    return {
      type: 'dash',
      mediaPresentationDuration: `PT${manifest.duration}S`,
      representations: manifest.variants.map(variant => ({
        id: variant.resolution,
        bandwidth: variant.bandwidth,
        width: this._getWidthForResolution(variant.resolution),
        height: this._getHeightForResolution(variant.resolution),
        baseURL: variant.url
      }))
    };
  }

  /**
   * Get bandwidth for quality
   */
  _getBandwidthForQuality(quality) {
    const bandwidths = {
      '480p': 1000000,
      '720p': 2500000,
      '1080p': 5000000,
      '4k': 15000000
    };

    return bandwidths[quality] || 2500000;
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
   * Track video playback quality changes
   */
  async trackQualityChange(userId, episodeId, fromQuality, toQuality, reason) {
    try {
      // This would be logged for analytics
      const qualityChangeEvent = {
        userId,
        episodeId,
        fromQuality,
        toQuality,
        reason,
        timestamp: new Date()
      };

      // Log to analytics service
      console.log('Quality change tracked:', qualityChangeEvent);
      
      return qualityChangeEvent;
    } catch (error) {
      console.error('Quality change tracking error:', error);
    }
  }

  /**
   * Get video statistics
   */
  async getVideoStatistics(episodeId) {
    try {
      const cacheKey = `video_stats:${episodeId}`;
      
      let stats = await getCache(cacheKey);
      
      if (!stats) {
        // Calculate statistics from database
        stats = {
          totalViews: 0,
          averageWatchTime: 0,
          qualityDistribution: {},
          deviceDistribution: {},
          dropOffPoints: []
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
}

module.exports = new VideoService();