const mongoose = require('mongoose');

const analyticsSchema = new mongoose.Schema({
  // Event identification
  eventId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Event categorization
  eventType: {
    type: String,
    required: true,
    enum: [
      'video_start', 'video_end', 'video_pause', 'video_resume',
      'swipe_left', 'swipe_right', 'tap_episode', 'like', 'share',
      'app_open', 'app_close', 'session_start', 'session_end',
      'content_view', 'search', 'error', 'buffer_start', 'buffer_end'
    ],
    index: true
  },

  category: {
    type: String,
    enum: ['user_interaction', 'video_playback', 'navigation', 'engagement', 'performance'],
    required: true
  },

  // User and session context
  userId: { type: String, required: true, index: true },
  sessionId: { type: String, index: true },
  
  // Content context
  contentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Content' },
  episodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Episode' },
  
  // Event data
  eventData: {
    // Video playback data
    currentPosition: { type: Number }, // Seconds into video
    totalDuration: { type: Number }, // Total video duration
    playbackSpeed: { type: Number, default: 1 }, // 1x, 1.5x, 2x etc.
    quality: { type: String }, // Video quality selected
    
    // User interaction data
    swipeDirection: { type: String, enum: ['left', 'right'] },
    clickTarget: { type: String }, // What was clicked/tapped
    searchQuery: { type: String },
    
    // Performance data
    loadTime: { type: Number }, // Time to load in milliseconds
    bufferDuration: { type: Number }, // Buffering time
    errorCode: { type: String },
    errorMessage: { type: String },
    
    // Engagement data
    likeStatus: { type: Boolean },
    shareMethod: { type: String, enum: ['whatsapp', 'telegram', 'instagram', 'copy_link'] },
    
    // Navigation data
    previousScreen: { type: String },
    nextScreen: { type: String },
    navigationMethod: { type: String, enum: ['swipe', 'tap', 'back_button'] }
  },

  // Device and technical context
  deviceInfo: {
    platform: { type: String, enum: ['android', 'ios', 'web'] },
    deviceModel: { type: String },
    osVersion: { type: String },
    appVersion: { type: String },
    screenResolution: { type: String },
    networkType: { type: String, enum: ['wifi', '4g', '3g', '2g'] },
    batteryLevel: { type: Number },
    availableStorage: { type: Number }
  },

  // Location context
  location: {
    country: { type: String, default: 'India' },
    state: { type: String },
    city: { type: String },
    timezone: { type: String }
  },

  // Timestamp and session info
  timestamp: { type: Date, default: Date.now, index: true },
  sessionDuration: { type: Number }, // Total session time when event occurred
  
  // Processing status
  processed: { type: Boolean, default: false },
  
  // Additional metadata
  metadata: {
    userAgent: { type: String },
    referrer: { type: String },
    feedPosition: { type: Number }, // Position in feed when event occurred
    experimentGroup: { type: String }, // A/B testing group
    customProperties: { type: mongoose.Schema.Types.Mixed }
  }
}, {
  timestamps: true,
  versionKey: false
});

// Indexes for analytics queries
analyticsSchema.index({ eventType: 1, timestamp: -1 });
analyticsSchema.index({ userId: 1, timestamp: -1 });
analyticsSchema.index({ contentId: 1, eventType: 1 });
analyticsSchema.index({ episodeId: 1, eventType: 1 });
analyticsSchema.index({ category: 1, timestamp: -1 });
analyticsSchema.index({ 'deviceInfo.platform': 1, timestamp: -1 });
analyticsSchema.index({ processed: 1 });

// Compound indexes for complex queries
analyticsSchema.index({ 
  eventType: 1, 
  'deviceInfo.platform': 1, 
  timestamp: -1 
});

// Time-based partitioning (for large scale)
analyticsSchema.index({ 
  timestamp: -1, 
  eventType: 1, 
  userId: 1 
});

// Static methods for analytics queries
analyticsSchema.statics.getUserEngagement = function(userId, startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        userId,
        timestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$eventType',
        count: { $sum: 1 },
        avgSessionDuration: { $avg: '$sessionDuration' }
      }
    }
  ]);
};

analyticsSchema.statics.getContentPerformance = function(contentId, startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        contentId: mongoose.Types.ObjectId(contentId),
        timestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$eventType',
        count: { $sum: 1 },
        uniqueUsers: { $addToSet: '$userId' },
        avgPosition: { $avg: '$eventData.currentPosition' }
      }
    },
    {
      $addFields: {
        uniqueUserCount: { $size: '$uniqueUsers' }
      }
    }
  ]);
};

analyticsSchema.statics.getAppUsageStats = function(startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        timestamp: { $gte: startDate, $lte: endDate },
        eventType: { $in: ['app_open', 'session_start', 'session_end'] }
      }
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          platform: '$deviceInfo.platform'
        },
        sessions: { $sum: 1 },
        uniqueUsers: { $addToSet: '$userId' },
        avgSessionDuration: { $avg: '$sessionDuration' }
      }
    },
    {
      $addFields: {
        uniqueUserCount: { $size: '$uniqueUsers' }
      }
    },
    { $sort: { '_id.date': -1 } }
  ]);
};

analyticsSchema.statics.getVideoDropOffAnalysis = function(episodeId) {
  return this.aggregate([
    {
      $match: {
        episodeId: mongoose.Types.ObjectId(episodeId),
        eventType: { $in: ['video_pause', 'video_end', 'swipe_left'] }
      }
    },
    {
      $bucket: {
        groupBy: '$eventData.currentPosition',
        boundaries: [0, 30, 60, 120, 300, 600, 1200], // seconds
        default: 'long',
        output: {
          dropOffs: { $sum: 1 },
          users: { $addToSet: '$userId' }
        }
      }
    },
    {
      $addFields: {
        uniqueUsers: { $size: '$users' }
      }
    }
  ]);
};

analyticsSchema.statics.getPopularContent = function(limit = 20, timeframe = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - timeframe);
  
  return this.aggregate([
    {
      $match: {
        eventType: 'video_start',
        timestamp: { $gte: startDate },
        contentId: { $exists: true }
      }
    },
    {
      $group: {
        _id: '$contentId',
        views: { $sum: 1 },
        uniqueUsers: { $addToSet: '$userId' },
        avgWatchTime: { $avg: '$eventData.currentPosition' }
      }
    },
    {
      $addFields: {
        uniqueUserCount: { $size: '$uniqueUsers' }
      }
    },
    { $sort: { views: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'contents',
        localField: '_id',
        foreignField: '_id',
        as: 'content'
      }
    }
  ]);
};

analyticsSchema.statics.getUserBehaviorPattern = function(userId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.aggregate([
    {
      $match: {
        userId,
        timestamp: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          hour: { $hour: '$timestamp' },
          eventType: '$eventType'
        },
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: '$_id.hour',
        events: {
          $push: {
            eventType: '$_id.eventType',
            count: '$count'
          }
        },
        totalEvents: { $sum: '$count' }
      }
    },
    { $sort: { '_id': 1 } }
  ]);
};

analyticsSchema.statics.getPerformanceMetrics = function(startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        eventType: { $in: ['buffer_start', 'error'] },
        timestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: {
          platform: '$deviceInfo.platform',
          eventType: '$eventType'
        },
        count: { $sum: 1 },
        avgLoadTime: { $avg: '$eventData.loadTime' },
        avgBufferDuration: { $avg: '$eventData.bufferDuration' }
      }
    }
  ]);
};

analyticsSchema.statics.getRetentionAnalysis = function(cohortDate) {
  return this.aggregate([
    // Complex retention analysis - simplified version
    {
      $match: {
        eventType: 'app_open',
        timestamp: { $gte: cohortDate }
      }
    },
    {
      $group: {
        _id: {
          userId: '$userId',
          day: { $dayOfYear: '$timestamp' }
        }
      }
    },
    {
      $group: {
        _id: '$_id.userId',
        activeDays: { $addToSet: '$_id.day' }
      }
    },
    {
      $addFields: {
        activeDayCount: { $size: '$activeDays' }
      }
    },
    {
      $group: {
        _id: '$activeDayCount',
        userCount: { $sum: 1 }
      }
    },
    { $sort: { '_id': 1 } }
  ]);
};

// Instance methods
analyticsSchema.methods.markAsProcessed = function() {
  this.processed = true;
  return this.save();
};

// Helper function to track events
analyticsSchema.statics.trackEvent = function(eventData) {
  const event = new this({
    eventId: `${eventData.userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ...eventData,
    timestamp: new Date()
  });
  
  return event.save();
};

// Auto-cleanup old analytics data (older than 1 year)
analyticsSchema.statics.cleanupOldData = function() {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  
  return this.deleteMany({ timestamp: { $lt: oneYearAgo } });
};

module.exports = mongoose.model('Analytics', analyticsSchema);