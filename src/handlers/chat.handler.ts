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
import { getCfModelName, listAIModels } from '../model-helpers';
import { AUTO_ROUTE_MODEL_NAMES } from '../constants';
import { validateAndNormalizeRequest, transformChatCompletionRequest } from '../transformers/request.transformer';
import { extractGptOssResponse, extractOpenAiCompatibleResponse, sanitizeAiResponse } from '../parsers/response.parser';
import { buildOpenAIChatResponse, buildOpenAIResponsesFormat } from '../builders/response.builder';
import type { Env, OpenAiChatCompletionReq, Model, AiJsonResponse, UsageStats } from '../types';
import { handleEmbeddings } from './embeddings.handler';
import { safeByteLength, safeStringify } from '../utils';

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
      requestParams as any
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
      // Map from tool call index → accumulated tool call object
      const toolCallsMap: Map<number, { id: string; type: string; function: { name: string; arguments: string } }> = new Map();

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

            // Accumulate tool call deltas — reassemble by index into complete objects.
            // OpenAI streaming sends tool calls as incremental deltas:
            //   chunk 1: { index: 0, id: "call_abc", type: "function", function: { name: "generate_image", arguments: "" } }
            //   chunk 2: { index: 0, function: { arguments: '{"prompt":' } }
            //   chunk 3: { index: 0, function: { arguments: '"a dragon"}' } }
            if (toolCallsChunk) {
              for (const delta of toolCallsChunk) {
                const idx = delta.index ?? 0;
                if (!toolCallsMap.has(idx)) {
                  toolCallsMap.set(idx, {
                    id: delta.id || '',
                    type: delta.type || 'function',
                    function: { name: '', arguments: '' }
                  });
                }
                const existing = toolCallsMap.get(idx)!;
                if (delta.id) existing.id = delta.id;
                if (delta.function?.name) existing.function.name += delta.function.name;
                if (delta.function?.arguments !== undefined && delta.function?.arguments !== null) {
                  const args = typeof delta.function.arguments === 'object'
                    ? JSON.stringify(delta.function.arguments)
                    : delta.function.arguments;
                  existing.function.arguments += args;
                }
              }
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

            // Add tool calls if present — normalize arguments to always be a JSON string
            // (Cloudflare may return arguments as a parsed object instead of a JSON string)
            // NOTE: Do NOT forward raw streaming deltas to the client — Cloudflare's tool call
            // delta format may not be standard OpenAI incremental format. Instead we accumulate
            // server-side and send complete assembled tool calls in the final chunk below.
            // if (toolCallsChunk && toolCallsChunk.length > 0) { ... }

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

      // Send final chunk with finish_reason and complete tool calls
      const assembledToolCalls = Array.from(toolCallsMap.values());
      if (assembledToolCalls.length > 0) {
        console.log(`[Chat] Assembled ${assembledToolCalls.length} tool call(s):`, assembledToolCalls.map(tc => `${tc.function.name}(${tc.function.arguments.slice(0, 100)})`).join(', '));
      }

      const finalChunk = {
        id: requestId,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: assembledToolCalls.length > 0 ? {
            tool_calls: assembledToolCalls.map((tc, i) => ({
              index: i,
              id: tc.id,
              type: tc.type,
              function: {
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'object'
                  ? JSON.stringify(tc.function.arguments)
                  : tc.function.arguments
              }
            }))
          } : {},
          finish_reason: assembledToolCalls.length > 0 ? 'tool_calls' : 'stop'
        }]
      };

      await writer.write(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
      await writer.write(encoder.encode('data: [DONE]\n\n'));
      await writer.close();


    } catch (error) {
      console.error('[Chat] Streaming error:', error);

      // Send an SSE error event so the client knows the stream failed
      try {
        const errMsg = error instanceof Error ? error.message : 'Stream processing failed';
        const errorEvent = JSON.stringify({
          id: requestId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          error: { message: errMsg, type: 'api_error' }
        });
        await writer.write(encoder.encode(`data: ${errorEvent}\n\n`));
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

  try {
    // Parse request body
    const data = await request.json() as OpenAiChatCompletionReq & any;

    // If the client explicitly requests an embeddings model on the chat endpoint,
    // attempt to forward to the embeddings handler when the request looks like
    // an embeddings request (has an `input` field or consists only of user messages).
    // Fetch model list once and reuse for both checks below.
    let allModels: Awaited<ReturnType<typeof listAIModels>> = [];
    if (data?.model) {
      try {
        allModels = await listAIModels(env);
        const resolved = getCfModelName(data.model, env);
        const modelInfo = allModels.find(m => (m.id === resolved || m.name === resolved));
        if (modelInfo && modelInfo.taskName === 'Text Embeddings') {
          // If caller sent an OpenAI-style embeddings payload (input) forward directly
          if ('input' in data) {
            return handleEmbeddings(request, env);
          }

          // If caller sent chat messages but they're all user messages, coerce them to embeddings
          if (Array.isArray(data.messages) && data.messages.length > 0 && data.messages.every((m: any) => m.role === 'user')) {
            const inputs = data.messages.map((m: any) => m.content || '');
            const embReq = new Request(request.url, {
              method: 'POST',
              headers: request.headers,
              body: JSON.stringify({ model: data.model, input: inputs })
            });
            return handleEmbeddings(embReq, env);
          }

          // Otherwise, provide a validation error directing them to /v1/embeddings
          return validationError(
            `Model "${data.model || resolved}" is an embeddings model. Use the /v1/embeddings endpoint instead.`,
            'model'
          );
        }
      } catch (e) {
        console.warn('[Chat] Could not auto-route embeddings model:', e);
      }
    }

    // Validate and normalize request
    const validatedData = validateAndNormalizeRequest(data, env);


    // Transform to Cloudflare format
    const { model, options } = transformChatCompletionRequest(validatedData, env);

    // For auto-route requests, report the resolved CF model in the response so
    // callers can see which model was actually selected. For named aliases
    // (e.g. "gpt-4o") echo back what the client sent — mirrors OpenAI's convention.
    const responseModel = AUTO_ROUTE_MODEL_NAMES.includes((data.model ?? '').trim())
      ? model
      : (data.model || model);

    // NEW: Prevent using embedding models with chat/completions endpoint
    try {
      const modelInfo = allModels.find(m => (m.id === model || m.name === model));
      if (modelInfo && modelInfo.taskName === 'Text Embeddings') {
        return validationError(
          `Model "${validatedData.model || model}" is an embeddings model. Use the /v1/embeddings endpoint instead.`,
          'model'
        );
      }
    } catch (e) {
      console.warn('[Chat] Could not verify model type before chat call:', e);
    }

    console.log(`[Chat] ${model} stream=${options?.stream} msgs=${(options as any)?.messages?.length || 0}`);

    // Call Cloudflare AI (with provider response logging)
    let aiRes: any;
    try {
      aiRes = await env.AI.run(model, options);
    } catch (err: any) {
      console.error('[Chat][PROVIDER] Call threw an exception:', err && err.message ? err.message : err);
      if (err && err.response) {
        try {
          let bodyText: string;
          if (typeof (err.response?.text) === 'function') {
            bodyText = await err.response.text();
          } else {
            bodyText = safeStringify(err.response);
          }
          console.error('[Chat][PROVIDER] Error response body (preview):', bodyText.slice(0, 2000));
        } catch (e) {
          console.warn('[Chat][PROVIDER] Failed to read error response body:', e);
        }
      }
      throw err;
    }

    // Log provider errors only
    try {
      if (typeof aiRes === 'object' && aiRes !== null && 'error' in aiRes) {
        try {
          console.error('[Chat][PROVIDER] Provider returned error object:', safeStringify((aiRes as any).error).slice(0, 2000));
        } catch (e) {
          console.error('[Chat][PROVIDER] Provider returned error (unable to stringify)');
        }
      }
    } catch (e) {
      // ignore logging failures
    }

    // Handle streaming response
    if (options.stream && aiRes instanceof ReadableStream) {
      return handleStreamingResponse(aiRes, responseModel);
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
    return buildChatResponse(parsedResponse, responseModel, false);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Chat] Failed after ${duration}ms:`, error);

    return serverError(
      'Chat completion failed',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}
