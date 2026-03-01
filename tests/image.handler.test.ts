/**
 * ============================================================================
 * IMAGE HANDLER TESTS
 * ============================================================================
 *
 * Behavioral lock-down for handleImageGeneration.
 * Covers: happy path (stream, binary, string, object responses),
 * validation errors, AI failure, and the n>1 behavior.
 */

import { handleImageGeneration } from '../src/handlers/image.handler';
import type { Env } from '../src/types';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

function makeRequest(body: any): Request {
  return new Request('https://example.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeEnv(aiRun: jest.Mock): Env {
  return {
    AI: { run: aiRun } as any,
    DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
    CACHE: {} as any,
  } as Env;
}

// ─────────────────────────────────────────────────────────────
// Validation errors
// ─────────────────────────────────────────────────────────────
describe('handleImageGeneration — validation', () => {
  test('returns 400 when prompt is missing', async () => {
    const env = makeEnv(jest.fn());
    const res = await handleImageGeneration(makeRequest({ model: 'dall-e-3' }), env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error.param).toBe('prompt');
  });

  test('returns 400 when model is missing', async () => {
    const env = makeEnv(jest.fn());
    const res = await handleImageGeneration(makeRequest({ prompt: 'A cat' }), env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error.param).toBe('model');
  });

  test('returns 400 for a non-image model', async () => {
    const env = makeEnv(jest.fn());
    const res = await handleImageGeneration(
      makeRequest({ prompt: 'A cat', model: '@cf/meta/llama-3-8b-instruct' }),
      env
    );
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error.param).toBe('model');
  });
});

// ─────────────────────────────────────────────────────────────
// Happy path — Uint8Array response
// ─────────────────────────────────────────────────────────────
describe('handleImageGeneration — binary response', () => {
  test('returns 200 with image data in url field when AI returns Uint8Array', async () => {
    const fakeImageBytes = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
    const aiRun = jest.fn().mockResolvedValue(fakeImageBytes);
    const env = makeEnv(aiRun);

    const res = await handleImageGeneration(
      makeRequest({ prompt: 'A sunset', model: 'dall-e-3' }),
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toHaveLength(1);
    // PNG magic bytes start with iVBOR in base64 — handler wraps with data:image/png prefix
    expect(body.data[0].url).toBeDefined();
    expect(typeof body.data[0].url).toBe('string');
    expect(body.data[0].url.length).toBeGreaterThan(0);
    expect(body.model).toBe('dall-e-3');
    expect(typeof body.created).toBe('number');
  });

  test('returns b64_json when response_format is b64_json', async () => {
    const fakeImageBytes = new Uint8Array([137, 80, 78, 71]);
    const aiRun = jest.fn().mockResolvedValue(fakeImageBytes);
    const env = makeEnv(aiRun);

    const res = await handleImageGeneration(
      makeRequest({ prompt: 'A sunset', model: 'dall-e-3', response_format: 'b64_json' }),
      env
    );
    const body = await res.json() as any;
    // Both b64_json and url are always returned so clients can use whichever they prefer
    expect(body.data[0].b64_json).toBeDefined();
    expect(body.data[0].url).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Happy path — ReadableStream response
// ─────────────────────────────────────────────────────────────
describe('handleImageGeneration — streaming response', () => {
  test('reads stream and returns base64 image', async () => {
    const fakeBytes = new Uint8Array([1, 2, 3, 4]);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(fakeBytes);
        controller.close();
      },
    });
    const aiRun = jest.fn().mockResolvedValue(stream);
    const env = makeEnv(aiRun);

    const res = await handleImageGeneration(
      makeRequest({ prompt: 'Mountains', model: 'dall-e-3' }),
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data[0].url).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// n > 1 behavior (documented bug: copies same image n times)
// ─────────────────────────────────────────────────────────────
describe('handleImageGeneration — n parameter', () => {
  test('returns exactly n items in data array (all copies of single generation)', async () => {
    const fakeImageBytes = new Uint8Array([137, 80, 78, 71]);
    const aiRun = jest.fn().mockResolvedValue(fakeImageBytes);
    const env = makeEnv(aiRun);

    const res = await handleImageGeneration(
      makeRequest({ prompt: 'A cat', model: 'dall-e-3', n: 3 }),
      env
    );
    const body = await res.json() as any;
    // AI.run is only called ONCE regardless of n (current behavior — documented)
    expect(aiRun).toHaveBeenCalledTimes(1);
    // Response contains n items
    expect(body.data).toHaveLength(3);
    // All items are identical (same image duplicated)
    expect(body.data[0].url).toBe(body.data[1].url);
    expect(body.data[1].url).toBe(body.data[2].url);
  });

  test('returns 1 item when n is not specified', async () => {
    const aiRun = jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const env = makeEnv(aiRun);
    const res = await handleImageGeneration(
      makeRequest({ prompt: 'A cat', model: 'dall-e-3' }),
      env
    );
    const body = await res.json() as any;
    expect(body.data).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
// Error paths
// ─────────────────────────────────────────────────────────────
describe('handleImageGeneration — error paths', () => {
  test('returns 500 when AI.run throws', async () => {
    const aiRun = jest.fn().mockRejectedValue(new Error('Model unavailable'));
    const env = makeEnv(aiRun);
    const res = await handleImageGeneration(
      makeRequest({ prompt: 'A cat', model: 'dall-e-3' }),
      env
    );
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.error.type).toBe('api_error');
  });

  test('returns 200 with placeholder image when Cloudflare flags prompt (error 3030)', async () => {
    const aiRun = jest.fn().mockRejectedValue(
      new Error('3030: Your output has been flagged. Please choose another prompt / input image combination')
    );
    const env = makeEnv(aiRun);
    const res = await handleImageGeneration(
      makeRequest({ prompt: 'Flagged content', model: 'dall-e-3' }),
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].b64_json).toBeDefined();
    expect(body.data[0].revised_prompt).toMatch(/content policy/i);
  });

  test('returns 200 with placeholder image when error message contains "flagged"', async () => {
    const aiRun = jest.fn().mockRejectedValue(new Error('Your output has been flagged'));
    const env = makeEnv(aiRun);
    const res = await handleImageGeneration(
      makeRequest({ prompt: 'Bad prompt', model: 'dall-e-3' }),
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data[0].revised_prompt).toMatch(/content policy/i);
  });

  test('returns 500 on invalid JSON body', async () => {
    const env = makeEnv(jest.fn());
    const req = new Request('https://example.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await handleImageGeneration(req, env);
    expect(res.status).toBe(500);
  });

  test('returns 500 when AI returns empty data', async () => {
    const aiRun = jest.fn().mockResolvedValue(new Uint8Array(0));
    const env = makeEnv(aiRun);
    const res = await handleImageGeneration(
      makeRequest({ prompt: 'A cat', model: 'dall-e-3' }),
      env
    );
    expect(res.status).toBe(500);
  });

  test('includes model in requestedModel field in response', async () => {
    const aiRun = jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const env = makeEnv(aiRun);
    const res = await handleImageGeneration(
      makeRequest({ prompt: 'A dog', model: 'dall-e-2' }),
      env
    );
    const body = await res.json() as any;
    expect(body.model).toBe('dall-e-2');
  });
});


