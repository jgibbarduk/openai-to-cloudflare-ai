/**
 * ============================================================================
 * RESPONSE PARSERS
 * ============================================================================
 *
 * Parses and extracts responses from different AI provider formats:
 * - GPT-OSS format (output array with message/reasoning types)
 * - OpenAI-compatible format (choices array with message object)
 * - Sanitizes raw responses to ensure valid content
 */

import { REASONING_MODELS } from '../constants';

/**
 * Extract response from GPT-OSS format
 * GPT-OSS returns {output: [{type: "reasoning"|"message", content: [...]}]}
 */
export function extractGptOssResponse(res: any): AiJsonResponse {
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

    // Estimate token usage
    let usage = res.usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };

    if (!usage.prompt_tokens && !usage.completion_tokens) {
      usage.prompt_tokens = Math.ceil(((res.instructions || "") + (res.input || "")).length / 4);
      usage.completion_tokens = Math.ceil(responseText.length / 4);
      usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
      console.log("[GPT-OSS] Estimated token usage - prompt:", usage.prompt_tokens, "completion:", usage.completion_tokens);
    }

    // Ensure response is never empty
    if (!responseText || responseText.trim().length === 0) {
      console.warn("[GPT-OSS] No text content extracted, using fallback");
      responseText = " ";
    }

    return {
      response: responseText || " ",
      contentType: "application/json",
      usage: usage
    };
  } catch (error) {
    console.error("[GPT-OSS] Error extracting response:", error);
    return {
      response: " ",
      contentType: "application/json",
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
  }
}

/**
 * Sanitize AI response to ensure it has valid content
 * Handles cases where Cloudflare returns invalid characters or numbers instead of strings
 */
export function sanitizeAiResponse(res: any): AiJsonResponse {
  console.log("[Sanitize] Ensuring response has valid content");

  // Ensure response field exists and is valid
  let response = res.response;

  // Handle null/undefined
  if (response === null || response === undefined) {
    console.warn("[Sanitize] Response is null/undefined, using space");
    response = " ";
  }
  // Convert non-strings to strings
  else if (typeof response !== 'string') {
    console.warn(`[Sanitize] Response is ${typeof response}, converting to string`);
    response = String(response);
  }

  // Handle empty strings
  if (!response || response.trim().length === 0) {
    console.warn("[Sanitize] Response is empty, using space");
    response = " ";
  }

  // Ensure tool_calls are valid if present
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
}

/**
 * Extract response from OpenAI-compatible format that Cloudflare now returns
 * This handles responses with choices array, and supports reasoning_content field
 */
export function extractOpenAiCompatibleResponse(res: any, model: string): AiJsonResponse {
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

    // Ensure usage data is always provided with realistic estimates
    let usage = res.usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };

    // Check if model is a reasoning model
    const isReasoningModel = REASONING_MODELS.some(rm => model.toLowerCase().includes(rm.toLowerCase()));

    // If Cloudflare returns all zeros OR missing values, estimate from actual content
    if ((usage.prompt_tokens === 0 || !usage.prompt_tokens) && (usage.completion_tokens === 0 || !usage.completion_tokens)) {
      const contentForUsage = isReasoningModel
        ? responseText.length + reasoningContent.length
        : responseText.length;

      usage.prompt_tokens = 10;  // Minimum for test request
      usage.completion_tokens = Math.max(1, Math.ceil(contentForUsage / 4));
      usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
      console.log(`[OpenAI-Compat] Estimated usage for ${isReasoningModel ? 'reasoning' : 'non-reasoning'} model - prompt:`, usage.prompt_tokens, "completion:", usage.completion_tokens, "from text length:", contentForUsage);
    }
    // If non-reasoning model has reasoning content, recalculate
    else if (!isReasoningModel && reasoningContent.length > 0) {
      const visibleTokens = Math.max(1, Math.ceil(responseText.length / 4));
      console.log(`[OpenAI-Compat] Adjusting token count for non-reasoning model - original completion_tokens: ${usage.completion_tokens}, adjusted to: ${visibleTokens} (reasoning stripped)`);
      usage.completion_tokens = visibleTokens;
      usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    }

    // Ensure response is never empty
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
      response: " ",
      contentType: "application/json",
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
  }
}

