/**
 * ============================================================================
 * RESPONSES HANDLER TESTS
 * ============================================================================
 *
 * Behavioral lock-down for handleResponses.
 * Covers: input formats (input_items, messages, input string/array),
 * all three AI response formats, streaming, validation errors, and error paths.
 */

import { handleResponses } from '../src/handlers/responses.handler';
import type { Env } from '../src/types';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

function makeRequest(body: any): Request {
  return new Request('https://example.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeEnv(aiRun: jest.Mock): Env {
  return {
    AI: { run: aiRun } as any,
    DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
    CACHE: {} as any,
  } as Env;
}

const standardAiResponse = {
  choices: [{ message: { role: 'assistant', content: 'Hello from Responses API' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

// ─────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────
describe('handleResponses — validation', () => {
  test('returns 400 when model is missing', async () => {
    const env = makeEnv(jest.fn());
    const res = await handleResponses(makeRequest({ input: 'hello' }), env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error.param).toBe('model');
  });

  test('returns 400 when no input source provided', async () => {
    const env = makeEnv(jest.fn());
    const res = await handleResponses(makeRequest({ model: 'gpt-4' }), env);
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────
// Input formats
// ─────────────────────────────────────────────────────────────
describe('handleResponses — input formats', () => {
  test('accepts input as a string', async () => {
    const aiRun = jest.fn().mockResolvedValue(standardAiResponse);
    const env = makeEnv(aiRun);
    const res = await handleResponses(makeRequest({ model: 'gpt-4', input: 'Hello' }), env);
    expect(res.status).toBe(200);
    expect(aiRun).toHaveBeenCalledTimes(1);
  });

  test('accepts input as an array of Responses API items', async () => {
    const aiRun = jest.fn().mockResolvedValue(standardAiResponse);
    const env = makeEnv(aiRun);
    const res = await handleResponses(makeRequest({
      model: 'gpt-4',
      input: [{
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Hello' }],
      }],
    }), env);
    expect(res.status).toBe(200);
  });

  test('accepts messages array directly', async () => {
    const aiRun = jest.fn().mockResolvedValue(standardAiResponse);
    const env = makeEnv(aiRun);
    const res = await handleResponses(makeRequest({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    }), env);
    expect(res.status).toBe(200);
  });

  test('accepts input_items array', async () => {
    const aiRun = jest.fn().mockResolvedValue(standardAiResponse);
    const env = makeEnv(aiRun);
    const res = await handleResponses(makeRequest({
      model: 'gpt-4',
      input_items: [{
        type: 'message',
        role: 'user',
        content: 'Hi there',
      }],
    }), env);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────
// Response format — Responses API shape
// ─────────────────────────────────────────────────────────────
describe('handleResponses — Responses API format', () => {
  test('returns Responses API format (object = "response")', async () => {
    const aiRun = jest.fn().mockResolvedValue(standardAiResponse);
    const env = makeEnv(aiRun);
    const res = await handleResponses(makeRequest({ model: 'gpt-4', input: 'Hi' }), env);
    const body = await res.json() as any;
    expect(body.object).toBe('response');
    expect(body.status).toBe('completed');
  });

  test('output contains message item with text', async () => {
    const aiRun = jest.fn().mockResolvedValue(standardAiResponse);
    const env = makeEnv(aiRun);
    const res = await handleResponses(makeRequest({ model: 'gpt-4', input: 'Hi' }), env);
    const body = await res.json() as any;
    const msgItem = body.output.find((o: any) => o.type === 'message');
    expect(msgItem).toBeDefined();
    const textContent = msgItem.content.find((c: any) => c.type === 'output_text');
    expect(textContent.text).toBe('Hello from Responses API');
  });

  test('echoes the requested model name', async () => {
    const aiRun = jest.fn().mockResolvedValue(standardAiResponse);
    const env = makeEnv(aiRun);
    const res = await handleResponses(makeRequest({ model: 'gpt-4o', input: 'Hi' }), env);
    const body = await res.json() as any;
    expect(body.model).toBe('gpt-4o');
  });

  test('includes usage in Responses API shape', async () => {
    const aiRun = jest.fn().mockResolvedValue(standardAiResponse);
    const env = makeEnv(aiRun);
    const res = await handleResponses(makeRequest({ model: 'gpt-4', input: 'Hi' }), env);
    const body = await res.json() as any;
    expect(body.usage.input_tokens).toBe(10);
    expect(body.usage.output_tokens).toBe(5);
    expect(body.usage.total_tokens).toBe(15);
  });

  test('respects temperature from request', async () => {
    const aiRun = jest.fn().mockResolvedValue(standardAiResponse);
    const env = makeEnv(aiRun);
    const res = await handleResponses(
      makeRequest({ model: 'gpt-4', input: 'Hi', temperature: 0.3 }),
      env
    );
    const body = await res.json() as any;
    expect(body.temperature).toBe(0.3);
  });

  test('handles legacy { response: "..." } AI format', async () => {
    const aiRun = jest.fn().mockResolvedValue({ response: 'Legacy answer' });
    const env = makeEnv(aiRun);
    const res = await handleResponses(makeRequest({ model: 'gpt-4', input: 'Hi' }), env);
    const body = await res.json() as any;
    expect(body.object).toBe('response');
    const msgItem = body.output.find((o: any) => o.type === 'message');
    const textContent = msgItem?.content?.find((c: any) => c.type === 'output_text');
    expect(textContent?.text).toBe('Legacy answer');
  });

  test('handles GPT-OSS { output: [...] } AI format', async () => {
    const aiRun = jest.fn().mockResolvedValue({
      output: [{ type: 'message', content: [{ text: 'GPT-OSS via Responses' }] }],
    });
    const env = makeEnv(aiRun);
    const res = await handleResponses(makeRequest({ model: 'gpt-4', input: 'Hi' }), env);
    const body = await res.json() as any;
    expect(body.object).toBe('response');
  });
});

// ─────────────────────────────────────────────────────────────
// Streaming path
// ─────────────────────────────────────────────────────────────
describe('handleResponses — streaming', () => {
  test('returns text/event-stream when stream=true and AI returns ReadableStream', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"response":"Hi"}\n'));
        controller.close();
      },
    });
    const aiRun = jest.fn().mockResolvedValue(stream);
    const env = makeEnv(aiRun);
    const res = await handleResponses(
      makeRequest({ model: 'gpt-4', input: 'Hi', stream: true }),
      env
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
  });
});

// ─────────────────────────────────────────────────────────────
// Error paths
// ─────────────────────────────────────────────────────────────
describe('handleResponses — error paths', () => {
  test('returns 500 when AI.run throws', async () => {
    const aiRun = jest.fn().mockRejectedValue(new Error('Provider down'));
    const env = makeEnv(aiRun);
    const res = await handleResponses(makeRequest({ model: 'gpt-4', input: 'Hi' }), env);
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.error.type).toBe('api_error');
  });

  test('returns 500 on invalid JSON body', async () => {
    const env = makeEnv(jest.fn());
    const req = new Request('https://example.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad-json',
    });
    const res = await handleResponses(req, env);
    expect(res.status).toBe(500);
  });
});

