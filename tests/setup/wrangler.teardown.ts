import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PID_FILE = path.join(os.tmpdir(), 'wrangler-integration-test.pid');

export default async function globalTeardown(): Promise<void> {
  if (process.env.WORKER_URL) return;

  let pid: number | undefined;
  try {
    pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
  } catch {
    return; // no PID file — nothing to kill
  }

  if (!isNaN(pid)) {
    console.log(`\n[integration] Stopping wrangler dev (pgid ${pid})...`);
    // Kill the entire process group spawned by wrangler
    try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
    await new Promise(resolve => setTimeout(resolve, 3000));
    try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
  }

  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
}
