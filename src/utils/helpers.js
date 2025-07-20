const crypto = require('crypto');

/**
 * Generate unique user ID
 */
const generateUserId = () => {
  return `user_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
};

/**
 * Generate unique content ID
 */
const generateContentId = () => {
  return `content_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
};

/**
 * Generate unique episode ID
 */
const generateEpisodeId = () => {
  return `episode_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
};

/**
 * Format duration from seconds to human readable format
 */
const formatDuration = (seconds) => {
  if (!seconds || seconds < 0) return '0:00';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
  
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

/**
 * Convert duration string to seconds
 */
const parseDuration = (durationString) => {
  if (!durationString) return 0;
  
  const parts = durationString.split(':').map(Number);
  
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1]; // MM:SS
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]; // HH:MM:SS
  }
  
  return 0;
};

/**
 * Format file size to human readable format
 */
const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  
  return `${Math.round(bytes / Math.pow(1024, i) * 100) / 100} ${sizes[i]}`;
};

/**
 * Sanitize filename for storage
 */
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();
};

/**
 * Generate video thumbnail filename
 */
const generateThumbnailFilename = (episodeId, timestamp = 0) => {
  return `thumbnails/episode_${episodeId}_${timestamp}_${Date.now()}.jpg`;
};

/**
 * Calculate video quality based on file size and duration
 */
const estimateVideoQuality = (fileSize, duration) => {
  if (!fileSize || !duration) return 'unknown';
  
  const bitrate = (fileSize * 8) / duration; // bits per second
  
  if (bitrate > 8000000) return '1080p';
  if (bitrate > 4000000) return '720p';
  if (bitrate > 1500000) return '480p';
  return '360p';
};

/**
 * Validate email format
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate MongoDB ObjectId
 */
const isValidObjectId = (id) => {
  return /^[0-9a-fA-F]{24}$/.test(id);
};

/**
 * Generate random string
 */
const generateRandomString = (length = 10) => {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
};

/**
 * Calculate percentage
 */
const calculatePercentage = (value, total) => {
  if (!total || total === 0) return 0;
  return Math.round((value / total) * 100);
};

/**
 * Deep clone object
 */
const deepClone = (obj) => {
  return JSON.parse(JSON.stringify(obj));
};

/**
 * Remove undefined/null values from object
 */
const cleanObject = (obj) => {
  const cleaned = {};
  
  Object.keys(obj).forEach(key => {
    if (obj[key] !== null && obj[key] !== undefined) {
      if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        const cleanedNested = cleanObject(obj[key]);
        if (Object.keys(cleanedNested).length > 0) {
          cleaned[key] = cleanedNested;
        }
      } else {
        cleaned[key] = obj[key];
      }
    }
  });
  
  return cleaned;
};

/**
 * Paginate array
 */
const paginateArray = (array, page = 1, limit = 10) => {
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  
  return {
    data: array.slice(startIndex, endIndex),
    currentPage: page,
    totalPages: Math.ceil(array.length / limit),
    totalItems: array.length,
    hasNext: endIndex < array.length,
    hasPrev: page > 1
  };
};

/**
 * Shuffle array randomly
 */
const shuffleArray = (array) => {
  const shuffled = [...array];
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
};

/**
 * Group array by key
 */
const groupBy = (array, key) => {
  return array.reduce((groups, item) => {
    const group = item[key];
    groups[group] = groups[group] || [];
    groups[group].push(item);
    return groups;
  }, {});
};

/**
 * Debounce function
 */
const debounce = (func, wait) => {
  let timeout;
  
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

/**
 * Throttle function
 */
const throttle = (func, limit) => {
  let inThrottle;
  
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

/**
 * Calculate time difference in human readable format
 */
const timeAgo = (date) => {
  const now = new Date();
  const diffInSeconds = Math.floor((now - new Date(date)) / 1000);
  
  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'week', seconds: 604800 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 },
    { label: 'second', seconds: 1 }
  ];
  
  for (const interval of intervals) {
    const count = Math.floor(diffInSeconds / interval.seconds);
    if (count >= 1) {
      return `${count} ${interval.label}${count !== 1 ? 's' : ''} ago`;
    }
  }
  
  return 'just now';
};

/**
 * Generate cache key
 */
const generateCacheKey = (...parts) => {
  return parts.filter(Boolean).join(':');
};

/**
 * Validate and sanitize user input
 */
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .slice(0, 1000); // Limit length
};

/**
 * Generate video streaming URL with parameters
 */
const generateStreamingUrl = (baseUrl, options = {}) => {
  const url = new URL(baseUrl);
  
  Object.keys(options).forEach(key => {
    if (options[key] !== null && options[key] !== undefined) {
      url.searchParams.set(key, options[key]);
    }
  });
  
  return url.toString();
};

/**
 * Calculate video bitrate
 */
const calculateBitrate = (fileSize, duration) => {
  if (!fileSize || !duration) return 0;
  return Math.round((fileSize * 8) / duration); // bits per second
};

/**
 * Convert bitrate to human readable format
 */
const formatBitrate = (bitrate) => {
  if (!bitrate) return '0 bps';
  
  if (bitrate >= 1000000) {
    return `${Math.round(bitrate / 1000000)} Mbps`;
  } else if (bitrate >= 1000) {
    return `${Math.round(bitrate / 1000)} Kbps`;
  }
  
  return `${bitrate} bps`;
};

/**
 * Validate video file type
 */
const isValidVideoFile = (mimetype) => {
  const validTypes = [
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm'
  ];
  
  return validTypes.includes(mimetype);
};

/**
 * Validate image file type
 */
const isValidImageFile = (mimetype) => {
  const validTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ];
  
  return validTypes.includes(mimetype);
};

/**
 * Generate error response
 */
const createErrorResponse = (message, statusCode = 500, details = null) => {
  return {
    success: false,
    error: message,
    statusCode,
    ...(details && { details }),
    timestamp: new Date().toISOString()
  };
};

/**
 * Generate success response
 */
const createSuccessResponse = (data, message = 'Success') => {
  return {
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  };
};

module.exports = {
  generateUserId,
  generateContentId,
  generateEpisodeId,
  formatDuration,
  parseDuration,
  formatFileSize,
  sanitizeFilename,
  generateThumbnailFilename,
  estimateVideoQuality,
  isValidEmail,
  isValidObjectId,
  generateRandomString,
  calculatePercentage,
  deepClone,
  cleanObject,
  paginateArray,
  shuffleArray,
  groupBy,
  debounce,
  throttle,
  timeAgo,
  generateCacheKey,
  sanitizeInput,
  generateStreamingUrl,
  calculateBitrate,
  formatBitrate,
  isValidVideoFile,
  isValidImageFile,
  createErrorResponse,
  createSuccessResponse
};