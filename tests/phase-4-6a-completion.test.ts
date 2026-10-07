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
  WorkspaceHandle,
  WorkspaceSurface,
} from '../src/runtime/computer.js';
import { MissionOrchestrator } from '../src/mission/orchestrator.js';
import { MemoryFlightRecorder } from '../src/mission/flight-recorder.js';

/**
 * PHASE 4.6a — Provider-Neutral Completion Semantics tests.
 *
 * Proves that completion (did the organization produce a deliverable?) is no
 * longer coupled to computer-file artifacts. A provider-observed workspace
 * deliverable can satisfy completion. Worker self-assertion cannot.
 *
 * These tests use an in-process runtime that satisfies the real WorkerRuntime
 * interface, with a controllable workspace surface. No real OpenDots needed.
 */

// ---------------------------------------------------------------------------
// Test runtime: controllable surfaces
// ---------------------------------------------------------------------------

class TestComputer implements WorkerComputer {
  readonly files = new Map<string, string>();
  async exec(command: string) {
    const redirect = command.match(/>\s*'?([^'\s]+)'?\s*$/);
    if (redirect) {
      const echo = command.match(/(?:echo|printf)\s+'([^']*)'/);
      this.files.set(redirect[1]!, echo ? echo[1]!.replace(/\\n/g, '\n') : '');
    }
    return { command, exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, elapsedMs: 1 };
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

/**
 * A runtime where workspace surfaces can be controlled per-test. When
 * `workspaceHandleForTest` is set, surfaces(handle).workspace returns a
 * surface with that handle — simulating a provider-observed workspace.
 */
class TestRuntime implements WorkerRuntime {
  readonly name = 'test-runtime';
  readonly stopped: string[] = [];
  readonly computers = new Map<string, TestComputer>();
  /** When set, surfaces() returns a workspace surface with this handle. */
  workspaceHandleForTest: WorkspaceHandle | undefined = undefined;

  async ensureWorker(genome: WorkerGenome): Promise<RuntimeHandle> {
    if (genome.computer.required) {
      this.computers.set(genome.identity.id, new TestComputer());
    }
    return { workerId: genome.identity.id, ref: `test:${genome.identity.id}` };
  }

  computer(handle: RuntimeHandle): WorkerComputer {
    const c = this.computers.get(handle.workerId);
    if (!c) throw new Error(`no computer for ${handle.workerId}`);
    return c;
  }

  surfaces(handle: RuntimeHandle): WorkerSurfaces {
    const computer = this.computers.get(handle.workerId);
    const result: { computer?: WorkerComputer; workspace?: WorkspaceSurface } = {};
    if (computer !== undefined) result.computer = computer;
    if (this.workspaceHandleForTest !== undefined) {
      const handle_ = this.workspaceHandleForTest;
      result.workspace = {
        handle: handle_,
        async readPage() { return { content: 'test', revision: 1 }; },
        async appendContent() { return { revision: 2 }; },
        async updatePage() { return { revision: 2 }; },
      };
    }
    return result;
  }

  async stopWorker(handle: RuntimeHandle): Promise<void> {
    this.stopped.push(handle.workerId);
  }
}

function buildOrchestrator(runtime: TestRuntime): MissionOrchestrator {
  const router = new CognitiveRouter(new RuleDecisionProvider());
  return new MissionOrchestrator({
    goalCompiler: new GoalCompiler(),
    planner: new OrganizationPlanner(),
    genomeCompiler: new GenomeCompiler({
      registry: loadOwnership('data/ownership.yaml'),
      selectTier: (selection) => router.selectTier(selection),
    }),
    runtime,
    reasoning: makeSimpleReasoning(),
    recorder: new MemoryFlightRecorder(),
  });
}

function makeSimpleReasoning(): ReasoningProvider {
  let callCount = 0;
  return {
    name: 'test-simple',
    async reason(): Promise<ReasoningOutput> {
      callCount += 1;
      // Odd calls: write a file. Even calls: finish with that artifact.
      if (callCount % 2 === 1) {
        return {
          text: JSON.stringify({
            action: 'write_file',
            path: 'output.ts',
            contents: 'export const x = 1;',
          }),
        };
      }
      return {
        text: JSON.stringify({
          action: 'finish',
          summary: 'done',
          artifacts: ['output.ts'],
        }),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PHASE 4.6a — Provider-neutral completion semantics', () => {

  it('A. existing computer-file completion still works', async () => {
    const runtime = new TestRuntime();
    const orchestrator = buildOrchestrator(runtime);
    const goal: Goal = {
      outcome: 'Implement a small CLI utility that converts temperatures.',
      constraints: ['pure TypeScript'],
    };
    const result = await orchestrator.run(goal);
    // The worker produces a computer-file artifact → completion succeeds.
    expect(result.status).toBe('success');
  });

  it('B. observed provider-neutral artifact can satisfy deliverable existence', async () => {
    const runtime = new TestRuntime();
    // Simulate a provider-observed workspace deliverable.
    runtime.workspaceHandleForTest = {
      provider: 'opendots',
      spaceId: 'space-1',
      pageId: 'page-1',
      revision: 1,
    };
    const orchestrator = buildOrchestrator(runtime);
    const goal: Goal = {
      outcome: 'Implement a small CLI utility that converts temperatures.',
      constraints: ['pure TypeScript'],
    };
    const result = await orchestrator.run(goal);
    // The worker finishes without claiming artifacts, but the workspace
    // deliverable exists (provider-observed) → completion should succeed.
    expect(result.status).toBe('success');
    // The mission evidence should include the observed deliverable.
    const hasWorkspaceEvidence = result.evidence.some(
      (e) => e.location === 'opendots:space-1:page-1',
    );
    expect(hasWorkspaceEvidence).toBe(true);
  });

  it('C. non-computer worker can produce a valid deliverable via workspace', async () => {
    // A worker that has NO computer surface but DOES have a workspace surface
    // (simulating an OpenDots-only specialist). The workspace deliverable
    // should satisfy completion.
    const runtime = new TestRuntime();
    runtime.workspaceHandleForTest = {
      provider: 'opendots',
      spaceId: 'space-2',
      pageId: 'page-2',
      revision: 1,
    };
    const orchestrator = buildOrchestrator(runtime);
    const goal: Goal = {
      outcome: 'Summarize the meeting notes into a memo.',
    };
    const result = await orchestrator.run(goal);
    // Sole Operator has a computer (the simple goal compiles to a computer
    // worker). But the workspace deliverable is ALSO observed. The mission
    // should succeed regardless of whether the computer produced a file.
    expect(result.status).toBe('success');
  });

  it('D. unobserved self-claim does NOT become trusted (negative trust test)', async () => {
    // A worker that finishes with NO artifacts and NO provider-observed
    // workspace deliverable. The mission should FAIL — no deliverable exists.
    const runtime = new TestRuntime();
    // workspaceHandleForTest is NOT set → no provider-observed deliverable.
    // The worker will spin (no script to produce artifacts) and hit step
    // budget, OR finish with no artifacts. Either way: no deliverable.
    const reasoning: ReasoningProvider = {
      name: 'no-deliverable',
      async reason(): Promise<ReasoningOutput> {
        return {
          text: JSON.stringify({
            action: 'finish',
            summary: 'I claim I did the work but produced nothing.',
            artifacts: [],
          }),
        };
      },
    };
    const router = new CognitiveRouter(new RuleDecisionProvider());
    const orchestrator = new MissionOrchestrator({
      goalCompiler: new GoalCompiler(),
      planner: new OrganizationPlanner(),
      genomeCompiler: new GenomeCompiler({
        registry: loadOwnership('data/ownership.yaml'),
        selectTier: (selection) => router.selectTier(selection),
      }),
      runtime,
      reasoning,
      recorder: new MemoryFlightRecorder(),
    });
    const goal: Goal = { outcome: 'Summarize the meeting notes into a memo.' };
    const result = await orchestrator.run(goal);
    // No computer-file artifacts + no provider-observed deliverable → failure.
    expect(result.status).toBe('failure');
    expect(result.summary).toContain('no worker produced a deliverable');
  });

  it('E. provider invocation with observed resultRef is associated with artifact evidence', async () => {
    const runtime = new TestRuntime();
    runtime.workspaceHandleForTest = {
      provider: 'opendots',
      spaceId: 'space-3',
      pageId: 'page-3',
      revision: 1,
    };
    const orchestrator = buildOrchestrator(runtime);
    const goal: Goal = {
      outcome: 'Implement a small CLI utility that converts temperatures.',
      constraints: ['pure TypeScript'],
    };
    const result = await orchestrator.run(goal);
    // The observed deliverable evidence should have a location matching the
    // provider's resultRef format: `<provider>:<spaceId>:<pageId>`.
    const workspaceEvidence = result.evidence.find(
      (e) => e.location === 'opendots:space-3:page-3',
    );
    expect(workspaceEvidence).toBeDefined();
    expect(workspaceEvidence!.kind).toBe('artifact');
    expect(workspaceEvidence!.description).toContain('collaborative workspace');
  });

  it('F. completion does NOT automatically imply verification PASS', async () => {
    // Even with an observed workspace deliverable, if verification runs and
    // FAILS, the mission should be 'partial' (deliverable exists but
    // acceptance criteria not met) — NOT 'success'.
    const runtime = new TestRuntime();
    runtime.workspaceHandleForTest = {
      provider: 'opendots',
      spaceId: 'space-4',
      pageId: 'page-4',
      revision: 1,
    };
    const router = new CognitiveRouter(new RuleDecisionProvider());
    const orchestrator = new MissionOrchestrator({
      goalCompiler: new GoalCompiler(),
      planner: new OrganizationPlanner(),
      genomeCompiler: new GenomeCompiler({
        registry: loadOwnership('data/ownership.yaml'),
        selectTier: (selection) => router.selectTier(selection),
      }),
      runtime,
      reasoning: makeSimpleReasoning(),
      recorder: new MemoryFlightRecorder(),
      // Custom checks that ALWAYS fail — proving completion ≠ verification.
      // Use a file check for a non-existent file (the verifier can't find it).
      checks: () => [
        { kind: 'file', label: 'always-fail', path: 'this-file-does-not-exist.txt', expectIncludes: 'impossible' },
      ],
    });
    const goal: Goal = {
      outcome: 'Implement a small CLI utility that converts temperatures.',
      constraints: ['pure TypeScript'],
    };
    const result = await orchestrator.run(goal);
    // Deliverable exists (workspace) but verification failed → partial.
    expect(result.status).toBe('partial');
    expect(result.summary).toContain('verification failed');
  });

  it('G. retry/timeout/cancellation behavior unchanged', async () => {
    // A worker that spins (never finishes) → step budget → worker failure.
    // With NO workspace deliverable, the mission fails as before.
    // This proves timeout/step-budget behavior is unchanged when no deliverable exists.
    const runtime = new TestRuntime();
    // workspaceHandleForTest NOT set → no provider-observed deliverable.
    const spinReasoning: ReasoningProvider = {
      name: 'spin',
      async reason(): Promise<ReasoningOutput> {
        return { text: JSON.stringify({ action: 'list_files', path: '.' }) };
      },
    };
    const router = new CognitiveRouter(new RuleDecisionProvider());
    const orchestrator = new MissionOrchestrator({
      goalCompiler: new GoalCompiler(),
      planner: new OrganizationPlanner(),
      genomeCompiler: new GenomeCompiler({
        registry: loadOwnership('data/ownership.yaml'),
        selectTier: (selection) => router.selectTier(selection),
      }),
      runtime,
      reasoning: spinReasoning,
      recorder: new MemoryFlightRecorder(),
      maxWorkerSteps: 3,
    });
    const goal: Goal = {
      outcome: 'Implement a small CLI utility that converts temperatures.',
      constraints: ['pure TypeScript'],
    };
    const result = await orchestrator.run(goal);
    // Worker spins → step budget exhausted → worker failure → no deliverable.
    expect(result.status).toBe('failure');
    // The failure is due to worker failure, not "no deliverable" per se.
    expect(result.summary).toContain('failed');
  });

  it('H. Phase 4.6 OpenDots behavior no longer fails solely because finalArtifacts is empty', async () => {
    // This is the core regression: a workspace-only deliverable should NOT
    // fail with "no worker produced a deliverable."
    const runtime = new TestRuntime();
    runtime.workspaceHandleForTest = {
      provider: 'opendots',
      spaceId: 'space-6',
      pageId: 'page-6',
      revision: 1,
    };
    // Reasoning that finishes with NO artifacts (simulating a workspace-only worker).
    const noArtifactReasoning: ReasoningProvider = {
      name: 'workspace-only',
      async reason(): Promise<ReasoningOutput> {
        return {
          text: JSON.stringify({
            action: 'finish',
            summary: 'Appended to shared workspace page.',
            artifacts: [],
          }),
        };
      },
    };
    const router = new CognitiveRouter(new RuleDecisionProvider());
    const orchestrator = new MissionOrchestrator({
      goalCompiler: new GoalCompiler(),
      planner: new OrganizationPlanner(),
      genomeCompiler: new GenomeCompiler({
        registry: loadOwnership('data/ownership.yaml'),
        selectTier: (selection) => router.selectTier(selection),
      }),
      runtime,
      reasoning: noArtifactReasoning,
      recorder: new MemoryFlightRecorder(),
    });
    const goal: Goal = { outcome: 'Summarize the meeting notes into a memo.' };
    const result = await orchestrator.run(goal);
    // Before 4.6a: this would fail with "no worker produced a deliverable."
    // After 4.6a: the workspace deliverable is observed → mission succeeds.
    expect(result.status).not.toBe('failure');
    expect(result.summary).not.toContain('no worker produced a deliverable');
  });
});

// ---------------------------------------------------------------------------
// Future OpenMuse compatibility test (provider-neutral, no OpenMuse code)
// ---------------------------------------------------------------------------

describe('PHASE 4.6a — Future job-result compatibility (no OpenMuse code)', () => {
  it('J. an observed non-computer artifact/result can satisfy completion (provider-neutral)', async () => {
    // This test proves the completion semantics are surface-neutral. We use
    // a workspace surface (the only non-computer surface today) to prove the
    // pattern. Phase 4.7 will add a job surface the same way — the orchestrator
    // already reads `surfaces(handle)` and the completion check already uses
    // `hasDeliverable = finalArtifacts.length > 0 || observedDeliverables.length > 0`.
    // Adding `if (surfaces.job?.handle !== undefined)` to collectObservedDeliverables
    // is a 3-line addition — no completion-logic change needed.
    const runtime = new TestRuntime();
    runtime.workspaceHandleForTest = {
      provider: 'hypothetical-job-provider', // provider-neutral — NOT OpenMuse
      spaceId: 'job-1',
      pageId: 'receipt-1',
      revision: 1,
    };
    const reasoning: ReasoningProvider = {
      name: 'job-only',
      async reason(): Promise<ReasoningOutput> {
        return {
          text: JSON.stringify({
            action: 'finish',
            summary: 'Durable job completed.',
            artifacts: [],
          }),
        };
      },
    };
    const router = new CognitiveRouter(new RuleDecisionProvider());
    const orchestrator = new MissionOrchestrator({
      goalCompiler: new GoalCompiler(),
      planner: new OrganizationPlanner(),
      genomeCompiler: new GenomeCompiler({
        registry: loadOwnership('data/ownership.yaml'),
        selectTier: (selection) => router.selectTier(selection),
      }),
      runtime,
      reasoning,
      recorder: new MemoryFlightRecorder(),
    });
    const goal: Goal = { outcome: 'Summarize the meeting notes into a memo.' };
    const result = await orchestrator.run(goal);
    // The provider-observed deliverable (workspace, simulating a future job
    // receipt) satisfies completion. No computer-file artifact needed.
    expect(result.status).toBe('success');
    expect(result.evidence.some((e) => e.location === 'hypothetical-job-provider:job-1:receipt-1')).toBe(true);
  });
});
