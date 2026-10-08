/**
 * G6-05A-R1 — Separate-process E2E test (Correction B).
 *
 * Spawns the actual gateway entrypoint (`src/gateway/main.ts`) as a
 * child process, waits for a genuine readiness signal on stderr,
 * then executes the independent-client logic over real HTTP against
 * that process.
 *
 * Per Section 16: "The service must run in a separate process."
 * Per Section 3 (Correction B): "Starts the actual gateway entrypoint
 * (main.ts) in a child process."
 *
 * The test uses ephemeral ports and terminates the child cleanly.
 * Scripted reasoning and MemoryComputer are used (labeled accurately);
 * no claim of live LLM or OpenBot execution.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { request as httpRequest, get as httpGet } from 'node:http';
import { createServer } from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..', '..');

let gatewayProcess: ChildProcess | null = null;
let httpUrl = '';
let a2aUrl = '';
const apiKey = 'e2e-test-key';

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => resolve(0));
      }
    });
  });
}

function httpCall(
  method: string,
  urlPath: string,
  body: unknown | null,
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
          Authorization: `Bearer ${apiKey}`,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
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
    if (payload) req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  const httpPort = await getFreePort();
  const a2aPort = await getFreePort();

  const apiKeysJson = JSON.stringify({
    [apiKey]: {
      callerId: 'e2e-caller',
      allowedOperations: ['mission:submit'],
      maxActiveMissions: 5,
      maxMissionTimeoutMs: 30_000,
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
  a2aUrl = `http://127.0.0.1:${a2aPort}`;

  // Wait for the readiness signal on stderr.
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('gateway did not become ready within 15 seconds'));
    }, 15_000);

    const onData = (data: Buffer): void => {
      const text = data.toString('utf8');
      if (text.includes('HTTP API listening')) {
        clearTimeout(timeout);
        resolve();
      }
    };
    gatewayProcess!.stderr!.on('data', onData);
    gatewayProcess!.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    gatewayProcess!.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`gateway exited prematurely with code ${code}`));
    });
  });

  // Give the servers an extra moment to bind.
  await new Promise((r) => setTimeout(r, 200));
}, 30_000);

afterAll(() => {
  if (gatewayProcess) {
    gatewayProcess.kill('SIGTERM');
    gatewayProcess = null;
  }
});

describe('G6-05A-R1 — Separate-process E2E', () => {
  it('E2E-01: independent client submits, polls, retrieves verified artifact over real HTTP to a separate process', async () => {
    // 1. Health check (no auth).
    const health = await httpCall('GET', '/health', null);
    expect(health.status).toBe(200);
    const healthBody = health.body as { status: string; version: string };
    expect(healthBody.status).toBe('ok');
    expect(healthBody.version).toBe('0.1.0');

    // 2. Submit a goal.
    const goal =
      'Write a markdown file named output.md at the workspace root with the content "# Genesis gateway output" as the sole body.';
    const submit = await httpCall('POST', '/v1/missions', { outcome: goal });
    expect(submit.status).toBe(202);
    const submission = submit.body as { missionId: string; status: string };
    expect(typeof submission.missionId).toBe('string');
    expect(submission.status).toBe('RUNNING');

    // 3. Poll mission status until terminal.
    let snapshot: { status: string; terminal: boolean } | null = null;
    for (let i = 0; i < 100; i++) {
      const get = await httpCall('GET', `/v1/missions/${submission.missionId}`, null);
      expect(get.status).toBe(200);
      snapshot = get.body as { status: string; terminal: boolean };
      if (snapshot.terminal) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(snapshot).not.toBeNull();
    expect(snapshot!.terminal).toBe(true);

    // 4. Retrieve events.
    const eventsRes = await httpCall('GET', `/v1/missions/${submission.missionId}/events`, null);
    expect(eventsRes.status).toBe(200);
    const eventsBody = eventsRes.body as { events: Array<{ type: string }> };
    expect(eventsBody.events.length).toBeGreaterThan(0);
    const eventTypes = eventsBody.events.map((e) => e.type);
    expect(eventTypes).toContain('mission-started');
    expect(eventTypes).toContain('mission-finished');

    // 5. Retrieve the final result.
    const resultRes = await httpCall('GET', `/v1/missions/${submission.missionId}/result`, null);
    expect(resultRes.status).toBe(200);
    const result = resultRes.body as { status: string; result: { status: string; summary: string } };
    expect(result.result).toBeDefined();
    expect(typeof result.result.summary).toBe('string');

    // 6. Retrieve artifacts.
    const artifactsRes = await httpCall('GET', `/v1/missions/${submission.missionId}/artifacts`, null);
    expect(artifactsRes.status).toBe(200);
    const artifactsBody = artifactsRes.body as { artifacts: Array<{ path: string; content?: string; bytes: number }> };
    expect(artifactsBody.artifacts.length).toBeGreaterThan(0);
    const outputArtifact = artifactsBody.artifacts.find((a) => a.path === 'output.md');
    expect(outputArtifact).toBeDefined();

    // 7. Verify the artifact matches the expected output.
    expect(outputArtifact!.content).toContain('# Genesis gateway output');

    // 8. Confirm the mission's verification status.
    expect(['SUCCEEDED', 'PARTIAL']).toContain(result.status);

    // 9. Confirm the production MissionOrchestrator executed (verification event present).
    const verificationEvent = eventsBody.events.find((e) => e.type === 'verification');
    expect(verificationEvent).toBeDefined();
  }, 20_000);

  it('E2E-02: A2A server is reachable in the same separate process', async () => {
    // Fetch the Agent Card from the A2A server (running in the same child process).
    const card = await new Promise<Record<string, unknown>>((resolve, reject) => {
      httpGet(`${a2aUrl}/.well-known/agent-card.json`, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
    expect(card.name).toBeDefined();
    expect(card.version).toBe('1.0.0');
    expect(Array.isArray(card.supportedInterfaces)).toBe(true);
  }, 10_000);
});
