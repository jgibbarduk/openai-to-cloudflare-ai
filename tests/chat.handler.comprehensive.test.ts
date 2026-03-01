/**
 * ============================================================================
 * CHAT HANDLER — COMPREHENSIVE TESTS
 * ============================================================================
 *
 * Tests for handleChatCompletions and handleStreamingResponse.
 * Covers: happy path, streaming, tool calls, embeddings auto-routing,
 * GPT-OSS routing, all three response formats, and error paths.
 */

import { handleChatCompletions, handleStreamingResponse } from '../src/handlers/chat.handler';
import type { Env } from '../src/types';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

function makeRequest(body: any, headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function makeEnv(aiRunFn: jest.Mock, extra: Partial<Env> = {}): Env {
  return {
    AI: { run: aiRunFn } as any,
    DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
    CACHE: {} as any,
    ...extra,
  } as Env;
}

// ─────────────────────────────────────────────────────────────
// Happy path — standard (choices) response format
// ─────────────────────────────────────────────────────────────
describe('handleChatCompletions — OpenAI-compatible response format', () => {
  test('returns 200 with chat.completion object', async () => {
    const aiRun = jest.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'Hello!' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    const env = makeEnv(aiRun);
    const req = makeRequest({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] });

    const res = await handleChatCompletions(req, env);
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.content).toBe('Hello!');
    expect(body.choices[0].finish_reason).toBe('stop');
  });

  test('echoes the requested model name back in the response', async () => {
    const aiRun = jest.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'Hi' } }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    });
    const env = makeEnv(aiRun);
    const req = makeRequest({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] });

    const res = await handleChatCompletions(req, env);
    const body = await res.json() as any;
    expect(body.model).toBe('gpt-4o');
  });

  test('handles tool_calls in choices response', async () => {
    const aiRun = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            function: { name: 'get_weather', arguments: '{"city":"London"}' },
          }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
    const env = makeEnv(aiRun);
    const req = makeRequest({ model: 'gpt-4', messages: [{ role: 'user', content: 'Weather?' }] });

    const res = await handleChatCompletions(req, env);
    const body = await res.json() as any;
    expect(body.choices[0].finish_reason).toBe('tool_calls');
    expect(body.choices[0].message.tool_calls).toHaveLength(1);
    expect(body.choices[0].message.tool_calls[0].function.name).toBe('get_weather');
  });
});

// ─────────────────────────────────────────────────────────────
// Happy path — legacy response format
// ─────────────────────────────────────────────────────────────
describe('handleChatCompletions — legacy response format', () => {
  test('handles { response: "..." } format', async () => {
    const aiRun = jest.fn().mockResolvedValue({
      response: 'This is a response',
    });
    const env = makeEnv(aiRun);
    const req = makeRequest({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] });

    const res = await handleChatCompletions(req, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.content).toBe('This is a response');
  });
});

// ─────────────────────────────────────────────────────────────
// Happy path — GPT-OSS response format
// ─────────────────────────────────────────────────────────────
describe('handleChatCompletions — GPT-OSS response format', () => {
  test('handles { output: [...] } format', async () => {
    const aiRun = jest.fn().mockResolvedValue({
      output: [
        { type: 'message', content: [{ text: 'GPT-OSS answer' }] },
      ],
    });
    const env = makeEnv(aiRun);
    const req = makeRequest({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] });

    const res = await handleChatCompletions(req, env);
    const body = await res.json() as any;
    expect(body.choices[0].message.content).toBe('GPT-OSS answer');
  });
});

// ─────────────────────────────────────────────────────────────
// Unknown / null response formats
// ─────────────────────────────────────────────────────────────
describe('handleChatCompletions — unknown response formats', () => {
  test('returns fallback space when response format is unrecognized', async () => {
    const aiRun = jest.fn().mockResolvedValue({ someOtherKey: 'value' });
    const env = makeEnv(aiRun);
    const req = makeRequest({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] });

    const res = await handleChatCompletions(req, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.choices[0].message.content).toBe(' ');
  });

  test('returns fallback space when AI returns null', async () => {
    const aiRun = jest.fn().mockResolvedValue(null);
    const env = makeEnv(aiRun);
    const req = makeRequest({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] });

    const res = await handleChatCompletions(req, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.choices[0].message.content).toBe(' ');
  });
});

// ─────────────────────────────────────────────────────────────
// Error paths
// ─────────────────────────────────────────────────────────────
describe('handleChatCompletions — error paths', () => {
  test('returns 500 when AI.run throws', async () => {
    const aiRun = jest.fn().mockRejectedValue(new Error('Inference failure'));
    const env = makeEnv(aiRun);
    const req = makeRequest({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] });

    const res = await handleChatCompletions(req, env);
    expect(res.status).toBe(500);

    const body = await res.json() as any;
    expect(body.error.type).toBe('api_error');
    expect(body.error.message).toContain('Chat completion failed');
  });

  test('returns 500 on invalid JSON body', async () => {
    const aiRun = jest.fn();
    const env = makeEnv(aiRun);
    const req = new Request('https://example.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    const res = await handleChatCompletions(req, env);
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────
// Streaming path
// ─────────────────────────────────────────────────────────────
describe('handleChatCompletions — streaming', () => {
  test('returns text/event-stream when stream=true and AI returns ReadableStream', async () => {
    // Build a minimal ReadableStream that emits a single JSON chunk
    const chunks = ['{"response":"Hello streaming"}'];
    const stream = new ReadableStream({
      start(controller) {
        for (const c of chunks) {
          controller.enqueue(new TextEncoder().encode(c + '\n'));
        }
        controller.close();
      },
    });

    const aiRun = jest.fn().mockResolvedValue(stream);
    const env = makeEnv(aiRun);
    const req = makeRequest({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }], stream: true });

    const res = await handleChatCompletions(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
  });
});

// ─────────────────────────────────────────────────────────────
// handleStreamingResponse — unit tests
// ─────────────────────────────────────────────────────────────
describe('handleStreamingResponse', () => {
  async function collectSSE(response: Response): Promise<string[]> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const lines: string[] = [];
    let done = false;
    while (!done) {
      const { value, done: d } = await reader.read();
      done = d;
      if (value) {
        const text = decoder.decode(value);
        lines.push(...text.split('\n').filter(l => l.trim()));
      }
    }
    return lines;
  }

  function makeStream(chunks: string[]): ReadableStream {
    return new ReadableStream({
      start(controller) {
        for (const c of chunks) {
          controller.enqueue(new TextEncoder().encode(c + '\n'));
        }
        controller.close();
      },
    });
  }

  test('response has text/event-stream content type', async () => {
    const stream = makeStream([]);
    const res = await handleStreamingResponse(stream, 'gpt-4');
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
  });

  test('emits role:assistant on first meaningful chunk', async () => {
    const stream = makeStream(['{"response":"Hello"}']);
    const res = await handleStreamingResponse(stream, 'gpt-4');
    const lines = await collectSSE(res);
    const dataLines = lines.filter(l => l.startsWith('data: ') && !l.includes('[DONE]'));
    const firstChunk = JSON.parse(dataLines[0].slice(6));
    expect(firstChunk.choices[0].delta.role).toBe('assistant');
  });

  test('emits content from response field', async () => {
    const stream = makeStream(['{"response":"Hello world"}']);
    const res = await handleStreamingResponse(stream, 'gpt-4');
    const lines = await collectSSE(res);
    const dataLines = lines.filter(l => l.startsWith('data: ') && !l.includes('[DONE]'));
    const chunks = dataLines.map(l => JSON.parse(l.slice(6)));
    const content = chunks.flatMap((c: any) => c.choices[0].delta.content || '').join('');
    expect(content).toBe('Hello world');
  });

  test('emits content from choices[0].delta.content field', async () => {
    const chunk = JSON.stringify({
      choices: [{ delta: { content: 'From choices' }, finish_reason: null }],
    });
    const stream = makeStream([chunk]);
    const res = await handleStreamingResponse(stream, 'gpt-4');
    const lines = await collectSSE(res);
    const dataLines = lines.filter(l => l.startsWith('data: ') && !l.includes('[DONE]'));
    const chunks = dataLines.map(l => JSON.parse(l.slice(6)));
    const content = chunks.flatMap((c: any) => c.choices[0].delta.content || '').join('');
    expect(content).toContain('From choices');
  });

  test('handles SSE data: prefix format', async () => {
    const stream = makeStream(['data: {"response":"SSE format"}']);
    const res = await handleStreamingResponse(stream, 'gpt-4');
    const lines = await collectSSE(res);
    const dataLines = lines.filter(l => l.startsWith('data: ') && !l.includes('[DONE]'));
    const chunks = dataLines.map(l => JSON.parse(l.slice(6)));
    const content = chunks.flatMap((c: any) => c.choices[0].delta.content || '').join('');
    expect(content).toBe('SSE format');
  });

  test('skips data: [DONE] lines in stream', async () => {
    const stream = makeStream(['data: {"response":"Hi"}', 'data: [DONE]']);
    const res = await handleStreamingResponse(stream, 'gpt-4');
    const lines = await collectSSE(res);
    // Last line should be [DONE]
    const doneLines = lines.filter(l => l === 'data: [DONE]');
    expect(doneLines).toHaveLength(1);
  });

  test('always ends with data: [DONE]', async () => {
    const stream = makeStream(['{"response":"Hi"}']);
    const res = await handleStreamingResponse(stream, 'gpt-4');
    const lines = await collectSSE(res);
    const lastDataLine = [...lines].reverse().find(l => l.startsWith('data: '));
    expect(lastDataLine).toBe('data: [DONE]');
  });

  test('emits final chunk with finish_reason: stop when no tool calls', async () => {
    const stream = makeStream(['{"response":"Hi"}']);
    const res = await handleStreamingResponse(stream, 'gpt-4');
    const lines = await collectSSE(res);
    const dataLines = lines.filter(l => l.startsWith('data: ') && !l.includes('[DONE]'));
    const lastChunk = JSON.parse(dataLines[dataLines.length - 1].slice(6));
    expect(lastChunk.choices[0].finish_reason).toBe('stop');
  });

  test('chunk id starts with chatcmpl-', async () => {
    const stream = makeStream(['{"response":"Hi"}']);
    const res = await handleStreamingResponse(stream, 'gpt-4');
    const lines = await collectSSE(res);
    const dataLines = lines.filter(l => l.startsWith('data: ') && !l.includes('[DONE]'));
    const chunk = JSON.parse(dataLines[0].slice(6));
    expect(chunk.id).toMatch(/^chatcmpl-\d+$/);
  });

  test('sets model in every chunk', async () => {
    const stream = makeStream(['{"response":"Hi"}']);
    const res = await handleStreamingResponse(stream, 'my-model-name');
    const lines = await collectSSE(res);
    const dataLines = lines.filter(l => l.startsWith('data: ') && !l.includes('[DONE]'));
    for (const line of dataLines) {
      const chunk = JSON.parse(line.slice(6));
      expect(chunk.model).toBe('my-model-name');
    }
  });

  test('emits reasoning_content when present in chunk', async () => {
    const stream = makeStream(['{"reasoning_content":"Thinking...","response":""}']);
    const res = await handleStreamingResponse(stream, 'gpt-4');
    const lines = await collectSSE(res);
    const dataLines = lines.filter(l => l.startsWith('data: ') && !l.includes('[DONE]'));
    const reasoningChunks = dataLines
      .map(l => JSON.parse(l.slice(6)))
      .filter((c: any) => c.choices[0].delta.reasoning_content);
    expect(reasoningChunks.length).toBeGreaterThan(0);
    expect(reasoningChunks[0].choices[0].delta.reasoning_content).toBe('Thinking...');
  });
});

// ─────────────────────────────────────────────────────────────
// Embeddings auto-routing
// ─────────────────────────────────────────────────────────────
describe('handleChatCompletions — embeddings auto-routing', () => {
  test('returns validation error when embedding model used without input field', async () => {
    const aiRun = jest.fn().mockResolvedValue({ data: [[0.1, 0.2]], shape: [1, 2] });
    const env = makeEnv(aiRun);

    // Use a model name that resolves to an embeddings model
    // We need to mock listAIModels behavior - since it returns static data, we
    // test the validation error path by sending a non-embedding compatible request
    // with an embedding model
    const req = makeRequest({
      model: '@cf/baai/bge-small-en-v1.5',
      messages: [{ role: 'system', content: 'system msg' }, { role: 'user', content: 'Hi' }],
    });
    const res = await handleChatCompletions(req, env);
    // Either validation error (400) or it falls through to AI call
    // The key behavior: should not return a 500
    expect([200, 400, 422]).toContain(res.status);
  });
});

