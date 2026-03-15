/**
 * ============================================================================
 * MODEL HELPERS
 * ============================================================================
 *
 * Functions for resolving model names, listing available models, and providing
 * model information. Handles translation between OpenAI model names and
 * Cloudflare Workers AI model identifiers.
 *
 * @module model-helpers
 */

import { textGenerationModels } from './models';
import { AUTO_ROUTE_DEFAULTS, AUTO_ROUTE_MODEL_NAMES, AUTO_ROUTE_SCORE_THRESHOLDS, AUTO_ROUTE_THRESHOLDS, MODEL_ALIASES } from './constants';
import { pickFromPool } from './auto-router';
import type { Env, ModelType, OpenAiChatCompletionReq } from './types';



const FALLBACK_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

/**
 * ============================================================================
 * MODEL LISTING
 * ============================================================================
 */

/**
 * List all available AI models from Cloudflare Workers AI.
 * The env parameter is accepted but unused — the list is static and in-memory.
 */
export async function listAIModels(_env?: Env): Promise<ModelType[]> {
  // Return static list - no need for caching as it's already in memory
  return textGenerationModels as unknown as ModelType[];
}

/**
 * ============================================================================
 * MODEL RESOLUTION
 * ============================================================================
 */

/**
 * Resolve OpenAI model name to Cloudflare Workers AI model identifier.
 *
 * This function enables OpenAI API compatibility by translating OpenAI model names
 * (like "gpt-4") to Cloudflare Workers AI model identifiers (like "@cf/qwen/qwen3-30b-a3b-fp8").
 *
 * Resolution cascade:
 * 1. Check MODEL_ALIASES for OpenAI model name mappings
 * 2. Check if already a Cloudflare model identifier (@cf/ or @hf/ prefix)
 * 3. Fall back to DEFAULT_AI_MODEL from environment
 *
 * @param modelName - OpenAI-style model name (e.g., "gpt-4") or Cloudflare model ID
 * @param env - Environment with DEFAULT_AI_MODEL fallback
 * @returns Cloudflare Workers AI model identifier
 *
 * @example
 * // Alias resolution
 * getCfModelName('gpt-4', env);
 * // Returns: '@cf/qwen/qwen3-30b-a3b-fp8'
 *
 * @example
 * // Already a Cloudflare model
 * getCfModelName('@cf/meta/llama-3-8b-instruct', env);
 * // Returns: '@cf/meta/llama-3-8b-instruct'
 *
 * @example
 * // Fallback to default
 * getCfModelName('unknown-model', env);
 * // Returns: env.DEFAULT_AI_MODEL
 *
 * @see {@link MODEL_ALIASES} - Model alias mappings
 */
export function getCfModelName(modelName: string | undefined, env: Env): string {
  // Handle empty or missing model name
  if (!modelName || modelName.trim() === '') {
    return env.DEFAULT_AI_MODEL || FALLBACK_MODEL;
  }

  const trimmedName = modelName.trim();

  // Check for auto-route model names — without full request context we can only
  // return the cheap-tier default here.  The proper routing happens earlier in
  // transformChatCompletionRequest via resolveAutoRouteModel().
  if (AUTO_ROUTE_MODEL_NAMES.includes(trimmedName)) {
    return pickFromPool(env.AUTO_ROUTE_CHEAP_MODELS, AUTO_ROUTE_DEFAULTS.cheap);
  }

  // Check if it's an OpenAI alias (gpt-4, gpt-3.5-turbo, etc.)
  if (MODEL_ALIASES[trimmedName]) {
    const resolved = MODEL_ALIASES[trimmedName];
    console.log(`[Model] Resolved alias "${trimmedName}" → "${resolved}"`);
    return resolved;
  }

  // Check if it's already a Cloudflare model identifier
  if (trimmedName.startsWith('@cf/') || trimmedName.startsWith('@hf/')) {
    return trimmedName;
  }

  // Unknown model - fall back to default with warning
  const fallback = env.DEFAULT_AI_MODEL || FALLBACK_MODEL;
  console.warn(`[Model] Unknown model "${trimmedName}", falling back to default: ${fallback}`);
  return fallback;
}

/**
 * ============================================================================
 * AUTO-ROUTE MODEL RESOLUTION
 * ============================================================================
 * Routing logic lives in src/auto-router.ts and is re-exported here for
 * backward compatibility with existing imports.
 */
export { resolveAutoRouteModel } from './auto-router';

/**
 * ============================================================================
 * MODEL VALIDATION
 * ============================================================================
 */

/**
 * Check if a model name is a recognized OpenAI alias.
 *
 * @param modelName - Model name to check
 * @returns True if the model is an OpenAI alias
 *
 * @example
 * isAliasedModel('gpt-4'); // Returns: true
 * isAliasedModel('@cf/qwen/qwen3-30b-a3b-fp8'); // Returns: false
 */
export function isAliasedModel(modelName: string): boolean {
  return modelName in MODEL_ALIASES;
}

/**
 * Check if a model name is a Cloudflare model identifier.
 *
 * @param modelName - Model name to check
 * @returns True if the model is a Cloudflare identifier
 *
 * @example
 * isCloudflareModel('@cf/qwen/qwen3-30b-a3b-fp8'); // Returns: true
 * isCloudflareModel('gpt-4'); // Returns: false
 */
export function isCloudflareModel(modelName: string): boolean {
  return modelName.startsWith('@cf/') || modelName.startsWith('@hf/');
}

/**
 * ============================================================================
 * MODEL INFORMATION DISPLAY
 * ============================================================================
 */

/**
 * Display detailed model information as HTML (for debugging/documentation).
 *
 * Generates an HTML page showing all available models and their aliases.
 * This is useful for debugging and understanding which models are available.
 *
 * @param env - Environment with model configuration
 * @param request - HTTP request object (unused, kept for compatibility)
 * @returns HTML response with model information
 *
 * @example
 * // In handler:
 * if (url.pathname === '/models/search') {
 *   return displayModelsInfo(env, request);
 * }
 *
 * @remarks
 * This function mixes presentation logic with model helpers.
 * Consider extracting to a separate views/templates module in the future.
 */
export async function displayModelsInfo(env: Env, request: Request): Promise<Response> {
  const models = await listAIModels(env);

  const html = `
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
    .stats { background: #d1ecf1; padding: 10px; margin: 20px 0; border-radius: 5px; }
    .autoroute { background: #d4edda; padding: 10px; margin: 20px 0; border-radius: 5px; }
  </style>
</head>
<body>
  <h1>OpenAI-Cloudflare AI Proxy - Available Models</h1>

  <div class="stats">
    <h2>Statistics</h2>
    <ul>
      <li><strong>Total models:</strong> ${models.length}</li>
      <li><strong>OpenAI aliases:</strong> ${Object.keys(MODEL_ALIASES).length}</li>
      <li><strong>Default model:</strong> ${env.DEFAULT_AI_MODEL || FALLBACK_MODEL}</li>
    </ul>
  </div>

  <div class="autoroute">
    <h2>Auto-Route Model (<code>auto</code> / <code>auto/route</code>)</h2>
    <p>Request model <strong>auto</strong> or <strong>auto/route</strong> to let the proxy pick the
    cheapest model that meets your request's needs using a multi-signal scoring system inspired by
    <a href="https://docs.notdiamond.ai/docs/what-is-not-diamond" target="_blank">NotDiamond</a>.</p>
    <p>Signals scored: tool count, context size, task type (coding / reasoning), active agentic loop
    (tool-role messages in history), structured JSON output, and system prompt complexity.
    Score &lt; ${AUTO_ROUTE_SCORE_THRESHOLDS.tool} → <strong>cheap</strong> &nbsp;|&nbsp;
    ${AUTO_ROUTE_SCORE_THRESHOLDS.tool}–${AUTO_ROUTE_SCORE_THRESHOLDS.advanced - 1} → <strong>tool</strong> &nbsp;|&nbsp;
    ≥ ${AUTO_ROUTE_SCORE_THRESHOLDS.advanced} → <strong>advanced</strong></p>
    <table>
      <thead><tr><th>Tier</th><th>When selected</th><th>Active model pool</th></tr></thead>
      <tbody>
        <tr>
          <td><strong>cheap</strong></td>
          <td>Score &lt; ${AUTO_ROUTE_SCORE_THRESHOLDS.tool} — simple chat, no tools, small context</td>
          <td>${env.AUTO_ROUTE_CHEAP_MODELS || AUTO_ROUTE_DEFAULTS.cheap.join(', ')}</td>
        </tr>
        <tr>
          <td><strong>tool</strong></td>
          <td>Score ${AUTO_ROUTE_SCORE_THRESHOLDS.tool}–${AUTO_ROUTE_SCORE_THRESHOLDS.advanced - 1} — tools, code content, structured output, or reasoning</td>
          <td>${env.AUTO_ROUTE_TOOL_MODELS || AUTO_ROUTE_DEFAULTS.tool.join(', ')}</td>
        </tr>
        <tr>
          <td><strong>advanced</strong></td>
          <td>Score ≥ ${AUTO_ROUTE_SCORE_THRESHOLDS.advanced} — large context, many tools, active agentic loop, or combined signals</td>
          <td>${env.AUTO_ROUTE_ADVANCED_MODELS || AUTO_ROUTE_DEFAULTS.advanced.join(', ')}</td>
        </tr>
      </tbody>
    </table>
    <p><em>Override via env vars: <code>AUTO_ROUTE_CHEAP_MODELS</code>, <code>AUTO_ROUTE_TOOL_MODELS</code>, <code>AUTO_ROUTE_ADVANCED_MODELS</code>.</em></p>
  </div>

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
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
