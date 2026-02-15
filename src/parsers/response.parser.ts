/**
 * ============================================================================
 * RESPONSE PARSERS
 * ============================================================================
 *
 * Parses and transforms responses from different Cloudflare AI response formats
 * into a normalized AiJsonResponse structure for consumption by response builders.
 *
 * Cloudflare Workers AI supports three response formats:
 * 1. **GPT-OSS format**: {output: [{type: "reasoning"|"message", content: [...]}]}
 * 2. **OpenAI-compatible format**: {choices: [{message: {content, reasoning_content, tool_calls}}]}
 * 3. **Legacy format**: Direct response text
 *
 * These parsers handle format detection, content extraction, tool call transformation,
 * reasoning content separation, and token usage estimation.
 *
 * @module parsers/response
 */

import { REASONING_MODELS } from '../constants';
import type { AiJsonResponse, UsageStats } from '../types';

/**
 * ============================================================================
 * HELPER FUNCTIONS
 * ============================================================================
 */

/**
 * Ensure response text is never null, undefined, or empty.
 */
function ensureValidResponseText(text: string | null | undefined, source: string): string {
  if (!text || text.trim().length === 0) {
    console.warn(`[${source}] No text content extracted, using fallback space character`);
    return " ";
  }
  return text;
}

/**
 * Estimate token usage from text length.
 * Uses rough approximation: 1 token ≈ 4 characters.
 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Create default usage stats.
 */
function createDefaultUsage(): UsageStats {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0
  };
}

/**
 * ============================================================================
 * GPT-OSS FORMAT PARSER
 * ============================================================================
 */

/**
 * Extract response from GPT-OSS format.
 *
 * GPT-OSS models (like @cf/openai/gpt-oss-20b, @cf/openai/gpt-oss-120b) return
 * a different format with an output array containing message and reasoning items.
 *
 * Format: {output: [{type: "reasoning"|"message", content: [{text: "..."}]}]}
 *
 * This parser:
 * 1. Extracts text from "message" type items (preferred)
 * 2. Falls back to "reasoning" type if no message found
 * 3. Estimates token usage if not provided
 *
 * @param res - Raw response from Cloudflare AI (GPT-OSS format)
 * @returns Normalized AiJsonResponse with extracted content
 *
 * @example
 * // GPT-OSS response:
 * {
 *   output: [
 *     { type: "reasoning", content: [{text: "Let me think..."}] },
 *     { type: "message", content: [{text: "The answer is 42"}] }
 *   ]
 * }
 * // Returns: { response: "The answer is 42", ... }
 */
export function extractGptOssResponse(res: any): AiJsonResponse {
  try {
    console.log("[GPT-OSS] Parsing response, keys:", Object.keys(res).join(', '));

    // Validate output array exists
    if (!res.output || !Array.isArray(res.output)) {
      console.warn("[GPT-OSS] No output array found in response");
      return {
        response: ensureValidResponseText(null, "GPT-OSS"),
        contentType: "application/json",
        usage: createDefaultUsage()
      };
    }

    console.log(`[GPT-OSS] Processing ${res.output.length} output items`);

    // Extract text from message type items (preferred)
    let responseText = "";

    for (const item of res.output) {
      if (item.type === "message" && item.content && Array.isArray(item.content)) {
        for (const contentItem of item.content) {
          if (contentItem.text) {
            responseText += contentItem.text;
          }
        }
      }
    }

    console.log(`[GPT-OSS] Extracted ${responseText.length} chars from message items`);

    // Fallback: extract from reasoning type if no message found
    if (!responseText) {
      console.log("[GPT-OSS] No message content, falling back to reasoning");
      for (const item of res.output) {
        if (item.type === "reasoning" && item.content && Array.isArray(item.content)) {
          for (const contentItem of item.content) {
            if (contentItem.text) {
              responseText += contentItem.text;
            }
          }
          if (responseText) break; // Use first reasoning item with content
        }
      }
    }

    // Estimate token usage if not provided
    const usage = res.usage || {
      prompt_tokens: estimateTokens((res.instructions || "") + (res.input || "")),
      completion_tokens: estimateTokens(responseText),
      total_tokens: 0
    };
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;

    console.log(`[GPT-OSS] Parsed response: ${responseText.length} chars, usage:`, usage);

    return {
      response: ensureValidResponseText(responseText, "GPT-OSS"),
      contentType: "application/json",
      usage: usage
    };
  } catch (error) {
    console.error("[GPT-OSS] Parse error:", error);
    return {
      response: ensureValidResponseText(null, "GPT-OSS"),
      contentType: "application/json",
      usage: createDefaultUsage()
    };
  }
}

/**
 * ============================================================================
 * RESPONSE SANITIZATION
 * ============================================================================
 */

/**
 * Sanitize AI response to ensure valid content and structure.
 *
 * Handles edge cases where Cloudflare returns:
 * - null or undefined response
 * - Non-string response (numbers, objects)
 * - Empty strings
 * - Invalid tool_calls structure
 *
 * @param res - Raw AI response to sanitize
 * @returns Sanitized AiJsonResponse with guaranteed valid content
 *
 * @example
 * // Handles null response:
 * sanitizeAiResponse({ response: null })
 * // Returns: { response: " ", ... }
 *
 * @example
 * // Handles numeric response:
 * sanitizeAiResponse({ response: 42 })
 * // Returns: { response: "42", ... }
 */
export function sanitizeAiResponse(res: any): AiJsonResponse {
  console.log("[Sanitize] Validating response structure");

  // Ensure response field exists and is valid
  let response = res.response;

  // Handle null/undefined
  if (response === null || response === undefined) {
    console.warn("[Sanitize] Response is null/undefined, using fallback");
    response = " ";
  }
  // Convert non-strings to strings
  else if (typeof response !== 'string') {
    console.warn(`[Sanitize] Response is ${typeof response}, converting to string`);
    response = String(response);
  }

  // Handle empty strings
  if (!response || response.trim().length === 0) {
    console.warn("[Sanitize] Response is empty, using fallback");
    response = " ";
  }

  // Validate tool_calls structure
  let toolCalls = res.tool_calls;
  if (toolCalls !== undefined) {
    if (!Array.isArray(toolCalls)) {
      console.warn("[Sanitize] tool_calls is not an array, removing");
      toolCalls = undefined;
    } else if (toolCalls.length === 0) {
      console.log("[Sanitize] tool_calls array is empty, removing");
      toolCalls = undefined;
    }
  }

  return {
    response,
    contentType: res.contentType || "application/json",
    usage: res.usage || createDefaultUsage(),
    ...(toolCalls && { tool_calls: toolCalls }),
    ...(res.reasoning_content && { reasoning_content: res.reasoning_content })
  };
}

/**
 * ============================================================================
 * OPENAI-COMPATIBLE FORMAT PARSER
 * ============================================================================
 */

/**
 * Extract response from OpenAI-compatible format.
 *
 * Modern Cloudflare AI models return an OpenAI-compatible format with choices array.
 * This is the most common format for models like Qwen, Llama, Mistral, etc.
 *
 * Format: {choices: [{message: {content, reasoning_content, tool_calls}}], usage: {...}}
 *
 * This parser:
 * 1. Extracts message content and reasoning_content separately
 * 2. Handles tool calls transformation to Cloudflare format
 * 3. Validates and estimates token usage
 * 4. Adjusts token counts for reasoning models
 *
 * @param res - Raw response from Cloudflare AI (OpenAI-compatible format)
 * @param model - Model identifier for reasoning model detection
 * @returns Normalized AiJsonResponse with extracted content
 *
 * @example
 * // OpenAI-compatible response:
 * {
 *   choices: [{
 *     message: {
 *       role: "assistant",
 *       content: "The answer is 42",
 *       reasoning_content: "Let me think..."
 *     }
 *   }],
 *   usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
 * }
 * // Returns: { response: "The answer is 42", reasoning_content: "Let me think...", ... }
 */
export function extractOpenAiCompatibleResponse(res: any, model: string): AiJsonResponse {
  try {
    console.log("[OpenAI-Compat] Parsing response, has choices:", !!res.choices);

    // Validate response structure
    if (!res.choices || !Array.isArray(res.choices) || res.choices.length === 0) {
      console.warn("[OpenAI-Compat] Invalid or empty choices array");
      return {
        response: ensureValidResponseText(null, "OpenAI-Compat"),
        contentType: "application/json",
        usage: res.usage || createDefaultUsage()
      };
    }

    const firstChoice = res.choices[0];
    const message = firstChoice?.message;

    if (!message) {
      console.warn("[OpenAI-Compat] No message in first choice");
      return {
        response: ensureValidResponseText(null, "OpenAI-Compat"),
        contentType: "application/json",
        usage: res.usage || createDefaultUsage()
      };
    }

    // Extract reasoning content (thinking process)
    let reasoningContent = "";
    if (message.reasoning_content && typeof message.reasoning_content === 'string') {
      reasoningContent = message.reasoning_content;
      console.log(`[OpenAI-Compat] Found reasoning_content: ${reasoningContent.length} chars`);
    }

    // Extract main content (final answer)
    let responseText = "";
    if (message.content && typeof message.content === 'string') {
      responseText = message.content;
      console.log(`[OpenAI-Compat] Found content: ${responseText.length} chars`);
    }
    // Handle tool calls (no regular content when tools are called)
    else if (message.tool_calls && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      console.log(`[OpenAI-Compat] Found ${message.tool_calls.length} tool call(s), no content`);

      // Transform to Cloudflare format
      const toolCalls = message.tool_calls.map((tc: any) => ({
        name: tc.function?.name || tc.name,
        arguments: typeof tc.function?.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : tc.function?.arguments || tc.arguments
      }));

      return {
        response: "", // Empty for tool calls
        contentType: "application/json",
        usage: res.usage || createDefaultUsage(),
        tool_calls: toolCalls,
        ...(reasoningContent && { reasoning_content: reasoningContent })
      };
    }

    // Validate and estimate usage
    let usage = res.usage || createDefaultUsage();

    // Check if model supports reasoning
    const isReasoningModel = REASONING_MODELS.some(rm =>
      model.toLowerCase().includes(rm.toLowerCase())
    );

    // Estimate usage if missing or all zeros
    if (usage.prompt_tokens === 0 && usage.completion_tokens === 0) {
      const contentLength = isReasoningModel
        ? responseText.length + reasoningContent.length
        : responseText.length;

      usage.prompt_tokens = 10; // Minimum estimate
      usage.completion_tokens = estimateTokens(responseText + reasoningContent);
      usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;

      console.log(
        `[OpenAI-Compat] Estimated usage for ${isReasoningModel ? 'reasoning' : 'standard'} model:`,
        usage
      );
    }
    // Adjust usage for non-reasoning models with reasoning content
    else if (!isReasoningModel && reasoningContent) {
      usage.completion_tokens = estimateTokens(responseText);
      usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
      console.log(`[OpenAI-Compat] Adjusted usage for non-reasoning model (stripped reasoning)`);
    }

    return {
      response: ensureValidResponseText(responseText, "OpenAI-Compat"),
      contentType: "application/json",
      usage: usage,
      ...(reasoningContent && { reasoning_content: reasoningContent })
    };
  } catch (error) {
    console.error("[OpenAI-Compat] Parse error:", error);
    return {
      response: ensureValidResponseText(null, "OpenAI-Compat"),
      contentType: "application/json",
      usage: createDefaultUsage()
    };
  }
}

