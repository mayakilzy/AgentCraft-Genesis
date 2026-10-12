/**
 * PILOT-002 R3 — Runtime Acceptance Gate tests.
 *
 * Tests the `shouldRequireRuntimeStart` decision function and the
 * `checkRuntimeStart` execution (with a stubbed computer).
 *
 * The `checkRuntimeStart` function wraps the start command in a shell
 * command that backgrounds the server, probes HTTP, and kills the
 * process. We test it with a stubbed `WorkerComputer.exec` that
 * simulates the wrapped command's stdout/stderr for success and
 * failure cases.
 */

import { describe, expect, it } from 'vitest';

import type { WorkerComputer } from '../../src/runtime/computer.js';
import {
  freshEvidence,
  shouldRequireRuntimeStart,
  checkRuntimeStart,
  runtimeStartFailureFeedback,
  type CompletionEvidence,
} from '../../src/worker/completion-policy.js';
import type { WorkerGenome } from '../../src/contracts/core.js';

class StubComputer implements WorkerComputer {
  constructor(
    private readonly execResult: {
      exitCode: number;
      stdout: string;
      stderr?: string;
    },
  ) {}
  async writeFile(path: string, contents: string) {
    return { path, bytes: contents.length, appended: false };
  }
  async writeFileTrusted(path: string, contents: string) {
    return { path, bytes: contents.length, appended: false };
  }
  async readFile(path: string) {
    return { path, text: '', bytes: 0, truncated: false };
  }
  async listFiles() {
    return [];
  }
  async exec(_command: string) {
    return {
      command: _command,
      exitCode: this.execResult.exitCode,
      stdout: this.execResult.stdout,
      stderr: this.execResult.stderr ?? '',
      timedOut: false,
      elapsedMs: 1,
    };
  }
}

const baseGenome: WorkerGenome = {
  identity: { id: 'se-1', displayName: 'SE' },
  role: 'Software Engineer',
  objective: 'Build the app',
  model: 'default',
  skills: ['code-execution'],
  tools: ['openbot:shell-execution', 'openbot:workspace-files'],
  computer: { required: true, browser: false, shell: true, workspace: true },
  memory: 'none',
  budget: { maxUsd: 10, maxTier: 'default' },
  autonomy: 'autonomous',
};

describe('PILOT-002 R3 — shouldRequireRuntimeStart (decision function)', () => {
  it('returns true for testable-code worker with npm start in goal text', () => {
    const evidence = freshEvidence(baseGenome, '');
    const goalText = 'Build a web app. Run "npm start" to launch it.';
    expect(shouldRequireRuntimeStart(evidence, goalText, true)).toBe(true);
  });

  it('returns true for testable-code worker with node server.js in goal text', () => {
    const evidence = freshEvidence(baseGenome, '');
    const goalText = 'Build a web app. Run "node server.js" to launch it.';
    expect(shouldRequireRuntimeStart(evidence, goalText, true)).toBe(true);
  });

  it('returns false when goal text has no start command', () => {
    const evidence = freshEvidence(baseGenome, '');
    const goalText = 'Build a CLI tool. npm test must pass.';
    expect(shouldRequireRuntimeStart(evidence, goalText, true)).toBe(false);
  });

  it('returns false for documentation worker (not testable-code)', () => {
    const docGenome: WorkerGenome = {
      ...baseGenome,
      skills: ['document-authoring'],
    };
    const evidence = freshEvidence(docGenome, '');
    const goalText = 'Write docs. Run "npm start" to view.';
    expect(shouldRequireRuntimeStart(evidence, goalText, true)).toBe(false);
  });

  it('returns false when worker has no computer', () => {
    const evidence = freshEvidence(baseGenome, '');
    const goalText = 'Build a web app. Run "npm start" to launch it.';
    expect(shouldRequireRuntimeStart(evidence, goalText, false)).toBe(false);
  });
});

describe('PILOT-002 R3 — checkRuntimeStart (execution)', () => {
  it('returns ok=true when server responds HTTP 200', async () => {
    // Simulate the wrapped command's output for a successful start.
    const stub = new StubComputer({
      exitCode: 0,
      stdout: 'HTTP_OK:200\n',
      stderr: '',
    });
    const result = await checkRuntimeStart(stub, 'npm start');
    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.command).toBe('npm start');
    expect(result.stderr).toBe('');
  });

  it('returns ok=false with stderr when server crashes (HTTP_FAILED)', async () => {
    const stderrContent = 'SyntaxError: The requested module \'node:sqlite\' does not provide an export named \'open\'';
    const stub = new StubComputer({
      exitCode: 1,
      stdout: `HTTP_FAILED\n---STDERR---\n${stderrContent}\n`,
      stderr: '',
    });
    const result = await checkRuntimeStart(stub, 'npm start');
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(null);
    expect(result.reason).toContain('did not respond');
    expect(result.stderr).toContain('SyntaxError');
    expect(result.stderr).toContain('node:sqlite');
  });

  it('returns ok=false with HTTP status when server responds 500', async () => {
    const stub = new StubComputer({
      exitCode: 1,
      stdout: 'HTTP_BAD:500\n---STDERR---\nInternal Server Error\n',
      stderr: '',
    });
    const result = await checkRuntimeStart(stub, 'npm start');
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(500);
    expect(result.reason).toContain('HTTP 500');
  });

  it('returns ok=false when exec throws', async () => {
    const stub = {
      writeFile: async () => ({ path: '', bytes: 0, appended: false }),
      writeFileTrusted: async () => ({ path: '', bytes: 0, appended: false }),
      readFile: async () => ({ path: '', text: '', bytes: 0, truncated: false }),
      listFiles: async () => [],
      exec: async () => { throw new Error('computer process exited'); },
    } as unknown as WorkerComputer;
    const result = await checkRuntimeStart(stub, 'npm start');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('could not execute');
  });

  it('accepts custom probe URL and timeout', async () => {
    const stub = new StubComputer({
      exitCode: 0,
      stdout: 'HTTP_OK:200\n',
      stderr: '',
    });
    const result = await checkRuntimeStart(stub, 'node server.js', {
      probeUrl: 'http://127.0.0.1:8080/health',
      startupTimeoutMs: 5000,
    });
    expect(result.ok).toBe(true);
    expect(result.command).toBe('node server.js');
  });
});

describe('PILOT-002 R3 — runtimeStartFailureFeedback', () => {
  it('builds feedback with stderr when present', () => {
    const result = {
      ok: false,
      command: 'npm start',
      httpStatus: null as number | null,
      reason: 'server did not respond',
      stderr: 'Error: Cannot find module node:sqlite',
    };
    const feedback = runtimeStartFailureFeedback(result);
    expect(feedback).toContain('npm start');
    expect(feedback).toContain('server did not respond');
    expect(feedback).toContain('Cannot find module node:sqlite');
    expect(feedback).toContain('Inspect the error, repair the code');
  });

  it('builds feedback without stderr when empty', () => {
    const result = {
      ok: false,
      command: 'npm start',
      httpStatus: null as number | null,
      reason: 'server did not respond',
      stderr: '',
    };
    const feedback = runtimeStartFailureFeedback(result);
    expect(feedback).toContain('npm start');
    expect(feedback).toContain('server did not respond');
    expect(feedback).not.toContain('Server stderr');
  });

  it('does NOT mention specific fixes (worker must diagnose itself)', () => {
    const result = {
      ok: false,
      command: 'npm start',
      httpStatus: null as number | null,
      reason: 'import error',
      stderr: 'SyntaxError: export named open',
    };
    const feedback = runtimeStartFailureFeedback(result);
    // The feedback must NOT contain the actual fix — the worker discovers it.
    expect(feedback).not.toContain('DatabaseSync');
    expect(feedback).not.toContain('use DatabaseSync');
    expect(feedback).not.toContain('use open');
  });
});
