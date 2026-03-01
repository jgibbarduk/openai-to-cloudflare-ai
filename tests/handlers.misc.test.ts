/**
 * ============================================================================
 * MODELS, HEALTH, ASSISTANTS, THREADS HANDLER TESTS
 * ============================================================================
 */

import { handleListModels } from '../src/handlers/models.handler';
import { handleHealth } from '../src/handlers/health.handler';
import { handleAssistants } from '../src/handlers/assistants.handler';
import { handleThreads } from '../src/handlers/threads.handler';
import type { Env } from '../src/types';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

function makeEnv(withAi = true): Env {
  return {
    AI: withAi ? { run: jest.fn() } as any : undefined,
    DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
    CACHE: {} as any,
  } as Env;
}

// ─────────────────────────────────────────────────────────────
// handleListModels
// ─────────────────────────────────────────────────────────────
describe('handleListModels', () => {
  test('returns 200 with object=list', async () => {
    const res = await handleListModels(makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.object).toBe('list');
  });

  test('data array is non-empty', async () => {
    const res = await handleListModels(makeEnv());
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  test('every item has id and object="model"', async () => {
    const res = await handleListModels(makeEnv());
    const body = await res.json() as any;
    for (const item of body.data) {
      expect(item.id).toBeTruthy();
      expect(item.object).toBe('model');
    }
  });

  test('Content-Type is application/json', async () => {
    const res = await handleListModels(makeEnv());
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  test('does NOT set Cache-Control (removed)', async () => {
    const res = await handleListModels(makeEnv());
    // public caching removed — header should be absent
    const cc = res.headers.get('Cache-Control');
    expect(cc).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// handleHealth
// ─────────────────────────────────────────────────────────────
describe('handleHealth', () => {
  test('returns 200 when AI binding is present', async () => {
    const res = await handleHealth(makeEnv(true));
    expect(res.status).toBe(200);
  });

  test('response body has status=ok when AI binding present', async () => {
    const body = await (await handleHealth(makeEnv(true))).json() as any;
    expect(body.status).toBe('ok');
    expect(body.providers.workers_ai).toBe('up');
  });

  test('returns 503 when AI binding is missing', async () => {
    const res = await handleHealth(makeEnv(false));
    expect(res.status).toBe(503);
  });

  test('response body has status=degraded when AI binding missing', async () => {
    const body = await (await handleHealth(makeEnv(false))).json() as any;
    expect(body.status).toBe('degraded');
    expect(body.providers.workers_ai).toBe('down');
  });

  test('response includes version string', async () => {
    const body = await (await handleHealth(makeEnv())).json() as any;
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
  });

  test('response includes ISO timestamp', async () => {
    const body = await (await handleHealth(makeEnv())).json() as any;
    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(new Date(body.timestamp).getTime()).toBeGreaterThan(0);
  });

  test('Cache-Control is no-cache', async () => {
    const res = await handleHealth(makeEnv());
    expect(res.headers.get('Cache-Control')).toContain('no-cache');
  });
});

// ─────────────────────────────────────────────────────────────
// handleAssistants
// ─────────────────────────────────────────────────────────────
describe('handleAssistants', () => {
  function makeUrl(path: string) { return new URL(`https://example.com${path}`); }

  test('returns 501 for any path', async () => {
    const res = await handleAssistants(
      new Request('https://example.com/v1/assistants'),
      makeEnv(),
      makeUrl('/v1/assistants')
    );
    expect(res.status).toBe(501);
  });

  test('error type is not_implemented', async () => {
    const res = await handleAssistants(
      new Request('https://example.com/v1/assistants'),
      makeEnv(),
      makeUrl('/v1/assistants')
    );
    const body = await res.json() as any;
    expect(body.error.type).toBe('not_implemented');
  });

  test('returns 501 for nested paths like /v1/assistants/asst_123/runs', async () => {
    const res = await handleAssistants(
      new Request('https://example.com/v1/assistants/asst_123/runs'),
      makeEnv(),
      makeUrl('/v1/assistants/asst_123/runs')
    );
    expect(res.status).toBe(501);
  });
});

// ─────────────────────────────────────────────────────────────
// handleThreads
// ─────────────────────────────────────────────────────────────
describe('handleThreads', () => {
  function makeUrl(path: string) { return new URL(`https://example.com${path}`); }

  test('returns 501', async () => {
    const res = await handleThreads(
      new Request('https://example.com/v1/threads'),
      makeEnv(),
      makeUrl('/v1/threads')
    );
    expect(res.status).toBe(501);
  });

  test('error type is not_implemented', async () => {
    const res = await handleThreads(
      new Request('https://example.com/v1/threads/thread_abc'),
      makeEnv(),
      makeUrl('/v1/threads/thread_abc')
    );
    const body = await res.json() as any;
    expect(body.error.type).toBe('not_implemented');
  });
});

