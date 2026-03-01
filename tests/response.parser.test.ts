/**
 * ============================================================================
 * RESPONSE PARSER TESTS
 * ============================================================================
 *
 * Exhaustive behavioral lock-down tests for all three response parsers.
 * These tests capture current behavior — including quirks — so refactoring
 * does not silently change observable output.
 */

import {
  extractGptOssResponse,
  sanitizeAiResponse,
  extractOpenAiCompatibleResponse,
} from '../src/parsers/response.parser';

// Silence logger noise in tests
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

// ─────────────────────────────────────────────────────────────
// extractGptOssResponse
// ─────────────────────────────────────────────────────────────
describe('extractGptOssResponse', () => {
  test('extracts text from "message" type items', () => {
    const res = {
      output: [
        { type: 'message', content: [{ text: 'Hello world' }] },
      ],
    };
    const result = extractGptOssResponse(res);
    expect(result.response).toBe('Hello world');
    expect(result.contentType).toBe('application/json');
  });

  test('concatenates multiple message content items', () => {
    const res = {
      output: [
        { type: 'message', content: [{ text: 'Part1 ' }, { text: 'Part2' }] },
      ],
    };
    const result = extractGptOssResponse(res);
    expect(result.response).toBe('Part1 Part2');
  });

  test('concatenates message content across multiple output items', () => {
    const res = {
      output: [
        { type: 'message', content: [{ text: 'A' }] },
        { type: 'message', content: [{ text: 'B' }] },
      ],
    };
    const result = extractGptOssResponse(res);
    expect(result.response).toBe('AB');
  });

  test('falls back to reasoning type when no message items', () => {
    const res = {
      output: [
        { type: 'reasoning', content: [{ text: 'Thinking...' }] },
      ],
    };
    const result = extractGptOssResponse(res);
    expect(result.response).toBe('Thinking...');
  });

  test('prefers message over reasoning when both present', () => {
    const res = {
      output: [
        { type: 'reasoning', content: [{ text: 'Thinking...' }] },
        { type: 'message', content: [{ text: 'The answer' }] },
      ],
    };
    const result = extractGptOssResponse(res);
    expect(result.response).toBe('The answer');
  });

  test('returns fallback space when no text extractable', () => {
    const res = { output: [{ type: 'other', content: [] }] };
    const result = extractGptOssResponse(res);
    expect(result.response).toBe(' ');
  });

  test('returns fallback when output array is missing', () => {
    const result = extractGptOssResponse({});
    expect(result.response).toBe(' ');
    expect(result.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });

  test('returns fallback when output is not an array', () => {
    const result = extractGptOssResponse({ output: 'bad' });
    expect(result.response).toBe(' ');
  });

  test('uses provided usage object when available', () => {
    const usage = { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 };
    const res = {
      output: [{ type: 'message', content: [{ text: 'Hi' }] }],
      usage,
    };
    const result = extractGptOssResponse(res);
    expect(result.usage).toEqual(usage);
  });

  test('estimates usage when not provided and computes total_tokens', () => {
    const res = {
      output: [{ type: 'message', content: [{ text: 'Hello' }] }],
      instructions: 'Do this',
      input: 'question',
    };
    const result = extractGptOssResponse(res);
    // prompt_tokens from (instructions + input) length / 4 = ceil(15/4) = 4
    expect(result.usage.prompt_tokens).toBeGreaterThan(0);
    // completion_tokens from response text length / 4 = ceil(5/4) = 2
    expect(result.usage.completion_tokens).toBeGreaterThan(0);
    expect(result.usage.total_tokens).toBe(
      result.usage.prompt_tokens + result.usage.completion_tokens
    );
  });

  test('handles empty text fields gracefully', () => {
    const res = {
      output: [{ type: 'message', content: [{ text: '' }, { text: '' }] }],
    };
    const result = extractGptOssResponse(res);
    expect(result.response).toBe(' ');
  });

  test('returns fallback on thrown error during parse', () => {
    // Pass a getter that throws to trigger the catch path
    const badRes = Object.defineProperty({}, 'output', {
      get() { throw new Error('boom'); },
    });
    const result = extractGptOssResponse(badRes);
    expect(result.response).toBe(' ');
    expect(result.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });
});

// ─────────────────────────────────────────────────────────────
// sanitizeAiResponse
// ─────────────────────────────────────────────────────────────
describe('sanitizeAiResponse', () => {
  test('passes through valid string response unchanged', () => {
    const result = sanitizeAiResponse({ response: 'Hello', contentType: 'application/json' });
    expect(result.response).toBe('Hello');
    expect(result.contentType).toBe('application/json');
  });

  test('converts null response to fallback space', () => {
    const result = sanitizeAiResponse({ response: null });
    expect(result.response).toBe(' ');
  });

  test('converts undefined response to fallback space', () => {
    const result = sanitizeAiResponse({ response: undefined });
    expect(result.response).toBe(' ');
  });

  test('converts empty string response to fallback space', () => {
    const result = sanitizeAiResponse({ response: '' });
    expect(result.response).toBe(' ');
  });

  test('converts whitespace-only response to fallback space', () => {
    const result = sanitizeAiResponse({ response: '   ' });
    expect(result.response).toBe(' ');
  });

  test('converts numeric response to string', () => {
    const result = sanitizeAiResponse({ response: 42 });
    expect(result.response).toBe('42');
  });

  test('converts object response to string via String()', () => {
    const result = sanitizeAiResponse({ response: { foo: 'bar' } });
    expect(typeof result.response).toBe('string');
  });

  test('removes tool_calls when not an array', () => {
    const result = sanitizeAiResponse({ response: 'Hi', tool_calls: 'bad' });
    expect(result.tool_calls).toBeUndefined();
  });

  test('removes tool_calls when empty array', () => {
    const result = sanitizeAiResponse({ response: 'Hi', tool_calls: [] });
    expect(result.tool_calls).toBeUndefined();
  });

  test('preserves valid non-empty tool_calls array', () => {
    const tc = [{ name: 'fn', arguments: {} }];
    const result = sanitizeAiResponse({ response: '', tool_calls: tc });
    expect(result.tool_calls).toEqual(tc);
  });

  test('preserves reasoning_content when present', () => {
    const result = sanitizeAiResponse({ response: 'Hi', reasoning_content: 'Thinking' });
    expect(result.reasoning_content).toBe('Thinking');
  });

  test('uses default usage when none provided', () => {
    const result = sanitizeAiResponse({ response: 'Hi' });
    expect(result.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });

  test('preserves provided usage', () => {
    const usage = { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 };
    const result = sanitizeAiResponse({ response: 'Hi', usage });
    expect(result.usage).toEqual(usage);
  });

  test('defaults contentType to application/json when absent', () => {
    const result = sanitizeAiResponse({ response: 'Hi' });
    expect(result.contentType).toBe('application/json');
  });
});

// ─────────────────────────────────────────────────────────────
// extractOpenAiCompatibleResponse
// ─────────────────────────────────────────────────────────────
describe('extractOpenAiCompatibleResponse', () => {
  const standardModel = '@cf/meta/llama-3-8b-instruct';
  const qwenModel = '@cf/qwen/qwen3-30b-a3b-fp8';

  function makeChoicesResponse(content: string, extras: object = {}) {
    return {
      choices: [{ message: { role: 'assistant', content, ...extras } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
  }

  test('extracts content string from choices[0].message.content', () => {
    const result = extractOpenAiCompatibleResponse(
      makeChoicesResponse('The answer is 42'),
      standardModel
    );
    expect(result.response).toBe('The answer is 42');
  });

  test('returns fallback space when choices array is empty', () => {
    const result = extractOpenAiCompatibleResponse({ choices: [] }, standardModel);
    expect(result.response).toBe(' ');
  });

  test('returns fallback space when choices is missing', () => {
    const result = extractOpenAiCompatibleResponse({}, standardModel);
    expect(result.response).toBe(' ');
  });

  test('returns fallback space when message is missing from choice', () => {
    const result = extractOpenAiCompatibleResponse(
      { choices: [{ finish_reason: 'stop' }] },
      standardModel
    );
    expect(result.response).toBe(' ');
  });

  test('preserves usage from response', () => {
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    const result = extractOpenAiCompatibleResponse(makeChoicesResponse('Hi'), standardModel);
    expect(result.usage).toEqual(usage);
  });

  test('estimates usage when all tokens are zero', () => {
    const res = {
      choices: [{ message: { content: 'Hello world answer' } }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
    const result = extractOpenAiCompatibleResponse(res, standardModel);
    expect(result.usage.prompt_tokens).toBe(10);
    expect(result.usage.completion_tokens).toBeGreaterThan(0);
    expect(result.usage.total_tokens).toBe(result.usage.prompt_tokens + result.usage.completion_tokens);
  });

  test('extracts reasoning_content for qwen model', () => {
    const res = {
      choices: [{
        message: {
          content: 'Final answer',
          reasoning_content: 'Let me think...',
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const result = extractOpenAiCompatibleResponse(res, qwenModel);
    expect(result.reasoning_content).toBe('Let me think...');
    expect(result.response).toBe('Final answer');
  });

  test('returns tool_calls and empty response when tool_calls present', () => {
    const res = {
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            function: { name: 'get_weather', arguments: '{"location":"London"}' },
          }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const result = extractOpenAiCompatibleResponse(res, standardModel);
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls![0].name).toBe('get_weather');
    expect(result.tool_calls![0].arguments).toEqual({ location: 'London' });
    expect(result.response).toBe('');
  });

  test('handles tool_calls with pre-parsed arguments object', () => {
    const res = {
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            function: { name: 'fn', arguments: { key: 'value' } },
          }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const result = extractOpenAiCompatibleResponse(res, standardModel);
    expect(result.tool_calls![0].arguments).toEqual({ key: 'value' });
  });

  test('returns fallback on thrown error', () => {
    const badRes = Object.defineProperty({}, 'choices', {
      get() { throw new Error('parse fail'); },
    });
    const result = extractOpenAiCompatibleResponse(badRes, standardModel);
    expect(result.response).toBe(' ');
    expect(result.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });

  test('returns fallback space when content is empty string', () => {
    const res = {
      choices: [{ message: { content: '' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const result = extractOpenAiCompatibleResponse(res, standardModel);
    expect(result.response).toBe(' ');
  });

  test('adjusts completion_tokens for non-reasoning model with reasoning content', () => {
    const res = {
      choices: [{
        message: {
          content: 'Short answer',
          reasoning_content: 'Long reasoning text here that inflates token count',
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
    };
    const result = extractOpenAiCompatibleResponse(res, standardModel);
    // For non-reasoning models, completion_tokens is recomputed from content only
    const expectedCompletionTokens = Math.max(1, Math.ceil('Short answer'.length / 4));
    expect(result.usage.completion_tokens).toBe(expectedCompletionTokens);
  });

  test('includes reasoning_content for non-reasoning models (stripping is builder responsibility)', () => {
    // The PARSER does NOT strip reasoning_content — it always includes it if present.
    // Stripping for non-reasoning models is done by buildOpenAIChatResponse.
    const res = {
      choices: [{
        message: {
          content: 'Answer',
          reasoning_content: 'Thinking...',
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const result = extractOpenAiCompatibleResponse(res, standardModel);
    // Parser passes reasoning_content through regardless of model type
    expect(result.reasoning_content).toBe('Thinking...');
  });
});

