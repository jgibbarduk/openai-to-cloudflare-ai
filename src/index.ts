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
 * GET  /v1/models
 * GET  /health
 *
 * ============================================================================
 */

import { textGenerationModels } from "./models";

// Version for deployment tracking
const PROXY_VERSION = "1.9.15"; // Updated: 2026-02-06 - FIX: GPT-OSS uses standard messages format (not Harmony)

let globalModels: ModelType[] = [];

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
  // Llama 3.3 can handle up to 4096
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': 4096,
  '@cf/meta/llama-3-70b-instruct': 4096,
  '@cf/meta/llama-3-8b-instruct': 4096,
  // Mistral Small 3.1 can handle more
  '@cf/mistralai/mistral-small-3.1-24b-instruct': 4096,
  // GPT-OSS models
  '@cf/openai/gpt-oss-20b': 4096,
  '@cf/openai/gpt-oss-120b': 4096,
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
    if (!authHeader?.startsWith('Bearer ') || authHeader.split(' ')[1] !== env.API_KEY) {
      switch (true) {
        case url.pathname === '/models/search' && request.method === 'GET':
          return this.displayModelsInfo(env, request);
        default:
          return this.errorResponse("Unauthorized", 401, "invalid_api_key");
      }
    }

    try {
      let response: Response;
      switch (true) {
        case url.pathname === '/v1/models' && request.method === 'GET':
          response = await this.handleListModels(env);
          break;
        case url.pathname === '/v1/chat/completions' && request.method === 'POST':
        case url.pathname === '/v1/responses' && request.method === 'POST':  // Onyx compatibility
          response = await this.handleChatCompletions(request, env);
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

      return this.handleChatCompletionResponse(aiRes, model, options);
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
  async handleChatCompletionResponse(aiRes: any, model: Model, options: any) {
    try {
      if (options.stream && aiRes instanceof ReadableStream) {
        console.log(`[Chat] [v${PROXY_VERSION}] Starting streaming response transformation`);
        return await this.chatStreamResponse(aiRes, model);
      }

      // Check if this is an OpenAI-compatible response format (has choices array)
      // This is the new format that Cloudflare returns for some models
      if (!options.stream && typeof aiRes === 'object' && aiRes !== null && 'choices' in aiRes) {
        console.log("[Chat] Detected OpenAI-compatible response format from Cloudflare");
        const openAiResponse = this.extractOpenAiCompatibleResponse(aiRes as any);
        // ✅ VALIDATION: Verify extraction succeeded
        if (!openAiResponse.response || openAiResponse.response.trim().length === 0) {
          console.warn("[Chat] OpenAI-compatible extraction produced empty response, using fallback");
          openAiResponse.response = " ";
        }
        return this.chatNormalResponse(openAiResponse, model);
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
        return this.chatNormalResponse(gptOssResponse, model);
      }

      if (!options.stream && typeof aiRes === 'object' && aiRes !== null && 'response' in aiRes) {
        // Check if response is null/undefined BUT has tool_calls (this is valid)
        if ((aiRes.response === undefined || aiRes.response === null) && !('tool_calls' in aiRes)) {
          console.warn("[Chat] Response is null/undefined and no tool_calls present");
          return this.chatNormalResponse({
            response: " ",
            contentType: "application/json",
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
          }, model);
        }

        // If response is null but tool_calls exist, that's valid - pass it through
        if (aiRes.response === null && 'tool_calls' in aiRes) {
          console.log("[Chat] Response is null but tool_calls present - this is valid");
          return this.chatNormalResponse({
            response: "", // Empty string for tool calls
            contentType: "application/json",
            usage: aiRes.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            tool_calls: aiRes.tool_calls
          }, model);
        }

        // Sanitize the response to remove any invalid characters
        const sanitizedRes = this.sanitizeAiResponse(aiRes);
        // ✅ VALIDATION: Verify sanitization produced valid content
        if (!sanitizedRes.response || sanitizedRes.response.trim().length === 0) {
          console.warn("[Chat] Sanitization produced empty response, using fallback");
          sanitizedRes.response = " ";
        }
        return this.chatNormalResponse(sanitizedRes, model);
      }

      // Fallback: return empty response rather than error (Onyx compatibility)
      console.warn("[Chat] No valid response from AI, returning empty content. Response:", JSON.stringify(aiRes).substring(0, 300));
      return this.chatNormalResponse({
        response: " ",
        contentType: "application/json",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      }, model);
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
      const promptTokens = Math.ceil(((res.instructions || "") + (res.input || "")).length / 4);
      const completionTokens = Math.ceil(responseText.length / 4);

      // ✅ VALIDATION: Ensure response is never empty
      if (!responseText || responseText.trim().length === 0) {
        console.warn("[GPT-OSS] No text content extracted, using fallback");
        responseText = " ";
      }

      return {
        response: responseText || " ",
        contentType: "application/json",
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens
        }
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
  extractOpenAiCompatibleResponse(res: any): AiJsonResponse {
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

      // ✅ VALIDATION: Ensure response is never empty
      if (!responseText || responseText.trim().length === 0) {
        console.warn("[OpenAI-Compat] No text content extracted, using fallback");
        responseText = " ";
      }

      return {
        response: responseText,
        contentType: "application/json",
        usage: res.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
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
        model: model, // Cloudflare AI model, also we can return 'requestedModel' as it was requested?
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
      data.temperature = Math.max(0, Math.min(2, data.temperature));
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
  async chatStreamResponse(responseStream: AiStreamResponse, model: Model) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const timestamp = Date.now();
    const system_fingerprint = `fp_${this.getRandomId()}`;
    const completionId = `chatcmpl-${timestamp}`;
    let index = 0;

    const stream = new ReadableStream({
      async start(controller) {
        const reader = responseStream.getReader();

        // Metadata for response
        const metadata = {
          id: completionId,
          object: "chat.completion.chunk",
          created: Math.floor(timestamp / 1000),
          model,
          service_tier: "default",
          system_fingerprint,
        };

        // Send initial empty delta
        controller.enqueue(
          encoder.encode(
            'data: ' + JSON.stringify({
              ...metadata,
              choices: [{ index: index, delta: { role: "assistant", content: "", refusal: null }, logprobs: null, finish_reason: null }]
            }) + "\n\n"
          )
        );

        let buffer = ""; // Buffer to accumulate incomplete chunks
        let done = false;
        let chunkCount = 0;
        let totalContentLength = 0; // Track total content generated
        let hasReasoningContent = false; // Track if we received any reasoning

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
                    console.log(`[Stream] Has reasoning: ${!!delta.reasoning_content}, Has content: ${delta.content !== undefined}, Content: "${delta.content}"`);
                    if (delta.reasoning_content) {
                      console.log(`[Stream] Reasoning content length: ${delta.reasoning_content.length}`);
                    }
                  }

                  // Build delta object - send reasoning_content and content in SEPARATE chunks
                  // This ensures Onyx can properly distinguish thinking from answer content

                  // Send reasoning_content first (if present)
                  if (delta.reasoning_content && typeof delta.reasoning_content === 'string') {
                    hasReasoningContent = true;
                    controller.enqueue(
                      encoder.encode(
                        'data: ' + JSON.stringify({
                          ...metadata,
                          id: completionId,
                          choices: [{
                            index: index,
                            delta: { reasoning_content: delta.reasoning_content },
                            logprobs: null,
                            finish_reason: null
                          }]
                        }) + "\n\n"
                      )
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
                        controller.enqueue(
                          encoder.encode(
                            'data: ' + JSON.stringify({
                              ...metadata,
                              id: completionId,
                              choices: [{
                                index: index,
                                delta: { content: content },
                                logprobs: null,
                                finish_reason: null
                              }]
                            }) + "\n\n"
                          )
                        );
                      }
                    }
                  } else if (delta.content !== undefined) {
                    // Content exists but is not a string (could be null, empty, etc.)
                    controller.enqueue(
                      encoder.encode(
                        'data: ' + JSON.stringify({
                          ...metadata,
                          id: completionId,
                          choices: [{
                            index: index,
                            delta: { content: "" },
                            logprobs: null,
                            finish_reason: null
                          }]
                        }) + "\n\n"
                      )
                    );
                  }

                  // Handle tool calls
                  if (delta.tool_calls && Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
                    console.log("[Stream] Tool calls detected:", JSON.stringify(delta.tool_calls));

                    // Forward tool calls as-is (already in OpenAI format from Cloudflare)
                    controller.enqueue(
                      encoder.encode(
                        'data: ' + JSON.stringify({
                          ...metadata,
                          id: completionId,
                          choices: [{
                            index: index,
                            delta: { tool_calls: delta.tool_calls },
                            logprobs: null,
                            finish_reason: null
                          }]
                        }) + "\n\n"
                      )
                    );
                  }
                }
                // Handle Cloudflare native format (Llama and other models)
                else if (parsed.response && typeof parsed.response === 'string') {
                  // Transform Cloudflare's {response: "text"} to OpenAI's delta format
                  if (chunkCount <= 5) {
                    console.log(`[Stream] CF native format, sending: "${parsed.response.substring(0, 50)}"`);
                  }
                  controller.enqueue(
                    encoder.encode(
                      'data: ' + JSON.stringify({
                        ...metadata,
                        id: completionId,
                        choices: [{
                          index: index,
                          delta: { content: parsed.response },
                          logprobs: null,
                          finish_reason: null
                        }]
                      }) + "\n\n"
                    )
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

                  controller.enqueue(
                    encoder.encode(
                      'data: ' + JSON.stringify({
                        ...metadata,
                        id: completionId,
                        choices: [{
                          index: index,
                          delta: { tool_calls: openaiToolCalls },
                          logprobs: null,
                          finish_reason: null
                        }]
                      }) + "\n\n"
                    )
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
                  controller.enqueue(
                    encoder.encode(
                      'data: ' + JSON.stringify({
                        ...metadata,
                        id: completionId,
                        choices: [{
                          index: index,
                          delta: { content: delta.content },
                          logprobs: null,
                          finish_reason: null
                        }]
                      }) + "\n\n"
                    )
                  );
                }
                // Handle Cloudflare native format
                else if (parsed.response && typeof parsed.response === 'string') {
                  controller.enqueue(
                    encoder.encode(
                      'data: ' + JSON.stringify({
                        ...metadata,
                        id: completionId,
                        choices: [{
                          index: index,
                          delta: { content: parsed.response },
                          logprobs: null,
                          finish_reason: null
                        }]
                      }) + "\n\n"
                    )
                  );
                }
              }
            } catch (err) {
              console.log("[Stream] Could not parse final buffer");
            }
          }
        }

        // Send final message with finish_reason
        console.log("[Stream] Sending final finish_reason: stop");
        controller.enqueue(
          encoder.encode(
            'data: ' + JSON.stringify({
              ...metadata,
              id: completionId,
              choices: [{ index: index, delta: {}, logprobs: null, finish_reason: "stop" }]
            }) + "\n\ndata: [DONE]\n\n"
          )
        );

        console.log("[Stream] Stream closed successfully");
        controller.close();
      }
    });


    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
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
    reasoningContent?: string
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
          ...(reasoningContent && { reasoning_content: reasoningContent }),
          ...(openaiToolCalls && { tool_calls: openaiToolCalls })
        },
        finish_reason: openaiToolCalls ? "tool_calls" : "stop",
        logprobs: null
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      },
      system_fingerprint: `fp_${this.getRandomId()}`
    };

    console.log(`[Builder] Built response for model ${model}: content_length=${finalContent?.length || 0}, tool_calls=${openaiToolCalls?.length || 0}, finish_reason=${response.choices[0].finish_reason}`);

    return response;
  },

  chatNormalResponse(result: AiJsonResponse, model: string) {
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

    // ✅ Use canonical builder
    const response = this.buildOpenAIChatResponse(
      responseText,
      model,
      result.tool_calls,
      result.reasoning_content
    );

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
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
   * Assistant methods
   */
  async createAssistant(request: Request, env: Env) {
    const data = await request.json() as Partial<Assistant>;

    // Validation
    if (!data.model) return this.errorResponse("Model is required", 400);
    if (data.name && data.name.length > 256) return this.errorResponse("Name exceeds 256 characters", 400);
    if (data.description && data.description.length > 512) return this.errorResponse("Description exceeds 512 characters", 400);

    const model = this.getCfModelName(data.model, env);
    const assistantId = `asst_${this.getRandomId()}`;
    const assistant: Assistant = {
      id: assistantId,
      object: "assistant",
      created_at: Math.floor(Date.now() / 1000),
      name: data.name || null,
      description: data.description || null,
      model: model,
      instructions: data.instructions || null,
      tools: data.tools || [],
      tool_resources: data.tool_resources || {}, // Added tool_resources
      metadata: data.metadata || {},
      temperature: data.temperature,
      top_p: data.top_p,
      response_format: data.response_format || "auto"
    };

    const key = `assistant:${assistantId}`;

    console.log(`[KV] Attempting to store assistant with key: ${key}`);
    try {
      await env.CACHE.put(key, JSON.stringify(assistant));
      console.log(`[KV] Successfully stored assistant: ${assistantId}`);
    } catch (error) {
      console.error(`[KV] Error storing assistant:`, error);
      throw error;
    }

    return new Response(JSON.stringify(assistant), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  },

  async retrieveAssistant(env: Env, assistantId: string) {
    const key = `assistant:${assistantId}`;
    console.log(`[KV] Attempting to retrieve assistant with key: ${key}`);
    const assistant = await env.CACHE.get<Assistant>(key, "json");
    console.log(`[KV] Retrieved assistant:`, assistant ? 'found' : 'not found');
    return assistant
      ? new Response(JSON.stringify(assistant), { headers: { 'Content-Type': 'application/json' } })
      : this.errorResponse("Assistant not found", 404);
  },

  async modifyAssistant(request: Request, env: Env, assistantId: string) {
    const key = `assistant:${assistantId}`;
    const existingAssistant = await env.CACHE.get<Assistant>(key, "json");
    if (!existingAssistant) {
      return this.errorResponse("Assistant not found", 404);
    }

    const data = await request.json() as Partial<CreateAssistantRequest>;

    // Validate updatable fields
    if (data.name && data.name.length > 256) {
      return this.errorResponse("Name exceeds 256 characters", 400);
    }
    if (data.description && data.description.length > 512) {
      return this.errorResponse("Description exceeds 512 characters", 400);
    }
    if (data.instructions && data.instructions.length > 256000) {
      return this.errorResponse("Instructions exceed 256,000 characters", 400);
    }

    // Validate metadata if present
    if (data.metadata) {
      for (const [key, value] of Object.entries(data.metadata)) {
        if (key.length > 64) {
          return this.errorResponse("Metadata key exceeds 64 characters", 400);
        }
        if (typeof value === 'string' && value.length > 512) {
          return this.errorResponse("Metadata value exceeds 512 characters", 400);
        }
      }
    }

    // Merge updates with existing assistant
    const updatedAssistant: Assistant = {
      ...existingAssistant,
      model: this.getCfModelName(data.model ?? existingAssistant.model, env),
      name: data.name ?? existingAssistant.name,
      description: data.description ?? existingAssistant.description,
      instructions: data.instructions ?? existingAssistant.instructions,
      tools: data.tools ?? existingAssistant.tools,
      tool_resources: data.tool_resources ?? existingAssistant.tool_resources,
      metadata: data.metadata ?? existingAssistant.metadata,
      temperature: data.temperature ?? existingAssistant.temperature,
      top_p: data.top_p ?? existingAssistant.top_p,
      response_format: data.response_format ?? existingAssistant.response_format,
      reasoning_effort: data.reasoning_effort ?? existingAssistant.reasoning_effort
    };

    // Validate tools count
    if (updatedAssistant.tools.length > 128) {
      return this.errorResponse("Too many tools - maximum 128 allowed", 400);
    }

    // Save updated assistant
    await env.CACHE.put(key, JSON.stringify(updatedAssistant));

    return new Response(JSON.stringify(updatedAssistant), {
      headers: { 'Content-Type': 'application/json' }
    });
  },

  async listAssistants(env: Env) {
    const list = await env.CACHE.list({ prefix: "assistant:" });
    const assistants = await Promise.all(
      list.keys.map(async k => await env.CACHE.get<Assistant>(k.name, "json"))
    );

    return new Response(JSON.stringify({
      object: "list",
      data: assistants.filter(Boolean),
      has_more: false
    }), { headers: { 'Content-Type': 'application/json' } });
  },

  async deleteAssistant(env: Env, assistantId: string) {
    const key = `assistant:${assistantId}`;
    const assistant = await env.CACHE.get<Assistant>(key, "json");
    if (!assistant) return this.errorResponse("Assistant not found", 404);

    await env.CACHE.delete(key);
    return new Response(JSON.stringify({
      id: assistantId,
      object: "assistant.deleted",
      deleted: true
    }), { headers: { 'Content-Type': 'application/json' } });
  },

  /**
   * Thread methods
   */
  async createThread(request: Request, env: Env) {
    const data = await request.json() as {
      messages?: Array<ChatMessage>;
      tool_resources?: Record<string, any>;
      metadata?: Record<string, any>;
    };

    const thread: Thread = {
      id: `thread_${this.getRandomId()}`,
      object: "thread",
      created_at: Math.floor(Date.now() / 1000),
      metadata: data.metadata || {},
      tool_resources: data.tool_resources || {}
    };

    if (data.messages) {
      await env.CACHE.put(`thread:${thread.id}:messages`, JSON.stringify(data.messages));
    }

    await env.CACHE.put(`thread:${thread.id}`, JSON.stringify(thread));

    return new Response(JSON.stringify(thread), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  },

  async listThreads(env: Env) {
    const list = await env.CACHE.list({ prefix: "thread:" });
    const threads = await Promise.all(
      list.keys.map(async k => await env.CACHE.get<Thread>(k.name, "json"))
    );

    return new Response(JSON.stringify({
      object: "list",
      data: threads.filter(Boolean),
      has_more: false
    }), { headers: { 'Content-Type': 'application/json' } });
  },

  async modifyThread(request: Request, env: Env, threadId: string) {
    const key = `thread:${threadId}`;
    const existingThread = await env.CACHE.get<Thread>(key, "json");
    if (!existingThread) return this.errorResponse("Thread not found", 404);

    // Parse request body
    const data = await request.json() as {
      metadata?: Record<string, string>;
      tool_resources?: Record<string, any>;
    };

    // Validate metadata constraints
    if (data.metadata) {
      for (const [key, value] of Object.entries(data.metadata)) {
        if (key.length > 64) {
          return this.errorResponse("Metadata key exceeds 64 characters", 400);
        }
        if (typeof value === 'string' && value.length > 512) {
          return this.errorResponse("Metadata value exceeds 512 characters", 400);
        }
      }
    }

    // Create updated thread object
    const updatedThread: Thread = {
      ...existingThread,
      metadata: data.metadata ?? existingThread.metadata,
      tool_resources: data.tool_resources ?? existingThread.tool_resources
    };

    // Save to KV storage
    await env.CACHE.put(key, JSON.stringify(updatedThread));

    return new Response(JSON.stringify(updatedThread), {
      headers: { 'Content-Type': 'application/json' }
    });
  },

  async retrieveThread(env: Env, threadId: string) {
    const key = `thread:${threadId}`;
    const thread = await env.CACHE.get<Thread>(key, "json");
    if (!thread) return this.errorResponse("Thread not found", 404);

    // Get thread messages if they exist
    const messages = await env.CACHE.get<ChatMessage[]>(
      `${key}:messages`,
      "json"
    ) || [];

    const response = {
      ...thread,
      messages: messages.map(msg => ({
        id: `msg_${this.getRandomId()}`,
        created_at: Math.floor(Date.now() / 1000),
        ...msg
      }))
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });
  },

  async deleteThread(env: Env, threadId: string) {
    const key = `thread:${threadId}`;
    const thread = await env.CACHE.get<Thread>(key, "json");
    if (!thread) return this.errorResponse("Thread not found", 404);

    // Delete both thread metadata and messages
    await Promise.all([
      env.CACHE.delete(key),
      env.CACHE.delete(`${key}:messages`)
    ]);

    return new Response(JSON.stringify({
      id: threadId,
      object: "thread.deleted",
      deleted: true
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  },

  async handleThreadRuns(request: Request, env: Env, threadId: string) {
    try {
      if (!threadId && !/^thread/.test(request.url)) return this.errorResponse("Thread ID required", 400);

      const data = await request.json() as ThreadRunRequest;

      // Validate required fields
      if (!data.assistant_id) return this.errorResponse("assistant_id is required", 400);

      const threadCache = await env.CACHE.get<Thread>(`thread:${threadId}`, "json");

      // Create run object
      const run: ThreadRun = {
        ...data,
        id: `run_${this.getRandomId()}`,
        object: "thread.run",
        created_at: Math.floor(Date.now() / 1000),
        thread_id: threadId,
        assistant_id: data.assistant_id,
        status: "queued",
        tool_resources: data?.tool_resources || threadCache?.tool_resources || {},
        model: this.getCfModelName(data.model, env),
        usage: null
      };

      // Store run in KV
      await env.CACHE.put(`run:${run.id}`, JSON.stringify(run));

      // Execute the run
      return this.executeThreadRun(env, run);
    } catch (error) {
      return this.errorResponse("Run creation failed", 500, (error as Error).message);
    }
  },

  async executeThreadRun(env: Env, run: ThreadRun) {
    try {
      // Get assistant
      const assistant = await env.CACHE.get<Assistant>(`assistant:${run.assistant_id}`, "json");
      if (!assistant) return this.errorResponse("Assistant not found", 404);

      // Get thread messages
      const messages = await env.CACHE.get<ChatMessage[]>(
        `thread:${run.thread_id}:messages`, "json"
      ) || [];

      // Transform the request using the new method;
      const { model, options } = this.transformThreadRunRequest(run, assistant, messages, env);

      // Execute AI run with properly typed options
      const aiRes = await env.AI.run(model, options);

      // Update run status
      run.status = "completed";
      run.usage = 'usage' in aiRes ? aiRes.usage : null;
      await env.CACHE.put(`run:${run.id}`, JSON.stringify(run));

      // Handle stream response
      if (run?.stream && aiRes instanceof ReadableStream) {
        return this.chatStreamResponse(aiRes, model);
      }

      // Format standard response
      if (!options.stream && 'response' in aiRes && !!aiRes.response) {
        return this.chatNormalResponse(aiRes, model);
      }

      throw new Error("None of the responses are valid");
    } catch (error) {
      return this.errorResponse("Chat completion failed", 500, (error as Error).message);
    }
  },

  transformThreadRunRequest(
    run: ThreadRun,
    assistant: Assistant,
    messages: ChatMessage[],
    env: Env
  ): AiChatRequestParts {
    // Base options from both run configuration and assistant defaults
    const baseOptions: AiBaseInputOptions = {
      stream: run.stream ?? undefined,
      max_tokens: run.max_completion_tokens ?? undefined,
      temperature: this.mapTemperatureToCloudflare(
        run.temperature ?? assistant.temperature ?? undefined
      ),
      top_p: run.top_p ?? assistant.top_p,
      seed: run.truncation_strategy?.last_messages ?? undefined,
      frequency_penalty: undefined, // Not directly mapped
      presence_penalty: undefined,   // Not directly mapped
    };

    // Map assistant tools to AI-compatible format
    const mappedTools = this.mapTools(assistant.tools);

    // Handle response format constraints
    const systemMessages = typeof assistant.response_format === 'object' && 'type' in assistant.response_format
      && assistant.response_format?.type === 'json_object' ? [{
        role: 'system' as ChatMessageRole,
        content: 'Respond using JSON format'
      }] : [];

    const options: AiMessagesInputOptions = {
      ...baseOptions,
      messages: [
        ...systemMessages,
        ...messages.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      ],
      tools: mappedTools,
    };

    return {
      model: this.getCfModelName(assistant.model, env),
      options: options
    };
  },

  /**
   * Helper functions
   */
  mapTools(tools: Assistant['tools'] | undefined): Array<Tool | FunctionTool> | undefined {
    if (!tools) return tools;

    console.log("tools", tools);

    return tools.map(tool => {
      switch (tool.type) {
        case 'code_interpreter':
          return {
            type: "function",
            function: {
              name: "code_interpreter",
              description: "Executes Python code",
              parameters: {
                type: "object",
                properties: { code: { type: "string", description: "Python code to execute" } },
                required: ["code"]
              }
            }
          };
        case 'file_search':
          return {
            type: "function",
            function: {
              name: "file_search",
              description: "Searches through files",
              parameters: {
                type: "object",
                properties: { query: { type: "string", description: "Query to search for" } },
                required: ["query"]
              }
            }
          };
        default:
          return {
            type: "function",
            function: {
              name: tool.function.name,
              description: tool.function.description || "",
              parameters: tool.function.parameters
            }
          };
      }
    });
  },

  /**
   * Convert OpenAI tools format to Harmony native format for GPT-OSS models
   * Harmony format uses a simplified structure with name, description, and parameters only
   * (no 'type: function' wrapper)
   */
  convertToolsToHarmonyFormat(tools: Assistant['tools'] | undefined): any[] | undefined {
    if (!tools) return undefined;

    console.log("[Harmony] Converting", tools.length, "tools to Harmony format");

    return tools.map(tool => {
      let name = '';
      let description = '';
      let parameters: any = {
        type: 'object',
        properties: {},
        required: []
      };

      // Handle different tool types
      switch (tool.type) {
        case 'code_interpreter':
          name = 'code_interpreter';
          description = 'Executes Python code';
          parameters = {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Python code to execute' }
            },
            required: ['code']
          };
          break;

        case 'file_search':
          name = 'file_search';
          description = 'Searches through files';
          parameters = {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Query to search for' }
            },
            required: ['query']
          };
          break;

        default:
          // Handle function tools
          if (tool.function) {
            name = tool.function.name;
            description = tool.function.description || '';
            parameters = tool.function.parameters || {
              type: 'object',
              properties: {},
              required: []
            };
          }
          break;
      }

      // Return simplified Harmony format
      const harmonyTool = {
        name,
        description,
        parameters
      };

      console.log(`[Harmony] Tool '${name}':`, JSON.stringify(harmonyTool).substring(0, 150));
      return harmonyTool;
    });
  },

  errorResponse(message: string, status: number, type?: string, details?: string) {
    // OpenAI-compatible error format
    const errorBody = {
      error: {
        message,
        type: type || this.mapStatusToErrorType(status),
        code: status,
        ...(details && { details })
      }
    };

    console.error(`[Error] ${status}: ${message}${details ? ` - ${details}` : ''}`);

    return new Response(JSON.stringify(errorBody), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  },

  /**
   * Map HTTP status code to OpenAI error type
   */
  mapStatusToErrorType(status: number): string {
    switch (status) {
      case 400: return "invalid_request_error";
      case 401: return "authentication_error";
      case 403: return "permission_error";
      case 404: return "not_found_error";
      case 429: return "rate_limit_error";
      case 500:
      case 502:
      case 503:
      default: return "api_error";
    }
  },

  mapTemperatureToCloudflare(temp: number | null | undefined): number {
    /**
     * Maps OpenAI temperature (0-2) to Cloudflare AI temperature (0-5)
     * @param openaiTemp OpenAI-style temperature (0-2)[1]
     * @returns Cloudflare-optimized temperature (0-5)[0.6]
     */
    // Clamp to OpenAI's valid range
    const openaiTemp = temp ?? 1;
    const clamped = Math.min(Math.max(openaiTemp, 0), 2);
    // Linear mapping: 0→0, 1→2.5, 2→5
    return !!temp ? Number(temp) === 1 ? 0.6 : Number((clamped * 2.5).toFixed(1)) : 0.6;
  },

  floatArrayToBase64(vector: number[]): string {
    const float32 = new Float32Array(vector);
    const uint8 = new Uint8Array(float32.buffer);
    return btoa(String.fromCharCode(...uint8));
  },

  getRandomId() {
    return crypto.randomUUID().split('-')[0];
  },

  testAssistantId(assistantId: string | undefined) {
    if (!assistantId || !/^asst/.test(assistantId)) return this.errorResponse("Invalid Assistant ID", 400);
  },

  testThreadId(threadId: string | undefined) {
    if (!threadId || !/^thread/.test(threadId)) return this.errorResponse("Invalid Thread ID", 400);
  },

  async listAIModels(env: Env) {
    if (globalModels.length > 0) return globalModels;

    globalModels = textGenerationModels;
    if (!env?.CF_ACCOUNT_ID || !env?.CF_API_KEY) return globalModels;

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/models/search`,
      {
        method: 'GET', headers: { Authorization: `Bearer ${env.CF_API_KEY}` }
      });

    if (!response.ok) return globalModels;

    const data = await response.json() as FetchModelsResponse;
    const modelTypesInUse = [
      "Text Generation",
      "Text Embeddings",
      "Translation",
      "Text Classification",
      "Summarization"
    ];

    const models: ModelType[] = data
      .result
      .map((model) => ({
        id: `${model.name}#${model.task.name.toLocaleLowerCase().replace(' ', '-')}`,
        name: model.name,
        object: 'model',
        description: model.description,
        taskName: model.task.name,
        taskDescription: model.task.description,
        inUse: modelTypesInUse.includes(model.task.name)
      }));

    globalModels = models;

    return globalModels;
  },

  /**
   * Get Cloudflare model name from OpenAI-style model ID
   * - Supports model aliases (gpt-4 -> llama, etc.) for Onyx compatibility
   * - Strips task name suffix (e.g., #text-generation)
   * - Falls back to default model if none specified
   */
  getCfModelName(modelId: string | undefined, env: Env): string {
    if (!modelId) {
      return env.DEFAULT_AI_MODEL;
    }

    // Check if this is an aliased model name (e.g., gpt-4, gpt-3.5-turbo)
    const aliasedModel = MODEL_ALIASES[modelId] || MODEL_ALIASES[modelId.toLowerCase()];
    if (aliasedModel) {
      console.log(`[Model] Aliasing '${modelId}' -> '${aliasedModel}'`);
      return aliasedModel;
    }

    // Strip task name suffix if present (e.g., @cf/meta/llama-3-8b-instruct#text-generation)
    const cleanModel = modelId.replace(/#.*$/, '');

    return cleanModel || env.DEFAULT_AI_MODEL;
  },

  async displayModelsInfo(env: Env, request: Request) {
    const models = await this.listAIModels(env);
    const searchParams = new URL(request.url).searchParams;
    const query = searchParams.get('query');

    if (query && query === 'json') {
      return new Response(
        JSON.stringify({ data: models }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    const html = `
      <style>
        table { padding: 1rem; font-family: sans; }
        th, td { border: 1px solid gray; padding: 0.5rem; }
        td { vertical-align: top; }
        cose, pre: { font-family: monospace; }
      </style>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Id (Name)</th>
            <th>Task Name</th>
            <th>In use</th>
            <th>Description</th>
          </tr>
        <thead>
        <tbody>
        ${models.sort((a, b) => a.taskName.localeCompare(b.taskName)).map((model, index) => `
          <tr>
            <td>${index + 1}</td>
            <td><pre><b style="font-size: 1.05rem;">${model.id}</b></pre></td>
            <td>${model.taskName}</td>
            <td style="text-align: center;">${model.inUse ? "<b>Yes</b>" : "No"}</td>
            <td>
              <p><b>Model:</b> ${model.description}</p>
              <p><b>Task:</b> ${model.taskDescription}</p>
            </td>
          </tr>
        `).join('')}
        </tbody>
      </table>
    `;

    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  },

};
