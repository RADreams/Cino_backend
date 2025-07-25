const Content = require('../models/Content');
const Episode = require('../models/Episode');
const User = require('../models/User');
const Watchlist = require('../models/Watchlist');
const Analytics = require('../models/Analytics');
const { deleteCache, flushCache } = require('../config/redis');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { v4: uuidv4 } = require('uuid');
const storageService = require('../services/storageService');
const cdnService = require('../services/cdnService');
const videoService = require('../services/videoService');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');

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

// Enhanced video processing with FFmpeg
const processVideoWithFFmpeg = async (inputBuffer, outputPath, quality = '720p') => {
  return new Promise((resolve, reject) => {
    const tempInputPath = `/tmp/input_${Date.now()}.mp4`;
    const tempOutputPath = `/tmp/output_${Date.now()}_${quality}.mp4`;

    // Quality settings for space optimization
    const qualitySettings = {
      '480p': {
        scale: '854:480',
        bitrate: '800k',
        maxrate: '1200k',
        bufsize: '1600k'
      },
      '720p': {
        scale: '1280:720', 
        bitrate: '1500k',
        maxrate: '2250k',
        bufsize: '3000k'
      },
      '1080p': {
        scale: '1920:1080',
        bitrate: '3000k',
        maxrate: '4500k',
        bufsize: '6000k'
      }
    };

    const settings = qualitySettings[quality] || qualitySettings['720p'];

    // Write input buffer to temp file
    fs.writeFile(tempInputPath, inputBuffer)
      .then(() => {
        const ffmpegArgs = [
          '-i', tempInputPath,
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '23',
          '-vf', `scale=${settings.scale}`,
          '-b:v', settings.bitrate,
          '-maxrate', settings.maxrate,
          '-bufsize', settings.bufsize,
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          '-y',
          tempOutputPath
        ];

        const ffmpeg = spawn('ffmpeg', ffmpegArgs);

        ffmpeg.on('close', async (code) => {
          try {
            // Clean up input file
            await fs.unlink(tempInputPath).catch(() => {});

            if (code === 0) {
              // Read processed file
              const processedBuffer = await fs.readFile(tempOutputPath);
              
              // Clean up output file
              await fs.unlink(tempOutputPath).catch(() => {});
              
              resolve({
                buffer: processedBuffer,
                quality,
                originalSize: inputBuffer.length,
                compressedSize: processedBuffer.length,
                compressionRatio: ((inputBuffer.length - processedBuffer.length) / inputBuffer.length * 100).toFixed(2)
              });
            } else {
              reject(new Error(`FFmpeg process failed with code ${code}`));
            }
          } catch (error) {
            reject(error);
          }
        });

        ffmpeg.on('error', (error) => {
          reject(error);
        });
      })
      .catch(reject);
  });
};

// Generate video thumbnail with FFmpeg
const generateThumbnail = async (inputBuffer, timestamp = 5) => {
  return new Promise((resolve, reject) => {
    const tempInputPath = `/tmp/input_${Date.now()}.mp4`;
    const tempThumbnailPath = `/tmp/thumb_${Date.now()}.jpg`;

    fs.writeFile(tempInputPath, inputBuffer)
      .then(() => {
        const ffmpegArgs = [
          '-i', tempInputPath,
          '-ss', timestamp.toString(),
          '-vframes', '1',
          '-vf', 'scale=854:480',
          '-q:v', '2',
          '-y',
          tempThumbnailPath
        ];

        const ffmpeg = spawn('ffmpeg', ffmpegArgs);

        ffmpeg.on('close', async (code) => {
          try {
            await fs.unlink(tempInputPath).catch(() => {});

            if (code === 0) {
              const thumbnailBuffer = await fs.readFile(tempThumbnailPath);
              await fs.unlink(tempThumbnailPath).catch(() => {});
              resolve(thumbnailBuffer);
            } else {
              reject(new Error(`Thumbnail generation failed with code ${code}`));
            }
          } catch (error) {
            reject(error);
          }
        });

        ffmpeg.on('error', reject);
      })
      .catch(reject);
  });
};

// Enhanced upload video with compression and multiple qualities
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
    tags,
    generateQualities = true
  } = req.body;

  // Validate content exists
  let content;
  if (contentId) {
    content = await Content.findById(contentId);
    if (!content) {
      throw new AppError('Content not found', 404);
    }
  }

  try {
    console.log('🎬 Starting video processing...');
    
    // Generate episode ID
    const episodeId = `episode_${Date.now()}_${uuidv4().slice(0, 8)}`;
    
    const uploadResults = [];
    const qualityOptions = [];

    // Define qualities to generate for space optimization
    const qualities = generateQualities ? ['480p', '720p'] : ['720p']; // Reduced to save space in development
    
    // Process video for different qualities
    for (const quality of qualities) {
      console.log(`📹 Processing ${quality} quality...`);
      
      try {
        // Compress video with FFmpeg
        const processedVideo = await processVideoWithFFmpeg(req.file.buffer, null, quality);
        
        console.log(`✅ ${quality} compressed: ${processedVideo.compressionRatio}% reduction`);

        // Upload compressed video to Cloudflare R2
        const uploadResult = await storageService.uploadVideo(
          processedVideo.buffer,
          {
            originalName: req.file.originalname,
            contentId: content?._id,
            episodeNumber: parseInt(episodeNumber),
            seasonNumber: parseInt(seasonNumber),
            quality: quality
          }
        );

        uploadResults.push(uploadResult);
        
        // Add to quality options
        qualityOptions.push({
          resolution: quality,
          url: uploadResult.cdnUrl || uploadResult.publicUrl,
          fileSize: processedVideo.compressedSize,
          bitrate: quality === '480p' ? '800k' : quality === '720p' ? '1500k' : '3000k'
        });

      } catch (qualityError) {
        console.error(`❌ Failed to process ${quality}:`, qualityError.message);
        // Continue with other qualities
      }
    }

    if (uploadResults.length === 0) {
      throw new AppError('Failed to process video in any quality', 500);
    }

    // Generate thumbnail
    console.log('🖼️ Generating thumbnail...');
    let thumbnailUrl = '';
    try {
      const thumbnailBuffer = await generateThumbnail(req.file.buffer, 5);
      const thumbnailUpload = await storageService.uploadImage(thumbnailBuffer, {
        type: 'thumbnail',
        contentId: content?._id,
        episodeId: episodeId,
        originalName: `${episodeId}_thumbnail.jpg`
      });
      thumbnailUrl = thumbnailUpload.cdnUrl || thumbnailUpload.publicUrl;
      console.log('✅ Thumbnail generated successfully');
    } catch (thumbError) {
      console.error('⚠️ Thumbnail generation failed:', thumbError.message);
    }

    // Use the best quality (720p) as primary
    const primaryUpload = uploadResults.find(r => r.fileName.includes('720p')) || uploadResults[0];

    // Create episode with multiple quality options
    const episode = await Episode.create({
      episodeId,
      contentId: content?._id,
      episodeNumber: parseInt(episodeNumber),
      seasonNumber: parseInt(seasonNumber),
      title,
      description: description || '',
      videoUrl: primaryUpload.publicUrl,
      thumbnailUrl,
      duration: parseInt(duration),
      qualityOptions,
      fileInfo: {
        fileName: primaryUpload.fileName,
        fileSize: primaryUpload.size,
        contentType: req.file.mimetype,
        uploadedAt: primaryUpload.uploadedAt
      },
      streamingOptions: {
        isPreloadEnabled: true,
        preloadDuration: 10,
        adaptiveBitrate: true,
        chunkSize: 1048576
      },
      status: 'published' // Auto-publish in development
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

    // Clear relevant app caches
    await deleteCache('feed:*');
    await deleteCache('trending:*');
    await deleteCache('popular:*');

    // Calculate total space saved
    const totalOriginalSize = req.file.size * qualities.length;
    const totalCompressedSize = uploadResults.reduce((sum, result) => sum + result.size, 0);
    const totalSpaceSaved = ((totalOriginalSize - totalCompressedSize) / totalOriginalSize * 100).toFixed(2);

    res.status(201).json({
      success: true,
      message: 'Video processed and uploaded successfully with optimization',
      data: {
        episode,
        uploadResults: uploadResults.map(result => ({
          quality: result.fileName.match(/_(480p|720p|1080p)_/)?.[1] || 'unknown',
          publicUrl: result.publicUrl,
          cdnUrl: result.cdnUrl,
          size: result.size,
          sizeFormatted: videoService.formatBytes(result.size)
        })),
        optimization: {
          qualitiesGenerated: qualities,
          thumbnailGenerated: !!thumbnailUrl,
          totalSpaceSaved: `${totalSpaceSaved}%`,
          provider: storageService.getProvider()
        },
        streaming: {
          adaptiveBitrate: true,
          qualityOptions: qualityOptions.length,
          preloadEnabled: true
        }
      }
    });

  } catch (error) {
    console.error('❌ Video upload and processing failed:', error);
    throw new AppError(`Failed to process and upload video: ${error.message}`, 500);
  }
});

// Batch upload multiple videos with processing
const batchUploadVideos = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No video files provided', 400);
  }

  const { contentId, seasonNumber = 1 } = req.body;
  
  // Validate content exists
  const content = await Content.findById(contentId);
  if (!content) {
    throw new AppError('Content not found', 404);
  }

  const results = [];
  const errors = [];

  console.log(`🎬 Starting batch processing of ${req.files.length} videos...`);

  // Process videos in parallel (limited concurrency to save resources)
  const concurrency = 2; // Process 2 videos at a time
  
  for (let i = 0; i < req.files.length; i += concurrency) {
    const batch = req.files.slice(i, i + concurrency);
    
    const batchPromises = batch.map(async (file, index) => {
      const episodeNumber = i + index + 1;
      
      try {
        // Create a mock request object for uploadVideo function
        const mockReq = {
          file,
          body: {
            title: `Episode ${episodeNumber}`,
            description: `Episode ${episodeNumber} of ${content.title}`,
            contentId,
            episodeNumber,
            seasonNumber,
            duration: 1800, // Default 30 minutes
            generateQualities: true
          }
        };

        // Process video (reuse the logic from uploadVideo)
        const qualities = ['480p', '720p'];
        const uploadResults = [];
        const qualityOptions = [];

        for (const quality of qualities) {
          const processedVideo = await processVideoWithFFmpeg(file.buffer, null, quality);
          
          const uploadResult = await storageService.uploadVideo(
            processedVideo.buffer,
            {
              originalName: file.originalname,
              contentId: content._id,
              episodeNumber,
              seasonNumber: parseInt(seasonNumber),
              quality
            }
          );

          uploadResults.push(uploadResult);
          qualityOptions.push({
            resolution: quality,
            url: uploadResult.cdnUrl || uploadResult.publicUrl,
            fileSize: processedVideo.compressedSize,
            bitrate: quality === '480p' ? '800k' : '1500k'
          });
        }

        // Generate thumbnail
        const thumbnailBuffer = await generateThumbnail(file.buffer, 5);
        const thumbnailUpload = await storageService.uploadImage(thumbnailBuffer, {
          type: 'thumbnail',
          contentId: content._id,
          episodeId: `episode_${Date.now()}_${episodeNumber}`,
          originalName: `episode_${episodeNumber}_thumbnail.jpg`
        });

        const primaryUpload = uploadResults.find(r => r.fileName.includes('720p')) || uploadResults[0];

        // Create episode
        const episode = await Episode.create({
          episodeId: `episode_${Date.now()}_${uuidv4().slice(0, 8)}`,
          contentId: content._id,
          episodeNumber,
          seasonNumber: parseInt(seasonNumber),
          title: `Episode ${episodeNumber}`,
          description: `Episode ${episodeNumber} of ${content.title}`,
          videoUrl: primaryUpload.publicUrl,
          thumbnailUrl: thumbnailUpload.cdnUrl || thumbnailUpload.publicUrl,
          duration: 1800,
          qualityOptions,
          fileInfo: {
            fileName: primaryUpload.fileName,
            fileSize: primaryUpload.size,
            contentType: file.mimetype,
            uploadedAt: new Date()
          },
          streamingOptions: {
            isPreloadEnabled: true,
            preloadDuration: 10,
            adaptiveBitrate: true
          },
          status: 'published'
        });

        results.push({
          episodeNumber,
          episode,
          uploadResults: uploadResults.length,
          thumbnailGenerated: true
        });

        console.log(`✅ Episode ${episodeNumber} processed successfully`);

      } catch (error) {
        console.error(`❌ Episode ${episodeNumber} failed:`, error.message);
        errors.push({
          episodeNumber,
          error: error.message,
          fileName: file.originalname
        });
      }
    });

    await Promise.allSettled(batchPromises);
  }

  // Update content with new episodes
  const episodeIds = results.map(r => r.episode._id);
  content.episodeIds.push(...episodeIds);
  content.totalEpisodes = content.episodeIds.length;
  await content.save();

  // Clear caches
  await deleteCache('feed:*');
  await deleteCache('trending:*');

  res.status(200).json({
    success: true,
    message: 'Batch video processing completed',
    data: {
      totalFiles: req.files.length,
      successful: results.length,
      failed: errors.length,
      results,
      errors,
      contentUpdated: {
        totalEpisodes: content.totalEpisodes,
        newEpisodesAdded: results.length
      }
    }
  });
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

  // Delete videos from storage if requested
  if (deleteVideos) {
    for (const episode of episodes) {
      try {
        // Delete main video file
        await storageService.deleteFile(episode.fileInfo.fileName);
        
        // Delete quality variants
        if (episode.qualityOptions) {
          for (const quality of episode.qualityOptions) {
            const qualityFileName = quality.url.split('/').pop();
            await storageService.deleteFile(qualityFileName);
          }
        }
        
        // Delete thumbnail
        if (episode.thumbnailUrl) {
          const thumbnailFileName = episode.thumbnailUrl.split('/').pop();
          await storageService.deleteFile(thumbnailFileName);
        }
      } catch (error) {
        console.error(`Failed to delete files for episode ${episode._id}:`, error);
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
  batchUploadVideos,
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