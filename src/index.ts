/**
 * ============================================================================
 * OPENAI-TO-CLOUDFLARE AI PROXY - MAIN ENTRY POINT
 * ============================================================================
 *
 * This service acts as an HTTP proxy that makes Cloudflare Workers AI appear
 * as OpenAI-compatible. It translates OpenAI API requests into Cloudflare
 * Workers AI format and translates responses back to OpenAI format.
 *
 * @version 1.9.30
 * @see https://github.com/your-repo/SPECIFICATION.md
 *
 * ============================================================================
 * ARCHITECTURE
 * ============================================================================
 *
 * This main entry point is intentionally minimal - it only handles:
 * 1. Request routing
 * 2. Authentication (via middleware)
 * 3. Error handling
 * 4. Performance logging
 *
 * All business logic is delegated to specialized handlers:
 * - handlers/chat.handler.ts       → Chat Completions API
 * - handlers/responses.handler.ts  → Responses API
 * - handlers/embeddings.handler.ts → Embeddings API
 * - handlers/image.handler.ts      → Image Generation API
 * - handlers/models.handler.ts     → Models listing
 * - handlers/health.handler.ts     → Health checks
 * - handlers/assistants.handler.ts → Assistants API (stub)
 * - handlers/threads.handler.ts    → Threads API (stub)
 * - handlers/files.handler.ts      → File uploads API (new)
 *
 * Authentication is handled by:
 * - middleware/auth.middleware.ts  → Bearer token validation
 *
 * ============================================================================
 * SUPPORTED ENDPOINTS
 * ============================================================================
 *
 * ✅ POST /v1/chat/completions    - Chat completions (streaming/non-streaming)
 * ✅ POST /v1/responses           - OpenAI Responses API format
 * ✅ POST /v1/embeddings          - Text embeddings generation
 * ✅ POST /v1/images/generations  - Image generation (DALL-E → Flux)
 * ✅ POST /v1/files               - File uploads (new)
 * ✅ GET  /v1/models              - List available models
 * ✅ GET  /health                 - Health check (no auth required)
 * ✅ GET  /models/search          - Model info page (debug)
 * 🔄 POST /v1/assistants/*        - Assistants API (501 stub)
 * 🔄 POST /v1/threads/*           - Threads API (501 stub)
 *
 * ============================================================================
 * KEY FEATURES
 * ============================================================================
 *
 * ✅ Full OpenAI API compatibility
 * ✅ Model aliasing (gpt-4 → Qwen, dall-e-3 → Flux, etc.)
 * ✅ Tool calling support (function calling)
 * ✅ Streaming responses (SSE format)
 * ✅ Reasoning models support (o1, o3 series)
 * ✅ Request validation and normalization
 * ✅ Bearer token authentication
 * ✅ Comprehensive error handling
 * ✅ Performance logging
 *
 * ============================================================================
 */

// ============================================================================
// IMPORTS
// ============================================================================

// API Handlers
import { handleHealth } from './handlers/health.handler';
import { handleListModels } from './handlers/models.handler';
import { handleEmbeddings } from './handlers/embeddings.handler';
import { handleImageGeneration } from './handlers/image.handler';
import { handleAssistants } from './handlers/assistants.handler';
import { handleThreads } from './handlers/threads.handler';
import { handleResponses } from './handlers/responses.handler';
import { handleChatCompletions } from './handlers/chat.handler';
import { handleFiles } from './handlers/files.handler';

// Middleware
import { authenticateRequest, requiresAuth } from './middleware/auth.middleware';

// Utilities
import { PROXY_VERSION } from './constants';
import { errorResponse, notFoundError } from './errors';
import { displayModelsInfo } from './model-helpers';
import type { Env } from './types';

// ============================================================================
// ROUTE TABLE
// ============================================================================

/**
 * Route entry: [HTTP method ('*' = any), path matcher (string = exact, fn = predicate), handler]
 */
type RouteHandler = (request: Request, env: Env, url: URL) => Promise<Response>;
type RouteMatcher = string | ((pathname: string) => boolean);

const ROUTES: Array<[string, RouteMatcher, RouteHandler]> = [
  // Debug
  ['GET',  '/models/search',          (req, env) => displayModelsInfo(env, req)],
  // Models
  ['GET',  '/v1/models',              (_req, env) => handleListModels(env)],
  // Core AI endpoints
  ['POST', '/v1/chat/completions',    (req, env) => handleChatCompletions(req, env)],
  ['POST', '/v1/responses',           (req, env) => handleResponses(req, env)],
  ['POST', '/v1/images/generations',  (req, env) => handleImageGeneration(req, env)],
  ['POST', '/v1/embeddings',          (req, env) => handleEmbeddings(req, env)],
  ['POST', '/v1/files',               (req, env) => handleFiles(req, env)],
  // Stubs (prefix match)
  ['*',    (p) => p.startsWith('/v1/assistants'), (req, env, url) => handleAssistants(req, env, url)],
  ['*',    (p) => p.startsWith('/v1/threads'),    (req, env, url) => handleThreads(req, env, url)],
];

/**
 * Resolve the handler for an incoming request, or return null for 404.
 */
function matchRoute(method: string, pathname: string): RouteHandler | null {
  for (const [routeMethod, matcher, handler] of ROUTES) {
    const methodMatch = routeMethod === '*' || routeMethod === method;
    const pathMatch = typeof matcher === 'string' ? pathname === matcher : matcher(pathname);
    if (methodMatch && pathMatch) return handler;
  }
  return null;
}

// ============================================================================
// WORKER EXPORT
// ============================================================================

/**
 * Cloudflare Workers entry point.
 */
export default {
  /**
   * Main request handler.
   *
   * @param request - Incoming HTTP request
   * @param env - Cloudflare Workers environment bindings
   * @returns HTTP response
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const startTime = Date.now();
    // Short request ID for log correlation (last 8 chars of a UUID)
    const requestId = crypto.randomUUID().slice(-8);

    // Log incoming request
    console.log(
      `[${new Date().toISOString()}] [v${PROXY_VERSION}] [${requestId}] ` +
      `${request.method} ${url.pathname}`
    );

    // ========================================================================
    // HEALTH CHECK (No Auth Required)
    // ========================================================================

    if (url.pathname === '/health' && request.method === 'GET') {
      return handleHealth(env);
    }

    // ========================================================================
    // AUTHENTICATION
    // ========================================================================

    // Check if endpoint requires authentication
    if (requiresAuth(url.pathname)) {
      const authResult = authenticateRequest(request, env, url.pathname);
      if (!authResult.success) {
        return authResult.error!;
      }
    }

    // ========================================================================
    // REQUEST ROUTING
    // ========================================================================

    try {
      const handler = matchRoute(request.method, url.pathname);

      const response = handler
        ? await handler(request, env, url)
        : notFoundError();

      // ====================================================================
      // RESPONSE LOGGING
      // ====================================================================

      const latency = Date.now() - startTime;
      console.log(
        `[${new Date().toISOString()}] [${requestId}] ${url.pathname} ` +
        `completed in ${latency}ms`
      );

      return response;

    } catch (error) {
      const latency = Date.now() - startTime;
      console.error(
        `[${new Date().toISOString()}] [${requestId}] Unhandled error after ${latency}ms:`,
        error
      );

      return errorResponse(
        "Internal server error",
        500,
        "api_error",
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }
};
