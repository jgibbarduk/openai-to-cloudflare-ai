/**
 * Embeddings HTTP integration tests.
 * Migrated from: scripts/api/embeddings.sh
 */
import { post, API_KEY } from './helpers';

const describeIfAuth = API_KEY ? describe : describe.skip;

describeIfAuth('Embeddings — /v1/embeddings', () => {
  const MODEL = '@cf/baai/bge-base-en-v1.5';

  test('single string input returns embedding vector', async () => {
    const { status, body } = await post('/v1/embeddings', {
      model: MODEL,
      input: 'Hello, world!',
    });
    expect(status).toBe(200);
    const b = body as any;
    expect(b.object).toBe('list');
    expect(Array.isArray(b.data)).toBe(true);
    expect(b.data[0].object).toBe('embedding');
    expect(Array.isArray(b.data[0].embedding)).toBe(true);
    expect(b.data[0].embedding.length).toBeGreaterThan(0);
  });

  test('array batch input returns multiple embeddings', async () => {
    const { status, body } = await post('/v1/embeddings', {
      model: MODEL,
      input: ['Hello', 'World', 'Test'],
    });
    expect(status).toBe(200);
    expect((body as any).data.length).toBe(3);
  });

  test('base64 encoding_format is accepted', async () => {
    const { status } = await post('/v1/embeddings', {
      model: MODEL,
      input: 'test',
      encoding_format: 'base64',
    });
    // base64 format may or may not be supported; must not be a 5xx error
    expect(status).toBeLessThan(500);
  });

  test('missing input field returns 400', async () => {
    const { status } = await post('/v1/embeddings', {
      model: MODEL,
    });
    expect(status).toBe(400);
  });

  test('response includes usage object', async () => {
    const { status, body } = await post('/v1/embeddings', {
      model: MODEL,
      input: 'usage test',
    });
    expect(status).toBe(200);
    expect((body as any).usage).toBeDefined();
    expect(typeof (body as any).usage.prompt_tokens).toBe('number');
  });
});

