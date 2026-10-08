/**
 * D-FAILURE — G6-07 Section 5 Failure Injection Matrix audit tests.
 *
 * These tests REPRODUCE the 5 most critical UNTESTED scenarios identified by
 * the failure-injection matrix survey. They run against the real Genesis
 * source (no mocks beyond the in-memory runtime and scripted reasoning).
 *
 * The file lives OUTSIDE the project's tests/ directory so it never runs as
 * part of the regular suite. Invoke it via the companion vitest config:
 *
 *   cd /home/z/my-project/audit-work/AgentCraft-Genesis
 *   npx vitest run --config /home/z/my-project/scripts/audit-vitest.config.ts
 *
 * Each test names the gap it covers and asserts the loud/silent expectation.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

import { MissionService } from '../audit-work/AgentCraft-Genesis/src/gateway/mission-service.js';
import type {
  CallerIdentity,
  MissionSubmission,
} from '../audit-work/AgentCraft-Genesis/src/gateway/types.js';
import { MissionAdmissionError } from '../audit-work/AgentCraft-Genesis/src/gateway/types.js';
import type {
  Goal,
  ReasoningInput,
  ReasoningOutput,
  ReasoningProvider,
  RuntimeHandle,
  WorkerGenome,
} from '../audit-work/AgentCraft-Genesis/src/contracts/core.js';
import type {
  WorkerComputer,
  WorkerRuntime,
  WorkerSurfaces,
} from '../audit-work/AgentCraft-Genesis/src/runtime/computer.js';
import { MemoryComputer } from '../audit-work/AgentCraft-Genesis/tests/helpers/memory-runtime.js';
import { GoalCompiler } from '../audit-work/AgentCraft-Genesis/src/goal/goal-compiler.js';
import {
  GenomeCompiler,
  loadOwnership,
} from '../audit-work/AgentCraft-Genesis/src/genome/genome-compiler.js';
import { OrganizationPlanner } from '../audit-work/AgentCraft-Genesis/src/organization/organization-planner.js';
import { CognitiveRouter } from '../audit-work/AgentCraft-Genesis/src/routing/cognitive-router.js';
import { RuleDecisionProvider } from '../audit-work/AgentCraft-Genesis/src/routing/decision-provider.js';
import { MissionOrchestrator } from '../audit-work/AgentCraft-Genesis/src/mission/orchestrator.js';
import { MemoryFlightRecorder } from '../audit-work/AgentCraft-Genesis/src/mission/flight-recorder.js';
import { WorkerAgent } from '../audit-work/AgentCraft-Genesis/src/worker/worker-agent.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CALLER_A: CallerIdentity = {
  callerId: 'caller-a-audit',
  allowedOperations: ['mission:submit'],
  maxActiveMissions: 5,
  maxMissionTimeoutMs: 30_000,
};

const CALLER_B: CallerIdentity = {
  callerId: 'caller-b-audit',
  allowedOperations: ['mission:submit'],
  maxActiveMissions: 5,
  maxMissionTimeoutMs: 30_000,
};

const SIMPLE_GOAL_OUTCOME =
  'Write a markdown file named output.md at the workspace root with the content "# audit output" as the sole body.';

function makeScriptedReasoning(replies: readonly string[]): ReasoningProvider & {
  readonly calls: ReasoningInput[];
} {
  const queue = [...replies];
  const calls: ReasoningInput[] = [];
  return {
    name: 'audit-scripted',
    async reason(input: ReasoningInput): Promise<ReasoningOutput> {
      calls.push(input);
      const next = queue.shift();
      if (next === undefined) {
        return { text: JSON.stringify({ action: 'finish', summary: 'audit: exhausted', artifacts: [] }) };
      }
      return { text: next };
    },
    calls,
  };
}

/** Slow scripted reasoning: writes the file on step 1, finishes on step 2, with a delay. */
function makeSlowReasoning(stepDelayMs: number): ReasoningProvider {
  let step = 0;
  return {
    name: 'audit-slow',
    async reason() {
      step += 1;
      await new Promise((r) => setTimeout(r, stepDelayMs));
      if (step === 1) {
        return {
          text: JSON.stringify({
            action: 'write_file',
            path: 'output.md',
            contents: '# audit output\n',
          }),
        };
      }
      return {
        text: JSON.stringify({
          action: 'finish',
          summary: 'wrote output.md',
          artifacts: ['output.md'],
        }),
      };
    },
  };
}

/** Build a MissionService with a slow runtime and slow reasoning. */
function makeService(
  runtimeFactory: () => { runtime: WorkerRuntime; computers: Map<string, MemoryComputer> },
  reasoningFactory: () => ReasoningProvider,
): MissionService {
  return new MissionService({
    defaultMissionTimeoutMs: 30_000,
    runtimeFactory,
    reasoningFactory,
  });
}

// ===========================================================================
// D-FAILURE-AUDIT-01: Cancellation/finish race
// ===========================================================================
//
// Gap: No existing test cancels a mission at the EXACT moment the orchestrator
// is finishing. The closest (cancellation.test.ts) cancels a slow mission
// mid-flight, never at the precise terminal transition.
//
// Risk: If cancel() races with finishMission(), the mission could end up in
// SUCCEEDED with canceled=true (statusFromResult would map to CANCELLED
// instead of SUCCEEDED — losing real work), OR in CANCELLED with a real
// deliverable (PARTIAL expected), OR in a state that contradicts both
// the result and the cancel flag.
//
// Reproduction: Use a deterministic scripted reasoning that finishes in
// exactly 2 calls. Call cancel() AFTER the first step but BEFORE the
// second step's reasoning completes. The orchestrator's signal check
// between specialist loops must catch the abort and NOT start step 2.
// Then verify the mission's terminal status is consistent with the
// actual outcome (PARTIAL if deliverable was produced, CANCELLED if not).
// ===========================================================================

describe('D-FAILURE-AUDIT-01: cancellation/finish race', () => {
  it('cancel arriving during the final reasoning step produces a consistent terminal state', async () => {
    // Build a slow reasoning: 80ms delay per step. The first step writes
    // output.md; the second step (also delayed) finishes.
    const slow = makeSlowReasoning(80);
    const computers = new Map<string, MemoryComputer>();
    const runtime: WorkerRuntime = {
      name: 'audit-race-runtime',
      async ensureWorker(genome: WorkerGenome): Promise<RuntimeHandle> {
        const id = genome.identity.id;
        if (!genome.computer.required) {
          return { workerId: id, ref: `memory:none:${id}` };
        }
        if (!computers.has(id)) computers.set(id, new MemoryComputer());
        return { workerId: id, ref: `memory:${id}` };
      },
      async stopWorker() { /* no-op */ },
      computer(handle: RuntimeHandle): WorkerComputer {
        const c = computers.get(handle.workerId);
        if (!c) throw new Error(`no computer for ${handle.workerId}`);
        return c as unknown as WorkerComputer;
      },
      surfaces(handle: RuntimeHandle): WorkerSurfaces {
        const c = computers.get(handle.workerId);
        return c === undefined ? {} : { computer: c as unknown as WorkerComputer };
      },
    };
    const service = makeService(
      () => ({ runtime, computers }),
      () => slow,
    );

    const submit = service.start({ outcome: SIMPLE_GOAL_OUTCOME }, CALLER_A);
    const missionId = submit.missionId;

    // Wait long enough that step 1 (write_file) has executed, then race
    // cancel against the orchestrator's transition to step 2 (finish).
    await new Promise((r) => setTimeout(r, 110));
    const cancelStatus = service.cancel(missionId, CALLER_A);

    // Wait for terminal.
    const snap = await service.awaitCompletion(missionId, CALLER_A);

    // INVARIANT: terminal status must be one of the documented terminal
    // states. SUCCEEDED with canceled=true would be a SILENT-failure bug
    // (cancel was requested but lost). CANCELLED with a real deliverable
    // would be a SILENT-failure bug (deliverable forgotten).
    expect(snap.terminal).toBe(true);
    expect(['SUCCEEDED', 'FAILED', 'PARTIAL', 'CANCELLED']).toContain(snap.status);

    // The critical assertion: if the mission produced output.md, the status
    // MUST be PARTIAL (not CANCELLED — the deliverable was real) or
    // SUCCEEDED (if the abort didn't propagate before finish landed).
    // If no deliverable, status MUST be CANCELLED (not SUCCEEDED).
    const producedOutput = computers.get('sole-operator-1')?.files.has('output.md') === true
      || computers.get('software-engineer-1')?.files.has('output.md') === true;
    if (producedOutput && snap.status === 'CANCELLED') {
      // SILENT FAILURE: a real deliverable was produced but the cancel
      // flag overrode it to CANCELLED. The mission forgot its own work.
      throw new Error(
        `SILENT FAILURE: deliverable produced but status=CANCELLED (lost work). ` +
          `cancelStatus=${cancelStatus}, snapStatus=${snap.status}`,
      );
    }
    if (!producedOutput && snap.status === 'SUCCEEDED') {
      throw new Error(
        `SILENT FAILURE: no deliverable produced but status=SUCCEEDED (phantom success). ` +
          `cancelStatus=${cancelStatus}, snapStatus=${snap.status}`,
      );
    }
    // If we reach here, the race produced a consistent state.
    expect(true).toBe(true);
  }, 15_000);
});

// ===========================================================================
// D-FAILURE-AUDIT-02: Concurrent cancellation (simultaneous)
// ===========================================================================
//
// Gap: cancellation.test.ts:272 tests SEQUENTIAL repeated cancels. No test
// fires MULTIPLE cancel() calls for the same mission SIMULTANEOUSLY.
//
// Risk: MissionService.cancel() reads rt.status, sets rt.canceled=true,
// rt.status='CANCELLATION_REQUESTED', and calls rt.controller.abort().
// Under Node's single-threaded model this is safe IF the function is
// synchronous between reads — but a concurrent caller could observe
// CANCELLATION_REQUESTED from one call and a terminal state from another.
// The risk is two callers seeing DIFFERENT post-cancel statuses.
//
// Reproduction: Submit a slow mission, fire 5 concurrent cancel() calls,
// verify ALL return the SAME status (or a documented subset) and the
// mission ends in ONE consistent terminal state.
// ===========================================================================

describe('D-FAILURE-AUDIT-02: concurrent cancellation (simultaneous)', () => {
  it('multiple simultaneous cancel() calls return consistent statuses', async () => {
    const slow = makeSlowReasoning(80);
    const computers = new Map<string, MemoryComputer>();
    const runtime: WorkerRuntime = {
      name: 'audit-concurrent-cancel-runtime',
      async ensureWorker(genome: WorkerGenome): Promise<RuntimeHandle> {
        const id = genome.identity.id;
        if (!genome.computer.required) {
          return { workerId: id, ref: `memory:none:${id}` };
        }
        if (!computers.has(id)) computers.set(id, new MemoryComputer());
        return { workerId: id, ref: `memory:${id}` };
      },
      async stopWorker() { /* no-op */ },
      computer(handle: RuntimeHandle): WorkerComputer {
        const c = computers.get(handle.workerId);
        if (!c) throw new Error(`no computer for ${handle.workerId}`);
        return c as unknown as WorkerComputer;
      },
      surfaces(handle: RuntimeHandle): WorkerSurfaces {
        const c = computers.get(handle.workerId);
        return c === undefined ? {} : { computer: c as unknown as WorkerComputer };
      },
    };
    const service = makeService(
      () => ({ runtime, computers }),
      () => slow,
    );

    const submit = service.start({ outcome: SIMPLE_GOAL_OUTCOME }, CALLER_A);
    const missionId = submit.missionId;
    await new Promise((r) => setTimeout(r, 40)); // mid-step

    // Fire 5 simultaneous cancels — no await between them.
    const cancelPromises = await Promise.all(
      Array.from({ length: 5 }, () =>
        Promise.resolve(service.cancel(missionId, CALLER_A)),
      ),
    );

    // Every returned status must be either CANCELLATION_REQUESTED (the
    // first call's view) or a terminal state (subsequent calls' view if
    // the mission already terminated). NO call should return undefined
    // or throw.
    const statuses = cancelPromises;
    for (const s of statuses) {
      expect(typeof s).toBe('string');
      expect([
        'CANCELLATION_REQUESTED',
        'CANCELLED',
        'PARTIAL',
        'SUCCEEDED',
        'FAILED',
      ]).toContain(s);
    }

    // The mission must end in exactly ONE terminal state.
    const snap = await service.awaitCompletion(missionId, CALLER_A);
    expect(snap.terminal).toBe(true);
    expect(['CANCELLED', 'PARTIAL', 'SUCCEEDED', 'FAILED']).toContain(snap.status);
  }, 15_000);
});

// ===========================================================================
// D-FAILURE-AUDIT-03: Cross-caller idempotency-key collision
// ===========================================================================
//
// Gap: http-api.test.ts:137 tests same-caller idempotency. The
// mission-service.ts code at lines 192-204 explicitly rejects a different
// caller trying to reuse an idempotency key, but NO TEST exercises this
// path. The branch is unverified.
//
// Risk: If the check fails, caller B could hijack caller A's idempotency
// key, either getting A's missionId (cross-caller leak) or creating
// duplicate state.
//
// Reproduction: Caller A submits with idempotencyKey='K'. Caller B
// submits with the same key='K'. Verify B gets MissionAdmissionError.
// Verify A's mission is unaffected and still accessible to A.
// ===========================================================================

describe('D-FAILURE-AUDIT-03: cross-caller idempotency-key collision', () => {
  it('caller B cannot reuse caller A\'s idempotency key', () => {
    const slow = makeSlowReasoning(50);
    const computers = new Map<string, MemoryComputer>();
    const runtime: WorkerRuntime = {
      name: 'audit-idem-runtime',
      async ensureWorker(genome: WorkerGenome): Promise<RuntimeHandle> {
        const id = genome.identity.id;
        if (!genome.computer.required) {
          return { workerId: id, ref: `memory:none:${id}` };
        }
        if (!computers.has(id)) computers.set(id, new MemoryComputer());
        return { workerId: id, ref: `memory:${id}` };
      },
      async stopWorker() { /* no-op */ },
      computer(handle: RuntimeHandle): WorkerComputer {
        const c = computers.get(handle.workerId);
        if (!c) throw new Error(`no computer for ${handle.workerId}`);
        return c as unknown as WorkerComputer;
      },
      surfaces(handle: RuntimeHandle): WorkerSurfaces {
        const c = computers.get(handle.workerId);
        return c === undefined ? {} : { computer: c as unknown as WorkerComputer };
      },
    };
    const service = makeService(
      () => ({ runtime, computers }),
      () => slow,
    );

    const idemKey = `audit-idem-${randomUUID()}`;
    const submission: MissionSubmission = {
      outcome: SIMPLE_GOAL_OUTCOME,
      idempotencyKey: idemKey,
    };

    // Caller A submits first.
    const aResult = service.start(submission, CALLER_A);
    expect(aResult.missionId).toBeTruthy();

    // Caller B tries to reuse the SAME idempotency key.
    expect(() => service.start(submission, CALLER_B)).toThrow(MissionAdmissionError);

    // Caller A can still retrieve their mission.
    const aSnap = service.get(aResult.missionId, CALLER_A);
    expect(aSnap.missionId).toBe(aResult.missionId);
    expect(aSnap.callerId).toBe(CALLER_A.callerId);

    // Caller B CANNOT retrieve A's mission (404 path — MissionNotFoundError).
    expect(() => service.get(aResult.missionId, CALLER_B)).toThrow(/mission not found/);
  });
});

// ===========================================================================
// D-FAILURE-AUDIT-04: Orchestrator-level runtime.ensureWorker throw mid-loop
// ===========================================================================
//
// Gap: phase-4-6-opendots.test.ts:442 tests ensureWorkspace throwing for the
// FIRST worker. openbot-adapter.test.ts:197 tests the OpenBot adapter
// throwing on the FIRST ensureWorker (live-only). NO test exercises the
// case where ensureWorker throws AFTER the specialists have already run
// and produced real artifacts — specifically when the VERIFIER worker
// (ensured at orchestrator.ts:634-640, AFTER the specialist loop) fails
// to start.
//
// Risk: The verifier is ensured AFTER specialists have done real work
// (orchestrator.ts:632-650). If ensureWorker(verifierGenome) throws, the
// orchestrator's outer try/finally catches it, retires prior workers,
// and run() rejects. The QUESTION: does the orchestrator SILENTLY SKIP
// verification (producing a false success), or does it reject loudly?
// Per the "failure is simple and loud" principle, it must reject.
//
// Reproduction: Use a custom WorkerRuntime whose ensureWorker throws when
// called with the verifier genome (identity.id === 'mission-verifier-1').
// Use a 2-specialist SOFTWARE_GOAL where both specialists succeed and
// produce real files. Verify: (a) orchestrator.run() REJECTS (LOUD — not
// silent success), (b) the specialists' computers hold real artifacts,
// (c) the runtime's stopWorker was called for every ensured worker
// (cleanup works even on the failure path).
// ===========================================================================

describe('D-FAILURE-AUDIT-04: ensureWorker throws mid-loop (verifier fails after specialists succeed)', () => {
  it('orchestrator rejects loudly when verifier ensureWorker throws after specialists produced work', async () => {
    const stopped: string[] = [];
    const computers = new Map<string, MemoryComputer>();
    let verifierEnsureAttempts = 0;
    const runtime: WorkerRuntime = {
      name: 'audit-verifier-fail-runtime',
      async ensureWorker(genome: WorkerGenome): Promise<RuntimeHandle> {
        // Throw ONLY when the verifier genome is ensured. The verifier is
        // ensured AFTER specialists have run (orchestrator.ts:632-640), so
        // real work has already been committed to the computers Map.
        if (genome.identity.id === 'mission-verifier-1') {
          verifierEnsureAttempts += 1;
          throw new Error(
            'audit: verifier ensureWorker exhausted (simulated runtime resource limit)',
          );
        }
        const id = genome.identity.id;
        if (genome.computer.required) {
          if (!computers.has(id)) computers.set(id, new MemoryComputer());
        }
        return { workerId: id, ref: `memory:${id}` };
      },
      async stopWorker(handle: RuntimeHandle): Promise<void> {
        stopped.push(handle.workerId);
      },
      computer(handle: RuntimeHandle): WorkerComputer {
        const c = computers.get(handle.workerId);
        if (!c) throw new Error(`no computer for ${handle.workerId}`);
        return c as unknown as WorkerComputer;
      },
      surfaces(handle: RuntimeHandle): WorkerSurfaces {
        const c = computers.get(handle.workerId);
        return c === undefined ? {} : { computer: c as unknown as WorkerComputer };
      },
    };

    // Two-specialist goal: Software Engineer writes convert.ts and finishes;
    // Documentation Writer writes USAGE.md and finishes. Both produce real
    // artifacts. The verifier then fails to start.
    let engineerCalls = 0;
    let writerCalls = 0;
    const reasoning: ReasoningProvider = {
      name: 'audit-verifier-fail-reasoning',
      async reason(input: ReasoningInput): Promise<ReasoningOutput> {
        const system = input.system ?? '';
        if (system.includes('You are Software Engineer')) {
          engineerCalls += 1;
          if (engineerCalls === 1) {
            return {
              text: JSON.stringify({
                action: 'write_file',
                path: 'convert.ts',
                contents: 'export const cToF = (c: number) => c * 9 / 5 + 32;',
              }),
            };
          }
          return {
            text: JSON.stringify({
              action: 'finish',
              summary: 'Implemented convert.ts.',
              artifacts: ['convert.ts'],
            }),
          };
        }
        if (system.includes('You are Documentation Writer')) {
          writerCalls += 1;
          if (writerCalls === 1) {
            return {
              text: JSON.stringify({
                action: 'write_file',
                path: 'USAGE.md',
                contents: '# Usage\nimport { cToF } from "./convert.ts";',
              }),
            };
          }
          return {
            text: JSON.stringify({
              action: 'finish',
              summary: 'Documented usage in USAGE.md.',
              artifacts: ['USAGE.md'],
            }),
          };
        }
        throw new Error('audit: no script for this worker');
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
      missionTimeoutMs: 5_000,
    });

    const goal: Goal = {
      outcome:
        'Implement and document a small CLI utility that converts temperatures ' +
        'between Celsius and Fahrenheit, with tests.',
      constraints: ['pure TypeScript, no external dependencies'],
    };

    // The orchestrator MUST reject loudly — never silently succeed when
    // the verifier cannot start (which would skip verification entirely).
    await expect(orchestrator.run(goal)).rejects.toThrow(
      /audit: verifier ensureWorker exhausted/,
    );

    // INVARIANT 1: the specialists' real work is preserved in the
    // computers Map — the failure did not erase committed artifacts.
    const engineerFiles = computers.get('software-engineer-1')?.files;
    expect(engineerFiles?.has('convert.ts')).toBe(true);
    const writerFiles = computers.get('documentation-writer-2')?.files;
    expect(writerFiles?.has('USAGE.md')).toBe(true);

    // INVARIANT 2: the verifier's ensureWorker was attempted exactly once
    // (no silent retry that masked the failure).
    expect(verifierEnsureAttempts).toBe(1);

    // INVARIANT 3: every ensured worker was retired via stopWorker in the
    // finally block — cleanup runs even on the failure path. Both
    // specialists were ensured before the verifier threw.
    expect(stopped).toContain('software-engineer-1');
    expect(stopped).toContain('documentation-writer-2');

    // INVARIANT 4: both specialists' reasoning was actually invoked — the
    // failure happened AFTER their work, not before.
    expect(engineerCalls).toBeGreaterThanOrEqual(2);
    expect(writerCalls).toBeGreaterThanOrEqual(2);
  }, 15_000);
});

// ===========================================================================
// D-FAILURE-AUDIT-05: Tool crash (computer.writeFile throws)
// ===========================================================================
//
// Gap: worker-agent.test.ts:199 'treats computer errors as failed observations'
// only exercises the read_file path (file missing). The write_file path
// (computer.writeFile throws) is NOT directly tested. The worker-agent's
// execute() catch at worker-agent.ts:674-679 wraps any computer error as
// { ok: false, observation: 'error: ...' } — but this is verified only for
// read_file.
//
// Risk: If the catch path has a bug specific to writeFile (e.g., the
// writeFile case at worker-agent.ts:602-608 returns BEFORE the catch block
// could fire — but if writeFile throws, the catch SHOULD fire), the worker
// might crash instead of getting a failed observation. This would propagate
// as an unhandled rejection and the mission would fail with a generic
// UNKNOWN_FAILURE instead of a traceable TOOL_FAILURE.
//
// Reproduction: Inject a MemoryComputer whose writeFile throws. Use a
// scripted reasoning that emits a write_file action. Verify: (a) the worker
// does NOT crash, (b) the worker-step event records ok=false with the
// error in the observation, (c) the worker can subsequently finish (with
// or without producing an artifact — both acceptable as long as it's loud).
// ===========================================================================

describe('D-FAILURE-AUDIT-05: tool crash (computer.writeFile throws)', () => {
  it('writeFile throwing becomes a failed observation, not a worker crash', async () => {
    // A MemoryComputer whose writeFile always throws (simulating a disk-full
    // or permission-denied computer).
    const crashingComputer: WorkerComputer = {
      async exec(command: string) {
        return {
          command,
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          elapsedMs: 1,
        };
      },
      async writeFile() {
        throw new Error('audit: ENOSPC: no space left on device');
      },
      async readFile(path: string) {
        throw new Error(`no file at ${path}`);
      },
      async listFiles() {
        return [];
      },
    };

    const genome: WorkerGenome = {
      identity: { id: 'audit-crash-worker', displayName: 'Crash Worker' },
      role: 'Tester',
      objective: 'test tool-crash handling',
      model: 'cheap',
      skills: ['code-execution'],
      tools: ['openbot:shell-execution', 'openbot:workspace-files'],
      computer: { required: true, browser: false, shell: true, workspace: true },
      memory: 'none',
      budget: { maxUsd: 1, maxTier: 'cheap' },
      autonomy: 'autonomous',
    };

    const reasoning = makeScriptedReasoning([
      JSON.stringify({
        action: 'write_file',
        path: 'output.md',
        contents: '# will crash\n',
      }),
      JSON.stringify({
        action: 'finish',
        summary: 'writeFile crashed; nothing produced',
        artifacts: [],
      }),
    ]);

    const events: { type: string; ok?: boolean; action?: string }[] = [];

    const agent = new WorkerAgent({
      genome,
      reasoning,
      computer: crashingComputer,
      taskBrief: 'try to write a file',
      maxSteps: 5,
      onEvent: (e) => events.push(e as unknown as { type: string; ok?: boolean; action?: string }),
    });

    // MUST NOT throw — the worker treats the tool crash as a failed
    // observation and continues.
    const result = await agent.run();

    // The worker-step event for the write_file action MUST have ok=false.
    const writeStep = events.find(
      (e) => e.type === 'worker-step' && e.action === 'write_file',
    );
    expect(writeStep).toBeDefined();
    expect(writeStep!.ok).toBe(false);

    // The worker must have completed (not crashed) — it has a worker-finished event.
    expect(events.some((e) => e.type === 'worker-finished')).toBe(true);

    // The worker's status is success (it finished honestly, having
    // observed the failure and chosen to finish without artifacts) OR
    // failure. Both are acceptable — the point is it didn't crash.
    expect(['success', 'failure']).toContain(result.status);

    // No phantom artifact was claimed (the worker didn't claim output.md).
    expect(result.artifacts).toEqual([]);
  }, 10_000);

  it('writeFile throwing on the finish-path artifact check is also non-fatal', async () => {
    // A separate concern: when the worker finishes with claimed artifacts,
    // the worker-agent.ts:868-878 loop calls computer.readFile to verify
    // each artifact. If readFile throws (file missing), the artifact is
    // rejected and the worker status becomes 'failure' with WORKER_FAILURE.
    // This is the LOUD path. Test that this path also doesn't crash.
    const crashingComputer: WorkerComputer = {
      async exec(command: string) {
        return { command, exitCode: 0, stdout: '', stderr: '', timedOut: false, elapsedMs: 1 };
      },
      async writeFile() {
        throw new Error('audit: ENOSPC');
      },
      async readFile(path: string) {
        throw new Error(`audit: readFile crash for ${path}`);
      },
      async listFiles() {
        return [];
      },
    };

    const genome: WorkerGenome = {
      identity: { id: 'audit-crash-finish', displayName: 'Crash Finish' },
      role: 'Tester',
      objective: 'test crash on finish-path',
      model: 'cheap',
      skills: [],
      tools: ['openbot:workspace-files'],
      computer: { required: true, browser: false, shell: false, workspace: true },
      memory: 'none',
      budget: { maxUsd: 1, maxTier: 'cheap' },
      autonomy: 'autonomous',
    };

    // The worker finishes claiming a phantom artifact (it never wrote it
    // because writeFile crashed). The finish-path readFile check will
    // throw → the artifact is rejected → worker status='failure'.
    const reasoning = makeScriptedReasoning([
      JSON.stringify({
        action: 'write_file',
        path: 'phantom.md',
        contents: 'never written',
      }),
      JSON.stringify({
        action: 'finish',
        summary: 'claimed phantom.md',
        artifacts: ['phantom.md'],
      }),
    ]);

    const agent = new WorkerAgent({
      genome,
      reasoning,
      computer: crashingComputer,
      taskBrief: 'claim a phantom artifact',
      maxSteps: 5,
    });

    const result = await agent.run();
    // LOUD: worker status is failure (phantom artifact rejected).
    expect(result.status).toBe('failure');
    expect(result.artifacts).toEqual([]);
    // The refusal message names the phantom artifact.
    expect(result.refusals.some((r) => r.includes('phantom.md'))).toBe(true);
  }, 10_000);
});
