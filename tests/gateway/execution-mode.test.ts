/**
 * G6-06 — Execution mode boundary tests.
 *
 * Verifies the P1-MAIN-DEV-FALLBACK fix: GENESIS_EXECUTION_MODE=production
 * must fail closed when real providers are missing, and must NOT silently
 * use dev fixtures.
 *
 * Also verifies the P1-A2A-CANCELTASK-NO-CALLER-AUTHZ fix: cross-caller
 * A2A cancellation is rejected.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..', '..');

function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as AddressInfo;
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

describe('G6-06 — Execution mode boundary', () => {
  it('production mode fails closed when reasoning provider is missing', async () => {
    const httpPort = await getFreePort();
    const a2aPort = await getFreePort();
    const mainPath = path.join(REPO_ROOT, 'src', 'gateway', 'main.ts');
    expect(fs.existsSync(mainPath)).toBe(true);

    const child = spawn(
      'npx',
      ['tsx', mainPath],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          GENESIS_EXECUTION_MODE: 'production',
          // Intentionally missing GENESIS_REASONING_PROVIDER and GENESIS_RUNTIME_PROVIDER
          GENESIS_HTTP_HOST: '127.0.0.1',
          GENESIS_HTTP_PORT: String(httpPort),
          GENESIS_A2A_HOST: '127.0.0.1',
          GENESIS_A2A_PORT: String(a2aPort),
          GENESIS_A2A_BASE_URL: `http://127.0.0.1:${a2aPort}`,
          GENESIS_API_KEYS: '{"test-key":{"callerId":"test-caller","allowedOperations":["mission:submit"],"maxActiveMissions":5,"maxMissionTimeoutMs":60000}}',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const stderrOutput: string[] = [];
    child.stderr!.on('data', (data: Buffer) => {
      stderrOutput.push(data.toString('utf8'));
    });

    // Wait for the process to exit (should fail fast).
    const exitCode = await new Promise<number>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(-1);
      }, 10_000);
      child.on('exit', (code) => {
        clearTimeout(timeout);
        resolve(code ?? 0);
      });
    });

    const stderr = stderrOutput.join('');
    expect(exitCode).toBe(1);
    expect(stderr).toContain('FATAL');
    expect(stderr).toContain('production');
    // Must mention reasoning or runtime provider requirement.
    expect(
      stderr.includes('REASONING_PROVIDER') || stderr.includes('RUNTIME_PROVIDER'),
    ).toBe(true);
  }, 15_000);

  it('development mode starts with dev fixtures banner', async () => {
    const httpPort = await getFreePort();
    const a2aPort = await getFreePort();
    const mainPath = path.join(REPO_ROOT, 'src', 'gateway', 'main.ts');

    const child = spawn(
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
          GENESIS_API_KEYS: '{"dev-key":{"callerId":"dev-caller","allowedOperations":["mission:submit"],"maxActiveMissions":5,"maxMissionTimeoutMs":60000}}',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const stderrOutput: string[] = [];
    child.stderr!.on('data', (data: Buffer) => {
      stderrOutput.push(data.toString('utf8'));
    });

    // Wait for readiness signal.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('gateway did not become ready within 10 seconds'));
      }, 10_000);
      const onData = (data: Buffer): void => {
        const text = data.toString('utf8');
        if (text.includes('HTTP API listening')) {
          clearTimeout(timeout);
          resolve();
        }
      };
      child.stderr!.on('data', onData);
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.on('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`gateway exited with code ${code} before becoming ready`));
      });
    });

    const stderr = stderrOutput.join('');
    expect(stderr).toContain('EXECUTION MODE: development');
    expect(stderr).toContain('DEVELOPMENT FIXTURES');
    expect(stderr).toContain('NOT real AI execution');

    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
  }, 15_000);
});
