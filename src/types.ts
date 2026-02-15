/**
 * ============================================================================
 * TYPE DEFINITIONS
 * ============================================================================
 *
 * TypeScript interfaces and types for the OpenAI to Cloudflare Workers AI proxy.
 * These types ensure type safety across the application and provide clear contracts
 * for request/response handling, model configuration, and AI interactions.
 *
 * @module types
 */

/**
 * ============================================================================
 * ENVIRONMENT & BINDINGS
 * ============================================================================
 */

/**
 * Cloudflare Workers environment bindings.
 *
 * Defines the runtime environment available to the worker, including
 * AI binding, API keys, and KV storage.
 */
export interface Env {
  /** Cloudflare Workers AI binding for model inference */
  AI: {
    run: (model: Model, options: AiPromptInputOptions | AiMessagesInputOptions | AiEmbeddingInputOptions) => Promise<AiNormalResponse | AiEmbeddingResponse | AiStreamResponse>;
  };
  /** Optional API key for authentication (if not set, auth is disabled) */
  API_KEY?: string;
  /** Default AI model to use when none is specified */
  DEFAULT_AI_MODEL: string;
  /** KV namespace for caching */
  CACHE: KVNamespace;
  /** Cloudflare API key for direct API calls */
  CF_API_KEY: string | undefined;
  /** Cloudflare account ID */
  CF_ACCOUNT_ID: string | undefined;
}

/**
 * ============================================================================
 * AI REQUEST OPTIONS
 * ============================================================================
 */

/**
 * Base options for AI model inference requests.
 */
export interface AiBaseInputOptions {
  stream?: boolean;
  max_tokens?: number;
  temperature?: number | null | undefined;
  top_p?: number | null | undefined;
  top_k?: number | null | undefined;
  seed?: number;
  repetition_penalty?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

/**
 * Options for prompt-based AI requests (legacy format).
 */
export interface AiPromptInputOptions extends AiBaseInputOptions {
  prompt: string;
  raw?: boolean;
  lora?: string;
}

/**
 * Options for message-based AI requests (chat format).
 */
export interface AiMessagesInputOptions extends AiBaseInputOptions {
  messages: ChatMessage[];
  functions?: Array<{
    name: string;
    code: string;
  }>;
  tools?: Array<Tool | FunctionTool>;
}

export type ChatOptions = AiPromptInputOptions | AiMessagesInputOptions;

export interface AiChatRequestParts {
  model: Model;
  options: ChatOptions;
}

/**
 * Options for embedding generation requests.
 */
export interface AiEmbeddingInputOptions {
  text: string | string[];
}

export interface AiEmbeddingPropsParts {
  model: Model;
  options: AiEmbeddingInputOptions;
}

/**
 * ============================================================================
 * AI RESPONSE TYPES
 * ============================================================================
 */

/**
 * Token usage statistics for AI responses.
 */
export interface UsageStats {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Tool call structure returned by models that support function calling.
 */
export interface ToolCall {
  arguments: Record<string, any>;
  name: string;
}

/**
 * JSON response from Cloudflare AI inference.
 */
export interface AiJsonResponse {
  contentType: "application/json";
  response: string;
  usage: UsageStats;
  tool_calls?: ToolCall[];
  /** Thinking/reasoning output from models like Qwen, o1, etc. */
  reasoning_content?: string;
}

export type AiStreamResponse = ReadableStream<Uint8Array>;
export type AiNormalResponse = AiJsonResponse | AiStreamResponse;
export type AiEmbeddingResponse = { data: number[][]; shape: number[]; };

/**
 * ============================================================================
 * MODEL TYPES
 * ============================================================================
 */

/**
 * Model metadata structure.
 */
export interface ModelType {
  id: string;
  name: string;
  object: "model";
  description: string;
  taskName: CfModelTaskName;
  taskDescription: string;
  inUse: boolean;
}

export type Model = ModelType['id'];

/**
 * ============================================================================
 * OPENAI REQUEST/RESPONSE FORMATS
 * ============================================================================
 */

/**
 * Response format options for chat completions.
 */
export type ResponseFormat =
  | "auto"
  | { type: "text"; }
  | { type: "json_object"; }
  | { type: "json_schema"; json_schema: Record<string, any>; };

/**
 * Tool choice options for function calling.
 */
export type ToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { type: 'function'; function: { name: string; }; };

/**
 * Chat message role types.
 *
 * @remarks
 * OpenAI uses 'developer' role while Cloudflare uses 'system'.
 * The proxy handles translation between formats.
 */
export type ChatMessageRole = 'user' | 'assistant' | 'developer' | 'system' | 'tool';

/**
 * Chat message structure.
 */
export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
}

/**
 * Tool parameter property definition.
 */
export interface ToolParameterProps {
  type: string;
  description: string;
}

/**
 * Tool parameter structure.
 */
export interface ToolParameter {
  type: string;
  required?: string[];
  properties: Record<string, ToolParameterProps>;
}

/**
 * Function/tool definition.
 */
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter;
}

/**
 * Function tool wrapper (OpenAI format).
 */
export interface FunctionTool {
  type: "function";
  function: Tool;
}

/**
 * ============================================================================
 * CHAT COMPLETIONS API
 * ============================================================================
 */

/**
 * OpenAI Chat Completion request structure.
 *
 * @see {@link https://platform.openai.com/docs/api-reference/chat | OpenAI Chat API}
 */
export interface OpenAiChatCompletionReq {
  messages: ChatMessage[];
  model: Model;
  store?: boolean | null;
  reasoning_effort?: 'low' | 'medium' | 'high' | null;
  metadata?: Record<string, string>; // Key<=64 chars, Value<=512 chars
  frequency_penalty?: number | null; // Between -2.0 and 2.0
  logit_bias?: Record<number, number>; // Token ID to bias (-100 to 100)
  logprobs?: boolean | null;
  top_logprobs?: number | null; // 0-20 when logprobs=true
  /** @deprecated Use max_completion_tokens instead */
  max_tokens?: number | null;
  max_completion_tokens?: number | null;
  n?: number | null; // Default 1
  modalities?: ('text' | 'audio')[] | null;
  prediction?: Record<string, any>; // Prediction configuration
  audio?: Record<string, any> | null; // Audio output parameters
  presence_penalty?: number | null; // Between -2.0 and 2.0
  response_format?: ResponseFormat;
  seed?: number | null;
  service_tier?: 'auto' | 'default' | string | null;
  stop?: string | string[] | null; // Up to 4 sequences
  stream?: boolean | null;
  stream_options?: {
    include_usage?: boolean;
  } | null;
  temperature?: number | null; // 0-2, default 1
  top_p?: number | null; // 0-1, default 1
  tools?: Assistant['tools']; // Max 128 tools
  tool_choice?: ToolChoice;
  parallel_tool_calls?: boolean; // Default true
  user?: string; // End-user identifier
  /** @deprecated Use tool_choice instead */
  function_call?:
  | 'none'
  | 'auto'
  | { name: string; };
  /** @deprecated Use tools instead */
  functions?: Array<{
    name: string;
    description?: string;
    parameters: Record<string, any>;
  }>;
}

/**
 * ============================================================================
 * IMAGE GENERATION API
 * ============================================================================
 */

/**
 * OpenAI Image Generation request structure.
 */
export interface OpenAiImageGenerationReq {
  prompt: string;
  model: string;
  n?: number;  // Number of images (default: 1)
  size?: '256x256' | '512x512' | '1024x1024' | '1024x1792' | '1792x1024';  // Image size
  quality?: 'standard' | 'hd';  // Image quality
  style?: 'natural' | 'vivid';  // Image style
  response_format?: 'url' | 'b64_json';  // Response format
  user?: string;  // End-user identifier
}

export interface OpenAiImageObject {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

export interface OpenAiImageGenerationRes {
  created: number;
  data: OpenAiImageObject[];
  model: string;
}

/**
 * ============================================================================
 * EMBEDDINGS API
 * ============================================================================
 */

/**
 * OpenAI Embeddings request structure.
 */
export interface OpenAiEmbeddingReq {
  input: string | string[];
  model: string;
  encoding_format?: 'float' | 'base64';
  dimensions?: number;
  user?: string;
}

export interface OpenAiEmbeddingObject {
  object: 'embedding';
  index: number;
  embedding: number[] | string;
}

export interface OpenAiEmbeddingRes {
  object: 'list';
  data: OpenAiEmbeddingObject[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * ============================================================================
 * ASSISTANTS API
 * ============================================================================
 */

export interface ToolResources {
  code_interpreter?: {
    file_ids: string[];
  };
  file_search?: {
    vector_store_ids: string[];
  };
}

export interface CodeInterpreterTool {
  type: "code_interpreter";
}

export interface FileSearchTool {
  type: "file_search";
}

export type AssistantTool = FunctionTool | CodeInterpreterTool | FileSearchTool;

/**
 * Request interface for creating/updating an Assistant.
 */
export interface CreateAssistantRequest {
  model: Model;
  name?: string | null;
  description?: string | null;
  instructions?: string | null;
  reasoning_effort?: "low" | "medium" | "high" | null;
  tools?: AssistantTool[];
  tool_resources?: ToolResources | null;
  metadata?: Record<string, string>; // Keys <=64 chars, Values <=512 chars
  temperature?: number | null; // Between 0 and 2
  top_p?: number | null; // Between 0 and 1
  response_format?: ResponseFormat;
}

/**
 * Response interface for Assistant operations.
 */
export interface AssistantResponse {
  id: string;
  object: "assistant";
  created_at: number;
  name: string | null;
  description: string | null;
  model: Model;
  instructions: string | null;
  reasoning_effort?: "low" | "medium" | "high" | null;
  tools: AssistantTool[];
  tool_resources: ToolResources | null;
  metadata: Record<string, string>;
  temperature: number | null | undefined;
  top_p: number | null | undefined;
  response_format: ResponseFormat;
}

/**
 * Full Assistant interface.
 */
export interface Assistant extends AssistantResponse {
  // Inherits all properties from AssistantResponse
}

/**
 * ============================================================================
 * THREADS API
 * ============================================================================
 */

export interface Thread {
  id: string;
  object: "thread";
  created_at: number;
  metadata: Record<string, any>;
  tool_resources: Record<string, any>;
}

export interface ThreadRunRequest {
  assistant_id: string;
  status: string;
  model: Model;
  stream: boolean;
  instructions: string | null;
  tools: Array<{
    type: "code_interpreter" | "file_search" | "function";
    [key: string]: any;
  }>;
  tool_resources: ToolResources | null;
  tool_choice?: ToolChoice;
  metadata: Record<string, any>;
  top_p: number | null;
  temperature: number | null;
  parallel_tool_calls: boolean;
  max_prompt_tokens: number | null;
  max_completion_tokens: number | null;
  truncation_strategy: {
    type: "auto" | "first" | "last";
    last_messages: number;
  };
}

export interface ThreadRunResponse extends ThreadRunRequest {
  id: string;
  object: "thread.run";
  created_at: number;
  thread_id: string;
  status: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
}

export interface ThreadRun extends ThreadRunResponse {
  // Inherits all properties from ThreadRunResponse
}

/**
 * ============================================================================
 * CLOUDFLARE API TYPES
 * ============================================================================
 */

export type CfModelTaskName =
  | "Text Generation"
  | "Text Classification"
  | "Object Detection"
  | "Automatic Speech Recognition"
  | "Image-to-Text"
  | "Image Classification"
  | "Image Generation"
  | "Translation"
  | "Text Embeddings"
  | "Summarization";

export interface CfModelTask {
  id: string;
  name: CfModelTaskName;
  description: string;
}

export interface CfModel {
  id: string;
  name: string;
  source: string;
  description: string;
  task: CfModelTask;
}

export interface FetchModelsResponse {
  success: boolean;
  result: CfModel[];
  errors?: any[];
  messages?: any[];
  result_info?: any;
}
