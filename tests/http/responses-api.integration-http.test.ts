/**
 * Responses API HTTP integration tests.
 * Migrated from: scripts/api/test-responses-api.sh,
 *                scripts/api/test-responses-stream.sh,
 *                scripts/tests/test-responses-tool-calls.sh
 */
import { post, getRawStream, API_KEY } from './helpers';

const describeIfAuth = API_KEY ? describe : describe.skip;

const RESPONSES_HEADERS = { 'OpenAI-Beta': 'responses=v1' };

describeIfAuth('Responses API — /v1/responses', () => {
  test('basic response has object: "response" and id prefixed resp_', async () => {
    const { status, body } = await post(
      '/v1/responses',
      {
        model: '@cf/qwen/qwen3-30b-a3b-fp8',
        messages: [{ role: 'user', content: 'Say hello' }],
        max_tokens: 20,
      },
      RESPONSES_HEADERS
    );
    expect(status).toBe(200);
    const b = body as any;
    expect(b.object).toBe('response');
    expect(typeof b.id).toBe('string');
    expect(b.id.startsWith('resp_')).toBe(true);
  });

  test('streaming responses API returns SSE events', async () => {
    const raw = await getRawStream('/v1/responses', {
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      messages: [{ role: 'user', content: 'Count to 3' }],
      stream: true,
      max_tokens: 50,
    });
    expect(raw).toContain('data:');
  });

  test('tool passthrough — request with tools returns 200', async () => {
    const { status } = await post(
      '/v1/responses',
      {
        model: '@cf/qwen/qwen3-30b-a3b-fp8',
        messages: [{ role: 'user', content: 'What is the weather in San Francisco?' }],
        tools: [{
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather for a location',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string', description: 'City and state' },
              },
              required: ['location'],
            },
          },
        }],
        max_tokens: 100,
      },
      RESPONSES_HEADERS
    );
    expect(status).toBe(200);
  });
});

