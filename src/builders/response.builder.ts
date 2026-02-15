/**
 * ============================================================================
 * RESPONSE BUILDERS
 * ============================================================================
 *
 * Builds properly formatted responses for different OpenAI API formats:
 * - OpenAI Chat Completions format
 * - OpenAI Responses API format
 *
 * These builders ensure responses comply with OpenAI API specifications
 * and handle edge cases like empty content, tool calls, and reasoning models.
 *
 * @module builders/response
 */

import { REASONING_MODELS } from '../constants';
import { generateUUID } from '../utils';
import type { UsageStats } from '../types';

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

/** Default content when message content is empty */
const EMPTY_CONTENT_FALLBACK = " ";

/** OpenAI object types */
const OBJECT_TYPE_CHAT_COMPLETION = "chat.completion";
const OBJECT_TYPE_RESPONSE = "response";

/** Message roles */
const ROLE_ASSISTANT = "assistant";

/** Finish reasons */
const FINISH_REASON_STOP = "stop";
const FINISH_REASON_TOOL_CALLS = "tool_calls";

/** Tool and content types */
const TYPE_FUNCTION = "function";
const TYPE_MESSAGE = "message";
const TYPE_FUNCTION_CALL = "function_call";
const TYPE_OUTPUT_TEXT = "output_text";
const TYPE_TEXT = "text";

/** Status values */
const STATUS_COMPLETED = "completed";

/**
 * ============================================================================
 * HELPER FUNCTIONS
 * ============================================================================
 */

/**
 * Ensure content is never null or empty.
 * Returns a space character as fallback if content is missing.
 */
function ensureValidContent(content: string | null | undefined): string {
  if (!content || content.trim().length === 0) {
    console.log("[Builder] Empty content detected, using fallback space character");
    return EMPTY_CONTENT_FALLBACK;
  }
  return content;
}

/**
 * Transform Cloudflare tool_calls format to OpenAI format.
 */
function transformToolCalls(toolCalls?: any[]): any[] | undefined {
  if (!toolCalls || toolCalls.length === 0) {
    return undefined;
  }

  console.log("[Builder] Transforming tool_calls to OpenAI format");
  return toolCalls.map((tc) => ({
    id: `call_${generateUUID()}`,
    type: TYPE_FUNCTION,
    function: {
      name: tc.name,
      arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
    }
  }));
}

/**
 * Check if model supports reasoning content field.
 */
function isReasoningModel(model: string): boolean {
  return REASONING_MODELS.some(rm => model.toLowerCase().includes(rm.toLowerCase()));
}

/**
 * ============================================================================
 * RESPONSE BUILDERS
 * ============================================================================
 */

/**
 * Build OpenAI Chat Completions format response.
 *
 * Creates a response object that conforms to the OpenAI Chat Completions API
 * specification. Handles tool calls, reasoning content, and usage statistics.
 *
 * @param text - The assistant's response text
 * @param model - Model identifier (e.g., "gpt-4", "@cf/qwen/qwen3-30b-a3b-fp8")
 * @param toolCalls - Optional array of tool calls from the model
 * @param reasoningContent - Optional reasoning/thinking content (for o1, o3, etc.)
 * @param usage - Optional token usage statistics
 * @returns OpenAI Chat Completion response object
 *
 * @example
 * const response = buildOpenAIChatResponse(
 *   "The weather is sunny.",
 *   "gpt-4",
 *   undefined,
 *   undefined,
 *   { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
 * );
 *
 * @see {@link https://platform.openai.com/docs/api-reference/chat/object | OpenAI Chat Completion Object}
 */
export function buildOpenAIChatResponse(
  text: string | null | undefined,
  model: string,
  toolCalls?: any[],
  reasoningContent?: string,
  usage?: UsageStats
): Record<string, any> {
  // Ensure content is never null/undefined
  const messageContent = ensureValidContent(text);

  // Transform tool calls to OpenAI format
  const openaiToolCalls = transformToolCalls(toolCalls);

  // OpenAI spec: content is null when tool_calls are present
  const finalContent = openaiToolCalls ? null : messageContent;

  // Only include reasoning_content for actual reasoning models
  const shouldIncludeReasoning = isReasoningModel(model) && reasoningContent;

  if (reasoningContent && !isReasoningModel(model)) {
    console.log(`[Builder] Stripping reasoning_content - ${model} is not a reasoning model`);
  }

  // Build canonical OpenAI response
  const response = {
    id: `chatcmpl-${Date.now()}`,
    object: OBJECT_TYPE_CHAT_COMPLETION,
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: ROLE_ASSISTANT,
        content: finalContent,
        ...(shouldIncludeReasoning && { reasoning_content: reasoningContent }),
        ...(openaiToolCalls && { tool_calls: openaiToolCalls })
      },
      finish_reason: openaiToolCalls ? FINISH_REASON_TOOL_CALLS : FINISH_REASON_STOP,
      logprobs: null
    }],
    usage: usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    },
    system_fingerprint: `fp_${generateUUID()}`
  };

  console.log(
    `[Builder] Built Chat Completion response for ${model}: ` +
    `content_length=${finalContent?.length || 0}, ` +
    `tool_calls=${openaiToolCalls?.length || 0}, ` +
    `finish_reason=${response.choices[0].finish_reason}, ` +
    `usage=${JSON.stringify(usage)}`
  );

  return response;
}

/**
 * ============================================================================
 * RESPONSES API FORMAT
 * ============================================================================
 */

/**
 * Request parameters for Responses API format.
 */
interface ResponsesApiParams {
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  tool_choice?: string;
  tools?: any[];
  store?: boolean;
  truncation?: string;
}

/**
 * Build OpenAI Responses API format response.
 *
 * Creates a response object that conforms to the OpenAI Responses API
 * specification. This is a newer API format that provides more structured
 * output with separate reasoning and message items.
 *
 * @param text - The assistant's response text
 * @param model - Model identifier
 * @param toolCalls - Optional array of tool calls from the model
 * @param reasoningContent - Optional reasoning/thinking content
 * @param usage - Optional token usage statistics
 * @param requestParams - Optional request parameters to include in response
 * @returns OpenAI Responses API response object
 *
 * @example
 * const response = buildOpenAIResponsesFormat(
 *   "The weather is sunny.",
 *   "gpt-4",
 *   undefined,
 *   "First, I need to check...",
 *   { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
 *   { temperature: 0.7, top_p: 1.0 }
 * );
 *
 * @see {@link https://platform.openai.com/docs/api-reference/responses/create | OpenAI Responses API}
 */
export function buildOpenAIResponsesFormat(
  text: string | null,
  model: string,
  toolCalls?: any[],
  reasoningContent?: string,
  usage?: UsageStats,
  requestParams?: ResponsesApiParams
): Record<string, any> {
  // Ensure content is never null/undefined
  const messageContent = ensureValidContent(text);

  const createdAt = Math.floor(Date.now() / 1000);
  const responseId = `resp_${generateUUID()}`;
  const messageId = `msg_${generateUUID()}`;

  // Build output items array
  const outputItems: any[] = [];

  // Add message output if we have content
  if (messageContent && messageContent.trim().length > 0) {
    const content: any[] = [{
      type: TYPE_OUTPUT_TEXT,
      text: messageContent,
      annotations: []
    }];

    outputItems.push({
      type: TYPE_MESSAGE,
      id: messageId,
      status: STATUS_COMPLETED,
      role: ROLE_ASSISTANT,
      content: content
    });
  }

  // Add tool calls if present
  if (toolCalls && toolCalls.length > 0) {
    const toolCallItems = toolCalls.map((tc: any) => ({
      type: TYPE_FUNCTION_CALL,
      id: `call_${generateUUID()}`,
      status: STATUS_COMPLETED,
      function: {
        name: tc.name,
        arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
      }
    }));

    outputItems.push(...toolCallItems);
  }

  // If no output items, add a default empty message
  if (outputItems.length === 0) {
    outputItems.push({
      type: TYPE_MESSAGE,
      id: messageId,
      status: STATUS_COMPLETED,
      role: ROLE_ASSISTANT,
      content: [{
        type: TYPE_OUTPUT_TEXT,
        text: EMPTY_CONTENT_FALLBACK,
        annotations: []
      }]
    });
  }

  // Build reasoning field
  const reasoning: any = {
    effort: null,
    summary: reasoningContent || null
  };

  // Calculate reasoning tokens for usage
  const reasoningTokens = reasoningContent ? Math.ceil(reasoningContent.length / 4) : 0;

  // Build the response in OpenAI Responses API format
  const response = {
    id: responseId,
    object: OBJECT_TYPE_RESPONSE,
    created_at: createdAt,
    status: STATUS_COMPLETED,
    completed_at: createdAt,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: requestParams?.max_output_tokens ?? null,
    model: model,
    output: outputItems,
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: reasoning,
    store: requestParams?.store ?? true,
    temperature: requestParams?.temperature ?? 1.0,
    text: {
      format: {
        type: TYPE_TEXT
      }
    },
    tool_choice: requestParams?.tool_choice ?? "auto",
    tools: requestParams?.tools ?? [],
    top_p: requestParams?.top_p ?? 1.0,
    truncation: requestParams?.truncation ?? "disabled",
    usage: {
      input_tokens: usage?.prompt_tokens || 0,
      input_tokens_details: {
        cached_tokens: 0
      },
      output_tokens: usage?.completion_tokens || 0,
      output_tokens_details: {
        reasoning_tokens: reasoningTokens
      },
      total_tokens: usage?.total_tokens || 0
    },
    user: null,
    metadata: {}
  };

  console.log(
    `[Builder] Built Responses API format for ${model}: ` +
    `content_length=${messageContent?.length || 0}, ` +
    `tool_calls=${toolCalls?.length || 0}, ` +
    `reasoning=${!!reasoningContent}, ` +
    `temperature=${response.temperature}, ` +
    `top_p=${response.top_p}, ` +
    `usage=${JSON.stringify(usage)}`
  );

  return response;
}

