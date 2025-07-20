const mongoose = require('mongoose');

const episodeSchema = new mongoose.Schema({
  episodeId: {
    type: String,
    required: true,
    unique: true
  },

  // Episode identification
  contentId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Content', 
    required: true
  },
  
  episodeNumber: { type: Number, required: true },
  seasonNumber: { type: Number, default: 1 },
  
  // Episode content
  title: { type: String, required: true, trim: true },
  description: { type: String },
  
  // Video information
  videoUrl: { type: String, required: true }, // GCP storage URL
  thumbnailUrl: { type: String, required: true },
  duration: { type: Number, required: true }, // Duration in seconds
  
  // Video quality and formats
  qualityOptions: [{
    resolution: { type: String, enum: ['480p', '720p', '1080p', '4k'] },
    url: { type: String },
    fileSize: { type: Number }, // Size in bytes
    bitrate: { type: String }
  }],

  // Video metadata from GCP
  fileInfo: {
    fileName: { type: String, required: true },
    fileSize: { type: Number }, // Size in bytes
    contentType: { type: String, default: 'video/mp4' },
    uploadedAt: { type: Date, default: Date.now },
    md5Hash: { type: String }
  },

  // Episode analytics
  analytics: {
    totalViews: { type: Number, default: 0 },
    uniqueViews: { type: Number, default: 0 },
    totalWatchTime: { type: Number, default: 0 }, // Total seconds watched by all users
    averageWatchTime: { type: Number, default: 0 }, // Average per user
    completionRate: { type: Number, default: 0 }, // Percentage who watched till end
    dropOffPoints: [{ // Where users typically stop watching
      timestamp: { type: Number }, // Seconds into video
      dropOffRate: { type: Number } // Percentage who stopped here
    }],
    likes: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    skipRate: { type: Number, default: 0 } // How often users skip this episode
  },

  // Episode ordering and navigation
  previousEpisodeId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Episode' 
  },
  nextEpisodeId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Episode' 
  },

  // Content management
  status: { 
    type: String, 
    enum: ['draft', 'processing', 'published', 'archived'], 
    default: 'draft' 
  },
  
  visibility: {
    type: String,
    enum: ['public', 'premium', 'restricted'],
    default: 'public'
  },

  // Technical specifications
  videoSpecs: {
    codec: { type: String, default: 'H.264' },
    audioCodec: { type: String, default: 'AAC' },
    frameRate: { type: Number, default: 30 },
    aspectRatio: { type: String, default: '16:9' }
  },

  // Streaming optimization
  streamingOptions: {
    isPreloadEnabled: { type: Boolean, default: true },
    preloadDuration: { type: Number, default: 10 }, // Seconds to preload
    adaptiveBitrate: { type: Boolean, default: true },
    chunkSize: { type: Number, default: 1048576 } // 1MB chunks
  },

  // Content warnings and metadata
  contentWarnings: [{ type: String }],
  tags: [{ type: String }],
  
  // Timestamps
  publishedAt: { type: Date },
  lastWatched: { type: Date }
}, {
  timestamps: true,
  versionKey: false
});

// Indexes for better performance
episodeSchema.index({ contentId: 1, episodeNumber: 1 });
episodeSchema.index({ contentId: 1, seasonNumber: 1, episodeNumber: 1 });
episodeSchema.index({ status: 1, publishedAt: -1 });
episodeSchema.index({ 'analytics.totalViews': -1 });

// Compound indexes for episode navigation
episodeSchema.index( { unique: true });

// Virtual for streaming URL with query parameters
episodeSchema.virtual('streamUrl').get(function() {
  if (!this.videoUrl) return null;
  
  // Add streaming parameters for better performance
  const params = new URLSearchParams({
    t: Date.now(), // Cache busting
    q: 'auto', // Quality auto-selection
    preload: this.streamingOptions.isPreloadEnabled ? '1' : '0'
  });
  
  return `${this.videoUrl}?${params.toString()}`;
});

// Instance methods
episodeSchema.methods.incrementViews = function(userId = null) {
  this.analytics.totalViews += 1;
  
  // Track unique views (simplified - in production, use a separate collection)
  if (userId) {
    this.analytics.uniqueViews += 1;
  }
  
  this.lastWatched = new Date();
  return this.save();
};

episodeSchema.methods.updateWatchTime = function(watchedSeconds, userId = null) {
  this.analytics.totalWatchTime += watchedSeconds;
  
  // Calculate completion rate
  const completionPercentage = (watchedSeconds / this.duration) * 100;
  if (completionPercentage >= 80) { // Consider 80% as "completed"
    this.analytics.completionRate = ((this.analytics.completionRate || 0) + 1) / 2; // Simple moving average
  }
  
  // Update average watch time
  this.analytics.averageWatchTime = this.analytics.totalWatchTime / this.analytics.totalViews;
  
  return this.save();
};

episodeSchema.methods.addDropOffPoint = function(timestamp) {
  const existingPoint = this.analytics.dropOffPoints.find(p => 
    Math.abs(p.timestamp - timestamp) < 5 // Within 5 seconds
  );
  
  if (existingPoint) {
    existingPoint.dropOffRate += 1;
  } else {
    this.analytics.dropOffPoints.push({
      timestamp,
      dropOffRate: 1
    });
  }
  
  return this.save();
};

episodeSchema.methods.getOptimalQuality = function(userDataUsage = 'medium') {
  if (!this.qualityOptions || this.qualityOptions.length === 0) {
    return { resolution: '720p', url: this.videoUrl };
  }
  
  const qualityMap = {
    'low': '480p',
    'medium': '720p',
    'high': '1080p'
  };
  
  const preferredQuality = qualityMap[userDataUsage] || '720p';
  
  // Find the best available quality
  let selectedQuality = this.qualityOptions.find(q => q.resolution === preferredQuality);
  
  if (!selectedQuality) {
    // Fallback to the best available quality
    selectedQuality = this.qualityOptions.sort((a, b) => {
      const resolutionOrder = { '480p': 1, '720p': 2, '1080p': 3, '4k': 4 };
      return resolutionOrder[b.resolution] - resolutionOrder[a.resolution];
    })[0];
  }
  
  return selectedQuality || { resolution: '720p', url: this.videoUrl };
};

// Static methods
episodeSchema.statics.getEpisodesByContent = function(contentId, seasonNumber = null) {
  const query = { contentId, status: 'published' };
  
  if (seasonNumber !== null) {
    query.seasonNumber = seasonNumber;
  }
  
  return this.find(query).sort({ seasonNumber: 1, episodeNumber: 1 });
};

episodeSchema.statics.getNextEpisode = function(contentId, currentEpisodeNumber, seasonNumber = 1) {
  return this.findOne({
    contentId,
    seasonNumber,
    episodeNumber: currentEpisodeNumber + 1,
    status: 'published'
  });
};

episodeSchema.statics.getPreviousEpisode = function(contentId, currentEpisodeNumber, seasonNumber = 1) {
  return this.findOne({
    contentId,
    seasonNumber,
    episodeNumber: currentEpisodeNumber - 1,
    status: 'published'
  });
};

episodeSchema.statics.getPopularEpisodes = function(limit = 20) {
  return this.find({ status: 'published' })
    .sort({ 'analytics.totalViews': -1 })
    .limit(limit)
    .populate('contentId', 'title genre language');
};

episodeSchema.statics.getRandomEpisode = function(contentId = null) {
  const query = { status: 'published' };
  if (contentId) query.contentId = contentId;
  
  return this.aggregate([
    { $match: query },
    { $sample: { size: 1 } }
  ]);
};

// Update episode linking when saving
episodeSchema.pre('save', async function(next) {
  if (this.isNew || this.isModified('episodeNumber')) {
    // Find and update previous/next episode links
    const prevEpisode = await this.constructor.findOne({
      contentId: this.contentId,
      seasonNumber: this.seasonNumber,
      episodeNumber: this.episodeNumber - 1
    });
    
    const nextEpisode = await this.constructor.findOne({
      contentId: this.contentId,
      seasonNumber: this.seasonNumber,
      episodeNumber: this.episodeNumber + 1
    });
    
    if (prevEpisode) {
      this.previousEpisodeId = prevEpisode._id;
      prevEpisode.nextEpisodeId = this._id;
      await prevEpisode.save();
    }
    
    if (nextEpisode) {
      this.nextEpisodeId = nextEpisode._id;
      nextEpisode.previousEpisodeId = this._id;
      await nextEpisode.save();
    }
  }
  
  next();
});

module.exports = mongoose.model('Episode', episodeSchema);