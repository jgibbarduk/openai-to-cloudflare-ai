/**
 * ============================================================================
 * HEALTH HANDLER
 * ============================================================================
 *
 * Handles the GET /health endpoint for service monitoring and health checks.
 * Returns service status and availability of underlying providers.
 *
 * @module handlers/health
 */

import { PROXY_VERSION } from '../constants';
import type { Env } from '../types';

/**
 * ============================================================================
 * TYPES
 * ============================================================================
 */

/**
 * Health check response structure.
 */
interface HealthResponse {
  /** Overall service status */
  status: 'ok' | 'degraded' | 'down';
  /** ISO 8601 timestamp of health check */
  timestamp: string;
  /** Proxy service version */
  version: string;
  /** Status of dependent providers */
  providers: {
    /** Cloudflare Workers AI availability */
    workers_ai: 'up' | 'down' | 'unknown';
  };
}

/**
 * ============================================================================
 * HANDLER
 * ============================================================================
 */

/**
 * Handle GET /health request.
 *
 * Returns the current health status of the proxy service and its dependencies.
 * This endpoint is useful for monitoring, load balancer health checks, and
 * debugging connectivity issues.
 *
 * @param env - Cloudflare Workers environment with AI binding
 * @returns JSON response with health status (200 if healthy, 503 if degraded)
 *
 * @example
 * // Healthy response:
 * {
 *   "status": "ok",
 *   "timestamp": "2026-02-15T10:30:00.000Z",
 *   "version": "1.9.30",
 *   "providers": { "workers_ai": "up" }
 * }
 *
 * @example
 * // Degraded response:
 * {
 *   "status": "degraded",
 *   "timestamp": "2026-02-15T10:30:00.000Z",
 *   "version": "1.9.30",
 *   "providers": { "workers_ai": "down" }
 * }
 */
export async function handleHealth(env: Env): Promise<Response> {
  const health: HealthResponse = {
    status: "ok",
    timestamp: new Date().toISOString(),
    version: PROXY_VERSION,
    providers: {
      workers_ai: "unknown"
    }
  };

  // Check if AI binding is available
  try {
    if (env.AI && typeof env.AI.run === 'function') {
      health.providers.workers_ai = "up";
    } else {
      health.providers.workers_ai = "down";
      health.status = "degraded";
    }
  } catch (error) {
    console.error('[Health] Error checking AI binding:', error);
    health.providers.workers_ai = "down";
    health.status = "degraded";
  }

  // Determine HTTP status code based on health
  const statusCode = health.status === "ok" ? 200 : 503;

  return new Response(JSON.stringify(health), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

