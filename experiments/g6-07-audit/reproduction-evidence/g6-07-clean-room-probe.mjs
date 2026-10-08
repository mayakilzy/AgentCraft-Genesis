/**
 * G6-07 B-GATEWAY clean-room probe.
 *
 * Independent audit script. Spawns the actual gateway entrypoint as a
 * child process, then drives /health and the agent card endpoint with
 * TIGHT deadlines (10ms, 50ms, 100ms, 250ms, 500ms, 1000ms, 2000ms,
 * 5000ms) so we can see exactly when the HTTP server starts accepting
 * connections relative to the readiness log line on stderr.
 *
 * Outputs JSON to stdout and a human-readable transcript to stderr.
 */
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = '/home/z/my-project/audit-work/AgentCraft-Genesis';
const MAIN_PATH = path.join(REPO_ROOT, 'src', 'gateway', 'main.ts');

// Random high ports to avoid any conflict with stale processes.
const HTTP_PORT = 18080;
const A2A_PORT = 18081;
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

const env = {
  ...process.env,
  GENESIS_EXECUTION_MODE: 'development',
  GENESIS_HTTP_HOST: HTTP_HOST,
  GENESIS_HTTP_PORT: String(HTTP_PORT),
  GENESIS_A2A_HOST: A2A_HOST,
  GENESIS_A2A_PORT: String(A2A_PORT),
  GENESIS_A2A_BASE_URL: `http://${A2A_HOST}:${A2A_PORT}`,
  GENESIS_API_KEYS: API_KEYS,
  // Strip any inherited GENESIS_* vars that might leak.
  GENESIS_REASONING_PROVIDER: '',
  GENESIS_RUNTIME_PROVIDER: '',
};

function ts() {
  return new Date().toISOString();
}

function httpRequestPromise(url, { method = 'GET', timeoutMs = 2000, body = null, headers = {} } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = httpRequest(
      url,
      {
        method,
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = raw;
          try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
          resolve({
            ok: true,
            status: res.statusCode ?? 0,
            body: parsed,
            elapsedMs: Date.now() - start,
          });
        });
      },
    );
    req.on('error', (err) => {
      resolve({
        ok: false,
        error: err.code || err.message,
        errno: err.errno,
        elapsedMs: Date.now() - start,
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({
        ok: false,
        error: 'TIMEOUT',
        elapsedMs: Date.now() - start,
      });
    });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function main() {
  process.stderr.write(`[${ts()}] probe start\n`);
  process.stderr.write(`[${ts()}] repo=${REPO_ROOT}\n`);
  process.stderr.write(`[${ts()}] main=${MAIN_PATH}\n`);
  process.stderr.write(`[${ts()}] http=${HTTP_HOST}:${HTTP_PORT} a2a=${A2A_HOST}:${A2A_PORT}\n`);

  if (!fs.existsSync(MAIN_PATH)) {
    throw new Error(`main.ts not found at ${MAIN_PATH}`);
  }

  const stderrChunks = [];
  const stdoutChunks = [];
  const stderrLog = (s) => {
    process.stderr.write(`[gateway.stderr] ${s}`);
  };

  const probeStart = Date.now();
  const child = spawn('npx', ['--yes', 'tsx', MAIN_PATH], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (c) => {
    const s = c.toString('utf8');
    stdoutChunks.push(s);
    process.stderr.write(`[gateway.stdout] ${s}`);
  });
  child.stderr.on('data', (c) => {
    const s = c.toString('utf8');
    stderrChunks.push(s);
    stderrLog(s);
  });
  child.on('exit', (code, signal) => {
    process.stderr.write(`[${ts()}] gateway exited code=${code} signal=${signal}\n`);
  });

  // Helper: probe /health at a given delay (ms) after probeStart.
  async function probeAt(delayMs, label) {
    const elapsedSinceStart = Date.now() - probeStart;
    if (elapsedSinceStart < delayMs) {
      await delay(delayMs - elapsedSinceStart);
    }
    const r = await httpRequestPromise(`http://${HTTP_HOST}:${HTTP_PORT}/health`, {
      method: 'GET',
      timeoutMs: 1500,
    });
    return {
      label,
      scheduledDelayMs: delayMs,
      actualDelayMs: Date.now() - probeStart,
      result: r,
    };
  }

  const probePlan = [0, 10, 50, 100, 250, 500, 1000, 2000, 5000];
  const healthProbes = [];

  // Race probes against the readiness log line on stderr.
  // We run probes sequentially with short delays; each probe is independent.
  let readinessLogSeenAt = null;
  const stderrJoined = () => stderrChunks.join('');
  const checkReadiness = () => {
    if (readinessLogSeenAt !== null) return;
    if (stderrJoined().includes('HTTP API listening')) {
      readinessLogSeenAt = Date.now() - probeStart;
      process.stderr.write(`[${ts()}] READINESS LOG OBSERVED at +${readinessLogSeenAt}ms\n`);
    }
  };

  // Re-check readiness after each probe.
  for (const d of probePlan) {
    healthProbes.push(await probeAt(d, `health@${d}ms`));
    checkReadiness();
  }
  checkReadiness();

  // After probes, also try the agent card endpoint.
  const agentCard = await httpRequestPromise(
    `http://${A2A_HOST}:${A2A_PORT}/.well-known/agent-card.json`,
    { method: 'GET', timeoutMs: 2000 },
  );

  // Final check: is process still alive?
  const alive = child.exitCode === null && child.signalCode === null && !child.killed;

  // Kill the gateway cleanly.
  process.stderr.write(`[${ts()}] sending SIGTERM to gateway pid=${child.pid}\n`);
  child.kill('SIGTERM');

  // Wait for it to exit (with bounded grace).
  const exitInfo = await new Promise((resolve) => {
    const t = setTimeout(() => {
      process.stderr.write(`[${ts()}] SIGTERM did not exit within 5s; sending SIGKILL\n`);
      child.kill('SIGKILL');
      resolve({ timedOut: true });
    }, 5000);
    child.on('exit', (code, signal) => {
      clearTimeout(t);
      resolve({ code, signal, timedOut: false });
    });
  });
  process.stderr.write(`[${ts()}] gateway final exit: ${JSON.stringify(exitInfo)}\n`);

  const report = {
    task: 'B-GATEWAY',
    timestamp: ts(),
    repo: REPO_ROOT,
    commit: '8e0ba68d8764d5769127b821cfc2b05918ca8810',
    ports: { http: HTTP_PORT, a2a: A2A_PORT },
    readinessLogSeenAtMs: readinessLogSeenAt,
    processStillAliveAfterProbes: alive,
    exitInfo,
    healthProbes,
    agentCard,
    gatewayStderr: stderrChunks.join(''),
    gatewayStdout: stdoutChunks.join(''),
  };

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.stderr.write(`[${ts()}] probe done\n`);
}

main().catch((e) => {
  process.stderr.write(`[${ts()}] PROBE FATAL: ${e.stack}\n`);
  process.exit(1);
});
