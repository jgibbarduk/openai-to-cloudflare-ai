/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 *
 * Helper functions for ID generation, temperature mapping, and other utilities
 */

import { MODEL_MAX_TOKENS } from './constants';

/**
 * Generates a random ID for use in response objects
 * @returns A random hex string
 */
export function getRandomId(): string {
  return Math.random().toString(16).substring(2, 15) + Math.random().toString(16).substring(2, 15);
}

/**
 * Maps OpenAI temperature to Cloudflare format
 * OpenAI uses 0-2, Cloudflare uses similar scale
 * @param temperature OpenAI temperature value
 * @returns Cloudflare-compatible temperature
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
 * Maps OpenAI tools format to Cloudflare tools format
 * @param tools Array of OpenAI tool definitions
 * @returns Array of Cloudflare-compatible tool definitions
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
 * Get the maximum tokens allowed for a model
 * @param model The model identifier
 * @returns Maximum tokens allowed
 */
export function getModelMaxTokens(model: string): number {
  return MODEL_MAX_TOKENS[model] || 4096; // Default to 4096 if not specified
}

/**
 * Clamp max_tokens to model-specific limits
 * @param maxTokens Requested max tokens
 * @param model The model identifier
 * @returns Clamped max tokens value
 */
export function clampMaxTokens(maxTokens: number | undefined, model: string): number | undefined {
  if (!maxTokens) return undefined;

  const modelLimit = getModelMaxTokens(model);
  return Math.min(maxTokens, modelLimit);
}

/**
 * Convert float array to base64 string
 * @param floatArray Array of floats
 * @returns Base64 encoded string
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

