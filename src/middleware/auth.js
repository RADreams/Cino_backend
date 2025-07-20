const jwt = require('jsonwebtoken');
const { asyncHandler, AppError } = require('./errorHandler');
const User = require('../models/User');

/**
 * Authentication middleware for admin routes
 * Since we use anonymous users, this is mainly for admin/protected routes
 */
const authenticate = asyncHandler(async (req, res, next) => {
  let token;

  // Get token from header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // Check if token exists
  if (!token) {
    throw new AppError('Access token is required', 401);
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Add user info to request (for admin users)
    req.user = decoded;
    next();
  } catch (error) {
    throw new AppError('Invalid or expired token', 401);
  }
});

/**
 * Optional authentication - doesn't fail if no token
 * Used for routes that work for both anonymous and authenticated users
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  let token;

  // Get token from header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (token) {
    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    } catch (error) {
      // Don't throw error, just continue as anonymous
      console.log('Optional auth failed:', error.message);
    }
  }

  next();
});

/**
 * User validation middleware
 * Validates userId from request params/body and sets user context
 */
const validateUser = asyncHandler(async (req, res, next) => {
  const userId = req.params.userId || req.body.userId || req.query.userId;

  if (!userId) {
    throw new AppError('User ID is required', 400);
  }

  // Validate userId format (basic validation)
  if (typeof userId !== 'string' || userId.length < 5) {
    throw new AppError('Invalid user ID format', 400);
  }

  // Check if user exists (optional - for better error handling)
  try {
    const user = await User.findByUserId(userId);
    if (user) {
      req.userExists = true;
      req.userDoc = user;
    } else {
      req.userExists = false;
    }
  } catch (error) {
    // Don't fail if user check fails, just continue
    req.userExists = false;
  }

  // Set userId in request context
  req.userId = userId;
  next();
});

/**
 * Admin role authorization
 * Checks if authenticated user has admin privileges
 */
const requireAdmin = asyncHandler(async (req, res, next) => {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }

  if (req.user.role !== 'admin') {
    throw new AppError('Admin access required', 403);
  }

  next();
});

/**
 * Device validation middleware
 * Validates device info for analytics and user tracking
 */
const validateDevice = (req, res, next) => {
  const deviceId = req.headers['x-device-id'] || req.body.deviceInfo?.deviceId;
  const platform = req.headers['x-platform'] || req.body.deviceInfo?.platform;
  const appVersion = req.headers['x-app-version'] || req.body.deviceInfo?.appVersion;

  // Set device context
  req.deviceContext = {
    deviceId,
    platform,
    appVersion,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  };

  next();
};

/**
 * Session validation middleware
 * Creates or validates session for anonymous users
 */
const validateSession = asyncHandler(async (req, res, next) => {
  let sessionId = req.headers['x-session-id'] || req.body.sessionId;

  // Generate new session ID if not provided
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Validate session ID format
  if (typeof sessionId !== 'string' || sessionId.length < 10) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  req.sessionId = sessionId;
  next();
});

/**
 * Generate JWT token for admin users
 */
const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '7d' // Token expires in 7 days
  });
};

/**
 * Admin login (for testing/demo purposes)
 * In production, this should be more secure
 */
const adminLogin = asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  // Simple admin credentials (in production, use proper authentication)
  const validAdmins = [
    { username: 'admin', password: 'admin123', role: 'admin' },
    { username: 'moderator', password: 'mod123', role: 'moderator' }
  ];

  const admin = validAdmins.find(a => a.username === username && a.password === password);

  if (!admin) {
    throw new AppError('Invalid credentials', 401);
  }

  // Generate token
  const token = generateToken({
    username: admin.username,
    role: admin.role,
    loginTime: new Date()
  });

  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: {
      token,
      user: {
        username: admin.username,
        role: admin.role
      }
    }
  });
});

/**
 * Security headers middleware
 */
const securityHeaders = (req, res, next) => {
  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  next();
};

/**
 * Request logging middleware
 */
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: req.userId || 'anonymous',
      sessionId: req.sessionId || 'no-session',
      userAgent: req.get('User-Agent'),
      ip: req.ip
    };
    
    // Log to console (in production, use proper logging service)
    console.log(`${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms`);
  });
  
  next();
};

/**
 * API key validation (for third-party integrations)
 */
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  // List of valid API keys (in production, store in database)
  const validApiKeys = [
    process.env.ADMIN_API_KEY,
    process.env.ANALYTICS_API_KEY
  ].filter(Boolean);

  if (validApiKeys.length > 0 && (!apiKey || !validApiKeys.includes(apiKey))) {
    return res.status(401).json({
      success: false,
      error: 'Valid API key required'
    });
  }

  next();
};

/**
 * Content access control
 * Check if user has access to specific content based on restrictions
 */
const checkContentAccess = asyncHandler(async (req, res, next) => {
  const { contentId } = req.params;
  const userLocation = req.headers['x-user-location'] || 'India';

  if (contentId) {
    const Content = require('../models/Content');
    const content = await Content.findById(contentId, 'feedSettings visibility status');
    
    if (!content) {
      throw new AppError('Content not found', 404);
    }

    // Check if content is published
    if (content.status !== 'published') {
      throw new AppError('Content not available', 403);
    }

    // Check geographic restrictions
    if (content.feedSettings.geographicRestrictions && 
        content.feedSettings.geographicRestrictions.length > 0 &&
        !content.feedSettings.geographicRestrictions.includes(userLocation)) {
      throw new AppError('Content not available in your region', 403);
    }

    // Check visibility (premium content access)
    if (content.visibility === 'premium' && !req.user?.isPremium) {
      throw new AppError('Premium subscription required', 402);
    }

    req.contentAccess = {
      hasAccess: true,
      contentType: content.visibility
    };
  }

  next();
});

module.exports = {
  authenticate,
  optionalAuth,
  validateUser,
  requireAdmin,
  validateDevice,
  validateSession,
  generateToken,
  adminLogin,
  securityHeaders,
  requestLogger,
  validateApiKey,
  checkContentAccess
};