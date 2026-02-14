/**
 * ============================================================================
 * IMAGE GENERATION HANDLER
 * ============================================================================
 *
 * Handles /v1/images/generations endpoint
 */

import { errorResponse } from '../errors';
import { getCfModelName } from '../model-helpers';

export async function handleImageGeneration(request: Request, env: Env): Promise<Response> {
  try {
    const data = await request.json() as OpenAiImageGenerationReq;
    const { model: requestedModel, prompt, n = 1, response_format = 'url', size } = data;
    const model = getCfModelName(requestedModel, env);

    console.log(`[Image] Request to generate image with model: ${model}, prompt length: ${prompt?.length || 0}`);

    // Validation
    if (!model || !prompt) {
      return errorResponse("Model and prompt are required", 400);
    }

    // Check if valid image generation model
    // Accept models that contain 'flux', 'dall-e', 'stable-diffusion', or 'gpt-image'
    const isImageModel = model.includes('flux') ||
                        model.includes('dall-e') ||
                        model.includes('stable-diffusion') ||
                        model.includes('gpt-image') ||
                        requestedModel.includes('dall-e') ||
                        requestedModel.includes('gpt-image');

    if (!isImageModel) {
      console.log(`[Image] Model ${model} is not recognized as an image generation model`);
      return errorResponse("Invalid image generation model - must be a Flux, DALL-E, or image generation model", 400);
    }

    console.log(`[Image] Model ${model} recognized as image generation model - proceeding`);

    // Cloudflare image generation models require specific format
    const imageInput: any = { prompt };

    // Parse size and add width/height if provided
    if (size) {
      const [width, height] = size.split('x').map(s => parseInt(s.trim()));
      if (width && height) {
        imageInput.width = width;
        imageInput.height = height;
        console.log(`[Image] Setting size: ${width}x${height}`);
      }
    }

    let aiRes;
    try {
      console.log(`[Image] Calling Cloudflare AI.run with model ${model}`);
      console.log(`[Image] Input object:`, JSON.stringify(imageInput).substring(0, 200));

      aiRes = await env.AI.run(model as any, imageInput);
      console.log(`[Image] AI.run completed, response type: ${typeof aiRes}`);
    } catch (error: any) {
      const errorMsg = (error as Error).message;
      const errorType = error?.constructor?.name || typeof error;

      console.error(`[Image] Failed to call Cloudflare AI with model ${model}`);
      console.error(`[Image] Error type: ${errorType}`);
      console.error(`[Image] Error message: ${errorMsg}`);

      // Check if it's an authentication error
      if (errorMsg.includes('AuthenticationError') || errorMsg.includes('authentication') ||
          errorMsg.includes('unauthorized') || errorMsg.includes('401') || errorMsg.includes('403')) {
        console.error(`[Image] Authentication error - check Cloudflare Workers AI credentials`);
        return errorResponse(
          "Authentication failed for image generation - check Cloudflare account permissions",
          401,
          "authentication_error",
          "Cloudflare Workers AI authentication failed"
        );
      }

      // Check if model is not found
      if (errorMsg.includes('not found') || errorMsg.includes('404') || errorMsg.includes('does not exist')) {
        console.error(`[Image] Model not found in Cloudflare Workers AI`);
        return errorResponse(
          "Image generation model not available",
          404,
          "model_not_found",
          `Model ${model} not found in Cloudflare Workers AI`
        );
      }

      throw error;
    }

    console.log(`[Image] Response type: ${typeof aiRes}, is ReadableStream: ${aiRes instanceof ReadableStream}`);

    // Debug: Log the full response structure
    if (typeof aiRes === 'object' && aiRes !== null && !(aiRes instanceof ReadableStream)) {
      console.log(`[Image] Full aiRes object:`, JSON.stringify(aiRes, null, 2).substring(0, 500));
    }

    // Process image response
    let imageData: string = '';

    if (aiRes instanceof ReadableStream) {
      // Handle streaming response
      console.log(`[Image] Response is a ReadableStream, reading chunks...`);
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
      const bytes = Array.from(fullData);
      imageData = btoa(String.fromCharCode(...bytes));
      console.log(`[Image] Converted stream to base64, length: ${imageData.length}`);
    } else if (aiRes instanceof Uint8Array || aiRes instanceof ArrayBuffer) {
      const bytes = aiRes instanceof Uint8Array ? Array.from(aiRes) : Array.from(new Uint8Array(aiRes));
      imageData = btoa(String.fromCharCode(...bytes));
      console.log(`[Image] Converted binary data to base64, length: ${imageData.length}`);
    } else if (typeof aiRes === 'string') {
      imageData = aiRes;
      console.log(`[Image] Response is string, length: ${imageData.length}`);
    } else if (typeof aiRes === 'object' && aiRes !== null) {
      console.log(`[Image] Response is object with keys: ${Object.keys(aiRes).join(', ')}`);

      if ('image' in aiRes) {
        const imgData = (aiRes as any).image;
        if (imgData instanceof Uint8Array || imgData instanceof ArrayBuffer) {
          const bytes = imgData instanceof Uint8Array ? Array.from(imgData) : Array.from(new Uint8Array(imgData));
          imageData = btoa(String.fromCharCode(...bytes));
          console.log(`[Image] Extracted binary image from 'image' field, converted to base64`);
        } else if (typeof imgData === 'string') {
          imageData = imgData;
          console.log(`[Image] Extracted string image from 'image' field`);
        }
      } else if ('data' in aiRes && typeof (aiRes as any).data === 'string') {
        imageData = (aiRes as any).data;
        console.log(`[Image] Extracted from 'data' field`);
      } else if ('result' in aiRes && typeof (aiRes as any).result === 'string') {
        imageData = (aiRes as any).result;
        console.log(`[Image] Extracted from 'result' field`);
      } else {
        console.error(`[Image] Unexpected response format:`, JSON.stringify(aiRes).substring(0, 300));
        return errorResponse(
          "Image generation returned unexpected format - no image data found",
          500,
          "unexpected_response",
          `Response contained: ${Object.keys(aiRes).join(', ')}`
        );
      }
    }

    console.log(`[Image] Final image data length: ${imageData.length} chars`);

    // Ensure we have image data
    if (!imageData || imageData.length === 0) {
      console.error(`[Image] No image data generated`);
      return errorResponse("Failed to generate image - no data returned", 500);
    }

    // Format response based on request
    const imageObject: OpenAiImageObject = {};

    if (response_format === 'b64_json') {
      if (imageData.startsWith('data:image')) {
        imageObject.b64_json = imageData.split(',')[1];
      } else if (imageData.startsWith('/9j/') || imageData.startsWith('iVBORw0KGgo')) {
        imageObject.b64_json = imageData;
      } else {
        imageObject.b64_json = btoa(imageData);
      }
    } else {
      if (imageData.startsWith('data:image')) {
        imageObject.url = imageData;
      } else if (imageData.startsWith('/9j/') || imageData.startsWith('iVBORw0KGgo')) {
        imageObject.url = 'data:image/png;base64,' + imageData;
      } else {
        imageObject.url = imageData;
      }
    }

    const responseData = {
      created: Math.floor(Date.now() / 1000),
      data: Array(n).fill(null).map(() => ({ ...imageObject })),
      model: requestedModel
    };

    return new Response(JSON.stringify(responseData as OpenAiImageGenerationRes), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error(`[Image] Error:`, error);
    return errorResponse("Image generation failed", 500, (error as Error).message);
  }
}

