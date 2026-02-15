/**
 * ============================================================================
 * CHAT COMPLETIONS HANDLER
 * ============================================================================
 *
 * Handles POST /v1/chat/completions and POST /v1/responses endpoints.
 * Processes chat completion requests, manages streaming/non-streaming responses,
 * and ensures OpenAI API compatibility.
 *
 * @module handlers/chat
 */

import { errorResponse, serverError, validationError } from '../errors';
import { getCfModelName } from '../model-helpers';
import { validateAndNormalizeRequest, transformChatCompletionRequest } from '../transformers/request.transformer';
import { extractGptOssResponse, extractOpenAiCompatibleResponse, sanitizeAiResponse } from '../parsers/response.parser';
import { buildOpenAIChatResponse, buildOpenAIResponsesFormat } from '../builders/response.builder';
import type { Env, OpenAiChatCompletionReq, Model, AiJsonResponse, UsageStats } from '../types';

/**
 * ============================================================================
 * TYPES
 * ============================================================================
 */

/**
 * Request parameters for Responses API format.
 */
interface ResponsesApiParams {
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number | null;
  tool_choice?: string;
  tools?: any[];
  store?: boolean;
  truncation?: string;
}

/**
 * ============================================================================
 * QWEN WORKAROUNDS
 * ============================================================================
 */

/**
 * Apply Qwen-specific workarounds for tool calling.
 *
 * Qwen has a quirk where it stops immediately after tool results with minimal output.
 * This function adds continuation prompts to force proper responses.
 *
 * @param messages - Chat messages array
 */
function applyQwenToolWorkarounds(messages: any[]): void {
  const toolMessages = messages.filter((msg: any) => msg.role === 'tool');

  if (toolMessages.length === 0) {
    return;
  }

  // Check for successful tool results
  const hasSuccessfulToolResults = toolMessages.some((msg: any) => {
    const content = msg.content || '';
    const hasError =
      content.includes('"error"') ||
      content.includes('error:') ||
      content.includes('Tool execution failed') ||
      content.includes('Failed to execute') ||
      content.includes('internal error') ||
      content.length < 20;
    return !hasError;
  });

  // Check for tool errors
  const hasToolErrors = toolMessages.some((msg: any) => {
    const content = msg.content || '';
    return content.includes('"error"') ||
           content.includes('error:') ||
           content.includes('Tool execution failed') ||
           content.includes('Failed to execute') ||
           content.includes('internal error');
  });

  const lastMessage = messages[messages.length - 1];

  if (hasSuccessfulToolResults) {
    const isAlreadyContinuation = lastMessage?.role === 'user' &&
      (lastMessage?.content?.includes('provide') ||
       lastMessage?.content?.includes('answer') ||
       lastMessage?.content?.includes('Based on'));

    if (!isAlreadyContinuation) {
      console.log("[Chat] QWEN WORKAROUND: Adding continuation prompt for tool results");
      messages.push({
        role: "user",
        content: "Based on the tool results above, please provide a complete answer to my original question."
      });
    }
  } else if (hasToolErrors) {
    const isAlreadyErrorGuidance = lastMessage?.role === 'user' &&
      lastMessage?.content?.includes('error');

    if (!isAlreadyErrorGuidance) {
      console.log("[Chat] QWEN WORKAROUND: Adding error handling prompt");
      messages.push({
        role: "user",
        content: "The tool encountered an error. Please explain what went wrong and suggest what we can try next."
      });
    }
  }
}

/**
 * ============================================================================
 * RESPONSE BUILDING
 * ============================================================================
 */

/**
 * Build appropriate response based on API format (Chat Completions vs Responses API).
 */
function buildChatResponse(
  parsedResponse: AiJsonResponse,
  model: string,
  isResponsesApi: boolean,
  requestParams?: ResponsesApiParams
): Response {
  const { response, tool_calls, reasoning_content, usage } = parsedResponse;

  let responseObject: any;

  if (isResponsesApi) {
    // Build Responses API format
    responseObject = buildOpenAIResponsesFormat(
      response,
      model,
      tool_calls,
      reasoning_content,
      usage,
      requestParams
    );
  } else {
    // Build Chat Completions format
    responseObject = buildOpenAIChatResponse(
      response,
      model,
      tool_calls,
      reasoning_content,
      usage
    );
  }

  return new Response(JSON.stringify(responseObject), {
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * ============================================================================
 * STREAMING RESPONSE HANDLER
 * ============================================================================
 */

/**
 * Handle streaming chat completions.
 *
 * Transforms Cloudflare AI streaming responses to OpenAI SSE format.
 * This is a complex handler that needs to:
 * - Parse Cloudflare's streaming chunks
 * - Handle tool calls in streaming mode
 * - Handle reasoning content
 * - Transform to OpenAI SSE format
 * - Send proper finish chunks
 */
export async function handleStreamingResponse(
  stream: ReadableStream,
  model: string
): Promise<Response> {
  console.log('[Chat] Processing streaming response');

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const requestId = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  // Process stream in background
  (async () => {
    try {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let hasSeenFirstChunk = false;
      let toolCalls: any[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            // Parse Cloudflare chunk - could be plain JSON or SSE format
            let parsed: any;

            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              parsed = JSON.parse(data);
            } else {
              parsed = JSON.parse(line);
            }

            // Extract content based on Cloudflare's response format
            let content = '';
            let reasoningContent = '';
            let toolCallsChunk: any[] | undefined;
            let finishReason: string | null = null;

            // Format 1: Direct response field
            if (parsed.response !== undefined) {
              content = parsed.response || '';
            }
            // Format 2: OpenAI-compatible choices array
            else if (parsed.choices && Array.isArray(parsed.choices) && parsed.choices[0]) {
              const choice = parsed.choices[0];
              if (choice.delta?.content) {
                content = choice.delta.content;
              }
              if (choice.delta?.reasoning_content) {
                reasoningContent = choice.delta.reasoning_content;
              }
              if (choice.delta?.tool_calls) {
                toolCallsChunk = choice.delta.tool_calls;
              }
              if (choice.finish_reason) {
                finishReason = choice.finish_reason;
              }
            }
            // Format 3: content field directly
            else if (parsed.content !== undefined) {
              content = parsed.content || '';
            }

            // Check for reasoning_content at the top level too
            if (parsed.reasoning_content) {
              reasoningContent = parsed.reasoning_content;
            }

            // Handle tool calls accumulation
            if (toolCallsChunk) {
              toolCalls.push(...toolCallsChunk);
            }

            // Build OpenAI-compatible chunk
            const chunk: any = {
              id: requestId,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: finishReason
              }]
            };

            // Add role on very first chunk
            if (!hasSeenFirstChunk) {
              chunk.choices[0].delta.role = 'assistant';
              hasSeenFirstChunk = true;
            }

            // Add content to delta if we have any
            if (content) {
              chunk.choices[0].delta.content = content;
            }

            // Add reasoning_content if present
            if (reasoningContent) {
              chunk.choices[0].delta.reasoning_content = reasoningContent;
            }

            // Add tool calls if present
            if (toolCallsChunk && toolCallsChunk.length > 0) {
              chunk.choices[0].delta.tool_calls = toolCallsChunk;
            }

            // Only send chunk if it has meaningful data (role, content, reasoning_content, tool_calls, or finish_reason)
            const hasMeaningfulData =
              chunk.choices[0].delta.role ||
              chunk.choices[0].delta.content ||
              chunk.choices[0].delta.reasoning_content ||
              chunk.choices[0].delta.tool_calls ||
              finishReason;

            if (hasMeaningfulData) {
              await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }

          } catch (e) {
            console.error('[Chat] Error parsing stream chunk:', e);
          }
        }
      }

      // Send final chunk with finish_reason
      const finalChunk = {
        id: requestId,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
        }]
      };

      await writer.write(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
      await writer.write(encoder.encode('data: [DONE]\n\n'));
      await writer.close();

      console.log('[Chat] Streaming completed successfully');

    } catch (error) {
      console.error('[Chat] Streaming error:', error);

      // Try to send an error chunk
      try {
        const errorChunk = {
          id: requestId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{
            index: 0,
            delta: { content: ' ' },
            finish_reason: 'stop'
          }]
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
        await writer.write(encoder.encode('data: [DONE]\n\n'));
      } catch (e) {
        console.error('[Chat] Failed to send error chunk:', e);
      }

      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}

/**
 * ============================================================================
 * MAIN HANDLER
 * ============================================================================
 */

/**
 * Handle POST /v1/chat/completions request.
 */
export async function handleChatCompletions(request: Request, env: Env): Promise<Response> {
  const startTime = Date.now();
  console.log('[Chat] Processing chat completion request');

  try {
    // Parse request body
    const data = await request.json() as OpenAiChatCompletionReq;

    // Validate and normalize request
    const validatedData = validateAndNormalizeRequest(data, env);

    // Apply Qwen-specific workarounds if needed
    applyQwenToolWorkarounds(validatedData.messages);

    // Transform to Cloudflare format
    const { model, options } = transformChatCompletionRequest(validatedData, env);

    console.log(`[Chat] Model: ${model}, Stream: ${options?.stream}, Messages: ${(options as any)?.messages?.length || 0}`);

    // Call Cloudflare AI
    const aiRes = await env.AI.run(model, options);

    // Handle streaming response
    if (options.stream && aiRes instanceof ReadableStream) {
      return handleStreamingResponse(aiRes, data.model || model);
    }

    // Handle non-streaming response
    let parsedResponse: AiJsonResponse;

    // Detect response format and parse accordingly
    if (typeof aiRes === 'object' && aiRes !== null) {
      if ('choices' in aiRes) {
        // OpenAI-compatible format
        parsedResponse = extractOpenAiCompatibleResponse(aiRes as any, model);
      } else if ('output' in aiRes) {
        // GPT-OSS format
        parsedResponse = extractGptOssResponse(aiRes as any);
      } else if ('response' in aiRes) {
        // Standard format
        parsedResponse = sanitizeAiResponse(aiRes);
      } else {
        // Unknown format - use fallback
        console.warn('[Chat] Unknown response format:', Object.keys(aiRes));
        parsedResponse = {
          response: " ",
          contentType: "application/json",
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
      }
    } else {
      // Invalid response
      parsedResponse = {
        response: " ",
        contentType: "application/json",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    }

    // Ensure response is valid
    if (!parsedResponse.response || parsedResponse.response.trim().length === 0) {
      parsedResponse.response = " ";
    }

    const duration = Date.now() - startTime;
    console.log(`[Chat] Completed in ${duration}ms`);

    // Build and return response (always Chat Completions format for this endpoint)
    return buildChatResponse(parsedResponse, data.model || model, false);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Chat] Failed after ${duration}ms:`, error);

    return serverError(
      'Chat completion failed',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

