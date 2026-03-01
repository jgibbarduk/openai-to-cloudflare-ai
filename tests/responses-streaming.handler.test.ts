/**
 * ============================================================================
 * RESPONSES-STREAMING HANDLER TESTS
 * ============================================================================
 *
 * Tests for handleResponsesApiStreaming.
 * Covers: event types emitted, content path, reasoning path,
 * tool-call path, error event, empty content fallback fix.
 */

import { handleResponsesApiStreaming } from '../src/handlers/responses-streaming.handler';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

/** Build a ReadableStream from a list of raw line strings. */
function makeStream(lines: string[]): ReadableStream {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l + '\n'));
      c.close();
    },
  });
}

/** Collect all SSE lines from a Response body. */
async function collectLines(res: Response): Promise<string[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const lines: string[] = [];
  let done = false;
  while (!done) {
    const { value, done: d } = await reader.read();
    done = d;
    if (value) {
      dec.decode(value).split('\n').forEach(l => { if (l.trim()) lines.push(l); });
    }
  }
  return lines;
}

/** Parse every `data:` line as JSON; skip `[DONE]`. */
function parseDataLines(lines: string[]): any[] {
  return lines
    .filter(l => l.startsWith('data: ') && !l.includes('[DONE]'))
    .map(l => JSON.parse(l.slice(6)));
}

/** Extract all `event:` type values in order. */
function eventTypes(lines: string[]): string[] {
  return lines.filter(l => l.startsWith('event: ')).map(l => l.slice(7));
}

// ─────────────────────────────────────────────────────────────
// Response headers
// ─────────────────────────────────────────────────────────────
describe('handleResponsesApiStreaming — headers', () => {
  test('Content-Type is text/event-stream', async () => {
    const res = await handleResponsesApiStreaming(makeStream([]), 'gpt-4');
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
  });

  test('Cache-Control is no-cache', async () => {
    const res = await handleResponsesApiStreaming(makeStream([]), 'gpt-4');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });
});

// ─────────────────────────────────────────────────────────────
// Event sequence — empty stream
// ─────────────────────────────────────────────────────────────
describe('handleResponsesApiStreaming — empty stream', () => {
  test('emits response.created and response.completed', async () => {
    const res = await handleResponsesApiStreaming(makeStream([]), 'gpt-4');
    const lines = await collectLines(res);
    const types = eventTypes(lines);
    expect(types).toContain('response.created');
    expect(types).toContain('response.completed');
  });

  test('response.created has status=in_progress', async () => {
    const res = await handleResponsesApiStreaming(makeStream([]), 'gpt-4');
    const lines = await collectLines(res);
    const created = lines.find(l => l.startsWith('event: response.created'));
    const idx = lines.indexOf(created!);
    const dataLine = lines[idx + 1];
    const data = JSON.parse(dataLine.slice(6));
    expect(data.response.status).toBe('in_progress');
  });

  test('response.completed has status=completed', async () => {
    const res = await handleResponsesApiStreaming(makeStream([]), 'gpt-4');
    const lines = await collectLines(res);
    const completedIdx = lines.findIndex(l => l === 'event: response.completed');
    const dataLine = lines[completedIdx + 1];
    const data = JSON.parse(dataLine.slice(6));
    expect(data.response.status).toBe('completed');
  });

  test('ends with event: done', async () => {
    const res = await handleResponsesApiStreaming(makeStream([]), 'gpt-4');
    const lines = await collectLines(res);
    const lastEvent = [...lines].reverse().find(l => l.startsWith('event: '));
    expect(lastEvent).toBe('event: done');
  });
});

// ─────────────────────────────────────────────────────────────
// Content streaming
// ─────────────────────────────────────────────────────────────
describe('handleResponsesApiStreaming — content path', () => {
  test('emits output_item.added for message', async () => {
    const res = await handleResponsesApiStreaming(
      makeStream(['{"response":"Hello world"}']),
      'gpt-4'
    );
    const lines = await collectLines(res);
    expect(eventTypes(lines)).toContain('response.output_item.added');
  });

  test('emits output_text.delta with the content', async () => {
    const res = await handleResponsesApiStreaming(
      makeStream(['{"response":"Hello world"}']),
      'gpt-4'
    );
    const lines = await collectLines(res);
    const deltaIdx = lines.findIndex(l => l === 'event: response.output_text.delta');
    expect(deltaIdx).toBeGreaterThan(-1);
    const deltaData = JSON.parse(lines[deltaIdx + 1].slice(6));
    expect(deltaData.delta).toBe('Hello world');
  });

  test('completed output contains full accumulated text', async () => {
    const res = await handleResponsesApiStreaming(
      makeStream(['{"response":"Part1"}', '{"response":" Part2"}']),
      'gpt-4'
    );
    const lines = await collectLines(res);
    const completedIdx = lines.findIndex(l => l === 'event: response.completed');
    const completedData = JSON.parse(lines[completedIdx + 1].slice(6));
    const msgItem = completedData.response.output.find((o: any) => o.type === 'message');
    const textItem = msgItem?.content?.find((c: any) => c.type === 'output_text');
    expect(textItem?.text).toBe('Part1 Part2');
  });

  test('handles SSE data: prefix format', async () => {
    const res = await handleResponsesApiStreaming(
      makeStream(['data: {"response":"SSE format"}']),
      'gpt-4'
    );
    const lines = await collectLines(res);
    const deltaIdx = lines.findIndex(l => l === 'event: response.output_text.delta');
    expect(deltaIdx).toBeGreaterThan(-1);
  });

  test('model in response.created matches provided model', async () => {
    const res = await handleResponsesApiStreaming(makeStream([]), 'my-test-model');
    const lines = await collectLines(res);
    const createdIdx = lines.findIndex(l => l === 'event: response.created');
    const data = JSON.parse(lines[createdIdx + 1].slice(6));
    expect(data.response.model).toBe('my-test-model');
  });
});

// ─────────────────────────────────────────────────────────────
// Reasoning content
// ─────────────────────────────────────────────────────────────
describe('handleResponsesApiStreaming — reasoning path', () => {
  test('emits output_item.added for reasoning before message', async () => {
    const res = await handleResponsesApiStreaming(
      makeStream(['{"reasoning_content":"Thinking...","response":"Answer"}']),
      'gpt-4'
    );
    const lines = await collectLines(res);
    const types = eventTypes(lines);
    expect(types).toContain('response.reasoning.delta');
    expect(types).toContain('response.output_item.added');
  });

  test('completed output includes reasoning item', async () => {
    const res = await handleResponsesApiStreaming(
      makeStream(['{"reasoning_content":"My thinking","response":"Final"}']),
      'gpt-4'
    );
    const lines = await collectLines(res);
    const completedIdx = lines.findIndex(l => l === 'event: response.completed');
    const data = JSON.parse(lines[completedIdx + 1].slice(6));
    const reasoningItem = data.response.output.find((o: any) => o.type === 'reasoning');
    expect(reasoningItem).toBeDefined();
    expect(reasoningItem.content[0].text).toBe('My thinking');
  });

  test('completed response includes reasoning field', async () => {
    const res = await handleResponsesApiStreaming(
      makeStream(['{"reasoning_content":"Deep thought","response":"Answer"}']),
      'gpt-4'
    );
    const lines = await collectLines(res);
    const completedIdx = lines.findIndex(l => l === 'event: response.completed');
    const data = JSON.parse(lines[completedIdx + 1].slice(6));
    expect(data.response.reasoning?.content).toBe('Deep thought');
  });
});

// ─────────────────────────────────────────────────────────────
// Tool-call path — empty text content fix
// ─────────────────────────────────────────────────────────────
describe('handleResponsesApiStreaming — tool-call content fix', () => {
  test('message text is empty string (not space) for pure tool-call response', async () => {
    const toolChunk = JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{ index: 0, id: 'call_1', function: { name: 'fn', arguments: '{"x":1}' } }],
        },
      }],
    });
    const res = await handleResponsesApiStreaming(makeStream([toolChunk]), 'gpt-4');
    const lines = await collectLines(res);
    const completedIdx = lines.findIndex(l => l === 'event: response.completed');
    const data = JSON.parse(lines[completedIdx + 1].slice(6));
    const msgItem = data.response.output.find((o: any) => o.type === 'message');
    const textItem = msgItem?.content?.find((c: any) => c.type === 'output_text');
    // Fixed: should be empty string, not ' ' for tool-call-only responses
    expect(textItem?.text).toBe('');
  });

  test('tool_calls added to message item in completed output', async () => {
    const toolChunk = JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"test"}' } }],
        },
      }],
    });
    const res = await handleResponsesApiStreaming(makeStream([toolChunk]), 'gpt-4');
    const lines = await collectLines(res);
    const completedIdx = lines.findIndex(l => l === 'event: response.completed');
    const data = JSON.parse(lines[completedIdx + 1].slice(6));
    const msgItem = data.response.output.find((o: any) => o.type === 'message');
    expect(msgItem.tool_calls).toHaveLength(1);
    expect(msgItem.tool_calls[0].function.name).toBe('search');
  });

  test('emits function_call_arguments.delta for tool call', async () => {
    const toolChunk = JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{ index: 0, id: 'call_1', function: { name: 'fn', arguments: '{"x":' } }],
        },
      }],
    });
    const res = await handleResponsesApiStreaming(makeStream([toolChunk]), 'gpt-4');
    const lines = await collectLines(res);
    expect(eventTypes(lines)).toContain('response.function_call_arguments.delta');
  });
});

// ─────────────────────────────────────────────────────────────
// Error path
// ─────────────────────────────────────────────────────────────
describe('handleResponsesApiStreaming — error path', () => {
  test('emits error event when stream throws', async () => {
    const failingStream = new ReadableStream({
      start(c) { c.error(new Error('Stream broken')); },
    });
    const res = await handleResponsesApiStreaming(failingStream, 'gpt-4');
    const lines = await collectLines(res);
    expect(eventTypes(lines)).toContain('error');
    const errIdx = lines.findIndex(l => l === 'event: error');
    const errData = JSON.parse(lines[errIdx + 1].slice(6));
    expect(errData.error.message).toContain('Stream broken');
  });
});

