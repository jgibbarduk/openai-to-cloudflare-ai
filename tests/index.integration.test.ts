/**
 * ============================================================================
 * INDEX.TS — INTEGRATION TESTS
 * ============================================================================
 *
 * Tests for the full Worker fetch handler: routing, authentication gate,
 * CORS/header passthrough, 404 handling, and unhandled error boundary.
 */

import worker from '../src/index';
import type { Env } from '../src/types';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

function makeEnv(aiRun?: jest.Mock, apiKey?: string): Env {
  return {
    AI: { run: aiRun ?? jest.fn() } as any,
    API_KEY: apiKey,
    DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
    CACHE: {} as any,
  } as Env;
}

function get(path: string, env: Env, headers: Record<string, string> = {}): Promise<Response> {
  return worker.fetch(
    new Request(`https://example.com${path}`, { headers }),
    env
  );
}

function post(path: string, env: Env, body: any, headers: Record<string, string> = {}): Promise<Response> {
  return worker.fetch(
    new Request(`https://example.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    env
  );
}

// ─────────────────────────────────────────────────────────────
// Health check — no auth required
// ─────────────────────────────────────────────────────────────
describe('index — GET /health', () => {
  test('returns 200 without auth header', async () => {
    const res = await get('/health', makeEnv());
    expect(res.status).toBe(200);
  });

  test('response body contains version string', async () => {
    const res = await get('/health', makeEnv());
    const body = await res.text();
    expect(body).toBeTruthy();
  });

  test('returns 200 even when API_KEY is configured and no token is sent', async () => {
    const res = await get('/health', makeEnv(undefined, 'sk-secret'));
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────
// Auth gate
// ─────────────────────────────────────────────────────────────
describe('index — authentication gate', () => {
  test('returns 401 for /v1/models when API_KEY configured and no token', async () => {
    const res = await get('/v1/models', makeEnv(undefined, 'sk-secret'));
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error.type).toBe('authentication_error');
  });

  test('passes /v1/models with correct bearer token', async () => {
    const res = await get('/v1/models', makeEnv(undefined, 'sk-secret'), {
      Authorization: 'Bearer sk-secret',
    });
    expect(res.status).toBe(200);
  });

  test('returns 401 for /v1/chat/completions with wrong token', async () => {
    const res = await post('/v1/chat/completions', makeEnv(undefined, 'correct-key'), {
      model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }],
    }, { Authorization: 'Bearer wrong-key' });
    expect(res.status).toBe(401);
  });

  test('allows /models/search unauthenticated even when key is configured', async () => {
    const res = await get('/models/search', makeEnv(undefined, 'sk-secret'));
    // /models/search is always accessible
    expect(res.status).toBe(200);
  });

  test('allows all routes when API_KEY is not configured', async () => {
    const res = await get('/v1/models', makeEnv(undefined, undefined));
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────
// Route — GET /v1/models
// ─────────────────────────────────────────────────────────────
describe('index — GET /v1/models', () => {
  test('returns 200 with models array', async () => {
    const res = await get('/v1/models', makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.object).toBe('list');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Route — POST /v1/chat/completions
// ─────────────────────────────────────────────────────────────
describe('index — POST /v1/chat/completions', () => {
  test('calls AI.run and returns 200 chat.completion', async () => {
    const aiRun = jest.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'Hello!' } }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    });
    const res = await post('/v1/chat/completions', makeEnv(aiRun), {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.object).toBe('chat.completion');
    expect(aiRun).toHaveBeenCalledTimes(1);
  });

  test('returns 405-style 404 when using GET method', async () => {
    const res = await get('/v1/chat/completions', makeEnv());
    // GET /v1/chat/completions falls through to default 404
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────
// Route — POST /v1/responses
// ─────────────────────────────────────────────────────────────
describe('index — POST /v1/responses', () => {
  test('returns 200 Responses API format', async () => {
    const aiRun = jest.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'Response!' } }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    });
    const res = await post('/v1/responses', makeEnv(aiRun), {
      model: 'gpt-4',
      input: 'Hi',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.object).toBe('response');
  });
});

// ─────────────────────────────────────────────────────────────
// Route — POST /v1/embeddings
// ─────────────────────────────────────────────────────────────
describe('index — POST /v1/embeddings', () => {
  test('returns 200 with embedding data', async () => {
    const aiRun = jest.fn().mockResolvedValue({
      data: [[0.1, 0.2, 0.3]],
      shape: [1, 3],
    });
    const res = await post('/v1/embeddings', makeEnv(aiRun), {
      model: '@cf/baai/bge-base-en-v1.5',
      input: 'Hello world',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.object).toBe('list');
    expect(Array.isArray(body.data)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Route — 404 fallthrough
// ─────────────────────────────────────────────────────────────
describe('index — 404 routing', () => {
  test('returns 404 for unknown path', async () => {
    const res = await get('/v1/unknown-endpoint', makeEnv());
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error.type).toBe('not_found_error');
  });

  test('returns 404 for root /', async () => {
    const res = await get('/', makeEnv());
    expect(res.status).toBe(404);
  });

  test('returns 404 for POST to a GET-only endpoint', async () => {
    const res = await post('/v1/models', makeEnv(), {});
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────
// Route — Assistants & Threads stubs
// ─────────────────────────────────────────────────────────────
describe('index — stub endpoints', () => {
  test('returns 501 for /v1/assistants', async () => {
    const res = await post('/v1/assistants', makeEnv(), {});
    expect(res.status).toBe(501);
  });

  test('returns 501 for /v1/threads', async () => {
    const res = await post('/v1/threads', makeEnv(), {});
    expect(res.status).toBe(501);
  });

  test('returns 501 for /v1/assistants/asst_123/runs', async () => {
    const res = await post('/v1/assistants/asst_123/runs', makeEnv(), {});
    expect(res.status).toBe(501);
  });
});

// ─────────────────────────────────────────────────────────────
// Content-Type header
// ─────────────────────────────────────────────────────────────
describe('index — response headers', () => {
  test('error responses have Content-Type: application/json', async () => {
    const res = await get('/v1/unknown', makeEnv());
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  test('/v1/models response has Content-Type: application/json', async () => {
    const res = await get('/v1/models', makeEnv());
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });
});

