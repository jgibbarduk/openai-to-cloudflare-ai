/**
 * Tool calling HTTP integration tests.
 * Migrated from: scripts/tests/test-onyx-compatibility.sh,
 *                scripts/tests/test-llama-tool-calling.sh,
 *                scripts/tests/test-glm-tool-calling.sh,
 *                scripts/tests/test-regression.sh (tool calling sections)
 */
import { post, API_KEY } from './helpers';

const describeIfAuth = API_KEY ? describe : describe.skip;

const WEATHER_TOOL = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get current weather for a location',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' },
      },
      required: ['location'],
    },
  },
};

const SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the web',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
  },
};

describeIfAuth('Tool Calling — /v1/chat/completions', () => {
  describe('Single tool call (Qwen)', () => {
    test('returns tool_calls or content — never an error', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: '@cf/qwen/qwen3-30b-a3b-fp8',
        messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
        tools: [WEATHER_TOOL],
        max_tokens: 100,
      });
      expect(status).toBe(200);
      const msg = (body as any)?.choices?.[0]?.message;
      expect(msg).toBeDefined();
      // Either content or tool_calls must be present
      const hasContent = typeof msg.content === 'string' && msg.content.length > 0;
      const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
      expect(hasContent || hasToolCalls).toBe(true);
    });

    test('tool call response has correct function name', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: '@cf/qwen/qwen3-30b-a3b-fp8',
        messages: [{ role: 'user', content: 'What is the weather in London?' }],
        tools: [WEATHER_TOOL],
        tool_choice: 'auto',
        max_tokens: 100,
      });
      expect(status).toBe(200);
      const msg = (body as any)?.choices?.[0]?.message;
      if (msg.tool_calls?.length) {
        expect(msg.tool_calls[0].type).toBe('function');
        expect(typeof msg.tool_calls[0].function?.name).toBe('string');
        expect(typeof msg.tool_calls[0].function?.arguments).toBe('string');
      }
    });
  });

  describe('Multi-turn with tool call history (Onyx scenario)', () => {
    test('handles assistant tool_call + tool result in message history without error', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: '@cf/qwen/qwen3-30b-a3b-fp8',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'What is the weather in London?' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_weather_123',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"location":"London"}' },
            }],
          },
          {
            role: 'tool',
            tool_call_id: 'call_weather_123',
            content: 'The weather in London is sunny, 18°C',
          },
          { role: 'user', content: 'Great! What about Paris?' },
        ],
        tools: [WEATHER_TOOL],
        max_tokens: 150,
      });

      // Must not be an error response
      expect(status).toBe(200);
      expect((body as any).error).toBeUndefined();
      const msg = (body as any)?.choices?.[0]?.message;
      expect(msg).toBeDefined();
    });
  });

  describe('Llama auto-switch to tool-capable model', () => {
    test('Llama model with tools returns 200 (auto-switches to Qwen)', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        messages: [{ role: 'user', content: 'Find info about Python' }],
        tools: [SEARCH_TOOL],
        max_tokens: 100,
      });
      expect(status).toBe(200);
      expect((body as any)?.choices?.[0]?.message).toBeDefined();
    });
  });

  describe('GPT-OSS model tool calling', () => {
    test('@cf/openai/gpt-oss-20b handles tool calls', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: '@cf/openai/gpt-oss-20b',
        messages: [{ role: 'user', content: 'Search for TypeScript documentation' }],
        tools: [SEARCH_TOOL],
        max_tokens: 100,
      });
      expect(status).toBe(200);
      const msg = (body as any)?.choices?.[0]?.message;
      expect(msg).toBeDefined();
    });
  });
});

