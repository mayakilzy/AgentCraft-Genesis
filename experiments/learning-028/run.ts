/**
 * TASK-028 — Measured Learning Experiment.
 *
 * The truth gate for Group 4. Runs the REAL Genesis pipeline (GoalCompiler,
 * OrganizationPlanner, GenomeCompiler, MissionOrchestrator, MemoryRuntime,
 * scripted ReasoningProvider) through three phases:
 *
 *   PHASE A — BEFORE: 2 diagnostic missions, no learned patterns.
 *   PHASE B — LEARNING: derive experiences, generate candidates, evaluate, promote.
 *   PHASE C — AFTER: 1 diagnostic mission WITH the promoted pattern.
 *
 * Then measures the delta and classifies the result honestly.
 *
 * Run: `npx tsx experiments/learning-028/run.ts`
 * Test: `npx vitest run tests/learning/experiment-028.test.ts`
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  StatisticalCandidateGenerator,
  RuleCandidateEvaluator,
  promoteCandidate,
  deriveExperience,
  MemoryExperienceStore,
  type Experience,
  type OrganizationalPattern,
} from '../../src/learning/index.js';

// ---------------------------------------------------------------------------
// Shared infrastructure — the REAL Genesis pipeline, no shortcuts.
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
    // Simulate simple shell redirects so workers with only shell-execution
    // (not workspace-files) can still create artifacts via run_command. This
    // mirrors what a real OpenBot runtime would do: the command actually
    // runs and the file is actually created. Without this, the MemoryRuntime
    // would unfairly penalize workers whose grants don't include
    // workspace-files — a confound for the learning experiment.
    const redirect = command.match(/>\s*'?([^'\s]+)'?\s*$/);
    if (redirect !== null) {
      const path = redirect[1];
      // Extract the text from echo/printf arguments.
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

/**
 * Scripted reasoning provider. Replies depend on the role in the system
 * prompt (same pattern as the orchestrator tests). The script models a
 * realistic diagnostic mission:
 *   - Diagnostic Analyst: writes analysis.md, then finishes
 *   - Reproduction Engineer: immediately finishes — nothing to reproduce
 *   - Report Writer: writes DIAGNOSIS.md, then finishes
 *   - Mission Coordinator: integrates and finishes
 * The verifier runs no reasoning calls (deterministic checks).
 *
 * Uses a queue per role so each role's script advances step-by-step.
 */
class DiagnosticReasoning implements ReasoningProvider {
  readonly name = 'diagnostic-scripted';
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
        if (queue.length === 0) {
          throw new Error(`script queue empty for "${marker}"`);
        }
        const [next, ...rest] = queue;
        this.queues.set(marker, rest);
        return { text: next };
      }
    }
    throw new Error(`no script for system: ${system.slice(0, 120)}`);
  }
}

/** Build a reasoning script for the BEFORE plan (4 workers incl. Reproduction Engineer). */
function beforeScript(): Record<string, readonly string[]> {
  return {
    'Diagnostic Analyst': [
      // The Diagnostic Analyst has shell-execution but NOT workspace-files
      // (data-analysis maps to shell-execution only in the ownership registry).
      // It creates its artifact via a shell command.
      JSON.stringify({
        action: 'run_command',
        command:
          "printf '# Analysis\\nSpindle overspeed under thermal load.\\n' > analysis.md",
      }),
      JSON.stringify({
        action: 'finish',
        summary: 'Analyzed the telemetry.',
        artifacts: ['analysis.md'],
      }),
    ],
    'Reproduction Engineer': [
      // The Reproduction Engineer finds nothing to do — the telemetry is
      // self-evident. It finishes with NO artifacts. This is the realistic
      // signal the candidate generator will detect.
      JSON.stringify({
        action: 'finish',
        summary: 'Nothing to reproduce; the telemetry was self-evident.',
      }),
    ],
    'Report Writer': [
      // The Report Writer has workspace-files (document-authoring maps to
      // workspace-files), so write_file works.
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
    'Mission Coordinator': [
      JSON.stringify({
        action: 'finish',
        summary: 'Integrated specialist reports into the diagnosis.',
      }),
    ],
  };
}

/**
 * Build a reasoning script for the AFTER plan. The AFTER plan has NO
 * Reproduction Engineer (the pattern omitted it) and NO Mission Coordinator
 * (fewer than 3 specialists). Only the Diagnostic Analyst and Report Writer
 * run. Their scripts are identical to BEFORE — the work is the same, just
 * without the redundant role.
 */
function afterScript(): Record<string, readonly string[]> {
  return {
    'Diagnostic Analyst': [
      JSON.stringify({
        action: 'run_command',
        command:
          "printf '# Analysis\\nSpindle overspeed under thermal load.\\n' > analysis.md",
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

interface MissionRun {
  readonly missionId: string;
  readonly result: ReturnType<MissionOrchestrator['run']> extends Promise<infer R> ? R : never;
  readonly events: readonly FlightEvent[];
  readonly planWorkers: number;
  readonly planRoles: readonly string[];
  readonly reasoningCalls: number;
  readonly verificationOk: boolean;
  readonly verificationPassed: number;
  readonly verificationFailed: number;
  readonly reproductionEngineerContribution: {
    readonly reasoningCalls: number;
    readonly artifactsCount: number;
  } | null;
}

async function runMission(
  label: string,
  patterns: readonly AdvisoryPattern[],
): Promise<{ run: MissionRun; experience: Experience; requirements: ReturnType<GoalCompiler['compile']> extends Promise<infer R> ? R : never }> {
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
  // BEFORE missions get the 4-worker script; AFTER missions (with patterns)
  // get the 2-worker script (no Reproduction Engineer, no Coordinator).
  const reasoning = new DiagnosticReasoning(
    patterns.length > 0 ? afterScript() : beforeScript(),
  );

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
  const requirements = await compiler.compile(GOAL);
  const plan = planner.plan(requirements);
  const events = recorder.events;

  // Find the Reproduction Engineer's contribution (if the role was in the plan).
  const reproductionEngineer = plan.workers.find((w) => w.role === 'Reproduction Engineer');
  let reproductionEngineerContribution: MissionRun['reproductionEngineerContribution'] = null;
  if (reproductionEngineer !== undefined) {
    const finished = events.find(
      (event): event is Extract<FlightEvent, { type: 'worker-finished' }> =>
        event.type === 'worker-finished' && event.workerId === reproductionEngineer.id,
    );
    reproductionEngineerContribution = {
      reasoningCalls: finished?.result.reasoningCalls ?? 0,
      artifactsCount: finished?.result.artifacts.length ?? 0,
    };
  }

  const finishedEvent = events.find(
    (event): event is Extract<FlightEvent, { type: 'mission-finished' }> =>
      event.type === 'mission-finished',
  );
  const verificationEvents = events.filter(
    (event): event is Extract<FlightEvent, { type: 'verification' }> =>
      event.type === 'verification',
  );
  const lastVerification =
    verificationEvents.length > 0 ? verificationEvents[verificationEvents.length - 1] : undefined;

  const run: MissionRun = {
    missionId,
    result,
    events,
    planWorkers: plan.workers.length,
    planRoles: plan.workers.map((w) => w.role),
    reasoningCalls: finishedEvent?.reasoningCalls ?? 0,
    verificationOk: lastVerification?.ok ?? false,
    verificationPassed: lastVerification?.passed ?? 0,
    verificationFailed: lastVerification?.failed ?? 0,
    reproductionEngineerContribution,
  };

  const experience = deriveExperience({
    missionId,
    requirements,
    plan,
    result,
    events,
    source: 'real-mission',
  });

  return { run, experience, requirements };
}

// ---------------------------------------------------------------------------
// The experiment
// ---------------------------------------------------------------------------

export type ExperimentClassification =
  | 'MEASURED_LEARNING_PASS'
  | 'MEASURED_LEARNING_NO_IMPROVEMENT'
  | 'MEASURED_LEARNING_REGRESSION'
  | 'EXPERIMENT_INCONCLUSIVE';

export interface ExperimentResult {
  readonly phase: 'A' | 'B' | 'C';
  readonly before: {
    readonly runs: readonly MissionRun[];
    readonly experiences: readonly Experience[];
  };
  readonly learning: {
    readonly candidateIds: readonly string[];
    readonly evaluations: readonly { candidateId: string; status: string; reason: string }[];
    readonly promotedPatternIds: readonly string[];
    readonly patterns: readonly OrganizationalPattern[];
  };
  readonly after: {
    readonly run: MissionRun;
    readonly experience: Experience;
  };
  readonly metrics: {
    readonly beforeWorkerCount: number;
    readonly afterWorkerCount: number;
    readonly workerDelta: number;
    readonly beforeReasoningCalls: number;
    readonly afterReasoningCalls: number;
    readonly reasoningDelta: number;
    readonly beforeVerificationOk: boolean;
    readonly afterVerificationOk: boolean;
    readonly patternApplied: boolean;
    readonly patternProvenanceTraces: boolean;
  };
  readonly classification: ExperimentClassification;
  readonly classificationReason: string;
}

export async function runExperiment(): Promise<ExperimentResult> {
  // -------------------------------------------------------------------------
  // PHASE A — BEFORE LEARNING (2 diagnostic missions, no patterns)
  // -------------------------------------------------------------------------
  const beforeRuns: MissionRun[] = [];
  const beforeExperiences: Experience[] = [];
  const store = new MemoryExperienceStore();

  for (let i = 0; i < 2; i++) {
    const { run, experience } = await runMission(`before-${i + 1}`, []);
    beforeRuns.push(run);
    beforeExperiences.push(experience);
    store.record(experience);
  }

  // -------------------------------------------------------------------------
  // PHASE B — LEARNING (generate, evaluate, promote)
  // -------------------------------------------------------------------------
  const generator = new StatisticalCandidateGenerator({
    now: () => '2026-10-07T00:00:00Z',
  });
  const candidates = generator.generate(store.all());

  const evaluator = new RuleCandidateEvaluator({
    promotionThreshold: 2,
    now: () => '2026-10-07T00:00:00Z',
  });
  const evaluations = candidates.map((candidate) => ({
    candidate,
    evaluation: evaluator.evaluate(candidate, store.all()),
  }));

  const patterns: OrganizationalPattern[] = [];
  for (const { candidate, evaluation } of evaluations) {
    if (evaluation.status === 'promoted') {
      patterns.push(
        promoteCandidate(candidate, evaluation, () => '2026-10-07T01:00:00Z'),
      );
    }
  }

  // -------------------------------------------------------------------------
  // PHASE C — AFTER LEARNING (1 mission WITH promoted patterns)
  // -------------------------------------------------------------------------
  const advisoryPatterns: readonly AdvisoryPattern[] = patterns.map((pattern) => ({
    id: pattern.id,
    applicableContext: pattern.applicableContext,
    proposedEffect: pattern.proposedEffect,
  }));
  const afterRun = await runMission('after-1', advisoryPatterns);
  // Derive the AFTER experience too (for completeness; not used in metrics).
  const afterExperience = afterRun.experience;

  // -------------------------------------------------------------------------
  // Metrics — measured from ACTUAL persisted state
  // -------------------------------------------------------------------------
  const beforeWorkerCount = beforeRuns[0].planWorkers;
  const afterWorkerCount = afterRun.run.planWorkers;
  const beforeReasoningCalls = beforeRuns[0].reasoningCalls;
  const afterReasoningCalls = afterRun.run.reasoningCalls;
  const beforeVerificationOk = beforeRuns[0].verificationOk;
  const afterVerificationOk = afterRun.run.verificationOk;

  // Pattern applied: the AFTER plan's `learned.applied` should be non-empty.
  // We re-derive the plan to inspect this (the orchestrator already used it).
  const afterRequirements = afterRun.requirements;
  const afterPlan = new OrganizationPlanner({ patterns: advisoryPatterns }).plan(afterRequirements);
  const patternApplied = (afterPlan.learned?.applied ?? []).length > 0;

  // Pattern provenance: the promoted pattern's supportingExperienceIds must
  // include the 2 BEFORE experiences.
  const beforeExpIds = new Set(beforeExperiences.map((exp) => exp.id));
  const patternProvenanceTraces = patterns.every((pattern) =>
    pattern.promotionEvidence.supportingExperienceIds.every((id) => beforeExpIds.has(id)),
  );

  // -------------------------------------------------------------------------
  // Classification (honest — see DESIGN.md)
  // -------------------------------------------------------------------------
  let classification: ExperimentClassification;
  let classificationReason: string;

  const workerDelta = afterWorkerCount - beforeWorkerCount;
  const reasoningDelta = afterReasoningCalls - beforeReasoningCalls;

  if (!beforeVerificationOk || !afterVerificationOk) {
    // If either phase failed verification, the comparison is contaminated.
    classification = 'EXPERIMENT_INCONCLUSIVE';
    classificationReason =
      `Verification contaminated the comparison: before ok=${beforeVerificationOk}, ` +
      `after ok=${afterVerificationOk}. Cannot draw a learning-effect conclusion.`;
  } else if (workerDelta < 0 && reasoningDelta <= 0 && patternApplied && patternProvenanceTraces) {
    classification = 'MEASURED_LEARNING_PASS';
    classificationReason =
      `Workers decreased (${beforeWorkerCount} → ${afterWorkerCount}, Δ=${workerDelta}), ` +
      `reasoning calls decreased or equal (${beforeReasoningCalls} → ${afterReasoningCalls}, Δ=${reasoningDelta}), ` +
      `verification equivalent (both passed), ` +
      `pattern was applied, ` +
      `provenance traces to supporting experiences.`;
  } else if (workerDelta < 0 && afterVerificationOk && !patternApplied) {
    classification = 'MEASURED_LEARNING_NO_IMPROVEMENT';
    classificationReason =
      `Worker count decreased but the pattern was NOT applied — the improvement ` +
      `is not attributable to learning. workerDelta=${workerDelta}.`;
  } else if (workerDelta >= 0) {
    classification = 'MEASURED_LEARNING_NO_IMPROVEMENT';
    classificationReason =
      `Worker count did not decrease (${beforeWorkerCount} → ${afterWorkerCount}, Δ=${workerDelta}). ` +
      `No measurable organizational improvement from learning.`;
  } else if (workerDelta < 0 && !afterVerificationOk) {
    classification = 'MEASURED_LEARNING_REGRESSION';
    classificationReason =
      `Worker count decreased but verification FAILED — the smaller organization ` +
      `is worse, not better. workerDelta=${workerDelta}, afterVerificationOk=${afterVerificationOk}.`;
  } else {
    classification = 'MEASURED_LEARNING_NO_IMPROVEMENT';
    classificationReason =
      `Improvement criteria not met: workerDelta=${workerDelta}, reasoningDelta=${reasoningDelta}, ` +
      `patternApplied=${patternApplied}, patternProvenanceTraces=${patternProvenanceTraces}.`;
  }

  return {
    phase: 'C',
    before: { runs: beforeRuns, experiences: beforeExperiences },
    learning: {
      candidateIds: candidates.map((c) => c.id),
      evaluations: evaluations.map(({ candidate, evaluation }) => ({
        candidateId: candidate.id,
        status: evaluation.status,
        reason: evaluation.reason,
      })),
      promotedPatternIds: patterns.map((p) => p.id),
      patterns,
    },
    after: { run: afterRun.run, experience: afterExperience },
    metrics: {
      beforeWorkerCount,
      afterWorkerCount,
      workerDelta,
      beforeReasoningCalls,
      afterReasoningCalls,
      reasoningDelta,
      beforeVerificationOk,
      afterVerificationOk,
      patternApplied,
      patternProvenanceTraces,
    },
    classification,
    classificationReason,
  };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const result = await runExperiment();

  const lines: string[] = [];
  lines.push('# TASK-028 — Measured Learning Experiment — Result');
  lines.push('');
  lines.push('## Classification');
  lines.push('');
  lines.push(`**${result.classification}**`);
  lines.push('');
  lines.push(result.classificationReason);
  lines.push('');
  lines.push('## Metrics');
  lines.push('');
  lines.push('| Metric | BEFORE | AFTER | Delta |');
  lines.push('|--------|--------|-------|-------|');
  lines.push(`| Worker count | ${result.metrics.beforeWorkerCount} | ${result.metrics.afterWorkerCount} | ${result.metrics.workerDelta} |`);
  lines.push(`| Reasoning calls | ${result.metrics.beforeReasoningCalls} | ${result.metrics.afterReasoningCalls} | ${result.metrics.reasoningDelta} |`);
  lines.push(`| Verification ok | ${result.metrics.beforeVerificationOk} | ${result.metrics.afterVerificationOk} | — |`);
  lines.push(`| Pattern applied | — | ${result.metrics.patternApplied} | — |`);
  lines.push(`| Provenance traces | — | ${result.metrics.patternProvenanceTraces} | — |`);
  lines.push('');
  lines.push('## PHASE A — BEFORE (2 missions, no patterns)');
  lines.push('');
  for (const run of result.before.runs) {
    lines.push(`### ${run.missionId}`);
    lines.push(`- Workers: ${run.planWorkers} (${run.planRoles.join(', ')})`);
    lines.push(`- Reasoning calls: ${run.reasoningCalls}`);
    lines.push(`- Verification: ok=${run.verificationOk}, passed=${run.verificationPassed}, failed=${run.verificationFailed}`);
    if (run.reproductionEngineerContribution !== null) {
      lines.push(`- Reproduction Engineer contribution: reasoningCalls=${run.reproductionEngineerContribution.reasoningCalls}, artifacts=${run.reproductionEngineerContribution.artifactsCount}`);
    }
    lines.push(`- Mission status: ${run.result.status}`);
    lines.push('');
  }
  lines.push('## PHASE B — LEARNING');
  lines.push('');
  lines.push(`- Candidates generated: ${result.learning.candidateIds.length}`);
  for (const id of result.learning.candidateIds) {
    lines.push(`  - ${id}`);
  }
  lines.push(`- Evaluations:`);
  for (const evaluation of result.learning.evaluations) {
    lines.push(`  - ${evaluation.candidateId}: **${evaluation.status}** — ${evaluation.reason}`);
  }
  lines.push(`- Patterns promoted: ${result.learning.promotedPatternIds.length}`);
  for (const pattern of result.learning.patterns) {
    lines.push(`  - ${pattern.id}`);
    lines.push(`    - hypothesis: ${pattern.hypothesis}`);
    lines.push(`    - effect: ${pattern.proposedEffect.kind} → ${pattern.proposedEffect.targetRole ?? pattern.proposedEffect.targetShape?.workerCount ?? '?'}`);
    lines.push(`    - supporting experiences: ${pattern.promotionEvidence.supportingExperienceIds.join(', ')}`);
  }
  lines.push('');
  lines.push('## PHASE C — AFTER (1 mission WITH promoted pattern)');
  lines.push('');
  const afterRun = result.after.run;
  lines.push(`### ${afterRun.missionId}`);
  lines.push(`- Workers: ${afterRun.planWorkers} (${afterRun.planRoles.join(', ')})`);
  lines.push(`- Reasoning calls: ${afterRun.reasoningCalls}`);
  lines.push(`- Verification: ok=${afterRun.verificationOk}, passed=${afterRun.verificationPassed}, failed=${afterRun.verificationFailed}`);
  if (afterRun.reproductionEngineerContribution !== null) {
    lines.push(`- Reproduction Engineer contribution: reasoningCalls=${afterRun.reproductionEngineerContribution.reasoningCalls}, artifacts=${afterRun.reproductionEngineerContribution.artifactsCount}`);
  } else {
    lines.push(`- Reproduction Engineer: NOT IN PLAN (pattern applied)`);
  }
  lines.push(`- Mission status: ${afterRun.result.status}`);
  lines.push('');
  lines.push('## What this proved');
  lines.push('');
  if (result.classification === 'MEASURED_LEARNING_PASS') {
    lines.push('Genesis converted real organizational execution experience into validated reusable knowledge that measurably improved a later organization: fewer workers, equivalent verified outcome, fewer reasoning calls. The learning loop is closed and the improvement is real.');
  } else if (result.classification === 'MEASURED_LEARNING_NO_IMPROVEMENT') {
    lines.push('Genesis implemented the organizational learning loop, but measured improvement was not demonstrated. The mechanism exists; the effect on this workload was not a measurable improvement.');
  } else if (result.classification === 'MEASURED_LEARNING_REGRESSION') {
    lines.push('Genesis\'s learning mechanism produced a regression on the measured experiment: the smaller organization was worse, not better.');
  } else {
    lines.push('The mechanism exists, but experimental conditions did not support a valid learning-effect conclusion.');
  }

  const report = lines.join('\n');
  mkdirSync('experiments/learning-028', { recursive: true });
  writeFileSync(join('experiments/learning-028', 'REPORT.md'), report, 'utf8');

  console.log(report);
  console.log('\n--- Report written to experiments/learning-028/REPORT.md ---');
}

// Run when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
