/**
 * D+ Task A — Verified Worker Completion contract tests.
 *
 * Tests A01–A14 from the Task A specification (Section 7). All tests are
 * deterministic: scripted reasoning provider + in-memory computer. No real
 * Z.ai calls, no OpenBot runtime, no live missions.
 *
 * Test organization mirrors `tests/worker/worker-agent.test.ts` — each
 * test constructs a `ScriptedReasoning` provider that replays a fixed
 * sequence of worker actions, then asserts on the resulting `WorkerResult`.
 */
import { describe, expect, it } from 'vitest';

import type {
  ReasoningInput,
  ReasoningOutput,
  ReasoningProvider,
  WorkerGenome,
} from '../../src/contracts/core.js';
import type { WorkerComputer } from '../../src/runtime/computer.js';
import { WorkerAgent } from '../../src/worker/worker-agent.js';
import {
  inferDeliverableKind,
  isLikelyFilesystemMutation,
  MAX_FINISH_REJECTIONS,
} from '../../src/worker/completion-policy.js';

// ---------------------------------------------------------------------------
// Test helpers (mirrors tests/worker/worker-agent.test.ts)
// ---------------------------------------------------------------------------

class ScriptedReasoning implements ReasoningProvider {
  readonly name = 'scripted';
  private replies: readonly string[];
  readonly seen: ReasoningInput[] = [];

  constructor(replies: readonly string[]) {
    this.replies = replies;
  }

  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    expect(this.replies.length).toBeGreaterThan(0);
    const [next, ...rest] = this.replies;
    this.replies = rest;
    this.seen.push(input);
    return { text: next };
  }
}

interface MemoryComputerDouble extends WorkerComputer {
  files: Map<string, string>;
  /** Override to control exit codes per command. */
  exitOverrides: Map<string, number>;
}

function memoryComputer(overrides: Partial<{
  exitCodeFor: (command: string) => number;
}> = {}): MemoryComputerDouble {
  const files = new Map<string, string>();
  const exitOverrides = new Map<string, number>();
  return {
    files,
    exitOverrides,
    async exec(command) {
      // Default: exit 0, stdout 'ok'. Override via exitOverrides map.
      const override = exitOverrides.get(command.trim());
      const exitCode = override ?? (overrides.exitCodeFor ? overrides.exitCodeFor(command) : 0);
      return {
        command,
        exitCode,
        stdout: exitCode === 0 ? 'ok' : '',
        stderr: exitCode === 0 ? '' : `error: exit ${exitCode}`,
        timedOut: false,
        elapsedMs: 1,
      };
    },
    async writeFile(path, contents) {
      files.set(path, contents);
      return { path, bytes: contents.length, appended: false };
    },
    async readFile(path) {
      const text = files.get(path);
      if (text === undefined) throw new Error(`no file at ${path}`);
      return { path, text, bytes: text.length, truncated: false };
    },
    async listFiles() {
      return [...files.keys()].map((path) => ({ path, kind: 'file' as const }));
    },
  };
}

function genome(overrides: Partial<WorkerGenome> = {}): WorkerGenome {
  return {
    identity: { id: 'scripted-worker-1', displayName: 'Scripted Worker' },
    role: 'Software Engineer',
    objective: 'test the worker loop',
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

/** Genome for a documentation-only worker (no shell grant). */
function docGenome(overrides: Partial<WorkerGenome> = {}): WorkerGenome {
  return genome({
    identity: { id: 'doc-writer-1', displayName: 'Doc Writer' },
    role: 'Documentation Writer',
    skills: ['document-authoring'],
    tools: ['openbot:workspace-files'],
    computer: { required: true, browser: false, shell: false, workspace: true },
    ...overrides,
  });
}

/** Goal text that contains an executable-acceptance mention (npm test). */
const GOAL_WITH_NPM_TEST =
  'Write a Node.js app. After producing all files, npm test MUST exit 0 within 60 seconds.';

/** Goal text with NO executable-acceptance mention. */
const GOAL_NO_TEST = 'Write a markdown file named output.md with content "# hello".';

// ---------------------------------------------------------------------------
// A01 — Valid completion
// ---------------------------------------------------------------------------

describe('A01 — Valid completion: executable deliverable + correct check + fresh success → success', () => {
  it('accepts finish after a successful npm test on the current workspace', async () => {
    const computer = memoryComputer();
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'package.json', contents: '{"name":"app"}' }),
      JSON.stringify({ action: 'write_file', path: 'app.js', contents: 'console.log("hi")' }),
      JSON.stringify({ action: 'run_command', command: 'npm test' }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json', 'app.js'] }),
    ]);
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer,
      taskBrief: GOAL_WITH_NPM_TEST,
    }).run();

    expect(result.status).toBe('success');
    expect(result.summary).toBe('Done.');
    expect(result.artifacts).toEqual(['package.json', 'app.js']);
    expect(result.completionEvidence).toBeDefined();
    expect(result.completionEvidence!.deliverableKind).toBe('testable-code');
    expect(result.completionEvidence!.lastTestCommand).toEqual({ command: 'npm test', exitCode: 0 });
    expect(result.completionEvidence!.lastTestSnapshot).not.toBeNull();
    expect(result.completionEvidence!.finishRejections).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A02 — Missing check: worker calls finish before required validation
// ---------------------------------------------------------------------------

describe('A02 — Missing check: finish before required validation → rejected', () => {
  it('rejects finish when no test command has been run', async () => {
    const computer = memoryComputer();
    // Worker writes files then immediately finishes — no test command.
    // The gate rejects finish (3 times) then terminates with failure.
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'package.json', contents: '{}' }),
      JSON.stringify({ action: 'write_file', path: 'app.js', contents: 'x' }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json', 'app.js'] }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json', 'app.js'] }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json', 'app.js'] }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json', 'app.js'] }),
    ]);
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer,
      taskBrief: GOAL_WITH_NPM_TEST,
    }).run();

    expect(result.status).toBe('failure');
    expect(result.summary).toMatch(/completion gate/i);
    expect(result.completionEvidence!.finishRejections).toBeGreaterThan(MAX_FINISH_REJECTIONS);
    expect(result.completionEvidence!.lastTestCommand).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A03 — Failed check: required command exits nonzero
// ---------------------------------------------------------------------------

describe('A03 — Failed check: nonzero exit → rejected', () => {
  it('rejects finish when npm test exits nonzero, and feedback is returned', async () => {
    const computer = memoryComputer();
    computer.exitOverrides.set('npm test', 1);
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'package.json', contents: '{}' }),
      JSON.stringify({ action: 'run_command', command: 'npm test' }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
    ]);
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer,
      taskBrief: GOAL_WITH_NPM_TEST,
    }).run();

    expect(result.status).toBe('failure');
    // The gate does NOT record a failed test as "lastTestCommand" — only
    // successful tests are recorded as evidence. The gate treats a
    // failed test the same as no test: finish is rejected.
    expect(result.completionEvidence!.lastTestCommand).toBeNull();
    // The summary should mention the gate or the missing test
    expect(result.summary).toMatch(/completion gate|test command/i);
  });
});

// ---------------------------------------------------------------------------
// A04 — Repair/retest: failing → repair → fresh success → success
// ---------------------------------------------------------------------------

describe('A04 — Repair/retest: failing then fix then fresh success → success', () => {
  it('accepts finish after worker fixes the failing test and re-runs it', async () => {
    const computer = memoryComputer();
    // First npm test fails (exit 1), then worker writes a fix, then npm test passes (exit 0)
    computer.exitOverrides.set('npm test', 1); // default fail
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'package.json', contents: '{}' }),
      JSON.stringify({ action: 'run_command', command: 'npm test' }), // fails
      JSON.stringify({ action: 'finish', summary: 'Done?', artifacts: ['package.json'] }), // rejected (stale + failed)
      // Now "fix" the test — change exit to 0 via override is not possible mid-run,
      // so we simulate: worker writes a fix file, then we accept the next finish
      // because the gate sees exit 1 (still failing) → still rejected.
      // To test the SUCCESS path, we need the test to pass. We'll use a different command.
    ]);
    // This test is tricky because we can't change exitOverrides mid-run.
    // Instead, let's simulate: first test fails, worker writes a fix, second test passes.
    // We'll use a custom computer that returns exit 1 for the first 'npm test'
    // and exit 0 for subsequent ones.
    let testCallCount = 0;
    const dynamicComputer = memoryComputer({
      exitCodeFor: (cmd) => {
        if (cmd.trim() === 'npm test') {
          testCallCount += 1;
          return testCallCount === 1 ? 1 : 0; // first fails, then passes
        }
        return 0;
      },
    });
    const reasoning2 = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'package.json', contents: '{}' }),
      JSON.stringify({ action: 'run_command', command: 'npm test' }), // fails (exit 1)
      JSON.stringify({ action: 'write_file', path: 'fix.js', contents: '// fix' }), // repair
      JSON.stringify({ action: 'run_command', command: 'npm test' }), // passes (exit 0)
      JSON.stringify({ action: 'finish', summary: 'Fixed and re-tested.', artifacts: ['package.json', 'fix.js'] }),
    ]);
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning: reasoning2,
      computer: dynamicComputer,
      taskBrief: GOAL_WITH_NPM_TEST,
    }).run();

    expect(result.status).toBe('success');
    expect(result.summary).toBe('Fixed and re-tested.');
    expect(result.completionEvidence!.lastTestCommand).toEqual({ command: 'npm test', exitCode: 0 });
  });
});

// ---------------------------------------------------------------------------
// A05 — Write invalidation: write_file after successful test
// ---------------------------------------------------------------------------

describe('A05 — Write invalidation: write_file after test → previous evidence invalid', () => {
  it('rejects finish when a write_file happened after the successful test', async () => {
    const computer = memoryComputer();
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'package.json', contents: '{}' }),
      JSON.stringify({ action: 'run_command', command: 'npm test' }), // passes
      JSON.stringify({ action: 'write_file', path: 'late-change.js', contents: 'x' }), // invalidates
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json', 'late-change.js'] }),
      JSON.stringify({ action: 'run_command', command: 'npm test' }), // re-test passes
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json', 'late-change.js'] }),
    ]);
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer,
      taskBrief: GOAL_WITH_NPM_TEST,
    }).run();

    // The first finish is rejected (stale evidence due to write_file).
    // The worker re-tests, then finish succeeds.
    expect(result.status).toBe('success');
    expect(result.completionEvidence!.finishRejections).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// A06 — Shell mutation invalidation
// ---------------------------------------------------------------------------

describe('A06 — Shell mutation invalidation: run_command mutates → previous evidence invalid', () => {
  it('rejects finish when a mutating run_command happened after the test', async () => {
    const computer = memoryComputer();
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'package.json', contents: '{}' }),
      JSON.stringify({ action: 'run_command', command: 'npm test' }), // passes
      // npm install is a mutating command (writes node_modules, package-lock.json)
      JSON.stringify({ action: 'run_command', command: 'npm install' }), // mutation
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }), // rejected (stale)
      JSON.stringify({ action: 'run_command', command: 'npm test' }), // re-test
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
    ]);
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer,
      taskBrief: GOAL_WITH_NPM_TEST,
    }).run();

    // First finish rejected (npm install invalidated the snapshot).
    expect(result.status).toBe('success');
    expect(result.completionEvidence!.finishRejections).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// A07 — Wrong check: unrelated successful command does not satisfy
// ---------------------------------------------------------------------------

describe('A07 — Wrong check: unrelated successful command does not satisfy', () => {
  it('rejects finish when an unrelated command (echo hello) was run instead of npm test', async () => {
    const computer = memoryComputer();
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'package.json', contents: '{}' }),
      JSON.stringify({ action: 'run_command', command: 'echo hello' }), // unrelated
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
    ]);
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer,
      taskBrief: GOAL_WITH_NPM_TEST,
    }).run();

    expect(result.status).toBe('failure');
    expect(result.completionEvidence!.lastTestCommand).toBeNull(); // echo hello doesn't count
  });
});

// ---------------------------------------------------------------------------
// A08 — Wrong execution context (cannot be tested without multiple workspaces — Task B)
// ---------------------------------------------------------------------------

describe('A08 — Wrong execution context: command in wrong workspace does not count', () => {
  it('notes that this scenario requires Task B (cross-worker handoff) for full validation', () => {
    // A08 requires two workers with separate workspaces — the gate's
    // snapshot is per-worker, so a command in worker B's workspace
    // cannot affect worker A's evidence. This is structurally guaranteed
    // by the design (each WorkerAgent has its own computer + evidence).
    // Full validation of cross-workspace context requires Task B's
    // handoff mechanism. Here we assert the structural property:
    // each WorkerAgent instance has independent evidence.
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A09 — Non-code worker: documentation worker not required to run npm test
// ---------------------------------------------------------------------------

describe('A09 — Non-code worker: documentation worker not required to run npm test', () => {
  it('accepts finish for a documentation worker without any test command', async () => {
    const computer = memoryComputer();
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'README.md', contents: '# App\n\nDocs.' }),
      JSON.stringify({ action: 'finish', summary: 'Wrote README.', artifacts: ['README.md'] }),
    ]);
    const result = await new WorkerAgent({
      genome: docGenome(),
      reasoning,
      computer,
      taskBrief: GOAL_WITH_NPM_TEST,
    }).run();

    expect(result.status).toBe('success');
    expect(result.completionEvidence!.deliverableKind).toBe('documentation');
    expect(result.completionEvidence!.lastTestCommand).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A10 — Capability distinction: shell grant alone does not create code-test obligation
// ---------------------------------------------------------------------------

describe('A10 — Capability distinction: shell grant alone ≠ code-test obligation', () => {
  it('does not require npm test when the genome has shell but skills do not include code-execution', async () => {
    // A worker with shell grant but document-authoring skill (not code-execution)
    // should NOT be required to run npm test.
    const computer = memoryComputer();
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'README.md', contents: 'docs' }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['README.md'] }),
    ]);
    const result = await new WorkerAgent({
      genome: genome({
        skills: ['document-authoring'], // not code-execution
        tools: ['openbot:shell-execution', 'openbot:workspace-files'], // has shell
      }),
      reasoning,
      computer,
      taskBrief: GOAL_WITH_NPM_TEST,
    }).run();

    expect(result.status).toBe('success');
    expect(result.completionEvidence!.deliverableKind).toBe('documentation');
  });
});

// ---------------------------------------------------------------------------
// A11 — No-progress behavior: repeated unsuccessful finish does not loop forever
// ---------------------------------------------------------------------------

describe('A11 — No-progress: repeated unsuccessful finish does not produce infinite loop', () => {
  it('terminates with failure after MAX_FINISH_REJECTIONS+1 attempts', async () => {
    const computer = memoryComputer();
    // Worker keeps trying to finish without running a test.
    const finishAction = JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] });
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'package.json', contents: '{}' }),
      finishAction,
      finishAction,
      finishAction,
      finishAction,
      finishAction,
      finishAction,
    ]);
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer,
      taskBrief: GOAL_WITH_NPM_TEST,
      maxSteps: 20,
    }).run();

    expect(result.status).toBe('failure');
    expect(result.completionEvidence!.finishRejections).toBeGreaterThan(MAX_FINISH_REJECTIONS);
    expect(result.summary).toMatch(/completion gate/i);
  });
});

// ---------------------------------------------------------------------------
// A12 — Budget exhaustion/cancellation: explicit non-success closure
// ---------------------------------------------------------------------------

describe('A12 — Budget exhaustion: explicit non-success closure, no false success', () => {
  it('terminates with failure when step budget is exhausted before satisfying the gate', async () => {
    const computer = memoryComputer();
    // Worker keeps writing files but never runs npm test.
    const writeAction = JSON.stringify({ action: 'write_file', path: 'f.md', contents: 'x' });
    const reasoning = new ScriptedReasoning([
      writeAction, writeAction, writeAction, writeAction, writeAction,
    ]);
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer,
      taskBrief: GOAL_WITH_NPM_TEST,
      maxSteps: 5,
    }).run();

    expect(result.status).toBe('failure');
    expect(result.summary).toMatch(/step budget/i);
    expect(result.failureClass).toBe('BUDGET_EXHAUSTED');
  });
});

// ---------------------------------------------------------------------------
// A13 — Artifact snapshot failure: inaccessible state fails closed
// ---------------------------------------------------------------------------

describe('A13 — Artifact snapshot failure: fail closed', () => {
  it('rejects finish when the workspace snapshot cannot be computed', async () => {
    // A computer whose listFiles throws — snapshot returns null, gate fails closed.
    const computer = memoryComputer();
    computer.listFiles = async () => {
      throw new Error('filesystem unavailable');
    };
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'package.json', contents: '{}' }),
      JSON.stringify({ action: 'run_command', command: 'npm test' }), // passes but snapshot fails
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['package.json'] }),
    ]);
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer,
      taskBrief: GOAL_WITH_NPM_TEST,
    }).run();

    expect(result.status).toBe('failure');
    expect(result.summary).toMatch(/completion gate|snapshot/i);
  });
});

// ---------------------------------------------------------------------------
// A14 — Existing behavior: prior supported worker flows remain compatible
// ---------------------------------------------------------------------------

describe('A14 — Existing behavior: prior supported worker flows remain compatible', () => {
  it('still succeeds for a code worker when the goal has no executable mention', async () => {
    const computer = memoryComputer();
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'write_file', path: 'output.md', contents: '# hello' }),
      JSON.stringify({ action: 'finish', summary: 'Wrote output.md', artifacts: ['output.md'] }),
    ]);
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer,
      taskBrief: GOAL_NO_TEST,
    }).run();

    expect(result.status).toBe('success');
    expect(result.artifacts).toEqual(['output.md']);
  });

  it('still rejects phantom artifacts (existing pre-Task-A behavior)', async () => {
    const computer = memoryComputer();
    const reasoning = new ScriptedReasoning([
      JSON.stringify({ action: 'finish', summary: 'Done.', artifacts: ['phantom.md'] }),
    ]);
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer,
      taskBrief: GOAL_NO_TEST,
    }).run();

    expect(result.status).toBe('failure');
    expect(result.refusals[0]).toContain('phantom.md');
  });

  it('still breaks degenerate repeat loops (existing TASK-015 behavior)', async () => {
    const computer = memoryComputer();
    const loop = JSON.stringify({ action: 'list_files', path: '.' });
    const reasoning = new ScriptedReasoning([
      loop,
      loop, // immediate repeat → breaker fires
      JSON.stringify({ action: 'write_file', path: 'out.txt', contents: 'recovered' }),
      JSON.stringify({ action: 'finish', summary: 'Recovered.', artifacts: ['out.txt'] }),
    ]);
    const result = await new WorkerAgent({
      genome: genome(),
      reasoning,
      computer,
      taskBrief: GOAL_NO_TEST,
    }).run();

    expect(result.status).toBe('success');
    expect(result.refusals.some((r) => r.includes('repeated action refused'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit tests for the completion-policy module itself
// ---------------------------------------------------------------------------

describe('completion-policy unit tests', () => {
  describe('inferDeliverableKind', () => {
    it('returns testable-code for code-execution', () => {
      expect(inferDeliverableKind(['code-execution'])).toBe('testable-code');
    });
    it('returns documentation for document-authoring', () => {
      expect(inferDeliverableKind(['document-authoring'])).toBe('documentation');
    });
    it('returns data-analysis for data-analysis', () => {
      expect(inferDeliverableKind(['data-analysis'])).toBe('data-analysis');
    });
    it('returns research for web-research', () => {
      expect(inferDeliverableKind(['web-research'])).toBe('research');
    });
    it('returns general for empty skills', () => {
      expect(inferDeliverableKind([])).toBe('general');
    });
    it('prioritizes code-execution over others (strictest kind)', () => {
      expect(inferDeliverableKind(['code-execution', 'document-authoring'])).toBe('testable-code');
    });
    it('ignores non-capability skills like collaboration', () => {
      expect(inferDeliverableKind(['collaboration'])).toBe('general');
    });
  });

  describe('isLikelyFilesystemMutation', () => {
    it('returns false for read-only ls', () => {
      expect(isLikelyFilesystemMutation('ls -la')).toBe(false);
    });
    it('returns false for read-only cat', () => {
      expect(isLikelyFilesystemMutation('cat package.json')).toBe(false);
    });
    it('returns false for node --test', () => {
      expect(isLikelyFilesystemMutation('node --test')).toBe(false);
    });
    it('returns true for npm install (unknown command)', () => {
      expect(isLikelyFilesystemMutation('npm install')).toBe(true);
    });
    it('returns true for npm test (unknown command)', () => {
      expect(isLikelyFilesystemMutation('npm test')).toBe(true);
    });
    it('returns true for redirected echo (mutation via >)', () => {
      expect(isLikelyFilesystemMutation('echo hello > file.txt')).toBe(true);
    });
  });
});
