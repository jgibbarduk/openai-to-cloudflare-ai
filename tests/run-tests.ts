import assert from 'assert';
import { listAIModels } from '../src/model-helpers';
import { handleEmbeddings } from '../src/handlers/embeddings.handler';
import type { Env } from '../src/types';

async function testModelHelpers() {
  const fakeEnv: any = { DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8' };
  const models = await listAIModels(fakeEnv);
  const found = models.find(m => m.id === '@cf/qwen/qwen3-embedding-0.6b' || m.name === '@cf/qwen/qwen3-embedding-0.6b');
  assert(found, 'Qwen embedding model not found in listAIModels');
  assert.strictEqual(found!.taskName, 'Text Embeddings');
  console.log('testModelHelpers: PASS');
}

async function testEmbeddingsHandler() {
  const fakeEnv: Partial<Env> = {
    AI: {
      run: async (model: string, options: any) => {
        // Ensure model and options shape are correct
        if (model !== '@cf/qwen/qwen3-embedding-0.6b') {
          throw new Error('unexpected model passed to AI.run: ' + model);
        }
        if (!options || !Array.isArray(options.text)) {
          throw new Error('unexpected embedding options shape');
        }
        return { data: [[0.1, 0.2, 0.3]] } as any;
      }
    } as any,
    DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
    CACHE: {} as any,
    CF_API_KEY: undefined,
    CF_ACCOUNT_ID: undefined
  };

  const req = new Request('https://example.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: '@cf/qwen/qwen3-embedding-0.6b', input: 'hello world', encoding_format: 'float' })
  });

  const res = await handleEmbeddings(req, fakeEnv as Env);
  const text = await res.text();
  const json = JSON.parse(text);

  assert.strictEqual(json.object, 'list');
  assert.ok(Array.isArray(json.data));
  assert.strictEqual(json.data[0].object, 'embedding');
  assert.deepStrictEqual(json.data[0].embedding, [0.1, 0.2, 0.3]);
  assert.strictEqual(json.model, '@cf/qwen/qwen3-embedding-0.6b');

  console.log('testEmbeddingsHandler: PASS');
}

(async () => {
  try {
    await testModelHelpers();
    await testEmbeddingsHandler();
    console.log('\nALL TESTS PASSED');
    process.exit(0);
  } catch (err) {
    console.error('TEST FAILURE:', err);
    process.exit(1);
  }
})();
