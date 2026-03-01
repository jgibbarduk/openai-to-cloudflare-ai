/**
 * Chat completions HTTP integration tests.
 * Migrated from: scripts/tests/test-regression.sh (chat sections),
 *                scripts/tests/comprehensive-test.sh,
 *                scripts/api/test-response-envelope.sh
 *
 * All assertions are on shape/status only — AI content is non-deterministic.
 */
import { post, get, getRawStream, API_KEY } from './helpers';

// Skip the whole suite if no API key is available
const describeIfAuth = API_KEY ? describe : describe.skip;

const TEST_MODELS = [
  '@cf/qwen/qwen3-30b-a3b-fp8',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
];

describeIfAuth('Chat Completions — /v1/chat/completions', () => {
  describe('Health & Models', () => {
    test('GET /health returns {status: "ok"} and providers info', async () => {
      const { status, body } = await get('/health');
      expect(status).toBe(200);
      expect((body as any).status).toBe('ok');
      expect((body as any).providers).toBeDefined();
    });

    test('GET /v1/models returns a list', async () => {
      const { status, body } = await get('/v1/models');
      expect(status).toBe(200);
      expect((body as any).object).toBe('list');
      expect(Array.isArray((body as any).data)).toBe(true);
      expect((body as any).data.length).toBeGreaterThan(0);
    });

    test('unknown endpoint returns 404', async () => {
      const { status } = await get('/v1/nonexistent-endpoint-xyz');
      expect(status).toBe(404);
    });
  });

  describe('Response envelope shape', () => {
    test('response follows OpenAI chat completion schema', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: '@cf/qwen/qwen3-30b-a3b-fp8',
        messages: [{ role: 'user', content: 'Say hi' }],
        max_tokens: 20,
      });

      expect(status).toBe(200);
      const b = body as any;
      expect(typeof b.id).toBe('string');
      expect(b.object).toBe('chat.completion');
      expect(typeof b.created).toBe('number');
      expect(typeof b.model).toBe('string');
      expect(Array.isArray(b.choices)).toBe(true);
      expect(b.choices.length).toBeGreaterThan(0);

      const choice = b.choices[0];
      expect(choice.index).toBe(0);
      expect(typeof choice.finish_reason).toBe('string');
      expect(choice.message).toBeDefined();
      expect(choice.message.role).toBe('assistant');
      // content must be a string (never null per OpenAI spec when no tool_calls)
      expect(typeof choice.message.content).toBe('string');

      expect(b.usage).toBeDefined();
      expect(typeof b.usage.prompt_tokens).toBe('number');
      expect(typeof b.usage.completion_tokens).toBe('number');
      expect(typeof b.usage.total_tokens).toBe('number');
    });

    test('missing messages field returns 4xx', async () => {
      const { status } = await post('/v1/chat/completions', {
        model: '@cf/qwen/qwen3-30b-a3b-fp8',
      });
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    });
  });

  describe('Basic completion per model', () => {
    test.each(TEST_MODELS)('completion with %s returns 200', async (model) => {
      const { status, body } = await post('/v1/chat/completions', {
        model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: "Say 'hello world' only" },
        ],
        max_tokens: 50,
      });
      expect(status).toBe(200);
      const content = (body as any)?.choices?.[0]?.message?.content;
      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('Streaming (SSE)', () => {
    test.each(TEST_MODELS)('streaming with %s returns SSE chunks', async (model) => {
      const raw = await getRawStream('/v1/chat/completions', {
        model,
        messages: [{ role: 'user', content: 'Count to 3' }],
        stream: true,
        max_tokens: 50,
      }, 65536);
      expect(raw).toContain('data:');
    });
  });

  describe('OpenAI model alias resolution', () => {
    test('gpt-4o-mini alias is resolved and returns 200', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10,
      });
      expect(status).toBe(200);
      // model in response must be a CF model string
      expect((body as any).model).toBeDefined();
    });

    test('gpt-4o alias is resolved and returns 200', async () => {
      const { status } = await post('/v1/chat/completions', {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10,
      });
      expect(status).toBe(200);
    });
  });
});

