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

    if (!models || models.length === 0) {
      console.warn('[Models] No models available');
      return serverError('No models available', 'Failed to retrieve model list');
    }

    // Transform to OpenAI-compatible format
    // Only include required fields: id and object
    const openaiModels: OpenAIModelListItem[] = models.map(m => ({
      id: m.id || m.name,
      object: "model" as const
    }));

    const response: OpenAIModelListResponse = {
      object: "list",
      data: openaiModels
    };

    const duration = Date.now() - startTime;
    console.log(`[Models] Returning ${openaiModels.length} models (took ${duration}ms)`);

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      }
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

