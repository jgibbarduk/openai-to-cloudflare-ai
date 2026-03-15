/**
 * ============================================================================
 * REQUEST TRANSFORMER
 * ============================================================================
 *
 * Transforms and validates OpenAI requests for Cloudflare Workers AI compatibility
 */

import { AUTO_ROUTE_MODEL_NAMES, GPT_OSS_MODELS, MODEL_MAX_TOKENS, TOOL_CAPABLE_MODELS } from '../constants';
import { getCfModelName, resolveAutoRouteModel } from '../model-helpers';
import { mapTemperatureToCloudflare, mapTools, safeByteLength, safeStringify } from '../utils';
import type { OpenAiChatCompletionReq, Env, AiChatRequestParts, AiBaseInputOptions, AiMessagesInputOptions } from '../types';

// Safeguard constants
const MAX_MESSAGES = 100; // Maximum number of messages to send to provider
const MAX_MESSAGE_CHARS = 16000; // Max characters per message
const MAX_REQUEST_BYTES = 200 * 1024; // 200KB total transformed request payload cap
const MAX_MAPPED_TOOLS = 64; // Limit mapped tools to avoid huge tool lists (raised from 5 - was dropping image_generation tool)

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
  // Debug: log a summary of each incoming message so we can see what Onyx sends
  data.messages.forEach((msg: any, i: number) => {
    const contentPreview = typeof msg.content === 'string'
      ? msg.content.slice(0, 200)
      : JSON.stringify(msg.content)?.slice(0, 200);
    const toolCallsPreview = msg.tool_calls ? ` tool_calls=${JSON.stringify(msg.tool_calls).slice(0, 200)}` : '';
    const toolCallIdPreview = msg.tool_call_id ? ` tool_call_id=${msg.tool_call_id}` : '';
    console.log(`[Validation][MSG ${i}] role=${msg.role}${toolCallIdPreview}${toolCallsPreview} content=${contentPreview}`);
  });

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
      if (typeof content !== "string" && Array.isArray(content)) {
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
      } else if (typeof content !== "string") {
        // Fallback stringify for objects
        try {
          content = JSON.stringify(content);
        } catch (e) {
          content = String(content);
        }
      }
    }

    // Enforce per-message character cap.
    // Also handle tool messages that are JSON-stringified image arrays (e.g. "[{\"revised_prompt\":...}]")
    if (typeof content === 'string') {
      if (role === 'tool') {
        // Try to detect a stringified image result array
        if ((content.startsWith('[') && content.includes('revised_prompt')) ||
            content.includes('"b64_json"') ||
            content.includes('data:image')) {
          let revisedPrompt = '';
          try {
            const parsed = JSON.parse(content);
            const item = Array.isArray(parsed) ? parsed[0] : parsed;
            if (item?.revised_prompt) revisedPrompt = item.revised_prompt;
            else if (item?.data?.[0]?.revised_prompt) revisedPrompt = item.data[0].revised_prompt;
          } catch { /* not valid JSON */ }
          console.log(`[Validation] Tool message is stringified image result, replacing with success summary`);
          content = `Image generation succeeded. Revised prompt: "${revisedPrompt}". The image has been displayed to the user.`;
        } else if (content.length > MAX_MESSAGE_CHARS) {
          console.log(`[Validation] Truncating tool message content from ${content.length} to ${MAX_MESSAGE_CHARS} chars`);
          content = content.slice(0, MAX_MESSAGE_CHARS);
        }
      } else if (content.length > MAX_MESSAGE_CHARS) {
        console.log(`[Validation] Truncating message content from ${content.length} to ${MAX_MESSAGE_CHARS} chars`);
        content = content.slice(0, MAX_MESSAGE_CHARS);
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

  // Enforce maximum number of messages by trimming oldest messages if needed
  if (data.messages.length > MAX_MESSAGES) {
    console.log(`[Validation] Trimming messages from ${data.messages.length} to ${MAX_MESSAGES}`);
    // Keep the latest messages (assume end of array is most recent)
    data.messages = data.messages.slice(-MAX_MESSAGES);
  }

  // Step 4: Strip unsupported OpenAI fields
  // NOTE: response_format is intentionally kept — it is checked downstream in
  // transformChatCompletionRequest to inject a JSON system prompt when type=json_object.
  const unsupportedFields = [
    "functions",
    "function_call",
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
  // Auto-routing: when the client requests 'auto' or 'auto/route', select the
  // best Cloudflare model based on the request's tools, context size, etc.
  if (request.model && AUTO_ROUTE_MODEL_NAMES.includes(request.model.trim())) {
    const routedModel = resolveAutoRouteModel(request, env);
    console.log(`[Transform] Auto-route: resolved '${request.model}' → '${routedModel}'`);
    request = { ...request, model: routedModel };
  }

  // Base options common to both prompt and messages formats
  const requestedMaxTokens = request.max_completion_tokens ?? request.max_tokens ?? 16384;

  // Get the resolved model FIRST to determine its max_tokens limit
  let resolvedModel = getCfModelName(request?.model, env);
  const modelMaxTokensLimit = MODEL_MAX_TOKENS[resolvedModel] || 4096;  // Default to 4096 if not specified

  // For reasoning models like Qwen, enforce a minimum token floor so the model
  // has enough budget to reason and respond. A small floor (512) is sufficient —
  // do NOT set this to modelMaxTokensLimit or the user's requested value is always ignored.
  const isReasoningModel = resolvedModel.includes('qwen');
  const MIN_TOKENS_FOR_REASONING = isReasoningModel ? 512 : 0;

  // Clamp to model's specific limit, then apply the minimum floor
  const maxTokens = Math.max(
    Math.min(requestedMaxTokens, modelMaxTokensLimit),
    MIN_TOKENS_FOR_REASONING
  );

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
  // Limit tools to a reasonable cap to avoid huge payloads
  const toolsToMap = (request.tools && Array.isArray(request.tools)) ? request.tools.slice(0, MAX_MAPPED_TOOLS) : undefined;
  const mappedTools = supportsTools && toolsToMap ? mapTools(toolsToMap) : undefined;

  if (mappedTools) {
    console.log(`[Transform] Mapped ${mappedTools.length} tools for ${resolvedModel} (capped to ${MAX_MAPPED_TOOLS})`);
  } else if (request.tools && request.tools.length > 0) {
    console.log(`[Transform] Tools present but not mapped (supportsTools=${supportsTools}) or mapped count is zero`);
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

  // Final safety check: Prevent excessively large transformed payloads
  try {
    const preview = safeStringify({ model: resolvedModel, options });
    const bytes = safeByteLength(preview);
    if (bytes > MAX_REQUEST_BYTES) {
      console.warn(`[Transform] Transformed request size ${bytes} bytes exceeds cap ${MAX_REQUEST_BYTES}. Attempting to compact messages.`);
      // Compact strategy: remove older messages until under cap
      let msgs = options.messages || [];
      while (safeByteLength(safeStringify({ model: resolvedModel, options: { ...options, messages: msgs } })) > MAX_REQUEST_BYTES && msgs.length > 1) {
        msgs = msgs.slice(Math.floor(msgs.length / 2)); // keep newest half
      }
      options.messages = msgs;
      console.log(`[Transform] Compacted messages to ${options.messages.length} items to meet byte cap`);
    }
  } catch (e) {
    console.warn('[Transform] Failed to compute transformed request size:', e);
  }

   return {
     model: resolvedModel,
     options: options
   };
 }
