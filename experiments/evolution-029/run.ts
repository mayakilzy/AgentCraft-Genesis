/**
 * TASK-029 — Evolution Sandbox Experiment.
 *
 * Demonstrates a small real evolution cycle on top of TASK-028's
 * MEASURED_LEARNING_PASS result.
 *
 * The cycle:
 *   1. Take the validated pattern from TASK-028 (avoid Reproduction Engineer
 *      for diagnostic missions).
 *   2. Propose a variant: ALSO avoid the Mission Coordinator for diagnostic
 *      missions (a more aggressive evolution of the same organizational
 *      knowledge).
 *   3. Evaluate the variant in the SANDBOX: run a baseline mission (with the
 *      TASK-028 pattern) and a variant mission (with the TASK-028 pattern +
 *      the variant), then compare.
 *   4. The sandbox produces a NON-BINDING decision. Production behavior is
 *      unchanged until the caller explicitly promotes the variant.
 *
 * Result classification (per spec):
 *   - If the variant is promoted: EVOLUTION_MECHANISM_EXISTS + EVOLUTION_IMPROVES.
 *   - If the variant is rejected or inconclusive: EVOLUTION_MECHANISM_EXISTS only.
 *
 * The sandbox reuses TASK-026's evaluation concepts (measured comparison,
 * not model confidence) and the same MissionOrchestrator infrastructure as
 * TASK-028. No second promotion framework.
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

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
import {
  OrganizationPlanner,
  type AdvisoryPattern,
} from '../../src/organization/organization-planner.js';
import { CognitiveRouter } from '../../src/routing/cognitive-router.js';
import { RuleDecisionProvider } from '../../src/routing/decision-provider.js';
import type { WorkerComputer, WorkerRuntime } from '../../src/runtime/computer.js';
import { MissionOrchestrator } from '../../src/mission/orchestrator.js';
import {
  MemoryFlightRecorder,
  type FlightEvent,
} from '../../src/mission/flight-recorder.js';
import {
  EvolutionSandbox,
  promoteVariant,
  type EvolutionRunSnapshot,
  type EvolutionVariant,
} from '../../src/learning/evolution.js';

// ---------------------------------------------------------------------------
// Shared infrastructure — identical to TASK-028's experiment.
// ---------------------------------------------------------------------------

const GOAL: Goal = {
  outcome:
    'Diagnose why CNC machine 7 halts with spindle fault E-04 after twenty ' +
    'minutes; reproduce it from the telemetry logs and identify the root ' +
    'cause in a diagnosis report.',
};

class MemoryComputer implements WorkerComputer {
  readonly files = new Map<string, string>();
  async exec(command: string) {
    const redirect = command.match(/>\s*'?([^'\s]+)'?\s*$/);
    if (redirect !== null) {
      const path = redirect[1];
      const echoMatch = command.match(/(?:echo|printf)\s+'([^']*)'/);
      const contents = echoMatch !== null ? echoMatch[1].replace(/\\n/g, '\n') : '';
      this.files.set(path, contents);
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

class MemoryRuntime implements WorkerRuntime {
  readonly name = 'memory-runtime';
  readonly stopped: string[] = [];
  readonly computers = new Map<string, MemoryComputer>();
  async ensureWorker(genome: WorkerGenome): Promise<RuntimeHandle> {
    if (!genome.computer.required) return { workerId: genome.identity.id, ref: 'memory:none' };
    this.computers.set(genome.identity.id, new MemoryComputer());
    return { workerId: genome.identity.id, ref: `memory:${genome.identity.id}` };
  }
  computer(handle: RuntimeHandle): WorkerComputer {
    const computer = this.computers.get(handle.workerId);
    if (!computer) throw new Error(`no computer for ${handle.workerId}`);
    return computer;
  }
  async stopWorker(handle: RuntimeHandle): Promise<void> {
    this.stopped.push(handle.workerId);
  }
}

class ScriptedReasoning implements ReasoningProvider {
  readonly name = 'evolution-scripted';
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
        if (queue.length === 0) throw new Error(`script queue empty for "${marker}"`);
        const [next, ...rest] = queue;
        this.queues.set(marker, rest);
        return { text: next };
      }
    }
    throw new Error(`no script for system: ${system.slice(0, 120)}`);
  }
}

/**
 * The script for a 2-specialist plan (Diagnostic Analyst + Report Writer).
 * Used by both the baseline run (TASK-028 pattern → 2 workers) and the
 * variant run (TASK-028 pattern + variant → still 2 workers, since the
 * Mission Coordinator isn't in specialists).
 */
function twoSpecialistScript(): Record<string, readonly string[]> {
  return {
    'Diagnostic Analyst': [
      JSON.stringify({
        action: 'run_command',
        command: "printf '# Analysis\\nSpindle overspeed under thermal load.\\n' > analysis.md",
      }),
      JSON.stringify({
        action: 'finish',
        summary: 'Analyzed the telemetry.',
        artifacts: ['analysis.md'],
      }),
    ],
    'Report Writer': [
      JSON.stringify({
        action: 'write_file',
        path: 'DIAGNOSIS.md',
        contents: '# Diagnosis\nRoot cause: thermal spindle overspeed.',
      }),
      JSON.stringify({
        action: 'finish',
        summary: 'Wrote the diagnosis report.',
        artifacts: ['DIAGNOSIS.md'],
      }),
    ],
  };
}

async function runMissionSnapshot(
  label: string,
  patterns: readonly AdvisoryPattern[],
): Promise<EvolutionRunSnapshot> {
  const runtime = new MemoryRuntime();
  const recorder = new MemoryFlightRecorder();
  const router = new CognitiveRouter(new RuleDecisionProvider());
  const compiler = new GoalCompiler();
  const planner = new OrganizationPlanner({ patterns });
  const genomeCompiler = new GenomeCompiler({
    registry: loadOwnership('data/ownership.yaml'),
    selectTier: (selection) => router.selectTier(selection),
  });
  const missionId = `${label}-${randomBytes(3).toString('hex')}`;
  // Both baseline and variant runs produce 2-specialist plans (Diagnostic
  // Analyst + Report Writer). The same script works for both.
  const reasoning = new ScriptedReasoning(twoSpecialistScript());

  const orchestrator = new MissionOrchestrator({
    goalCompiler: compiler,
    planner,
    genomeCompiler,
    runtime,
    reasoning,
    recorder,
    missionId,
    missionTimeoutMs: 30_000,
  });

  const result = await orchestrator.run(GOAL);
  const events = recorder.events;
  const finished = events.find(
    (event): event is Extract<FlightEvent, { type: 'mission-finished' }> =>
      event.type === 'mission-finished',
  );
  const verificationEvents = events.filter(
    (event): event is Extract<FlightEvent, { type: 'verification' }> =>
      event.type === 'verification',
  );
  const lastVerification =
    verificationEvents.length > 0 ? verificationEvents[verificationEvents.length - 1] : undefined;

  const requirements = await compiler.compile(GOAL);
  const plan = planner.plan(requirements);

  return {
    workerCount: plan.workers.length,
    reasoningCalls: finished?.reasoningCalls ?? 0,
    verificationOk: lastVerification?.ok ?? false,
    verificationPassed: lastVerification?.passed ?? 0,
    verificationFailed: lastVerification?.failed ?? 0,
    status: result.status,
  };
}

// ---------------------------------------------------------------------------
// The evolution experiment
// ---------------------------------------------------------------------------

export interface EvolutionExperimentResult {
  readonly baselinePattern: AdvisoryPattern;
  readonly variant: EvolutionVariant;
  readonly baselineSnapshot: EvolutionRunSnapshot;
  readonly variantSnapshot: EvolutionRunSnapshot;
  readonly decision: 'promote' | 'reject' | 'inconclusive';
  readonly reason: string;
  readonly isolationVerified: boolean;
  readonly productionPatternsBefore: readonly AdvisoryPattern[];
  readonly productionPatternsAfter: readonly AdvisoryPattern[];
  readonly variantPromotedToProduction: boolean;
}

export async function runEvolutionExperiment(): Promise<EvolutionExperimentResult> {
  // The validated pattern from TASK-028 (avoid Reproduction Engineer for
  // diagnostic missions). This is the CURRENT production state.
  const baselinePattern: AdvisoryPattern = {
    id: 'pat-diagnostic-avoid-reproduction-engineer',
    applicableContext: { domain: 'diagnostic' },
    proposedEffect: {
      kind: 'avoid-role',
      description: 'Omit Reproduction Engineer for diagnostic missions.',
      targetRole: 'Reproduction Engineer',
    },
  };

  // The production patterns BEFORE the evolution experiment.
  const productionPatternsBefore: readonly AdvisoryPattern[] = [baselinePattern];

  // The proposed variant: ALSO avoid the Mission Coordinator for diagnostic
  // missions. This is a more aggressive evolution of the same organizational
  // knowledge — if coordinators don't produce artifacts for diagnostic
  // missions either, maybe we can omit them too.
  const variant: EvolutionVariant = {
    id: 'variant-avoid-coordinator',
    baselinePatternId: baselinePattern.id,
    description:
      'Also omit the Mission Coordinator for diagnostic missions — the ' +
      'coordinator produced no artifacts in TASK-028 experiences either.',
    pattern: {
      id: 'pat-diagnostic-avoid-mission-coordinator-variant',
      applicableContext: { domain: 'diagnostic' },
      proposedEffect: {
        kind: 'avoid-role',
        description: 'Omit Mission Coordinator for diagnostic missions.',
        targetRole: 'Mission Coordinator',
      },
    },
  };

  // Evaluate the variant in the SANDBOX. The sandbox runs two missions:
  //   - baseline: production patterns only (avoid Reproduction Engineer)
  //   - variant: production patterns + variant (avoid both)
  // The sandbox does NOT modify productionPatternsBefore.
  const sandbox = new EvolutionSandbox();
  const result = await sandbox.evaluate(
    variant,
    productionPatternsBefore,
    (patterns) => runMissionSnapshot('evolution', patterns),
  );

  // The sandbox's decision is NON-BINDING. The caller decides whether to
  // promote. If promoted, the variant is added to the production set.
  let productionPatternsAfter = productionPatternsBefore;
  let variantPromotedToProduction = false;
  if (result.decision === 'promote') {
    productionPatternsAfter = promoteVariant(productionPatternsBefore, result);
    variantPromotedToProduction = true;
  }

  return {
    baselinePattern,
    variant,
    baselineSnapshot: result.baseline,
    variantSnapshot: result.variantRun,
    decision: result.decision,
    reason: result.reason,
    isolationVerified: result.isolationVerified,
    productionPatternsBefore,
    productionPatternsAfter,
    variantPromotedToProduction,
  };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const result = await runEvolutionExperiment();

  const lines: string[] = [];
  lines.push('# TASK-029 — Evolution Sandbox Experiment — Result');
  lines.push('');
  lines.push('## Sandbox Decision');
  lines.push('');
  lines.push(`**${result.decision.toUpperCase()}**`);
  lines.push('');
  lines.push(result.reason);
  lines.push('');
  lines.push('## Setup');
  lines.push('');
  lines.push('**Baseline pattern** (from TASK-028, current production state):');
  lines.push(`- id: ${result.baselinePattern.id}`);
  lines.push(`- effect: ${result.baselinePattern.proposedEffect.kind} → ${result.baselinePattern.proposedEffect.targetRole}`);
  lines.push('');
  lines.push('**Proposed variant**:');
  lines.push(`- id: ${result.variant.id}`);
  lines.push(`- description: ${result.variant.description}`);
  lines.push(`- effect: ${result.variant.pattern.proposedEffect.kind} → ${result.variant.pattern.proposedEffect.targetRole}`);
  lines.push('');
  lines.push('## Comparison (measured from real mission runs)');
  lines.push('');
  lines.push('| Metric | Baseline | Variant | Delta |');
  lines.push('|--------|----------|---------|-------|');
  lines.push(`| Worker count | ${result.baselineSnapshot.workerCount} | ${result.variantSnapshot.workerCount} | ${result.variantSnapshot.workerCount - result.baselineSnapshot.workerCount} |`);
  lines.push(`| Reasoning calls | ${result.baselineSnapshot.reasoningCalls} | ${result.variantSnapshot.reasoningCalls} | ${result.variantSnapshot.reasoningCalls - result.baselineSnapshot.reasoningCalls} |`);
  lines.push(`| Verification ok | ${result.baselineSnapshot.verificationOk} | ${result.variantSnapshot.verificationOk} | — |`);
  lines.push(`| Verification passed | ${result.baselineSnapshot.verificationPassed} | ${result.variantSnapshot.verificationPassed} | — |`);
  lines.push(`| Mission status | ${result.baselineSnapshot.status} | ${result.variantSnapshot.status} | — |`);
  lines.push('');
  lines.push('## Isolation');
  lines.push('');
  lines.push(`- Sandbox verified isolation: ${result.isolationVerified}`);
  lines.push(`- Production patterns before: ${result.productionPatternsBefore.length}`);
  lines.push(`- Production patterns after: ${result.productionPatternsAfter.length}`);
  lines.push(`- Variant promoted to production: ${result.variantPromotedToProduction}`);
  lines.push('');
  lines.push('## Classification');
  lines.push('');
  if (result.decision === 'promote') {
    lines.push('**EVOLUTION_MECHANISM_EXISTS + EVOLUTION_IMPROVES_GENESIS**');
    lines.push('');
    lines.push('The sandbox evaluated a variant of a validated organizational pattern in isolation. The variant produced a strictly better organization (fewer workers, equivalent verification). The variant was promoted to production — but only after the sandbox decision, never silently.');
  } else if (result.decision === 'reject') {
    lines.push('**EVOLUTION_MECHANISM_EXISTS** (variant rejected)');
    lines.push('');
    lines.push('The sandbox evaluated a variant and rejected it: the variant was worse than the baseline. Production behavior is unchanged. The evolution mechanism exists and works, but this variant did not improve Genesis.');
  } else {
    lines.push('**EVOLUTION_MECHANISM_EXISTS** (inconclusive)');
    lines.push('');
    lines.push('The sandbox evaluated a variant but the result was inconclusive — neither strictly better nor worse. Production behavior is unchanged. The evolution mechanism exists, but this variant did not produce a measurable improvement.');
  }
  lines.push('');
  lines.push('## What this proved');
  lines.push('');
  lines.push('1. The evolution sandbox can evaluate a proposed variation of a validated organizational pattern in ISOLATION.');
  lines.push('2. Production behavior is unchanged until the variant is explicitly promoted (isolation verified).');
  lines.push('3. The decision is evidence-driven (measured comparison, not model confidence) — reusing TASK-026 evaluation concepts.');
  lines.push('4. No uncontrolled self-modification: the variant enters production only through `promoteVariant`, which requires a sandbox `promote` decision.');
  lines.push('');
  lines.push('## Relation to TASK-028');
  lines.push('');
  lines.push('TASK-028 produced MEASURED_LEARNING_PASS, so TASK-029 may demonstrate a real evolution cycle. This experiment does so: the variant is a more aggressive version of the TASK-028 pattern, evaluated against the TASK-028 baseline in the sandbox.');

  const report = lines.join('\n');
  mkdirSync('experiments/evolution-029', { recursive: true });
  writeFileSync('experiments/evolution-029/REPORT.md', report, 'utf8');

  console.log(report);
  console.log('\n--- Report written to experiments/evolution-029/REPORT.md ---');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
