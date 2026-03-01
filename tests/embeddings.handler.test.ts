import { handleEmbeddings } from '../src/handlers/embeddings.handler';
import type { Env } from '../src/types';

function makeRequest(body: any) {
  return new Request('https://example.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('embeddings handler', () => {
  test('generates embeddings for qwen embedding model', async () => {
    // Mock env with AI.run
    const fakeEnv: Partial<Env> = {
      AI: {
        run: jest.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] })
      } as any,
      DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
      CACHE: {} as any,
      CF_API_KEY: undefined,
      CF_ACCOUNT_ID: undefined
    };

    const req = makeRequest({ model: '@cf/qwen/qwen3-embedding-0.6b', input: 'hello world', encoding_format: 'float' });

    const res = await handleEmbeddings(req, fakeEnv as Env);
    expect(res).toBeInstanceOf(Response);
    const json = JSON.parse(await res.text());

    expect(json).toHaveProperty('object', 'list');
    expect(json).toHaveProperty('data');
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data[0]).toHaveProperty('object', 'embedding');
    expect(json.data[0]).toHaveProperty('embedding');
    expect(json.data[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(json.model).toBe('@cf/qwen/qwen3-embedding-0.6b');
  });
});

