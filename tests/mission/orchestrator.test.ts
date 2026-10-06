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
import { OrganizationPlanner } from '../../src/organization/organization-planner.js';
import { CognitiveRouter } from '../../src/routing/cognitive-router.js';
import { RuleDecisionProvider } from '../../src/routing/decision-provider.js';
import type { WorkerComputer,
  WorkerRuntime,
  WorkerSurfaces } from '../../src/runtime/computer.js';
import { MissionOrchestrator } from '../../src/mission/orchestrator.js';
import { MemoryFlightRecorder } from '../../src/mission/flight-recorder.js';

/**
 * TASK-012 acceptance: one Goal from beginning to end without manual team
 * construction; temporary workers are retired; failures are loud.
 *
 * The pipeline components are the REAL GROUP 1 chain (compiler, planner,
 * genome compiler, router) over the REAL ownership registry; the runtime is
 * an in-memory WorkerRuntime (the live OpenBot runtime is exercised by the
 * TASK-010 gated tests and Experiment 001) and reasoning is scripted.
 */

/** A reasoning provider whose replies depend on the role in the system prompt. */
class RoleScriptedReasoning implements ReasoningProvider {
  readonly name = 'role-scripted';
  readonly calls: ReasoningInput[] = [];
  private readonly queues = new Map<string, readonly string[]>();

  constructor(
    scripts: Record<string, readonly string[]>,
    private readonly fallback: readonly string[] = [],
    private readonly delayMs = 0,
  ) {
    for (const [marker, replies] of Object.entries(scripts)) {
      this.queues.set(marker, [...replies]);
    }
  }

  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    this.calls.push(input);
    const system = input.system ?? '';
    for (const [marker, queue] of this.queues) {
      // Identity line match, not any mention: the roster lists colleagues by
      // role too, so a bare includes() would cross-match scripts.
      if (system.includes(`You are ${marker}`)) {
        expect(queue.length, `script for "${marker}"`).toBeGreaterThan(0);
        const [next, ...rest] = queue;
        this.queues.set(marker, rest);
        return { text: next };
      }
    }
    expect(this.fallback.length).toBeGreaterThan(0);
    return { text: this.fallback[0] };
  }
}

class MemoryRuntime implements WorkerRuntime {
  readonly name = 'memory-runtime';
  readonly stopped: string[] = [];
  readonly computers = new Map<string, MemoryComputer>();

  computersForTest(): ReadonlyMap<string, MemoryComputer> {
    return this.computers;
  }

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
    return {
      command,
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      timedOut: false,
      elapsedMs: 1,
    };
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
    return [...this.files.keys()].map((path) => ({
      path,
      kind: 'file' as const,
    }));
  }
}

function buildOrchestrator(
  reasoning: ReasoningProvider,
  runtime: WorkerRuntime,
  recorder: MemoryFlightRecorder,
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
    recorder,
  });
}

const SOFTWARE_GOAL: Goal = {
  outcome:
    'Implement and document a small CLI utility that converts temperatures ' +
    'between Celsius and Fahrenheit, with tests.',
  constraints: ['pure TypeScript, no external dependencies'],
};

const SIMPLE_GOAL: Goal = {
  outcome: 'Write a short note summarizing what temperature conversion is.',
};

describe('MissionOrchestrator — the Born loop', () => {
  it('runs one goal end-to-end: plan → genomes → workers → MissionResult', async () => {
    const runtime = new MemoryRuntime();
    const recorder = new MemoryFlightRecorder();
    const reasoning = new RoleScriptedReasoning({
      // Software Engineer: write the implementation + test, then finish.
      'Software Engineer': [
        JSON.stringify({
          action: 'write_file',
          path: 'convert.ts',
          contents: 'export const cToF = (c: number) => c * 9 / 5 + 32;',
        }),
        JSON.stringify({
          action: 'finish',
          summary: 'Implemented convert.ts.',
          artifacts: ['convert.ts'],
        }),
      ],
      // Documentation Writer: receives the engineer's report as upstream input.
      'Documentation Writer': [
        JSON.stringify({
          action: 'write_file',
          path: 'USAGE.md',
          contents: '# Usage\nimport { cToF } from "./convert.ts";',
        }),
        JSON.stringify({
          action: 'finish',
          summary: 'Documented usage in USAGE.md.',
          artifacts: ['USAGE.md'],
        }),
      ],
    });
    const orchestrator = buildOrchestrator(reasoning, runtime, recorder);

    const result = await orchestrator.run(SOFTWARE_GOAL);

    // The organization emerged from the goal — no hardcoded team.
    expect(result.status).toBe('success');
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.evidence.length).toBe(2);
    expect(result.cost.wallMs).toBeGreaterThanOrEqual(0);
    expect(result.cost.humanInterventions).toBe(0);

    // Both specialists really produced files in their own computers.
    const engineerFiles = runtime.computersForTest().get('software-engineer-1');
    const writerFiles = runtime.computersForTest().get('documentation-writer-2');
    expect(engineerFiles?.files.has('convert.ts')).toBe(true);
    expect(writerFiles?.files.has('USAGE.md')).toBe(true);

    // The writer's brief carried the engineer's upstream result.
    const writerPrompt = reasoning.calls
      .filter((call) => (call.system ?? '').includes('Documentation Writer'))
      .at(-1)!.prompt;
    expect(writerPrompt).toContain('Inputs from colleagues');
    expect(writerPrompt).toContain('Implemented convert.ts.');

    // Every ensured worker was retired.
    expect(runtime.stopped.sort()).toEqual([
      'documentation-writer-2',
      'mission-verifier-1',
      'software-engineer-1',
    ]);

    // The flight record can rebuild what happened.
    const types = recorder.events.map((event) => event.type);
    expect(types).toContain('mission-started');
    expect(types).toContain('requirements-compiled');
    expect(types).toContain('plan-created');
    expect(types).toContain('genomes-compiled');
    expect(types).toContain('worker-started');
    expect(types).toContain('worker-finished');
    expect(types.lastIndexOf('mission-finished')).toBe(types.length - 1);
  });

  it('collapses a simple goal to one Sole Operator and still delivers', async () => {
    const runtime = new MemoryRuntime();
    const recorder = new MemoryFlightRecorder();
    const reasoning = new RoleScriptedReasoning({
      'Sole Operator': [
        JSON.stringify({
          action: 'write_file',
          path: 'note.md',
          contents: 'Temperature conversion maps between Celsius and Fahrenheit.',
        }),
        JSON.stringify({
          action: 'finish',
          summary: 'Wrote the note.',
          artifacts: ['note.md'],
        }),
      ],
    });
    const result = await buildOrchestrator(
      reasoning,
      runtime,
      recorder,
    ).run(SIMPLE_GOAL);

    expect(result.status).toBe('success');
    const planEvent = recorder.events.find((e) => e.type === 'plan-created')!;
    expect(planEvent.workers).toHaveLength(1);
    expect(planEvent.workers[0].role).toBe('Sole Operator');
    expect(runtime.stopped.sort()).toEqual(['mission-verifier-1', 'sole-operator-1']);
  });

  it('fails loudly when a worker fails — no silent success', async () => {
    const runtime = new MemoryRuntime();
    const spin = JSON.stringify({ action: 'list_files', path: '.' });
    const reasoning = new RoleScriptedReasoning({
      'Software Engineer': Array(12).fill(spin),
      'Documentation Writer': [
        JSON.stringify({
          action: 'finish',
          summary: 'Nothing to document.',
        }),
      ],
    });
    const result = await buildOrchestrator(
      reasoning,
      runtime,
      new MemoryFlightRecorder(),
    ).run(SOFTWARE_GOAL);

    expect(result.status).toBe('failure');
    expect(result.summary).toContain('step budget');
  });

  it('aborts on mission timeout and still retires every worker', async () => {
    const runtime = new MemoryRuntime();
    const spin = JSON.stringify({ action: 'list_files', path: '.' });
    const reasoning = new RoleScriptedReasoning(
      {
        'Software Engineer': Array(20).fill(spin),
        'Documentation Writer': Array(20).fill(spin),
      },
      [],
      100,
    );
    const router = new CognitiveRouter(new RuleDecisionProvider());
    const result = await new MissionOrchestrator({
      goalCompiler: new GoalCompiler(),
      planner: new OrganizationPlanner(),
      genomeCompiler: new GenomeCompiler({
        registry: loadOwnership('data/ownership.yaml'),
        selectTier: (selection) => router.selectTier(selection),
      }),
      runtime,
      reasoning,
      missionTimeoutMs: 300,
    }).run(SOFTWARE_GOAL);

    // The mission timed out loudly and everything was retired anyway.
    expect(result.status).toMatch(/^(failure|partial)$/);
    expect(result.summary).toContain('aborted');
    expect(runtime.stopped.length).toBeGreaterThan(0);
  }, 30_000);

  it('supports external cancellation', async () => {
    const controller = new AbortController();
    const runtime = new MemoryRuntime();
    const spin = JSON.stringify({ action: 'list_files', path: '.' });
    const reasoning = new RoleScriptedReasoning({
      'Software Engineer': Array(20).fill(spin),
      'Documentation Writer': Array(20).fill(spin),
    });
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
      signal: controller.signal,
      missionTimeoutMs: 60_000,
    });
    const running = orchestrator.run(SOFTWARE_GOAL);
    setTimeout(() => controller.abort(), 50);
    const result = await running;
    expect(result.status).toMatch(/^(failure|partial)$/);
  }, 30_000);

  it('workerBriefSuffix reaches every specialist brief without entering the goal', async () => {
    // GROUP 3 regression (Experiment 003 defect): repository missions used
    // to smuggle their operational preamble into goal.context, where it
    // polluted domain classification. The suffix channel delivers the same
    // instructions to workers while the goal stays exactly what the caller
    // wrote.
    const runtime = new MemoryRuntime();
    const recorder = new MemoryFlightRecorder();
    const reasoning = new RoleScriptedReasoning({
      'Diagnostic Analyst': [
        JSON.stringify({
          action: 'write_file',
          path: 'analysis.md',
          contents: '# Analysis\nOversell observed under concurrency.',
        }),
        JSON.stringify({
          action: 'finish',
          summary: 'Analyzed the failure evidence.',
          artifacts: ['analysis.md'],
        }),
      ],
      'Report Writer': [
        JSON.stringify({
          action: 'write_file',
          path: 'DIAGNOSIS.md',
          contents: '# Diagnosis\nRoot cause with evidence.',
        }),
        JSON.stringify({
          action: 'finish',
          summary: 'Wrote the diagnosis report.',
          artifacts: ['DIAGNOSIS.md'],
        }),
      ],
    });
    const router = new CognitiveRouter(new RuleDecisionProvider());
    const SUFFIX =
      'REPO OPERATIONS: your workspace is a checkout on your own branch; ' +
      'commit your own work; never push.';
    const orchestrator = new MissionOrchestrator({
      goalCompiler: new GoalCompiler(),
      planner: new OrganizationPlanner(),
      genomeCompiler: new GenomeCompiler({
        registry: loadOwnership('data/ownership.yaml'),
        selectTier: (selection) => router.selectTier(selection),
      }),
      runtime,
      reasoning,
      recorder,
      workerBriefSuffix: SUFFIX,
    });

    const goal: Goal = {
      outcome:
        'Diagnose the intermittent failure in a small order system where ' +
        'the inventory occasionally allows more orders than available ' +
        'stock: analyze the incident evidence and write a diagnosis report ' +
        'stating the root cause, the supporting evidence, a confidence ' +
        'level, and what remains unknown.',
    };
    const result = await orchestrator.run(goal);

    expect(result.status).toBe('success');

    // The operational suffix reached BOTH specialists' briefs.
    for (const role of ['Diagnostic Analyst', 'Report Writer']) {
      const prompt = reasoning.calls
        .filter((call) => (call.system ?? '').includes(`You are ${role}`))
        .at(-1)!.prompt;
      expect(prompt).toContain('REPO OPERATIONS');
    }

    // And it never leaked into the classified goal: the diagnostic goal
    // with no engineering vocabulary compiled as diagnostic, not software
    // engineering — the compiler saw only what the caller wrote.
    const requirements = recorder.events.find(
      (event) => event.type === 'requirements-compiled',
    ) as { domain: string } | undefined;
    expect(requirements?.domain).toBe('diagnostic');

    // The caller's goal object was not mutated.
    expect(goal.context).toBeUndefined();
  });
});
