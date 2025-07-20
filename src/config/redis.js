const redis = require('redis');

let redisClient = null;

const connectRedis = async () => {
  try {
    const redisConfig = {
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
        ...(process.env.REDIS_TLS === 'true' && { tls: true })
      },
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
    };

    // Add password if provided
    if (process.env.REDIS_PASSWORD) {
      redisConfig.password = process.env.REDIS_PASSWORD;
    }

    redisClient = redis.createClient(redisConfig);

    // Error handling
    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      console.log('Redis Client Connected');
    });

    redisClient.on('ready', () => {
      console.log('Redis Client Ready');
    });

    redisClient.on('end', () => {
      console.log('Redis Client Disconnected');
    });

    // Connect to Redis
    await redisClient.connect();

    // Test the connection
    await redisClient.ping();
    console.log('Redis connection successful');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      if (redisClient) {
        await redisClient.quit();
        console.log('Redis connection closed through app termination');
      }
    });

  } catch (error) {
    console.error('Redis connection failed:', error);
    // Don't exit process, let app run without Redis (with degraded performance)
    console.log('Running without Redis cache');
  }
};

const getRedisClient = () => {
  return redisClient;
};

// Cache helper functions
const setCache = async (key, value, ttl = 3600) => {
  try {
    if (!redisClient) return false;
    
    const serializedValue = JSON.stringify(value);
    await redisClient.setEx(key, ttl, serializedValue);
    return true;
  } catch (error) {
    console.error('Redis set error:', error);
    return false;
  }
};

const getCache = async (key) => {
  try {
    if (!redisClient) return null;
    
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error('Redis get error:', error);
    return null;
  }
};

const deleteCache = async (key) => {
  try {
    if (!redisClient) return false;
    
    await redisClient.del(key);
    return true;
  } catch (error) {
    console.error('Redis delete error:', error);
    return false;
  }
};

const flushCache = async () => {
  try {
    if (!redisClient) return false;
    
    await redisClient.flushAll();
    return true;
  } catch (error) {
    console.error('Redis flush error:', error);
    return false;
  }
};

module.exports = {
  connectRedis,
  getRedisClient,
  setCache,
  getCache,
  deleteCache,
  flushCache
};