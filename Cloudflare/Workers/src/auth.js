// ============================================================================
// Cloudflare Workers Administrator Authentication Module
// Sole Admin Email: nttf.ttc.m3b.group1.project@gmail.com
// ============================================================================

import { generateRandomHex, sha256Hex, hashPassword, verifyPassword } from './crypto.js';

const ADMIN_EMAIL = 'nttf.ttc.m3b.group1.project@gmail.com';
const SESSION_DURATION_HOURS = 24;

// Simple in-memory rate limiter per worker instance for login attempts
const loginAttempts = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 5) {
    return false; // Exceeded 5 failed attempts in 15 mins
  }
  entry.count++;
  return true;
}

function clearRateLimit(ip) {
  loginAttempts.delete(ip);
}

/**
 * Handle First-Time Admin Password Setup or Reset
 */
export async function handleSetupPassword(request, env) {
  try {
    const { email, password, setupKey } = await request.json();
    if (!email || email.toLowerCase().trim() !== ADMIN_EMAIL.toLowerCase()) {
      return jsonResponse({ error: 'Only the designated project administrator email can set up credentials.' }, 403);
    }
    if (!password || password.length < 8) {
      return jsonResponse({ error: 'Password must be at least 8 characters long.' }, 400);
    }

    // Check if an admin already exists in D1
    const existing = await env.DB.prepare('SELECT id, password_hash FROM admins WHERE email = ?').bind(ADMIN_EMAIL).first();
    if (existing && existing.password_hash) {
      // If already initialized, require current master setup key
      const expectedKey = env.SETUP_MASTER_KEY || 'NTTF_MECHATRONICS_2026_INIT';
      if (setupKey !== expectedKey) {
        return jsonResponse({ error: 'Administrator already configured. Valid master setup key is required for password reset.' }, 403);
      }
    }

    const salt = generateRandomHex(32);
    const passwordHash = await hashPassword(password, salt);
    const adminId = existing ? existing.id : 'admin_nttf_01';

    if (existing) {
      await env.DB.prepare('UPDATE admins SET password_hash = ?, salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(passwordHash, salt, adminId).run();
    } else {
      await env.DB.prepare('INSERT INTO admins (id, email, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)')
        .bind(adminId, ADMIN_EMAIL, passwordHash, salt, 'superadmin').run();
    }

    // Log activity
    await env.DB.prepare('INSERT INTO activity_logs (id, actor, action, details) VALUES (?, ?, ?, ?)')
      .bind(generateRandomHex(16), `admin:${ADMIN_EMAIL}`, 'PASSWORD_SETUP', 'Administrator password securely set or updated.').run();

    return jsonResponse({ success: true, message: 'Administrator password configured successfully. You may now log in.' });
  } catch (err) {
    return jsonResponse({ error: 'Password setup failed: ' + err.message }, 500);
  }
}

/**
 * Handle Administrator Login
 */
export async function handleLogin(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
  if (!checkRateLimit(ip)) {
    return jsonResponse({ error: 'Too many failed login attempts. Please wait 15 minutes before trying again.' }, 429);
  }

  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return jsonResponse({ error: 'Email and password are required.' }, 400);
    }

    if (email.toLowerCase().trim() !== ADMIN_EMAIL.toLowerCase()) {
      return jsonResponse({ error: 'Invalid administrator credentials.' }, 401);
    }

    // Query D1 database
    let admin = await env.DB.prepare('SELECT id, email, password_hash, salt FROM admins WHERE email = ?')
      .bind(ADMIN_EMAIL).first();

    // If admin record does not exist yet, allow initial auto-bootstrap with default temporary setup
    if (!admin) {
      return jsonResponse({ 
        error: 'Administrator credentials not yet initialized.', 
        requiresSetup: true,
        email: ADMIN_EMAIL 
      }, 404);
    }

    const isValid = await verifyPassword(password, admin.password_hash, admin.salt);
    if (!isValid) {
      return jsonResponse({ error: 'Invalid administrator credentials.' }, 401);
    }

    // Successful login - Clear rate limiter
    clearRateLimit(ip);

    // Create session token
    const rawToken = generateRandomHex(64);
    const tokenHash = await sha256Hex(rawToken);
    const sessionId = generateRandomHex(16);
    const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 3600 * 1000).toISOString();

    await env.DB.prepare(
      'INSERT INTO admin_sessions (id, admin_id, token_hash, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(sessionId, admin.id, tokenHash, expiresAt, ip, request.headers.get('User-Agent') || 'Unknown').run();

    // Log activity
    await env.DB.prepare('INSERT INTO activity_logs (id, actor, action, details, ip_address) VALUES (?, ?, ?, ?, ?)')
      .bind(generateRandomHex(16), `admin:${ADMIN_EMAIL}`, 'LOGIN_SUCCESS', 'Successful administrator login', ip).run();

    return jsonResponse({
      success: true,
      token: rawToken,
      expiresAt,
      admin: {
        email: ADMIN_EMAIL,
        role: 'superadmin'
      }
    });
  } catch (err) {
    return jsonResponse({ error: 'Authentication error: ' + err.message }, 500);
  }
}

/**
 * Validate Admin Session Token from Authorization Header
 */
export async function authenticateAdmin(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7).trim();
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();

  const session = await env.DB.prepare(
    `SELECT s.id as session_id, s.expires_at, a.id as admin_id, a.email, a.role 
     FROM admin_sessions s 
     JOIN admins a ON s.admin_id = a.id 
     WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(tokenHash, now).first();

  return session;
}

/**
 * Handle Administrator Logout
 */
export async function handleLogout(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (admin) {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader.substring(7).trim();
    const tokenHash = await sha256Hex(token);
    await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(tokenHash).run();
    await env.DB.prepare('INSERT INTO activity_logs (id, actor, action, details) VALUES (?, ?, ?, ?)')
      .bind(generateRandomHex(16), `admin:${ADMIN_EMAIL}`, 'LOGOUT', 'Administrator logged out').run();
  }
  return jsonResponse({ success: true, message: 'Logged out successfully.' });
}

/**
 * Helper to return formatted JSON responses
 */
export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Key',
      ...headers
    }
  });
}
