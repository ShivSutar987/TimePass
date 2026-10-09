/**
 * PaniPari - Security & Authentication Module
 * Pure Node.js implementation using native crypto (zero external npm dependencies)
 * Real Admin Password: "ShivSutar@22.132"
 * Supports Temporary Demo Admin Mode with Sandbox Auto-Cleanup
 */

const crypto = require('node:crypto');

// In-memory active sessions: token -> { createdAt, expiresAt, ip, isDemo }
const activeSessions = new Map();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for real admin
const DEMO_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours for demo admin

// Brute-force rate limiter for login: ip -> { attempts: number, lockUntil: number }
const loginAttempts = new Map();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_PERIOD_MS = 5 * 60 * 1000; // 5 minutes lockout

/**
 * Hash a password or PIN with a random salt using SHA-256
 */
function hashPin(pin, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const hash = crypto.createHmac('sha256', salt).update(String(pin)).digest('hex');
  return { hash, salt };
}

/**
 * Verify a PIN/Password against a stored hash and salt with constant-time equality
 */
function verifyPin(enteredPin, storedHash, storedSalt) {
  if (!enteredPin || !storedHash || !storedSalt) return false;
  const computedHash = crypto.createHmac('sha256', storedSalt).update(String(enteredPin)).digest('hex');
  
  // Prevent timing attacks using crypto.timingSafeEqual
  const bufA = Buffer.from(computedHash, 'hex');
  const bufB = Buffer.from(storedHash, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Get or initialize Admin Password hash in database settings.
 * Original Admin Password: "ShivSutar@22.132"
 */
function ensureAdminCredentials(db) {
  let storedHash = db.getSetting('admin_pin_hash');
  let storedSalt = db.getSetting('admin_pin_salt');

  if (!storedHash || !storedSalt) {
    const originalPassword = process.env.ADMIN_PASSWORD || process.env.ADMIN_PIN || 'ShivSutar@22.132';
    const { hash, salt } = hashPin(originalPassword);
    db.setSetting('admin_pin_hash', hash);
    db.setSetting('admin_pin_salt', salt);
    return { hash, salt };
  }

  return { hash: storedHash, salt: storedSalt };
}

/**
 * Rate limit checker for login attempts
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (record && record.lockUntil && record.lockUntil > now) {
    const remainingSeconds = Math.ceil((record.lockUntil - now) / 1000);
    return {
      allowed: false,
      lockoutSeconds: remainingSeconds,
      error: `Too many failed attempts. Try again in ${remainingSeconds} seconds.`
    };
  }

  return { allowed: true };
}

/**
 * Record a failed login attempt
 */
function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { attempts: 0, lockUntil: 0 };
  record.attempts += 1;

  if (record.attempts >= MAX_FAILED_ATTEMPTS) {
    record.lockUntil = now + LOCKOUT_PERIOD_MS;
    record.attempts = 0; // Reset counter for after lockout
  }

  loginAttempts.set(ip, record);
  return {
    attemptsRemaining: Math.max(0, MAX_FAILED_ATTEMPTS - record.attempts),
    isLocked: record.lockUntil > now
  };
}

/**
 * Clear failed attempts after successful login
 */
function clearFailedAttempts(ip) {
  loginAttempts.delete(ip);
}

/**
 * Create a new cryptographically secure admin session token
 * Supports isDemo flag for sandbox testing
 */
function createSession(ip = '', isDemo = false) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const session = {
    token,
    createdAt: now,
    expiresAt: now + (isDemo ? DEMO_TTL_MS : SESSION_TTL_MS),
    ip,
    isDemo: !!isDemo
  };
  activeSessions.set(token, session);
  return session;
}

/**
 * Retrieve session by token (handles expiration)
 */
function getSession(token) {
  if (!token) return null;
  const session = activeSessions.get(token);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return null;
  }

  return session;
}

/**
 * Validate an admin session token
 */
function validateSession(token) {
  return getSession(token) !== null;
}

/**
 * Revoke an admin session token
 */
function revokeSession(token) {
  if (token) {
    activeSessions.delete(token);
  }
}

/**
 * Express middleware to inject standard security HTTP headers
 */
function securityHeadersMiddleware(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}

/**
 * Helper to extract token from request
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return req.headers['x-admin-token'] || req.query.token || null;
}

/**
 * Express middleware: Require Admin Authentication (Real or Demo)
 */
function requireAdmin(req, res, next) {
  const token = extractToken(req);
  const session = getSession(token);
  if (!token || !session) {
    return res.status(401).json({
      success: false,
      error: 'Admin authentication required. Please enter Admin Password.'
    });
  }
  req.isAdmin = true;
  req.isDemo = !!session.isDemo;
  req.session = session;
  next();
}

/**
 * Express middleware: Optional Admin Authentication
 */
function optionalAdmin(req, res, next) {
  const token = extractToken(req);
  const session = getSession(token);
  req.isAdmin = !!session;
  req.isDemo = !!(session && session.isDemo);
  req.session = session;
  next();
}

module.exports = {
  hashPin,
  verifyPin,
  ensureAdminCredentials,
  checkRateLimit,
  recordFailedAttempt,
  clearFailedAttempts,
  createSession,
  getSession,
  validateSession,
  revokeSession,
  securityHeadersMiddleware,
  requireAdmin,
  optionalAdmin,
  extractToken
};
