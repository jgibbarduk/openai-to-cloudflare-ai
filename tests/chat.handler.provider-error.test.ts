import { handleChatCompletions } from '../src/handlers/chat.handler';
import type { Env } from '../src/types';

function makeRequest(body: any) {
  return new Request('https://example.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('chat handler provider error logging', () => {
  test('logs provider error body and returns 500', async () => {
    // Spy on console methods
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Mock env with AI.run throwing an error that contains a response.text() method
    const providerError = {
      message: 'Provider internal error',
      response: {
        text: async () => '{"error":"3030: Internal Server Error","message":"provider failed"}'
      }
    } as any;

    const fakeEnv: Partial<Env> = {
      AI: {
        run: jest.fn().mockRejectedValue(providerError)
      } as any,
      DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
      CACHE: {} as any,
      CF_API_KEY: undefined,
      CF_ACCOUNT_ID: undefined
    };

    const req = makeRequest({ model: 'gpt-4', messages: [{ role: 'user', content: 'hello' }] });

    const res = await handleChatCompletions(req, fakeEnv as Env);

    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(500);

    const body = JSON.parse(await res.text());
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('message');
    expect(body.error.message).toContain('Chat completion failed');

    // Ensure we logged provider error and its preview
    const calls = errSpy.mock.calls.flat().join(' ');
    expect(calls).toMatch(/\[Chat\]\[PROVIDER\] Call threw an exception/);
    expect(calls).toMatch(/3030: Internal Server Error/);

    // Restore spies
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

