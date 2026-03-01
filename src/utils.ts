/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 *
 * Helper functions for ID generation, temperature mapping, tools transformation,
 * token management, and data encoding utilities.
 *
 * @module utils
 */

import { MODEL_MAX_TOKENS } from './constants';

/**
 * ============================================================================
 * ID GENERATION
 * ============================================================================
 */

/**
 * Generates a random UUID for use in response objects.
 * Uses crypto.randomUUID() for better security and uniqueness compared to Math.random().
 *
 * @returns A UUID v4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 *
 * @example
 * const id = generateUUID();
 * // Returns: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}


/**
 * ============================================================================
 * PARAMETER MAPPING
 * ============================================================================
 */

/**
 * Maps OpenAI temperature parameter to Cloudflare-compatible format.
 *
 * Both OpenAI and Cloudflare use the same temperature range [0, 2].
 * This function validates and clamps the input to ensure it falls within
 * the acceptable range.
 *
 * @param temperature - OpenAI temperature value (0-2, where 0 is deterministic and 2 is very random)
 * @returns Cloudflare-compatible temperature, clamped to [0, 2], or undefined if input is null/undefined
 *
 * @example
 * mapTemperatureToCloudflare(0.7);  // Returns: 0.7
 * mapTemperatureToCloudflare(3.0);  // Returns: 2 (clamped to max)
 * mapTemperatureToCloudflare(-1);   // Returns: 0 (clamped to min)
 * mapTemperatureToCloudflare(undefined); // Returns: undefined
 */
export function mapTemperatureToCloudflare(temperature: number | undefined): number | undefined {
  if (temperature === undefined || temperature === null) {
    return undefined;
  }
  // Clamp to valid range [0, 2]
  const clamped = Math.max(0, Math.min(2, temperature));
  return clamped;
}

/**
 * ============================================================================
 * TOOLS TRANSFORMATION
 * ============================================================================
 */

/**
 * Maps OpenAI tools format to Cloudflare tools format.
 *
 * Transforms tool definitions from OpenAI's API format to the format
 * expected by Cloudflare Workers AI. Currently only 'function' type tools
 * are supported.
 *
 * @param tools - Array of OpenAI tool definitions (can be undefined or null)
 * @returns Array of Cloudflare-compatible tool definitions (empty array if input is invalid)
 *
 * @example
 * const openAiTools = [{
 *   type: 'function',
 *   function: {
 *     name: 'get_weather',
 *     description: 'Get current weather',
 *     parameters: { type: 'object', properties: { location: { type: 'string' } } }
 *   }
 * }];
 * const cfTools = mapTools(openAiTools);
 * // Returns the same structure (formats are compatible)
 *
 * @see {@link https://developers.cloudflare.com/workers-ai/function-calling/ | Cloudflare Function Calling}
 */
export function mapTools(tools: any[]): any[] {
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
}

/**
 * ============================================================================
 * TOKEN MANAGEMENT
 * ============================================================================
 */

/**
 * Get the maximum tokens allowed for a specific model.
 *
 * Retrieves the token limit from the MODEL_MAX_TOKENS configuration.
 * If the model is not found, returns a default value of 4096.
 *
 * @param model - The model identifier (e.g., "@cf/meta/llama-3.1-8b-instruct")
 * @returns Maximum tokens allowed for the model
 *
 * @example
 * getModelMaxTokens('@cf/meta/llama-3.1-8b-instruct');
 * // Returns: 8192
 *
 * getModelMaxTokens('unknown-model');
 * // Returns: 4096 (default)
 *
 * @see {@link MODEL_MAX_TOKENS} - Configuration mapping
 */
export function getModelMaxTokens(model: string): number {
  return MODEL_MAX_TOKENS[model] || 4096; // Default to 4096 if not specified
}


/**
 * ============================================================================
 * DATA ENCODING UTILITIES
 * ============================================================================
 */

/**
 * Convert float array to base64 string.
 *
 * Encodes an array of floating-point numbers as a base64 string by first
 * converting to Float32Array, then to Uint8Array, and finally encoding as base64.
 * This is commonly used for encoding embeddings vectors.
 *
 * @param floatArray - Array of floating-point numbers
 * @returns Base64 encoded string
 *
 * @example
 * const embedding = [0.1, 0.2, 0.3, -0.4];
 * const encoded = floatArrayToBase64(embedding);
 * // Returns: base64 string representation of the float array
 *
 * @remarks
 * - Uses Float32Array for consistent 32-bit floating-point precision
 * - The btoa() function is used for base64 encoding (available in browsers and Workers)
 * - For large arrays, consider performance implications of string concatenation
 */
export function floatArrayToBase64(floatArray: number[]): string {
  const float32Array = new Float32Array(floatArray);
  const uint8Array = new Uint8Array(float32Array.buffer);
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

/**
 * ============================================================================
 * CLOUD FLARE / BROWSER SAFE HELPERS
 * ============================================================================
 */

/**
 * Get the byte length of a string input.
 *
 * Safely calculates the byte length of a string using TextEncoder,
 * falling back to string length for compatibility with older environments.
 *
 * @param input - The input string
 * @returns The byte length of the string
 *
 * @example
 * safeByteLength('Hello, world!');
 * // Returns: 13
 */
export function safeByteLength(input: string): number {
  try {
    // TextEncoder is available in Cloudflare Workers and modern Node runtimes
    return new TextEncoder().encode(String(input)).length;
  } catch (e) {
    // Fallback: approximate by string length (not accurate for multibyte)
    return String(input).length;
  }
}

/**
 * Safely stringify a value for logging or inspection.
 *
 * Serializes a value to a JSON string, handling circular references,
 * and common non-serializable types (e.g., ReadableStream, ArrayBuffer).
 * The output is truncated to a maximum length to prevent excessive output.
 *
 * @param value - The value to stringify
 * @param options - Optional settings
 * @param options.maxLength - Maximum length of the output string (default: 2000)
 * @returns The serialized string, or '[Unserializable]' if serialization fails
 *
 * @example
 * safeStringify({ foo: 'bar' });
 * // Returns: '{"foo":"bar"}'
 *
 * safeStringify(ReadableStream.from(['data']));
 * // Returns: '[ReadableStream]'
 *
 * safeStringify(new ArrayBuffer(8));
 * // Returns: '[ArrayBuffer:8]'
 *
 * safeStringify({ circular: {} }, { maxLength: 100 });
 * // Returns: '{"circular":"[Circular]"}'
 */
export function safeStringify(value: any, { maxLength = 2000 } = {}): string {
  const seen = new WeakSet();
  try {
    const s = JSON.stringify(value, function replacer(_key, v) {
      if (v && typeof v === 'object') {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }

      // Handle common non-serializable types gracefully
      if (typeof ReadableStream !== 'undefined' && v instanceof ReadableStream) return '[ReadableStream]';
      if (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer) return `[ArrayBuffer:${(v as ArrayBuffer).byteLength}]`;
      if (typeof Uint8Array !== 'undefined' && v instanceof Uint8Array) return `[Uint8Array:${(v as Uint8Array).byteLength}]`;
      if (typeof v === 'function') return `[Function: ${v.name || 'anonymous'}]`;
      return v;
    }, 2);

    if (typeof s === 'string') {
      if (s.length <= maxLength) return s;
      return s.slice(0, maxLength) + '...[truncated]';
    }
    return String(s);
  } catch (e) {
    try {
      const s = String(value);
      return s.length <= maxLength ? s : s.slice(0, maxLength) + '...[truncated]';
    } catch (_) {
      return '[Unserializable]';
    }
  }
}
