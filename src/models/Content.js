const mongoose = require('mongoose');

const contentSchema = new mongoose.Schema({
  contentId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Basic content information
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  genre: [{ type: String, required: true }], // e.g., ['action', 'drama', 'romance']
  language: [{ type: String, required: true }], // e.g., ['hindi', 'english']
  
  // Content classification
  type: { 
    type: String, 
    enum: ['movie', 'series', 'web-series'], 
    required: true 
  },
  
  category: { 
    type: String, 
    enum: ['bollywood', 'hollywood', 'regional', 'korean', 'anime'], 
    required: true 
  },

  // Content metadata
  releaseYear: { type: Number },
  rating: { type: String }, // e.g., 'U', 'U/A', 'A'
  imdbRating: { type: Number, min: 0, max: 10 },
  duration: { type: Number }, // Total duration in minutes (for movies)
  
  // Visual assets
  thumbnail: { type: String, required: true }, // GCP URL
  poster: { type: String }, // High-res poster
  banner: { type: String }, // Landscape banner
  trailerUrl: { type: String }, // Trailer video URL
  
  // Content structure
  totalEpisodes: { type: Number, default: 1 },
  episodeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Episode' }],
  
  // Series-specific data
  seasons: [{
    seasonNumber: { type: Number },
    title: { type: String },
    episodes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Episode' }]
  }],

  // Content popularity and analytics
  analytics: {
    totalViews: { type: Number, default: 0 },
    totalLikes: { type: Number, default: 0 },
    totalShares: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    totalRatings: { type: Number, default: 0 },
    popularityScore: { type: Number, default: 0 }, // Algorithm-based score
    trendingScore: { type: Number, default: 0 }, // Recent popularity
    completionRate: { type: Number, default: 0 } // Percentage of users who complete
  },

  // Admin and content management
  status: { 
    type: String, 
    enum: ['draft', 'published', 'archived', 'private'], 
    default: 'draft' 
  },
  
  visibility: {
    type: String,
    enum: ['public', 'premium', 'restricted'],
    default: 'public'
  },

  // Feed management
  feedSettings: {
    isInRandomFeed: { type: Boolean, default: false },
    feedPriority: { type: Number, default: 1, min: 1, max: 10 }, // Higher = more likely to show
    feedWeight: { type: Number, default: 1 }, // Algorithm weight
    targetAudience: [{ type: String }], // e.g., ['18-25', 'action-lovers']
    geographicRestrictions: [{ type: String }], // Countries where available
    isFeatured: { type: Boolean, default: false }, // For hero banners
    isEditorsPick: { type: Boolean, default: false }, // For Editor's Pick section
    isTrending: { type: Boolean, default: false } // For Trending Now section
  },

  // SEO and search
  tags: [{ type: String }], // Search tags
  searchKeywords: [{ type: String }],
  cast: [{ type: String }], // Actor names
  director: { type: String },
  producer: { type: String },

  // Technical details
  videoQuality: [{ type: String, enum: ['480p', '720p', '1080p', '4k'] }],
  audioLanguages: [{ type: String }],
  subtitles: [{ type: String }],
  
  // Content warnings and age rating
  contentWarnings: [{ type: String }], // e.g., ['violence', 'adult-content']
  ageRating: { type: String, enum: ['all', '13+', '16+', '18+'], default: 'all' },

  // Timestamps
  publishedAt: { type: Date },
  lastUpdated: { type: Date, default: Date.now }
}, {
  timestamps: true,
  versionKey: false
});

// Indexes for better performance
contentSchema.index({ contentId: 1 });
contentSchema.index({ type: 1, status: 1 });
contentSchema.index({ genre: 1 });
contentSchema.index({ language: 1 });
contentSchema.index({ 'feedSettings.isInRandomFeed': 1 });
contentSchema.index({ 'analytics.popularityScore': -1 });
contentSchema.index({ 'analytics.trendingScore': -1 });
contentSchema.index({ publishedAt: -1 });

// Compound indexes
contentSchema.index({ status: 1, 'feedSettings.isInRandomFeed': 1, 'feedSettings.feedPriority': -1 });
contentSchema.index({ genre: 1, language: 1, status: 1 });

// Virtual for episode count
contentSchema.virtual('episodeCount').get(function() {
  return this.episodeIds ? this.episodeIds.length : 0;
});

// Instance methods
contentSchema.methods.incrementViews = function() {
  this.analytics.totalViews += 1;
  this.lastUpdated = new Date();
  return this.save();
};

contentSchema.methods.updatePopularityScore = function() {
  // Calculate popularity based on views, likes, shares, and recency
  const viewsWeight = 0.4;
  const likesWeight = 0.3;
  const sharesWeight = 0.2;
  const recencyWeight = 0.1;
  
  const daysSincePublished = (Date.now() - this.publishedAt) / (1000 * 60 * 60 * 24);
  const recencyScore = Math.max(0, 100 - daysSincePublished);
  
  this.analytics.popularityScore = 
    (this.analytics.totalViews * viewsWeight) +
    (this.analytics.totalLikes * likesWeight) +
    (this.analytics.totalShares * sharesWeight) +
    (recencyScore * recencyWeight);
    
  return this.save();
};

contentSchema.methods.addToFeed = function(priority = 1) {
  this.feedSettings.isInRandomFeed = true;
  this.feedSettings.feedPriority = priority;
  return this.save();
};

contentSchema.methods.removeFromFeed = function() {
  this.feedSettings.isInRandomFeed = false;
  return this.save();
};

// Static methods
contentSchema.statics.getFeedContent = function(limit = 50, userPreferences = {}) {
  const query = {
    status: 'published',
    'feedSettings.isInRandomFeed': true
  };

  // Add user preference filters
  if (userPreferences.genres && userPreferences.genres.length > 0) {
    query.genre = { $in: userPreferences.genres };
  }

  if (userPreferences.languages && userPreferences.languages.length > 0) {
    query.language = { $in: userPreferences.languages };
  }

  return this.find(query)
    .sort({ 
      'feedSettings.feedPriority': -1, 
      'analytics.popularityScore': -1 
    })
    .limit(limit)
    .populate('episodeIds', 'episodeNumber title thumbnail duration');
};

contentSchema.statics.getTrendingContent = function(limit = 20) {
  return this.find({ 
    status: 'published',
    'analytics.trendingScore': { $gt: 0 }
  })
    .sort({ 'analytics.trendingScore': -1 })
    .limit(limit);
};

contentSchema.statics.searchContent = function(searchTerm, limit = 20) {
  const searchRegex = new RegExp(searchTerm, 'i');
  
  return this.find({
    status: 'published',
    $or: [
      { title: searchRegex },
      { description: searchRegex },
      { tags: { $in: [searchRegex] } },
      { cast: { $in: [searchRegex] } },
      { director: searchRegex }
    ]
  })
    .sort({ 'analytics.popularityScore': -1 })
    .limit(limit);
};

module.exports = mongoose.model('Content', contentSchema);