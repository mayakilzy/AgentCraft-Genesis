import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type { WorkerGenome } from '../../src/contracts/core.js';
import { ComputerApiClient } from '../../src/runtime/openbot/computer-api.js';
import {
  isOpenBotBotId,
  startComputerProcess,
} from '../../src/runtime/openbot/computer-process.js';
import { OpenBotRuntimeAdapter } from '../../src/runtime/openbot/adapter.js';
import { startStubComputer } from '../helpers/stub-computer-server.js';

/**
 * TASK-010 acceptance: a real worker runs inside the real OpenBot runtime.
 *
 * Two layers:
 *   - wire-level units against a stub computer (no upstream needed);
 *   - LIVE integration against the actual upstream agent-computer service,
 *     gated on the presence of an OpenBot checkout (same pattern as
 *     upstream's own docker-gated integration tests).
 */

const OPENBOT_CHECKOUT =
  process.env.GENESIS_OPENBOT_DIR ??
  join(process.cwd(), '..', 'OpenBot');
const liveTestsAvailable = existsSync(
  join(OPENBOT_CHECKOUT, 'agent-computer', 'src', 'index.ts'),
);
const maybeLive = liveTestsAvailable ? describe : describe.skip;

function genome(overrides: Partial<WorkerGenome> = {}): WorkerGenome {
  return {
    identity: { id: 'test-worker-1', displayName: 'Test Worker' },
    role: 'Test Worker',
    objective: 'exercise the runtime adapter',
    model: 'cheap',
    skills: ['code-execution'],
    tools: ['openbot:shell-execution', 'openbot:workspace-files'],
    computer: { required: true, browser: false, shell: true, workspace: true },
    memory: 'none',
    budget: { maxUsd: 1, maxTier: 'default' },
    autonomy: 'autonomous',
    ...overrides,
  };
}

describe('OpenBot adapter — wire-level units (stub computer)', () => {
  it('sends bearer auth and the bot id header, and maps 401 to an error', async () => {
    const stub = await startStubComputer();
    try {
      const client = new ComputerApiClient({
        baseUrl: stub.baseUrl,
        token: stub.token,
        botId: 'wire-bot',
      });
      await expect(client.health()).resolves.toEqual({
        status: 'ok',
        browser: false,
      });

      await client.writeFile('notes/a.txt', 'hello');
      await expect(client.readFile('notes/a.txt')).resolves.toMatchObject({
        path: 'notes/a.txt',
        text: 'hello',
      });
      stub.setExecResult({ stdout: 'done\n' });
      await expect(client.exec('ls')).resolves.toMatchObject({
        exitCode: 0,
        stdout: 'done\n',
      });
      await expect(client.listFiles()).resolves.toHaveLength(1);

      const authed = stub.requests.filter((r) => r.path !== '/health');
      expect(authed.every((r) => r.authorized)).toBe(true);
      expect(authed.every((r) => r.botId === 'wire-bot')).toBe(true);

      const bad = new ComputerApiClient({
        baseUrl: stub.baseUrl,
        token: 'wrong-token',
        botId: 'wire-bot',
      });
      await expect(bad.exec('ls')).rejects.toThrow(/401/);
    } finally {
      await stub.stop();
    }
  });

  it('validates bot ids against the upstream rule', () => {
    expect(isOpenBotBotId('web-researcher-1')).toBe(true);
    expect(isOpenBotBotId('Sole_Operator')).toBe(true);
    expect(isOpenBotBotId('../escape')).toBe(false);
    expect(isOpenBotBotId('.hidden')).toBe(false);
    expect(isOpenBotBotId('')).toBe(false);
    expect(isOpenBotBotId('a'.repeat(65))).toBe(false);
  });
});

maybeLive('OpenBot adapter — LIVE against upstream v0.1.0', () => {
  const rootDir = join(tmpdir(), `genesis-openbot-live-${process.pid}`);
  const adapter = new OpenBotRuntimeAdapter({
    checkoutDir: OPENBOT_CHECKOUT,
    rootDir,
  });

  afterAll(async () => {
    await adapter.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('runs a real worker inside the real OpenBot runtime', async () => {
    const g = genome();
    const handle = await adapter.ensureWorker(g);
    expect(handle.workerId).toBe('test-worker-1');
    expect(handle.ref).toMatch(/^openbot:process:\d+$/);

    const computer = adapter.computer(handle);

    // Smoke mission, exactly as TASK-010 specifies: create a file, run a
    // command, read the result back — all inside the upstream runtime.
    await computer.writeFile('smoke/mission.txt', 'born from goal');
    const exec = await computer.exec('cat smoke/mission.txt && echo executed-inside-openbot');
    expect(exec.exitCode).toBe(0);
    expect(exec.stdout).toContain('born from goal');
    expect(exec.stdout).toContain('executed-inside-openbot');

    const read = await computer.readFile('smoke/mission.txt');
    expect(read.text).toBe('born from goal');

    const entries = await computer.listFiles('smoke');
    expect(entries.some((e) => e.path === 'smoke/mission.txt')).toBe(true);
  }, 60_000);

  it('keeps ensure idempotent and enforces the no-computer contract', async () => {
    const g = genome();
    const first = await adapter.ensureWorker(g);
    const second = await adapter.ensureWorker(g);
    expect(second.ref).toBe(first.ref);

    const pure = genome({
      identity: { id: 'coordinator-1', displayName: 'Coordinator' },
      tools: [],
      computer: { required: false, browser: false, shell: false, workspace: false },
    });
    const handle = await adapter.ensureWorker(pure);
    expect(handle.ref).toBe('openbot:none');
    expect(() => adapter.computer(handle)).toThrow(/no computer/);
  }, 60_000);

  it('stop keeps durable workspace files; reset forgets everything', async () => {
    const g = genome({
      identity: { id: 'ephemeral-worker-1', displayName: 'Ephemeral' },
    });
    const handle = await adapter.ensureWorker(g);
    await adapter.computer(handle).writeFile('durable.txt', 'survives stop');

    await adapter.stopWorker(handle);
    const workspace = join(rootDir, 'ephemeral-worker-1', 'workspace');
    expect(existsSync(join(workspace, 'durable.txt'))).toBe(true);

    // Re-ensure after stop starts a fresh process over the same workspace.
    const again = await adapter.ensureWorker(g);
    const read = await adapter.computer(again).readFile('durable.txt');
    expect(read.text).toBe('survives stop');

    await adapter.resetWorker(again);
    expect(existsSync(join(rootDir, 'ephemeral-worker-1'))).toBe(false);
  }, 60_000);

  it('starts one isolated computer process per worker', async () => {
    const a = await adapter.ensureWorker(
      genome({ identity: { id: 'isolated-a-1', displayName: 'A' } }),
    );
    const b = await adapter.ensureWorker(
      genome({ identity: { id: 'isolated-b-1', displayName: 'B' } }),
    );
    expect(a.ref).not.toBe(b.ref);

    await adapter.computer(a).writeFile('who.txt', 'A');
    await adapter.computer(b).writeFile('who.txt', 'B');

    const readA = await adapter.computer(a).readFile('who.txt');
    const readB = await adapter.computer(b).readFile('who.txt');
    expect(readA.text).toBe('A');
    expect(readB.text).toBe('B');
    // Separate processes, separate workspaces — the isolation the supervisor
    // would otherwise provide with containers.
    expect(join(rootDir, 'isolated-a-1', 'workspace')).not.toBe(
      join(rootDir, 'isolated-b-1', 'workspace'),
    );
  }, 60_000);
});

maybeLive('computer process — startup contract', () => {
  it('reports upstream exit output when the service cannot start', async () => {
    const rootDir = join(tmpdir(), `genesis-openbot-bad-${process.pid}`);
    // An invalid COMPUTER_BROWSER_BACKEND is rejected by the upstream
    // service at boot — a deterministic startup failure with log output.
    await expect(
      startComputerProcess(
        {
          checkoutDir: OPENBOT_CHECKOUT,
          rootDir,
          extraEnv: { COMPUTER_BROWSER_BACKEND: 'not-a-backend' },
        },
        'bad-worker-1',
      ),
    ).rejects.toThrow(/exited during startup/);
    rmSync(rootDir, { recursive: true, force: true });
  }, 30_000);
});

maybeLive('computer process — group stop semantics (docker stop equivalent)', () => {
  it('a nohup-ed server started inside the computer dies with the computer', async () => {
    const rootDir = join(tmpdir(), `genesis-openbot-grp-${process.pid}`);
    // A free port chosen on the test side for the server the worker will
    // nohup inside its computer (the computers share the host network in
    // process mode — exactly the deployment where this defect surfaced).
    const { createServer } = await import('node:net');
    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.unref();
      probe.on('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        const chosen =
          typeof address === 'object' && address !== null ? address.port : 0;
        probe.close(() => resolve(chosen));
      });
    });

    const computer = await startComputerProcess(
      { checkoutDir: OPENBOT_CHECKOUT, rootDir },
      'group-stop-worker-1',
    );
    try {
      const exec = async (command: string): Promise<{ exitCode: number; stdout: string }> => {
        const response = await fetch(`${computer.baseUrl}/exec`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${computer.token}`,
            'x-openbot-bot-id': computer.botId,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ command, timeoutMs: 15_000 }),
        });
        return (await response.json()) as { exitCode: number; stdout: string };
      };
      const start = await exec(
        `nohup node -e 'require("http").createServer((q,s)=>s.end("alive")).listen(${port}, "127.0.0.1")' > server.log 2>&1 & sleep 0.5 && echo started`,
      );
      expect(start.exitCode).toBe(0);

      // The server IS alive and reachable from the host.
      const before = await fetch(`http://127.0.0.1:${port}/`);
      expect(await before.text()).toBe('alive');

      // Stopping the computer must stop the WHOLE process group — the
      // nohup-ed server cannot outlive the computer that spawned it.
      await computer.stop();

      await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    } finally {
      await computer.stop();
      rmSync(rootDir, { recursive: true, force: true });
    }
  }, 60_000);
});
