/**
 * ============================================================================
 * RESPONSES API HANDLER
 * ============================================================================
 *
 * Handles POST /v1/responses endpoint for the OpenAI Responses API.
 * This is a newer API format that provides more structured output with
 * separate reasoning and message items.
 *
 * Key differences from Chat Completions:
 * - Uses `input_items` instead of `messages`
 * - Uses `max_output_tokens` instead of `max_tokens`
 * - Returns `output` array with structured items
 * - Includes separate `reasoning` field
 *
 * @module handlers/responses
 */

import { errorResponse, validationError, serverError } from '../errors';
import { validateAndNormalizeRequest, transformChatCompletionRequest } from '../transformers/request.transformer';
import { extractGptOssResponse, extractOpenAiCompatibleResponse, sanitizeAiResponse } from '../parsers/response.parser';
import { buildOpenAIResponsesFormat } from '../builders/response.builder';
import { handleStreamingResponse } from './chat.handler';
import type { Env, OpenAiChatCompletionReq, AiJsonResponse } from '../types';

function parseInputItems(inputItems: any[]): any[] {
  return inputItems.map((item: any) => {
    if (item.type === "message" && item.content) {
      let contentText = "";

      if (Array.isArray(item.content)) {
        contentText = item.content
          .filter((c: any) => c.type === "input_text" && c.text)
          .map((c: any) => c.text)
          .join("\n");
      } else if (typeof item.content === "string") {
        contentText = item.content;
      }

      return {
        role: item.role || "user",
        content: contentText || " "
      };
    }
    return item;
  });
}

export async function handleResponses(request: Request, env: Env): Promise<Response> {
  const startTime = Date.now();
  console.log('[Responses] Processing Responses API request');

  try {
    const data = await request.json() as any;

    console.log('[Responses] Request keys:', Object.keys(data).join(', '));

    const requestedModel = data.model || data.model_id;
    if (!requestedModel) {
      return validationError('Model is required', 'model');
    }

    let messages: any[] = [];

    if (data.input_items && Array.isArray(data.input_items)) {
      console.log(`[Responses] Parsing ${data.input_items.length} input_items`);
      messages = parseInputItems(data.input_items);
    } else if (data.messages && Array.isArray(data.messages)) {
      console.log(`[Responses] Using ${data.messages.length} messages directly`);
      messages = data.messages;
    } else if (data.input) {
      console.log('[Responses] Using direct input field');
      if (typeof data.input === 'string') {
        messages = [{ role: 'user', content: data.input }];
      } else if (Array.isArray(data.input)) {
        messages = parseInputItems(data.input);
      }
    } else {
      return validationError('No input_items, messages, or input provided', 'input_items');
    }

    const openaiRequest: OpenAiChatCompletionReq = {
      model: requestedModel,
      messages,
      temperature: data.temperature,
      top_p: data.top_p,
      max_tokens: data.max_tokens || data.max_output_tokens,
      stream: data.stream ?? false,
      ...(data.tools && { tools: data.tools }),
      ...(data.tool_choice && { tool_choice: data.tool_choice }),
    };

    const validatedData = validateAndNormalizeRequest(openaiRequest, env);
    const { model, options } = transformChatCompletionRequest(validatedData, env);

    console.log(`[Responses] Model: ${model}, Stream: ${options?.stream}`);

    const aiRes = await env.AI.run(model, options);

    if (options.stream && aiRes instanceof ReadableStream) {
      console.log('[Responses] Returning streaming response');
      return handleStreamingResponse(aiRes, requestedModel);
    }

    let parsedResponse: AiJsonResponse;

    if (typeof aiRes === 'object' && aiRes !== null) {
      if ('choices' in aiRes) {
        parsedResponse = extractOpenAiCompatibleResponse(aiRes as any, model);
      } else if ('output' in aiRes) {
        parsedResponse = extractGptOssResponse(aiRes as any);
      } else if ('response' in aiRes) {
        parsedResponse = sanitizeAiResponse(aiRes);
      } else {
        console.warn('[Responses] Unknown response format:', Object.keys(aiRes));
        parsedResponse = {
          response: " ",
          contentType: "application/json",
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
      }
    } else {
      parsedResponse = {
        response: " ",
        contentType: "application/json",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    }

    if (!parsedResponse.response || parsedResponse.response.trim().length === 0) {
      parsedResponse.response = " ";
    }

    const requestParams = {
      temperature: data.temperature ?? 1.0,
      top_p: data.top_p ?? 1.0,
      max_output_tokens: data.max_tokens || data.max_output_tokens || null,
      tool_choice: data.tool_choice ?? "auto",
      tools: data.tools ?? [],
      store: data.store ?? true,
      truncation: data.truncation ?? "disabled"
    };

    const responseObject = buildOpenAIResponsesFormat(
      parsedResponse.response,
      requestedModel,
      parsedResponse.tool_calls,
      parsedResponse.reasoning_content,
      parsedResponse.usage,
      requestParams
    );

    const duration = Date.now() - startTime;
    console.log(`[Responses] Completed in ${duration}ms`);

    return new Response(JSON.stringify(responseObject), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Responses] Failed after ${duration}ms:`, error);

    return serverError(
      'Responses API request failed',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}
