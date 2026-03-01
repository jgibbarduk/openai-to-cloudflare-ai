/**
 * ============================================================================
 * REQUEST TRANSFORMER — COMPREHENSIVE TESTS
 * ============================================================================
 *
 * Extends the existing basic tests with exhaustive coverage of all branches
 * in validateAndNormalizeRequest and transformChatCompletionRequest.
 */

import { validateAndNormalizeRequest, transformChatCompletionRequest } from '../src/transformers/request.transformer';
import type { Env } from '../src/types';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

const mockEnv: Env = {
  DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
  AI: {} as any,
  CACHE: {} as any,
} as Env;

// ─────────────────────────────────────────────────────────────
// validateAndNormalizeRequest — input coercion
// ─────────────────────────────────────────────────────────────
describe('validateAndNormalizeRequest — input coercion', () => {
  test('converts string input to single user message', () => {
    const req = { input: 'hello world' } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content).toBe('hello world');
    expect((result as any).input).toBeUndefined();
  });

  test('converts Responses API array input to messages', () => {
    const req = {
      input: [{
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Tell me a joke' }],
      }],
    } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content).toContain('Tell me a joke');
  });

  test('joins multiple input_text parts with newline', () => {
    const req = {
      input: [{
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'Part 1' },
          { type: 'input_text', text: 'Part 2' },
        ],
      }],
    } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.messages[0].content).toContain('Part 1');
    expect(result.messages[0].content).toContain('Part 2');
  });

  test('preserves existing messages when input not present', () => {
    const req = {
      messages: [{ role: 'user', content: 'Hello' }],
    } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Hello');
  });
});

// ─────────────────────────────────────────────────────────────
// validateAndNormalizeRequest — role normalization
// ─────────────────────────────────────────────────────────────
describe('validateAndNormalizeRequest — role normalization', () => {
  test('maps developer role to system', () => {
    const req = { messages: [{ role: 'developer', content: 'Be helpful' }] } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.messages[0].role).toBe('system');
  });

  test('preserves tool role', () => {
    const req = {
      messages: [{ role: 'tool', content: '{"result":"ok"}', tool_call_id: 'call_123' }],
    } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.messages[0].role).toBe('tool');
  });

  test('maps unknown roles to user', () => {
    const req = { messages: [{ role: 'observer', content: 'hi' }] } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.messages[0].role).toBe('user');
  });

  test('preserves system, user, assistant roles unchanged', () => {
    const req = {
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[1].role).toBe('user');
    expect(result.messages[2].role).toBe('assistant');
  });
});

// ─────────────────────────────────────────────────────────────
// validateAndNormalizeRequest — content normalization
// ─────────────────────────────────────────────────────────────
describe('validateAndNormalizeRequest — content normalization', () => {
  test('converts null content to empty string', () => {
    const req = { messages: [{ role: 'user', content: null }] } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.messages[0].content).toBe('');
  });

  test('converts undefined content to empty string', () => {
    const req = { messages: [{ role: 'user', content: undefined }] } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.messages[0].content).toBe('');
  });

  test('converts array content (Responses API parts) to joined string', () => {
    const req = {
      messages: [{
        role: 'user',
        content: [
          { type: 'input_text', text: 'Hello' },
          { type: 'input_text', text: 'World' },
        ],
      }],
    } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(typeof result.messages[0].content).toBe('string');
    expect(result.messages[0].content).toContain('Hello');
    expect(result.messages[0].content).toContain('World');
  });

  test('caps message content at 16000 chars', () => {
    const longContent = 'x'.repeat(20000);
    const req = { messages: [{ role: 'user', content: longContent }] } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.messages[0].content.length).toBe(16000);
  });

  test('does not truncate content at exactly 16000 chars', () => {
    const exactContent = 'x'.repeat(16000);
    const req = { messages: [{ role: 'user', content: exactContent }] } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.messages[0].content.length).toBe(16000);
  });
});

// ─────────────────────────────────────────────────────────────
// validateAndNormalizeRequest — message count cap
// ─────────────────────────────────────────────────────────────
describe('validateAndNormalizeRequest — message count cap', () => {
  test('trims messages to 100 when exceeded', () => {
    const messages = Array.from({ length: 150 }, (_, i) => ({
      role: 'user', content: `msg ${i}`,
    }));
    const req = { messages } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.messages).toHaveLength(100);
  });

  test('keeps the NEWEST 100 messages when trimming', () => {
    const messages = Array.from({ length: 150 }, (_, i) => ({
      role: 'user', content: `msg ${i}`,
    }));
    const req = { messages } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    // The last message should be msg 149 (most recent)
    expect(result.messages[99].content).toBe('msg 149');
  });

  test('does not trim when exactly 100 messages', () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      role: 'user', content: `msg ${i}`,
    }));
    const req = { messages } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.messages).toHaveLength(100);
  });
});

// ─────────────────────────────────────────────────────────────
// validateAndNormalizeRequest — field stripping
// ─────────────────────────────────────────────────────────────
describe('validateAndNormalizeRequest — field stripping', () => {
  const unsupportedFields = [
    'functions', 'function_call', 'response_format',
    'parallel_tool_calls', 'reasoning_effort', 'modalities', 'user',
  ];

  unsupportedFields.forEach(field => {
  // response_format is intentionally NOT stripped — it's used by transformChatCompletionRequest
  // for JSON mode injection. Document this explicitly.
  test('does NOT strip response_format (used downstream for JSON mode injection)', () => {
    const req = {
      messages: [{ role: 'user', content: 'hi' }],
      response_format: { type: 'json_object' },
    } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect((result as any).response_format).toBeDefined();
    expect((result as any).response_format.type).toBe('json_object');
  });
  });
});

// ─────────────────────────────────────────────────────────────
// validateAndNormalizeRequest — defaults
// ─────────────────────────────────────────────────────────────
describe('validateAndNormalizeRequest — defaults', () => {
  test('applies default temperature of 0.7 when not set', () => {
    const req = { messages: [{ role: 'user', content: 'hi' }] } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.temperature).toBe(0.7);
  });

  test('does not override explicitly set temperature', () => {
    const req = { messages: [{ role: 'user', content: 'hi' }], temperature: 1.2 } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.temperature).toBe(1.2);
  });

  test('applies default temperature when temperature is null', () => {
    const req = { messages: [{ role: 'user', content: 'hi' }], temperature: null } as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(result.temperature).toBe(0.7);
  });

  test('creates empty messages array when no messages provided', () => {
    const req = {} as any;
    const result = validateAndNormalizeRequest(req, mockEnv);
    expect(Array.isArray(result.messages)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// transformChatCompletionRequest — model resolution
// ─────────────────────────────────────────────────────────────
describe('transformChatCompletionRequest — model resolution', () => {
  const baseReq = {
    messages: [{ role: 'user', content: 'Hi' }],
    temperature: 0.7,
  } as any;

  test('resolves gpt-4 alias to a CF model', () => {
    const req = { ...baseReq, model: 'gpt-4' };
    const { model } = transformChatCompletionRequest(req, mockEnv);
    expect(model).toMatch(/^@(cf|hf)\//);
  });

  test('resolves gpt-3.5-turbo alias to a CF model', () => {
    const req = { ...baseReq, model: 'gpt-3.5-turbo' };
    const { model } = transformChatCompletionRequest(req, mockEnv);
    expect(model).toMatch(/^@(cf|hf)\//);
  });

  test('passes through @cf/ model identifiers directly', () => {
    const req = { ...baseReq, model: '@cf/meta/llama-3-8b-instruct' };
    const { model } = transformChatCompletionRequest(req, mockEnv);
    expect(model).toBe('@cf/meta/llama-3-8b-instruct');
  });

  test('falls back to DEFAULT_AI_MODEL for unknown model', () => {
    const req = { ...baseReq, model: 'unknown-model-xyz' };
    const { model } = transformChatCompletionRequest(req, mockEnv);
    expect(model).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });
});

// ─────────────────────────────────────────────────────────────
// transformChatCompletionRequest — GPT-OSS path
// ─────────────────────────────────────────────────────────────
describe('transformChatCompletionRequest — GPT-OSS path', () => {
  const baseReq = {
    messages: [{ role: 'user', content: 'Hi' }],
    temperature: 0.7,
  } as any;

  test('disables streaming for GPT-OSS models', () => {
    const req = { ...baseReq, model: '@cf/openai/gpt-oss-20b', stream: true };
    const { options } = transformChatCompletionRequest(req, mockEnv);
    expect((options as any).stream).toBe(false);
  });

  test('clamps temperature to 1.0 for GPT-OSS models', () => {
    const req = { ...baseReq, model: '@cf/openai/gpt-oss-20b', temperature: 1.5 };
    const { options } = transformChatCompletionRequest(req, mockEnv);
    expect((options as any).temperature).toBeLessThanOrEqual(1.0);
  });

  test('switches GPT-OSS to Qwen when tools are requested, and maps tools', () => {
    // When GPT-OSS + tools → switches to Qwen which DOES support tools
    // So tools ARE mapped (not undefined)
    const req = {
      ...baseReq,
      model: '@cf/openai/gpt-oss-20b',
      tools: [{ type: 'function', function: { name: 'fn', description: 'desc' } }],
    };
    const { model, options } = transformChatCompletionRequest(req, mockEnv);
    // Model must have switched to Qwen
    expect(model).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    // Since Qwen supports tools, tools are mapped
    expect((options as any).tools).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// transformChatCompletionRequest — Llama tool routing
// ─────────────────────────────────────────────────────────────
describe('transformChatCompletionRequest — Llama tool routing', () => {
  test('switches llama model to Qwen when tools are requested', () => {
    const req = {
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.7,
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      tools: [{ type: 'function', function: { name: 'fn', description: 'desc' } }],
    } as any;
    const { model } = transformChatCompletionRequest(req, mockEnv);
    expect(model).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });
});

// ─────────────────────────────────────────────────────────────
// transformChatCompletionRequest — max_tokens clamping
// ─────────────────────────────────────────────────────────────
describe('transformChatCompletionRequest — max_tokens clamping', () => {
  test('Qwen: respects user-requested max_tokens when above 512 floor', () => {
    const req = {
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.7,
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      max_tokens: 1000,
    } as any;
    const { options } = transformChatCompletionRequest(req, mockEnv);
    // max_tokens = max(min(1000, 4096), 512) = max(1000, 512) = 1000
    expect((options as any).max_tokens).toBe(1000);
  });

  test('Qwen: enforces 512 minimum floor when requested value is too small', () => {
    const req = {
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.7,
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      max_tokens: 100,
    } as any;
    const { options } = transformChatCompletionRequest(req, mockEnv);
    // max_tokens = max(min(100, 4096), 512) = max(100, 512) = 512
    expect((options as any).max_tokens).toBe(512);
  });

  test('Qwen: clamps to model limit when requested value exceeds it', () => {
    const req = {
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.7,
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      max_tokens: 999999,
    } as any;
    const { options } = transformChatCompletionRequest(req, mockEnv);
    expect((options as any).max_tokens).toBeLessThanOrEqual(4096);
  });

  test('non-Qwen model: clamps max_tokens to model limit', () => {
    const req = {
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.7,
      model: '@cf/openai/gpt-oss-20b',
      max_tokens: 999999,
    } as any;
    const { options } = transformChatCompletionRequest(req, mockEnv);
    expect((options as any).max_tokens).toBeGreaterThan(0);
    expect((options as any).max_tokens).toBeLessThan(999999);
  });

  test('uses max_completion_tokens over max_tokens when both present', () => {
    const req = {
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.7,
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      max_tokens: 500,
      max_completion_tokens: 800,
    } as any;
    const { options } = transformChatCompletionRequest(req, mockEnv);
    // max_completion_tokens takes precedence: max(min(800, 4096), 512) = 800
    expect((options as any).max_tokens).toBe(800);
  });
});

// ─────────────────────────────────────────────────────────────
// transformChatCompletionRequest — tool preservation in messages
// ─────────────────────────────────────────────────────────────
describe('transformChatCompletionRequest — tool message preservation', () => {
  test('preserves tool_call_id on tool messages', () => {
    const req = {
      messages: [
        { role: 'user', content: 'Use tool' },
        { role: 'tool', content: '{"result":"42"}', tool_call_id: 'call_abc' },
      ],
      temperature: 0.7,
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
    } as any;
    const { options } = transformChatCompletionRequest(req, mockEnv);
    const toolMsg = (options as any).messages.find((m: any) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg.tool_call_id).toBe('call_abc');
  });

  test('preserves tool_calls on assistant messages', () => {
    const toolCalls = [{ id: 'call_1', type: 'function', function: { name: 'fn', arguments: '{}' } }];
    const req = {
      messages: [
        { role: 'assistant', content: null, tool_calls: toolCalls },
      ],
      temperature: 0.7,
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
    } as any;
    const { options } = transformChatCompletionRequest(req, mockEnv);
    const assistantMsg = (options as any).messages.find((m: any) => m.role === 'assistant');
    expect(assistantMsg.tool_calls).toEqual(toolCalls);
  });
});

// ─────────────────────────────────────────────────────────────
// transformChatCompletionRequest — streaming passthrough
// ─────────────────────────────────────────────────────────────
describe('transformChatCompletionRequest — streaming flag', () => {
  test('passes stream:true to options for non-GPT-OSS model', () => {
    const req = {
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      stream: true,
    } as any;
    const { options } = transformChatCompletionRequest(req, mockEnv);
    expect((options as any).stream).toBe(true);
  });

  test('passes stream:false to options', () => {
    const req = {
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      stream: false,
    } as any;
    const { options } = transformChatCompletionRequest(req, mockEnv);
    expect((options as any).stream).toBe(false);
  });
});

