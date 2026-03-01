import { listAIModels } from '../src/model-helpers';

describe('model-helpers', () => {
  test('includes qwen embedding model', async () => {
    const fakeEnv: any = { DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8' };
    const models = await listAIModels(fakeEnv);
    const found = models.find(m => m.id === '@cf/qwen/qwen3-embedding-0.6b' || m.name === '@cf/qwen/qwen3-embedding-0.6b');
    expect(found).toBeDefined();
    expect(found?.taskName).toBe('Text Embeddings');
  });
});

