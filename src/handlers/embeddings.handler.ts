/**
 * ============================================================================
 * EMBEDDINGS HANDLER
 * ============================================================================
 *
 * Handles the POST /v1/embeddings endpoint for generating text embeddings.
 * Converts OpenAI embedding requests to Cloudflare Workers AI format and
 * returns embeddings in OpenAI-compatible format.
 *
 * @module handlers/embeddings
 */

import { errorResponse, validationError, serverError } from '../errors';
import { getCfModelName, listAIModels } from '../model-helpers';
import { floatArrayToBase64 } from '../utils';
import type { Env, OpenAiEmbeddingReq, OpenAiEmbeddingObject, OpenAiEmbeddingRes, AiEmbeddingInputOptions } from '../types';

/**
 * ============================================================================
 * HANDLER
 * ============================================================================
 */

/**
 * Handle POST /v1/embeddings request.
 *
 * Generates embeddings for the provided text input using Cloudflare Workers AI.
 * Supports both single string and array inputs, with optional base64 encoding.
 *
 * @param request - HTTP request with embedding request body
 * @param env - Cloudflare Workers environment with AI binding
 * @returns OpenAI-compatible JSON response with embeddings
 *
 * @example
 * // Request:
 * {
 *   "model": "text-embedding-ada-002",
 *   "input": "Hello world",
 *   "encoding_format": "float"
 * }
 *
 * // Response:
 * {
 *   "object": "list",
 *   "data": [
 *     { "object": "embedding", "index": 0, "embedding": [0.1, 0.2, ...] }
 *   ],
 *   "model": "text-embedding-ada-002",
 *   "usage": { "prompt_tokens": 2, "total_tokens": 2 }
 * }
 *
 * @see {@link https://platform.openai.com/docs/api-reference/embeddings | OpenAI Embeddings API}
 */
export async function handleEmbeddings(request: Request, env: Env): Promise<Response> {
  const startTime = Date.now();
  console.log('[Embeddings] Processing embedding request...');

  try {
    // Parse request body
    const data = await request.json() as OpenAiEmbeddingReq;
    const { model: requestedModel, input, encoding_format } = data;

    // Validate required fields
    if (!input) {
      return validationError('Input is required', 'input');
    }

    if (!requestedModel) {
      return validationError('Model is required', 'model');
    }

    // Resolve model name (e.g., text-embedding-ada-002 -> @cf/baai/bge-base-en-v1.5)
    const model = getCfModelName(requestedModel, env);
    console.log(`[Embeddings] Using model: ${model} (requested: ${requestedModel})`);

    // Validate model is an embedding model
    const models = await listAIModels(env);
    const modelInfo = models.find(m =>
      (m.id === model || m.name === model) && m.taskName === 'Text Embeddings'
    );

    if (!modelInfo) {
      return validationError(
        `Model "${requestedModel}" is not a valid embedding model. Use text-embedding-ada-002, text-embedding-3-small, or text-embedding-3-large.`,
        'model'
      );
    }

    // Convert input to array of strings
    const texts = Array.isArray(input) ? input : [input];

    // Validate input format
    if (texts.length === 0) {
      return validationError('Input array cannot be empty', 'input');
    }

    if (texts.some(t => typeof t !== 'string' || t.trim().length === 0)) {
      return validationError('All input values must be non-empty strings', 'input');
    }

    console.log(`[Embeddings] Generating embeddings for ${texts.length} text(s)`);

    // Create Cloudflare AI options
    const options: AiEmbeddingInputOptions = { text: texts };

    // Generate embeddings using Cloudflare Workers AI
    const aiRes = await env.AI.run(model, options);

    // Validate response
    if (!aiRes || !('data' in aiRes) || !Array.isArray(aiRes.data)) {
      console.error('[Embeddings] Invalid response from AI:', aiRes);
      return serverError('Failed to generate embeddings', 'Invalid response format from AI model');
    }

    if (aiRes.data.length !== texts.length) {
      console.error(`[Embeddings] Response count mismatch: expected ${texts.length}, got ${aiRes.data.length}`);
      return serverError('Embedding generation failed', 'Response count does not match input count');
    }

    // Convert to OpenAI format
    const embeddings: OpenAiEmbeddingObject[] = aiRes.data.map((vector, index) => {
      // Handle encoding format
      const embedding = encoding_format === 'base64'
        ? floatArrayToBase64(vector)
        : vector;

      return {
        object: 'embedding' as const,
        index,
        embedding
      };
    });

    // Estimate token usage (rough approximation based on word count)
    const promptTokens = texts.reduce((total, text) => {
      return total + Math.ceil(text.split(/\s+/).length * 1.3); // ~1.3 tokens per word
    }, 0);

    const response: OpenAiEmbeddingRes = {
      object: 'list',
      data: embeddings,
      model: requestedModel, // Return the requested model name (e.g., text-embedding-ada-002)
      usage: {
        prompt_tokens: promptTokens,
        total_tokens: promptTokens
      }
    };

    const duration = Date.now() - startTime;
    console.log(`[Embeddings] Generated ${embeddings.length} embedding(s) in ${duration}ms`);

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Embeddings] Failed after ${duration}ms:`, error);

    return serverError(
      'Embedding generation failed',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

