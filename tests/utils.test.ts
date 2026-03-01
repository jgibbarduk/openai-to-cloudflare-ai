/**
 * ============================================================================
 * UTILS TESTS
 * ============================================================================
 *
 * Behavioral lock-down for all utility functions:
 * generateUUID, mapTemperatureToCloudflare, mapTools,
 * getModelMaxTokens, floatArrayToBase64, safeByteLength, safeStringify
 */

import {
  generateUUID,
  mapTemperatureToCloudflare,
  mapTools,
  getModelMaxTokens,
  floatArrayToBase64,
  safeByteLength,
  safeStringify,
} from '../src/utils';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

// ─────────────────────────────────────────────────────────────
// generateUUID
// ─────────────────────────────────────────────────────────────
describe('generateUUID', () => {
  test('returns a UUID v4 format string', () => {
    const id = generateUUID();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test('returns unique values on each call', () => {
    const a = generateUUID();
    const b = generateUUID();
    expect(a).not.toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────
// mapTemperatureToCloudflare
// ─────────────────────────────────────────────────────────────
describe('mapTemperatureToCloudflare', () => {
  test('passes through mid-range value unchanged', () => {
    expect(mapTemperatureToCloudflare(0.7)).toBe(0.7);
    expect(mapTemperatureToCloudflare(1.0)).toBe(1.0);
  });

  test('clamps below 0 to 0', () => {
    expect(mapTemperatureToCloudflare(-0.5)).toBe(0);
  });

  test('clamps above 2 to 2', () => {
    expect(mapTemperatureToCloudflare(3.0)).toBe(2);
    expect(mapTemperatureToCloudflare(100)).toBe(2);
  });

  test('returns 0 for exactly 0', () => {
    expect(mapTemperatureToCloudflare(0)).toBe(0);
  });

  test('returns 2 for exactly 2', () => {
    expect(mapTemperatureToCloudflare(2)).toBe(2);
  });

  test('returns undefined for undefined input', () => {
    expect(mapTemperatureToCloudflare(undefined)).toBeUndefined();
  });

  test('returns undefined for null input', () => {
    expect(mapTemperatureToCloudflare(null as any)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// mapTools
// ─────────────────────────────────────────────────────────────
describe('mapTools', () => {
  test('returns empty array for undefined', () => {
    expect(mapTools(undefined as any)).toEqual([]);
  });

  test('returns empty array for null', () => {
    expect(mapTools(null as any)).toEqual([]);
  });

  test('returns empty array for empty array', () => {
    expect(mapTools([])).toEqual([]);
  });

  test('maps function tool to Cloudflare format', () => {
    const tool = {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get weather info',
        parameters: {
          type: 'object',
          properties: { location: { type: 'string' } },
        },
      },
    };
    const result = mapTools([tool]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('function');
    expect(result[0].function.name).toBe('get_weather');
    expect(result[0].function.description).toBe('Get weather info');
    expect(result[0].function.parameters.type).toBe('object');
  });

  test('uses empty string defaults for missing name/description', () => {
    const tool = { type: 'function', function: {} };
    const result = mapTools([tool]);
    expect(result[0].function.name).toBe('');
    expect(result[0].function.description).toBe('');
  });

  test('uses default empty parameters when parameters missing', () => {
    const tool = { type: 'function', function: { name: 'fn', description: 'desc' } };
    const result = mapTools([tool]);
    expect(result[0].function.parameters).toEqual({ type: 'object', properties: {} });
  });

  test('passes through non-function type tools unchanged', () => {
    const tool = { type: 'custom', data: 'value' };
    const result = mapTools([tool as any]);
    expect(result[0]).toEqual(tool);
  });

  test('handles multiple tools', () => {
    const tools = [
      { type: 'function', function: { name: 'fn1', description: 'a' } },
      { type: 'function', function: { name: 'fn2', description: 'b' } },
    ];
    const result = mapTools(tools);
    expect(result).toHaveLength(2);
    expect(result[0].function.name).toBe('fn1');
    expect(result[1].function.name).toBe('fn2');
  });
});

// ─────────────────────────────────────────────────────────────
// getModelMaxTokens
// ─────────────────────────────────────────────────────────────
describe('getModelMaxTokens', () => {
  test('returns 4096 for unknown model (default)', () => {
    expect(getModelMaxTokens('unknown-model-xyz')).toBe(4096);
  });

  test('returns a number for a known model', () => {
    const result = getModelMaxTokens('@cf/qwen/qwen3-30b-a3b-fp8');
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  test('returns a number for hermes model', () => {
    const result = getModelMaxTokens('@hf/nousresearch/hermes-2-pro-mistral-7b');
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// floatArrayToBase64
// ─────────────────────────────────────────────────────────────
describe('floatArrayToBase64', () => {
  test('returns a base64 string for a float array', () => {
    const arr = [0.1, 0.2, 0.3];
    const result = floatArrayToBase64(arr);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('produces deterministic output for the same input', () => {
    const arr = [1.0, 2.0, 3.0];
    expect(floatArrayToBase64(arr)).toBe(floatArrayToBase64(arr));
  });

  test('returns empty string or minimal output for empty array', () => {
    const result = floatArrayToBase64([]);
    expect(typeof result).toBe('string');
  });

  test('output is valid base64 characters', () => {
    const result = floatArrayToBase64([0.5, 1.5]);
    // Base64 alphabet: A-Z a-z 0-9 + / =
    expect(result).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

// ─────────────────────────────────────────────────────────────
// safeByteLength
// ─────────────────────────────────────────────────────────────
describe('safeByteLength', () => {
  test('returns byte length of ASCII string', () => {
    expect(safeByteLength('hello')).toBe(5);
  });

  test('returns 0 for empty string', () => {
    expect(safeByteLength('')).toBe(0);
  });

  test('counts multi-byte UTF-8 characters correctly', () => {
    // Euro sign € is 3 bytes in UTF-8
    const bytes = safeByteLength('€');
    expect(bytes).toBe(3);
  });

  test('handles non-string input gracefully (returns 0 or number)', () => {
    const result = safeByteLength(null as any);
    expect(typeof result).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────
// safeStringify
// ─────────────────────────────────────────────────────────────
describe('safeStringify', () => {
  test('stringifies a plain object (pretty-printed with 2-space indent)', () => {
    const result = safeStringify({ a: 1, b: 'hello' });
    // safeStringify uses JSON.stringify(..., 2) — pretty-printed output
    expect(result).toContain('"a"');
    expect(result).toContain('"b"');
    expect(result).toContain('"hello"');
    expect(JSON.parse(result)).toEqual({ a: 1, b: 'hello' });
  });

  test('stringifies nested objects', () => {
    const result = safeStringify({ a: { b: 2 } });
    expect(JSON.parse(result)).toEqual({ a: { b: 2 } });
  });

  test('handles circular references gracefully (returns string)', () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    const result = safeStringify(obj);
    expect(typeof result).toBe('string');
  });

  test('respects maxLength option by truncating', () => {
    const big = 'x'.repeat(10000);
    const result = safeStringify({ data: big }, { maxLength: 100 });
    // Output is truncated to maxLength + "...[truncated]" suffix (14 chars)
    expect(result.length).toBeLessThanOrEqual(115);
    expect(result).toContain('[truncated]');
  });

  test('returns string for primitive values', () => {
    expect(typeof safeStringify(42 as any)).toBe('string');
    expect(typeof safeStringify(null as any)).toBe('string');
  });
});

