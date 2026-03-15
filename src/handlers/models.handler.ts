/**
 * ============================================================================
 * MODELS HANDLER
 * ============================================================================
 *
 * Handles the GET /v1/models endpoint for listing available AI models.
 * Returns an OpenAI-compatible list of models that can be used with the proxy.
 *
 * @module handlers/models
 */

import { listAIModels } from '../model-helpers';
import { serverError } from '../errors';
import type { Env } from '../types';

/**
 * ============================================================================
 * RESPONSE INTERFACES
 * ============================================================================
 */

/**
 * OpenAI model list item structure.
 */
interface OpenAIModelListItem {
  /** Unique model identifier */
  id: string;
  /** Object type (always "model") */
  object: "model";
}

/**
 * OpenAI model list response structure.
 */
interface OpenAIModelListResponse {
  /** Object type (always "list") */
  object: "list";
  /** Array of available models */
  data: OpenAIModelListItem[];
}

/**
 * ============================================================================
 * HANDLER
 * ============================================================================
 */

/**
 * Handle GET /v1/models request.
 *
 * Returns a list of available AI models in OpenAI-compatible format.
 * The response includes only the minimal required fields (id, object)
 * as specified by the OpenAI API and expected by clients like Onyx.
 *
 * @param env - Cloudflare Workers environment with AI binding
 * @returns OpenAI-compatible JSON response with model list
 *
 * @example
 * // Response format:
 * {
 *   "object": "list",
 *   "data": [
 *     { "id": "@cf/qwen/qwen3-30b-a3b-fp8", "object": "model" },
 *     { "id": "@cf/meta/llama-3-8b-instruct", "object": "model" }
 *   ]
 * }
 *
 * @see {@link https://platform.openai.com/docs/api-reference/models/list | OpenAI Models API}
 */
export async function handleListModels(env: Env): Promise<Response> {
  const startTime = Date.now();
  console.log('[Models] Fetching available models...');

  try {
    // Fetch available models from Cloudflare Workers AI
    const models = await listAIModels(env);

    // Transform to OpenAI-compatible format (empty list is valid, not an error)
    const openaiModels: OpenAIModelListItem[] = (models ?? []).map(m => ({
      id: m.id || m.name,
      object: "model" as const
    }));

    // Prepend the virtual auto-route models so clients can discover them
    const autoRouteModels: OpenAIModelListItem[] = [
      { id: 'auto',       object: 'model' },
      { id: 'auto/route', object: 'model' },
    ];

    const response: OpenAIModelListResponse = {
      object: "list",
      data: [...autoRouteModels, ...openaiModels]
    };

    const duration = Date.now() - startTime;
    console.log(`[Models] Returning ${openaiModels.length} models (took ${duration}ms)`);

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Models] Failed to list models after ${duration}ms:`, error);

    return serverError(
      'Failed to retrieve models',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

