import { randomBytes } from 'node:crypto';

import type {
  Evidence,
  Goal,
  GoalRequirements,
  MissionResult,
  OrganizationPlan,
  PlannedWorker,
  ReasoningProvider,
  RuntimeHandle,
  WorkerGenome,
} from '../contracts/core.js';
import type { GoalCompiler } from '../goal/goal-compiler.js';
import type { GenomeCompiler } from '../genome/genome-compiler.js';
import type { OrganizationPlanner } from '../organization/organization-planner.js';
import type { WorkerRuntime } from '../runtime/computer.js';
import type { WorkerResult } from '../worker/worker-agent.js';
import { WorkerAgent } from '../worker/worker-agent.js';
import {
  MissionHandoffs,
  type HandoffParticipant,
} from '../worker/handoff.js';
import type { FlightEvent, FlightRecorder } from './flight-recorder.js';

/** Emission helper signature used throughout the orchestrator. */
type RecordFn = (event: FlightEvent) => void;

/**
 * Mission Orchestrator (TASK-012) — the first complete Born loop:
 *
 *   Goal → Requirements → Plan → Genomes → ensure Workers → real Work →
 *   Result → retire Workers
 *
 * Deliberately thin: create/start/coordinate/finish/retire and nothing else.
 * Failure is simple and loud (a failed worker or aborted mission surfaces as
 * a failed or partial mission with reasons — never as silent success); the
 * timeout is one AbortController, not a state machine; retirement happens in
 * a finally block so temporary workers always end. Verification is the
 * built-in structural gate here; TASK-013 replaces it with the real
 * acceptance-check loop, and TASK-014 wires the durable flight recorder.
 *
 * v0.1 coordination reality (recorded honestly): decomposition is the
 * Organization Planner's job (GROUP 1, accepted); the Mission Coordinator
 * worker integrates specialist results into the mission summary rather than
 * re-decomposing; quality control is the verification loop's job.
 */

export interface MissionOrchestratorOptions {
  readonly goalCompiler: GoalCompiler;
  readonly planner: OrganizationPlanner;
  readonly genomeCompiler: GenomeCompiler;
  readonly runtime: WorkerRuntime;
  readonly reasoning: ReasoningProvider;
  readonly recorder?: FlightRecorder;
  /** Per-worker step ceiling (default: the WorkerAgent default). */
  readonly maxWorkerSteps?: number;
  /** Whole-mission budget (default 10 minutes). */
  readonly missionTimeoutMs?: number;
  /** External cancellation. */
  readonly signal?: AbortSignal;
  /**
   * Real spend telemetry when the reasoning provider can report it; the
   * MissionCost contract is honored either way (zeros when absent).
   */
  readonly costSource?: () => { usd: number; tokens: number };
}

const COORDINATOR_ROLE = 'Mission Coordinator';

function newMissionId(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '');
  return `mission-${stamp}-${randomBytes(3).toString('hex')}`;
}

/** Deterministic task brief: assignment + mission + upstream results. */
export function renderTaskBrief(
  worker: PlannedWorker,
  requirements: GoalRequirements,
  upstream: readonly { worker: PlannedWorker; result: WorkerResult }[],
): string {
  const lines = [
    `Your assignment: ${worker.responsibility}.`,
    `Mission: "${requirements.source.outcome}"`,
  ];
  if (requirements.hardConstraints.length > 0) {
    lines.push(`Hard constraints: ${requirements.hardConstraints.join('; ')}`);
  }
  if (requirements.successCriteria.length > 0) {
    lines.push(
      `Success criteria: ${requirements.successCriteria
        .map((criterion) => criterion.description)
        .join(' | ')}`,
    );
  }
  if (upstream.length > 0) {
    lines.push('Inputs from colleagues:');
    for (const { worker: from, result } of upstream) {
      lines.push(
        `- ${from.role} (${from.id}) reported: ${result.summary}`,
      );
      if (result.artifacts.length > 0) {
        lines.push(`  their workspace artifacts: ${result.artifacts.join(', ')}`);
      }
      if (result.status === 'failure') {
        lines.push('  (their run FAILED — treat their inputs accordingly)');
      }
    }
  }
  lines.push(
    'Deliverables go to your own workspace. Finish with your artifact paths when done.',
  );
  return lines.join('\n');
}

export class MissionOrchestrator {
  private readonly options: MissionOrchestratorOptions;

  constructor(options: MissionOrchestratorOptions) {
    this.options = options;
  }

  async run(goal: Goal): Promise<MissionResult> {
    const startedAt = Date.now();
    const missionId = newMissionId();
    const recorder = this.options.recorder;
    const record: RecordFn = (event) => {
      recorder?.record(event);
    };

    const controller = new AbortController();
    const onExternalAbort = (): void => controller.abort();
    this.options.signal?.addEventListener('abort', onExternalAbort, {
      once: true,
    });
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.missionTimeoutMs ?? 10 * 60_000,
    );

    /** Every worker ensured so far — retired in the finally block, always. */
    const ensured: { handle: RuntimeHandle; genome: WorkerGenome }[] = [];

    try {
      record({
        type: 'mission-started',
        at: new Date().toISOString(),
        missionId,
        goalOutcome: goal.outcome,
        budgetUsd: goal.budget?.maxUsd ?? 25,
      });

      // Born chain: Goal → Requirements → Plan → Genomes.
      const requirements = await this.options.goalCompiler.compile(goal);
      record({
        type: 'requirements-compiled',
        missionId,
        domain: requirements.domain,
        capabilityNeeds: [...requirements.capabilityNeeds],
        successCriteria: requirements.successCriteria.map((c) => c.description),
        budgetUsd: requirements.budget.maxUsd,
      });

      const plan = this.options.planner.plan(requirements);
      record({
        type: 'plan-created',
        missionId,
        workers: plan.workers.map((w) => ({
          id: w.id,
          role: w.role,
          needs: [...w.capabilityNeeds],
        })),
        rationale: plan.rationale,
      });

      const compilation = await this.options.genomeCompiler.compilePlan(
        plan,
        requirements,
      );
      record({
        type: 'genomes-compiled',
        missionId,
        workers: compilation.results.map((r) => ({
          id: r.worker.id,
          tier: r.genome?.model ?? 'none',
          tools: r.genome ? [...r.genome.tools] : [],
          computerRequired: r.genome?.computer.required ?? false,
        })),
        gaps: compilation.results.flatMap((r) =>
          (r.gaps ?? []).map((gap) => ({
            workerId: gap.workerId,
            need: gap.need,
            reason: gap.reason,
          })),
        ),
      });

      if (!compilation.ok) {
        // A structured capability gap is a loud failure — never a guess.
        return this.finishMission(
          missionId,
          'failure',
          buildGapSummary(compilation.results.map((r) => r.gaps ?? [])),
          [],
          startedAt,
          0,
          record,
        );
      }

      // Materialize workers in the real runtime.
      const participants = new Map<string, HandoffParticipant>();
      const genomes = new Map<string, WorkerGenome>();
      for (const result of compilation.results) {
        const genome = result.genome!;
        const handle = await this.options.runtime.ensureWorker(genome);
        ensured.push({ handle, genome });
        genomes.set(genome.identity.id, genome);
        participants.set(genome.identity.id, {
          genome,
          reasoning: this.options.reasoning,
          computer: genome.computer.required
            ? this.options.runtime.computer(handle)
            : null,
        });
      }

      const handoffs = new MissionHandoffs(participants, {
        signal: controller.signal,
        onEvent: (event) => record(event),
      });

      // Specialists run in plan order (upstream results flow along the
      // collaboration edges); the coordinator integrates afterwards.
      const results = new Map<string, WorkerResult>();
      const specialists = plan.workers.filter(
        (w) => w.role !== COORDINATOR_ROLE,
      );
      const coordinator = plan.workers.find(
        (w) => w.role === COORDINATOR_ROLE,
      );

      let reasoningCalls = 0;
      const countWorker = (result: WorkerResult): void => {
        results.set(result.workerId, result);
        reasoningCalls += result.reasoningCalls;
      };
      for (const worker of specialists) {
        if (controller.signal.aborted) break;
        const brief = renderTaskBrief(
          worker,
          requirements,
          upstreamResults(plan, worker, results),
        );
        const result = await this.runWorker(
          worker,
          genomes.get(worker.id)!,
          participants.get(worker.id)!,
          brief,
          handoffs,
          controller.signal,
          record,
        );
        countWorker(result);
      }

      let coordinatorSummary = '';
      if (coordinator && !controller.signal.aborted) {
        const brief = [
          `You are integrating the results of a mission you coordinated.`,
          `Mission: "${requirements.source.outcome}"`,
          'Specialist reports:',
          ...specialists.map(
            (w) =>
              `- ${w.role} (${w.id}): ${results.get(w.id)?.summary ?? 'did not run'}`,
          ),
          'Produce the integrated mission summary: what was achieved, with which artifacts, and anything that failed or is missing.',
        ].join('\n');
        const result = await this.runWorker(
          coordinator,
          genomes.get(coordinator.id)!,
          participants.get(coordinator.id)!,
          brief,
          handoffs,
          controller.signal,
          record,
        );
        reasoningCalls += result.reasoningCalls;
        if (result.status === 'success' && result.summary.trim() !== '') {
          coordinatorSummary = result.summary;
        }
      }

      // Built-in structural gate (TASK-013 replaces this with the real
      // acceptance-check loop): the mission claims nothing the workers did
      // not actually produce.
      const allResults = [...results.values()];
      const artifacts = allResults.flatMap((r) => r.artifacts);
      const evidence = allResults.flatMap((r) => r.evidence);
      const failures = allResults.filter((r) => r.status === 'failure');
      const aborted = controller.signal.aborted;

      let status: MissionResult['status'];
      let summary: string;
      if (aborted) {
        status = artifacts.length > 0 ? 'partial' : 'failure';
        summary = 'mission aborted (timeout or cancellation) before completion';
      } else if (failures.length === 0 && artifacts.length > 0) {
        status = 'success';
        summary = coordinatorSummary || assembleSummary(specialists, results);
      } else if (artifacts.length > 0) {
        status = 'partial';
        summary =
          `${failures.length} worker run(s) failed, but artifacts were ` +
          `produced: ${failures.map((f) => `${f.workerId} (${f.summary})`).join('; ')}`;
      } else {
        status = 'failure';
        summary = failures.every((f) => f.summary.length === 0)
          ? 'no worker produced a deliverable'
          : `all worker runs failed: ${failures.map((f) => f.summary).join('; ')}`;
      }

      record({
        type: 'verification',
        missionId,
        ok: status === 'success',
        passed: artifacts.length,
        failed: failures.length,
        failures: failures.map((f) => `${f.workerId}: ${f.summary}`),
      });

      return this.finishMission(
        missionId,
        status,
        summary,
        evidence,
        startedAt,
        reasoningCalls,
        record,
      );
    } finally {
      clearTimeout(timeout);
      this.options.signal?.removeEventListener('abort', onExternalAbort);
      // Temporary workers are always retired — stop keeps their durable
      // workspace files but ends their runtime presence.
      for (const { handle } of ensured) {
        try {
          await this.options.runtime.stopWorker(handle);
        } catch {
          // retirement is best-effort per worker; the mission result already
          // carries the real outcome
        }
      }
    }
  }

  private async runWorker(
    worker: PlannedWorker,
    genome: WorkerGenome,
    participant: HandoffParticipant,
    brief: string,
    handoffs: MissionHandoffs,
    signal: AbortSignal,
    record: RecordFn,
  ): Promise<WorkerResult> {
    const agent = new WorkerAgent({
      genome,
      reasoning: participant.reasoning,
      computer: participant.computer,
      taskBrief: brief,
      handoffs,
      ...(this.options.maxWorkerSteps === undefined
        ? {}
        : { maxSteps: this.options.maxWorkerSteps }),
      signal,
      onEvent: (event) => record(event),
    });
    const result = await agent.run();
    return result;
  }

  private finishMission(
    missionId: string,
    status: MissionResult['status'],
    summary: string,
    evidence: readonly Evidence[],
    startedAt: number,
    reasoningCalls: number,
    record: RecordFn,
  ): MissionResult {
    const wallMs = Date.now() - startedAt;
    const spend = this.options.costSource?.() ?? { usd: 0, tokens: 0 };
    record({
      type: 'mission-finished',
      at: new Date().toISOString(),
      missionId,
      status,
      wallMs,
      reasoningCalls,
    });
    return {
      status,
      summary,
      evidence,
      cost: {
        usd: spend.usd,
        tokens: spend.tokens,
        wallMs,
        humanInterventions: 0,
      },
    };
  }
}

function upstreamResults(
  plan: OrganizationPlan,
  worker: PlannedWorker,
  results: ReadonlyMap<string, WorkerResult>,
): { worker: PlannedWorker; result: WorkerResult }[] {
  const upstream: { worker: PlannedWorker; result: WorkerResult }[] = [];
  for (const edge of plan.collaboration) {
    if (edge.to !== worker.id) continue;
    const from = plan.workers.find((w) => w.id === edge.from);
    const result = results.get(edge.from);
    if (from && result) {
      upstream.push({ worker: from, result });
    }
  }
  return upstream;
}

function assembleSummary(
  specialists: readonly PlannedWorker[],
  results: ReadonlyMap<string, WorkerResult>,
): string {
  return specialists
    .map((w) => `${w.role}: ${results.get(w.id)?.summary ?? 'did not run'}`)
    .join(' | ');
}

function buildGapSummary(
  gaps: readonly (readonly {
    workerId: string;
    need: string;
    reason: string;
  }[])[],
): string {
  const flat = gaps.flat();
  return `mission cannot run: ${flat
    .map((gap) => `worker "${gap.workerId}" needs "${gap.need}" (${gap.reason})`)
    .join('; ')}`;
}
