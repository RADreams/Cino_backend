const mongoose = require('mongoose');

const watchlistSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },

  contentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Content',
    required: true
  },

  episodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Episode',
    required: true
  },

  // Watch progress
  watchProgress: {
    currentPosition: { type: Number, default: 0 }, // Seconds watched
    totalDuration: { type: Number, required: true }, // Total episode duration
    percentageWatched: { type: Number, default: 0 }, // Calculated percentage
    isCompleted: { type: Boolean, default: false }, // 80%+ watched
    watchCount: { type: Number, default: 1 } // How many times watched
  },

  // Episode context
  episodeDetails: {
    episodeNumber: { type: Number, required: true },
    seasonNumber: { type: Number, default: 1 },
    episodeTitle: { type: String }
  },

  // User interaction
  userInteraction: {
    liked: { type: Boolean, default: false },
    shared: { type: Boolean, default: false },
    rating: { type: Number, min: 1, max: 5 }, // User rating
    watchedVia: { 
      type: String, 
      enum: ['feed', 'episode-list', 'search', 'recommendation'], 
      default: 'feed' 
    },
    device: { type: String }, // Device used for watching
    quality: { type: String } // Video quality watched
  },

  // Engagement tracking
  engagement: {
    sessionDuration: { type: Number, default: 0 }, // How long user stayed in app
    swipeDirection: { 
      type: String, 
      enum: ['left', 'right', 'none'], 
      default: 'none' 
    }, // Last swipe action
    pauseCount: { type: Number, default: 0 }, // How many times paused
    seekCount: { type: Number, default: 0 }, // How many times seeked
    bufferingTime: { type: Number, default: 0 } // Total buffering time
  },

  // Watch session details
  sessionInfo: {
    startedAt: { type: Date, default: Date.now },
    lastWatchedAt: { type: Date, default: Date.now },
    completedAt: { type: Date }, // When user finished watching
    totalSessions: { type: Number, default: 1 }, // Multiple viewing sessions
    averageSessionLength: { type: Number, default: 0 }
  },

  // Status and flags
  status: {
    type: String,
    enum: ['watching', 'completed', 'dropped', 'paused'],
    default: 'watching'
  },

  // Recommendation data
  recommendationContext: {
    source: { 
      type: String, 
      enum: ['feed', 'similar', 'trending', 'genre', 'manual'] 
    },
    previousContentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Content' },
    recommendationScore: { type: Number } // Algorithm confidence
  }
}, {
  timestamps: true,
  versionKey: false
});

// Compound indexes for better performance
watchlistSchema.index({ userId: 1, contentId: 1 });
watchlistSchema.index({ userId: 1, episodeId: 1 }, { unique: true });
watchlistSchema.index({ userId: 1, status: 1 });
watchlistSchema.index({ userId: 1, 'sessionInfo.lastWatchedAt': -1 });
watchlistSchema.index({ contentId: 1, 'watchProgress.isCompleted': 1 });

// Calculate percentage watched before saving
watchlistSchema.pre('save', function(next) {
  if (this.watchProgress.currentPosition && this.watchProgress.totalDuration) {
    this.watchProgress.percentageWatched = 
      (this.watchProgress.currentPosition / this.watchProgress.totalDuration) * 100;
    
    // Mark as completed if watched 80% or more
    if (this.watchProgress.percentageWatched >= 80) {
      this.watchProgress.isCompleted = true;
      this.status = 'completed';
      if (!this.sessionInfo.completedAt) {
        this.sessionInfo.completedAt = new Date();
      }
    }
  }
  
  // Update last watched time
  this.sessionInfo.lastWatchedAt = new Date();
  
  next();
});

// Instance methods
watchlistSchema.methods.updateProgress = function(currentPosition, sessionDuration = 0) {
  this.watchProgress.currentPosition = Math.max(this.watchProgress.currentPosition, currentPosition);
  this.engagement.sessionDuration += sessionDuration;
  this.sessionInfo.totalSessions += 1;
  
  // Calculate average session length
  this.sessionInfo.averageSessionLength = 
    this.engagement.sessionDuration / this.sessionInfo.totalSessions;
  
  return this.save();
};

watchlistSchema.methods.markAsCompleted = function() {
  this.watchProgress.isCompleted = true;
  this.status = 'completed';
  this.sessionInfo.completedAt = new Date();
  return this.save();
};

watchlistSchema.methods.addEngagement = function(engagementData) {
  Object.assign(this.engagement, engagementData);
  return this.save();
};

watchlistSchema.methods.updateRating = function(rating) {
  this.userInteraction.rating = rating;
  return this.save();
};

watchlistSchema.methods.toggleLike = function() {
  this.userInteraction.liked = !this.userInteraction.liked;
  return this.save();
};

// Static methods
watchlistSchema.statics.getUserWatchHistory = function(userId, limit = 50) {
  return this.find({ userId })
    .sort({ 'sessionInfo.lastWatchedAt': -1 })
    .limit(limit)
    .populate('contentId', 'title thumbnail genre')
    .populate('episodeId', 'title episodeNumber duration');
};

watchlistSchema.statics.getUserProgress = function(userId, contentId) {
  return this.find({ userId, contentId })
    .sort({ 'episodeDetails.episodeNumber': 1 })
    .populate('episodeId', 'title episodeNumber duration');
};

watchlistSchema.statics.getWatchedContent = function(userId) {
  return this.aggregate([
    { $match: { userId } },
    { 
      $group: {
        _id: '$contentId',
        totalEpisodesWatched: { $sum: 1 },
        completedEpisodes: { 
          $sum: { $cond: ['$watchProgress.isCompleted', 1, 0] } 
        },
        lastWatched: { $max: '$sessionInfo.lastWatchedAt' },
        totalWatchTime: { $sum: '$watchProgress.currentPosition' }
      }
    },
    { $sort: { lastWatched: -1 } }
  ]);
};

watchlistSchema.statics.getContinueWatching = function(userId, limit = 10) {
  return this.find({
    userId,
    status: { $in: ['watching', 'paused'] },
    'watchProgress.percentageWatched': { $gt: 5, $lt: 80 } // 5-80% watched
  })
    .sort({ 'sessionInfo.lastWatchedAt': -1 })
    .limit(limit)
    .populate('contentId', 'title thumbnail')
    .populate('episodeId', 'title episodeNumber duration');
};

watchlistSchema.statics.getCompletedContent = function(userId, limit = 20) {
  return this.find({
    userId,
    'watchProgress.isCompleted': true
  })
    .sort({ 'sessionInfo.completedAt': -1 })
    .limit(limit)
    .populate('contentId', 'title thumbnail genre');
};

watchlistSchema.statics.getUserStats = function(userId) {
  return this.aggregate([
    { $match: { userId } },
    {
      $group: {
        _id: null,
        totalVideosWatched: { $sum: 1 },
        completedVideos: { 
          $sum: { $cond: ['$watchProgress.isCompleted', 1, 0] } 
        },
        totalWatchTime: { $sum: '$watchProgress.currentPosition' },
        averageCompletion: { $avg: '$watchProgress.percentageWatched' },
        totalSessions: { $sum: '$sessionInfo.totalSessions' },
        favoriteGenres: { $addToSet: '$contentId' } // Will need to populate later
      }
    }
  ]);
};

watchlistSchema.statics.getContentAnalytics = function(contentId) {
  return this.aggregate([
    { $match: { contentId: mongoose.Types.ObjectId(contentId) } },
    {
      $group: {
        _id: null,
        totalViews: { $sum: 1 },
        uniqueUsers: { $addToSet: '$userId' },
        averageCompletion: { $avg: '$watchProgress.percentageWatched' },
        totalWatchTime: { $sum: '$watchProgress.currentPosition' },
        completionRate: {
          $avg: { $cond: ['$watchProgress.isCompleted', 1, 0] }
        },
        averageRating: { $avg: '$userInteraction.rating' },
        totalLikes: { 
          $sum: { $cond: ['$userInteraction.liked', 1, 0] } 
        }
      }
    },
    {
      $addFields: {
        uniqueUserCount: { $size: '$uniqueUsers' }
      }
    }
  ]);
};

watchlistSchema.statics.getDropOffAnalytics = function(episodeId) {
  return this.aggregate([
    { $match: { episodeId: mongoose.Types.ObjectId(episodeId) } },
    {
      $bucket: {
        groupBy: '$watchProgress.percentageWatched',
        boundaries: [0, 10, 25, 50, 75, 90, 100],
        default: 'other',
        output: {
          count: { $sum: 1 },
          averageSessionTime: { $avg: '$engagement.sessionDuration' }
        }
      }
    }
  ]);
};

module.exports = mongoose.model('Watchlist', watchlistSchema);