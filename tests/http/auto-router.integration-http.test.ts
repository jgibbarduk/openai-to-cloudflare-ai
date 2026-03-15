/**
 * ============================================================================
 * AUTO-ROUTER - END-TO-END HTTP INTEGRATION TESTS
 * ============================================================================
 *
 * Hits a real running worker (started by globalSetup) with `model: "auto"` /
 * `model: "auto/route"` requests and verifies:
 *
 *  1. The response is a valid 200 with an OpenAI-shaped envelope
 *  2. The resolved model reported in `body.model` belongs to the expected
 *     tier pool (cheap / tool / advanced) for each signal combination
 *  3. Streaming works when `stream: true` is requested with auto routing
 *  4. Every signal type that should escalate the tier actually does so
 *
 * Tier pools (from AUTO_ROUTE_DEFAULTS in constants.ts):
 *   cheap    — simple chat, no tools, small context
 *   tool     — tools present, coding/reasoning content, structured output
 *   advanced — large context, agentic loop, combined signals
 */

import { post, getRawStream, API_KEY } from './helpers';
import { AUTO_ROUTE_DEFAULTS, AUTO_ROUTE_THRESHOLDS } from '../../src/constants';

const describeIfAuth = API_KEY ? describe : describe.skip;

// ── Pools as plain arrays for matcher convenience ─────────────────────────────
const CHEAP_POOL    = [...AUTO_ROUTE_DEFAULTS.cheap]    as string[];
const TOOL_POOL     = [...AUTO_ROUTE_DEFAULTS.tool]     as string[];
const ADVANCED_POOL = [...AUTO_ROUTE_DEFAULTS.advanced] as string[];
const ALL_POOLS     = [...CHEAP_POOL, ...TOOL_POOL, ...ADVANCED_POOL];

// ── Shared tool definitions ───────────────────────────────────────────────────
const WEATHER_TOOL = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get current weather for a city',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
};

const SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the web for information',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
};

/** Build an array of simple user messages long enough to exceed the advanced message threshold. */
function manyMessages(count = AUTO_ROUTE_THRESHOLDS.advancedMessageCount + 2) {
  return Array.from({ length: count }, (_, i) => ({
    role: 'user' as const,
    content: `Message number ${i + 1}.`,
  }));
}

/** Build two messages whose combined character count exceeds the advanced chars threshold. */
function longMessages() {
  const charsEach = Math.ceil((AUTO_ROUTE_THRESHOLDS.advancedTotalChars + 200) / 2);
  return [
    { role: 'user' as const, content: 'A'.repeat(charsEach) },
    { role: 'user' as const, content: 'B'.repeat(charsEach) },
  ];
}

// ── Shared shape assertion ────────────────────────────────────────────────────
function expectValidEnvelope(body: any) {
  expect(typeof body.id).toBe('string');
  expect(body.object).toBe('chat.completion');
  expect(typeof body.created).toBe('number');
  expect(typeof body.model).toBe('string');
  expect(Array.isArray(body.choices)).toBe(true);
  expect(body.choices.length).toBeGreaterThan(0);
  const choice = body.choices[0];
  expect(choice.message).toBeDefined();
  expect(choice.message.role).toBe('assistant');
}

// =============================================================================

describeIfAuth('Auto-Router — model: "auto" end-to-end', () => {

  // ── 1. Basic smoke tests ────────────────────────────────────────────────────
  describe('smoke tests', () => {
    test('"auto" returns 200 with a valid OpenAI envelope', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [{ role: 'user', content: 'Say hello.' }],
        max_tokens: 20,
      });
      expect(status).toBe(200);
      expectValidEnvelope(body as any);
    });

    test('"auto/route" alias behaves identically to "auto"', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto/route',
        messages: [{ role: 'user', content: 'Say hello.' }],
        max_tokens: 20,
      });
      expect(status).toBe(200);
      expectValidEnvelope(body as any);
    });

    test('resolved model is always one of the known pool models', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10,
      });
      expect(status).toBe(200);
      expect(ALL_POOLS).toContain((body as any).model);
    });
  });

  // ── 2. Cheap tier ───────────────────────────────────────────────────────────
  describe('cheap tier — simple chat', () => {
    test('plain conversational message → cheap pool model', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [{ role: 'user', content: 'What is the capital of France?' }],
        max_tokens: 30,
      });
      expect(status).toBe(200);
      expect(CHEAP_POOL).toContain((body as any).model);
    });

    test('short multi-turn conversation (no tools) → cheap pool model', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
          { role: 'user', content: 'How are you?' },
        ],
        max_tokens: 20,
      });
      expect(status).toBe(200);
      expect(CHEAP_POOL).toContain((body as any).model);
    });
  });

  // ── 3. Tool tier ────────────────────────────────────────────────────────────
  describe('tool tier — tools / coding / structured output / reasoning', () => {
    test('request with a single tool → tool pool model', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
        tools: [WEATHER_TOOL],
        max_tokens: 100,
      });
      expect(status).toBe(200);
      expect(TOOL_POOL).toContain((body as any).model);
    });

    test('request with multiple tools (≤ hard threshold) → tool pool model', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [{ role: 'user', content: 'Search for the weather in London.' }],
        tools: [WEATHER_TOOL, SEARCH_TOOL],
        max_tokens: 100,
      });
      expect(status).toBe(200);
      expect(TOOL_POOL).toContain((body as any).model);
    });

    test('message containing a code block → tool pool model', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [{
          role: 'user',
          content: 'What does this do?\n```js\nconst x = arr.filter(n => n > 0);\n```',
        }],
        max_tokens: 60,
      });
      expect(status).toBe(200);
      expect(TOOL_POOL).toContain((body as any).model);
    });

    test('message with reasoning keyword → tool pool model', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [{ role: 'user', content: 'Solve this equation step by step: 2x + 4 = 10.' }],
        max_tokens: 80,
      });
      expect(status).toBe(200);
      expect(TOOL_POOL).toContain((body as any).model);
    });

    test('json_object response_format → tool pool model', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [{ role: 'user', content: 'Return a JSON object with key "greeting" set to "hello".' }],
        response_format: { type: 'json_object' },
        max_tokens: 50,
      });
      expect(status).toBe(200);
      expect(TOOL_POOL).toContain((body as any).model);
    });
  });

  // ── 4. Advanced tier ────────────────────────────────────────────────────────
  describe('advanced tier — large context / agentic loop / combined signals', () => {
    test('many messages (> threshold) → advanced pool model', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: manyMessages(),
        max_tokens: 30,
      });
      expect(status).toBe(200);
      expect(ADVANCED_POOL).toContain((body as any).model);
    });

    test('very long message content (> chars threshold) → advanced pool model', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [
          ...longMessages(),
          { role: 'user', content: 'Summarise the above.' },
        ],
        max_tokens: 30,
      });
      expect(status).toBe(200);
      expect(ADVANCED_POOL).toContain((body as any).model);
    });

    test('agentic loop — role=tool message in history → advanced pool model', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [
          { role: 'user', content: 'What is the weather in Berlin?' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_001',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Berlin"}' },
            }],
          },
          {
            role: 'tool',
            tool_call_id: 'call_001',
            content: 'Berlin: 15°C, partly cloudy.',
          },
          { role: 'user', content: 'And in Munich?' },
        ],
        tools: [WEATHER_TOOL],
        max_tokens: 80,
      });
      expect(status).toBe(200);
      expect(ADVANCED_POOL).toContain((body as any).model);
    });

    test('reasoning + tools combined → advanced pool model', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [{
          role: 'user',
          content: 'Analyze the weather data step by step and calculate the average temperature.',
        }],
        tools: [WEATHER_TOOL],
        max_tokens: 100,
      });
      expect(status).toBe(200);
      expect(ADVANCED_POOL).toContain((body as any).model);
    });

    test('many tools (> hard threshold) → advanced pool model', async () => {
      const manyTools = Array.from(
        { length: AUTO_ROUTE_THRESHOLDS.advancedToolCount + 1 },
        (_, i) => ({
          type: 'function' as const,
          function: {
            name: `tool_${i}`,
            description: `Tool number ${i}`,
            parameters: { type: 'object', properties: {}, required: [] },
          },
        })
      );
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [{ role: 'user', content: 'Use the available tools.' }],
        tools: manyTools,
        max_tokens: 50,
      });
      expect(status).toBe(200);
      expect(ADVANCED_POOL).toContain((body as any).model);
    });
  });

  // ── 5. Streaming ────────────────────────────────────────────────────────────
  describe('streaming', () => {
    test('"auto" with stream:true returns SSE data chunks', async () => {
      const raw = await getRawStream('/v1/chat/completions', {
        model: 'auto',
        messages: [{ role: 'user', content: 'Count to 3.' }],
        stream: true,
        max_tokens: 30,
      }, 32768);
      expect(raw).toContain('data:');
    });

    test('"auto" with tool tier and stream:true returns SSE chunks', async () => {
      const raw = await getRawStream('/v1/chat/completions', {
        model: 'auto',
        messages: [{ role: 'user', content: 'What is the weather in Rome?' }],
        tools: [WEATHER_TOOL],
        stream: true,
        max_tokens: 60,
      }, 32768);
      expect(raw).toContain('data:');
    });
  });

  // ── 6. Response shape for each tier ────────────────────────────────────────
  describe('response envelope shape per tier', () => {
    test('cheap tier response has valid usage stats', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10,
      });
      expect(status).toBe(200);
      const b = body as any;
      expect(b.usage).toBeDefined();
      expect(typeof b.usage.prompt_tokens).toBe('number');
      expect(typeof b.usage.completion_tokens).toBe('number');
      expect(typeof b.usage.total_tokens).toBe('number');
    });

    test('tool tier response has valid finish_reason', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
        tools: [WEATHER_TOOL],
        max_tokens: 80,
      });
      expect(status).toBe(200);
      const choice = (body as any).choices[0];
      expect(['stop', 'tool_calls', 'length']).toContain(choice.finish_reason);
    });

    test('advanced tier (large context) response content is a string', async () => {
      const { status, body } = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [
          ...manyMessages(),
          { role: 'user', content: 'Summarise what we discussed.' },
        ],
        max_tokens: 40,
      });
      expect(status).toBe(200);
      const content = (body as any).choices[0].message.content;
      expect(typeof content).toBe('string');
    });
  });
});


