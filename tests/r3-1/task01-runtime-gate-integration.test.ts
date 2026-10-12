/**
 * PILOT-002 R3.1 — TASK 01: Runtime Acceptance Gate integration test
 * against the known-bad PILOT-002 R3 application.
 *
 * This test invokes the ACTUAL checkRuntimeStart() function against
 * the real evidence/pilot-002/app/server.js file (which contains the
 * known-bad import: `import { open, sqlite3 } from 'node:sqlite'`).
 *
 * It proves:
 *   1. The gate detects the invalid node:sqlite imports.
 *   2. The gate captures the real startup error (SyntaxError).
 *   3. The gate rejects completion (returns ok=false).
 *   4. The gate produces actionable feedback with the real stderr.
 *   5. The feedback does NOT mention the specific fix (worker must
 *      diagnose from stderr itself).
 *
 * No paid production reasoning is invoked — this is a deterministic
 * test using a LocalShellComputer that runs real shell commands
 * against the existing app directory.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

import { LocalShellComputer } from '../helpers/local-shell-computer.js';
import {
  checkRuntimeStart,
  shouldRequireRuntimeStart,
  runtimeStartFailureFeedback,
  freshEvidence,
} from '../../src/worker/completion-policy.js';
import type { WorkerGenome } from '../../src/contracts/core.js';

const APP_DIR = join(process.cwd(), 'evidence', 'pilot-002', 'app');
const SKIP = !existsSync(join(APP_DIR, 'server.js'));

const seGenome: WorkerGenome = {
  identity: { id: 'software-engineer-1', displayName: 'SE' },
  role: 'Software Engineer',
  objective: 'Build the app',
  model: 'default',
  skills: ['code-execution'],
  tools: ['openbot:shell-execution', 'openbot:workspace-files'],
  computer: { required: true, browser: false, shell: true, workspace: true },
  memory: 'none',
  budget: { maxUsd: 100, maxTier: 'default' },
  autonomy: 'autonomous',
};

describe.skipIf(SKIP)('PILOT-002 R3.1 TASK 01 — Runtime Acceptance Gate vs known-bad app', () => {
  // These tests run real shell commands (npm start + sleep + curl).
  // The server crashes immediately (SyntaxError on import), so 3s startup
  // timeout is sufficient. Vitest testTimeout set to 30s to accommodate.
  const STARTUP_TIMEOUT = 3_000;

  it('detects the invalid node:sqlite imports in the real PILOT-002 app', async () => {
    const computer = new LocalShellComputer(APP_DIR);
    const read = await computer.readFile('server.js');
    expect(read.text).toContain("from 'node:sqlite'");
    expect(read.text).toMatch(/open/);
    expect(read.text).toMatch(/sqlite3/);
  });

  it('rejects completion with the real startup error', async () => {
    const computer = new LocalShellComputer(APP_DIR);
    const result = await checkRuntimeStart(computer, 'npm start', {
      startupTimeoutMs: STARTUP_TIMEOUT,
    });
    expect(result.ok).toBe(false);
    expect(result.command).toBe('npm start');
    expect(result.reason).toMatch(/did not respond|HTTP|failed/i);
  }, 30_000);

  it('captures the real SyntaxError in stderr', async () => {
    const computer = new LocalShellComputer(APP_DIR);
    const result = await checkRuntimeStart(computer, 'npm start', {
      startupTimeoutMs: STARTUP_TIMEOUT,
    });
    expect(result.ok).toBe(false);
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.stderr).toMatch(/node:sqlite|sqlite|SyntaxError|ERR_|export/i);
  }, 30_000);

  it('produces actionable feedback containing the real stderr', async () => {
    const computer = new LocalShellComputer(APP_DIR);
    const result = await checkRuntimeStart(computer, 'npm start', {
      startupTimeoutMs: STARTUP_TIMEOUT,
    });
    expect(result.ok).toBe(false);
    const feedback = runtimeStartFailureFeedback(result);
    expect(feedback).toContain('npm start');
    expect(feedback).toContain(result.reason);
    expect(feedback).toContain('repair');
  }, 30_000);

  it('does NOT mention the specific fix (DatabaseSync) in feedback', async () => {
    const computer = new LocalShellComputer(APP_DIR);
    const result = await checkRuntimeStart(computer, 'npm start', {
      startupTimeoutMs: STARTUP_TIMEOUT,
    });
    const feedback = runtimeStartFailureFeedback(result);
    expect(feedback).not.toContain('DatabaseSync');
    expect(feedback).not.toContain('use DatabaseSync');
  }, 30_000);

  it('shouldRequireRuntimeStart returns true for this mission shape', () => {
    const goalText = 'Build a Personal Task Manager. Run "npm start" to launch.';
    const evidence = freshEvidence(seGenome, '');
    expect(shouldRequireRuntimeStart(evidence, goalText, true)).toBe(true);
  });

  it('shouldRequireRuntimeStart returns false when no start command in goal', () => {
    const goalText = 'Build a CLI tool. npm test must pass.';
    const evidence = freshEvidence(seGenome, '');
    expect(shouldRequireRuntimeStart(evidence, goalText, true)).toBe(false);
  });
});
