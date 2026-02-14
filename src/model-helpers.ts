/**
 * ============================================================================
 * MODEL HELPERS
 * ============================================================================
 *
 * Functions for resolving model names, listing available models, and model info
 */

import { textGenerationModels } from './models';
import { MODEL_ALIASES } from './constants';

// Global models cache
let globalModels: ModelType[] = [];

/**
 * List all available AI models from Cloudflare Workers AI
 * @param env Environment with AI binding
 * @returns Array of model types
 */
export async function listAIModels(env: Env): Promise<ModelType[]> {
  if (globalModels.length > 0) {
    return globalModels;
  }

  // Load models from static list
  globalModels = textGenerationModels;
  return globalModels;
}

/**
 * Resolve OpenAI model name to Cloudflare model name
 * Uses MODEL_ALIASES to map gpt-4 -> Qwen, etc.
 * @param modelName OpenAI-style model name or Cloudflare model name
 * @param env Environment with default model
 * @returns Cloudflare model name
 */
export function getCfModelName(modelName: string | undefined, env: Env): string {
  if (!modelName || modelName.trim() === '') {
    return env.DEFAULT_AI_MODEL || '@cf/qwen/qwen3-30b-a3b-fp8';
  }

  // Check if it's an alias
  if (MODEL_ALIASES[modelName]) {
    const resolved = MODEL_ALIASES[modelName];
    console.log(`[Model] Resolved alias ${modelName} → ${resolved}`);
    return resolved;
  }

  // Check if it's already a Cloudflare model name
  if (modelName.startsWith('@cf/') || modelName.startsWith('@hf/')) {
    return modelName;
  }

  // Default fallback
  console.log(`[Model] Unknown model ${modelName}, using default`);
  return env.DEFAULT_AI_MODEL || '@cf/qwen/qwen3-30b-a3b-fp8';
}

/**
 * Display detailed model information (for debugging)
 * @param env Environment
 * @param request Request object
 * @returns HTML response with model info
 */
export async function displayModelsInfo(env: Env, request: Request): Promise<Response> {
  const models = await listAIModels(env);

  let html = `
<!DOCTYPE html>
<html>
<head>
  <title>OpenAI-Cloudflare Proxy - Available Models</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .model { background: white; padding: 15px; margin: 10px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .model-id { color: #0066cc; font-weight: bold; font-size: 1.1em; }
    .model-desc { color: #666; margin-top: 5px; }
    .model-task { color: #888; font-size: 0.9em; font-style: italic; }
    .aliases { background: #fff3cd; padding: 10px; margin: 20px 0; border-radius: 5px; }
  </style>
</head>
<body>
  <h1>OpenAI-Cloudflare AI Proxy - Available Models</h1>
  <p>Total models: ${models.length}</p>

  <div class="aliases">
    <h2>Model Aliases (OpenAI → Cloudflare)</h2>
    <ul>
      ${Object.entries(MODEL_ALIASES).map(([alias, target]) => `
        <li><strong>${alias}</strong> → ${target}</li>
      `).join('')}
    </ul>
  </div>

  <h2>Available Models</h2>
  ${models.map(m => `
    <div class="model">
      <div class="model-id">${m.id || m.name}</div>
      <div class="model-task">${m.taskName} - ${m.object}</div>
      <div class="model-desc">${m.description || 'No description available'}</div>
    </div>
  `).join('')}
</body>
</html>
  `;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}

