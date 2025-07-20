const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const userSchema = new mongoose.Schema({
  userId: {
    type: String,
    default: uuidv4,
    unique: true,
    required: true
  },
  
  // Device and session info
  deviceInfo: {
    deviceId: { type: String },
    platform: { type: String, enum: ['android', 'ios', 'web'] },
    appVersion: { type: String },
    osVersion: { type: String }
  },

  // Optional user profile (for those who want to add details)
  profile: {
    username: { type: String, trim: true },
    fullName: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    avatar: { type: String }, // Profile picture URL
    hasProfile: { type: Boolean, default: false }
  },

  // User preferences and behavior
  preferences: {
    preferredGenres: [{ type: String }],
    preferredLanguages: [{ type: String, default: ['hindi', 'english'] }],
    autoPlay: { type: Boolean, default: true },
    dataUsage: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' }
  },

  // Analytics and tracking
  analytics: {
    totalWatchTime: { type: Number, default: 0 }, // in seconds
    videosWatched: { type: Number, default: 0 },
    averageSessionDuration: { type: Number, default: 0 },
    lastActiveAt: { type: Date, default: Date.now },
    totalSessions: { type: Number, default: 0 },
    favoriteGenres: [{ 
      genre: String, 
      count: { type: Number, default: 0 } 
    }]
  },

  // User engagement metrics
  engagement: {
    likes: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    swipeRight: { type: Number, default: 0 }, // To episodes
    swipeLeft: { type: Number, default: 0 }, // Back to feed
    averageVideoCompletion: { type: Number, default: 0 } // Percentage
  },

  // Location (for content recommendations)
  location: {
    country: { type: String, default: 'India' },
    state: { type: String },
    city: { type: String }
  },

  // Status and metadata
  status: { 
    type: String, 
    enum: ['active', 'inactive', 'suspended'], 
    default: 'active' 
  },
  
  isAnonymous: { type: Boolean, default: true },
  
  // Timestamps
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now }
}, {
  timestamps: true,
  versionKey: false
});

// Indexes for better performance
userSchema.index({ 'deviceInfo.deviceId': 1 });
userSchema.index({ lastSeenAt: -1 });
userSchema.index({ status: 1 });

// Update lastSeenAt on any activity
userSchema.pre('save', function(next) {
  this.lastSeenAt = new Date();
  next();
});

// Instance methods
userSchema.methods.updateActivity = function() {
  this.lastSeenAt = new Date();
  this.analytics.lastActiveAt = new Date();
  return this.save();
};

userSchema.methods.incrementWatchTime = function(seconds) {
  this.analytics.totalWatchTime += seconds;
  this.analytics.videosWatched += 1;
  return this.save();
};

userSchema.methods.updatePreferences = function(genres, languages) {
  if (genres) this.preferences.preferredGenres = genres;
  if (languages) this.preferences.preferredLanguages = languages;
  return this.save();
};

// Static methods
userSchema.statics.findByUserId = function(userId) {
  return this.findOne({ userId });
};

userSchema.statics.createAnonymousUser = function(deviceInfo = {}) {
  return this.create({
    deviceInfo,
    isAnonymous: true
  });
};

userSchema.statics.getActiveUsers = function(days = 7) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  
  return this.find({
    lastSeenAt: { $gte: date },
    status: 'active'
  });
};

userSchema.statics.getUserAnalytics = function(userId) {
  return this.findOne({ userId }, 'analytics engagement preferences');
};

module.exports = mongoose.model('User', userSchema);