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
import { AUTO_ROUTE_DEFAULTS, AUTO_ROUTE_MODEL_NAMES, AUTO_ROUTE_THRESHOLDS, MODEL_ALIASES } from './constants';
import type { Env, ModelType, OpenAiChatCompletionReq } from './types';

/** Hardcoded fallback used when neither an alias nor env.DEFAULT_AI_MODEL resolves. */
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
    console.log(`[Model] No model specified, using default: ${env.DEFAULT_AI_MODEL}`);
    return env.DEFAULT_AI_MODEL || FALLBACK_MODEL;
  }

  const trimmedName = modelName.trim();

  // Check for auto-route model names — without full request context we can only
  // return the cheap-tier default here.  The proper routing happens earlier in
  // transformChatCompletionRequest via resolveAutoRouteModel().
  if (AUTO_ROUTE_MODEL_NAMES.includes(trimmedName)) {
    const cheapModel = env.AUTO_ROUTE_CHEAP_MODEL || AUTO_ROUTE_DEFAULTS.cheap;
    console.log(`[Model] Auto-route model "${trimmedName}" (no request context) → cheap fallback: ${cheapModel}`);
    return cheapModel;
  }

  // Check if it's an OpenAI alias (gpt-4, gpt-3.5-turbo, etc.)
  if (MODEL_ALIASES[trimmedName]) {
    const resolved = MODEL_ALIASES[trimmedName];
    console.log(`[Model] Resolved alias "${trimmedName}" → "${resolved}"`);
    return resolved;
  }

  // Check if it's already a Cloudflare model identifier
  if (trimmedName.startsWith('@cf/') || trimmedName.startsWith('@hf/')) {
    console.log(`[Model] Using Cloudflare model: ${trimmedName}`);
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
 */

/**
 * Select the cheapest Cloudflare model that satisfies the given request's needs.
 *
 * Routing tiers (evaluated in order):
 *
 * 1. **Advanced** – selected when the request has tools AND the context is large,
 *    OR when the context is large even without tools.  Uses the most capable
 *    model so that complex reasoning and large histories are handled well.
 * 2. **Tool** – selected when tools are present but the context is modest.
 *    Uses a tool-capable model without paying for a large-context model.
 * 3. **Cheap** – the default for simple, tool-free conversational requests.
 *
 * All three model tiers can be overridden via environment variables:
 * `AUTO_ROUTE_CHEAP_MODEL`, `AUTO_ROUTE_TOOL_MODEL`, `AUTO_ROUTE_ADVANCED_MODEL`.
 *
 * @param request - Normalised OpenAI chat completion request (messages already set)
 * @param env     - Worker environment (for model overrides)
 * @returns Cloudflare Workers AI model identifier
 *
 * @example
 * // Simple request — no tools, short context
 * resolveAutoRouteModel({ messages: [{role:'user', content:'hi'}] }, env);
 * // → '@cf/meta/llama-3-8b-instruct'
 *
 * @example
 * // Request with tools
 * resolveAutoRouteModel({ messages: [...], tools: [{...}] }, env);
 * // → '@cf/qwen/qwen3-30b-a3b-fp8'
 */
export function resolveAutoRouteModel(request: OpenAiChatCompletionReq, env: Env): string {
  const hasTools = !!(request.tools && request.tools.length > 0);
  const messageCount = request.messages?.length ?? 0;
  const totalChars = request.messages?.reduce(
    (sum, msg) => sum + ((msg.content as string)?.length ?? 0),
    0
  ) ?? 0;
  const toolCount = request.tools?.length ?? 0;

  const isComplexContext =
    messageCount > AUTO_ROUTE_THRESHOLDS.advancedMessageCount ||
    totalChars    > AUTO_ROUTE_THRESHOLDS.advancedTotalChars;

  const isManyTools = toolCount > AUTO_ROUTE_THRESHOLDS.advancedToolCount;

  // Advanced tier: complex context, or many tools
  if (isComplexContext || isManyTools) {
    const advancedModel = env.AUTO_ROUTE_ADVANCED_MODEL || AUTO_ROUTE_DEFAULTS.advanced;
    console.log(
      `[AutoRoute] Advanced tier (tools=${hasTools}, toolCount=${toolCount}, msgs=${messageCount}, chars=${totalChars}) → ${advancedModel}`
    );
    return advancedModel;
  }

  // Tool tier: tools present, moderate context
  if (hasTools) {
    const toolModel = env.AUTO_ROUTE_TOOL_MODEL || AUTO_ROUTE_DEFAULTS.tool;
    console.log(`[AutoRoute] Tool tier (${toolCount} tools, msgs=${messageCount}) → ${toolModel}`);
    return toolModel;
  }

  // Cheap tier: simple conversational request
  const cheapModel = env.AUTO_ROUTE_CHEAP_MODEL || AUTO_ROUTE_DEFAULTS.cheap;
  console.log(`[AutoRoute] Cheap tier (msgs=${messageCount}, chars=${totalChars}) → ${cheapModel}`);
  return cheapModel;
}

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
    cheapest model that meets your request's needs — similar to
    <a href="https://docs.notdiamond.ai/docs/what-is-not-diamond" target="_blank">NotDiamond</a>.</p>
    <table>
      <thead><tr><th>Tier</th><th>When selected</th><th>Active model</th></tr></thead>
      <tbody>
        <tr>
          <td><strong>cheap</strong></td>
          <td>No tools, small context (&lt;${AUTO_ROUTE_THRESHOLDS.advancedMessageCount} msgs, &lt;${AUTO_ROUTE_THRESHOLDS.advancedTotalChars} chars)</td>
          <td>${env.AUTO_ROUTE_CHEAP_MODEL || AUTO_ROUTE_DEFAULTS.cheap}</td>
        </tr>
        <tr>
          <td><strong>tool</strong></td>
          <td>Tools requested, moderate context (&le;${AUTO_ROUTE_THRESHOLDS.advancedToolCount} tools)</td>
          <td>${env.AUTO_ROUTE_TOOL_MODEL || AUTO_ROUTE_DEFAULTS.tool}</td>
        </tr>
        <tr>
          <td><strong>advanced</strong></td>
          <td>Large context OR many tools (&gt;${AUTO_ROUTE_THRESHOLDS.advancedToolCount} tools, or &gt;${AUTO_ROUTE_THRESHOLDS.advancedMessageCount} msgs, or &gt;${AUTO_ROUTE_THRESHOLDS.advancedTotalChars} chars)</td>
          <td>${env.AUTO_ROUTE_ADVANCED_MODEL || AUTO_ROUTE_DEFAULTS.advanced}</td>
        </tr>
      </tbody>
    </table>
    <p><em>Override via env vars: <code>AUTO_ROUTE_CHEAP_MODEL</code>, <code>AUTO_ROUTE_TOOL_MODEL</code>, <code>AUTO_ROUTE_ADVANCED_MODEL</code>.</em></p>
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
