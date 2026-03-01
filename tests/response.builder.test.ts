/**
 * ============================================================================
 * RESPONSE BUILDER TESTS
 * ============================================================================
 *
 * Exhaustive behavioral lock-down tests for buildOpenAIChatResponse and
 * buildOpenAIResponsesFormat. Verifies shape, field values, and edge cases.
 */

import {
  buildOpenAIChatResponse,
  buildOpenAIResponsesFormat,
} from '../src/builders/response.builder';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

// ─────────────────────────────────────────────────────────────
// buildOpenAIChatResponse
// ─────────────────────────────────────────────────────────────
describe('buildOpenAIChatResponse', () => {
  const model = 'gpt-4';
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

  test('returns a valid OpenAI chat.completion object', () => {
    const res = buildOpenAIChatResponse('Hello', model, undefined, undefined, usage);
    expect(res.object).toBe('chat.completion');
    expect(res.model).toBe(model);
    expect(res.choices).toHaveLength(1);
    expect(res.choices[0].message.role).toBe('assistant');
    expect(res.choices[0].message.content).toBe('Hello');
    expect(res.choices[0].finish_reason).toBe('stop');
    expect(res.choices[0].logprobs).toBeNull();
    expect(res.choices[0].index).toBe(0);
  });

  test('id starts with "chatcmpl-"', () => {
    const res = buildOpenAIChatResponse('Hi', model);
    expect(res.id).toMatch(/^chatcmpl-\d+$/);
  });

  test('created is a unix timestamp (number)', () => {
    const before = Math.floor(Date.now() / 1000) - 1;
    const res = buildOpenAIChatResponse('Hi', model);
    expect(typeof res.created).toBe('number');
    expect(res.created).toBeGreaterThanOrEqual(before);
  });

  test('system_fingerprint starts with "fp_"', () => {
    const res = buildOpenAIChatResponse('Hi', model);
    expect(res.system_fingerprint).toMatch(/^fp_/);
  });

  test('uses zero usage when not provided', () => {
    const res = buildOpenAIChatResponse('Hi', model);
    expect(res.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });

  test('preserves provided usage', () => {
    const res = buildOpenAIChatResponse('Hi', model, undefined, undefined, usage);
    expect(res.usage).toEqual(usage);
  });

  test('converts null/undefined/empty content to fallback space', () => {
    expect(buildOpenAIChatResponse(null, model).choices[0].message.content).toBe(' ');
    expect(buildOpenAIChatResponse(undefined, model).choices[0].message.content).toBe(' ');
    expect(buildOpenAIChatResponse('', model).choices[0].message.content).toBe(' ');
    expect(buildOpenAIChatResponse('   ', model).choices[0].message.content).toBe(' ');
  });

  test('sets content to null and finish_reason to tool_calls when tool_calls present', () => {
    const toolCalls = [{ name: 'get_weather', arguments: { city: 'London' } }];
    const res = buildOpenAIChatResponse('', model, toolCalls);
    expect(res.choices[0].message.content).toBeNull();
    expect(res.choices[0].finish_reason).toBe('tool_calls');
    expect(res.choices[0].message.tool_calls).toHaveLength(1);
  });

  test('tool_calls items have id, type="function", function.name, function.arguments', () => {
    const toolCalls = [{ name: 'fn', arguments: { x: 1 } }];
    const res = buildOpenAIChatResponse('', model, toolCalls);
    const tc = res.choices[0].message.tool_calls[0];
    expect(tc.id).toMatch(/^call_/);
    expect(tc.type).toBe('function');
    expect(tc.function.name).toBe('fn');
    expect(tc.function.arguments).toBe(JSON.stringify({ x: 1 }));
  });

  test('tool_calls arguments already a string are passed through', () => {
    const toolCalls = [{ name: 'fn', arguments: '{"x":1}' }];
    const res = buildOpenAIChatResponse('', model, toolCalls);
    expect(res.choices[0].message.tool_calls[0].function.arguments).toBe('{"x":1}');
  });

  test('includes reasoning_content for qwen model', () => {
    const res = buildOpenAIChatResponse(
      'Answer',
      '@cf/qwen/qwen3-30b-a3b-fp8',
      undefined,
      'My reasoning'
    );
    expect(res.choices[0].message.reasoning_content).toBe('My reasoning');
  });

  test('strips reasoning_content for non-reasoning model', () => {
    const res = buildOpenAIChatResponse('Answer', 'gpt-4', undefined, 'My reasoning');
    expect(res.choices[0].message.reasoning_content).toBeUndefined();
  });

  test('includes reasoning_content for o1 model', () => {
    const res = buildOpenAIChatResponse('Answer', 'o1-mini', undefined, 'Thinking...');
    expect(res.choices[0].message.reasoning_content).toBe('Thinking...');
  });

  test('each tool_call gets a unique id', () => {
    const toolCalls = [
      { name: 'fn1', arguments: {} },
      { name: 'fn2', arguments: {} },
    ];
    const res = buildOpenAIChatResponse('', model, toolCalls);
    const ids = res.choices[0].message.tool_calls.map((tc: any) => tc.id);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

// ─────────────────────────────────────────────────────────────
// buildOpenAIResponsesFormat
// ─────────────────────────────────────────────────────────────
describe('buildOpenAIResponsesFormat', () => {
  const model = 'gpt-4';
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

  test('returns a valid Responses API response object', () => {
    const res = buildOpenAIResponsesFormat('Hello', model, undefined, undefined, usage);
    expect(res.object).toBe('response');
    expect(res.status).toBe('completed');
    expect(res.model).toBe(model);
    expect(res.error).toBeNull();
    expect(res.id).toMatch(/^resp_/);
  });

  test('output contains a message item with output_text', () => {
    const res = buildOpenAIResponsesFormat('Hello world', model);
    const msgItem = res.output.find((o: any) => o.type === 'message');
    expect(msgItem).toBeDefined();
    expect(msgItem.role).toBe('assistant');
    expect(msgItem.status).toBe('completed');
    const textContent = msgItem.content.find((c: any) => c.type === 'output_text');
    expect(textContent.text).toBe('Hello world');
    expect(textContent.annotations).toEqual([]);
  });

  test('output contains function_call items for tool_calls', () => {
    const toolCalls = [{ name: 'search', arguments: { query: 'hello' } }];
    const res = buildOpenAIResponsesFormat('', model, toolCalls);
    const fnItems = res.output.filter((o: any) => o.type === 'function_call');
    expect(fnItems).toHaveLength(1);
    expect(fnItems[0].function.name).toBe('search');
    expect(fnItems[0].id).toMatch(/^call_/);
    expect(fnItems[0].status).toBe('completed');
  });

  test('falls back to default empty message when no content and no tools', () => {
    const res = buildOpenAIResponsesFormat(null, model);
    // null content → ensureValidContent produces " "
    // So output should have a message item (space is truthy after trim check)
    // Actually " ".trim().length === 0 → fallback space... let's verify
    expect(res.output.length).toBeGreaterThan(0);
    const msgItem = res.output.find((o: any) => o.type === 'message');
    expect(msgItem).toBeDefined();
  });

  test('uses Responses API usage shape with input_tokens/output_tokens', () => {
    const res = buildOpenAIResponsesFormat('Hi', model, undefined, undefined, usage);
    expect(res.usage.input_tokens).toBe(usage.prompt_tokens);
    expect(res.usage.output_tokens).toBe(usage.completion_tokens);
    expect(res.usage.total_tokens).toBe(usage.total_tokens);
    expect(res.usage.input_tokens_details.cached_tokens).toBe(0);
    expect(res.usage.output_tokens_details.reasoning_tokens).toBe(0);
  });

  test('reasoning_tokens computed from reasoningContent length', () => {
    const reasoning = 'a'.repeat(400); // 400 chars → ceil(400/4)=100 tokens
    const res = buildOpenAIResponsesFormat('Hi', model, undefined, reasoning, usage);
    expect(res.usage.output_tokens_details.reasoning_tokens).toBe(100);
  });

  test('includes reasoning field when reasoningContent provided', () => {
    const res = buildOpenAIResponsesFormat('Hi', model, undefined, 'Thinking...', usage);
    expect(res.reasoning).not.toBeNull();
    expect(res.reasoning.content).toBe('Thinking...');
    expect(res.reasoning.summary).toBe('auto');
  });

  test('reasoning field is null when no reasoningContent', () => {
    const res = buildOpenAIResponsesFormat('Hi', model);
    expect(res.reasoning).toBeNull();
  });

  test('applies requestParams temperature and top_p', () => {
    const params = { temperature: 0.3, top_p: 0.9 };
    const res = buildOpenAIResponsesFormat('Hi', model, undefined, undefined, undefined, params);
    expect(res.temperature).toBe(0.3);
    expect(res.top_p).toBe(0.9);
  });

  test('defaults temperature=1.0 and top_p=1.0 when no params', () => {
    const res = buildOpenAIResponsesFormat('Hi', model);
    expect(res.temperature).toBe(1.0);
    expect(res.top_p).toBe(1.0);
  });

  test('store defaults to true when not provided', () => {
    const res = buildOpenAIResponsesFormat('Hi', model);
    expect(res.store).toBe(true);
  });

  test('created_at is a unix timestamp', () => {
    const before = Math.floor(Date.now() / 1000) - 1;
    const res = buildOpenAIResponsesFormat('Hi', model);
    expect(typeof res.created_at).toBe('number');
    expect(res.created_at).toBeGreaterThanOrEqual(before);
  });

  test('tools and tool_choice default to [] and "auto"', () => {
    const res = buildOpenAIResponsesFormat('Hi', model);
    expect(res.tools).toEqual([]);
    expect(res.tool_choice).toBe('auto');
  });
});

