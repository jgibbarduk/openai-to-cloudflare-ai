import { validateAndNormalizeRequest, transformChatCompletionRequest } from '../src/transformers/request.transformer';
import type { Env } from '../src/types';

const mockEnv = { DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8' } as unknown as Env;

describe('request.transformer safeguards', () => {
  test('truncates too many messages and long message content, and limits tools', () => {
    // Build 200 messages with very long content
    const messages = Array.from({ length: 200 }).map((_, i) => ({ role: 'user', content: 'x'.repeat(20000) + i }));

    const req: any = {
      model: 'gpt-4',
      messages,
      tools: Array.from({ length: 20 }).map((_, i) => ({ name: `tool${i}`, description: 'desc' }))
    };

    const normalized = validateAndNormalizeRequest(req, mockEnv);
    const transformed = transformChatCompletionRequest(normalized, mockEnv as Env);
    const transformedAny: any = transformed;
    const opts: any = transformedAny.options;

    // Ensure messages trimmed to the cap of 100
    expect(opts.messages.length).toBeLessThanOrEqual(100);

    // Ensure each message content capped to 16000 characters
    for (const m of opts.messages) {
      expect(m.content.length).toBeLessThanOrEqual(16000);
    }

    // Ensure tools limited to 64 mapped tools max
    if (opts.tools) {
      expect(opts.tools.length).toBeLessThanOrEqual(64);
    }
  });

  test('applies default temperature and converts input arrays', () => {
    const req: any = { input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }] };
    const normalized = validateAndNormalizeRequest(req, mockEnv);
    expect(normalized.temperature).toBe(0.7);
    expect(normalized.messages.length).toBe(1);
    expect(normalized.messages[0].content).toContain('hello');
  });

  test('replaces oversized tool message image data with success summary', () => {
    const largeB64 = 'A'.repeat(500000);
    const toolContent = JSON.stringify({
      b64_json: largeB64,
      revised_prompt: 'a majestic dragon'
    });
    const req: any = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'make me an image' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'image_generation', arguments: '{}' } }] },
        { role: 'tool', content: toolContent, tool_call_id: 'tc1' }
      ]
    };

    const normalized = validateAndNormalizeRequest(req, mockEnv);
    const toolMsg = normalized.messages.find((m: any) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    // Content should be a short summary, not the raw base64
    expect(toolMsg!.content.length).toBeLessThan(500);
    expect(toolMsg!.content).toContain('Image generation succeeded');
    expect(toolMsg!.content).toContain('a majestic dragon');
  });
});
