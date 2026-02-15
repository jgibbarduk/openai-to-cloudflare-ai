/**
 * ============================================================================
 * REQUEST TRANSFORMER
 * ============================================================================
 *
 * Transforms and validates OpenAI requests for Cloudflare Workers AI compatibility
 */

import { GPT_OSS_MODELS, MODEL_MAX_TOKENS, TOOL_CAPABLE_MODELS } from '../constants';
import { getCfModelName } from '../model-helpers';
import { mapTemperatureToCloudflare, mapTools } from '../utils';

/**
 * Validate and normalize OpenAI request for Onyx compatibility
 *
 * This method implements the specification for:
 * - Message content validation (never null)
 * - Unsupported field stripping (tools, tool_choice, functions, etc.)
 * - Default value application
 * - Parameter clamping
 */
export function validateAndNormalizeRequest(data: OpenAiChatCompletionReq, env: Env): OpenAiChatCompletionReq {
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

  console.log("[Validation] Final message count:", data.messages.length);

  return data;
}

/**
 * Transform OpenAI Chat Completion request to Cloudflare Workers AI format
 */
export function transformChatCompletionRequest(request: OpenAiChatCompletionReq, env: Env): AiChatRequestParts {
  // Base options common to both prompt and messages formats
  const requestedMaxTokens = request.max_completion_tokens ?? request.max_tokens ?? 16384;

  // Get the resolved model FIRST to determine its max_tokens limit
  let resolvedModel = getCfModelName(request?.model, env);
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
    temperature: mapTemperatureToCloudflare(request?.temperature ?? undefined),
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
  const mappedTools = supportsTools && request.tools ? mapTools(request.tools) : undefined;

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
}

