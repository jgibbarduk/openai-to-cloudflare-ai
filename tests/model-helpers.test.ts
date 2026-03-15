import { listAIModels, getCfModelName } from '../src/model-helpers';

const fakeEnv: any = { DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8' };

describe('model-helpers', () => {
  test('includes qwen embedding model', async () => {
    const models = await listAIModels(fakeEnv);
    const found = models.find(m => m.id === '@cf/qwen/qwen3-embedding-0.6b' || m.name === '@cf/qwen/qwen3-embedding-0.6b');
    expect(found).toBeDefined();
    expect(found?.taskName).toBe('Text Embeddings');
  });

  // ─── NVIDIA Nemotron 3 Super ───────────────────────────────────────────────

  test('includes nemotron model in model list', async () => {
    const models = await listAIModels(fakeEnv);
    const found = models.find(m => m.name === '@cf/nvidia/nemotron-3-120b-a12b');
    expect(found).toBeDefined();
    expect(found?.taskName).toBe('Text Generation');
    expect(found?.inUse).toBe(true);
  });

  test('nemotron model description mentions tool use', async () => {
    const models = await listAIModels(fakeEnv);
    const found = models.find(m => m.name === '@cf/nvidia/nemotron-3-120b-a12b');
    expect(found?.description).toMatch(/tool/i);
  });

  test('"nemotron" alias resolves to nemotron model', () => {
    expect(getCfModelName('nemotron', fakeEnv)).toBe('@cf/nvidia/nemotron-3-120b-a12b');
  });

  test('full @cf/nvidia/nemotron-3-120b-a12b name passes through unchanged', () => {
    expect(getCfModelName('@cf/nvidia/nemotron-3-120b-a12b', fakeEnv))
      .toBe('@cf/nvidia/nemotron-3-120b-a12b');
  });
});

