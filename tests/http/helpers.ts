/**
 * Shared helpers for HTTP integration tests.
 *
 * Tests call a real running worker. The base URL is set by globalSetup into
 * process.env.INTEGRATION_WORKER_URL, or falls back to localhost:8788.
 *
 * Authentication:
 *   - Set API_KEY in your .env or environment to run auth-required tests.
 *   - Tests that require auth are skipped if API_KEY is not set.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env so API_KEY is available whether running standalone or via globalSetup
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

export const WORKER_URL =
  process.env.INTEGRATION_WORKER_URL ??
  process.env.WORKER_URL ??
  'http://localhost:8788';

export const API_KEY = process.env.API_KEY ?? '';

export function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
  };
}

export async function post(
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; body: unknown; text: string }> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: { ...authHeaders(), ...extraHeaders },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

export async function get(
  path: string,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; body: unknown; text: string }> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    headers: { ...authHeaders(), ...extraHeaders },
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

/** Skips the test if no API_KEY is configured. */
export function requireApiKey(): void {
  if (!API_KEY) {
    // jest's skip inside a test
    // eslint-disable-next-line jest/no-standalone-expect
    pending('Skipped: API_KEY not set');
  }
}

/** Read raw streaming body as text (collects up to maxBytes). */
export async function getRawStream(
  path: string,
  body: unknown,
  maxBytes = 4096
): Promise<string> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  reader.cancel();
  return Buffer.concat(chunks).toString('utf8');
}
