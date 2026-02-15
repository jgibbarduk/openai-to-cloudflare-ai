/**
 * ============================================================================
 * IMAGE GENERATION HANDLER
 * ============================================================================
 *
 * Handles the POST /v1/images/generations endpoint for generating images.
 * Converts OpenAI DALL-E requests to Cloudflare Workers AI (Flux) format
 * and returns images in OpenAI-compatible format.
 *
 * Supported models:
 * - dall-e-2, dall-e-3 → Flux 2 Klein 9B
 * - gpt-image-1 → Flux 2 Klein 9B
 * - @cf/black-forest-labs/flux-* (direct Cloudflare models)
 *
 * @module handlers/image
 */

import { errorResponse, validationError, serverError } from '../errors';
import { getCfModelName } from '../model-helpers';
import type { Env, OpenAiImageGenerationReq, OpenAiImageObject, OpenAiImageGenerationRes } from '../types';

/**
 * ============================================================================
 * HELPER FUNCTIONS
 * ============================================================================
 */

/**
 * Check if a model is an image generation model.
 */
function isImageGenerationModel(model: string, requestedModel: string): boolean {
  return model.includes('flux') ||
         model.includes('dall-e') ||
         model.includes('stable-diffusion') ||
         model.includes('gpt-image') ||
         requestedModel.includes('dall-e') ||
         requestedModel.includes('gpt-image');
}

/**
 * Parse size string (e.g., "1024x1024") to width/height object.
 */
function parseImageSize(size: string): { width: number; height: number } | null {
  const parts = size.split('x').map(s => parseInt(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { width: parts[0], height: parts[1] };
  }
  return null;
}

/**
 * Convert binary data to base64 string.
 */
function binaryToBase64(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof Uint8Array ? Array.from(data) : Array.from(new Uint8Array(data));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Read all chunks from a ReadableStream and convert to base64.
 */
async function streamToBase64(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  let result;
  while (!(result = await reader.read()).done) {
    chunks.push(result.value);
  }

  // Combine all chunks
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const fullData = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    fullData.set(chunk, offset);
    offset += chunk.length;
  }

  return binaryToBase64(fullData);
}

/**
 * ============================================================================
 * HANDLER
 * ============================================================================
 */

/**
 * Handle POST /v1/images/generations request.
 *
 * Generates images using Cloudflare Workers AI (Flux models).
 * Supports OpenAI DALL-E API format for compatibility.
 *
 * @param request - HTTP request with image generation request body
 * @param env - Cloudflare Workers environment with AI binding
 * @returns OpenAI-compatible JSON response with image data
 *
 * @example
 * // Request:
 * {
 *   "model": "dall-e-3",
 *   "prompt": "A sunset over mountains",
 *   "n": 1,
 *   "size": "1024x1024",
 *   "response_format": "url"
 * }
 *
 * // Response:
 * {
 *   "created": 1708012800,
 *   "data": [
 *     { "url": "data:image/png;base64,..." }
 *   ],
 *   "model": "dall-e-3"
 * }
 *
 * @see {@link https://platform.openai.com/docs/api-reference/images/create | OpenAI Images API}
 */
export async function handleImageGeneration(request: Request, env: Env): Promise<Response> {
  const startTime = Date.now();
  console.log('[Image] Processing image generation request...');

  try {
    // Parse request body
    const data = await request.json() as OpenAiImageGenerationReq;
    const { model: requestedModel, prompt, n = 1, response_format = 'url', size } = data;

    // Validate required fields
    if (!prompt) {
      return validationError('Prompt is required', 'prompt');
    }

    if (!requestedModel) {
      return validationError('Model is required', 'model');
    }

    // Resolve model name (e.g., dall-e-3 -> @cf/black-forest-labs/flux-2-klein-9b)
    const model = getCfModelName(requestedModel, env);
    console.log(`[Image] Using model: ${model} (requested: ${requestedModel})`);

    // Validate it's an image generation model
    if (!isImageGenerationModel(model, requestedModel)) {
      return validationError(
        `Model "${requestedModel}" is not a valid image generation model. Use dall-e-2, dall-e-3, or gpt-image-1.`,
        'model'
      );
    }

    // Prepare image generation options
    const imageInput: any = { prompt };

    // Add size if provided
    if (size) {
      const dimensions = parseImageSize(size);
      if (dimensions) {
        imageInput.width = dimensions.width;
        imageInput.height = dimensions.height;
        console.log(`[Image] Size: ${dimensions.width}x${dimensions.height}`);
      }
    }

    console.log(`[Image] Generating image with prompt (${prompt.length} chars)`);

    // Call Cloudflare Workers AI
    let aiRes;
    try {
      aiRes = await env.AI.run(model as any, imageInput);
      console.log(`[Image] Generation complete, response type: ${typeof aiRes}`);
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      console.error(`[Image] AI generation failed:`, errorMsg);

      // Handle specific error types
      if (errorMsg.includes('authentication') || errorMsg.includes('unauthorized') ||
          errorMsg.includes('401') || errorMsg.includes('403')) {
        return serverError(
          'Authentication failed for image generation',
          'Check Cloudflare Workers AI credentials'
        );
      }

      if (errorMsg.includes('not found') || errorMsg.includes('404')) {
        return serverError(
          'Image generation model not available',
          `Model ${model} not found in Cloudflare Workers AI`
        );
      }

      throw error;
    }

    // Extract image data from response
    let imageData: string = '';

    if (aiRes instanceof ReadableStream) {
      console.log('[Image] Processing streaming response...');
      imageData = await streamToBase64(aiRes);
      console.log(`[Image] Converted stream to base64 (${imageData.length} chars)`);
    }
    else if (aiRes instanceof Uint8Array || aiRes instanceof ArrayBuffer) {
      imageData = binaryToBase64(aiRes);
      console.log(`[Image] Converted binary to base64 (${imageData.length} chars)`);
    }
    else if (typeof aiRes === 'string') {
      imageData = aiRes;
      console.log(`[Image] String response (${imageData.length} chars)`);
    }
    else if (typeof aiRes === 'object' && aiRes !== null) {
      // Check various possible response formats
      if ('image' in aiRes) {
        const imgData = (aiRes as any).image;
        if (imgData instanceof Uint8Array || imgData instanceof ArrayBuffer) {
          imageData = binaryToBase64(imgData);
        } else if (typeof imgData === 'string') {
          imageData = imgData;
        }
      } else if ('data' in aiRes && typeof (aiRes as any).data === 'string') {
        imageData = (aiRes as any).data;
      } else if ('result' in aiRes && typeof (aiRes as any).result === 'string') {
        imageData = (aiRes as any).result;
      } else {
        console.error(`[Image] Unexpected response format:`, Object.keys(aiRes));
        return serverError(
          'Image generation returned unexpected format',
          `Response keys: ${Object.keys(aiRes).join(', ')}`
        );
      }
    }

    // Validate we have image data
    if (!imageData || imageData.length === 0) {
      console.error('[Image] No image data generated');
      return serverError('Failed to generate image', 'No image data returned from AI');
    }

    console.log(`[Image] Final image data: ${imageData.length} chars`);

    // Format response based on requested format
    const imageObject: OpenAiImageObject = {};

    if (response_format === 'b64_json') {
      // Return base64-encoded JSON
      if (imageData.startsWith('data:image')) {
        imageObject.b64_json = imageData.split(',')[1];
      } else if (imageData.startsWith('/9j/') || imageData.startsWith('iVBORw0KGgo')) {
        imageObject.b64_json = imageData;
      } else {
        imageObject.b64_json = btoa(imageData);
      }
    } else {
      // Return as data URL
      if (imageData.startsWith('data:image')) {
        imageObject.url = imageData;
      } else if (imageData.startsWith('/9j/') || imageData.startsWith('iVBORw0KGgo')) {
        imageObject.url = `data:image/png;base64,${imageData}`;
      } else {
        imageObject.url = imageData;
      }
    }

    // Build OpenAI-compatible response
    const responseData: OpenAiImageGenerationRes = {
      created: Math.floor(Date.now() / 1000),
      data: Array(n).fill(null).map(() => ({ ...imageObject })),
      model: requestedModel
    };

    const duration = Date.now() - startTime;
    console.log(`[Image] Generated ${n} image(s) in ${duration}ms`);

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Image] Failed after ${duration}ms:`, error);

    return serverError(
      'Image generation failed',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

