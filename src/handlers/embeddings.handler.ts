/**
 * ============================================================================
 * EMBEDDINGS HANDLER
 * ============================================================================
 *
 * Handles /v1/embeddings endpoint
 */

import { errorResponse } from '../errors';
import { getCfModelName, listAIModels } from '../model-helpers';
import { floatArrayToBase64 } from '../utils';

export async function handleEmbeddings(request: Request, env: Env): Promise<Response> {
  try {
    const data = await request.json() as OpenAiEmbeddingReq;
    const { model: requestedModel, input, encoding_format } = data;
    const model = getCfModelName(requestedModel, env);

    // Validation
    if (!model || !input) {
      return errorResponse("Model and input are required", 400);
    }

    // Check if valid embedding model
    const models = await listAIModels(env);
    const modelInfo = models.find(m =>
      m.name === model && m.taskName === 'Text Embeddings'
    );
    if (!modelInfo) {
      return errorResponse("Invalid embedding model", 400);
    }

    // Convert OpenAI-style input to Cloudflare's text format
    const texts = Array.isArray(input) ? input : [input];
    if (texts.some(t => typeof t !== 'string' || t.length === 0)) {
      return errorResponse("Invalid input format", 400);
    }

    // Create Cloudflare AI options
    const options: AiEmbeddingInputOptions = { text: texts };

    // Get embeddings from Cloudflare AI
    const aiRes = await env.AI.run(model, options);

    if (!('data' in aiRes) || !aiRes?.data || !Array.isArray(aiRes.data)) {
      return errorResponse("Failed to generate embeddings", 500);
    }

    // Convert to OpenAI format
    const embeddings: OpenAiEmbeddingObject[] = aiRes.data.map((vector, index) => ({
      object: 'embedding',
      index,
      embedding: encoding_format === 'base64'
        ? floatArrayToBase64(vector)
        : vector
    }));

    // Estimate token usage (approximate)
    const promptTokens = texts.join(' ').split(/\s+/).length;

    return new Response(JSON.stringify({
      object: 'list',
      data: embeddings,
      model: requestedModel, // Return the requested model name (e.g., text-embedding-ada-002)
      usage: {
        prompt_tokens: promptTokens,
        total_tokens: promptTokens
      }
    } as OpenAiEmbeddingRes), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return errorResponse("Embedding failed", 500, (error as Error).message);
  }
}

