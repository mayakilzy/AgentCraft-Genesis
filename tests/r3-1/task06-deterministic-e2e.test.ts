/**
 * PILOT-002 R3.1 — TASK 06: Deterministic End-to-End verification
 * with controlled reasoning responses.
 *
 * This test exercises the REAL WorkerAgent + completion gate + runtime
 * acceptance gate + clean room verification using a scripted reasoning
 * provider (no paid production LLM).
 *
 * Scenario: the worker writes a bad server.js (wrong node:sqlite import),
 * runs npm test (passes because test mocks the import), calls finish.
 * The completion gate checks npm test (passes) then the runtime gate
 * runs npm start — which fails (SyntaxError). The gate rejects finish
 * with the real stderr. The scripted worker "repairs" the import on
 * its next reasoning call, re-runs npm test, calls finish again. The
 * runtime gate now passes. The worker finishes successfully.
 *
 * This proves the full self-repair loop:
 *   1. Real worker completion path with controlled reasoning.
 *   2. Startup failure detected.
 *   3. Failure returned to worker (via scratchpad feedback).
 *   4. Controlled corrective response applied.
 *   5. Successful startup and HTTP verification.
 *   6. Retry limit respected (1 rejection, then success).
 *   7. Artifact verification and clean-room access.
 *   8. Truthful final mission status.
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import type { ReasoningInput, ReasoningOutput, ReasoningProvider, WorkerGenome } from '../../src/contracts/core.js';
import type { WorkerComputer } from '../../src/runtime/computer.js';
import { WorkerAgent } from '../../src/worker/worker-agent.js';
import { LocalShellComputer } from '../helpers/local-shell-computer.js';

const BAD_SERVER = `import { createServer } from 'http';
import { open, sqlite3 } from 'node:sqlite';
const server = createServer((req, res) => { res.writeHead(200); res.end('ok'); });
server.listen(3000);
`;

const GOOD_SERVER = `import { createServer } from 'http';
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT)');
const server = createServer((req, res) => { res.writeHead(200); res.end('ok'); });
server.listen(3000);
`;

const PACKAGE_JSON = JSON.stringify({
  name: 'task-manager',
  version: '1.0.0',
  type: 'module',
  scripts: { test: 'node --test', start: 'node server.js' },
}, null, 2);

const TEST_FILE = `import { test } from 'node:test';
import { ok } from 'node:assert';
test('placeholder', () => { ok(true); });
`;

/**
 * A scripted reasoning provider that returns predetermined responses.
 * Each call to reason() returns the next scripted response in sequence.
 */
class ScriptedReasoningProvider implements ReasoningProvider {
  readonly name = 'scripted';
  private responses: string[];
  private callIndex = 0;
  readonly callLog: ReasoningInput[] = [];

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    this.callLog.push(input);
    if (this.callIndex >= this.responses.length) {
      throw new Error('scripted reasoning exhausted');
    }
    const text = this.responses[this.callIndex]!;
    this.callIndex += 1;
    return { text };
  }

  get callCount(): number {
    return this.callIndex;
  }
}

const seGenome: WorkerGenome = {
  identity: { id: 'se-1', displayName: 'SE' },
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

describe('PILOT-002 R3.1 TASK 06 — Deterministic E2E with controlled reasoning', () => {
  let workspaceDir: string;
  let computer: WorkerComputer;

  beforeAll(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'genesis-r3-task06-'));
    computer = new LocalShellComputer(workspaceDir);
  });

  afterAll(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  // Kill any stale process on port 3000 before each test.
  // Without this, a previously-started server (from a prior test or pilot)
  // would satisfy the HTTP probe, making the runtime gate pass falsely.
  beforeEach(() => {
    try { execSync('fuser -k 3000/tcp 2>/dev/null || true'); } catch { /* ignore */ }
    try { execSync('pkill -f "node server.js" 2>/dev/null || true'); } catch { /* ignore */ }
  });

  it('demonstrates the full self-repair loop: bad server → gate rejection → repair → success', async () => {
    // Scripted worker behavior:
    // Call 1: write package.json
    // Call 2: write server.js (BAD — wrong import)
    // Call 3: write test file
    // Call 4: run npm test (passes)
    // Call 5: call finish → gate rejects (runtime start fails)
    // Call 6: write server.js (GOOD — fixed import)
    // Call 7: run npm test (passes)
    // Call 8: call finish → gate passes (runtime starts, HTTP 200)
    const responses = [
      // Step 1: write package.json
      JSON.stringify({ action: 'write_file', path: 'package.json', contents: PACKAGE_JSON }),
      // Step 2: write bad server.js
      JSON.stringify({ action: 'write_file', path: 'server.js', contents: BAD_SERVER }),
      // Step 3: write test file
      JSON.stringify({ action: 'write_file', path: 'test/app.test.js', contents: TEST_FILE }),
      // Step 4: run npm test
      JSON.stringify({ action: 'run_command', command: 'npm test' }),
      // Step 5: call finish (gate will reject due to bad npm start)
      JSON.stringify({ action: 'finish', summary: 'app built', artifacts: ['package.json', 'server.js', 'test/app.test.js'] }),
      // Step 6: write GOOD server.js (repair based on stderr feedback)
      JSON.stringify({ action: 'write_file', path: 'server.js', contents: GOOD_SERVER }),
      // Step 7: run npm test again
      JSON.stringify({ action: 'run_command', command: 'npm test' }),
      // Step 8: call finish (gate passes)
      JSON.stringify({ action: 'finish', summary: 'app fixed and working', artifacts: ['package.json', 'server.js', 'test/app.test.js'] }),
    ];

    const reasoning = new ScriptedReasoningProvider(responses);
    const goalText = 'Build a web app. Run "npm start" to launch it on port 3000.';
    const taskBrief = `Mission: ${goalText}\nYour assignment in it: [owns: package.json, server.js; kind: testable-code] Build the app.`;

    const events: any[] = [];

    const agent = new WorkerAgent({
      genome: seGenome,
      reasoning,
      computer,
      taskBrief,
      maxSteps: 20,
      onEvent: (e) => events.push(e),
    });

    const result = await agent.run();

    // The worker should have succeeded after the self-repair loop.
    expect(result.status).toBe('success');
    expect(result.artifacts).toContain('package.json');
    expect(result.artifacts).toContain('server.js');

    // Verify the gate was invoked: we should see finish-rejected events.
    const finishRejectedEvents = events.filter(
      (e) => e.type === 'worker-step' && e.action === 'finish' && e.ok === false,
    );
    // The first finish was rejected (bad server), the second passed.
    expect(finishRejectedEvents.length).toBeGreaterThanOrEqual(1);

    // The server.js should now be the GOOD version (with DatabaseSync).
    const finalServer = await computer.readFile('server.js');
    expect(finalServer.text).toContain('DatabaseSync');
    expect(finalServer.text).not.toMatch(/import.*sqlite3.*from.*node:sqlite/);

    // Verify the reasoning provider received the failure feedback.
    // The prompt for call 6 (repair) should contain "RUNTIME START GATE REJECTED".
    const repairPrompt = reasoning.callLog[5]?.prompt ?? '';
    expect(repairPrompt).toContain('RUNTIME START GATE');
    expect(repairPrompt).toContain('node:sqlite');

    // Total reasoning calls should be 8 (scripted sequence).
    expect(reasoning.callCount).toBe(8);
  }, 120_000);

  it('respects the retry limit when the worker cannot repair', async () => {
    // The worker keeps calling finish with the same bad server.js.
    // After MAX_FINISH_REJECTIONS (2), the worker terminates with failure.
    const responses = [
      JSON.stringify({ action: 'write_file', path: 'package.json', contents: PACKAGE_JSON }),
      JSON.stringify({ action: 'write_file', path: 'server.js', contents: BAD_SERVER }),
      JSON.stringify({ action: 'write_file', path: 'test/app.test.js', contents: TEST_FILE }),
      JSON.stringify({ action: 'run_command', command: 'npm test' }),
      // Repeatedly call finish without fixing the server.
      JSON.stringify({ action: 'finish', summary: 'done', artifacts: ['package.json', 'server.js'] }),
      JSON.stringify({ action: 'finish', summary: 'done', artifacts: ['package.json', 'server.js'] }),
      JSON.stringify({ action: 'finish', summary: 'done', artifacts: ['package.json', 'server.js'] }),
    ];

    const reasoning = new ScriptedReasoningProvider(responses);
    const goalText = 'Build a web app. Run "npm start" to launch it.';
    const taskBrief = `Mission: ${goalText}\nYour assignment in it: [owns: package.json, server.js; kind: testable-code] Build the app.`;

    const wsDir = mkdtempSync(join(tmpdir(), 'genesis-r3-task06-fail-'));
    const comp = new LocalShellComputer(wsDir);

    const agent = new WorkerAgent({
      genome: seGenome,
      reasoning,
      computer: comp,
      taskBrief,
      maxSteps: 20,
    });

    const result = await agent.run();

    // The worker should fail — it exhausted retries without repairing.
    expect(result.status).toBe('failure');
    expect(result.summary).toMatch(/runtime start|completion gate/i);

    rmSync(wsDir, { recursive: true, force: true });
  }, 120_000);
});
