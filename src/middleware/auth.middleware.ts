/**
 * ============================================================================
 * AUTHENTICATION MIDDLEWARE
 * ============================================================================
 *
 * Handles API key authentication for all requests.
 * Validates Bearer tokens against configured API_KEY in environment.
 *
 * @module middleware/auth
 */

import { authenticationError } from '../errors';
import type { Env } from '../types';

/**
 * ============================================================================
 * TYPES
 * ============================================================================
 */

/**
 * Authentication result indicating success or failure.
 */
export interface AuthResult {
  /** Whether authentication succeeded */
  success: boolean;
  /** Error response if authentication failed */
  error?: Response;
}

/**
 * ============================================================================
 * AUTHENTICATION MIDDLEWARE
 * ============================================================================
 */

/**
 * Authenticate a request using Bearer token authentication.
 *
 * Checks if the provided Authorization header contains a valid Bearer token
 * that matches the configured API_KEY. Special handling for:
 * - Health endpoint (no auth required)
 * - /models/search (allowed for debugging)
 * - Unconfigured API_KEY (allows all requests with warning)
 *
 * @param request - HTTP request to authenticate
 * @param env - Environment with API_KEY configuration
 * @param pathname - Request pathname for logging
 * @returns AuthResult with success status and optional error response
 *
 * @example
 * const authResult = authenticateRequest(request, env, url.pathname);
 * if (!authResult.success) {
 *   return authResult.error!;
 * }
 */
export function authenticateRequest(request: Request, env: Env, pathname: string): AuthResult {
  const authHeader = request.headers.get('Authorization');
  const providedKey = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  // Debug logging for authentication
  console.log(`[Auth] Request to ${pathname} from ${request.headers.get('User-Agent') || 'unknown'}`);
  console.log(`[Auth] Authorization header present: ${!!authHeader}`);
  console.log(`[Auth] API_KEY configured: ${!!env.API_KEY}`);

  // Log headers for debugging (mask sensitive data)
  const allHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (key.toLowerCase().includes('auth') ||
        key.toLowerCase().includes('key') ||
        key.toLowerCase().includes('token')) {
      allHeaders[key] = value.substring(0, 15) + '...';
    } else {
      allHeaders[key] = value;
    }
  });
  console.log(`[Auth] Headers:`, JSON.stringify(allHeaders));

  if (authHeader && providedKey) {
    console.log(`[Auth] Provided key (first 8 chars): ${providedKey.substring(0, 8)}...`);
  }
  if (env.API_KEY) {
    console.log(`[Auth] Expected key (first 8 chars): ${env.API_KEY.substring(0, 8)}...`);
  }

  // If API_KEY is not configured or is default, allow all requests
  if (!env.API_KEY || env.API_KEY === 'your-api-key-here') {
    console.warn(`[Auth] WARNING: API_KEY not configured. All requests are allowed.`);
    return { success: true };
  }

  // Validate API key
  if (providedKey !== env.API_KEY) {
    // Allow unauthenticated access to /models/search for debugging
    if (pathname === '/models/search') {
      console.log(`[Auth] Allowing unauthenticated access to ${pathname} for debugging`);
      return { success: true };
    }

    console.error(`[Auth] Authentication failed - key mismatch`);
    return {
      success: false,
      error: authenticationError("Invalid authentication credentials")
    };
  }

  console.log(`[Auth] Authentication successful`);
  return { success: true };
}

/**
 * Check if a pathname requires authentication.
 *
 * Some endpoints like /health do not require authentication.
 *
 * @param pathname - URL pathname to check
 * @returns True if authentication is required
 */
export function requiresAuth(pathname: string): boolean {
  // Health check endpoint doesn't require auth
  if (pathname === '/health') {
    return false;
  }

  return true;
}

