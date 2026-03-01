/**
 * ============================================================================
 * AUTH MIDDLEWARE TESTS
 * ============================================================================
 *
 * Exhaustive behavioral lock-down for authenticateRequest and requiresAuth.
 */

import { authenticateRequest, requiresAuth } from '../src/middleware/auth.middleware';
import type { Env } from '../src/types';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

function makeRequest(authHeader?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader) headers['Authorization'] = authHeader;
  return new Request('https://example.com/v1/chat/completions', { headers });
}

function makeEnv(apiKey?: string): Env {
  return { API_KEY: apiKey, DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8', AI: {} as any, CACHE: {} as any } as Env;
}

// ─────────────────────────────────────────────────────────────
// requiresAuth
// ─────────────────────────────────────────────────────────────
describe('requiresAuth', () => {
  test('returns false for /health', () => {
    expect(requiresAuth('/health')).toBe(false);
  });

  test('returns true for /v1/chat/completions', () => {
    expect(requiresAuth('/v1/chat/completions')).toBe(true);
  });

  test('returns true for /v1/models', () => {
    expect(requiresAuth('/v1/models')).toBe(true);
  });

  test('returns true for /v1/embeddings', () => {
    expect(requiresAuth('/v1/embeddings')).toBe(true);
  });

  test('returns true for /models/search', () => {
    expect(requiresAuth('/models/search')).toBe(true);
  });

  test('returns true for root /', () => {
    expect(requiresAuth('/')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// authenticateRequest — unconfigured API_KEY
// ─────────────────────────────────────────────────────────────
describe('authenticateRequest — unconfigured API_KEY', () => {
  test('allows all requests when API_KEY is undefined', () => {
    const env = makeEnv(undefined);
    const result = authenticateRequest(makeRequest(), env, '/v1/chat/completions');
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('allows all requests when API_KEY is empty string', () => {
    const env = makeEnv('');
    const result = authenticateRequest(makeRequest(), env, '/v1/chat/completions');
    expect(result.success).toBe(true);
  });

  test('allows all requests when API_KEY is the default placeholder', () => {
    const env = makeEnv('your-api-key-here');
    const result = authenticateRequest(makeRequest(), env, '/v1/chat/completions');
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// authenticateRequest — valid key
// ─────────────────────────────────────────────────────────────
describe('authenticateRequest — with configured API_KEY', () => {
  const KEY = 'sk-test-1234567890';

  test('succeeds with correct Bearer token', () => {
    const result = authenticateRequest(
      makeRequest(`Bearer ${KEY}`),
      makeEnv(KEY),
      '/v1/chat/completions'
    );
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('fails with wrong token and returns 401 Response', async () => {
    const result = authenticateRequest(
      makeRequest('Bearer wrong-key'),
      makeEnv(KEY),
      '/v1/chat/completions'
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Response);
    expect(result.error!.status).toBe(401);

    const body = await result.error!.json() as any;
    expect(body.error).toBeDefined();
    expect(body.error.type).toBe('authentication_error');
  });

  test('fails with no Authorization header', async () => {
    const result = authenticateRequest(
      makeRequest(),
      makeEnv(KEY),
      '/v1/chat/completions'
    );
    expect(result.success).toBe(false);
    expect(result.error!.status).toBe(401);
  });

  test('fails with malformed Authorization header (no Bearer prefix)', async () => {
    const result = authenticateRequest(
      makeRequest(KEY), // missing "Bearer "
      makeEnv(KEY),
      '/v1/chat/completions'
    );
    expect(result.success).toBe(false);
  });

  test('allows /models/search without auth even when key is configured', () => {
    const result = authenticateRequest(
      makeRequest(), // no auth header
      makeEnv(KEY),
      '/models/search'
    );
    expect(result.success).toBe(true);
  });
});

