/**
 * Auth + security integration tests.
 * Migrated from: scripts/tests/test-security.sh, scripts/api/test-auth.sh
 */
import { WORKER_URL, API_KEY } from './helpers';

const CHAT_PAYLOAD = {
  model: '@cf/qwen/qwen3-30b-a3b-fp8',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 5,
};

async function postChat(authHeader?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader !== undefined) headers['Authorization'] = authHeader;
  const res = await fetch(`${WORKER_URL}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(CHAT_PAYLOAD),
  });
  return res.status;
}

describe('Auth / Security', () => {
  test('no Authorization header returns 401', async () => {
    const status = await postChat(undefined);
    expect(status).toBe(401);
  });

  test('malformed Authorization (no Bearer) returns 401', async () => {
    const status = await postChat('InvalidFormat sk-test');
    expect(status).toBe(401);
  });

  test('invalid API key returns 401', async () => {
    const status = await postChat('Bearer invalid-key-totally-wrong');
    expect(status).toBe(401);
  });

  test('GET /health is public (no auth required)', async () => {
    const res = await fetch(`${WORKER_URL}/health`);
    expect(res.status).toBe(200);
  });

  test('valid API key returns 200', async () => {
    if (!API_KEY) return pending('Skipped: API_KEY not set');
    const status = await postChat(`Bearer ${API_KEY}`);
    expect(status).toBe(200);
  });
});
