/**
 * ============================================================================
 * CONSTANTS AND CONFIGURATION
 * ============================================================================
 *
 * Model aliases, limits, and feature flags for the OpenAI to Cloudflare proxy
 */

// Version for deployment tracking
export const PROXY_VERSION = "1.9.30"; // Updated: 2026-02-14 - FIX: Use multipart/form-data for Cloudflare image generation API

// Models that support reasoning_content field (thinking/reasoning process)
// Standard models (gpt-4, gpt-4o, gpt-3.5-turbo) should NOT include reasoning_content
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

// Models that support tool calling in Cloudflare Workers AI
// NOTE: Llama models output tool calls as plain text JSON, not structured tool_calls
// NOTE: GPT-OSS does NOT support tools on Cloudflare Workers AI (platform limitation)
// NOTE: Mistral Small 3.1 claims to support tools but actually ignores them and generates text
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

// GPT-OSS models use a different input format (instructions + input instead of messages)
export const GPT_OSS_MODELS = [
  '@cf/openai/gpt-oss-20b',
  '@cf/openai/gpt-oss-120b',
];

// Model aliases for Onyx compatibility (maps OpenAI model names to CF models)
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

// Model-specific max_tokens limits
// Cloudflare models have different maximum token limits
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

