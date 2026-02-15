/**
 * ============================================================================
 * CONSTANTS AND CONFIGURATION
 * ============================================================================
 *
 * Central configuration for the OpenAI to Cloudflare Workers AI proxy service.
 * This file defines model aliases, capabilities, limits, and feature flags.
 *
 * @module constants
 */

/**
 * ============================================================================
 * VERSION INFORMATION
 * ============================================================================
 */

/**
 * Proxy service version for deployment tracking and logging.
 *
 * Update this when making significant changes to the proxy behavior.
 * Format: MAJOR.MINOR.PATCH
 *
 * @constant
 * @example
 * console.log(`Starting proxy v${PROXY_VERSION}`);
 */
export const PROXY_VERSION = "2.1.0"; // Updated: 2026-02-15 - FIX: Responses API streaming format (created_at field, output array)

/**
 * ============================================================================
 * MODEL CAPABILITIES
 * ============================================================================
 */

/**
 * Models that support reasoning_content field (thinking/reasoning process).
 *
 * These models can include a separate reasoning_content field in their responses
 * to show their thought process before generating the final answer.
 *
 * NOTE: Standard models (gpt-4, gpt-4o, gpt-3.5-turbo) should NOT include reasoning_content
 *
 * @constant
 * @see {@link https://platform.openai.com/docs/guides/reasoning | OpenAI Reasoning Models}
 */
export const REASONING_MODELS = [
  'o1-preview',
  'o1-mini',
  'o3-mini',
  'o1',
  'o3',
  'gpt-5',  // gpt-5 alias maps to GLM-4.7-flash with reasoning support
  'glm-4',  // GLM-4.7-flash supports reasoning_content
  'qwen'    // Qwen models support reasoning_content
];

/**
 * Models that support function/tool calling in Cloudflare Workers AI.
 *
 * These models can handle structured function calls and return tool_calls objects.
 *
 * IMPORTANT NOTES:
 * - Llama models output tool calls as plain text JSON, not structured tool_calls
 * - GPT-OSS does NOT support tools on Cloudflare Workers AI (platform limitation)
 * - Mistral Small 3.1 claims support but actually ignores tools and generates text
 *
 * @constant
 * @see {@link https://developers.cloudflare.com/workers-ai/function-calling/ | Cloudflare Function Calling}
 */
export const TOOL_CAPABLE_MODELS = [
  // Llama models removed - they output JSON text instead of proper tool_calls structure
  // '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  // '@cf/meta/llama-3-70b-instruct',
  '@hf/nousresearch/hermes-2-pro-mistral-7b',
  // ❌ GPT-OSS REMOVED - Cloudflare Workers AI does NOT support tools for GPT-OSS
  // '@cf/openai/gpt-oss-20b',
  // '@cf/openai/gpt-oss-120b',
  // Mistral Small 3.1 removed - returns empty tool_calls array even when tools are sent
  // '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/qwen/qwen3-30b-a3b-fp8',  // ✅ Qwen properly supports function calling
  '@cf/zai-org/glm-4.7-flash',  // ✅ GLM-4 supports function calling
];

/**
 * GPT-OSS models that use a different input format.
 *
 * These models require instructions + input format instead of the standard messages array.
 * They are part of OpenAI's GPT-OSS initiative on Cloudflare.
 *
 * @constant
 */
export const GPT_OSS_MODELS = [
  '@cf/openai/gpt-oss-20b',
  '@cf/openai/gpt-oss-120b',
];

/**
 * ============================================================================
 * MODEL ROUTING
 * ============================================================================
 */

/**
 * Model aliases for OpenAI API compatibility.
 *
 * Maps OpenAI model names (e.g., "gpt-4") to Cloudflare Workers AI model identifiers.
 * This allows clients using OpenAI SDKs to work seamlessly with Cloudflare models.
 *
 * Strategy:
 * - GPT-4 variants → Qwen (best tool calling support)
 * - GPT-3.5 variants → Llama 3 8B (fast, efficient)
 * - GPT-5 → GLM-4.7-Flash (reasoning + tools)
 * - Image models → Flux (Cloudflare's image generation)
 * - Embeddings → BGE models (optimized for embeddings)
 *
 * @constant
 * @example
 * const cfModel = MODEL_ALIASES['gpt-4']; // Returns: '@cf/qwen/qwen3-30b-a3b-fp8'
 */
export const MODEL_ALIASES: Record<string, string> = {
  // Use Qwen for GPT-4 aliases since it properly supports function calling
  'gpt-4': '@cf/qwen/qwen3-30b-a3b-fp8',
  'gpt-4-turbo': '@cf/qwen/qwen3-30b-a3b-fp8',
  'gpt-4o': '@cf/qwen/qwen3-30b-a3b-fp8',
  'gpt-4o-mini': '@cf/meta/llama-3-8b-instruct',  // Smaller model for simple tasks
  'gpt-5': '@cf/zai-org/glm-4.7-flash',  // ✅ GLM-4.7-Flash with reasoning and tool calling
  'gpt-3.5-turbo': '@cf/meta/llama-3-8b-instruct',
  'gpt-3.5-turbo-16k': '@cf/meta/llama-3-8b-instruct',
  'mistral-small': '@cf/mistralai/mistral-small-3.1-24b-instruct',  // ✅ NEW: Mistral Small with 128K context
  'mistral': '@cf/mistralai/mistral-small-3.1-24b-instruct',  // Alias for mistral-small
  'glm-4-flash': '@cf/zai-org/glm-4.7-flash',  // ✅ GLM-4 Flash alias
  'glm-4.7-flash': '@cf/zai-org/glm-4.7-flash',  // ✅ GLM-4.7 Flash alias
  'gpt-image-1': '@cf/black-forest-labs/flux-2-klein-9b',  // ✅ NEW: Maps OpenAI image model to Flux
  'dall-e-3': '@cf/black-forest-labs/flux-2-klein-9b',  // Alternative alias for image generation
  'dall-e-2': '@cf/black-forest-labs/flux-2-klein-9b',  // Alternative alias for image generation
  'text-embedding-ada-002': '@cf/baai/bge-base-en-v1.5',
  'text-embedding-3-small': '@cf/baai/bge-base-en-v1.5',
  'text-embedding-3-large': '@cf/baai/bge-large-en-v1.5',
};

/**
 * ============================================================================
 * MODEL LIMITS
 * ============================================================================
 */

/**
 * Model-specific max_tokens limits.
 *
 * Defines the maximum number of tokens each model can generate in a single request.
 * Exceeding these limits will cause API errors from Cloudflare Workers AI.
 *
 * @constant
 * @example
 * const limit = MODEL_MAX_TOKENS['@cf/qwen/qwen3-30b-a3b-fp8']; // Returns: 4096
 *
 * @see {@link https://developers.cloudflare.com/workers-ai/models/ | Cloudflare AI Models}
 */
export const MODEL_MAX_TOKENS: Record<string, number> = {
  // Hermes 2 Pro has a strict 1024 token limit
  '@hf/nousresearch/hermes-2-pro-mistral-7b': 1024,
  // Qwen3 can handle up to 4096
  '@cf/qwen/qwen3-30b-a3b-fp8': 4096,
  // GLM-4.7-Flash can handle up to 131,072
  '@cf/zai-org/glm-4.7-flash': 131072,
  // Llama 3.3 can handle up to 4096
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': 4096,
  '@cf/meta/llama-3-70b-instruct': 4096,
  '@cf/meta/llama-3-8b-instruct': 4096,
  // Mistral Small 3.1 can handle more
  '@cf/mistralai/mistral-small-3.1-24b-instruct': 4096,
  // GPT-OSS models
  '@cf/openai/gpt-oss-20b': 4096,
  '@cf/openai/gpt-oss-120b': 4096,
  // Flux image generation
  '@cf/black-forest-labs/flux-2-klein-9b': 512,  // For image generation, max_tokens isn't used the same way
  '@cf/black-forest-labs/flux-2-dev': 512,  // Alternative Flux model
  '@cf/black-forest-labs/flux-2-klein-4b': 512,  // Smaller Flux model
};

