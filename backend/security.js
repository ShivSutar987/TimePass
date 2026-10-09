/**
 * PaniPari - Security & Authentication Module
 * Pure Node.js implementation using native crypto (zero external npm dependencies)
 * Keeps repository well under 50 MB with robust security.
 */

const crypto = require('node:crypto');

// In-memory active sessions: token -> { createdAt, expiresAt, ip }
const activeSessions = new Map();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
 * Verify a PIN against a stored hash and salt with constant-time equality
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
 * Get or initialize Admin PIN hash in database settings.
 * Defaults to process.env.ADMIN_PIN or '1234'
 */
function ensureAdminCredentials(db) {
  let storedHash = db.getSetting('admin_pin_hash');
  let storedSalt = db.getSetting('admin_pin_salt');

  if (!storedHash || !storedSalt) {
    const defaultPin = process.env.ADMIN_PASSWORD || process.env.ADMIN_PIN || 'ShivSutar@22.132';
    const { hash, salt } = hashPin(defaultPin);
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
 */
function createSession(ip = '') {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const session = {
    token,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    ip
  };
  activeSessions.set(token, session);
  return session;
}

/**
 * Validate an admin session token
 */
function validateSession(token) {
  if (!token) return false;
  const session = activeSessions.get(token);
  if (!session) return false;

  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return false;
  }

  return true;
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
 * Express middleware: Require Admin Authentication
 */
function requireAdmin(req, res, next) {
  const token = extractToken(req);
  if (!token || !validateSession(token)) {
    return res.status(401).json({
      success: false,
      error: 'Admin authentication required. Please log in with the Admin PIN.'
    });
  }
  req.isAdmin = true;
  next();
}

/**
 * Express middleware: Optional Admin Authentication
 */
function optionalAdmin(req, res, next) {
  const token = extractToken(req);
  req.isAdmin = !!(token && validateSession(token));
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
  validateSession,
  revokeSession,
  securityHeadersMiddleware,
  requireAdmin,
  optionalAdmin,
  extractToken
};
