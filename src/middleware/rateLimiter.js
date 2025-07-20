const rateLimit = require('express-rate-limit');
const { getRedisClient } = require('../config/redis');

// Redis store for rate limiting (if Redis is available)
class RedisStore {
  constructor() {
    this.client = getRedisClient();
    this.prefix = 'rl:';
  }

  async increment(key) {
    if (!this.client) return { totalHits: 1, resetTime: new Date() };

    try {
      const redisKey = this.prefix + key;
      const pipeline = this.client.multi();
      
      pipeline.incr(redisKey);
      pipeline.expire(redisKey, 60); // 1 minute expiry
      
      const results = await pipeline.exec();
      const totalHits = results[0][1];
      
      const ttl = await this.client.ttl(redisKey);
      const resetTime = new Date(Date.now() + ttl * 1000);
      
      return { totalHits, resetTime };
    } catch (error) {
      console.error('Redis rate limit error:', error);
      return { totalHits: 1, resetTime: new Date() };
    }
  }

  async decrement(key) {
    if (!this.client) return;

    try {
      const redisKey = this.prefix + key;
      await this.client.decr(redisKey);
    } catch (error) {
      console.error('Redis rate limit decrement error:', error);
    }
  }

  async resetKey(key) {
    if (!this.client) return;

    try {
      const redisKey = this.prefix + key;
      await this.client.del(redisKey);
    } catch (error) {
      console.error('Redis rate limit reset error:', error);
    }
  }
}

// Custom key generator based on user ID or IP
const keyGenerator = (req) => {
  // Use userId if available, otherwise fall back to IP
  const userId = req.headers['x-user-id'] || req.body.userId;
  return userId || req.ip;
};

// General API rate limiter
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // requests per windowMs
  store: getRedisClient() ? new RedisStore() : undefined,
  keyGenerator,
  message: {
    success: false,
    error: 'Too many requests from this user/IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: 'Too many requests. Please slow down.',
      retryAfter: Math.round(req.rateLimit.resetTime / 1000)
    });
  }
});

// Strict limiter for sensitive operations (admin, uploads)
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Only 10 requests per 15 minutes
  store: getRedisClient() ? new RedisStore() : undefined,
  keyGenerator,
  message: {
    success: false,
    error: 'Too many sensitive operations from this user/IP',
    retryAfter: '15 minutes'
  }
});

// Video streaming rate limiter (more lenient)
const videoLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 video requests per minute
  store: getRedisClient() ? new RedisStore() : undefined,
  keyGenerator,
  message: {
    success: false,
    error: 'Too many video requests. Please wait a moment.',
    retryAfter: '1 minute'
  }
});

// Feed requests limiter
const feedLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // 20 feed requests per minute
  store: getRedisClient() ? new RedisStore() : undefined,
  keyGenerator,
  message: {
    success: false,
    error: 'Too many feed requests. Please wait a moment.',
    retryAfter: '1 minute'
  }
});

// Search rate limiter
const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 searches per minute
  store: getRedisClient() ? new RedisStore() : undefined,
  keyGenerator,
  message: {
    success: false,
    error: 'Too many search requests. Please wait a moment.',
    retryAfter: '1 minute'
  }
});

// Analytics tracking limiter (very lenient)
const analyticsLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 analytics events per minute
  store: getRedisClient() ? new RedisStore() : undefined,
  keyGenerator,
  message: {
    success: false,
    error: 'Too many analytics events',
    retryAfter: '1 minute'
  }
});

// Progressive rate limiting based on user behavior
const createProgressiveLimiter = (baseMax = 100) => {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: (req) => {
      // Increase limit for verified users or premium users
      const userType = req.headers['x-user-type'];
      
      if (userType === 'premium') {
        return baseMax * 2;
      } else if (userType === 'verified') {
        return Math.floor(baseMax * 1.5);
      }
      
      return baseMax;
    },
    store: getRedisClient() ? new RedisStore() : undefined,
    keyGenerator,
    message: {
      success: false,
      error: 'Rate limit exceeded for your user tier',
      retryAfter: '15 minutes'
    }
  });
};

// Bypass rate limiting for specific user IDs (admin, testing)
const createBypassLimiter = (limiter, bypassUserIds = []) => {
  return (req, res, next) => {
    const userId = req.headers['x-user-id'] || req.body.userId;
    
    // Skip rate limiting for bypass users
    if (bypassUserIds.includes(userId)) {
      return next();
    }
    
    return limiter(req, res, next);
  };
};

// Dynamic rate limiting based on server load
const createDynamicLimiter = (baseMax = 100) => {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: (req) => {
      // Get server load (simplified - in production, use actual metrics)
      const serverLoad = process.memoryUsage().heapUsed / process.memoryUsage().heapTotal;
      
      if (serverLoad > 0.8) {
        return Math.floor(baseMax * 0.5); // Reduce to 50% under high load
      } else if (serverLoad > 0.6) {
        return Math.floor(baseMax * 0.75); // Reduce to 75% under medium load
      }
      
      return baseMax;
    },
    store: getRedisClient() ? new RedisStore() : undefined,
    keyGenerator,
    message: {
      success: false,
      error: 'Server is under high load. Please try again later.',
      retryAfter: '15 minutes'
    }
  });
};

module.exports = {
  generalLimiter,
  strictLimiter,
  videoLimiter,
  feedLimiter,
  searchLimiter,
  analyticsLimiter,
  createProgressiveLimiter,
  createBypassLimiter,
  createDynamicLimiter
};