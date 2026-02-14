
interface Env {
  AI: {
    run: (model: Model, options: AiPromptInputOptions | AiMessagesInputOptions | AiEmbeddingInputOptions) => Promise<AiNormalResponse | AiEmbeddingResponse | AiStreamResponse>;
  };
  API_KEY?: string;  // Optional - if set, authentication is required
  DEFAULT_AI_MODEL: string;
  CACHE: KVNamespace;
  CF_API_KEY: string | undefined;
  CF_ACCOUNT_ID: string | undefined;
}

/**
 * AI Request
 */
interface AiBaseInputOptions {
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

interface AiPromptInputOptions extends AiBaseInputOptions {
  prompt: string;
  raw?: boolean;
  lora?: string;
}

interface AiMessagesInputOptions extends AiBaseInputOptions {
  messages: ChatMessage[];
  functions?: Array<{
    name: string;
    code: string;
  }>;
  tools?: Array<Tool | FunctionTool>;
}


type ChatOptions = AiPromptInputOptions | AiMessagesInputOptions;

interface AiChatRequestParts {
  model: Model, options: ChatOptions;
}

interface AiEmbeddingInputOptions {
  text: string | string[];
}

interface AiEmbeddingPropsParts {
  model: Model, options: AiEmbeddingInputOptions;
}

/**
 * AI Response
 */
interface UsageStats {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface ToolCall {
  arguments: Record<string, any>;
  name: string;
}

interface AiJsonResponse {
  contentType: "application/json";
  response: string;
  usage: UsageStats;
  tool_calls?: ToolCall[];
  reasoning_content?: string; // Thinking/reasoning output from models like Qwen
}

type AiStreamResponse = ReadableStream<Uint8Array>;
type AiNormalResponse = AiJsonResponse | AiStreamResponse;
type AiEmbeddingResponse = { data: number[][]; shape: number[]; };

/**
 * Models
 */
interface ModelType {
  id: string,
  name: string,
  object: "model",
  description: string,
  taskName: CfModelTaskName,
  taskDescription: string;
  inUse: boolean;
};
type Model = ModelType['id'];

/**
 * OpenAI/WorkerAi Common
 */
type ResponseFormat =
  | "auto"
  | { type: "text"; }
  | { type: "json_object"; }
  | { type: "json_schema"; json_schema: Record<string, any>; };

type ToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { type: 'function'; function: { name: string; }; };


// https://platform.openai.com/docs/guides/text-generation
// OpenAi: 'system' become 'developer'...
// Cloudflare: The role of the message sender (e.g., 'user', 'assistant', 'system', 'tool').
type ChatMessageRole = 'user' | 'assistant' | 'developer' | 'system' | 'tool';
interface ChatMessage {
  role: ChatMessageRole;
  content: string;
}

interface ToolParameterProps {
  type: string;
  description: string;
}

interface ToolParameter {
  type: string;
  required?: string[];
  properties: Record<string, ToolParameterProps>;
}

interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter;
}

interface FunctionTool {
  type: "function";
  function: Tool;
}

/**
 * ChatCompletions Request
 */
interface OpenAiChatCompletionReq {
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
 * Image Generation
 */
interface OpenAiImageGenerationReq {
  prompt: string;
  model: string;
  n?: number;  // Number of images (default: 1)
  size?: '256x256' | '512x512' | '1024x1024' | '1024x1792' | '1792x1024';  // Image size
  quality?: 'standard' | 'hd';  // Image quality
  style?: 'natural' | 'vivid';  // Image style
  response_format?: 'url' | 'b64_json';  // Response format
  user?: string;  // End-user identifier
}

interface OpenAiImageObject {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

interface OpenAiImageGenerationRes {
  created: number;
  data: OpenAiImageObject[];
  model: string;
}

/**
 * Embeddings
 */
interface OpenAiEmbeddingReq {
  input: string | string[];
  model: string;
  encoding_format?: 'float' | 'base64';
  dimensions?: number;
  user?: string;
}

interface OpenAiEmbeddingObject {
  object: 'embedding';
  index: number;
  embedding: number[] | string;
}

interface OpenAiEmbeddingRes {
  object: 'list';
  data: OpenAiEmbeddingObject[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Assistant
 */
interface ToolResources {
  code_interpreter?: {
    file_ids: string[];
  };
  file_search?: {
    vector_store_ids: string[];
  };
}

interface CodeInterpreterTool {
  type: "code_interpreter";
}

interface FileSearchTool {
  type: "file_search";
}

type AssistantTool = FunctionTool | CodeInterpreterTool | FileSearchTool;

// Request Interface for creating/updating an Assistant
interface CreateAssistantRequest {
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

// Response Interface for Assistant operations
interface AssistantResponse {
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

// Full Assistant interface (can be used for type casting)
interface Assistant extends AssistantResponse {
  // Inherits all properties from AssistantResponse
}

/**
 * Thread
 */
interface Thread {
  id: string;
  object: "thread";
  created_at: number;
  metadata: Record<string, any>;
  tool_resources: Record<string, any>;
}

interface ThreadRunRequest {
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

interface ThreadRunResponse extends ThreadRunRequest {
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

interface ThreadRun extends ThreadRunResponse {
  // Inherits all properties from ThreadRunResponse
}

/**
 * Cloudflare API Fetch
 */
type CfModelTaskName =
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


interface CfModelTask {
  id: string;
  name: CfModelTaskName;
  description: string;
}

interface CfModel {
  id: string;
  name: string;
  source: string;
  description: string;
  task: CfModelTask;
}
interface FetchModelsResponse {
  success: boolean;
  result: CfModel[];
  errors?: any[];
  messages?: any[];
  result_info?: any;
}
