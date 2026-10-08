/**
 * G6-06-R1 — Clean-room gateway readiness test.
 *
 * Starts the actual gateway entrypoint in a separate process, polls
 * /health with bounded retries (not a fixed sleep), submits an
 * authenticated mission, retrieves status and result, and verifies
 * clean shutdown.
 *
 * Per Blocker C: "Prove: the process remains alive, /health responds,
 * an authenticated mission request is accepted, mission status and
 * result can be retrieved, the process shuts down cleanly."
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..', '..');

let gatewayProcess: ChildProcess | null = null;
let httpUrl = '';

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as AddressInfo;
      srv.close(() => resolve(addr.port));
    });
  });
}

function httpCall(
  method: string,
  urlPath: string,
  body: unknown | null,
  apiKey: string | null,
): Promise<{ status: number; body: unknown }> {
  const url = new URL(urlPath, httpUrl);
  const payload = body === null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = raw;
          try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Poll /health with bounded retries until it responds 200.
 * Returns true if health check succeeded within the deadline.
 */
async function waitForHealth(url: string, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await httpCall('GET', '/health', null, null);
      if (res.status === 200) return true;
    } catch {
      // Connection refused — gateway not ready yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

beforeAll(async () => {
  const httpPort = await getFreePort();
  const a2aPort = await getFreePort();

  const apiKeysJson = JSON.stringify({
    'cleanroom-key': {
      callerId: 'cleanroom-caller',
      allowedOperations: ['mission:submit'],
      maxActiveMissions: 5,
      maxMissionTimeoutMs: 60_000,
    },
  });

  const mainPath = path.join(REPO_ROOT, 'src', 'gateway', 'main.ts');
  expect(fs.existsSync(mainPath)).toBe(true);

  gatewayProcess = spawn(
    'npx',
    ['tsx', mainPath],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        GENESIS_EXECUTION_MODE: 'development',
        GENESIS_HTTP_HOST: '127.0.0.1',
        GENESIS_HTTP_PORT: String(httpPort),
        GENESIS_A2A_HOST: '127.0.0.1',
        GENESIS_A2A_PORT: String(a2aPort),
        GENESIS_A2A_BASE_URL: `http://127.0.0.1:${a2aPort}`,
        GENESIS_API_KEYS: apiKeysJson,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  httpUrl = `http://127.0.0.1:${httpPort}`;

  // Bounded readiness polling — NOT a fixed sleep.
  const healthy = await waitForHealth(httpUrl, 40);
  if (!healthy) {
    const stderr = await new Promise<string>((resolve) => {
      let data = '';
      gatewayProcess!.stderr!.on('data', (c: Buffer) => { data += c.toString('utf8'); });
      setTimeout(() => resolve(data), 1000);
    });
    throw new Error(`Gateway did not become healthy within deadline. stderr:\n${stderr}`);
  }
}, 30_000);

afterAll(() => {
  if (gatewayProcess) {
    gatewayProcess.kill('SIGTERM');
    gatewayProcess = null;
  }
});

describe('G6-06-R1 — Clean-room gateway readiness', () => {
  it('GATEWAY-01: process remains alive and /health responds 200', async () => {
    // The process is alive (beforeAll verified health already).
    expect(gatewayProcess).not.toBeNull();
    expect(gatewayProcess!.killed).toBe(false);

    // Re-check health.
    const res = await httpCall('GET', '/health', null, null);
    expect(res.status).toBe(200);
    const body = res.body as { status: string; version: string; limitations: string[] };
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
    expect(body.limitations.length).toBeGreaterThan(0);
  });

  it('GATEWAY-02: authenticated mission request is accepted (202)', async () => {
    const goal =
      'Write a markdown file named output.md at the workspace root with the content "# Genesis gateway output" as the sole body.';
    const res = await httpCall('POST', '/v1/missions', { outcome: goal }, 'cleanroom-key');
    expect(res.status).toBe(202);
    const body = res.body as { missionId: string; status: string; accepted: boolean };
    expect(body.accepted).toBe(true);
    expect(typeof body.missionId).toBe('string');
    expect(body.status).toBe('RUNNING');
  });

  it('GATEWAY-03: mission status and result can be retrieved', async () => {
    // Submit a mission.
    const goal =
      'Write a markdown file named output.md at the workspace root with the content "# Genesis gateway output" as the sole body.';
    const submit = await httpCall('POST', '/v1/missions', { outcome: goal }, 'cleanroom-key');
    const missionId = (submit.body as { missionId: string }).missionId;

    // Poll status until terminal.
    let snapshot: { status: string; terminal: boolean } | null = null;
    for (let i = 0; i < 60; i++) {
      const get = await httpCall('GET', `/v1/missions/${missionId}`, null, 'cleanroom-key');
      expect(get.status).toBe(200);
      snapshot = get.body as { status: string; terminal: boolean };
      if (snapshot.terminal) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(snapshot).not.toBeNull();
    expect(snapshot!.terminal).toBe(true);

    // Retrieve the result.
    const resultRes = await httpCall('GET', `/v1/missions/${missionId}/result`, null, 'cleanroom-key');
    expect(resultRes.status).toBe(200);
    const result = resultRes.body as { status: string; result: { status: string; summary: string } };
    expect(result.result).toBeDefined();
    expect(typeof result.result.summary).toBe('string');

    // Retrieve artifacts.
    const artifactsRes = await httpCall('GET', `/v1/missions/${missionId}/artifacts`, null, 'cleanroom-key');
    expect(artifactsRes.status).toBe(200);
    const artifacts = artifactsRes.body as { artifacts: Array<{ path: string; content?: string }> };
    expect(artifacts.artifacts.length).toBeGreaterThan(0);
    const outputArtifact = artifacts.artifacts.find((a) => a.path === 'output.md');
    expect(outputArtifact).toBeDefined();
    expect(outputArtifact!.content).toContain('# Genesis gateway output');
  });

  it('GATEWAY-04: process shuts down cleanly on SIGTERM', async () => {
    // Verify the process is still alive.
    expect(gatewayProcess).not.toBeNull();
    expect(gatewayProcess!.killed).toBe(false);

    // Send SIGTERM.
    gatewayProcess!.kill('SIGTERM');

    // Wait for exit with a generous timeout (the gateway closes HTTP
    // servers which may have lingering keep-alive connections).
    const exited = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        // SIGTERM didn't work within 10s — force SIGKILL.
        gatewayProcess!.kill('SIGKILL');
        resolve(false);
      }, 10_000);
      gatewayProcess!.on('exit', () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });

    // The process should have exited (either via SIGTERM or SIGKILL).
    // The key assertion is that the process DID exit — it's no longer running.
    expect(exited).toBe(true);

    // Prevent afterAll from trying to kill it again.
    gatewayProcess = null;
  });
});
