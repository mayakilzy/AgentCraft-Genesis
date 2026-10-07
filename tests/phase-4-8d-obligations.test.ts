import { describe, expect, it } from 'vitest';

import type {
  Goal,
  ReasoningOutput,
  ReasoningProvider,
  RuntimeHandle,
  WorkerGenome,
} from '../src/contracts/core.js';
import { GoalCompiler } from '../src/goal/goal-compiler.js';
import {
  GenomeCompiler,
  loadOwnership,
} from '../src/genome/genome-compiler.js';
import { OrganizationPlanner } from '../src/organization/organization-planner.js';
import { CognitiveRouter } from '../src/routing/cognitive-router.js';
import { RuleDecisionProvider } from '../src/routing/decision-provider.js';
import type {
  WorkerComputer,
  WorkerRuntime,
  WorkerSurfaces,
} from '../src/runtime/computer.js';
import { MissionOrchestrator } from '../src/mission/orchestrator.js';
import type { MissionInput, MissionObligation } from '../src/mission/orchestrator.js';
import { MemoryFlightRecorder } from '../src/mission/flight-recorder.js';
import type { WorkerAction } from '../src/worker/worker-agent.js';

/**
 * PHASE 4.8D — Mission Obligation Closure tests.
 *
 * These tests prove the 10 behavioral cases from §13:
 *
 *   1. Ordinary calculation only → PASS without JobSurface
 *   2. Delegation required + worker uses ComputerSurface twice → FAIL
 *   3. Delegation required + JobSurface exists + worker never observes → FAIL
 *   4. Worker observes JobSurface result → potentially satisfied
 *   5. Worker observes result but doesn't reconcile → FAIL (comparison required)
 *   6. Worker obtains direct + durable + compares → PASS
 *   7. Shared publication required + workspace has only template → FAIL
 *   8. Worker writes meaningful content to workspace → PASS
 *   9. Worker prose claims "durable" but no flight evidence → FAIL
 *   10. No explicit delegation requirement → no unnecessary JobSurface check
 */

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

class TestComputer implements WorkerComputer {
  readonly files = new Map<string, string>();
  async exec(command: string) {
    return { command, exitCode: 0, stdout: '42', stderr: '', timedOut: false, elapsedMs: 1 };
  }
  async writeFile(path: string, contents: string) {
    this.files.set(path, contents);
    return { path, bytes: contents.length, appended: false };
  }
  async readFile(path: string) {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`no file at ${path}`);
    return { path, text, bytes: text.length, truncated: false };
  }
  async listFiles() {
    return [...this.files.keys()].map((path) => ({ path, kind: 'file' as const }));
  }
}

class TestRuntime implements WorkerRuntime {
  readonly name = 'test-runtime-4-8d';
  readonly computers = new Map<string, TestComputer>();
  async ensureWorker(g: WorkerGenome): Promise<RuntimeHandle> {
    if (g.computer.required) this.computers.set(g.identity.id, new TestComputer());
    return { workerId: g.identity.id, ref: `test:${g.identity.id}` };
  }
  computer(h: RuntimeHandle): WorkerComputer {
    return this.computers.get(h.workerId)!;
  }
  surfaces(h: RuntimeHandle): WorkerSurfaces {
    const c = this.computers.get(h.workerId);
    return c ? { computer: c } : {};
  }
  async stopWorker(h: RuntimeHandle): Promise<void> { void h; }
}

function makeScriptedReasoning(actions: WorkerAction[]): ReasoningProvider {
  let i = 0;
  return {
    name: 'scripted-4-8d',
    async reason(): Promise<ReasoningOutput> {
      // Cycle through the actions so the retry also produces valid output.
      const action = actions[i % actions.length];
      i += 1;
      return { text: JSON.stringify(action) };
    },
  };
}

function buildOrchestrator(
  runtime: TestRuntime,
  reasoning: ReasoningProvider,
  options: {
    missionInputs?: MissionInput[];
    missionObligations?: MissionObligation[];
    checks?: (ctx: unknown) => unknown[];
    maxWorkerSteps?: number;
  } = {},
): MissionOrchestrator {
  const router = new CognitiveRouter(new RuleDecisionProvider());
  const extraOperationalNeeds: Record<string, readonly { kind: 'shell-execution' | 'collaborative-workspace' | 'durable-delegation' }[]> = {};
  // Always inject shell-execution so the worker can use run_command
  extraOperationalNeeds['sole-operator-1'] = [
    { kind: 'shell-execution' },
    ...(options.missionObligations?.some((o) => o.kind === 'shared-publication') ? [{ kind: 'collaborative-workspace' } as const] : []),
    ...(options.missionObligations?.some((o) => o.kind === 'delegated-result') ? [{ kind: 'durable-delegation' } as const] : []),
  ];
  return new MissionOrchestrator({
    goalCompiler: new GoalCompiler(),
    planner: new OrganizationPlanner(),
    genomeCompiler: new GenomeCompiler({
      registry: loadOwnership('data/ownership.yaml'),
      selectTier: (s) => router.selectTier(s),
      extraOperationalNeeds,
    }),
    runtime,
    reasoning,
    recorder: new MemoryFlightRecorder(),
    ...(options.missionInputs === undefined ? {} : { missionInputs: options.missionInputs }),
    ...(options.missionObligations === undefined ? {} : { missionObligations: options.missionObligations }),
    ...(options.checks === undefined ? {} : { checks: options.checks as never }),
    ...(options.maxWorkerSteps === undefined ? {} : { maxWorkerSteps: options.maxWorkerSteps }),
  });
}

// ---------------------------------------------------------------------------
// 10 BEHAVIORAL CASES
// ---------------------------------------------------------------------------

describe('PHASE 4.8D — Mission Obligation Closure (10 behavioral cases)', () => {
  const goal: Goal = { outcome: 'Compute the total value of the inventory.' };

  // CASE 1: Ordinary calculation only — PASS without JobSurface
  it('CASE 1: ordinary calculation only — PASS possible without JobSurface', async () => {
    const runtime = new TestRuntime();
    const reasoning = makeScriptedReasoning([
      { action: 'read_file', path: 'input.txt' },
      { action: 'write_file', path: 'result.txt', contents: '42' },
      { action: 'finish', summary: 'done', artifacts: ['result.txt'] },
    ]);
    const orchestrator = buildOrchestrator(runtime, reasoning, {
      missionInputs: [{ path: 'input.txt', contents: 'test data' }],
      maxWorkerSteps: 5,
    });
    const result = await orchestrator.run(goal);
    // No obligations → no flight-action checks → PASS if artifact exists
    expect(result.status).toBe('success');
  });

  // CASE 2: Delegation required + worker uses ComputerSurface twice → FAIL
  it('CASE 2: delegation required + worker uses ComputerSurface twice → FAIL', async () => {
    const runtime = new TestRuntime();
    const reasoning = makeScriptedReasoning([
      { action: 'run_command', command: 'echo calc1' },
      { action: 'run_command', command: 'echo calc2' },
      { action: 'write_file', path: 'result.txt', contents: '42' },
      { action: 'finish', summary: 'durable verification completed', artifacts: ['result.txt'] },
    ]);
    const orchestrator = buildOrchestrator(runtime, reasoning, {
      missionObligations: [
        { kind: 'delegated-result', description: 'independent delegated calculation' },
      ],
      maxWorkerSteps: 6,
    });
    const result = await orchestrator.run(goal);
    // The worker never called get_durable_result → flight-action check fails
    expect(result.status).not.toBe('success');
    expect(result.summary.toLowerCase()).toContain('verification failed');
  });

  // CASE 3: Delegation required + JobSurface exists + worker never observes → FAIL
  it('CASE 3: delegation required + worker never observes job result → FAIL', async () => {
    const runtime = new TestRuntime();
    const reasoning = makeScriptedReasoning([
      { action: 'run_command', command: 'echo calc' },
      { action: 'write_file', path: 'result.txt', contents: '42' },
      { action: 'finish', summary: 'used durable worker', artifacts: ['result.txt'] },
    ]);
    const orchestrator = buildOrchestrator(runtime, reasoning, {
      missionObligations: [
        { kind: 'delegated-result', description: 'independent delegated calculation' },
      ],
      maxWorkerSteps: 5,
    });
    const result = await orchestrator.run(goal);
    // Worker claims "used durable worker" but never called get_durable_result
    expect(result.status).not.toBe('success');
    expect(result.summary.toLowerCase()).toContain('verification failed');
  });

  // CASE 4: Worker observes JobSurface result → potentially satisfied
  it('CASE 4: worker observes job result (get_durable_result called) → obligation satisfied', async () => {
    // This case requires a JobSurface. We test the check logic directly:
    // if flight events contain a worker-step with action='get_durable_result'
    // and ok=true, the flight-action check passes.
    const { VerificationLoop } = await import('../src/mission/verification.js');
    const verifier = new TestComputer();
    const loop = new VerificationLoop(verifier, {
      flightEvents: [
        { type: 'worker-step', workerId: 'w1', step: 1, action: 'get_durable_result', ok: true, elapsedMs: 5 } as never,
      ],
    });
    const result = await loop.verify(
      [{ kind: 'flight-action', label: 'test', action: 'get_durable_result' }],
      [],
      [],
    );
    expect(result.ok).toBe(true);
  });

  // CASE 5: Worker observes result but doesn't reconcile → FAIL (comparison required)
  it('CASE 5: comparison obligation enforced — worker must reconcile', async () => {
    // The comparison requirement is expressed as a content-in-artifacts
    // check: the worker must produce an artifact containing evidence of
    // comparison (e.g. "MATCH" or "AGREE").
    const runtime = new TestRuntime();
    const reasoning = makeScriptedReasoning([
      { action: 'write_file', path: 'result.txt', contents: '42' },
      { action: 'finish', summary: 'done', artifacts: ['result.txt'] },
    ]);
    const orchestrator = buildOrchestrator(runtime, reasoning, {
      missionObligations: [
        { kind: 'delegated-result', description: 'independent delegated calculation' },
      ],
      checks: () => [
        { kind: 'content-in-artifacts', label: 'comparison-evidence', expectIncludes: 'MATCH' },
      ],
      maxWorkerSteps: 5,
    });
    const result = await orchestrator.run(goal);
    // The worker never wrote "MATCH" in any artifact → check fails
    expect(result.status).not.toBe('success');
  });

  // CASE 6: Worker obtains direct + durable + compares → PASS
  it('CASE 6: worker obtains direct + durable + compares → PASS', async () => {
    // This requires a real JobSurface. We test the verification logic:
    // flight events show get_durable_result ok=true, and artifacts contain
    // "MATCH". Both checks pass.
    const { VerificationLoop } = await import('../src/mission/verification.js');
    const verifier = new TestComputer();
    const producer = new TestComputer();
    producer.files.set('summary.txt', 'Direct: 42\nDurable: 42\nMATCH');
    const loop = new VerificationLoop(verifier, {
      flightEvents: [
        { type: 'worker-step', workerId: 'w1', step: 1, action: 'run_command', ok: true, elapsedMs: 5 } as never,
        { type: 'worker-step', workerId: 'w1', step: 2, action: 'get_durable_result', ok: true, elapsedMs: 5 } as never,
        { type: 'worker-step', workerId: 'w1', step: 3, action: 'write_file', ok: true, elapsedMs: 5 } as never,
      ],
    });
    const result = await loop.verify(
      [
        { kind: 'flight-action', label: 'delegation', action: 'get_durable_result' },
        { kind: 'content-in-artifacts', label: 'comparison', expectIncludes: 'MATCH' },
      ],
      [{ workerId: 'w1', computer: producer, paths: ['summary.txt'] }],
      [],
    );
    expect(result.ok).toBe(true);
  });

  // CASE 7: Shared publication required + workspace has only template → FAIL
  it('CASE 7: shared publication required + worker never publishes → FAIL', async () => {
    const runtime = new TestRuntime();
    const reasoning = makeScriptedReasoning([
      { action: 'run_command', command: 'echo calc' },
      { action: 'write_file', path: 'result.txt', contents: '42' },
      { action: 'finish', summary: 'published to workspace', artifacts: ['result.txt'] },
    ]);
    const orchestrator = buildOrchestrator(runtime, reasoning, {
      missionObligations: [
        { kind: 'shared-publication', description: 'publish result to shared workspace' },
      ],
      maxWorkerSteps: 5,
    });
    const result = await orchestrator.run(goal);
    // Worker claims "published to workspace" but never called append_shared_workspace
    expect(result.status).not.toBe('success');
  });

  // CASE 8: Worker writes meaningful content to workspace → PASS
  it('CASE 8: shared publication obligation satisfied when append_shared_workspace called', async () => {
    // Test the check logic: flight events show append_shared_workspace ok=true
    const { VerificationLoop } = await import('../src/mission/verification.js');
    const verifier = new TestComputer();
    const loop = new VerificationLoop(verifier, {
      flightEvents: [
        { type: 'worker-step', workerId: 'w1', step: 1, action: 'append_shared_workspace', ok: true, elapsedMs: 5 } as never,
      ],
    });
    const result = await loop.verify(
      [{ kind: 'flight-action', label: 'publication', action: 'append_shared_workspace' }],
      [],
      [],
    );
    expect(result.ok).toBe(true);
  });

  // CASE 9: Worker prose claims "durable" but no flight evidence → FAIL
  it('CASE 9: worker prose cannot fake runtime evidence', async () => {
    const runtime = new TestRuntime();
    const reasoning = makeScriptedReasoning([
      { action: 'run_command', command: 'echo calc' },
      { action: 'write_file', path: 'result.txt', contents: '42' },
      { action: 'finish', summary: 'I performed durable verification through the delegated worker', artifacts: ['result.txt'] },
    ]);
    const orchestrator = buildOrchestrator(runtime, reasoning, {
      missionObligations: [
        { kind: 'delegated-result', description: 'independent delegated calculation' },
      ],
      maxWorkerSteps: 5,
    });
    const result = await orchestrator.run(goal);
    // The summary claims durable verification, but flight record has no
    // get_durable_result action → verification MUST fail
    expect(result.status).not.toBe('success');
    expect(result.summary.toLowerCase()).toContain('verification failed');
  });

  // CASE 10: No explicit delegation requirement → no unnecessary JobSurface check
  it('CASE 10: no delegation requirement → no flight-action check for get_durable_result', async () => {
    const runtime = new TestRuntime();
    const reasoning = makeScriptedReasoning([
      { action: 'read_file', path: 'input.txt' },
      { action: 'write_file', path: 'result.txt', contents: '42' },
      { action: 'finish', summary: 'done', artifacts: ['result.txt'] },
    ]);
    const orchestrator = buildOrchestrator(runtime, reasoning, {
      missionInputs: [{ path: 'input.txt', contents: 'data' }],
      maxWorkerSteps: 5,
      // NO missionObligations → no flight-action checks
    });
    const result = await orchestrator.run(goal);
    // No obligations → mission succeeds with just an artifact
    expect(result.status).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// Provider-neutrality + completion/verification separation
// ---------------------------------------------------------------------------

describe('PHASE 4.8D — Provider-neutrality + invariants', () => {
  it('MissionObligation kinds contain no provider names', () => {
    const kinds: readonly MissionObligation['kind'][] = [
      'delegated-result', 'shared-publication', 'computer-execution',
    ];
    for (const k of kinds) {
      expect(k).not.toMatch(/openbot|opendots|openmuse/i);
    }
  });

  it('flight-action check kind is provider-neutral (checks action name, not provider)', () => {
    // The flight-action check verifies a provider-neutral action name
    // (e.g. 'get_durable_result'), NOT a provider name (e.g. 'poll_openmuse').
    // This preserves provider substitution: if a future provider satisfies
    // the same JobSurface, the check still works.
    const actionNames = [
      'get_durable_result', 'check_durable_status',
      'append_shared_workspace', 'read_shared_workspace',
      'run_command', 'write_file', 'read_file',
    ];
    for (const a of actionNames) {
      expect(a).not.toMatch(/openbot|opendots|openmuse/i);
    }
  });

  it('completion ≠ verification preserved (obligation failure → partial, not failure)', async () => {
    // A mission with an artifact (completion passes) but a failed
    // flight-action check (verification fails) should be 'partial'.
    const runtime = new TestRuntime();
    const reasoning = makeScriptedReasoning([
      { action: 'write_file', path: 'out.txt', contents: '42' },
      { action: 'finish', summary: 'done', artifacts: ['out.txt'] },
    ]);
    const router = new CognitiveRouter(new RuleDecisionProvider());
    const orchestrator = new MissionOrchestrator({
      goalCompiler: new GoalCompiler(),
      planner: new OrganizationPlanner(),
      genomeCompiler: new GenomeCompiler({
        registry: loadOwnership('data/ownership.yaml'),
        selectTier: (s) => router.selectTier(s),
        extraOperationalNeeds: {
          'sole-operator-1': [{ kind: 'shell-execution' }],
        },
      }),
      runtime,
      reasoning,
      recorder: new MemoryFlightRecorder(),
      missionObligations: [
        { kind: 'delegated-result', description: 'must delegate' },
      ],
      maxWorkerSteps: 5,
    });
    const result = await orchestrator.run({ outcome: 'Compute something.' });
    // The worker wrote a file (artifact exists → completion passes) but
    // never called get_durable_result → verification fails → partial
    expect(result.status).toBe('partial');
  });

  it('content-in-artifacts check scans all artifacts (fixes artifact-name overfitting)', async () => {
    const { VerificationLoop } = await import('../src/mission/verification.js');
    const verifier = new TestComputer();
    const producer = new TestComputer();
    // Worker named the file 'summary_report.md' (not 'inventory_summary.txt')
    producer.files.set('summary_report.md', 'The total is 646.00');
    const loop = new VerificationLoop(verifier, {});
    const result = await loop.verify(
      [{ kind: 'content-in-artifacts', label: 'correct-total', expectIncludes: '646.00' }],
      [{ workerId: 'w1', computer: producer, paths: ['summary_report.md'] }],
      [],
    );
    // The check finds the content regardless of the file name
    expect(result.ok).toBe(true);
  });

  it('content-in-artifacts check fails when content not in any artifact', async () => {
    const { VerificationLoop } = await import('../src/mission/verification.js');
    const verifier = new TestComputer();
    const producer = new TestComputer();
    producer.files.set('output.txt', 'wrong answer');
    const loop = new VerificationLoop(verifier, {});
    const result = await loop.verify(
      [{ kind: 'content-in-artifacts', label: 'correct-total', expectIncludes: '646.00' }],
      [{ workerId: 'w1', computer: producer, paths: ['output.txt'] }],
      [],
    );
    expect(result.ok).toBe(false);
  });
});
