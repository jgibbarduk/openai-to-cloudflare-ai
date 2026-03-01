import { notFoundError, errorResponse } from '../errors';
import type { Env } from '../types';

/**
 * Minimal implementation of the OpenAI Files create endpoint.
 * - Attempts to parse multipart/form-data via request.formData()
 * - Falls back to reading raw body if formData() isn't available
 * - Returns a lightweight OpenAI-compatible file object
 */
export async function handleFiles(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return notFoundError();
  }

  try {
    let filename = 'upload.bin';
    let bytes = 0;
    let purpose = 'fine-tune';

    // Try to parse formData (Cloudflare Workers supports this)
    try {
      const form = await request.formData();
      const fileField = form.get('file') as any;
      const purposeField = form.get('purpose') as any;

      if (purposeField && typeof purposeField === 'string') {
        purpose = purposeField;
      }

      if (fileField) {
        // fileField can be a File-like object in runtime
        if (typeof fileField === 'object' && 'name' in fileField && typeof fileField.arrayBuffer === 'function') {
          filename = fileField.name || filename;
          const ab = await fileField.arrayBuffer();
          bytes = ab.byteLength;
        } else if (typeof fileField === 'string') {
          // Rare case: file as string field
          filename = 'upload.txt';
          bytes = new TextEncoder().encode(fileField).length;
        }
      } else {
        // No explicit file part; try raw body
        const ab = await request.arrayBuffer();
        bytes = ab.byteLength;
      }
    } catch (e) {
      // formData not supported in this runtime (e.g., some Node test harnesses)
      const ab = await request.arrayBuffer();
      bytes = ab.byteLength;
    }

    // Build file object
    const id = `file-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const fileObj = {
      id,
      object: 'file',
      bytes,
      filename,
      purpose,
      created_at: Math.floor(Date.now() / 1000)
    };

    return new Response(JSON.stringify(fileObj), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return errorResponse('Failed to process file upload', 500, 'api_error', err?.message);
  }
}

