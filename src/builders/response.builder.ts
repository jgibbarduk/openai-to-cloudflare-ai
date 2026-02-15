/**
 * ============================================================================
 * RESPONSE BUILDERS
 * ============================================================================
 *
 * Builds properly formatted responses for different API formats:
 * - OpenAI Chat Completions format
 * - OpenAI Responses API format
 */

import { REASONING_MODELS } from '../constants';
import { getRandomId } from '../utils';

/**
 * Build OpenAI Chat Completions format response
 */
export function buildOpenAIChatResponse(
  text: string | null | undefined,
  model: string,
  toolCalls?: any[],
  reasoningContent?: string,
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
): Record<string, any> {
  // Never allow null/undefined content
  let messageContent = text;
  if (!messageContent || messageContent.trim().length === 0) {
    console.log("[Builder] Empty content detected, using fallback space character");
    messageContent = " ";
  }

  // Transform Cloudflare tool_calls format to OpenAI format
  let openaiToolCalls: any[] | undefined;
  if (toolCalls && toolCalls.length > 0) {
    console.log("[Builder] Transforming tool_calls to OpenAI format");
    openaiToolCalls = toolCalls.map((tc) => ({
      id: `call_${getRandomId()}`,
      type: "function",
      function: {
        name: tc.name,
        arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
      }
    }));
  }

  // OpenAI spec: content is null when tool_calls are present
  const finalContent = openaiToolCalls ? null : messageContent;

  // Only include reasoning_content for actual reasoning models
  const isReasoningModel = REASONING_MODELS.some(rm => model.toLowerCase().includes(rm.toLowerCase()));
  const shouldIncludeReasoning = isReasoningModel && reasoningContent;

  if (reasoningContent && !isReasoningModel) {
    console.log(`[Builder] Stripping reasoning_content - ${model} is not a reasoning model`);
  }

  // Build canonical OpenAI response
  const response = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: finalContent,
        ...(shouldIncludeReasoning && { reasoning_content: reasoningContent }),
        ...(openaiToolCalls && { tool_calls: openaiToolCalls })
      },
      finish_reason: openaiToolCalls ? "tool_calls" : "stop",
      logprobs: null
    }],
    usage: usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    },
    system_fingerprint: `fp_${getRandomId()}`
  };

  console.log(`[Builder] Built response for model ${model}: content_length=${finalContent?.length || 0}, tool_calls=${openaiToolCalls?.length || 0}, finish_reason=${response.choices[0].finish_reason}, usage=${JSON.stringify(usage)}`);

  return response;
}

/**
 * Build OpenAI Responses API format response
 * See: https://platform.openai.com/docs/api-reference/responses/create
 */
export function buildOpenAIResponsesFormat(
  text: string | null,
  model: string,
  toolCalls?: any[],
  reasoningContent?: string,
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
  requestParams?: {
    temperature?: number;
    top_p?: number;
    max_output_tokens?: number;
    tool_choice?: string;
    tools?: any[];
    store?: boolean;
    truncation?: string;
  }
): Record<string, any> {
  // Never allow null/undefined content
  let messageContent = text;
  if (!messageContent || messageContent.trim().length === 0) {
    console.log("[Builder] Empty content detected, using fallback space character");
    messageContent = " ";
  }

  const createdAt = Math.floor(Date.now() / 1000);
  const responseId = `resp_${getRandomId()}`;
  const messageId = `msg_${getRandomId()}`;

  // Build output items array
  const outputItems: any[] = [];

  // Add message output if we have content
  if (messageContent && messageContent.trim().length > 0) {
    const content: any[] = [{
      type: "output_text",
      text: messageContent,
      annotations: []
    }];

    outputItems.push({
      type: "message",
      id: messageId,
      status: "completed",
      role: "assistant",
      content: content
    });
  }

  // Add tool calls if present
  if (toolCalls && toolCalls.length > 0) {
    const toolCallItems = toolCalls.map((tc: any) => ({
      type: "function_call",
      id: `call_${getRandomId()}`,
      status: "completed",
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
      type: "message",
      id: messageId,
      status: "completed",
      role: "assistant",
      content: [{
        type: "output_text",
        text: " ",
        annotations: []
      }]
    });
  }

  // Build reasoning field
  const reasoning: any = {
    effort: null,
    summary: reasoningContent || null
  };

  // Build the response in OpenAI Responses API format
  const response = {
    id: responseId,
    object: "response",
    created_at: createdAt,
    status: "completed",
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
        type: "text"
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
        reasoning_tokens: reasoningContent ? Math.ceil(reasoningContent.length / 4) : 0
      },
      total_tokens: usage?.total_tokens || 0
    },
    user: null,
    metadata: {}
  };

  console.log(`[Builder] Built Responses API format for model ${model}: content_length=${messageContent?.length || 0}, tool_calls=${toolCalls?.length || 0}, reasoning=${!!reasoningContent}, temperature=${response.temperature}, top_p=${response.top_p}, usage=${JSON.stringify(usage)}`);

  return response;
}

