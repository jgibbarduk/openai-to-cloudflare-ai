/**
 * Jest globalSetup: starts `wrangler dev` and waits for it to be ready.
 *
 * Wrangler 4.x automatically uses remote AI bindings even in local dev mode,
 * so no --remote flag is needed (and --remote causes a zone lookup error from
 * the [dev] host entry in wrangler.toml).
 *
 * Set WORKER_URL to skip starting wrangler and point at an existing instance:
 *   WORKER_URL=https://... jest --config=jest.integration.config.cjs
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';

const PORT = 8788;
const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1000;
export const PID_FILE = path.join(os.tmpdir(), 'wrangler-integration-test.pid');
export const WORKER_BASE_URL = `http://localhost:${PORT}`;

// Load .env so API_KEY is available
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function waitForWorker(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Worker at ${url} did not become ready within ${timeoutMs}ms`);
}

export default async function globalSetup(): Promise<void> {
  if (process.env.WORKER_URL) {
    process.env.INTEGRATION_WORKER_URL = process.env.WORKER_URL;
    console.log(`\n[integration] Using external worker: ${process.env.WORKER_URL}`);
    return;
  }

  process.env.INTEGRATION_WORKER_URL = WORKER_BASE_URL;

  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error('API_KEY not set — add it to .env');

  // Plain `wrangler dev` — AI binding is automatically remote in wrangler 4.x
  // Pass API_KEY via --var so the auth middleware runs in enforcing mode.
  const args = [
    'wrangler', 'dev',
    '--port', String(PORT),
    '--ip', '127.0.0.1',
    '--var', `API_KEY:${apiKey}`,
    'src/index.ts',
  ];

  console.log(`\n[integration] Starting wrangler dev on port ${PORT}...`);

  const proc = spawn('npx', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
    detached: true,
  });

  proc.stdout?.on('data', (d: Buffer) => {
    if (process.env.WRANGLER_LOG) process.stdout.write(`[wrangler] ${d}`);
  });
  proc.stderr?.on('data', (d: Buffer) => {
    if (process.env.WRANGLER_LOG) process.stderr.write(`[wrangler] ${d}`);
  });

  if (!proc.pid) throw new Error('Failed to spawn wrangler process');

  // Persist PID so globalTeardown (different process) can kill it
  fs.writeFileSync(PID_FILE, String(proc.pid), 'utf8');

  await waitForWorker(WORKER_BASE_URL, READY_TIMEOUT_MS);
  console.log(`[integration] Worker ready at ${WORKER_BASE_URL}`);
}
