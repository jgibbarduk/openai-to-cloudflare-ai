/**
 * ============================================================================
 * ONYX ↔ CLOUDFLARE WORKERS AI - OpenAI-Compatible Proxy
 * ============================================================================
 *
 * This service acts as an HTTP proxy that makes Cloudflare Workers AI appear
 * as OpenAI-compatible to Onyx. It translates OpenAI ChatCompletion requests
 * into Cloudflare Workers AI AI.run() calls and translates responses back.
 *
 * SPECIFICATION: https://github.com/your-repo/SPECIFICATION.md
 *
 * KEY FEATURES:
 * ✅ OpenAI-shaped JSON responses always
 * ✅ Message validation (never null content)
 * ✅ Unsupported field stripping (tools, tool_choice, functions, response_format)
 * ✅ Parameter clamping (temperature, top_p, max_tokens)
 * ✅ Streaming & non-streaming support
 * ✅ Model routing with aliases (gpt-4 → Qwen3, etc.)
 * ✅ Tool calling support (Qwen, Mistral)
 * ✅ Error translation to OpenAI format
 *
 * HARD CONSTRAINTS:
 * - Always return OpenAI-shaped JSON
 * - Always include an assistant message
 * - Never forward unsupported OpenAI fields
 * - Messages never contain null content
 * - Streaming uses OpenAI SSE format
 * - Health check always passes
 *
 * SUPPORTED ENDPOINTS:
 * POST /v1/chat/completions
 * POST /v1/responses          (OpenAI Responses API - full compatibility)
 * GET  /v1/models
 * GET  /health
 *
 * ============================================================================
 */

// Import handlers
import { handleHealth } from './handlers/health.handler';
import { handleListModels } from './handlers/models.handler';
import { handleEmbeddings } from './handlers/embeddings.handler';
import { handleImageGeneration } from './handlers/image.handler';
import { handleAssistants } from './handlers/assistants.handler';
import { handleThreads } from './handlers/threads.handler';
import { handleResponses } from './handlers/responses.handler';

// Import helpers and utilities
import { PROXY_VERSION, REASONING_MODELS, TOOL_CAPABLE_MODELS, GPT_OSS_MODELS, MODEL_MAX_TOKENS } from './constants';
import { errorResponse } from './errors';
import { displayModelsInfo, getCfModelName, listAIModels } from './model-helpers';
import { getRandomId, mapTemperatureToCloudflare, mapTools } from './utils';
import { validateAndNormalizeRequest, transformChatCompletionRequest } from './transformers/request.transformer';
import { extractGptOssResponse, extractOpenAiCompatibleResponse, sanitizeAiResponse } from './parsers/response.parser';
import { buildOpenAIChatResponse, buildOpenAIResponsesFormat } from './builders/response.builder';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] [v${PROXY_VERSION}] ${request.method} ${url.pathname}`);

    // Health endpoint - no auth required
    if (url.pathname === '/health' && request.method === 'GET') {
      return handleHealth(env);
    }

    // Authorization check
    const authHeader = request.headers.get('Authorization');
    const providedKey = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    // Debug logging for API key authentication
    console.log(`[Auth] Request to ${url.pathname} from ${request.headers.get('User-Agent')}`);
    console.log(`[Auth] Authorization header present: ${!!authHeader}`);
    console.log(`[Auth] API_KEY configured: ${!!env.API_KEY}`);

    // Log all headers for debugging (masks sensitive data)
    const allHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      // Mask sensitive headers
      if (key.toLowerCase().includes('auth') || key.toLowerCase().includes('key') || key.toLowerCase().includes('token')) {
        allHeaders[key] = value.substring(0, 15) + '...';
      } else {
        allHeaders[key] = value;
      }
    });
    console.log(`[Auth] All request headers:`, JSON.stringify(allHeaders));

    if (authHeader && providedKey) {
      console.log(`[Auth] Provided key (first 8 chars): ${providedKey.substring(0, 8)}...`);
    }
    if (env.API_KEY) {
      console.log(`[Auth] Expected key (first 8 chars): ${env.API_KEY.substring(0, 8)}...`);
    }

    // If API_KEY is set, require authentication (except for /models/search)
    if (env.API_KEY && env.API_KEY !== 'your-api-key-here') {
      if (providedKey !== env.API_KEY) {
        // Allow unauthenticated access to /models/search for debugging
        if (url.pathname === '/models/search' && request.method === 'GET') {
          return displayModelsInfo(env, request);
        }

        console.error(`[Auth] Authentication failed - key mismatch`);
        return errorResponse(
          "Invalid authentication credentials",
          401,
          "invalid_api_key"
        );
      }
      console.log(`[Auth] Authentication successful`);
    } else {
      // API_KEY not configured - allow all requests but log warning
      console.warn(`[Auth] WARNING: API_KEY not configured. All requests are allowed.`);
    }

    try {
      let response: Response;
      switch (true) {
        case url.pathname === '/v1/models' && request.method === 'GET':
          response = await handleListModels(env);
          break;
        case url.pathname === '/v1/chat/completions' && request.method === 'POST':
          response = await this.handleChatCompletions(request, env);
          break;
        case url.pathname === '/v1/responses' && request.method === 'POST':
          response = await handleResponses(request, env);
          break;
        case url.pathname === '/v1/images/generations' && request.method === 'POST':
          response = await handleImageGeneration(request, env);
          break;
        case url.pathname === '/v1/embeddings' && request.method === 'POST':
          response = await handleEmbeddings(request, env);
          break;
        case url.pathname.startsWith('/v1/assistants'):
          response = await handleAssistants(request, env, url);
          break;
        case url.pathname.startsWith('/v1/threads'):
          response = await handleThreads(request, env, url);
          break;
        default:
          response = errorResponse("Not found", 404, "not_found_error");
      }

      const latency = Date.now() - startTime;
      console.log(`[${new Date().toISOString()}] ${url.pathname} completed in ${latency}ms`);
      return response;
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Unhandled error:`, error);
      return errorResponse(
        "Internal server error",
        500,
        "api_error",
        (error as Error).message
      );
    }
  },


  async handleChatCompletions(request: Request, env: Env) {
    const startTime = Date.now();
    const url = new URL(request.url);
    const isResponsesApi = url.pathname === '/v1/responses';

    try {
      const data = await request.json() as OpenAiChatCompletionReq;

      // Log incoming request structure for debugging
      console.log(`[Chat] Request keys:`, Object.keys(data).join(', '));
      console.log(`[Chat] Model requested: ${data.model}, messages: ${data.messages?.length || 0}, stream: ${data.stream}`);

      // If messages is missing, log the full request to debug
      if (!data.messages) {
        console.error(`[Chat] ERROR: No messages array in request. Full request:`, JSON.stringify(data).substring(0, 500));
      }

      // === ONYX COMPATIBILITY: Validate and normalize request ===
      const validatedData = validateAndNormalizeRequest(data, env);


      // QWEN WORKAROUND: Detect if this is a request after tool results (has tool role messages)
      // Qwen has a quirk where it stops immediately after tool results with minimal output
      // Proactively add a continuation prompt to force it to generate a proper response
      const toolMessages = validatedData.messages.filter((msg: any) => msg.role === 'tool');
      const hasSuccessfulToolResults = toolMessages.some((msg: any) => {
        // Check if the tool result contains an error
        const content = msg.content || '';
        // More comprehensive error detection
        const hasError =
          content.includes('"error"') ||
          content.includes('error:') ||
          content.includes('Tool execution failed') ||
          content.includes('Failed to execute') ||
          content.includes('internal error') ||
          content.length < 20; // Very short responses are likely errors
        return !hasError;
      });

      const hasToolErrors = toolMessages.some((msg: any) => {
        const content = msg.content || '';
        return content.includes('"error"') ||
               content.includes('error:') ||
               content.includes('Tool execution failed') ||
               content.includes('Failed to execute') ||
               content.includes('internal error');
      });

      if (hasSuccessfulToolResults) {
        // Check if the last message is already a user message asking for continuation
        const lastMessage = validatedData.messages[validatedData.messages.length - 1];
        const isAlreadyContinuation = lastMessage?.role === 'user' &&
          (lastMessage?.content?.includes('provide') || lastMessage?.content?.includes('answer') || lastMessage?.content?.includes('Based on'));

        if (!isAlreadyContinuation) {
          console.log("[Chat] QWEN WORKAROUND: Successful tool results detected. Adding continuation prompt to prevent premature stop.");
          validatedData.messages.push({
            role: "user",
            content: "Based on the tool results above, please provide a complete answer to my original question."
          });
        }
      } else if (hasToolErrors) {
        // Tool errors present - guide Qwen to explain the error to the user
        const lastMessage = validatedData.messages[validatedData.messages.length - 1];
        const isAlreadyErrorGuidance = lastMessage?.role === 'user' && lastMessage?.content?.includes('error');

        if (!isAlreadyErrorGuidance) {
          console.log("[Chat] QWEN WORKAROUND: Tool errors detected. Adding error handling prompt to guide response.");
          validatedData.messages.push({
            role: "user",
            content: "The tool encountered an error. Please explain to me what went wrong and suggest what we can try next."
          });
        }
      } else if (toolMessages.length > 0) {
        console.log("[Chat] QWEN WORKAROUND: Tool messages present but content unclear. Monitoring.");
      }

      const { model, options } = transformChatCompletionRequest(validatedData, env);
      console.log("Model in use:", model, 'Stream', options?.stream);

      // Track the original requested model to return in responses
      const requestedModel = data.model || validatedData.model;

      // Log request details without massive truncation
      const optionsSummary: any = {
        stream: options?.stream,
        max_tokens: options?.max_tokens,
        temperature: options?.temperature,
        messageCount: (options as any)?.messages?.length || 0,
        toolCount: (options as any)?.tools?.length || 0
      };
      console.log("[Chat] Request summary to CF AI:", JSON.stringify(optionsSummary));

      const aiRes = await env.AI.run(model, options);

      console.log("[Chat] Response from CF AI type:", typeof aiRes, 'instanceof ReadableStream:', aiRes instanceof ReadableStream);
      if (!( aiRes instanceof ReadableStream)) {
        const responseStr = JSON.stringify(aiRes);
        console.log("[Chat] Response object (first 500):", responseStr.substring(0, 500));

        // Log tool call information specifically
        if (typeof aiRes === 'object' && aiRes !== null) {
          if ('tool_calls' in aiRes) {
            console.log("[Chat] Response has tool_calls:", JSON.stringify((aiRes as any).tool_calls));
          }
          if ('choices' in aiRes && Array.isArray((aiRes as any).choices) && (aiRes as any).choices.length > 0) {
            const firstChoice = (aiRes as any).choices[0];
            console.log("[Chat] First choice:", JSON.stringify(firstChoice).substring(0, 300));
            if (firstChoice.message?.tool_calls) {
              console.log("[Chat] Tool calls in message:", JSON.stringify(firstChoice.message.tool_calls));
            }
          }
        }
      }

      return this.handleChatCompletionResponse(aiRes, requestedModel, options, startTime, isResponsesApi, validatedData);
    } catch (error) {
      console.error("[Chat] Error:", (error as Error).message, (error as Error).stack);
      return errorResponse(
        "Chat completion failed",
        500,
        "server_error",
        (error as Error).message
      );
    }
  },

  /**
   * Handle the actual chat completion response (extracted to support retry logic)
   *
   * ✅ CRITICAL: All response paths go through chatNormalResponse which uses the
   * canonical buildOpenAIChatResponse wrapper. This guarantees Onyx always gets a
   * properly formatted OpenAI envelope.
   */
  async handleChatCompletionResponse(
    aiRes: any,
    model: Model,
    options: any,
    startTime: number,
    isResponsesApi: boolean = false,
    requestData?: any
  ) {
    try {
      // Extract request parameters from requestData for /v1/responses API
      const requestParams = requestData ? {
        temperature: requestData.temperature ?? 1.0,
        top_p: requestData.top_p ?? 1.0,
        max_output_tokens: requestData.max_tokens || requestData.max_output_tokens || null,
        tool_choice: requestData.tool_choice ?? "auto",
        tools: requestData.tools ?? [],
        store: requestData.store ?? true,
        truncation: requestData.truncation ?? "disabled"
      } : undefined;

      console.log(`[Chat] RequestParams extracted for Responses API: temperature=${requestParams?.temperature}, top_p=${requestParams?.top_p}, max_output_tokens=${requestParams?.max_output_tokens}`);

      if (options.stream && aiRes instanceof ReadableStream) {
        console.log(`[Chat] [v${PROXY_VERSION}] Starting streaming response transformation`);
        return await this.chatStreamResponse(aiRes, model);
      }

      // Check if this is an OpenAI-compatible response format (has choices array)
      // This is the new format that Cloudflare returns for some models
      if (!options.stream && typeof aiRes === 'object' && aiRes !== null && 'choices' in aiRes) {
        console.log("[Chat] Detected OpenAI-compatible response format from Cloudflare");
        const openAiResponse = extractOpenAiCompatibleResponse(aiRes as any, model);

        // ✅ VALIDATION: Verify extraction succeeded
        if (!openAiResponse.response || openAiResponse.response.trim().length === 0) {
          console.warn("[Chat] OpenAI-compatible extraction produced empty response, using fallback");
          openAiResponse.response = " ";
        }
        return this.chatNormalResponse(openAiResponse, model, startTime, isResponsesApi, requestParams);
      }

      // Check if this is a GPT-OSS response format (has output array)
      if (!options.stream && typeof aiRes === 'object' && aiRes !== null && 'output' in aiRes) {
        console.log("[Chat] Detected GPT-OSS response format");
        const gptOssResponse = extractGptOssResponse(aiRes as any);
        // ✅ VALIDATION: Verify extraction succeeded
        if (!gptOssResponse.response || gptOssResponse.response.trim().length === 0) {
          console.warn("[Chat] GPT-OSS extraction produced empty response, using fallback");
          gptOssResponse.response = " ";
        }
        return this.chatNormalResponse(gptOssResponse, model, startTime, isResponsesApi, requestParams);
      }

      if (!options.stream && typeof aiRes === 'object' && aiRes !== null && 'response' in aiRes) {
        // Check if response is null/undefined BUT has tool_calls (this is valid)
        if ((aiRes.response === undefined || aiRes.response === null) && !('tool_calls' in aiRes)) {
          console.warn("[Chat] Response is null/undefined and no tool_calls present");
          return this.chatNormalResponse({
            response: " ",
            contentType: "application/json",
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
          }, model, startTime, isResponsesApi, requestParams);
        }

        // If response is null but tool_calls exist, that's valid - pass it through
        if (aiRes.response === null && 'tool_calls' in aiRes) {
          console.log("[Chat] Response is null but tool_calls present - this is valid");
          return this.chatNormalResponse({
            response: "", // Empty string for tool calls
            contentType: "application/json",
            usage: aiRes.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            tool_calls: aiRes.tool_calls
          }, model, startTime, isResponsesApi, requestParams);
        }

        // Sanitize the response to remove any invalid characters
        const sanitizedRes = sanitizeAiResponse(aiRes);
        // ✅ VALIDATION: Verify sanitization produced valid content
        if (!sanitizedRes.response || sanitizedRes.response.trim().length === 0) {
          console.warn("[Chat] Sanitization produced empty response, using fallback");
          sanitizedRes.response = " ";
        }
        return this.chatNormalResponse(sanitizedRes, model, startTime, isResponsesApi, requestParams);
      }

      // Fallback: return empty response rather than error (Onyx compatibility)
      console.warn("[Chat] No valid response from AI, returning empty content. Response:", JSON.stringify(aiRes).substring(0, 300));
      return this.chatNormalResponse({
        response: " ",
        contentType: "application/json",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      }, model, startTime, isResponsesApi, requestParams);
    } catch (error) {
      console.error("[Chat] Error:", (error as Error).message, (error as Error).stack);
      return errorResponse(
        "Chat completion failed",
        500,
        "server_error",
        (error as Error).message
      );
    }
  },

  /**
   * Extract response from GPT-OSS format
   * GPT-OSS returns {output: [{type: "reasoning"|"message", content: [...]}]}
   */
  validateAndNormalizeRequest(data: OpenAiChatCompletionReq, env: Env): OpenAiChatCompletionReq {
    console.log("[Validation] Normalizing request for Onyx compatibility");

    // Step 0: Handle Onyx's non-standard 'input' field
    // Onyx sometimes sends {"input": [...]} instead of {"messages": [...]}
    if (!data.messages && (data as any).input) {
      const input = (data as any).input;

      // Handle simple string input
      if (typeof input === 'string') {
        console.log("[Validation] Input is a simple string, converting to user message");
        data.messages = [{
          role: "user",
          content: input
        }];
      }
      // Handle array input
      else if (Array.isArray(input)) {
        // Convert Responses API input format to OpenAI messages format
        data.messages = input.map((item: any) => {
          // Responses API format: {type: "message", role: "user", content: [{type: "input_text", text: "..."}]}
          // OpenAI format: {role: "user", content: "..."}

          if (item.type === "message" && item.content) {
            // Extract text from content array
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
              content: contentText
            };
          }

          // Fallback: return as-is if format not recognized
          return item;
        });

        console.log(`[Validation] Converted ${data.messages.length} input items to messages`);
      }

      // Remove the non-standard 'input' field
      delete (data as any).input;
    }

    // Step 1: Ensure messages array exists
    if (!data.messages || !Array.isArray(data.messages)) {
      console.warn("[Validation] No messages array found, creating empty array");
      data.messages = [];
    }

    // Step 2: Validate and sanitize every message
    data.messages = data.messages.map((msg: any) => {
      // Ensure message has a valid role
      let role = msg.role || "user";

      // Map unsupported roles to supported ones
      if (role === "developer") {
        role = "system";
        console.log("[Validation] Mapping 'developer' role to 'system'");
      } else if (role === "tool") {
        // Keep 'tool' role as-is (for tool results)
      } else if (!["system", "user", "assistant"].includes(role)) {
        role = "user";
        console.log(`[Validation] Mapping unknown role '${msg.role}' to 'user'`);
      }

      // Step 3: Ensure content is never null or undefined
      let content = msg.content;
      if (content === null || content === undefined) {
        console.log(`[Validation] Message with role '${role}' had null content, replacing with empty string`);
        content = "";
      }

      // Ensure content is a string
      if (typeof content !== "string") {
        console.log(`[Validation] Message content is ${typeof content}, converting to string`);

        // Handle array of content parts (Responses API format)
        if (Array.isArray(content)) {
          content = content
            .map((part: any) => {
              // Extract text from different content part types
              if (part.type === "input_text" && part.text) return part.text;
              if (part.type === "output_text" && part.text) return part.text;
              if (part.type === "text" && part.text) return part.text;
              if (typeof part === "string") return part;
              // For other types, try to stringify
              return JSON.stringify(part);
            })
            .filter(Boolean)
            .join("\n");
        }
      }

      return {
        role,
        content,
        // Preserve tool_call_id if present (for tool messages)
        ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
        // Preserve tool_calls if present (for assistant messages with tool calls)
        ...(msg.tool_calls && { tool_calls: msg.tool_calls })
      };
    });

    // Step 4: Strip unsupported OpenAI fields
    // Note: tools and tool_choice are NOT stripped here - they're handled in transformChatCompletionRequest
    // based on model capability detection
    const unsupportedFields = [
      "functions",
      "function_call",
      "response_format",
      "parallel_tool_calls",
      "reasoning_effort",
      "modalities",
      "user"  // OpenAI user tracking not supported
    ];

    for (const field of unsupportedFields) {
      if (field in data) {
        console.log(`[Validation] Stripping unsupported field: ${field}`);
        delete (data as any)[field];
      }
    }

    // Step 5: Apply defaults if not specified
    if (data.temperature === undefined || data.temperature === null) {
      data.temperature = 0.7;
      console.log("[Validation] Applied default temperature: 0.7");
    }

    if (data.top_p === undefined || data.top_p === null) {
      data.top_p = 0.9;
      console.log("[Validation] Applied default top_p: 0.9");
    }

    if ((data.max_tokens === undefined || data.max_tokens === null) &&
        (data.max_completion_tokens === undefined || data.max_completion_tokens === null)) {
      data.max_tokens = 1024;
      console.log("[Validation] Applied default max_tokens: 1024");
    }

    if (data.stream === undefined || data.stream === null) {
      data.stream = false;
      console.log("[Validation] Applied default stream: false");
    }

    // Step 6: Clamp parameters to valid ranges
    // Temperature: 0 <= temp <= 2 (OpenAI range)
    if (data.temperature !== undefined) {
      data.temperature = Math.max(0, Math.min(1, data.temperature));
    }

    // top_p: 0 <= top_p <= 1
    if (data.top_p !== undefined) {
      data.top_p = Math.max(0, Math.min(1, data.top_p));
    }

    // max_tokens: <= 4096 (Cloudflare limit)
    const maxTokensKey = data.max_tokens !== undefined ? "max_tokens" : "max_completion_tokens";
    const currentMaxTokens = (data as any)[maxTokensKey];
    if (currentMaxTokens !== undefined && currentMaxTokens > 4096) {
      console.log(`[Validation] Clamping ${maxTokensKey} from ${currentMaxTokens} to 4096`);
      (data as any)[maxTokensKey] = 4096;
    }

    console.log("[Validation] Request normalization complete. Messages:", data.messages.length);
    return data;
  },

  /**
   *  Chat Completion Method
   */
  async chatStreamResponse(responseStream: AiStreamResponse, model: Model, isResponsesEndpoint: boolean = false) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const timestamp = Date.now();
    const system_fingerprint = `fp_${getRandomId()}`;

    // Use correct ID prefix and object type based on endpoint
    const idPrefix = isResponsesEndpoint ? "resp" : "chatcmpl";
    const objectType = isResponsesEndpoint ? "response" : "chat.completion.chunk";
    const completionId = `${idPrefix}-${timestamp}`;
    let index = 0;

    const stream = new ReadableStream({
      async start(controller) {
        const reader = responseStream.getReader();

        // Metadata for response
        const metadata = {
          id: completionId,
          object: objectType,
          created: Math.floor(timestamp / 1000),
          model,
          service_tier: "default",
          system_fingerprint,
        };

        // ✅ Check if this is a reasoning model (o1, o3 series)
        // Only reasoning models should include reasoning_content in deltas
        const isReasoningModel = REASONING_MODELS.some(rm => model.toLowerCase().includes(rm.toLowerCase()));
        console.log(`[Stream] Checking reasoning support for model: ${model}`);
        console.log(`[Stream] Is reasoning model: ${isReasoningModel}`);
        if (!isReasoningModel) {
          console.log(`[Stream] Model ${model} is NOT a reasoning model - will strip reasoning_content from deltas`);
        }

        // Responses API tracking variables
        const responseId = completionId;
        const itemId = `msg_${crypto.randomUUID().split('-')[0]}`;
        const outputIndex = 0;
        const contentIndex = 0;

        // Helper function to build Responses API event (matches official OpenAI format)
        const buildResponsesEvent = (eventType: string, data: any) => {
          const baseEvent: any = {
            type: eventType,
            ...data
          };

          // For delta and done events, include required tracking fields
          if (eventType.includes('.delta') || eventType.includes('.done')) {
            baseEvent.item_id = itemId;
            baseEvent.output_index = outputIndex;
            baseEvent.content_index = contentIndex;
          }

          return baseEvent;
        };

        let buffer = ""; // Buffer to accumulate incomplete chunks
        let done = false;
        let chunkCount = 0;
        let totalContentLength = 0; // Track total content generated
        let hasReasoningContent = false; // Track if we received any reasoning
        let toolCallBuffer: Record<string, any> = {}; // Buffer for tool calls being streamed

        // Accumulate full text for .done events (Responses API)
        let accumulatedText = "";
        let accumulatedReasoning = "";
        let accumulatedToolCalls: any[] = [];

        // Send initial events for Responses API
        if (isResponsesEndpoint) {
          // 1. Send response.created (with created_at and output)
          const createdEvent = {
            type: "response.created",
            response: {
              id: responseId,
              object: "response",
              created_at: Math.floor(timestamp / 1000),
              model: model,
              status: "in_progress",
              output: []
            }
          };
          controller.enqueue(
            encoder.encode('event: response.created\ndata: ' + JSON.stringify(createdEvent) + "\n\n")
          );

          // 2. Send response.output_item.added
          const itemAddedEvent = {
            type: "response.output_item.added",
            output_index: outputIndex,
            item: {
              id: itemId,
              type: "message",
              role: "assistant"
            }
          };
          controller.enqueue(
            encoder.encode('event: response.output_item.added\ndata: ' + JSON.stringify(itemAddedEvent) + "\n\n")
          );
        } else {
          // Chat Completions: send initial delta
          controller.enqueue(
            encoder.encode('data: ' + JSON.stringify({
              ...metadata,
              choices: [{ index: index, delta: { role: "assistant", content: "" }, finish_reason: null }]
            }) + "\n\n")
          );
        }

        while (!done) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;

          // Append new data to buffer
          const decoded = decoder.decode(value, { stream: true });
          buffer += decoded;

          chunkCount++;
          if (chunkCount <= 3) {
            console.log(`[Stream] Raw chunk ${chunkCount}:`, decoded.substring(0, 200));
          }

          // Cloudflare streams SSE format: "data: {...}\n\n"
          // Split by double newlines to get complete SSE events
          const parts = buffer.split('\n\n');

          // Keep the last incomplete part in buffer
          buffer = parts.pop() || "";

          for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            // Check for completion marker
            if (trimmed === 'data: [DONE]') {
              done = true;
              break;
            }

            // Parse SSE format: "data: {...}"
            if (trimmed.startsWith('data: ')) {
              try {
                const jsonStr = trimmed.slice(6).trim(); // Remove "data: " prefix
                if (!jsonStr || jsonStr === '[DONE]') continue;

                const parsed = JSON.parse(jsonStr);

                if (chunkCount <= 3) {
                  console.log(`[Stream] Parsed:`, JSON.stringify(parsed).substring(0, 200));
                }

                // Cloudflare returns different formats depending on the model:
                // 1. OpenAI-compatible: {choices: [{delta: {content: "text", reasoning_content: "..."}}]} (Qwen)
                // 2. Native Cloudflare: {response: "text", p: "..."} (Llama)

                const choice = parsed.choices?.[0];
                const delta = choice?.delta;

                // Handle OpenAI-compatible format (Qwen with reasoning)
                if (delta) {
                  // Debug: Log what we're receiving from Cloudflare
                  if (chunkCount <= 10) {
                    console.log(`[Stream Chunk ${chunkCount}] Full parsed:`, JSON.stringify(parsed));
                    console.log(`[Stream] Delta keys: ${Object.keys(delta).join(', ')}`);
                    const hasContent = delta.content !== undefined;
                    const hasReasoning = !!delta.reasoning_content;
                    const contentStr = hasContent ? `"${delta.content}"` : 'not present';
                    console.log(`[Stream] Has reasoning: ${hasReasoning}, Has content: ${hasContent}, Content: ${contentStr}`);
                    if (delta.reasoning_content) {
                      console.log(`[Stream] Reasoning content length: ${delta.reasoning_content.length}`);
                    }
                  }

                  // Build delta object - send reasoning_content and content in SEPARATE chunks
                  // This ensures Onyx can properly distinguish thinking from answer content

                  // Send reasoning_content first (if present AND model supports it)
                  if (isReasoningModel && delta.reasoning_content && typeof delta.reasoning_content === 'string') {
                    hasReasoningContent = true;
                    accumulatedReasoning += delta.reasoning_content;

                    if (isResponsesEndpoint) {
                      // Responses API format - use response.reasoning_text.delta for raw CoT
                      const reasoningEvent = buildResponsesEvent("response.reasoning_text.delta", {
                        delta: delta.reasoning_content
                      });
                      controller.enqueue(
                        encoder.encode('event: response.reasoning_text.delta\ndata: ' + JSON.stringify(reasoningEvent) + "\n\n")
                      );
                    } else {
                      // Chat Completions format
                      const reasoningChunk: any = {
                        ...metadata,
                        id: completionId,
                        choices: [{
                          index: index,
                          delta: { reasoning_content: delta.reasoning_content },
                          finish_reason: null
                        }]
                      };
                      controller.enqueue(
                        encoder.encode('data: ' + JSON.stringify(reasoningChunk) + "\n\n")
                      );
                    }
                  }

                  // Handle regular content separately (final response)
                  // Skip content if it looks like a tool call JSON and actual tool_calls are present
                  if (delta.content !== undefined && typeof delta.content === 'string') {
                    let content = delta.content;
                    totalContentLength += content.length;
                    accumulatedText += content;

                    // Check if this looks like a tool call JSON being output as text
                    const looksLikeToolCallJson = /^\s*\{["\s]*type["\s]*:["\s]*function/.test(content);

                    // Only send if not a duplicate tool call
                    if (!(looksLikeToolCallJson && delta.tool_calls && delta.tool_calls.length > 0)) {
                      if (looksLikeToolCallJson && delta.tool_calls && delta.tool_calls.length > 0 && chunkCount <= 3) {
                        console.log("[Stream] Skipping tool call JSON in content (actual tool_calls present)");
                      } else if (content.length > 0 || delta.content === "") {
                        // Send content in its own chunk
                        if (isResponsesEndpoint) {
                          // Responses API format
                          const contentEvent = buildResponsesEvent("response.output_text.delta", {
                            delta: content
                          });
                          controller.enqueue(
                            encoder.encode('event: response.output_text.delta\ndata: ' + JSON.stringify(contentEvent) + "\n\n")
                          );
                        } else {
                          // Chat Completions format
                          const contentChunk: any = {
                            ...metadata,
                            id: completionId,
                            choices: [{
                              index: index,
                              delta: { content: content },
                              finish_reason: null
                            }]
                          };
                          controller.enqueue(
                            encoder.encode('data: ' + JSON.stringify(contentChunk) + "\n\n")
                          );
                        }
                      }
                    }
                  }

                  // Only log when content is not a string (not the normal case)
                  if (delta.content !== undefined && typeof delta.content !== 'string') {
                    if (chunkCount <= 5) {
                      console.log(`[Stream] Content field present but not a string, type: ${typeof delta.content}, value:`, delta.content);
                    }
                  }

                  // Handle tool calls - FORWARD IMMEDIATELY without buffering
                  // This prevents slowness by not waiting for stream to end
                  if (delta.tool_calls && Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
                    console.log("[Stream] Tool calls detected:", JSON.stringify(delta.tool_calls));

                    if (isResponsesEndpoint) {
                      // Responses API format - use function_call_arguments.delta
                      for (const toolCall of delta.tool_calls) {
                        const callId = toolCall.id || `call_${crypto.randomUUID().split('-')[0]}`;
                        const functionCallEvent = buildResponsesEvent("response.function_call_arguments.delta", {
                          call_id: callId,
                          name: toolCall.function?.name,
                          delta: toolCall.function?.arguments || ""
                        });

                        // Track tool calls for .done event
                        if (!accumulatedToolCalls.find(tc => tc.id === callId)) {
                          accumulatedToolCalls.push({
                            id: callId,
                            name: toolCall.function?.name || "",
                            arguments: toolCall.function?.arguments || ""
                          });
                        } else {
                          // Append to existing
                          const existing = accumulatedToolCalls.find(tc => tc.id === callId);
                          if (existing) {
                            existing.arguments += toolCall.function?.arguments || "";
                          }
                        }

                        controller.enqueue(
                          encoder.encode('data: ' + JSON.stringify(functionCallEvent) + "\n\n")
                        );
                      }
                    } else {
                      // Chat Completions format - forward as-is
                      controller.enqueue(
                        encoder.encode(
                          'data: ' + JSON.stringify({
                            ...metadata,
                            id: completionId,
                            choices: [{
                              index: index,
                              delta: { tool_calls: delta.tool_calls },
                              finish_reason: null
                            }]
                          }) + "\n\n"
                        )
                      );
                    }
                  }

                  // Check for chunks with no meaningful content (empty delta with no finish_reason)
                  const hasMeaningfulContent = delta.reasoning_content || delta.content !== undefined || (delta.tool_calls && delta.tool_calls.length > 0);
                  if (!hasMeaningfulContent && chunkCount <= 10) {
                    console.log(`[Stream] Chunk ${chunkCount} has empty delta (likely just tracking chunk), keys:`, Object.keys(delta));
                  }
                }
                // Handle Cloudflare native format (Llama and other models)
                else if (parsed.response && typeof parsed.response === 'string') {
                  // Transform Cloudflare's {response: "text"} to OpenAI's delta format
                  if (chunkCount <= 5) {
                    console.log(`[Stream] CF native format, sending: "${parsed.response.substring(0, 50)}"`);
                  }

                  const nativeContentChunk: any = {
                    ...metadata,
                    id: completionId,
                    choices: [{
                      index: index,
                      delta: { content: parsed.response },
                      finish_reason: null
                    }]
                  };

                  // Responses API requires 'type' field
                  if (isResponsesEndpoint) {
                    nativeContentChunk.type = "response.output_text.delta";
                  }

                  controller.enqueue(
                    encoder.encode('data: ' + JSON.stringify(nativeContentChunk) + "\n\n")
                  );
                }
                // Handle tool calls in native Cloudflare format
                else if (parsed.tool_calls && Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
                  console.log("[Stream] Tool calls (CF native):", JSON.stringify(parsed.tool_calls));

                  if (isResponsesEndpoint) {
                    // Responses API format
                    for (const tc of parsed.tool_calls) {
                      const callId = `call_${crypto.randomUUID().split('-')[0]}`;
                      const args = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments);

                      const functionCallEvent = buildResponsesEvent("response.function_call_arguments.delta", {
                        call_id: callId,
                        name: tc.name,
                        delta: args
                      });

                      // Track for .done event
                      accumulatedToolCalls.push({
                        id: callId,
                        name: tc.name,
                        arguments: args
                      });

                      controller.enqueue(
                        encoder.encode('data: ' + JSON.stringify(functionCallEvent) + "\n\n")
                      );
                    }
                  } else {
                    // Chat Completions format
                    const openaiToolCalls = parsed.tool_calls.map((tc: any, idx: number) => ({
                      index: idx,
                      id: `call_${crypto.randomUUID().split('-')[0]}`,
                      type: "function",
                      function: {
                        name: tc.name,
                        arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
                      }
                    }));

                    const nativeToolCallChunk: any = {
                      ...metadata,
                      id: completionId,
                      choices: [{
                        index: index,
                        delta: { tool_calls: openaiToolCalls },
                        finish_reason: null
                      }]
                    };
                    controller.enqueue(
                      encoder.encode('data: ' + JSON.stringify(nativeToolCallChunk) + "\n\n")
                    );
                  }
                }

                // Check for finish (both formats)
                if (choice?.finish_reason || parsed.response === null || parsed.finish_reason) {
                  const finishReason = choice?.finish_reason || parsed.finish_reason || 'unknown';
                  console.log(`[Stream] Stream finished with reason: ${finishReason}`);

                  // Warn if model stopped with minimal content (common issue after tool calls with Qwen)
                  if (finishReason === 'stop' && totalContentLength < 10 && !hasReasoningContent) {
                    console.warn(`[Stream] WARNING: Model stopped with only ${totalContentLength} chars of content. This may indicate a model error after tool calls.`);
                    console.warn(`[Stream] Consider using a different model or adjusting the prompt to encourage continuation.`);
                  }

                  // Flush any remaining buffered tool calls
                  if (Object.keys(toolCallBuffer).length > 0) {
                    const remainingToolCalls = Object.values(toolCallBuffer).map(tc => ({
                      index: tc.index || 0,
                      id: tc.id || `call_${crypto.randomUUID().split('-')[0]}`,
                      type: tc.type || "function",
                      function: tc.function || { name: "", arguments: "{}" }
                    }));

                    console.log("[Stream] Flushing remaining buffered tool calls at finish:", JSON.stringify(remainingToolCalls));

                    const bufferedToolCallChunk: any = {
                      ...metadata,
                      id: completionId,
                      choices: [{
                        index: index,
                        delta: { tool_calls: remainingToolCalls },
                        finish_reason: null
                      }]
                    };

                    // Responses API requires 'type' field in streaming chunks
                    if (isResponsesEndpoint) {
                      bufferedToolCallChunk.type = "response.function_call_arguments.done";
                    }

                    controller.enqueue(
                      encoder.encode('data: ' + JSON.stringify(bufferedToolCallChunk) + "\n\n")
                    );
                    toolCallBuffer = {};
                  }

                  done = true;
                  break;
                }
              } catch (err) {
                // JSON parse error - chunk might be incomplete
                if (chunkCount <= 5) {
                  console.log("[Stream] Parse error (chunk may be incomplete):", trimmed.substring(0, 100));
                }
              }
            }
          }
        }

        // Process any remaining data in buffer
        if (buffer.trim()) {
          const trimmed = buffer.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const jsonStr = trimmed.slice(6).trim();
              if (jsonStr && jsonStr !== '[DONE]') {
                const parsed = JSON.parse(jsonStr);
                const choice = parsed.choices?.[0];
                const delta = choice?.delta;

                // Handle OpenAI-compatible format
                if (delta?.content && typeof delta.content === 'string') {
                  accumulatedText += delta.content;

                  if (isResponsesEndpoint) {
                    const bufferEvent = buildResponsesEvent("response.output_text.delta", {
                      item_id: itemId,
                      delta: delta.content
                    });
                    controller.enqueue(
                      encoder.encode('event: response.output_text.delta\ndata: ' + JSON.stringify(bufferEvent) + "\n\n")
                    );
                  } else {
                    const bufferContentChunk: any = {
                      ...metadata,
                      id: completionId,
                      choices: [{
                        index: index,
                        delta: { content: delta.content },
                        finish_reason: null,
                        logprobs: null
                      }]
                    };
                    controller.enqueue(
                      encoder.encode('data: ' + JSON.stringify(bufferContentChunk) + "\n\n")
                    );
                  }
                }
                // Handle Cloudflare native format
                else if (parsed.response && typeof parsed.response === 'string') {
                  accumulatedText += parsed.response;

                  if (isResponsesEndpoint) {
                    const bufferEvent = buildResponsesEvent("response.output_text.delta", {
                      item_id: itemId,
                      delta: parsed.response
                    });
                    controller.enqueue(
                      encoder.encode('event: response.output_text.delta\ndata: ' + JSON.stringify(bufferEvent) + "\n\n")
                    );
                  } else {
                    const bufferNativeChunk: any = {
                      ...metadata,
                      id: completionId,
                      choices: [{
                        index: index,
                        delta: { content: parsed.response },
                        finish_reason: null,
                        logprobs: null
                      }]
                    };
                    controller.enqueue(
                      encoder.encode('data: ' + JSON.stringify(bufferNativeChunk) + "\n\n")
                    );
                  }
                }
              }
            } catch (err) {
              // Ignore final buffer parse errors
            }
          }
        }

        // Send final completion event
        console.log("[Stream] Sending final finish_reason: stop");

        if (isResponsesEndpoint) {
          // Responses API: send .done events for accumulated content

          // Send response.reasoning_text.done for reasoning if we had any (raw CoT)
          if (accumulatedReasoning) {
            const reasoningDone = buildResponsesEvent("response.reasoning_text.done", {
              text: accumulatedReasoning
            });
            controller.enqueue(
              encoder.encode('event: response.reasoning_text.done\ndata: ' + JSON.stringify(reasoningDone) + "\n\n")
            );
            console.log("[Stream] Sent reasoning text.done, length:", accumulatedReasoning.length);
          }

          // Send response.output_text.done for regular content if we had any
          if (accumulatedText) {
            const textDone = buildResponsesEvent("response.output_text.done", {
              text: accumulatedText
            });
            controller.enqueue(
              encoder.encode('event: response.output_text.done\ndata: ' + JSON.stringify(textDone) + "\n\n")
            );
            console.log("[Stream] Sent content text.done, length:", accumulatedText.length);
          }

          // Send response.function_call_arguments.done for each tool call
          for (const toolCall of accumulatedToolCalls) {
            const functionDone = buildResponsesEvent("response.function_call_arguments.done", {
              call_id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments
            });
            controller.enqueue(
              encoder.encode('event: response.function_call_arguments.done\ndata: ' + JSON.stringify(functionDone) + "\n\n")
            );
            console.log("[Stream] Sent function_call.done for:", toolCall.name);
          }

          // Send response.output_item.done
          const itemDoneEvent = {
            type: "response.output_item.done",
            output_index: outputIndex,
            item: {
              id: itemId,
              type: "message",
              role: "assistant",
              status: "completed"
            }
          };
          controller.enqueue(
            encoder.encode('event: response.output_item.done\ndata: ' + JSON.stringify(itemDoneEvent) + "\n\n")
          );

          // Send response.completed event (final event before [DONE])
          const completedEvent = {
            type: "response.completed",
            response: {
              id: responseId,
              object: "response",
              created_at: Math.floor(timestamp / 1000),
              model: model,
              status: "completed",
              output: [{
                id: itemId,
                type: "message",
                role: "assistant",
                status: "completed",
                content: [{
                  type: "output_text",
                  text: accumulatedText || ""
                }]
              }],
              usage: {
                input_tokens: Math.ceil(totalContentLength / 4),
                output_tokens: Math.ceil((accumulatedText?.length || 0) / 4),
                total_tokens: Math.ceil((totalContentLength + (accumulatedText?.length || 0)) / 4)
              }
            }
          };
          controller.enqueue(
            encoder.encode('event: response.completed\ndata: ' + JSON.stringify(completedEvent) + "\n\n")
          );
        } else {
          // Chat Completions format
          const finalChunk: any = {
            ...metadata,
            id: completionId,
            choices: [{
              index: index,
              delta: {},
              finish_reason: "stop",
              logprobs: null
            }]
          };
          controller.enqueue(
            encoder.encode('data: ' + JSON.stringify(finalChunk) + "\n\n")
          );
        }

        // ✅ Send usage data chunk (only for Chat Completions API)
        // Note: Cloudflare doesn't provide token counts in streaming, so we estimate
        // Responses API doesn't use separate usage chunks - usage is in the final .done event
        if (!isResponsesEndpoint) {
          const estimatedPromptTokens = Math.ceil(totalContentLength / 4); // rough estimate
          const estimatedCompletionTokens = Math.ceil(totalContentLength / 4);
          controller.enqueue(
            encoder.encode(
              'data: ' + JSON.stringify({
                id: completionId,
                object: "chat.completion.chunk",
                created: Math.floor(timestamp / 1000),
                model,
                choices: [],
                usage: {
                  prompt_tokens: estimatedPromptTokens,
                  completion_tokens: estimatedCompletionTokens,
                  total_tokens: estimatedPromptTokens + estimatedCompletionTokens
                }
              }) + "\n\n"
            )
          );
        }

        // ✅ Send [DONE] terminator (required by OpenAI spec)
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        console.log("[Stream] Sent [DONE] terminator");

        // Close the stream
        controller.close();
        console.log("[Stream] Stream closed successfully");
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  },


  /**
   * ✅ CANONICAL OpenAI Chat Response Builder
   *
   * This is the ONLY place where we format responses as OpenAI chat.completion objects.
   * ALL model responses (GPT-OSS, Mistral, Llama, Qwen) must be wrapped through this function.
   *
   * GOLDEN RULE: Every response from this function satisfies:
   * - choices[0].message.role === "assistant"
   * - choices[0].message.content is never null (min: " " space character)
   * - If tool_calls present: finish_reason === "tool_calls" AND content === null
   * - If no tool_calls: finish_reason === "stop"
   */
  buildOpenAIChatResponse(
    text: string | null | undefined,
    model: string,
    toolCalls?: any[],
    reasoningContent?: string,
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  ): Record<string, any> {
    // ✅ EMPTY TEXT PROTECTION: Never allow null/undefined content
    // Default to space character if empty
    let messageContent = text;
    if (!messageContent || messageContent.trim().length === 0) {
      console.log("[Builder] Empty content detected, using fallback space character");
      messageContent = " ";
    }

    // ✅ Transform Cloudflare tool_calls format to OpenAI format
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

    // ✅ OpenAI spec: content is null when tool_calls are present
    const finalContent = openaiToolCalls ? null : messageContent;

    // ✅ REASONING MODELS: Only include reasoning_content for actual reasoning models
    // Check if the requested model is a reasoning model (o1, o3 series)
    const isReasoningModel = REASONING_MODELS.some(rm => model.toLowerCase().includes(rm.toLowerCase()));
    const shouldIncludeReasoning = isReasoningModel && reasoningContent;

    if (reasoningContent && !isReasoningModel) {
      console.log(`[Builder] Stripping reasoning_content - ${model} is not a reasoning model`);
    }

    // ✅ Build canonical OpenAI response
    const response = {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: "assistant",  // ✅ ALWAYS "assistant"
          content: finalContent,  // ✅ NEVER null (except for tool_calls), never undefined
          ...(shouldIncludeReasoning && { reasoning_content: reasoningContent }),
          ...(openaiToolCalls && { tool_calls: openaiToolCalls })
        },
        finish_reason: openaiToolCalls ? "tool_calls" : "stop",
        logprobs: null  // ✅ Required field - null when not requested (per OpenAI spec)
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
  },

  /**
   * Build OpenAI Responses API format response
   * - Models stopping prematurely after tool results
   */

  /**
   * Handle /v1/responses endpoint
   *
   * OpenAI Responses API - Full compatibility with OpenAI-style parameters
   * https://developers.openai.com/api/reference/responses
   *
   * Key differences from Chat Completions:
   * - Input format: input_items (not messages)
   * - Conversation support: conversation_id for multi-turn
   * - Modular response: returns items array with structured outputs
   * - Additional features: reasoning, tool_calls, tool_results
   */
  async handleResponses(request: Request, env: Env): Promise<Response> {
    const startTime = Date.now();

    try {
      const data = await request.json() as any;

      console.log(`[Responses] Request keys:`, Object.keys(data).join(', '));
      console.log(`[Responses] Model: ${data.model}, model_id: ${data.model_id}, stream: ${data.stream}`);

      // Responses API parameter mapping
      const requestParams = {
        temperature: data.temperature ?? 1.0,
        top_p: data.top_p ?? 1.0,
        max_output_tokens: data.max_tokens || data.max_output_tokens || null,
        tool_choice: data.tool_choice ?? "auto",
        tools: data.tools ?? [],
        store: data.store ?? true,
        truncation: data.truncation ?? "disabled"
      };

      // Extract model - Responses API can use either 'model' or 'model_id'
      const requestedModel = data.model || data.model_id;

      // Responses API uses 'input_items' instead of 'messages'
      // input_items format: [{type: "message", role: "user", content: [...]}]
      let messages: ChatMessage[] = [];

      if (data.input_items && Array.isArray(data.input_items)) {
        console.log(`[Responses] Converting ${data.input_items.length} input items to messages`);

        messages = data.input_items.map((item: any) => {
          if (item.type === "message" && item.role) {
            // Extract text from content array
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
              role: item.role as ChatMessageRole,
              content: contentText || " "
            };
          }
          return { role: "user" as ChatMessageRole, content: " " };
        });
      } else if (data.messages && Array.isArray(data.messages)) {
        // Fallback: support Chat Completions-style messages for compatibility
        console.log(`[Responses] Using messages array (Chat Completions style)`);
        messages = data.messages;
      } else if (data.input) {
        // LiteLLM simplified format: { input: "text" }
        console.log(`[Responses] Converting 'input' field to messages`);
        if (typeof data.input === 'string') {
          messages = [{ role: "user" as ChatMessageRole, content: data.input }];
        } else if (Array.isArray(data.input)) {
          // Handle array of messages
          messages = data.input.map((msg: any) => {
            if (typeof msg === 'string') {
              return { role: "user" as ChatMessageRole, content: msg };
            } else if (msg.role && msg.content) {
              return { role: msg.role as ChatMessageRole, content: msg.content };
            }
            return { role: "user" as ChatMessageRole, content: String(msg) };
          });
        }
      }

      // Validate we have at least one message
      if (messages.length === 0) {
        return errorResponse("No input_items, messages, or input provided", 400, "invalid_request_error");
      }

      // Build OpenAI-compatible request from Responses API parameters
      const openaiRequest: OpenAiChatCompletionReq = {
        model: requestedModel || env.DEFAULT_AI_MODEL,
        messages,
        // Map Responses API parameters to OpenAI Chat Completions equivalents
        temperature: data.temperature,
        top_p: data.top_p,
        max_tokens: data.max_tokens || data.max_output_tokens,
        stream: data.stream ?? false,
        // Tool-related parameters
        ...(data.tools && { tools: data.tools }),
        ...(data.tool_choice && { tool_choice: data.tool_choice }),
      };

      // Validate and normalize for Onyx compatibility
      const validatedData = validateAndNormalizeRequest(openaiRequest, env);

      // Transform to Cloudflare format
      const { model, options } = transformChatCompletionRequest(validatedData, env);
      console.log("[Responses] Model in use:", model, 'Stream:', options?.stream);

      // Log tools being sent to Cloudflare (for debugging)
      if (options?.tools && options.tools.length > 0) {
        console.log(`[Responses] Sending ${options.tools.length} tools to Cloudflare AI`);
        console.log(`[Responses] Tool names: ${options.tools.map((t: any) => t.function?.name).join(', ')}`);
      }

      // Call Cloudflare AI
      const aiRes = await env.AI.run(model, options);

      // Handle streaming response
      if (options.stream && aiRes instanceof ReadableStream) {
        console.log(`[Responses] Returning streaming response`);
        return await this.chatStreamResponse(aiRes, model, true); // true = isResponsesEndpoint
      }

      // Handle non-streaming response
      return this.handleChatCompletionResponse(aiRes, model, options, startTime, true, validatedData);

    } catch (error) {
      console.error(`[Responses] Error:`, error);
      return errorResponse(
        "Response generation failed",
        500,
        "api_error",
        (error as Error).message
      );
    }
  },


};
