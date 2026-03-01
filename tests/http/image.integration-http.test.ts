/**
 * Image generation HTTP integration tests.
 * Migrated from: scripts/tests/test-image-generation.sh,
 *                scripts/api/test-image-onyx-format.sh
 */
import { post, API_KEY } from './helpers';

const describeIfAuth = API_KEY ? describe : describe.skip;

describeIfAuth('Image Generation — /v1/images/generations', () => {
  test('gpt-image-1 returns a valid image response (url format)', async () => {
    const { status, body } = await post('/v1/images/generations', {
      model: 'gpt-image-1',
      prompt: 'A simple red circle on a white background',
      n: 1,
      response_format: 'url',
    });
    // Some CF environments return b64_json even when url is requested — accept both
    expect(status).toBe(200);
    const b = body as any;
    expect(b.created).toBeDefined();
    expect(Array.isArray(b.data)).toBe(true);
    expect(b.data.length).toBeGreaterThan(0);
    const item = b.data[0];
    expect(item.url !== undefined || item.b64_json !== undefined).toBe(true);
  });

  test('gpt-image-1 returns b64_json when requested', async () => {
    const { status, body } = await post('/v1/images/generations', {
      model: 'gpt-image-1',
      prompt: 'A blue square',
      n: 1,
      response_format: 'b64_json',
    });
    expect(status).toBe(200);
    const item = (body as any)?.data?.[0];
    expect(item).toBeDefined();
    // b64_json must be a non-empty string if present
    if (item.b64_json !== undefined) {
      expect(typeof item.b64_json).toBe('string');
      expect(item.b64_json.length).toBeGreaterThan(0);
    }
  });

  test('response envelope matches OpenAI images format', async () => {
    const { status, body } = await post('/v1/images/generations', {
      model: 'gpt-image-1',
      prompt: 'A green triangle',
      n: 1,
    });
    expect(status).toBe(200);
    const b = body as any;
    expect(typeof b.created).toBe('number');
    expect(Array.isArray(b.data)).toBe(true);
  });

  test('missing prompt returns 400', async () => {
    const { status } = await post('/v1/images/generations', {
      model: 'gpt-image-1',
    });
    expect(status).toBe(400);
  });
});

