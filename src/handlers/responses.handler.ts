/**
 * ============================================================================
 * RESPONSES HANDLER
 * ============================================================================
 *
 * Handles /v1/responses endpoint (OpenAI Responses API)
 */

import { errorResponse } from '../errors';
import { validateAndNormalizeRequest, transformChatCompletionRequest } from '../transformers/request.transformer';

export async function handleResponses(request: Request, env: Env): Promise<Response> {
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
      console.log(`[Responses] Using messages array (Chat Completions style)`);
      messages = data.messages;
    } else if (data.input) {
      console.log(`[Responses] Converting 'input' field to messages`);
      if (typeof data.input === 'string') {
        messages = [{ role: "user" as ChatMessageRole, content: data.input }];
      } else if (Array.isArray(data.input)) {
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
      temperature: data.temperature,
      top_p: data.top_p,
      max_tokens: data.max_tokens || data.max_output_tokens,
      stream: data.stream ?? false,
      ...(data.tools && { tools: data.tools }),
      ...(data.tool_choice && { tool_choice: data.tool_choice }),
    };

    // Validate and normalize for Onyx compatibility
    const validatedData = validateAndNormalizeRequest(openaiRequest, env);

    // Transform to Cloudflare format
    const { model, options } = transformChatCompletionRequest(validatedData, env);
    console.log("[Responses] Model in use:", model, 'Stream:', options?.stream);

    // Log tools being sent to Cloudflare (for debugging)
    if (options?.tools && (options as any).tools.length > 0) {
      console.log(`[Responses] Sending ${(options as any).tools.length} tools to Cloudflare AI`);
      console.log(`[Responses] Tool names: ${(options as any).tools.map((t: any) => t.function?.name).join(', ')}`);
    }

    // Call Cloudflare AI
    const aiRes = await env.AI.run(model, options);

    // For now, return a simple error since we need the full response handling logic
    // This will be implemented with the chat completion response handler
    return errorResponse(
      "Responses API endpoint requires full chat completion handler integration",
      501,
      "not_implemented_error",
      "This endpoint is being refactored"
    );

  } catch (error) {
    console.error(`[Responses] Error:`, error);
    return errorResponse(
      "Response generation failed",
      500,
      "api_error",
      (error as Error).message
    );
  }
}

