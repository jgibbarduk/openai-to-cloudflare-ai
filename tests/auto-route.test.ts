/**
 * ============================================================================
 * AUTO-ROUTE MODEL TESTS
 * ============================================================================
 *
 * Tests for the auto/route intelligent model selection feature.
 * Validates that resolveAutoRouteModel picks the correct tier based on the
 * request's tools, context length, and message count.
 */

import { resolveAutoRouteModel, getCfModelName } from '../src/model-helpers';
import { transformChatCompletionRequest } from '../src/transformers/request.transformer';
import { validateAndNormalizeRequest } from '../src/transformers/request.transformer';
import { AUTO_ROUTE_DEFAULTS, AUTO_ROUTE_THRESHOLDS, AUTO_ROUTE_MODEL_NAMES, AUTO_ROUTE_SCORE_THRESHOLDS } from '../src/constants';
import type { Env, OpenAiChatCompletionReq } from '../src/types';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

const mockEnv: Env = {
  DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
  AI: {} as any,
  CACHE: {} as any,
} as Env;

// Helper: build a minimal valid request
function makeRequest(overrides: Partial<OpenAiChatCompletionReq> = {}): OpenAiChatCompletionReq {
  return {
    model: 'auto',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  } as OpenAiChatCompletionReq;
}

// Helper: build N messages with the given total character count
function makeMessages(count: number, charsEach = 50) {
  return Array.from({ length: count }, (_, i) => ({
    role: 'user' as const,
    content: 'A'.repeat(charsEach) + String(i),
  }));
}

// ─────────────────────────────────────────────────────────────
// AUTO_ROUTE_MODEL_NAMES constant
// ─────────────────────────────────────────────────────────────
describe('AUTO_ROUTE_MODEL_NAMES', () => {
  test('includes "auto"', () => {
    expect(AUTO_ROUTE_MODEL_NAMES).toContain('auto');
  });

  test('includes "auto/route"', () => {
    expect(AUTO_ROUTE_MODEL_NAMES).toContain('auto/route');
  });
});

// ─────────────────────────────────────────────────────────────
// resolveAutoRouteModel — cheap tier
// ─────────────────────────────────────────────────────────────
describe('resolveAutoRouteModel — cheap tier', () => {
  test('simple request with no tools → one of the cheap models', () => {
    const result = resolveAutoRouteModel(makeRequest(), mockEnv);
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(result);
  });

  test('small context, no tools → one of the cheap models', () => {
    const req = makeRequest({ messages: makeMessages(3, 100) });
    const result = resolveAutoRouteModel(req, mockEnv);
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(result);
  });

  test('respects AUTO_ROUTE_CHEAP_MODEL env override', () => {
    const customEnv = { ...mockEnv, AUTO_ROUTE_CHEAP_MODELS: '@cf/custom/cheap-model' } as Env;
    const result = resolveAutoRouteModel(makeRequest(), customEnv);
    expect(result).toBe('@cf/custom/cheap-model');
  });
});

// ─────────────────────────────────────────────────────────────
// resolveAutoRouteModel — tool tier
// ─────────────────────────────────────────────────────────────
describe('resolveAutoRouteModel — tool tier', () => {
  const singleTool: any[] = [
    {
      type: 'function',
      function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: {} } },
    },
  ];

  test('request with one tool → one of the tool models', () => {
    const req = makeRequest({ tools: singleTool });
    const result = resolveAutoRouteModel(req, mockEnv);
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(result);
  });

  test('request with tools up to threshold → one of the tool models', () => {
    const tools = Array.from({ length: AUTO_ROUTE_THRESHOLDS.advancedToolCount }, (_, i) => ({
      type: 'function' as const,
      function: { name: `tool_${i}`, description: 'desc', parameters: { type: 'object', properties: {} } },
    }));
    const req = makeRequest({ tools });
    const result = resolveAutoRouteModel(req, mockEnv);
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(result);
  });

  test('respects AUTO_ROUTE_TOOL_MODEL env override', () => {
    const customEnv = { ...mockEnv, AUTO_ROUTE_TOOL_MODELS: '@cf/custom/tool-model' } as Env;
    const req = makeRequest({ tools: singleTool });
    const result = resolveAutoRouteModel(req, customEnv);
    expect(result).toBe('@cf/custom/tool-model');
  });
});

// ─────────────────────────────────────────────────────────────
// resolveAutoRouteModel — advanced tier
// ─────────────────────────────────────────────────────────────
describe('resolveAutoRouteModel — advanced tier', () => {
  test('many messages (> threshold) with no tools → one of the advanced models', () => {
    const req = makeRequest({
      messages: makeMessages(AUTO_ROUTE_THRESHOLDS.advancedMessageCount + 1),
    });
    const result = resolveAutoRouteModel(req, mockEnv);
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain(result);
  });

  test('long total chars (> threshold) with no tools → one of the advanced models', () => {
    const charsEach = Math.ceil((AUTO_ROUTE_THRESHOLDS.advancedTotalChars + 100) / 2);
    const req = makeRequest({ messages: makeMessages(2, charsEach) });
    const result = resolveAutoRouteModel(req, mockEnv);
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain(result);
  });

  test('many tools (> threshold) → one of the advanced models', () => {
    const tools = Array.from({ length: AUTO_ROUTE_THRESHOLDS.advancedToolCount + 1 }, (_, i) => ({
      type: 'function' as const,
      function: { name: `tool_${i}`, description: 'desc', parameters: { type: 'object', properties: {} } },
    }));
    const req = makeRequest({ tools });
    const result = resolveAutoRouteModel(req, mockEnv);
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain(result);
  });

  test('tools present AND many messages → one of the advanced models', () => {
    const singleTool: any[] = [
      {
        type: 'function',
        function: { name: 'get_data', description: 'desc', parameters: { type: 'object', properties: {} } },
      },
    ];
    const req = makeRequest({
      tools: singleTool,
      messages: makeMessages(AUTO_ROUTE_THRESHOLDS.advancedMessageCount + 1),
    });
    const result = resolveAutoRouteModel(req, mockEnv);
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain(result);
  });

  test('advanced pool contains glm-4.7-flash', () => {
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain('@cf/zai-org/glm-4.7-flash');
  });

  test('advanced pool contains nemotron', () => {
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain('@cf/nvidia/nemotron-3-120b-a12b');
  });

  test('advanced pool has at least 2 models', () => {
    expect(AUTO_ROUTE_DEFAULTS.advanced.length).toBeGreaterThanOrEqual(2);
  });

  test('respects AUTO_ROUTE_ADVANCED_MODEL env override', () => {
    const customEnv = { ...mockEnv, AUTO_ROUTE_ADVANCED_MODELS: '@cf/custom/advanced-model' } as Env;
    const req = makeRequest({
      messages: makeMessages(AUTO_ROUTE_THRESHOLDS.advancedMessageCount + 1),
    });
    const result = resolveAutoRouteModel(req, customEnv);
    expect(result).toBe('@cf/custom/advanced-model');
  });
});

// ─────────────────────────────────────────────────────────────
// getCfModelName — handles auto/auto/route names
// ─────────────────────────────────────────────────────────────
describe('getCfModelName — auto model names', () => {
  test('"auto" returns one of the cheap-tier models', () => {
    const result = getCfModelName('auto', mockEnv);
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(result);
  });

  test('"auto/route" returns one of the cheap-tier models', () => {
    const result = getCfModelName('auto/route', mockEnv);
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(result);
  });

  test('"auto" respects AUTO_ROUTE_CHEAP_MODEL override', () => {
    const customEnv = { ...mockEnv, AUTO_ROUTE_CHEAP_MODELS: '@cf/custom/cheap' } as Env;
    expect(getCfModelName('auto', customEnv)).toBe('@cf/custom/cheap');
  });
});

// ─────────────────────────────────────────────────────────────
// transformChatCompletionRequest — integration
// ─────────────────────────────────────────────────────────────
describe('transformChatCompletionRequest — auto-routing integration', () => {
  test('model="auto" with no tools → one of the cheap models in output', () => {
    const req: OpenAiChatCompletionReq = {
      model: 'auto',
      messages: [{ role: 'user', content: 'Hi' }],
    } as OpenAiChatCompletionReq;
    const normalized = validateAndNormalizeRequest(req, mockEnv);
    const result = transformChatCompletionRequest(normalized, mockEnv);
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(result.model);
  });

  test('model="auto/route" with tools → one of the tool models in output', () => {
    const req: OpenAiChatCompletionReq = {
      model: 'auto/route',
      messages: [{ role: 'user', content: 'What is the weather?' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', required: [], properties: {} },
          },
        },
      ],
    } as unknown as OpenAiChatCompletionReq;
    const normalized = validateAndNormalizeRequest(req, mockEnv);
    const result = transformChatCompletionRequest(normalized, mockEnv);
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(result.model);
  });

  test('model="auto" with long context → one of the advanced models in output', () => {
    const req: OpenAiChatCompletionReq = {
      model: 'auto',
      messages: makeMessages(AUTO_ROUTE_THRESHOLDS.advancedMessageCount + 1, 50),
    } as OpenAiChatCompletionReq;
    const normalized = validateAndNormalizeRequest(req, mockEnv);
    const result = transformChatCompletionRequest(normalized, mockEnv);
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain(result.model);
  });

  test('non-auto model is unaffected by routing logic', () => {
    const req: OpenAiChatCompletionReq = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    } as OpenAiChatCompletionReq;
    const normalized = validateAndNormalizeRequest(req, mockEnv);
    const result = transformChatCompletionRequest(normalized, mockEnv);
    // gpt-4 is aliased to Qwen
    expect(result.model).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });

  test('model="auto" with custom env overrides uses correct models', () => {
    const customEnv: Env = {
      ...mockEnv,
      AUTO_ROUTE_CHEAP_MODELS: '@cf/custom/cheap',
      AUTO_ROUTE_TOOL_MODELS: '@cf/custom/tool',
      AUTO_ROUTE_ADVANCED_MODELS: '@cf/custom/advanced',
    } as Env;

    // Simple → cheap
    const simpleReq: OpenAiChatCompletionReq = {
      model: 'auto',
      messages: [{ role: 'user', content: 'Hello' }],
    } as OpenAiChatCompletionReq;
    const simpleNorm = validateAndNormalizeRequest(simpleReq, customEnv);
    expect(transformChatCompletionRequest(simpleNorm, customEnv).model).toBe('@cf/custom/cheap');

    // With tools → tool
    const toolReq: OpenAiChatCompletionReq = {
      model: 'auto',
      messages: [{ role: 'user', content: 'Get weather' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', required: [], properties: {} },
          },
        },
      ],
    } as unknown as OpenAiChatCompletionReq;
    const toolNorm = validateAndNormalizeRequest(toolReq, customEnv);
    expect(transformChatCompletionRequest(toolNorm, customEnv).model).toBe('@cf/custom/tool');
  });
});

// ─────────────────────────────────────────────────────────────
// Multi-signal scoring — task type detection
// ─────────────────────────────────────────────────────────────
describe('resolveAutoRouteModel — multi-signal scoring', () => {

  test('messages with role=tool → advanced (active agentic loop)', () => {
    const req = makeRequest({
      messages: [
        { role: 'user', content: 'What is the weather?' },
        { role: 'tool', content: '{"temperature": 22}' },
        { role: 'assistant', content: 'It is 22 degrees.' },
      ] as any,
    });
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain(resolveAutoRouteModel(req, mockEnv));
  });

  test('message with code block (```) → tool tier', () => {
    const req = makeRequest({
      messages: [{ role: 'user', content: 'Fix this:\n```\nconst x = 1;\n```' }],
    });
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(resolveAutoRouteModel(req, mockEnv));
  });

  test('message with programming keywords → tool tier', () => {
    const req = makeRequest({
      messages: [{ role: 'user', content: 'Write a function that uses .filter(' }],
    });
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(resolveAutoRouteModel(req, mockEnv));
  });

  test('message with reasoning keyword (step by step) → tool tier', () => {
    const req = makeRequest({
      messages: [{ role: 'user', content: 'Solve this equation step by step.' }],
    });
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(resolveAutoRouteModel(req, mockEnv));
  });

  test('reasoning + tools combines to advanced', () => {
    const req = makeRequest({
      messages: [{ role: 'user', content: 'Analyze the data step by step and calculate totals.' }],
      tools: [{ type: 'function', function: { name: 'calc', description: 'Calculate', parameters: { type: 'object', properties: {} } } }],
    });
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain(resolveAutoRouteModel(req, mockEnv));
  });

  test('json_object response_format → tool tier', () => {
    const req = makeRequest({
      messages: [{ role: 'user', content: 'Return a JSON summary.' }],
      response_format: { type: 'json_object' } as any,
    });
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(resolveAutoRouteModel(req, mockEnv));
  });

  test('json_schema response_format → tool tier', () => {
    const req = makeRequest({
      messages: [{ role: 'user', content: 'Extract fields.' }],
      response_format: { type: 'json_schema', json_schema: { name: 'output', schema: {} } } as any,
    });
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(resolveAutoRouteModel(req, mockEnv));
  });

  test('tool_choice=required with tools → tool tier', () => {
    const req = makeRequest({
      tools: [{ type: 'function', function: { name: 'lookup', description: 'Lookup', parameters: { type: 'object', properties: {} } } }],
      tool_choice: 'required' as any,
    });
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(resolveAutoRouteModel(req, mockEnv));
  });

  test('simple conversational message with no signals → cheap tier', () => {
    const req = makeRequest({
      messages: [{ role: 'user', content: 'Hello, how are you?' }],
    });
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(resolveAutoRouteModel(req, mockEnv));
  });

  test('AUTO_ROUTE_SCORE_THRESHOLDS.tool < .advanced', () => {
    expect(AUTO_ROUTE_SCORE_THRESHOLDS.tool).toBeLessThan(AUTO_ROUTE_SCORE_THRESHOLDS.advanced);
  });
});

