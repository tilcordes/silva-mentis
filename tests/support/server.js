// Starts PHP's built-in server for the end-to-end and browser tests: a free port, a fresh data
// folder below tests/.tmp, and the mode the test asks for.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

export const PROJECT_ROOT = resolve(import.meta.dirname, '../..');
export const TMP = join(PROJECT_ROOT, 'tests/.tmp');

/** A TCP port nobody is using right now. */
export function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
    server.on('error', reject);
  });
}

function phpBinary() {
  if (process.env.PHP) return process.env.PHP;
  const local = join(PROJECT_ROOT, '.dev/bin/php');
  return existsSync(local) ? local : 'php';
}

/**
 * @param {{mode?: 'normal'|'test'}} [options]
 * @returns {Promise<{url: string, dataDir: string, output: () => string, stop: () => Promise<void>}>}
 */
export async function startServer({ mode = 'normal' } = {}) {
  const port = await freePort();
  const dataDir = mkdtempSync(join(TMP, `server-${mode}-`));
  let output = '';
  const child = spawn(phpBinary(), ['-S', `localhost:${port}`, '-t', join(PROJECT_ROOT, 'public')], {
    env: { ...process.env, SILVA_MENTIS_MODE: mode, SILVA_MENTIS_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(`${url}/api.php?route=status`, { headers: { 'X-Silva-Mentis': '1' } });
      if (response.ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return {
    url,
    dataDir,
    output: () => output,
    stop: async () => {
      child.kill();
      await new Promise((r) => child.once('exit', r));
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
