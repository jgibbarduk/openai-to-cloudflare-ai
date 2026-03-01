console.log('[TEST] loading request.transformer.message-order.test.ts');
import { validateAndNormalizeRequest, transformChatCompletionRequest } from '../src/transformers/request.transformer';
import type { Env } from '../src/types';

const fakeEnv = {
  DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
  AI: {} as any,
  CACHE: {} as any,
  CF_API_KEY: undefined,
  CF_ACCOUNT_ID: undefined
} as unknown as Env;

describe('request.transformer message ordering and null content handling', () => {
  test('preserves message order and follow-ups', () => {
    const req: any = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'user', content: 'follow-up' }
      ]
    };

    const validated = validateAndNormalizeRequest(req, fakeEnv);
    const { options } = transformChatCompletionRequest(validated, fakeEnv);

    const contents = (options as any).messages.map((m: any) => m.content);
    expect(contents).toEqual(['first', 'follow-up']);
  });

  test('preserves assistant messages with null content and keeps order', () => {
    const req: any = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: null },
        { role: 'user', content: 'follow-up' }
      ]
    };

    const validated = validateAndNormalizeRequest(req, fakeEnv);
    const { options } = transformChatCompletionRequest(validated, fakeEnv);

    const contents = (options as any).messages.map((m: any) => m.content);
    expect(contents).toEqual(['hello', '', 'follow-up']);
  });
});
