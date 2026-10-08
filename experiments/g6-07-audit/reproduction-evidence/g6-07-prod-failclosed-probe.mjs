/**
 * G6-07 B-EXEC fail-closed probe.
 *
 * Independent audit script. Spawns the actual gateway entrypoint as a child
 * process with GENESIS_EXECUTION_MODE=production and NO provider env vars
 * set, then verifies the gateway fails closed (exit code 1, FATAL on stderr).
 *
 * This reproduces the contract from tests/gateway/execution-mode.test.ts but
 * as a standalone audit probe (no test runner dependency).
 *
 * Outputs JSON to stdout and a human-readable transcript to stderr.
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';

const REPO_ROOT = '/home/z/my-project/audit-work/AgentCraft-Genesis';
const MAIN_PATH = path.join(REPO_ROOT, 'src', 'gateway', 'main.ts');

// Random high ports to avoid any conflict with stale processes.
const HTTP_PORT = 18090;
const A2A_PORT = 18091;
const HTTP_HOST = '127.0.0.1';
const A2A_HOST = '127.0.0.1';

const API_KEYS = JSON.stringify({
  'audit-probe-key': {
    callerId: 'audit-probe-caller',
    allowedOperations: ['mission:submit'],
    maxActiveMissions: 5,
    maxMissionTimeoutMs: 60_000,
  },
});

// Critical: production mode with NO provider env vars. The gateway MUST
// fail closed. We also explicitly NULL out any inherited GENESIS_* / ZAI_*
// / OPENBOT_* env vars so the probe is deterministic regardless of the
// sandbox in which it runs.
const env = {
  ...process.env,
  GENESIS_EXECUTION_MODE: 'production',
  GENESIS_HTTP_HOST: HTTP_HOST,
  GENESIS_HTTP_PORT: String(HTTP_PORT),
  GENESIS_A2A_HOST: A2A_HOST,
  GENESIS_A2A_PORT: String(A2A_PORT),
  GENESIS_A2A_BASE_URL: `http://${A2A_HOST}:${A2A_PORT}`,
  GENESIS_API_KEYS: API_KEYS,
  // Strip provider env vars to force fail-closed.
  GENESIS_REASONING_PROVIDER: '',
  GENESIS_RUNTIME_PROVIDER: '',
  ZAI_API_KEY: '',
  ZAI_SDK_PATH: '',
  OPENBOT_ENDPOINT: '',
  OPENBOT_CHECKOUT_DIR: '',
  OPENBOT_ROOT_DIR: '',
};

const child = spawn('npx', ['tsx', MAIN_PATH], {
  cwd: REPO_ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const stderrChunks = [];
const stdoutChunks = [];
child.stdout.on('data', (c) => stdoutChunks.push(c));
child.stderr.on('data', (c) => stderrChunks.push(c));

const TIMEOUT_MS = 15_000;
const exitCode = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    resolve(-1);
  }, TIMEOUT_MS);
  child.on('exit', (code) => {
    clearTimeout(timer);
    resolve(code ?? 0);
  });
  child.on('error', (err) => {
    clearTimeout(timer);
    resolve(-2);
    console.error('spawn error:', err);
  });
});

const stderr = Buffer.concat(stderrChunks).toString('utf8');
const stdout = Buffer.concat(stdoutChunks).toString('utf8');

const hasFatal = stderr.includes('FATAL');
const mentionsProduction = stderr.includes('production');
const mentionsProvider =
  stderr.includes('REASONING_PROVIDER') ||
  stderr.includes('RUNTIME_PROVIDER');
const refusedToStart = exitCode === 1;
const didNotListen = !stderr.includes('HTTP API listening');

const PASS =
  refusedToStart && hasFatal && mentionsProduction && mentionsProvider && didNotListen;

const result = {
  probe: 'g6-07-prod-failclosed',
  exitCode,
  refusedToStart,
  hasFatal,
  mentionsProduction,
  mentionsProvider,
  didNotListen,
  pass: PASS,
  stderr,
  stdout,
};

console.log(JSON.stringify(result, null, 2));
process.exit(PASS ? 0 : 1);
