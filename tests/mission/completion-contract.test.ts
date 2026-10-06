import { describe, expect, it } from 'vitest';

import type {
  Goal,
  ReasoningInput,
  ReasoningOutput,
  ReasoningProvider,
  RuntimeHandle,
  WorkerGenome,
} from '../../src/contracts/core.js';
import { GoalCompiler } from '../../src/goal/goal-compiler.js';
import {
  GenomeCompiler,
  loadOwnership,
} from '../../src/genome/genome-compiler.js';
import { MemoryFlightRecorder } from '../../src/mission/flight-recorder.js';
import { MissionOrchestrator } from '../../src/mission/orchestrator.js';
import type { AcceptanceCheck } from '../../src/mission/verification.js';
import { OrganizationPlanner } from '../../src/organization/organization-planner.js';
import { CognitiveRouter } from '../../src/routing/cognitive-router.js';
import { RuleDecisionProvider } from '../../src/routing/decision-provider.js';
import type { WorkerComputer,
  WorkerRuntime,
  WorkerSurfaces } from '../../src/runtime/computer.js';

/**
 * TASK-019 — the Software Engineering Completion Contract:
 *
 *   - no mission succeeds before its relevant gates pass: acceptance checks
 *     decide, and a failing check fails the mission (bounded retry included);
 *   - every retry carries a recorded reason;
 *   - repository missions can bring their integration up to date before EACH
 *     verification pass (the beforeVerification hook);
 *   - Flight metrics separate worker / reviewer / handoff / provider calls —
 *     one ambiguous "LLM calls" number is never reported again.
 *
 * The dynamic gate below mirrors the real Experiment-001 flow: workers whose
 * first pass produced no deliverable fail verification, and the retry's
 * artifacts — not anyone's narrative — flip the outcome.
 */

class RoleScriptedReasoning implements ReasoningProvider {
  readonly name = 'role-scripted';
  readonly calls: ReasoningInput[] = [];
  private readonly queues = new Map<string, readonly string[]>();

  constructor(scripts: Record<string, readonly string[]>) {
    for (const [marker, replies] of Object.entries(scripts)) {
      this.queues.set(marker, [...replies]);
    }
  }

  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    this.calls.push(input);
    const system = input.system ?? '';
    for (const [marker, queue] of this.queues) {
      if (system.includes(`You are ${marker}`)) {
        const [next, ...rest] = queue;
        this.queues.set(marker, rest);
        return { text: next };
      }
    }
    throw new Error('no script for a worker in this mission');
  }
}

class MemoryRuntime implements WorkerRuntime {
  readonly name = 'memory-runtime';
  readonly stopped: string[] = [];
  readonly computers = new Map<string, MemoryComputer>();

  async ensureWorker(genome: WorkerGenome): Promise<RuntimeHandle> {
    if (!genome.computer.required) {
      return { workerId: genome.identity.id, ref: 'memory:none' };
    }
    const computer = new MemoryComputer();
    this.computers.set(genome.identity.id, computer);
    return { workerId: genome.identity.id, ref: `memory:${genome.identity.id}` };
  }

  computer(handle: RuntimeHandle): WorkerComputer {
    const computer = this.computers.get(handle.workerId);
    if (!computer) throw new Error(`no computer for ${handle.workerId}`);
    return computer;
  }


  surfaces(handle: RuntimeHandle): WorkerSurfaces {
    const computer = this.computers.get(handle.workerId);
    return computer === undefined ? {} : { computer };
  }

  async stopWorker(handle: RuntimeHandle): Promise<void> {
    this.stopped.push(handle.workerId);
  }
}

class MemoryComputer implements WorkerComputer {
  readonly files = new Map<string, string>();

  async exec(command: string) {
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

const SOFTWARE_GOAL: Goal = {
  outcome:
    'Implement and document a small CLI utility that converts temperatures ' +
    'between Celsius and Fahrenheit, with tests.',
  constraints: ['pure TypeScript, no external dependencies'],
};

function buildOrchestrator(
  reasoning: ReasoningProvider,
  runtime: WorkerRuntime,
  recorder: MemoryFlightRecorder,
  extra: {
    beforeVerification?: (context: { attempt: 1 | 2 }) => Promise<void>;
    providerCallsSource?: () => number;
    checks?: () => readonly AcceptanceCheck[];
  } = {},
): MissionOrchestrator {
  const router = new CognitiveRouter(new RuleDecisionProvider());
  return new MissionOrchestrator({
    goalCompiler: new GoalCompiler(),
    planner: new OrganizationPlanner(),
    genomeCompiler: new GenomeCompiler({
      registry: loadOwnership('data/ownership.yaml'),
      selectTier: (selection) => router.selectTier(selection),
    }),
    runtime,
    reasoning,
    reviewer: reasoning,
    recorder,
    ...(extra.beforeVerification === undefined
      ? {}
      : { beforeVerification: extra.beforeVerification }),
    ...(extra.providerCallsSource === undefined
      ? {}
      : { providerCallsSource: extra.providerCallsSource }),
    ...(extra.checks === undefined ? {} : { checks: extra.checks }),
  });
}

const CONVERT_FILE = 'artifacts/software-engineer-1/convert.ts';

/** Scripts where the engineer's deliverable only exists after the retry. */
function lateDeliverableScripts(): Record<string, readonly string[]> {
  return {
    'Software Engineer': [
      // First pass: asks a colleague, finishes WITHOUT the deliverable.
      JSON.stringify({
        action: 'ask_worker',
        target: 'documentation-writer-2',
        task: 'Confirm the conversion formula reads correctly.',
        answerShape: 'A one-line confirmation.',
      }),
      JSON.stringify({ action: 'finish', summary: 'researched only, not done yet' }),
      // Retry pass: produces the deliverable.
      JSON.stringify({
        action: 'write_file',
        path: 'convert.ts',
        contents: 'export const cToF = (c: number) => c * 9 / 5 + 32;',
      }),
      JSON.stringify({
        action: 'finish',
        summary: 'converter implemented',
        artifacts: ['convert.ts'],
      }),
    ],
    'Documentation Writer': [
      // Serving the engineer's handoff.
      JSON.stringify({ action: 'finish', summary: 'Confirmed: the formula reads correctly.' }),
      // Its own first pass.
      JSON.stringify({
        action: 'write_file',
        path: 'README.md',
        contents: '# converter\n',
      }),
      JSON.stringify({ action: 'finish', summary: 'README written', artifacts: ['README.md'] }),
      // Retry pass.
      JSON.stringify({ action: 'finish', summary: 'README stands', artifacts: ['README.md'] }),
    ],
    'a mission verification reviewer': [
      JSON.stringify({
        rootCause: 'the engineer produced no deliverable in the first pass',
        retryable: true,
        guidance: 'implement the converter and claim the artifact',
      }),
    ],
  };
}

describe('TASK-019 — completion contract and metric separation', () => {
  it('beforeVerification runs before the first verification pass (and only there when the gate passes)', async () => {
    const attempts: number[] = [];
    const runtime = new MemoryRuntime();
    const recorder = new MemoryFlightRecorder();
    const reasoning = new RoleScriptedReasoning({
      'Software Engineer': [
        JSON.stringify({
          action: 'write_file',
          path: 'convert.ts',
          contents: 'export const cToF = (c: number) => c * 9 / 5 + 32;',
        }),
        JSON.stringify({
          action: 'finish',
          summary: 'done',
          artifacts: ['convert.ts'],
        }),
      ],
      'Documentation Writer': [
        JSON.stringify({ action: 'finish', summary: 'nothing to document yet' }),
      ],
    });
    const orchestrator = buildOrchestrator(reasoning, runtime, recorder, {
      beforeVerification: async (context) => {
        attempts.push(context.attempt);
      },
      checks: () => [
        { kind: 'evidence', label: 'deliverable evidence exists', evidenceKind: 'artifact' },
      ],
    });

    const result = await orchestrator.run(SOFTWARE_GOAL);
    expect(result.status).toBe('success');
    expect(attempts).toEqual([1]);
  });

  it('a failing gate fails the mission, retries exactly once with a recorded reason, then stands', async () => {
    const runtime = new MemoryRuntime();
    const recorder = new MemoryFlightRecorder();
    const reasoning = new RoleScriptedReasoning(lateDeliverableScripts());
    const orchestrator = buildOrchestrator(reasoning, runtime, recorder, {
      // The gate never opens: the deliverable stays missing in the clean room.
      checks: () => [
        { kind: 'file', label: 'the deliverable exists', path: 'artifacts/never-produced.md' },
      ],
    });

    const result = await orchestrator.run(SOFTWARE_GOAL);

    // Bounded repair: exactly two verification passes, one retry.
    const verifications = recorder.events.filter((e) => e.type === 'verification');
    expect(verifications).toHaveLength(2);
    const retries = recorder.events.filter((e) => e.type === 'worker-retry');
    expect(retries).toHaveLength(1);
    if (retries[0]?.type === 'worker-retry') {
      // The recorded reason is the reviewer's root cause — traceable, not vague.
      expect(retries[0].reason).toContain('no deliverable');
    }
    // The failed checks are named in the verification event.
    if (verifications[0]?.type === 'verification') {
      expect(verifications[0].failures.join(' ')).toContain('never-produced');
    }
    // Artifacts exist, so the bounded outcome is partial — never success.
    expect(result.status).toBe('partial');
    expect(result.summary).toContain('verification failed after retry');
  });

  it('metrics separate workers, reviewer, handoffs and provider totals', async () => {
    const runtime = new MemoryRuntime();
    const recorder = new MemoryFlightRecorder();
    const reasoning = new RoleScriptedReasoning(lateDeliverableScripts());
    const orchestrator = buildOrchestrator(reasoning, runtime, recorder, {
      providerCallsSource: () => reasoning.calls.length,
      // The real Experiment-001 flow: the deliverable gate reads the clean
      // room, so it flips exactly when the retry's artifact arrives.
      checks: () => [{ kind: 'file', label: 'the deliverable exists', path: CONVERT_FILE }],
    });

    const result = await orchestrator.run(SOFTWARE_GOAL);
    expect(result.status).toBe('success');

    const finished = recorder.events.find((e) => e.type === 'mission-finished');
    expect(finished).toBeDefined();
    if (finished?.type !== 'mission-finished') return;

    // The four separated metrics, with the invariant that ties them:
    // workers + reviewer + handoffs == total provider calls.
    expect(finished.worker_reasoning_calls).toBe(finished.reasoningCalls);
    expect(finished.worker_reasoning_calls).toBe(7); // engineer 2+2 + writer 2+1
    expect(finished.reviewer_calls).toBe(1); // one failed verification diagnosed
    expect(finished.handoff_calls).toBe(1); // the writer served one handoff
    expect(finished.total_provider_calls).toBe(9);
    expect(
      finished.worker_reasoning_calls +
        finished.reviewer_calls +
        finished.handoff_calls,
    ).toBe(finished.total_provider_calls);

    // The retry reason was recorded (not just counted).
    expect(recorder.events.some((e) => e.type === 'worker-retry')).toBe(true);
  });

  it('missions without the hook and without metric sources keep GROUP 2 behavior', async () => {
    const runtime = new MemoryRuntime();
    const recorder = new MemoryFlightRecorder();
    const reasoning = new RoleScriptedReasoning({
      'Software Engineer': [
        JSON.stringify({
          action: 'ask_worker',
          target: 'documentation-writer-2',
          task: 'Confirm the conversion formula reads correctly.',
          answerShape: 'A one-line confirmation.',
        }),
        JSON.stringify({
          action: 'write_file',
          path: 'convert.ts',
          contents: 'export const cToF = (c: number) => c * 9 / 5 + 32;',
        }),
        JSON.stringify({
          action: 'finish',
          summary: 'done and confirmed',
          artifacts: ['convert.ts'],
        }),
      ],
      'Documentation Writer': [
        JSON.stringify({ action: 'finish', summary: 'Confirmed: reads correctly.' }),
        JSON.stringify({ action: 'finish', summary: 'nothing to add' }),
      ],
    });
    const orchestrator = buildOrchestrator(reasoning, runtime, recorder, {
      checks: () => [
        { kind: 'evidence', label: 'deliverable evidence exists', evidenceKind: 'artifact' },
      ],
    });
    const result = await orchestrator.run(SOFTWARE_GOAL);
    expect(result.status).toBe('success');

    const finished = recorder.events.find((e) => e.type === 'mission-finished');
    if (finished?.type !== 'mission-finished') return;
    expect(finished.worker_reasoning_calls).toBe(4); // engineer 3 + writer 1
    expect(finished.reviewer_calls).toBe(0);
    expect(finished.handoff_calls).toBe(1);
    expect(finished.total_provider_calls).toBeUndefined();
  });

  // Experiment-002 mission 210312, live: the engineer succeeded in round 1
  // (fixes committed, 6/7 clean-room gates passing), then the provider was
  // rate-limited to death and the retry round failed — and the mission
  // "forgot" its own committed artifacts, reporting failure with no
  // deliverables. A dead retry must not erase real work: the gates run
  // against the integration branch, which still carries it.
  it('a dead retry does not erase committed round-1 work', async () => {
    class DyingRetryReasoning implements ReasoningProvider {
      readonly name = 'dying-retry';
      private engineerCalls = 0;
      async reason(input: ReasoningInput): Promise<ReasoningOutput> {
        const system = input.system ?? '';
        if (system.includes('You are Software Engineer')) {
          this.engineerCalls += 1;
          if (this.engineerCalls === 1) {
            return {
              text: JSON.stringify({
                action: 'write_file',
                path: 'convert.ts',
                contents: 'export const cToF = (c: number) => c * 9 / 5 + 32;',
              }),
            };
          }
          if (this.engineerCalls === 2) {
            return {
              text: JSON.stringify({
                action: 'finish',
                summary: 'converter implemented',
                artifacts: ['convert.ts'],
              }),
            };
          }
          // The retry dies the way a rate-limited provider really does.
          throw new Error(
            'reasoning provider failed: API request failed with status 429',
          );
        }
        if (system.includes('You are Documentation Writer')) {
          return {
            text: JSON.stringify({ action: 'finish', summary: 'nothing to add' }),
          };
        }
        if (system.includes('a mission verification reviewer')) {
          return {
            text: JSON.stringify({
              rootCause: 'the deliverable check cannot pass',
              retryable: true,
              guidance: 'try again',
            }),
          };
        }
        throw new Error('no script for a worker in this mission');
      }
    }

    const runtime = new MemoryRuntime();
    const recorder = new MemoryFlightRecorder();
    const reasoning = new DyingRetryReasoning();
    const orchestrator = buildOrchestrator(reasoning, runtime, recorder, {
      // A gate that never opens: verification fails, the bounded retry
      // round runs, and in it the engineer's provider dies.
      checks: () => [
        {
          kind: 'file',
          label: 'the deliverable exists',
          path: 'artifacts/never-produced.md',
        },
      ],
    });

    const result = await orchestrator.run(SOFTWARE_GOAL);

    // The round-1 deliverable stands: the mission remembers its own
    // committed work instead of claiming none existed.
    expect(result.status).toBe('partial');
    expect(result.summary).toContain('verification failed after retry');

    // The full story stays on the flight record: the engineer succeeded
    // in round 1 and died in the retry — both events, in that order.
    const engineerRuns = recorder.events.filter(
      (e) =>
        e.type === 'worker-finished' &&
        (e as { workerId?: string }).workerId === 'software-engineer-1',
    );
    expect(engineerRuns).toHaveLength(2);
    const statuses = engineerRuns.map(
      (e) => (e as { result: { status: string } }).result.status,
    );
    expect(statuses).toEqual(['success', 'failure']);

    // The round-1 evidence survives into the mission result (a failed
    // retry does not retract the evidence of real work).
    expect(result.evidence.length).toBeGreaterThan(0);

    // Metrics honesty: completed reasoning calls only — the engineer's 2
    // round-1 calls plus the writer's 2 (round 1 + retry). The dead retry
    // call counts 0 here by design; raw provider-call totals (including
    // dead ones) are the providerCallsSource's job.
    const finished = recorder.events.find((e) => e.type === 'mission-finished');
    if (finished?.type === 'mission-finished') {
      expect(finished.worker_reasoning_calls).toBe(4);
    }
  });
});
