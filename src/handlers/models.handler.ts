/**
 * ============================================================================
 * MODELS HANDLER
 * ============================================================================
 *
 * Handles /v1/models endpoint
 */

import { listAIModels } from '../model-helpers';

export async function handleListModels(env: Env): Promise<Response> {
  const models = await listAIModels(env);

  // Return OpenAI-compatible model list with minimal fields per specification
  // Onyx expects: id, object
  const openaiModels = models.map(m => ({
    id: m.id || m.name,
    object: "model"
  }));

  return new Response(JSON.stringify({
    object: "list",
    data: openaiModels
  }), { headers: { 'Content-Type': 'application/json' } });
}

