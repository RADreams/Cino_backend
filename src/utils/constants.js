// Content types
const CONTENT_TYPES = {
    MOVIE: 'movie',
    SERIES: 'series',
    WEB_SERIES: 'web-series'
  };
  
  // Content categories
  const CONTENT_CATEGORIES = {
    BOLLYWOOD: 'bollywood',
    HOLLYWOOD: 'hollywood',
    REGIONAL: 'regional',
    KOREAN: 'korean',
    ANIME: 'anime'
  };
  
  // Content status
  const CONTENT_STATUS = {
    DRAFT: 'draft',
    PUBLISHED: 'published',
    ARCHIVED: 'archived',
    PRIVATE: 'private'
  };
  
  // Episode status
  const EPISODE_STATUS = {
    DRAFT: 'draft',
    PROCESSING: 'processing',
    PUBLISHED: 'published',
    ARCHIVED: 'archived'
  };
  
  // User status
  const USER_STATUS = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    SUSPENDED: 'suspended'
  };
  
  // Watchlist status
  const WATCHLIST_STATUS = {
    WATCHING: 'watching',
    COMPLETED: 'completed',
    DROPPED: 'dropped',
    PAUSED: 'paused'
  };
  
  // Visibility options
  const VISIBILITY = {
    PUBLIC: 'public',
    PREMIUM: 'premium',
    RESTRICTED: 'restricted'
  };
  
  // Age ratings
  const AGE_RATINGS = {
    ALL: 'all',
    TEEN: '13+',
    MATURE: '16+',
    ADULT: '18+'
  };
  
  // Video qualities
  const VIDEO_QUALITIES = {
    LOW: '480p',
    MEDIUM: '720p',
    HIGH: '1080p',
    ULTRA: '4k'
  };
  
  // Platforms
  const PLATFORMS = {
    ANDROID: 'android',
    IOS: 'ios',
    WEB: 'web'
  };
  
  // Data usage preferences
  const DATA_USAGE = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high'
  };
  
  // Analytics event types
  const ANALYTICS_EVENTS = {
    // Video playback events
    VIDEO_START: 'video_start',
    VIDEO_END: 'video_end',
    VIDEO_PAUSE: 'video_pause',
    VIDEO_RESUME: 'video_resume',
    VIDEO_SEEK: 'video_seek',
    VIDEO_BUFFER_START: 'buffer_start',
    VIDEO_BUFFER_END: 'buffer_end',
    VIDEO_QUALITY_CHANGE: 'quality_change',
    
    // User interaction events
    SWIPE_LEFT: 'swipe_left',
    SWIPE_RIGHT: 'swipe_right',
    TAP_EPISODE: 'tap_episode',
    LIKE: 'like',
    SHARE: 'share',
    SEARCH: 'search',
    
    // Navigation events
    APP_OPEN: 'app_open',
    APP_CLOSE: 'app_close',
    SESSION_START: 'session_start',
    SESSION_END: 'session_end',
    CONTENT_VIEW: 'content_view',
    FEED_VIEW: 'feed_view',
    
    // Error events
    ERROR: 'error',
    CRASH: 'crash'
  };
  
  // Analytics categories
  const ANALYTICS_CATEGORIES = {
    USER_INTERACTION: 'user_interaction',
    VIDEO_PLAYBACK: 'video_playback',
    NAVIGATION: 'navigation',
    ENGAGEMENT: 'engagement',
    PERFORMANCE: 'performance'
  };
  
  // Share methods
  const SHARE_METHODS = {
    WHATSAPP: 'whatsapp',
    TELEGRAM: 'telegram',
    INSTAGRAM: 'instagram',
    FACEBOOK: 'facebook',
    TWITTER: 'twitter',
    COPY_LINK: 'copy_link'
  };
  
  // Navigation methods
  const NAVIGATION_METHODS = {
    SWIPE: 'swipe',
    TAP: 'tap',
    BACK_BUTTON: 'back_button',
    SEARCH: 'search'
  };
  
  // Feed sources
  const FEED_SOURCES = {
    PERSONALIZED: 'personalized',
    TRENDING: 'trending',
    POPULAR: 'popular',
    FRESH: 'fresh',
    SIMILAR: 'similar',
    MANUAL: 'manual'
  };
  
  // Recommendation sources
  const RECOMMENDATION_SOURCES = {
    FEED: 'feed',
    SIMILAR: 'similar',
    TRENDING: 'trending',
    GENRE: 'genre',
    MANUAL: 'manual'
  };
  
  // Watch sources
  const WATCH_SOURCES = {
    FEED: 'feed',
    EPISODE_LIST: 'episode-list',
    SEARCH: 'search',
    RECOMMENDATION: 'recommendation',
    CONTINUE_WATCHING: 'continue-watching'
  };
  
  // Error codes
  const ERROR_CODES = {
    // Client errors (4xx)
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    TOO_MANY_REQUESTS: 429,
    
    // Server errors (5xx)
    INTERNAL_SERVER_ERROR: 500,
    NOT_IMPLEMENTED: 501,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
    GATEWAY_TIMEOUT: 504
  };
  
  // Cache TTL values (in seconds)
  const CACHE_TTL = {
    SHORT: 300,     // 5 minutes
    MEDIUM: 1800,   // 30 minutes
    LONG: 3600,     // 1 hour
    VERY_LONG: 7200 // 2 hours
  };
  
  // File size limits
  const FILE_LIMITS = {
    VIDEO_MAX_SIZE: 100 * 1024 * 1024,    // 100MB
    IMAGE_MAX_SIZE: 5 * 1024 * 1024,      // 5MB
    THUMBNAIL_MAX_SIZE: 2 * 1024 * 1024   // 2MB
  };
  
  // Video processing constants
  const VIDEO_PROCESSING = {
    DEFAULT_QUALITIES: ['480p', '720p', '1080p'],
    DEFAULT_BITRATES: {
      '480p': '1000k',
      '720p': '2500k',
      '1080p': '5000k',
      '4k': '15000k'
    },
    DEFAULT_RESOLUTIONS: {
      '480p': { width: 854, height: 480 },
      '720p': { width: 1280, height: 720 },
      '1080p': { width: 1920, height: 1080 },
      '4k': { width: 3840, height: 2160 }
    },
    CHUNK_SIZE: 1048576, // 1MB
    PRELOAD_DURATION: 10 // seconds
  };
  
  // Rate limiting constants
  const RATE_LIMITS = {
    GENERAL: {
      WINDOW_MS: 15 * 60 * 1000, // 15 minutes
      MAX: 100 // requests per window
    },
    VIDEO: {
      WINDOW_MS: 1 * 60 * 1000, // 1 minute
      MAX: 30 // requests per window
    },
    SEARCH: {
      WINDOW_MS: 1 * 60 * 1000, // 1 minute
      MAX: 10 // requests per window
    },
    ANALYTICS: {
      WINDOW_MS: 1 * 60 * 1000, // 1 minute
      MAX: 100 // requests per window
    }
  };
  
  // Default pagination
  const PAGINATION = {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 20,
    MAX_LIMIT: 100
  };
  
  // Popular genres (for Indian market)
  const POPULAR_GENRES = [
    'action',
    'drama',
    'comedy',
    'romance',
    'thriller',
    'horror',
    'crime',
    'family',
    'musical',
    'historical',
    'mythological',
    'social'
  ];
  
  // Popular languages (for Indian market)
  const POPULAR_LANGUAGES = [
    'hindi',
    'english',
    'tamil',
    'telugu',
    'bengali',
    'marathi',
    'gujarati',
    'kannada',
    'malayalam',
    'punjabi'
  ];
  
  // Content warnings
  const CONTENT_WARNINGS = [
    'violence',
    'adult-content',
    'strong-language',
    'drug-use',
    'smoking',
    'alcohol',
    'nudity',
    'scary-scenes'
  ];
  
  // App configuration
  const APP_CONFIG = {
    APP_NAME: 'Shorts Entertainment',
    VERSION: '1.0.0',
    SUPPORTED_VIDEO_FORMATS: ['.mp4', '.avi', '.mkv', '.mov'],
    SUPPORTED_IMAGE_FORMATS: ['.jpg', '.jpeg', '.png', '.webp'],
    DEFAULT_THUMBNAIL: '/assets/default-thumbnail.jpg',
    DEFAULT_POSTER: '/assets/default-poster.jpg'
  };
  
  // Database collections
  const COLLECTIONS = {
    USERS: 'users',
    CONTENT: 'contents',
    EPISODES: 'episodes',
    WATCHLISTS: 'watchlists',
    ANALYTICS: 'analytics'
  };
  
  // Environment types
  const ENVIRONMENTS = {
    DEVELOPMENT: 'development',
    STAGING: 'staging',
    PRODUCTION: 'production'
  };
  
  // Notification types (for future use)
  const NOTIFICATION_TYPES = {
    NEW_EPISODE: 'new_episode',
    RECOMMENDATION: 'recommendation',
    SYSTEM: 'system',
    PROMOTION: 'promotion'
  };
  
  // API response messages
  const RESPONSE_MESSAGES = {
    SUCCESS: 'Success',
    CREATED: 'Created successfully',
    UPDATED: 'Updated successfully',
    DELETED: 'Deleted successfully',
    NOT_FOUND: 'Resource not found',
    UNAUTHORIZED: 'Unauthorized access',
    FORBIDDEN: 'Access forbidden',
    VALIDATION_ERROR: 'Validation error',
    INTERNAL_ERROR: 'Internal server error',
    RATE_LIMITED: 'Too many requests'
  };
  
  // Export all constants
  module.exports = {
    CONTENT_TYPES,
    CONTENT_CATEGORIES,
    CONTENT_STATUS,
    EPISODE_STATUS,
    USER_STATUS,
    WATCHLIST_STATUS,
    VISIBILITY,
    AGE_RATINGS,
    VIDEO_QUALITIES,
    PLATFORMS,
    DATA_USAGE,
    ANALYTICS_EVENTS,
    ANALYTICS_CATEGORIES,
    SHARE_METHODS,
    NAVIGATION_METHODS,
    FEED_SOURCES,
    RECOMMENDATION_SOURCES,
    WATCH_SOURCES,
    ERROR_CODES,
    CACHE_TTL,
    FILE_LIMITS,
    VIDEO_PROCESSING,
    RATE_LIMITS,
    PAGINATION,
    POPULAR_GENRES,
    POPULAR_LANGUAGES,
    CONTENT_WARNINGS,
    APP_CONFIG,
    COLLECTIONS,
    ENVIRONMENTS,
    NOTIFICATION_TYPES,
    RESPONSE_MESSAGES
  };