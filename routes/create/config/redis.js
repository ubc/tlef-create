import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

// Redis client configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || 'tlef-redis-2024',
  retryDelayOnFailover: 100,
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,
  lazyConnect: true
};

// Create Redis client
const redis = new Redis(redisConfig);

// Connection event handlers
redis.on('connect', () => {
  console.log('✅ Redis Client Connected');
});

redis.on('ready', () => {
  console.log('✅ Redis Client Ready');
});

redis.on('error', (err) => {
  console.error('❌ Redis Client Error:', err);
});

redis.on('close', () => {
  console.log('⚠️ Redis Client Connection Closed');
});

redis.on('reconnecting', () => {
  console.log('🔄 Redis Client Reconnecting...');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await redis.disconnect();
  console.log('🔴 Redis connection closed through app termination');
});

// Redis utility functions
export const redisUtils = {
  // Session management
  setSession: async (userId, sessionData, ttl = 3600) => {
    try {
      await redis.setex(`session:${userId}`, ttl, JSON.stringify(sessionData));
      return true;
    } catch (error) {
      console.error('Error setting session:', error);
      return false;
    }
  },

  getSession: async (userId) => {
    try {
      const session = await redis.get(`session:${userId}`);
      return session ? JSON.parse(session) : null;
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    }
  },

  deleteSession: async (userId) => {
    try {
      await redis.del(`session:${userId}`);
      return true;
    } catch (error) {
      console.error('Error deleting session:', error);
      return false;
    }
  },

  // Caching utilities
  setCache: async (key, data, ttl = 300) => {
    try {
      await redis.setex(key, ttl, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('Error setting cache:', error);
      return false;
    }
  },

  getCache: async (key) => {
    try {
      const cached = await redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Error getting cache:', error);
      return null;
    }
  },

  deleteCache: async (key) => {
    try {
      await redis.del(key);
      return true;
    } catch (error) {
      console.error('Error deleting cache:', error);
      return false;
    }
  },

  // Rate limiting utilities
  checkRateLimit: async (identifier, limit, window) => {
    try {
      const key = `rate_limit:${identifier}`;
      const current = await redis.incr(key);
      
      if (current === 1) {
        await redis.expire(key, window);
      }
      
      return {
        allowed: current <= limit,
        current,
        limit,
        resetTime: await redis.ttl(key)
      };
    } catch (error) {
      console.error('Error checking rate limit:', error);
      return { allowed: true, current: 0, limit, resetTime: window };
    }
  }
};

export default redis;