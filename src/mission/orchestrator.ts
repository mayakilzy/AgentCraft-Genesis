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
import {
  VerificationLoop,
  deriveChecks,
  type AcceptanceCheck,
  type ArtifactSource,
  type VerificationResult,
} from './verification.js';

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
  /**
   * Acceptance checks tied to the task. When absent, the structural floor
   * applies: every produced artifact must exist in the clean room.
   */
  readonly checks?: (context: {
    readonly requirements: GoalRequirements;
    readonly genomes: readonly WorkerGenome[];
    readonly artifacts: readonly ArtifactSource[];
  }) => readonly AcceptanceCheck[];
  /** Reviewer consulted only when verification fails (conflict/risk). */
  readonly reviewer?: ReasoningProvider;
  /**
   * GROUP 3 (TASK-019): invoked before EVERY verification pass — the first
   * attempt and the single bounded retry. Repository missions use it to
   * re-commit worker worktrees and re-integrate before the clean-room
   * verifier clones the integration branch; without this hook the retry
   * would verify stale state. Absent → behavior is exactly GROUP 2's.
   */
  readonly beforeVerification?: (context: {
    readonly attempt: 1 | 2;
  }) => Promise<void>;
  /**
   * GROUP 3 metric separation (review requirement): when the provider can
   * report its TOTAL call count, the flight record can distinguish it from
   * the mission-scoped counts (workers, reviewer, handoffs).
   */
  readonly providerCallsSource?: () => number;
  /**
   * Explicit mission id: pass the SAME id to the flight recorder so the
   * durable record file matches the events. Generated when omitted.
   */
  readonly missionId?: string;
}

const COORDINATOR_ROLE = 'Mission Coordinator';

/**
 * The clean-room verifier: an orchestrator-owned utility computer, granted
 * exactly the shell and file access deterministic checks need. It is not a
 * planned organization member and never reasons — the reviewer (an LLM) is
 * consulted only on failure.
 */
function verifierGenome(): WorkerGenome {
  return {
    identity: { id: 'mission-verifier-1', displayName: 'Mission Verifier' },
    role: 'Mission Verifier',
    objective: 'Run acceptance checks in a clean room',
    model: 'cheap',
    skills: ['verification'],
    tools: ['openbot:shell-execution', 'openbot:workspace-files'],
    computer: { required: true, browser: false, shell: true, workspace: true },
    memory: 'none',
    budget: { maxUsd: 0.5, maxTier: 'cheap' },
    autonomy: 'autonomous',
  };
}

function newMissionId(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '');
  return `mission-${stamp}-${randomBytes(3).toString('hex')}`;
}

/** Deterministic task brief: mission-first, then assignment and inputs. */
export function renderTaskBrief(
  worker: PlannedWorker,
  requirements: GoalRequirements,
  upstream: readonly { worker: PlannedWorker; result: WorkerResult }[],
): string {
  const lines = [
    `Mission: "${requirements.source.outcome}"`,
    `Your assignment in it: ${worker.responsibility}.`,
  ];
  if (requirements.source.context !== undefined && requirements.source.context.trim() !== '') {
    lines.push('', `Mission context: ${requirements.source.context}`);
  }
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
    'Your workspace starts EMPTY; every fact you need is in this brief. Begin with the core of the work itself, not workspace inspection.',
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
    const missionId = this.options.missionId ?? newMissionId();
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

      // The mission roster every collaborating worker sees (TASK-015 fix:
      // workers used to guess colleague ids).
      const roster = new Map<string, string>();
      for (const [id, participant] of participants) {
        roster.set(id, participant.genome.role);
      }

      // Metric separation (GROUP 3 review requirement): handoff-served
      // reasoning calls are counted apart from the asking workers' own.
      let handoffCalls = 0;
      const handoffs = new MissionHandoffs(participants, {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'handoff' && event.reasoningCalls !== undefined) {
            handoffCalls += event.reasoningCalls;
          }
          record(event);
        },
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
      let reviewerCalls = 0;
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
          roster,
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
          roster,
          controller.signal,
          record,
        );
        reasoningCalls += result.reasoningCalls;
        if (result.status === 'success' && result.summary.trim() !== '') {
          coordinatorSummary = result.summary;
        }
      }

      // TASK-013: the mission is not successful because workers said so —
      // acceptance checks run in a clean room and decide.
      const artifactSources = this.collectArtifacts(participants, results);
      const allResults = [...results.values()];
      const evidence = allResults.flatMap((r) => r.evidence);
      const workerFailures = allResults.filter((r) => r.status === 'failure');
      const aborted = controller.signal.aborted;

      let verification: VerificationResult | undefined;
      if (!aborted || artifactSources.length > 0) {
        // GROUP 3 (TASK-019): missions with an integration step (repository
        // work) bring the integration branch up to date before the verifier
        // sees anything. No hook → nothing changes.
        if (this.options.beforeVerification !== undefined) {
          await this.options.beforeVerification({ attempt: 1 });
        }
        const checks =
          this.options.checks?.({
            requirements,
            genomes: [...genomes.values()],
            artifacts: artifactSources,
          }) ?? deriveChecks(artifactSources);

        if (checks.length > 0) {
          const verifierGenomeForMission = verifierGenome();
          const verifierHandle = await this.options.runtime.ensureWorker(
            verifierGenomeForMission,
          );
          ensured.push({
            handle: verifierHandle,
            genome: verifierGenomeForMission,
          });
          const loop = new VerificationLoop(
            this.options.runtime.computer(verifierHandle),
            this.options.reviewer === undefined
              ? {}
              : { reviewer: this.options.reviewer },
          );

          verification = await loop.verify(checks, artifactSources, evidence);
          reviewerCalls += verification.reviewerCalls;
          this.recordVerification(missionId, verification, record);

          // One bounded retry: a failing (and retryable) verification sends
          // the specialists back to work once, with the failures in their
          // briefs. A second failure stands.
          if (
            !verification.ok &&
            !controller.signal.aborted &&
            verification.diagnosis?.retryable !== false
          ) {
            const reason =
              verification.diagnosis?.rootCause ?? verification.summary;
            record({
              type: 'worker-retry',
              missionId,
              workerId: 'specialists',
              reason,
            });
            for (const worker of specialists) {
              if (controller.signal.aborted) break;
              const brief =
                `${renderTaskBrief(
                  worker,
                  requirements,
                  upstreamResults(plan, worker, results),
                )}\n\n` +
                `A previous attempt failed verification: ${reason}\n` +
                `Failed checks: ${verification.outcomes
                  .filter((o) => !o.ok)
                  .map((o) => `${o.label} (${o.detail})`)
                  .join('; ')}\n` +
                (verification.diagnosis?.guidance === undefined
                  ? ''
                  : `Reviewer guidance: ${verification.diagnosis.guidance}\n`) +
                'Fix the issues and produce correct deliverables.';
              const result = await this.runWorker(
                worker,
                genomes.get(worker.id)!,
                participants.get(worker.id)!,
                brief,
                handoffs,
                roster,
                controller.signal,
                record,
              );
              countWorker(result);
            }

            const retriedSources = this.collectArtifacts(participants, results);
            const retriedEvidence = [...results.values()].flatMap((r) => r.evidence);
            if (this.options.beforeVerification !== undefined) {
              await this.options.beforeVerification({ attempt: 2 });
            }
            verification = await loop.verify(
              checks,
              retriedSources,
              retriedEvidence,
            );
            reviewerCalls += verification.reviewerCalls;
            this.recordVerification(missionId, verification, record);
          }
        }
      }

      const finalArtifacts = this.collectArtifacts(participants, results);
      const finalEvidence = [...results.values()].flatMap((r) => r.evidence);

      let status: MissionResult['status'];
      let summary: string;
      if (aborted) {
        status = finalArtifacts.length > 0 ? 'partial' : 'failure';
        summary = 'mission aborted (timeout or cancellation) before completion';
      } else if (verification === undefined || verification.ok) {
        if (finalArtifacts.length === 0 && workerFailures.length > 0) {
          status = 'failure';
          summary = `all worker runs failed: ${workerFailures
            .map((f) => f.summary)
            .join('; ')}`;
        } else if (finalArtifacts.length === 0) {
          status = 'failure';
          summary = 'no worker produced a deliverable';
        } else {
          status = 'success';
          summary = coordinatorSummary || assembleSummary(specialists, results);
        }
      } else if (finalArtifacts.length > 0) {
        status = 'partial';
        summary = `verification failed after retry: ${verification.summary}`;
      } else {
        status = 'failure';
        summary = `verification failed and no artifacts were produced: ${verification.summary}`;
      }

      return this.finishMission(
        missionId,
        status,
        summary,
        finalEvidence,
        startedAt,
        reasoningCalls,
        record,
        handoffCalls,
        reviewerCalls,
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
    roster: ReadonlyMap<string, string>,
    signal: AbortSignal,
    record: RecordFn,
  ): Promise<WorkerResult> {
    const agent = new WorkerAgent({
      genome,
      reasoning: participant.reasoning,
      computer: participant.computer,
      taskBrief: brief,
      handoffs,
      roster,
      ...(this.options.maxWorkerSteps === undefined
        ? {}
        : { maxSteps: this.options.maxWorkerSteps }),
      signal,
      onEvent: (event) => record(event),
    });
    const result = await agent.run();
    return result;
  }

  /** Artifact sources for the clean room: each producer's computer + paths. */
  private collectArtifacts(
    participants: ReadonlyMap<string, HandoffParticipant>,
    results: ReadonlyMap<string, WorkerResult>,
  ): ArtifactSource[] {
    const sources: ArtifactSource[] = [];
    for (const [workerId, result] of results) {
      const participant = participants.get(workerId);
      if (participant === undefined || participant.computer === null) continue;
      if (result.artifacts.length === 0) continue;
      sources.push({
        workerId,
        computer: participant.computer,
        paths: [...result.artifacts],
      });
    }
    return sources;
  }

  private recordVerification(
    missionId: string,
    verification: VerificationResult,
    record: RecordFn,
  ): void {
    const failed = verification.outcomes.filter((outcome) => !outcome.ok);
    record({
      type: 'verification',
      missionId,
      ok: verification.ok,
      passed: verification.outcomes.length - failed.length,
      failed: failed.length,
      failures: failed.map((outcome) => `${outcome.label}: ${outcome.detail}`),
    });
  }

  private finishMission(
    missionId: string,
    status: MissionResult['status'],
    summary: string,
    evidence: readonly Evidence[],
    startedAt: number,
    reasoningCalls: number,
    record: RecordFn,
    handoffCalls = 0,
    reviewerCalls = 0,
  ): MissionResult {
    const wallMs = Date.now() - startedAt;
    const spend = this.options.costSource?.() ?? { usd: 0, tokens: 0 };
    const providerCalls = this.options.providerCallsSource?.();
    record({
      type: 'mission-finished',
      at: new Date().toISOString(),
      missionId,
      status,
      wallMs,
      // GROUP 3 metric separation (review requirement): one ambiguous
      // "LLM calls" number is no longer reported when the components are
      // distinguishable. `reasoningCalls` keeps its GROUP 2 meaning (the
      // workers' own loop calls, coordinator included).
      reasoningCalls,
      worker_reasoning_calls: reasoningCalls,
      reviewer_calls: reviewerCalls,
      handoff_calls: handoffCalls,
      ...(providerCalls === undefined ? {} : { total_provider_calls: providerCalls }),
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
