/**
 * ============================================================================
 * AUTO-ROUTE SCORING — DETAILED TESTS
 * ============================================================================
 *
 * Focuses on the new multi-signal scoring layer introduced in model-helpers:
 *
 *  - Individual signal isolation (each signal alone, confirms its score contribution)
 *  - Additive score combinations (soft signals combining to escalate tier)
 *  - Score boundary verification (exactly at threshold, one either side)
 *  - Keyword coverage (CODE_KEYWORDS, REASONING_KEYWORDS)
 *  - Edge cases: empty messages, null/array content, response_format variants,
 *    tool_choice variants, developer-role system prompt
 */

import { resolveAutoRouteModel } from '../src/model-helpers';
import { AUTO_ROUTE_DEFAULTS, AUTO_ROUTE_SCORE_THRESHOLDS, AUTO_ROUTE_THRESHOLDS } from '../src/constants';
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

const singleTool: any[] = [{
  type: 'function',
  function: { name: 'do_thing', description: 'Does a thing', parameters: { type: 'object', properties: {} } },
}];

function req(overrides: Partial<OpenAiChatCompletionReq> = {}): OpenAiChatCompletionReq {
  return { model: 'auto', messages: [{ role: 'user', content: 'Hi' }], ...overrides } as OpenAiChatCompletionReq;
}

function route(overrides: Partial<OpenAiChatCompletionReq> = {}) {
  return resolveAutoRouteModel(req(overrides), mockEnv);
}

// ─────────────────────────────────────────────────────────────
// Individual signal isolation
// (verifies each signal contributes the expected score in isolation)
// ─────────────────────────────────────────────────────────────
describe('signal isolation', () => {
  // hasTools = +3 → tool tier (score 3, at threshold)
  test('single tool alone → tool tier', () => {
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(route({ tools: singleTool }));
  });

  // hasCodeContent = +3 → tool tier
  test('code block alone → tool tier', () => {
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(
      route({ messages: [{ role: 'user', content: '```js\nconsole.log(1);\n```' }] })
    );
  });

  // hasReasoningContent = +5 → tool tier (score 5, between 3 and 8)
  test('reasoning keyword alone → tool tier', () => {
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(
      route({ messages: [{ role: 'user', content: 'Please analyze this situation.' }] })
    );
  });

  // hasStructuredOutput = +3 → tool tier
  test('json_object response_format alone → tool tier', () => {
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(
      route({ response_format: { type: 'json_object' } as any })
    );
  });

  // hasAgenticHistory = +8 → advanced tier (hard signal)
  test('role=tool message alone → advanced tier', () => {
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain(
      route({ messages: [{ role: 'tool', content: '{}' }] as any })
    );
  });

  // systemPromptLength > 2000 = +2 → cheap tier (score 2, below tool threshold of 3)
  test('long system prompt alone (score=2) stays cheap tier', () => {
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(
      route({ messages: [{ role: 'system', content: 'S'.repeat(2001) }, { role: 'user', content: 'Hi' }] })
    );
  });

  // toolChoiceRequired alone (no tools) = +2 → cheap tier
  test('tool_choice=required without tools (score=2) stays cheap tier', () => {
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(
      route({ tool_choice: 'required' as any })
    );
  });

  // Large messageCount = +8 → advanced tier (hard signal)
  test('message count exceeding threshold alone → advanced tier', () => {
    const manyMessages = Array.from({ length: AUTO_ROUTE_THRESHOLDS.advancedMessageCount + 1 }, (_, i) => ({
      role: 'user' as const,
      content: `msg ${i}`,
    }));
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain(route({ messages: manyMessages }));
  });

  // Large totalChars = +8 → advanced tier (hard signal)
  test('total chars exceeding threshold alone → advanced tier', () => {
    const charsEach = Math.ceil((AUTO_ROUTE_THRESHOLDS.advancedTotalChars + 200) / 2);
    const longMessages = [
      { role: 'user' as const, content: 'A'.repeat(charsEach) },
      { role: 'user' as const, content: 'B'.repeat(charsEach) },
    ];
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain(route({ messages: longMessages }));
  });

  // Many tools = +8 → advanced tier (hard signal)
  test('tool count exceeding threshold alone → advanced tier', () => {
    const manyTools = Array.from({ length: AUTO_ROUTE_THRESHOLDS.advancedToolCount + 1 }, (_, i) => ({
      type: 'function' as const,
      function: { name: `tool_${i}`, description: 'desc', parameters: { type: 'object', properties: {} } },
    }));
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain(route({ tools: manyTools }));
  });
});

// ─────────────────────────────────────────────────────────────
// Score combinations (soft signals adding up)
// ─────────────────────────────────────────────────────────────
describe('signal combinations', () => {
  // reasoning(+5) + tools(+3) = 8 → advanced
  test('reasoning + tools = 8 → advanced', () => {
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain(
      route({
        messages: [{ role: 'user', content: 'Analyze the results step by step.' }],
        tools: singleTool,
      })
    );
  });

  // code(+3) + reasoning(+5) = 8 → advanced
  test('code + reasoning = 8 → advanced', () => {
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain(
      route({
        messages: [{ role: 'user', content: 'Analyze this function and evaluate its complexity.\n```js\nconst x = 1;\n```' }],
      })
    );
  });

  // structured output(+3) + reasoning(+5) = 8 → advanced
  test('structured output + reasoning = 8 → advanced', () => {
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain(
      route({
        messages: [{ role: 'user', content: 'Analyze and return a JSON result.' }],
        response_format: { type: 'json_object' } as any,
      })
    );
  });

  // systemPrompt(+2) + reasoning(+5) = 7 → tool (just below advanced)
  test('long system prompt + reasoning = 7 → tool tier', () => {
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(
      route({
        messages: [
          { role: 'system', content: 'S'.repeat(2001) },
          { role: 'user', content: 'Please analyze this.' },
        ],
      })
    );
  });

  // systemPrompt(+2) + reasoning(+5) + tools(+3) = 10 → advanced
  test('long system prompt + reasoning + tools = 10 → advanced', () => {
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain(
      route({
        messages: [
          { role: 'system', content: 'S'.repeat(2001) },
          { role: 'user', content: 'Analyze and calculate the totals.' },
        ],
        tools: singleTool,
      })
    );
  });

  // hasTools(+3) + toolCount>2(+2) = 5 → tool (3 tools, below hard threshold)
  test('3 tools (toolCount > 2 but below hard threshold) = 5 → tool tier', () => {
    const threeTools = Array.from({ length: 3 }, (_, i) => ({
      type: 'function' as const,
      function: { name: `tool_${i}`, description: 'desc', parameters: { type: 'object', properties: {} } },
    }));
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(route({ tools: threeTools }));
  });

  // toolChoiceRequired(+2) + tools(+3) = 5 → tool
  test('tool_choice=required + single tool = 5 → tool tier', () => {
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(
      route({ tools: singleTool, tool_choice: 'required' as any })
    );
  });

  // code(+3) + structured output(+3) = 6 → tool
  test('code + structured output = 6 → tool tier', () => {
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(
      route({
        messages: [{ role: 'user', content: 'Convert this ```function``` to JSON.' }],
        response_format: { type: 'json_object' } as any,
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Score boundary verification
// ─────────────────────────────────────────────────────────────
describe('score boundaries', () => {
  test('score thresholds: tool < advanced', () => {
    expect(AUTO_ROUTE_SCORE_THRESHOLDS.tool).toBeLessThan(AUTO_ROUTE_SCORE_THRESHOLDS.advanced);
  });

  test('score thresholds: tool >= 1', () => {
    expect(AUTO_ROUTE_SCORE_THRESHOLDS.tool).toBeGreaterThanOrEqual(1);
  });

  // Score 0 → cheap (plain "Hi")
  test('score=0 (plain message) → cheap tier', () => {
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(
      route({ messages: [{ role: 'user', content: 'Hi there!' }] })
    );
  });

  // Score exactly at tool threshold: single tool (+3) = 3 → tool
  test('score exactly at tool threshold → tool tier', () => {
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(route({ tools: singleTool }));
  });

  // Score exactly at advanced threshold: reasoning(+5) + tools(+3) = 8 → advanced
  test('score exactly at advanced threshold → advanced tier', () => {
    expect(AUTO_ROUTE_DEFAULTS.advanced).toContain(
      route({
        messages: [{ role: 'user', content: 'Please analyze this in detail.' }],
        tools: singleTool,
      })
    );
  });

  // Score one below tool threshold: systemPrompt(+2) → cheap
  test('score one below tool threshold (score=2) → cheap tier', () => {
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(
      route({ messages: [{ role: 'system', content: 'S'.repeat(2001) }, { role: 'user', content: 'hi' }] })
    );
  });

  // Score one below advanced threshold: systemPrompt(+2) + reasoning(+5) = 7 → tool
  test('score one below advanced threshold (score=7) → tool tier', () => {
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(
      route({
        messages: [
          { role: 'system', content: 'S'.repeat(2001) },
          { role: 'user', content: 'Analyze this.' },
        ],
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Keyword coverage — CODE_KEYWORDS
// ─────────────────────────────────────────────────────────────
describe('code keyword detection', () => {
  const codeSnippets = [
    ['backtick code fence', '```python\nprint("hello")\n```'],
    ['async keyword', 'Write async code that awaits a promise.'],
    ['class keyword', 'Create a class called MyService.'],
    ['interface keyword', 'Define an interface for this type.'],
    ['import keyword', 'Use import statements at the top.'],
    ['arrow function', 'Use () => syntax for callbacks.'],
    ['.map( usage', 'Use array.map( to transform items.'],
    ['#include directive', 'Add #include headers for C++.'],
  ];

  test.each(codeSnippets)('%s → tool tier', (_label, content) => {
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(
      route({ messages: [{ role: 'user', content }] })
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Keyword coverage — REASONING_KEYWORDS
// ─────────────────────────────────────────────────────────────
describe('reasoning keyword detection', () => {
  const reasoningPrompts = [
    ['analyze', 'Please analyze this dataset.'],
    ['analyse (UK spelling)', 'Analyse the pros and cons.'],
    ['calculate', 'Calculate the total cost.'],
    ['compare', 'Compare these two approaches.'],
    ['evaluate', 'Evaluate the effectiveness.'],
    ['step-by-step', 'Solve this step-by-step.'],
    ['equation', 'Solve the following equation.'],
    ['hypothesis', 'Form a hypothesis about this.'],
    ['therefore', 'State your conclusion — therefore what?'],
    ['infer', 'Infer the meaning from the context.'],
    ['derive', 'Derive the formula from first principles.'],
    ['prove', 'Prove that this theorem is correct.'],
    ['compute', 'Compute the eigenvalues.'],
  ];

  test.each(reasoningPrompts)('%s → tool tier', (_label, content) => {
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(
      route({ messages: [{ role: 'user', content }] })
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────
describe('edge cases', () => {
  test('empty messages array → cheap tier (no crash)', () => {
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(
      route({ messages: [] })
    );
  });

  test('message with null content → cheap tier (no crash)', () => {
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(
      route({ messages: [{ role: 'user', content: null as any }] })
    );
  });

  test('message with undefined content → cheap tier (no crash)', () => {
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(
      route({ messages: [{ role: 'user', content: undefined as any }] })
    );
  });

  test('message with array content (multimodal) is scanned for keywords', () => {
    // Array content — the text part should still be detected as code
    const req = makeReqWith({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Fix this function ' },
          { type: 'image_url', image_url: { url: 'http://example.com/img.png' } },
        ] as any,
      }],
    });
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(resolveAutoRouteModel(req, mockEnv));
  });

  test('message with array of plain strings is scanned', () => {
    const req = makeReqWith({
      messages: [{
        role: 'user',
        content: ['Please analyze this function'] as any,
      }],
    });
    // 'analyze' keyword should be found → tool tier
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(resolveAutoRouteModel(req, mockEnv));
  });

  test('response_format: "auto" (string) does NOT trigger structured output', () => {
    // response_format as string "auto" should not score +3
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(
      route({ response_format: 'auto' as any })
    );
  });

  test('response_format: { type: "text" } does NOT trigger structured output', () => {
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(
      route({ response_format: { type: 'text' } as any })
    );
  });

  test('tool_choice: "auto" does NOT trigger toolChoiceRequired', () => {
    // score = 0 (no other signals) → cheap
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(
      route({ tool_choice: 'auto' as any })
    );
  });

  test('tool_choice: "none" does NOT trigger toolChoiceRequired', () => {
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(
      route({ tool_choice: 'none' as any })
    );
  });

  test('role=developer system prompt counts for systemPromptLength', () => {
    // developer role should be treated the same as system for length scoring
    // developer prompt(+2) + reasoning(+5) = 7 → tool tier
    expect(AUTO_ROUTE_DEFAULTS.tool).toContain(
      route({
        messages: [
          { role: 'developer', content: 'D'.repeat(2001) },
          { role: 'user', content: 'Analyze the output.' },
        ],
      })
    );
  });

  test('no messages field at all → cheap tier (no crash)', () => {
    const badReq = { model: 'auto' } as OpenAiChatCompletionReq;
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(resolveAutoRouteModel(badReq, mockEnv));
  });

  test('no tools field → cheap tier (no crash)', () => {
    const noToolsReq = req({ tools: undefined });
    expect(AUTO_ROUTE_DEFAULTS.cheap).toContain(resolveAutoRouteModel(noToolsReq, mockEnv));
  });
});

// ─────────────────────────────────────────────────────────────
// Env overrides respected across all new signal paths
// ─────────────────────────────────────────────────────────────
describe('env overrides respected for new signal paths', () => {
  const customEnv: Env = {
    ...mockEnv,
    AUTO_ROUTE_CHEAP_MODELS: '@cf/custom/cheap',
    AUTO_ROUTE_TOOL_MODELS: '@cf/custom/tool',
    AUTO_ROUTE_ADVANCED_MODELS: '@cf/custom/advanced',
  } as Env;

  test('coding request uses AUTO_ROUTE_TOOL_MODEL override', () => {
    const result = resolveAutoRouteModel(
      req({ messages: [{ role: 'user', content: 'Write a function to sort an array.' }] }),
      customEnv
    );
    expect(result).toBe('@cf/custom/tool');
  });

  test('agentic history uses AUTO_ROUTE_ADVANCED_MODEL override', () => {
    const result = resolveAutoRouteModel(
      req({ messages: [{ role: 'tool', content: '{}' }] as any }),
      customEnv
    );
    expect(result).toBe('@cf/custom/advanced');
  });

  test('reasoning + tools uses AUTO_ROUTE_ADVANCED_MODEL override', () => {
    const result = resolveAutoRouteModel(
      req({
        messages: [{ role: 'user', content: 'Analyze and calculate.' }],
        tools: singleTool,
      }),
      customEnv
    );
    expect(result).toBe('@cf/custom/advanced');
  });
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function makeReqWith(overrides: Partial<OpenAiChatCompletionReq>): OpenAiChatCompletionReq {
  return { model: 'auto', messages: [{ role: 'user', content: 'Hi' }], ...overrides } as OpenAiChatCompletionReq;
}

