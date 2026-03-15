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
import { AUTO_ROUTE_DEFAULTS, AUTO_ROUTE_THRESHOLDS, AUTO_ROUTE_MODEL_NAMES } from '../src/constants';
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
  test('simple request with no tools → cheap model', () => {
    const result = resolveAutoRouteModel(makeRequest(), mockEnv);
    expect(result).toBe(AUTO_ROUTE_DEFAULTS.cheap);
  });

  test('small context, no tools → cheap model', () => {
    const req = makeRequest({ messages: makeMessages(3, 100) });
    const result = resolveAutoRouteModel(req, mockEnv);
    expect(result).toBe(AUTO_ROUTE_DEFAULTS.cheap);
  });

  test('respects AUTO_ROUTE_CHEAP_MODEL env override', () => {
    const customEnv = { ...mockEnv, AUTO_ROUTE_CHEAP_MODEL: '@cf/custom/cheap-model' } as Env;
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

  test('request with one tool → tool model', () => {
    const req = makeRequest({ tools: singleTool });
    const result = resolveAutoRouteModel(req, mockEnv);
    expect(result).toBe(AUTO_ROUTE_DEFAULTS.tool);
  });

  test('request with tools up to threshold → tool model', () => {
    const tools = Array.from({ length: AUTO_ROUTE_THRESHOLDS.advancedToolCount }, (_, i) => ({
      type: 'function' as const,
      function: { name: `tool_${i}`, description: 'desc', parameters: { type: 'object', properties: {} } },
    }));
    const req = makeRequest({ tools });
    const result = resolveAutoRouteModel(req, mockEnv);
    expect(result).toBe(AUTO_ROUTE_DEFAULTS.tool);
  });

  test('respects AUTO_ROUTE_TOOL_MODEL env override', () => {
    const customEnv = { ...mockEnv, AUTO_ROUTE_TOOL_MODEL: '@cf/custom/tool-model' } as Env;
    const req = makeRequest({ tools: singleTool });
    const result = resolveAutoRouteModel(req, customEnv);
    expect(result).toBe('@cf/custom/tool-model');
  });
});

// ─────────────────────────────────────────────────────────────
// resolveAutoRouteModel — advanced tier
// ─────────────────────────────────────────────────────────────
describe('resolveAutoRouteModel — advanced tier', () => {
  test('many messages (> threshold) with no tools → advanced model', () => {
    const req = makeRequest({
      messages: makeMessages(AUTO_ROUTE_THRESHOLDS.advancedMessageCount + 1),
    });
    const result = resolveAutoRouteModel(req, mockEnv);
    expect(result).toBe(AUTO_ROUTE_DEFAULTS.advanced);
  });

  test('long total chars (> threshold) with no tools → advanced model', () => {
    const charsEach = Math.ceil((AUTO_ROUTE_THRESHOLDS.advancedTotalChars + 100) / 2);
    const req = makeRequest({ messages: makeMessages(2, charsEach) });
    const result = resolveAutoRouteModel(req, mockEnv);
    expect(result).toBe(AUTO_ROUTE_DEFAULTS.advanced);
  });

  test('many tools (> threshold) → advanced model', () => {
    const tools = Array.from({ length: AUTO_ROUTE_THRESHOLDS.advancedToolCount + 1 }, (_, i) => ({
      type: 'function' as const,
      function: { name: `tool_${i}`, description: 'desc', parameters: { type: 'object', properties: {} } },
    }));
    const req = makeRequest({ tools });
    const result = resolveAutoRouteModel(req, mockEnv);
    expect(result).toBe(AUTO_ROUTE_DEFAULTS.advanced);
  });

  test('tools present AND many messages → advanced model', () => {
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
    expect(result).toBe(AUTO_ROUTE_DEFAULTS.advanced);
  });

  test('respects AUTO_ROUTE_ADVANCED_MODEL env override', () => {
    const customEnv = { ...mockEnv, AUTO_ROUTE_ADVANCED_MODEL: '@cf/custom/advanced-model' } as Env;
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
  test('"auto" returns cheap-tier model', () => {
    const result = getCfModelName('auto', mockEnv);
    expect(result).toBe(AUTO_ROUTE_DEFAULTS.cheap);
  });

  test('"auto/route" returns cheap-tier model', () => {
    const result = getCfModelName('auto/route', mockEnv);
    expect(result).toBe(AUTO_ROUTE_DEFAULTS.cheap);
  });

  test('"auto" respects AUTO_ROUTE_CHEAP_MODEL override', () => {
    const customEnv = { ...mockEnv, AUTO_ROUTE_CHEAP_MODEL: '@cf/custom/cheap' } as Env;
    expect(getCfModelName('auto', customEnv)).toBe('@cf/custom/cheap');
  });
});

// ─────────────────────────────────────────────────────────────
// transformChatCompletionRequest — integration
// ─────────────────────────────────────────────────────────────
describe('transformChatCompletionRequest — auto-routing integration', () => {
  test('model="auto" with no tools → cheap model in output', () => {
    const req: OpenAiChatCompletionReq = {
      model: 'auto',
      messages: [{ role: 'user', content: 'Hi' }],
    } as OpenAiChatCompletionReq;
    const normalized = validateAndNormalizeRequest(req, mockEnv);
    const result = transformChatCompletionRequest(normalized, mockEnv);
    expect(result.model).toBe(AUTO_ROUTE_DEFAULTS.cheap);
  });

  test('model="auto/route" with tools → tool model in output', () => {
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
    expect(result.model).toBe(AUTO_ROUTE_DEFAULTS.tool);
  });

  test('model="auto" with long context → advanced model in output', () => {
    const req: OpenAiChatCompletionReq = {
      model: 'auto',
      messages: makeMessages(AUTO_ROUTE_THRESHOLDS.advancedMessageCount + 1, 50),
    } as OpenAiChatCompletionReq;
    const normalized = validateAndNormalizeRequest(req, mockEnv);
    const result = transformChatCompletionRequest(normalized, mockEnv);
    expect(result.model).toBe(AUTO_ROUTE_DEFAULTS.advanced);
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
      AUTO_ROUTE_CHEAP_MODEL: '@cf/custom/cheap',
      AUTO_ROUTE_TOOL_MODEL: '@cf/custom/tool',
      AUTO_ROUTE_ADVANCED_MODEL: '@cf/custom/advanced',
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
