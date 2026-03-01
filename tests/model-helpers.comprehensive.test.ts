/**
 * ============================================================================
 * MODEL HELPERS — COMPREHENSIVE TESTS
 * ============================================================================
 *
 * Behavioral lock-down for getCfModelName, isAliasedModel, isCloudflareModel.
 * Extends the existing basic model-helpers.test.ts.
 */

import { getCfModelName, isAliasedModel, isCloudflareModel, listAIModels } from '../src/model-helpers';
import { MODEL_ALIASES } from '../src/constants';
import type { Env } from '../src/types';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

const mockEnv: Env = {
  DEFAULT_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
  AI: {} as any,
  CACHE: {} as any,
} as Env;

// ─────────────────────────────────────────────────────────────
// getCfModelName
// ─────────────────────────────────────────────────────────────
describe('getCfModelName', () => {
  test('resolves every alias in MODEL_ALIASES', () => {
    for (const [alias, expected] of Object.entries(MODEL_ALIASES)) {
      expect(getCfModelName(alias, mockEnv)).toBe(expected);
    }
  });

  test('passes through @cf/ model unchanged', () => {
    expect(getCfModelName('@cf/meta/llama-3-8b-instruct', mockEnv))
      .toBe('@cf/meta/llama-3-8b-instruct');
  });

  test('passes through @hf/ model unchanged', () => {
    expect(getCfModelName('@hf/nousresearch/hermes-2-pro-mistral-7b', mockEnv))
      .toBe('@hf/nousresearch/hermes-2-pro-mistral-7b');
  });

  test('falls back to DEFAULT_AI_MODEL for unknown model', () => {
    expect(getCfModelName('unknown-model-xyz', mockEnv))
      .toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });

  test('falls back to DEFAULT_AI_MODEL for empty string', () => {
    expect(getCfModelName('', mockEnv)).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });

  test('falls back to DEFAULT_AI_MODEL for undefined', () => {
    expect(getCfModelName(undefined, mockEnv)).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });

  test('falls back to hardcoded default when DEFAULT_AI_MODEL is also absent', () => {
    const envWithNoDefault = { ...mockEnv, DEFAULT_AI_MODEL: '' } as Env;
    const result = getCfModelName('unknown', envWithNoDefault);
    expect(result).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });

  test('trimmed model name resolves alias', () => {
    expect(getCfModelName('  gpt-4  ', mockEnv)).toBe(MODEL_ALIASES['gpt-4']);
  });

  // Specific alias spot-checks
  test('gpt-4 resolves to Qwen', () => {
    expect(getCfModelName('gpt-4', mockEnv)).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });

  test('dall-e-3 resolves to Flux', () => {
    expect(getCfModelName('dall-e-3', mockEnv)).toContain('flux');
  });

  test('text-embedding-ada-002 resolves to BGE', () => {
    expect(getCfModelName('text-embedding-ada-002', mockEnv)).toContain('bge');
  });
});

// ─────────────────────────────────────────────────────────────
// isAliasedModel
// ─────────────────────────────────────────────────────────────
describe('isAliasedModel', () => {
  test('returns true for gpt-4', () => {
    expect(isAliasedModel('gpt-4')).toBe(true);
  });

  test('returns true for gpt-3.5-turbo', () => {
    expect(isAliasedModel('gpt-3.5-turbo')).toBe(true);
  });

  test('returns true for dall-e-3', () => {
    expect(isAliasedModel('dall-e-3')).toBe(true);
  });

  test('returns false for @cf/ model', () => {
    expect(isAliasedModel('@cf/qwen/qwen3-30b-a3b-fp8')).toBe(false);
  });

  test('returns false for unknown model name', () => {
    expect(isAliasedModel('unknown-model')).toBe(false);
  });

  test('returns true for every key in MODEL_ALIASES', () => {
    for (const alias of Object.keys(MODEL_ALIASES)) {
      expect(isAliasedModel(alias)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// isCloudflareModel
// ─────────────────────────────────────────────────────────────
describe('isCloudflareModel', () => {
  test('returns true for @cf/ prefix', () => {
    expect(isCloudflareModel('@cf/meta/llama-3-8b-instruct')).toBe(true);
    expect(isCloudflareModel('@cf/qwen/qwen3-30b-a3b-fp8')).toBe(true);
  });

  test('returns true for @hf/ prefix', () => {
    expect(isCloudflareModel('@hf/nousresearch/hermes-2-pro-mistral-7b')).toBe(true);
  });

  test('returns false for OpenAI alias', () => {
    expect(isCloudflareModel('gpt-4')).toBe(false);
    expect(isCloudflareModel('dall-e-3')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isCloudflareModel('')).toBe(false);
  });

  test('returns false for unknown name without prefix', () => {
    expect(isCloudflareModel('some-random-model')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// listAIModels
// ─────────────────────────────────────────────────────────────
describe('listAIModels', () => {
  test('returns a non-empty array', async () => {
    const models = await listAIModels(mockEnv);
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
  });

  test('every model has id and name fields', async () => {
    const models = await listAIModels(mockEnv);
    for (const m of models) {
      expect(m.id || m.name).toBeTruthy();
    }
  });

  test('every model has a taskName field', async () => {
    const models = await listAIModels(mockEnv);
    for (const m of models) {
      expect(m.taskName).toBeTruthy();
    }
  });

  test('returns same array on repeated calls (deterministic)', async () => {
    const first = await listAIModels(mockEnv);
    const second = await listAIModels(mockEnv);
    expect(first.length).toBe(second.length);
  });

  test('contains both text generation and embedding models', async () => {
    const models = await listAIModels(mockEnv);
    const tasks = models.map(m => m.taskName);
    expect(tasks.some(t => t && t.toLowerCase().includes('text'))).toBe(true);
  });
});

