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

import { textGenerationModels } from "./models";

// Version for deployment tracking
const PROXY_VERSION = "1.9.18"; // Updated: 2026-02-14 - ENHANCEMENT: Responses API now properly handles tool_calls and reasoning.summary fields

let globalModels: ModelType[] = [];

// Models that support reasoning_content field (thinking/reasoning process)
// Standard models (gpt-4, gpt-4o, gpt-3.5-turbo) should NOT include reasoning_content
const REASONING_MODELS = [
  'o1-preview',
  'o1-mini',
  'o3-mini',
  'o1',
  'o3',
  'glm-4',  // GLM-4.7-flash supports reasoning_content
  'qwen'    // Qwen models support reasoning_content
];

// Models that support tool calling in Cloudflare Workers AI
// NOTE: Llama models output tool calls as plain text JSON, not structured tool_calls
// NOTE: GPT-OSS does NOT support tools on Cloudflare Workers AI (platform limitation)
// NOTE: Mistral Small 3.1 claims to support tools but actually ignores them and generates text
const TOOL_CAPABLE_MODELS = [
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
const GPT_OSS_MODELS = [
  '@cf/openai/gpt-oss-20b',
  '@cf/openai/gpt-oss-120b',
];

// Model aliases for Onyx compatibility (maps OpenAI model names to CF models)
const MODEL_ALIASES: Record<string, string> = {
  // Use Qwen for GPT-4 aliases since it properly supports function calling
  'gpt-4': '@cf/qwen/qwen3-30b-a3b-fp8',
  'gpt-4-turbo': '@cf/qwen/qwen3-30b-a3b-fp8',
  'gpt-4o': '@cf/qwen/qwen3-30b-a3b-fp8',
  'gpt-4o-mini': '@cf/meta/llama-3-8b-instruct',  // Smaller model for simple tasks
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
const MODEL_MAX_TOKENS: Record<string, number> = {
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] [v${PROXY_VERSION}] ${request.method} ${url.pathname}`);

    // Health endpoint - no auth required
    if (url.pathname === '/health' && request.method === 'GET') {
      return this.handleHealth(env);
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
          return this.displayModelsInfo(env, request);
        }

        console.error(`[Auth] Authentication failed - key mismatch`);
        return this.errorResponse(
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
          response = await this.handleListModels(env);
          break;
        case url.pathname === '/v1/chat/completions' && request.method === 'POST':
          response = await this.handleChatCompletions(request, env);
          break;
        case url.pathname === '/v1/responses' && request.method === 'POST':
          response = await this.handleResponses(request, env);
          break;
        case url.pathname === '/v1/images/generations' && request.method === 'POST':
          response = await this.handleImageGeneration(request, env);
          break;
        case url.pathname === '/v1/embeddings' && request.method === 'POST':
          response = await this.handleEmbeddings(request, env);
          break;
        case url.pathname.startsWith('/v1/assistants'):
          response = await this.handleAssistants(request, env, url);
          break;
        case url.pathname.startsWith('/v1/threads'):
          response = await this.handleThreads(request, env, url);
          break;
        default:
          response = this.errorResponse("Not found", 404, "not_found_error");
      }

      const latency = Date.now() - startTime;
      console.log(`[${new Date().toISOString()}] ${url.pathname} completed in ${latency}ms`);
      return response;
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Unhandled error:`, error);
      return this.errorResponse(
        "Internal server error",
        500,
        "api_error",
        (error as Error).message
      );
    }
  },

  /**
   * Health check endpoint for monitoring
   */
  async handleHealth(env: Env): Promise<Response> {
    const health: { status: string; timestamp: string; providers: { workers_ai: string } } = {
      status: "ok",
      timestamp: new Date().toISOString(),
      providers: {
        workers_ai: "up"
      }
    };

    // Optionally check if AI binding is available
    try {
      if (env.AI) {
        health.providers.workers_ai = "up";
      }
    } catch {
      health.providers.workers_ai = "down";
      health.status = "degraded";
    }

    return new Response(JSON.stringify(health), {
      status: health.status === "ok" ? 200 : 503,
      headers: { 'Content-Type': 'application/json' }
    });
  },

  async handleListModels(env: Env) {
    const models = await this.listAIModels(env);

    // Return OpenAI-compatible model list with minimal fields per specification
    // Onyx expects: id, object
    const openaiModels = models.map(m => ({
      id: m.id || m.name,
      object: "model"
    }));

    return new Response(JSON.stringify({
      object: "list",
      data: openaiModels
    }), { headers: { 'Content-Type': 'application/json' } });
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
      const validatedData = this.validateAndNormalizeRequest(data, env);


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

      const { model, options } = this.transformChatCompletionRequest(validatedData, env);
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
      return this.errorResponse(
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
        const openAiResponse = this.extractOpenAiCompatibleResponse(aiRes as any, model);

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
        const gptOssResponse = this.extractGptOssResponse(aiRes as any);
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
        const sanitizedRes = this.sanitizeAiResponse(aiRes);
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
      return this.errorResponse(
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
  extractGptOssResponse(res: any): AiJsonResponse {
    try {
      console.log("[GPT-OSS] Full response:", JSON.stringify(res).substring(0, 1000));

      // GPT-OSS format has output array with different types
      if (!res.output || !Array.isArray(res.output)) {
        console.warn("[GPT-OSS] No output array found");
        return {
          response: " ",
          contentType: "application/json",
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
      }

      console.log("[GPT-OSS] Output array length:", res.output.length);
      res.output.forEach((item: any, idx: number) => {
        console.log(`[GPT-OSS] Output[${idx}] type:`, item.type, "has content:", !!item.content);
      });

      // Look for message type content (skip reasoning)
      let responseText = "";
      // ✅ FIX 5: Removed tool_calls extraction - GPT-OSS on Cloudflare NEVER emits tool_calls

      for (const item of res.output) {
        if (item.type === "message" && item.content && Array.isArray(item.content)) {
          console.log("[GPT-OSS] Found message type, content array length:", item.content.length);
          // Extract text from message content
          for (const contentItem of item.content) {
            console.log("[GPT-OSS] Message content item:", JSON.stringify(contentItem).substring(0, 200));
            // Content items may have text directly without a type field
            if (contentItem.text) {
              responseText += contentItem.text;
              console.log("[GPT-OSS] Extracted message text, current length:", responseText.length);
            }
          }
        }
        // ❌ REMOVED: tool_calls extraction - GPT-OSS on Cloudflare does NOT support tools
        // if (item.type === "tool_calls") { ... }
      }

      console.log("[GPT-OSS] After message extraction, responseText length:", responseText.length);

      // If no message found, check reasoning as fallback
      if (!responseText) {
        console.log("[GPT-OSS] No message type found, using reasoning content");
        for (const item of res.output) {
          if (item.type === "reasoning" && item.content && Array.isArray(item.content)) {
            console.log("[GPT-OSS] Found reasoning content array, length:", item.content.length);
            for (const contentItem of item.content) {
              console.log("[GPT-OSS] Content item:", JSON.stringify(contentItem).substring(0, 200));
              // Content items may have text directly without a type field
              if (contentItem.text) {
                responseText += contentItem.text;
              }
            }
            if (responseText) {
              console.log("[GPT-OSS] Extracted reasoning text, length:", responseText.length);
              break;
            }
          }
        }
      }

      // Estimate token usage (GPT-OSS doesn't provide this in standard format)
      // Use response object's usage field if available, otherwise estimate
      let usage = res.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      };

      // If no valid usage data, estimate from content
      if (!usage.prompt_tokens && !usage.completion_tokens) {
        usage.prompt_tokens = Math.ceil(((res.instructions || "") + (res.input || "")).length / 4);
        usage.completion_tokens = Math.ceil(responseText.length / 4);
        usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
        console.log("[GPT-OSS] Estimated token usage - prompt:", usage.prompt_tokens, "completion:", usage.completion_tokens);
      }

      // ✅ VALIDATION: Ensure response is never empty
      if (!responseText || responseText.trim().length === 0) {
        console.warn("[GPT-OSS] No text content extracted, using fallback");
        responseText = " ";
      }

      return {
        response: responseText || " ",
        contentType: "application/json",
        usage: usage
        // ❌ REMOVED: tool_calls - GPT-OSS on Cloudflare NEVER emits tool_calls
      };
    } catch (error) {
      console.error("[GPT-OSS] Error extracting response:", error);
      return {
        response: " ",
        contentType: "application/json",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    }
  },

  /**
   * Sanitize AI response to ensure it has valid content
   * Handles cases where Cloudflare returns invalid characters or numbers instead of strings
   */
  sanitizeAiResponse(res: any): AiJsonResponse {
    console.log("[Sanitize] Ensuring response has valid content");

    // ✅ VALIDATION: Ensure response field exists and is valid
    let response = res.response;

    // Step 1: Handle null/undefined
    if (response === null || response === undefined) {
      console.warn("[Sanitize] Response is null/undefined, using space");
      response = " ";
    }
    // Step 2: Convert non-strings to strings
    else if (typeof response !== 'string') {
      console.warn(`[Sanitize] Response is ${typeof response}, converting to string`);
      response = String(response);
    }

    // Step 3: Handle empty strings
    if (!response || response.trim().length === 0) {
      console.warn("[Sanitize] Response is empty, using space");
      response = " ";
    }

    // ✅ Ensure tool_calls are valid if present
    let toolCalls = res.tool_calls;
    if (toolCalls && !Array.isArray(toolCalls)) {
      console.warn("[Sanitize] tool_calls is not an array, clearing");
      toolCalls = undefined;
    } else if (toolCalls && toolCalls.length === 0) {
      console.log("[Sanitize] tool_calls array is empty, clearing");
      toolCalls = undefined;
    }

    return {
      response,
      contentType: res.contentType || "application/json",
      usage: res.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      ...(toolCalls && { tool_calls: toolCalls })
    };
  },

  /**
   * Extract response from OpenAI-compatible format that Cloudflare now returns
   * This handles responses with choices array, and supports reasoning_content field
   */
  extractOpenAiCompatibleResponse(res: any, model: string): AiJsonResponse {
    try {
      console.log("[OpenAI-Compat] Full response:", JSON.stringify(res).substring(0, 1000));

      // Validate response structure
      if (!res.choices || !Array.isArray(res.choices) || res.choices.length === 0) {
        console.warn("[OpenAI-Compat] No choices array found or empty");
        return {
          response: " ",
          contentType: "application/json",
          usage: res.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
      }

      const firstChoice = res.choices[0];
      const message = firstChoice?.message;

      if (!message) {
        console.warn("[OpenAI-Compat] No message in first choice");
        return {
          response: " ",
          contentType: "application/json",
          usage: res.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
      }

      // Extract content - check reasoning_content first, then content
      let responseText = "";
      let reasoningContent = "";

      // Extract reasoning_content separately (the "thinking" part)
      if (message.reasoning_content && typeof message.reasoning_content === 'string') {
        console.log("[OpenAI-Compat] Found reasoning_content, length:", message.reasoning_content.length);
        reasoningContent = message.reasoning_content;
      }

      // Extract regular content (the final answer)
      if (message.content && typeof message.content === 'string') {
        console.log("[OpenAI-Compat] Found content, length:", message.content.length);
        responseText = message.content;
      }
      // If no content but we have tool_calls, handle that
      else if (message.tool_calls && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        console.log("[OpenAI-Compat] No content but found tool_calls:", message.tool_calls.length);
        // Transform tool calls to CF format
        const toolCalls = message.tool_calls.map((tc: any) => ({
          name: tc.function?.name || tc.name,
          arguments: typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function?.arguments || tc.arguments
        }));

        return {
          response: "", // Empty for tool calls
          contentType: "application/json",
          usage: res.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          tool_calls: toolCalls,
          ...(reasoningContent && { reasoning_content: reasoningContent })
        };
      }

      console.log("[OpenAI-Compat] Final response text length:", responseText.length, "reasoning length:", reasoningContent.length);

      // ✅ Ensure usage data is always provided with realistic estimates
      let usage = res.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      };

      // Check if model is a reasoning model
      const isReasoningModel = REASONING_MODELS.some(rm => model.toLowerCase().includes(rm.toLowerCase()));

      // If Cloudflare returns all zeros OR missing values, estimate from actual content
      if ((usage.prompt_tokens === 0 || !usage.prompt_tokens) && (usage.completion_tokens === 0 || !usage.completion_tokens)) {
        // For reasoning models, count both response and reasoning
        // For non-reasoning models, only count the actual response (reasoning is internal/stripped)
        const contentForUsage = isReasoningModel
          ? responseText.length + reasoningContent.length
          : responseText.length;

        // Rough estimate: ~4 characters per token
        usage.prompt_tokens = 10;  // Minimum for test request
        usage.completion_tokens = Math.max(1, Math.ceil(contentForUsage / 4));
        usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
        console.log(`[OpenAI-Compat] Estimated usage for ${isReasoningModel ? 'reasoning' : 'non-reasoning'} model - prompt:`, usage.prompt_tokens, "completion:", usage.completion_tokens, "from text length:", contentForUsage);
      }
      // IMPORTANT: If this is a non-reasoning model but we have reasoning content,
      // Cloudflare's token count includes the reasoning we're about to strip.
      // We need to recalculate to match the actual visible content only.
      else if (!isReasoningModel && reasoningContent.length > 0) {
        // Cloudflare counted reasoning + response, but we're stripping reasoning
        // Recalculate based on actual visible content only
        const visibleTokens = Math.max(1, Math.ceil(responseText.length / 4));
        console.log(`[OpenAI-Compat] Adjusting token count for non-reasoning model - original completion_tokens: ${usage.completion_tokens}, adjusted to: ${visibleTokens} (reasoning stripped)`);
        usage.completion_tokens = visibleTokens;
        usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
      }

      // ✅ VALIDATION: Ensure response is never empty
      if (!responseText || responseText.trim().length === 0) {
        console.warn("[OpenAI-Compat] No text content extracted, using fallback");
        responseText = " ";
      }

      return {
        response: responseText,
        contentType: "application/json",
        usage: usage,
        ...(reasoningContent && { reasoning_content: reasoningContent })
      };
    } catch (error) {
      console.error("[OpenAI-Compat] Error extracting response:", error);
      return {
        response: " ",  // ✅ FALLBACK: Always return at least a space
        contentType: "application/json",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    }
  },


  async handleEmbeddings(request: Request, env: Env): Promise<Response> {
    try {
      const data = await request.json() as OpenAiEmbeddingReq;
      const { model: requestedModel, input, encoding_format } = data;
      const model = this.getCfModelName(requestedModel, env);


      // Validation
      if (!model || !input) {
        return this.errorResponse("Model and input are required", 400);
      }

      // Check if valid embedding model
      const models = await this.listAIModels(env);
      const modelInfo = models.find(m =>
        m.name === model && m.taskName === 'Text Embeddings'
      );
      if (!modelInfo) {
        return this.errorResponse("Invalid embedding model", 400);
      }

      // Convert OpenAI-style input to Cloudflare's text format
      const texts = Array.isArray(input) ? input : [input];
      if (texts.some(t => typeof t !== 'string' || t.length === 0)) {
        return this.errorResponse("Invalid input format", 400);
      }

      // Create Cloudflare AI options
      const options: AiEmbeddingInputOptions = { text: texts };

      // Get embeddings from Cloudflare AI
      const aiRes = await env.AI.run(model, options);

      if (!('data' in aiRes) || !aiRes?.data || !Array.isArray(aiRes.data)) {
        return this.errorResponse("Failed to generate embeddings", 500);
      }

      // Convert to OpenAI format
      const embeddings: OpenAiEmbeddingObject[] = aiRes.data.map((vector, index) => ({
        object: 'embedding',
        index,
        embedding: encoding_format === 'base64'
          ? this.floatArrayToBase64(vector)
          : vector
      }));

      // Estimate token usage (approximate)
      const promptTokens = texts.join(' ').split(/\s+/).length;

      return new Response(JSON.stringify({
        object: 'list',
        data: embeddings,
        model: requestedModel, // Return the requested model name (e.g., text-embedding-ada-002)
        usage: {
          prompt_tokens: promptTokens,
          total_tokens: promptTokens
        }
      } as OpenAiEmbeddingRes), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      return this.errorResponse("Embedding failed", 500, (error as Error).message);
    }
  },

  async handleImageGeneration(request: Request, env: Env): Promise<Response> {
    try {
      const data = await request.json() as OpenAiImageGenerationReq;
      const { model: requestedModel, prompt, n = 1, response_format = 'url', size } = data;
      const model = this.getCfModelName(requestedModel, env);

      console.log(`[Image] Request to generate image with model: ${model}, prompt length: ${prompt?.length || 0}`);

      // Validation
      if (!model || !prompt) {
        return this.errorResponse("Model and prompt are required", 400);
      }

      // Check if valid image generation model
      const models = await this.listAIModels(env);
      let modelInfo = models.find(m =>
        m.name === model && (m.taskName === 'Image Generation' || m.name.includes('flux'))
      );

      // Fallback: check if it's a known image generation model even if not in the list
      if (!modelInfo && model.includes('flux')) {
        console.log(`[Image] Model ${model} not in list but recognized as Flux image model - proceeding`);
        // Allow known image models to proceed even if not in the fetched list
        modelInfo = { name: model, taskName: 'Image Generation' } as any;
      }

      if (!modelInfo) {
        console.log(`[Image] Model ${model} not found or not an image generation model`);
        return this.errorResponse("Invalid image generation model", 400);
      }

      // Cloudflare Flux models require multipart format
      // We need to create a FormData object and convert it to the proper format
      const form = new FormData();
      form.append('prompt', prompt);

      // Parse size parameter (e.g., "1024x1024") and add dimensions
      if (size) {
        const [width, height] = size.split('x').map(s => s.trim());
        if (width) form.append('width', width);
        if (height) form.append('height', height);
      } else {
        // Default dimensions for Flux
        form.append('width', '1024');
        form.append('height', '1024');
      }

      console.log(`[Image] Calling Cloudflare AI.run with model ${model}`);

      // Get image from Cloudflare AI using multipart
      // We need to create a Request object to get the proper multipart body
      const dummyRequest = new Request('http://dummy', {
        method: 'POST',
        body: form
      });

      let aiRes;
      try {
        aiRes = await env.AI.run(model, {
          multipart: {
            body: dummyRequest.body,
            contentType: dummyRequest.headers.get('content-type') || 'multipart/form-data'
          }
        });
      } catch (error: any) {
        const errorMsg = (error as Error).message;
        const errorType = error?.constructor?.name || typeof error;

        console.error(`[Image] Failed to call Cloudflare AI with model ${model}`);
        console.error(`[Image] Error type: ${errorType}`);
        console.error(`[Image] Error message: ${errorMsg}`);

        // Check if it's an authentication error
        if (errorMsg.includes('AuthenticationError') || errorMsg.includes('authentication') || errorMsg.includes('unauthorized') || errorMsg.includes('401') || errorMsg.includes('403')) {
          console.error(`[Image] Authentication error - check Cloudflare Workers AI credentials and account permissions`);
          return this.errorResponse(
            "Authentication failed for image generation - check Cloudflare account permissions",
            401,
            "authentication_error",
            "Cloudflare Workers AI authentication failed"
          );
        }

        // Check if model is not found
        if (errorMsg.includes('not found') || errorMsg.includes('404') || errorMsg.includes('does not exist')) {
          console.error(`[Image] Model not found in Cloudflare Workers AI`);
          return this.errorResponse(
            "Image generation model not available",
            404,
            "model_not_found",
            `Model ${model} not found in Cloudflare Workers AI`
          );
        }

        // Re-throw for generic error handling
        throw error;
      }

      console.log(`[Image] Response type: ${typeof aiRes}, is ReadableStream: ${aiRes instanceof ReadableStream}`);

      // Cloudflare returns image data - it could be a base64 string or URL
      // The Flux model returns a base64-encoded PNG image
      let imageData: string = '';

      if (aiRes instanceof ReadableStream) {
        // Handle streaming response (unlikely for image generation)
        const reader = aiRes.getReader();
        const chunks: Uint8Array[] = [];
        let result;
        while (!(result = await reader.read()).done) {
          chunks.push(result.value);
        }
        const fullData = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
          fullData.set(chunk, offset);
          offset += chunk.length;
        }
        // Convert to base64
        const bytes = Array.from(fullData);
        imageData = 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes));
      } else if (typeof aiRes === 'string') {
        // Direct string response (base64 or URL)
        imageData = aiRes;
      } else if (typeof aiRes === 'object' && aiRes !== null) {
        // Object response - check for various possible formats
        console.log(`[Image] Response keys: ${Object.keys(aiRes).join(', ')}`);

        // Try to extract image data from response
        if ('image' in aiRes && typeof (aiRes as any).image === 'string') {
          imageData = (aiRes as any).image;
        } else if ('data' in aiRes && typeof (aiRes as any).data === 'string') {
          imageData = (aiRes as any).data;
        } else if ('result' in aiRes && typeof (aiRes as any).result === 'string') {
          imageData = (aiRes as any).result;
        } else if ('b64' in aiRes && typeof (aiRes as any).b64 === 'string') {
          imageData = (aiRes as any).b64;
        } else {
          console.warn(`[Image] Unexpected response format:`, JSON.stringify(aiRes).substring(0, 200));
          imageData = JSON.stringify(aiRes);
        }
      }

      console.log(`[Image] Image data length: ${imageData.length} chars`);

      // Ensure we have image data
      if (!imageData) {
        console.error(`[Image] No image data generated`);
        return this.errorResponse("Failed to generate image", 500);
      }

      // Format response based on request
      const imageObject: OpenAiImageObject = {};

      if (response_format === 'b64_json') {
        // Return base64-encoded image
        if (imageData.startsWith('data:image')) {
          // Extract base64 part if it's a data URL
          imageObject.b64_json = imageData.split(',')[1];
        } else if (imageData.startsWith('/9j/') || imageData.startsWith('iVBORw0KGgo')) {
          // Already base64
          imageObject.b64_json = imageData;
        } else {
          // Assume it needs encoding
          imageObject.b64_json = btoa(imageData);
        }
      } else {
        // Return as URL (even though we have base64, return it as a data URL for now)
        if (imageData.startsWith('data:image')) {
          imageObject.url = imageData;
        } else if (imageData.startsWith('/9j/') || imageData.startsWith('iVBORw0KGgo')) {
          // Base64 - convert to data URL
          imageObject.url = 'data:image/png;base64,' + imageData;
        } else {
          imageObject.url = imageData;
        }
      }

      // Add revised prompt if model adjusted it
      if ('revised_prompt' in (aiRes as any)) {
        imageObject.revised_prompt = (aiRes as any).revised_prompt;
      }

      return new Response(JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        data: Array(n).fill(null).map((_, i) => ({
          ...imageObject,
          // For multiple images, we'd need to generate n times
          // For now, we return the same image n times
        })),
        model: requestedModel  // Return the requested model name to Onyx
      } as OpenAiImageGenerationRes), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error(`[Image] Error:`, error);
      return this.errorResponse("Image generation failed", 500, (error as Error).message);
    }
  },

  async handleAssistants(request: Request, env: Env, url: URL) {
    try {
      if (url.pathname.endsWith('/assistants')) {
        switch (request.method) {
          case 'POST':
            return this.createAssistant(request, env);
          case 'GET':
            return this.listAssistants(env);
          default:
            return this.errorResponse("Method not allowed", 405);
        }
      }

      const assistantId = url.pathname.split('/').pop() || '';
      assistantId && this.testAssistantId(assistantId);

      switch (request.method) {
        case 'GET':
          return this.retrieveAssistant(env, assistantId);
        case 'POST':
          return this.modifyAssistant(request, env, assistantId);
        case 'DELETE':
          return this.deleteAssistant(env, assistantId);
        default:
          return this.errorResponse("Method not allowed", 405);
      }
    } catch (error) {
      return this.errorResponse("Assistant operation failed", 500, (error as Error).message);
    }
  },

  async handleThreads(request: Request, env: Env, url: URL) {
    try {
      if (url.pathname.endsWith('/runs')) {
        const threadId = url.pathname.split('/').at(-2) || '';
        this.testThreadId(threadId);
        return this.handleThreadRuns(request, env, threadId);
      }

      if (url.pathname.endsWith('/threads')) {
        switch (request.method) {
          case 'POST':
            return this.createThread(request, env);
          case 'GET':
            return this.listThreads(env);
          default:
            return this.errorResponse("Method not allowed", 405);
        }
      }

      const threadId = url.pathname.split('/').pop() || '';
      this.testThreadId(threadId);

      switch (request.method) {
        case 'GET':
          return this.retrieveThread(env, threadId);
        case 'POST':
          return this.modifyThread(request, env, threadId);
        case 'DELETE':
          return this.deleteThread(env, threadId);
        default:
          return this.errorResponse("Method not allowed", 405);
      }
    } catch (error) {
      return this.errorResponse("Thread operation failed", 500, (error as Error).message);
    }
  },

  /**
   * Validate and normalize OpenAI request for Onyx compatibility
   *
   * This method implements the specification for:
   * - Message content validation (never null)
   * - Unsupported field stripping (tools, tool_choice, functions, etc.)
   * - Default value application
   * - Parameter clamping
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
        content = String(content);
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
    const system_fingerprint = `fp_${this.getRandomId()}`;

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
        if (!isReasoningModel) {
          console.log(`[Stream] Model ${model} is NOT a reasoning model - will strip reasoning_content from deltas`);
        }

        // Send initial empty delta
        const initialChunk: any = {
          ...metadata,
          choices: [{ index: index, delta: { role: "assistant", content: "" }, finish_reason: null }]
        };

        // Responses API requires 'type' field in streaming chunks
        if (isResponsesEndpoint) {
          initialChunk.type = "response.output_item.added";
        }

        controller.enqueue(
          encoder.encode('data: ' + JSON.stringify(initialChunk) + "\n\n")
        );

        let buffer = ""; // Buffer to accumulate incomplete chunks
        let done = false;
        let chunkCount = 0;
        let totalContentLength = 0; // Track total content generated
        let hasReasoningContent = false; // Track if we received any reasoning
        let toolCallBuffer: Record<string, any> = {}; // Buffer for tool calls being streamed

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
                    const reasoningChunk: any = {
                      ...metadata,
                      id: completionId,
                      choices: [{
                        index: index,
                        delta: { reasoning_content: delta.reasoning_content },
                        finish_reason: null
                      }]
                    };

                    // Responses API requires 'type' field
                    if (isResponsesEndpoint) {
                      reasoningChunk.type = "response.output_text.delta";
                    }

                    controller.enqueue(
                      encoder.encode('data: ' + JSON.stringify(reasoningChunk) + "\n\n")
                    );
                  }

                  // Handle regular content separately (final response)
                  // Skip content if it looks like a tool call JSON and actual tool_calls are present
                  if (delta.content !== undefined && typeof delta.content === 'string') {
                    let content = delta.content;
                    totalContentLength += content.length;

                    // Check if this looks like a tool call JSON being output as text
                    const looksLikeToolCallJson = /^\s*\{["\s]*type["\s]*:["\s]*function/.test(content);

                    // Only send if not a duplicate tool call
                    if (!(looksLikeToolCallJson && delta.tool_calls && delta.tool_calls.length > 0)) {
                      if (looksLikeToolCallJson && delta.tool_calls && delta.tool_calls.length > 0 && chunkCount <= 3) {
                        console.log("[Stream] Skipping tool call JSON in content (actual tool_calls present)");
                      } else if (content.length > 0 || delta.content === "") {
                        // Send content in its own chunk
                        const contentChunk: any = {
                          ...metadata,
                          id: completionId,
                          choices: [{
                            index: index,
                            delta: { content: content },
                            finish_reason: null
                          }]
                        };

                        // Responses API requires 'type' field
                        if (isResponsesEndpoint) {
                          contentChunk.type = "response.output_text.delta";
                        }

                        controller.enqueue(
                          encoder.encode('data: ' + JSON.stringify(contentChunk) + "\n\n")
                        );
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

                    // Forward tool calls as-is from Cloudflare
                    // They arrive in chunks but we send each chunk immediately
                    // Onyx will buffer them on its side and reconstruct the full call
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

                  // Responses API requires 'type' field in streaming chunks
                  if (isResponsesEndpoint) {
                    nativeToolCallChunk.type = "response.output_item.delta";
                  }

                  controller.enqueue(
                    encoder.encode('data: ' + JSON.stringify(nativeToolCallChunk) + "\n\n")
                  );
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
                  const bufferContentChunk: any = {
                    ...metadata,
                    id: completionId,
                    choices: [{
                      index: index,
                      delta: { content: delta.content },
                      finish_reason: null,
                      logprobs: null  // ✅ Required field
                    }]
                  };

                  // Responses API requires 'type' field in streaming chunks
                  if (isResponsesEndpoint) {
                    bufferContentChunk.type = "response.output_text.delta";
                  }

                  controller.enqueue(
                    encoder.encode('data: ' + JSON.stringify(bufferContentChunk) + "\n\n")
                  );
                }
                // Handle Cloudflare native format
                else if (parsed.response && typeof parsed.response === 'string') {
                  const bufferNativeChunk: any = {
                    ...metadata,
                    id: completionId,
                    choices: [{
                      index: index,
                      delta: { content: parsed.response },
                      finish_reason: null,
                      logprobs: null  // ✅ Required field
                    }]
                  };

                  // Responses API requires 'type' field in streaming chunks
                  if (isResponsesEndpoint) {
                    bufferNativeChunk.type = "response.output_text.delta";
                  }

                  controller.enqueue(
                    encoder.encode('data: ' + JSON.stringify(bufferNativeChunk) + "\n\n")
                  );
                }
              }
            } catch (err) {
              // Ignore final buffer parse errors
            }
          }
        }

        // Send final [DONE] marker
        console.log("[Stream] Sending final finish_reason: stop");
        const finalChunk: any = {
          ...metadata,
          id: completionId,
          choices: [{
            index: index,
            delta: {},
            finish_reason: "stop",
            logprobs: null  // ✅ Required field
          }]
        };

        // Responses API requires 'type' field in streaming chunks
        if (isResponsesEndpoint) {
          finalChunk.type = "response.output_item.done";
        }

        controller.enqueue(
          encoder.encode('data: ' + JSON.stringify(finalChunk) + "\n\n")
        );

        // ✅ Send usage data chunk (required by OpenAI spec for streaming)
        // Note: Cloudflare doesn't provide token counts in streaming, so we estimate
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
        id: `call_${this.getRandomId()}`,
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
      system_fingerprint: `fp_${this.getRandomId()}`
    };

    console.log(`[Builder] Built response for model ${model}: content_length=${finalContent?.length || 0}, tool_calls=${openaiToolCalls?.length || 0}, finish_reason=${response.choices[0].finish_reason}, usage=${JSON.stringify(usage)}`);

    return response;
  },

  /**
   * Build OpenAI Responses API format response
   * See: https://platform.openai.com/docs/api-reference/responses/create
   */
  buildOpenAIResponsesFormat(
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
    // ✅ EMPTY TEXT PROTECTION: Never allow null/undefined content
    let messageContent = text;
    if (!messageContent || messageContent.trim().length === 0) {
      console.log("[Builder] Empty content detected, using fallback space character");
      messageContent = " ";
    }

    const createdAt = Math.floor(Date.now() / 1000);
    const responseId = `resp_${this.getRandomId()}`;
    const messageId = `msg_${this.getRandomId()}`;

    // ✅ Build output items array
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
      // Transform Cloudflare tool calls to OpenAI Responses API format
      const toolCallItems = toolCalls.map((tc: any) => ({
        type: "function_call",
        id: `call_${this.getRandomId()}`,
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

    // ✅ Build reasoning field
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
  },

  chatNormalResponse(
    result: AiJsonResponse,
    model: string,
    startTime: number,
    isResponsesApi: boolean = false,
    requestParams?: {
      temperature?: number;
      top_p?: number;
      max_output_tokens?: number;
      tool_choice?: string;
      tools?: any[];
      store?: boolean;
      truncation?: string;
    }
  ) {
    // ✅ Extract and validate content from result
    let responseText: string | null = null;

    if (result.response !== null && result.response !== undefined) {
      if (typeof result.response === 'string') {
        responseText = result.response;
      } else {
        // Convert numbers, booleans, etc. to strings
        responseText = String(result.response);
        console.log(`[Response] Converted non-string response (${typeof result.response}): "${result.response}"`);
      }
    }

    // ✅ Remove tool call JSON if it appears as text
    if (responseText && responseText.length > 0) {
      const toolCallJsonPattern = /\s*\{["\s]*type["\s]*:["\s]*function[^}]*parameters["\s]*:[^}]*\}\s*$/;
      if (toolCallJsonPattern.test(responseText)) {
        console.log("[Response] Removing tool call JSON from response text");
        responseText = responseText.replace(toolCallJsonPattern, '').trim();
      }
    }

    let response: any;

    if (isResponsesApi) {
      // Build Responses API format with actual request parameters
      response = this.buildOpenAIResponsesFormat(
        responseText,
        model,
        result.tool_calls,
        result.reasoning_content,
        result.usage,
        requestParams
      );
    } else {
      // ✅ Use canonical builder with actual usage data for Chat Completions
      response = this.buildOpenAIChatResponse(
        responseText,
        model,
        result.tool_calls,
        result.reasoning_content,
        result.usage  // Pass actual usage data from Cloudflare
      );
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'openai-organization': 'dingo-net',
        'openai-processing-ms': String(Date.now() - startTime),
        'openai-version': '2020-10-01',
        'x-request-id': response.id,
        // Rate limit headers (generous limits for Cloudflare Workers AI)
        'x-ratelimit-limit-requests': '10000',
        'x-ratelimit-limit-tokens': '2000000',
        'x-ratelimit-remaining-requests': '9999',
        'x-ratelimit-remaining-tokens': '1999000',
        'x-ratelimit-reset-requests': '1s',
        'x-ratelimit-reset-tokens': '1s'
      }
    });
  },

  /**
   * Construct a flattened prompt from messages array
   *
   * Cloudflare models (Qwen3, Llama, Mistral) respond better to a flattened instruction format:
   *
   * <System>
   * You are a helpful assistant.
   * </System>
   *
   * <User>
   * question
   * </User>
   *
   * <Assistant>
   * previous answer
   * </Assistant>
   *
   * This works around issues like:
   * - "When using tool_choice, tools must be set"
   * - "LLM did not return an answer"
   * - Models stopping prematurely after tool results
   */
  constructFlattenedPrompt(messages: any[]): string {
    let prompt = "";

    for (const msg of messages) {
      const role = msg.role || "user";
      const content = msg.content || "";

      switch (role) {
        case "system":
          prompt += `<System>\n${content}\n</System>\n`;
          break;
        case "user":
          prompt += `<User>\n${content}\n</User>\n`;
          break;
        case "assistant":
          prompt += `<Assistant>\n${content}\n</Assistant>\n`;
          break;
        case "tool":
          // Tool results can be included as User role responses
          prompt += `<User>\n[Tool Result]\n${content}\n</User>\n`;
          break;
        default:
          prompt += `<${role}>\n${content}\n</${role}>\n`;
      }
    }

    return prompt;
  },

  /**
   * Resolves an OpenAI model name to a Cloudflare model name
   * @param requestedModel The OpenAI model name or CF model name
   * @param env The environment (for fallback defaults)
   * @returns The resolved Cloudflare model name
   */
  getCfModelName(requestedModel: string | undefined, env: Env): string {
    const model = requestedModel || env.DEFAULT_AI_MODEL || '@cf/meta/llama-3-8b-instruct';

    // Check if it's an alias
    if (MODEL_ALIASES[model]) {
      return MODEL_ALIASES[model];
    }

    // If it's already a CF model (starts with @cf or @hf), use it as-is
    if (model.startsWith('@cf/') || model.startsWith('@hf/')) {
      return model;
    }

    // Default fallback
    return model;
  },

  /**
   * Generate an OpenAI-compatible error response
   * @param message Human-readable error message
   * @param statusCode HTTP status code
   * @param errorType OpenAI error type (e.g., 'invalid_request_error')
   * @param errorDetails Optional additional error details
   * @returns A Response object with proper error format
   */
  errorResponse(
    message: string,
    statusCode: number = 500,
    errorType: string = "api_error",
    errorDetails?: string
  ): Response {
    const errorObject = {
      object: "error",
      message,
      type: errorType,
      param: null,
      code: errorType,
      ...(errorDetails && { details: errorDetails })
    };

    console.error(`[Error] ${statusCode} ${errorType}: ${message}${errorDetails ? ' - ' + errorDetails : ''}`);

    return new Response(JSON.stringify({ error: errorObject }), {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
      },
    });
  },

  transformChatCompletionRequest(request: OpenAiChatCompletionReq, env: Env): AiChatRequestParts {
    // Base options common to both prompt and messages formats
    const requestedMaxTokens = request.max_completion_tokens ?? request.max_tokens ?? 16384;

    // Get the resolved model FIRST to determine its max_tokens limit
    let resolvedModel = this.getCfModelName(request?.model, env);
    const modelMaxTokensLimit = MODEL_MAX_TOKENS[resolvedModel] || 4096;  // Default to 4096 if not specified

    // IMPORTANT: Cloudflare Workers AI has model-specific limits:
    // - Hermes 2 Pro: max 1024 tokens
    // - Qwen3, Llama: max 4096 tokens
    // - Context window: 32768 tokens (prompt + completion combined)
    //
    // For reasoning models like Qwen, enforce a minimum to ensure enough budget
    const isReasoningModel = resolvedModel.includes('qwen');
    const MIN_TOKENS_FOR_REASONING = isReasoningModel ? 4096 : modelMaxTokensLimit;

    // Clamp to model's specific limit
    const maxTokens = Math.max(Math.min(requestedMaxTokens, modelMaxTokensLimit),
                               Math.min(MIN_TOKENS_FOR_REASONING, modelMaxTokensLimit));

    if (maxTokens !== requestedMaxTokens) {
      console.log(`[Transform] Adjusted max_tokens from ${requestedMaxTokens} to ${maxTokens} (model ${resolvedModel} has limit: ${modelMaxTokensLimit})`);
    }

    const baseOptions: AiBaseInputOptions = {
      stream: request.stream ?? undefined,
      max_tokens: maxTokens,
      temperature: this.mapTemperatureToCloudflare(request?.temperature ?? undefined),
      top_p: request.top_p ?? undefined,
      seed: request.seed ?? undefined,
      repetition_penalty: undefined, // Not directly mapped
      frequency_penalty: request.frequency_penalty ?? undefined,
      presence_penalty: request.presence_penalty ?? undefined
    };

    console.log(`[Transform] max_tokens: ${baseOptions.max_tokens} (from request: ${request.max_tokens || request.max_completion_tokens || 'not specified'})`);

    // Get tool capability status (resolvedModel already declared above)
    const isGptOss = GPT_OSS_MODELS.some(m => resolvedModel.includes(m) || m.includes(resolvedModel));
    const isLlama = resolvedModel.includes('llama');

    // ✅ FIX 3: Auto-route GPT-OSS to Qwen when tools are requested
    // GPT-OSS does NOT support tools on Cloudflare Workers AI (platform limitation)
    if (isGptOss && request.tools && request.tools.length > 0) {
      console.warn(`[GPT-OSS] Tools requested → auto-switching to Qwen for tool support`);
      console.log(`[GPT-OSS] Routing to @cf/qwen/qwen3-30b-a3b-fp8 (supports tools)`);
      resolvedModel = '@cf/qwen/qwen3-30b-a3b-fp8';
      // Continue with Qwen processing (fall through to standard messages path)
    }

    // Re-check isGptOss after potential model switch
    const finalIsGptOss = GPT_OSS_MODELS.some(m => resolvedModel.includes(m) || m.includes(resolvedModel));

    // Auto-switch Llama to Qwen when tools are requested
    // Llama models output tool calls as plain text JSON instead of structured tool_calls
    if (isLlama && request.tools && request.tools.length > 0) {
      console.warn(`[Llama] Tools requested but Llama outputs tool calls as plain text JSON`);
      console.log(`[Llama] Auto-switching to @cf/qwen/qwen3-30b-a3b-fp8 for proper tool support`);
      resolvedModel = '@cf/qwen/qwen3-30b-a3b-fp8';
      // Fall through to use standard messages transformation with Qwen
    }

    // ✅ FIX 2: Hard-code GPT-OSS → supportsTools = false
    // Check tool support AFTER model switching (critical!)
    // GPT-OSS never supports tools, even if in TOOL_CAPABLE_MODELS by mistake
    const supportsTools = !finalIsGptOss && TOOL_CAPABLE_MODELS.some(m => resolvedModel.includes(m) || m.includes(resolvedModel));

    // Log tool support status
    if (request.tools && request.tools.length > 0) {
      console.log(`[Transform] Request includes ${request.tools.length} tools`);
      console.log(`[Transform] Model ${resolvedModel} supports tools: ${supportsTools}`);
    }

    // Map tools AFTER model switching and support check
    const mappedTools = supportsTools && request.tools ? this.mapTools(request.tools) : undefined;

    if (mappedTools) {
      console.log(`[Transform] Mapped ${mappedTools.length} tools for ${resolvedModel}`);
    }

    // GPT-OSS models - use standard messages format (NOT Harmony instructions/input)
    // Cloudflare Workers AI requires: prompt, messages, or requests
    if (finalIsGptOss) {
      console.log(`[Transform] GPT-OSS model detected: ${resolvedModel}`);
      console.log(`[GPT-OSS] Using standard messages format (CF AI requirement)`);

      // ⚠️  CRITICAL: Disable streaming for GPT-OSS
      // GPT-OSS streaming can be unreliable
      if (baseOptions.stream) {
        console.log(`[GPT-OSS] DISABLED streaming for GPT-OSS (stability)`);
        baseOptions.stream = false;
      }

      // Transform messages - same as other models but without tools
      const transformedMessages = request.messages.map((msg: any) => {
        const baseMsg: any = {
          role: msg.role,
          content: msg.content ?? ""
        };
        return baseMsg;
      });

      // GPT-OSS is TEXT-ONLY on Cloudflare Workers AI - no tool support
      const gptOssOptions: any = {
        ...baseOptions,
        messages: transformedMessages,
        temperature: baseOptions.temperature ? Math.min(baseOptions.temperature, 1.0) : 0.7,
      };

      console.log(`[GPT-OSS] Messages count:`, transformedMessages.length);

      return {
        model: resolvedModel,
        options: gptOssOptions
      };
    }

    // Standard messages interface for other models
    // CRITICAL: Properly handle tool calls and tool results in message history
    const transformedMessages = request.messages.map((msg: any) => {
      const baseMsg: any = {
        role: msg.role,
        content: msg.content ?? "" // Extra safety: ensure content is never undefined
      };

      // Preserve tool_calls if present (from assistant messages)
      if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        baseMsg.tool_calls = msg.tool_calls;
        // When tool_calls are present, content should be empty or null per OpenAI spec
        if (!msg.content) {
          baseMsg.content = "";
        }
      }

      // Handle tool result messages (role: "tool")
      if (msg.role === 'tool' && msg.tool_call_id) {
        baseMsg.tool_call_id = msg.tool_call_id;
        // Tool messages must have content
        if (!baseMsg.content) {
          baseMsg.content = "";
        }
      }

      return baseMsg;
    });

    const options: AiMessagesInputOptions = {
      ...baseOptions,
      messages: transformedMessages,
      // Only include tools if model supports them
      ...(supportsTools && mappedTools && { tools: mappedTools }),
      // Only include tool_choice if model supports tools
      ...(supportsTools && request.tool_choice ? { tool_choice: request.tool_choice } :
        supportsTools && request.function_call ? { tool_choice: request.function_call } : {})
    };

    // Handle response format constraints
    if (typeof request.response_format === 'object' && 'type' in request.response_format
      && request.response_format?.type === 'json_object') {
      options.messages = [
        ...options.messages,
        {
          role: 'system',
          content: 'Respond using JSON format'
        }
      ];
    }

    return {
      model: resolvedModel,
      options: options
    };
  },

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
        return this.errorResponse("No input_items, messages, or input provided", 400, "invalid_request_error");
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
      const validatedData = this.validateAndNormalizeRequest(openaiRequest, env);

      // Transform to Cloudflare format
      const { model, options } = this.transformChatCompletionRequest(validatedData, env);
      console.log("[Responses] Model in use:", model, 'Stream:', options?.stream);

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
      return this.errorResponse(
        "Response generation failed",
        500,
        "api_error",
        (error as Error).message
      );
    }
  },

  /**
   * Maps OpenAI temperature to Cloudflare format
   * OpenAI uses 0-2, Cloudflare uses similar scale
   * @param temperature OpenAI temperature value
   * @returns Cloudflare-compatible temperature
   */
  mapTemperatureToCloudflare(temperature: number | undefined): number | undefined {
    if (temperature === undefined || temperature === null) {
      return undefined;
    }
    // Clamp to valid range [0, 2]
    const clamped = Math.max(0, Math.min(2, temperature));
    return clamped;
  },

  /**
   * Maps OpenAI tools format to Cloudflare tools format
   * @param tools Array of OpenAI tool definitions
   * @returns Array of Cloudflare-compatible tool definitions
   */
  mapTools(tools: any[]): any[] {
    if (!tools || !Array.isArray(tools)) {
      return [];
    }

    return tools.map(tool => {
      if (tool.type === 'function') {
        return {
          type: 'function',
          function: {
            name: tool.function?.name || '',
            description: tool.function?.description || '',
            parameters: tool.function?.parameters || { type: 'object', properties: {} }
          }
        };
      }
      return tool;
    });
  },

  /**
   * Generates a random ID for use in response objects
   * @returns A random hex string
   */
  getRandomId(): string {
    return Math.random().toString(16).substring(2, 15) + Math.random().toString(16).substring(2, 15);
  },

};
