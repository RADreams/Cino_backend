const Joi = require('joi');

// Validation middleware factory
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate({
      body: req.body,
      query: req.query,
      params: req.params
    }, { 
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errorMessage = error.details.map(detail => detail.message).join(', ');
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: errorMessage,
        details: error.details
      });
    }

    // Replace req with validated and sanitized data
    req.body = value.body || req.body;
    req.query = value.query || req.query;
    req.params = value.params || req.params;

    next();
  };
};

// Common validation schemas
const commonSchemas = {
  userId: Joi.string().required().min(1).max(100),
  contentId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
  episodeId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
  pagination: {
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20)
  },
  deviceInfo: Joi.object({
    deviceId: Joi.string().max(100),
    platform: Joi.string().valid('android', 'ios', 'web'),
    appVersion: Joi.string().max(20),
    osVersion: Joi.string().max(20)
  })
};

// User validation schemas
const userValidation = {
  createUser: Joi.object({
    body: Joi.object({
      deviceInfo: commonSchemas.deviceInfo,
      preferences: Joi.object({
        preferredGenres: Joi.array().items(Joi.string()).max(10),
        preferredLanguages: Joi.array().items(Joi.string()).max(5),
        autoPlay: Joi.boolean(),
        dataUsage: Joi.string().valid('low', 'medium', 'high')
      }),
      location: Joi.object({
        country: Joi.string().max(50),
        state: Joi.string().max(50),
        city: Joi.string().max(50)
      })
    })
  }),

  updateUser: Joi.object({
    params: Joi.object({
      userId: commonSchemas.userId
    }),
    body: Joi.object({
      preferences: Joi.object({
        preferredGenres: Joi.array().items(Joi.string()).max(10),
        preferredLanguages: Joi.array().items(Joi.string()).max(5),
        autoPlay: Joi.boolean(),
        dataUsage: Joi.string().valid('low', 'medium', 'high')
      }),
      location: Joi.object({
        country: Joi.string().max(50),
        state: Joi.string().max(50),
        city: Joi.string().max(50)
      })
    })
  }),

  getUserById: Joi.object({
    params: Joi.object({
      userId: commonSchemas.userId
    })
  })
};

// Content validation schemas
const contentValidation = {
  getContent: Joi.object({
    params: Joi.object({
      contentId: commonSchemas.contentId
    })
  }),

  searchContent: Joi.object({
    query: Joi.object({
      q: Joi.string().min(1).max(100).required(),
      genre: Joi.string().max(50),
      language: Joi.string().max(20),
      type: Joi.string().valid('movie', 'series', 'web-series'),
      ...commonSchemas.pagination
    })
  }),

  getContentByGenre: Joi.object({
    query: Joi.object({
      genre: Joi.string().required().max(50),
      language: Joi.string().max(20),
      ...commonSchemas.pagination
    })
  })
};

// Episode validation schemas
const episodeValidation = {
  getEpisode: Joi.object({
    params: Joi.object({
      episodeId: commonSchemas.episodeId
    })
  }),

  getEpisodesByContent: Joi.object({
    params: Joi.object({
      contentId: commonSchemas.contentId
    }),
    query: Joi.object({
      seasonNumber: Joi.number().integer().min(1),
      ...commonSchemas.pagination
    })
  }),

  updateWatchProgress: Joi.object({
    params: Joi.object({
      episodeId: commonSchemas.episodeId
    }),
    body: Joi.object({
      userId: commonSchemas.userId,
      currentPosition: Joi.number().min(0).required(),
      totalDuration: Joi.number().min(1).required(),
      sessionDuration: Joi.number().min(0),
      quality: Joi.string().valid('480p', '720p', '1080p', '4k'),
      watchedVia: Joi.string().valid('feed', 'episode-list', 'search', 'recommendation')
    })
  })
};

// Feed validation schemas
const feedValidation = {
  getFeed: Joi.object({
    query: Joi.object({
      userId: commonSchemas.userId,
      limit: Joi.number().integer().min(1).max(50).default(20),
      offset: Joi.number().integer().min(0).default(0),
      genre: Joi.string().max(50),
      language: Joi.string().max(20)
    })
  }),

  getFeedWithPreferences: Joi.object({
    body: Joi.object({
      userId: commonSchemas.userId,
      preferences: Joi.object({
        genres: Joi.array().items(Joi.string()).max(10),
        languages: Joi.array().items(Joi.string()).max(5)
      }),
      limit: Joi.number().integer().min(1).max(50).default(20)
    })
  })
};

// Watchlist validation schemas
const watchlistValidation = {
  addToWatchlist: Joi.object({
    body: Joi.object({
      userId: commonSchemas.userId,
      contentId: commonSchemas.contentId,
      episodeId: commonSchemas.episodeId,
      currentPosition: Joi.number().min(0).default(0),
      totalDuration: Joi.number().min(1).required(),
      watchedVia: Joi.string().valid('feed', 'episode-list', 'search', 'recommendation').default('feed')
    })
  }),

  getWatchlist: Joi.object({
    params: Joi.object({
      userId: commonSchemas.userId
    }),
    query: Joi.object({
      status: Joi.string().valid('watching', 'completed', 'dropped', 'paused'),
      ...commonSchemas.pagination
    })
  }),

  updateWatchProgress: Joi.object({
    params: Joi.object({
      userId: commonSchemas.userId,
      episodeId: commonSchemas.episodeId
    }),
    body: Joi.object({
      currentPosition: Joi.number().min(0).required(),
      sessionDuration: Joi.number().min(0),
      pauseCount: Joi.number().integer().min(0),
      seekCount: Joi.number().integer().min(0)
    })
  }),

  rateContent: Joi.object({
    params: Joi.object({
      userId: commonSchemas.userId,
      contentId: commonSchemas.contentId
    }),
    body: Joi.object({
      rating: Joi.number().min(1).max(5).required()
    })
  })
};

// Analytics validation schemas
const analyticsValidation = {
  trackEvent: Joi.object({
    body: Joi.object({
      userId: commonSchemas.userId,
      eventType: Joi.string().valid(
        'video_start', 'video_end', 'video_pause', 'video_resume',
        'swipe_left', 'swipe_right', 'tap_episode', 'like', 'share',
        'app_open', 'app_close', 'session_start', 'session_end',
        'content_view', 'search', 'error', 'buffer_start', 'buffer_end'
      ).required(),
      category: Joi.string().valid('user_interaction', 'video_playback', 'navigation', 'engagement', 'performance').required(),
      sessionId: Joi.string().max(100),
      contentId: Joi.string().regex(/^[0-9a-fA-F]{24}$/),
      episodeId: Joi.string().regex(/^[0-9a-fA-F]{24}$/),
      eventData: Joi.object({
        currentPosition: Joi.number().min(0),
        totalDuration: Joi.number().min(0),
        playbackSpeed: Joi.number().min(0.25).max(3),
        quality: Joi.string().valid('480p', '720p', '1080p', '4k'),
        swipeDirection: Joi.string().valid('left', 'right'),
        clickTarget: Joi.string().max(100),
        searchQuery: Joi.string().max(200),
        loadTime: Joi.number().min(0),
        bufferDuration: Joi.number().min(0),
        errorCode: Joi.string().max(20),
        errorMessage: Joi.string().max(500),
        likeStatus: Joi.boolean(),
        shareMethod: Joi.string().valid('whatsapp', 'telegram', 'instagram', 'copy_link'),
        previousScreen: Joi.string().max(50),
        nextScreen: Joi.string().max(50),
        navigationMethod: Joi.string().valid('swipe', 'tap', 'back_button')
      }),
      deviceInfo: commonSchemas.deviceInfo,
      location: Joi.object({
        country: Joi.string().max(50),
        state: Joi.string().max(50),
        city: Joi.string().max(50),
        timezone: Joi.string().max(50)
      })
    })
  })
};

// Admin validation schemas
const adminValidation = {
  uploadVideo: Joi.object({
    body: Joi.object({
      title: Joi.string().min(1).max(200).required(),
      description: Joi.string().max(1000),
      contentId: Joi.string().regex(/^[0-9a-fA-F]{24}$/),
      episodeNumber: Joi.number().integer().min(1).required(),
      seasonNumber: Joi.number().integer().min(1).default(1),
      duration: Joi.number().min(1).required(),
      genre: Joi.array().items(Joi.string()).min(1).max(5).required(),
      language: Joi.array().items(Joi.string()).min(1).max(3).required(),
      tags: Joi.array().items(Joi.string()).max(20)
    })
  }),

  createContent: Joi.object({
    body: Joi.object({
      title: Joi.string().min(1).max(200).required(),
      description: Joi.string().min(10).max(2000).required(),
      genre: Joi.array().items(Joi.string()).min(1).max(5).required(),
      language: Joi.array().items(Joi.string()).min(1).max(3).required(),
      type: Joi.string().valid('movie', 'series', 'web-series').required(),
      category: Joi.string().valid('bollywood', 'hollywood', 'regional', 'korean', 'anime').required(),
      releaseYear: Joi.number().integer().min(1900).max(new Date().getFullYear() + 2),
      rating: Joi.string().valid('U', 'U/A', 'A'),
      totalEpisodes: Joi.number().integer().min(1).default(1),
      cast: Joi.array().items(Joi.string()).max(20),
      director: Joi.string().max(100),
      producer: Joi.string().max(100),
      tags: Joi.array().items(Joi.string()).max(50),
      ageRating: Joi.string().valid('all', '13+', '16+', '18+').default('all')
    })
  }),

  updateFeedSettings: Joi.object({
    params: Joi.object({
      contentId: commonSchemas.contentId
    }),
    body: Joi.object({
      isInRandomFeed: Joi.boolean().required(),
      feedPriority: Joi.number().integer().min(1).max(10),
      feedWeight: Joi.number().min(0).max(100),
      targetAudience: Joi.array().items(Joi.string()).max(10)
    })
  })
};

// File upload validation
const fileValidation = {
  videoUpload: (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No video file provided'
      });
    }

    const allowedTypes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo'];
    const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024; // 100MB default

    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Only video files are allowed.'
      });
    }

    if (req.file.size > maxSize) {
      return res.status(400).json({
        success: false,
        error: `File too large. Maximum size is ${maxSize / (1024 * 1024)}MB`
      });
    }

    next();
  },

  imageUpload: (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided'
      });
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Only JPEG, PNG, and WebP images are allowed.'
      });
    }

    if (req.file.size > maxSize) {
      return res.status(400).json({
        success: false,
        error: 'Image too large. Maximum size is 5MB'
      });
    }

    next();
  }
};

module.exports = {
  validate,
  userValidation,
  contentValidation,
  episodeValidation,
  feedValidation,
  watchlistValidation,
  analyticsValidation,
  adminValidation,
  fileValidation
};