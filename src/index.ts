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

// Middleware
import { authenticateRequest, requiresAuth } from './middleware/auth.middleware';

// Utilities
import { PROXY_VERSION } from './constants';
import { errorResponse, notFoundError } from './errors';
import { displayModelsInfo } from './model-helpers';
import type { Env } from './types';

// ============================================================================
// WORKER EXPORT
// ============================================================================

/**
 * Cloudflare Workers entry point.
 * Handles all incoming HTTP requests and routes them to appropriate handlers.
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

    // Log incoming request
    console.log(
      `[${new Date().toISOString()}] [v${PROXY_VERSION}] ` +
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
      let response: Response;

      // Route based on pathname and method
      switch (true) {
        // ----------------------------------------------------------------
        // Debug/Info Endpoints
        // ----------------------------------------------------------------

        case url.pathname === '/models/search' && request.method === 'GET':
          response = await displayModelsInfo(env, request);
          break;

        // ----------------------------------------------------------------
        // OpenAI API Endpoints
        // ----------------------------------------------------------------

        case url.pathname === '/v1/models' && request.method === 'GET':
          response = await handleListModels(env);
          break;

        case url.pathname === '/v1/chat/completions' && request.method === 'POST':
          response = await handleChatCompletions(request, env);
          break;

        case url.pathname === '/v1/responses' && request.method === 'POST':
          response = await handleResponses(request, env);
          break;

        case url.pathname === '/v1/images/generations' && request.method === 'POST':
          response = await handleImageGeneration(request, env);
          break;

        case url.pathname === '/v1/embeddings' && request.method === 'POST':
          response = await handleEmbeddings(request, env);
          break;

        // ----------------------------------------------------------------
        // Assistants & Threads API (Stubs)
        // ----------------------------------------------------------------

        case url.pathname.startsWith('/v1/assistants'):
          response = await handleAssistants(request, env, url);
          break;

        case url.pathname.startsWith('/v1/threads'):
          response = await handleThreads(request, env, url);
          break;

        // ----------------------------------------------------------------
        // 404 - Not Found
        // ----------------------------------------------------------------

        default:
          response = notFoundError();
      }

      // ====================================================================
      // RESPONSE LOGGING
      // ====================================================================

      const latency = Date.now() - startTime;
      console.log(
        `[${new Date().toISOString()}] ${url.pathname} ` +
        `completed in ${latency}ms`
      );

      return response;

    } catch (error) {
      // ====================================================================
      // ERROR HANDLING
      // ====================================================================

      const latency = Date.now() - startTime;
      console.error(
        `[${new Date().toISOString()}] Unhandled error after ${latency}ms:`,
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
