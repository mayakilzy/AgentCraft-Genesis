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
import type { WorkerComputer, WorkerRuntime, WorkspaceSurface, JobSurface } from '../runtime/computer.js';
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
   * GROUP 3 (exposed by Experiment 003 design): operational context
   * appended to EVERY worker task brief (specialists, coordinator, and the
   * bounded retry) WITHOUT entering the goal the compiler classifies.
   * Repository missions previously prepended their preamble to
   * goal.context, which polluted domain classification with
   * software-engineering signals ("repository", "install", "build",
   * "test") and hijacked non-engineering repo missions — a diagnostic
   * mission on a repository classified as software engineering. The
   * preamble is worker instructions, not goal semantics; it belongs in the
   * brief.
   */
  readonly workerBriefSuffix?: string;
  /**
   * Explicit mission id: pass the SAME id to the flight recorder so the
   * durable record file matches the events. Generated when omitted.
   */
  readonly missionId?: string;
  /**
   * PHASE 4.8B: Mission input staging. Each entry is written into every
   * computer-bearing worker's workspace BEFORE the worker starts. This is
   * the smallest clean mission-input boundary: the user's authoritative
   * bytes land in the worker-visible scope, traceable to the mission,
   * without granting broad host-filesystem access. No new storage platform.
   */
  readonly missionInputs?: readonly MissionInput[];
}

/**
 * PHASE 4.8B: A user-supplied mission input file. The orchestrator stages
 * each one into every worker's workspace before execution begins. The path
 * is workspace-relative; the contents are the authoritative bytes.
 */
export interface MissionInput {
  /** Workspace-relative path (e.g. "expenses.csv", "input/orders.json"). */
  readonly path: string;
  /** The authoritative file contents. */
  readonly contents: string;
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
    // GROUP 3 (TASK-020) accuracy fix: repository missions pre-populate the
    // workspace with the mission's own checkout, so "starts empty" would be
    // false there. The line covers both worlds truthfully.
    'Your workspace may already hold the mission\u2019s repository checkout; ' +
      'otherwise it starts empty — every fact you need is in this brief. ' +
      'Begin with the core of the work itself, not workspace inspection.',
    'Deliverables go to your own workspace. Finish with your artifact paths when done.',
  );
  return lines.join('\n');
}

export class MissionOrchestrator {
  private readonly options: MissionOrchestratorOptions;
  /**
   * PHASE 4.8B: surfaces captured during ensureWorker, keyed by worker id.
   * Populated during `run()` so `runWorker()` can pass the workspace + job
   * surfaces to the WorkerAgent without re-fetching them from the runtime.
   * Reset at the start of each `run()` call.
   */
  private surfacesByWorker: Map<string, {
    readonly computer: WorkerComputer | null;
    readonly workspace: WorkspaceSurface | null;
    readonly job: JobSurface | null;
  }> | undefined;

  constructor(options: MissionOrchestratorOptions) {
    this.options = options;
  }

  /** A task brief plus the caller's operational suffix, when configured. */
  private briefFor(
    worker: PlannedWorker,
    requirements: GoalRequirements,
    upstream: readonly { worker: PlannedWorker; result: WorkerResult }[],
  ): string {
    const brief = renderTaskBrief(worker, requirements, upstream);
    // PHASE 4.8B: when mission inputs are staged into the worker's workspace,
    // tell the worker about them. This is the bridge between the staging
    // boundary and the worker's awareness — without it, the worker would
    // discover the files via list_files but would not know they are the
    // authoritative mission inputs (vs. files it should ignore).
    const missionInputs = this.options.missionInputs;
    const inputNote =
      missionInputs !== undefined && missionInputs.length > 0
        ? `\n\nAuthoritative mission inputs have been staged into your workspace:\n${missionInputs.map((i) => `- ${i.path} (${i.contents.length} bytes)`).join('\n')}\nUse read_file to inspect them; they are the authoritative source for this mission.`
        : '';
    const suffix = this.options.workerBriefSuffix === undefined
      ? ''
      : `\n\n${this.options.workerBriefSuffix}`;
    return brief + inputNote + suffix;
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
      // PHASE 4.5: dispatch through the generalized surfaces() method
      // instead of the conditional computer() pattern. The orchestrator no
      // longer assumes every worker is a computer worker — it reads whatever
      // surfaces the runtime provides. For Phase 4.5 the OpenBot adapter
      // returns { computer } or {}; Phase 4.6/4.7 will add workspace/job.
      const participants = new Map<string, HandoffParticipant>();
      const genomes = new Map<string, WorkerGenome>();
      this.surfacesByWorker = new Map();
      for (const result of compilation.results) {
        const genome = result.genome!;
        const handle = await this.options.runtime.ensureWorker(genome);
        ensured.push({ handle, genome });
        genomes.set(genome.identity.id, genome);
        const surfaces = this.options.runtime.surfaces(handle);
        const ws = surfaces.workspace ?? null;
        const jb = surfaces.job ?? null;
        this.surfacesByWorker.set(genome.identity.id, {
          computer: surfaces.computer ?? null,
          workspace: ws,
          job: jb,
        });
        participants.set(genome.identity.id, {
          genome,
          reasoning: this.options.reasoning,
          computer: surfaces.computer ?? null,
        });
      }

      // PHASE 4.8B: Mission input staging. If the orchestrator was given
      // `missionInputs`, write each one into every computer-bearing worker's
      // workspace BEFORE the worker starts. This is the smallest clean
      // mission-input boundary: the user's authoritative bytes land in the
      // worker-visible scope, traceable to the mission, without granting
      // broad host-filesystem access. No new storage platform.
      const missionInputs = this.options.missionInputs;
      if (missionInputs !== undefined && missionInputs.length > 0) {
        for (const [workerId, surfaces] of this.surfacesByWorker) {
          if (surfaces.computer === null) continue;
          for (const input of missionInputs) {
            try {
              await surfaces.computer.writeFile(input.path, input.contents);
            } catch {
              // best-effort: a missing input surfaces honestly later when
              // the worker tries to read it and fails.
              record({
                type: 'worker-step',
                workerId,
                step: 0,
                action: `stage-input:${input.path}`,
                ok: false,
                elapsedMs: 0,
              });
            }
          }
        }
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
        const brief = this.briefFor(
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
        const coordinatorBrief =
          this.options.workerBriefSuffix === undefined
            ? brief
            : `${brief}\n\n${this.options.workerBriefSuffix}`;
        const result = await this.runWorker(
          coordinator,
          genomes.get(coordinator.id)!,
          participants.get(coordinator.id)!,
          coordinatorBrief,
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
        const userChecks =
          this.options.checks?.({
            requirements,
            genomes: [...genomes.values()],
            artifacts: artifactSources,
          }) ?? deriveChecks(artifactSources);

        // PHASE 4.8B: fail-closed verification. When the orchestrator staged
        // authoritative mission inputs, automatically add a `mission-input`
        // check for each one. This closes the fabrication path: if the
        // worker never read the staged input (because it fabricated a
        // substitute), the check fails honestly. The caller's explicit
        // checks remain the primary path; this is the structural floor for
        // missions with authoritative inputs.
        const stagedInputChecks: AcceptanceCheck[] = [];
        if (this.options.missionInputs !== undefined) {
          for (const input of this.options.missionInputs) {
            // Use a distinctive substring from the input as the fingerprint.
            // This proves the authoritative bytes (not a fabricated file
            // at the same path) reached the worker's workspace.
            const fingerprint = input.contents.slice(0, 60);
            stagedInputChecks.push({
              kind: 'mission-input',
              label: `mission-input:${input.path}`,
              path: input.path,
              expectIncludes: fingerprint,
            });
          }
        }
        const checks = [...stagedInputChecks, ...userChecks];

        if (checks.length > 0) {
          const verifierGenomeForMission = verifierGenome();
          const verifierHandle = await this.options.runtime.ensureWorker(
            verifierGenomeForMission,
          );
          ensured.push({
            handle: verifierHandle,
            genome: verifierGenomeForMission,
          });
          // PHASE 4.5: the verifier always needs a computer (clean-room
          // checks need shell + files). Read it through the generalized
          // surfaces() method for consistency with the specialist dispatch.
          const verifierSurfaces = this.options.runtime.surfaces(verifierHandle);
          const verifierComputer = verifierSurfaces.computer;
          if (verifierComputer === undefined) {
            throw new Error(
              'verifier worker has no computer surface — verification requires shell + files',
            );
          }
          // PHASE 4.8B: pass the mission-input computers so the
          // `mission-input` checks can read the authoritative bytes directly
          // from each producing worker's workspace (not the clean-room copy).
          const missionInputComputers =
            this.surfacesByWorker === undefined
              ? []
              : [...this.surfacesByWorker.entries()]
                  .filter(([, s]) => s.computer !== null)
                  .map(([workerId, s]) => ({
                    workerId,
                    computer: s.computer as WorkerComputer,
                  }));
          const loop = new VerificationLoop(verifierComputer, {
            ...(this.options.reviewer === undefined
              ? {}
              : { reviewer: this.options.reviewer }),
            ...(missionInputComputers.length === 0
              ? {}
              : { missionInputComputers }),
          });

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
                `${this.briefFor(
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
              // A dead retry must not erase real work. The round-1 result
              // describes artifacts committed to the integration branch,
              // and the post-retry verification runs against exactly that
              // branch — replacing a success with a provider-death failure
              // made the mission "forget" its own deliverables (observed
              // live in experiment-002 mission 210312: round-1 fixes were
              // merged and 6/7 gates passed, yet the final status claimed
              // no artifacts existed). The retry failure itself remains in
              // the flight record as its own worker-finished event.
              const prior = results.get(result.workerId);
              if (
                result.status === 'failure' &&
                prior !== undefined &&
                prior.status === 'success'
              ) {
                reasoningCalls += result.reasoningCalls;
              } else {
                countWorker(result);
              }
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
      // PHASE 4.6a: collect provider-OBSERVED deliverables from non-computer
      // surfaces (workspace, future job). These are trusted because the runtime
      // is the trust authority — a WorkspaceHandle only exists if the adapter
      // actually created/observed the Space+Page.
      const observedDeliverables = await this.collectObservedDeliverables(ensured);
      const hasDeliverable = finalArtifacts.length > 0 || observedDeliverables.length > 0;
      // Include observed deliverables in final evidence for the Experience record.
      finalEvidence.push(...observedDeliverables);

      let status: MissionResult['status'];
      let summary: string;
      if (aborted) {
        status = hasDeliverable ? 'partial' : 'failure';
        summary = 'mission aborted (timeout or cancellation) before completion';
      } else if (verification === undefined || verification.ok) {
        if (!hasDeliverable && workerFailures.length > 0) {
          status = 'failure';
          summary = `all worker runs failed: ${workerFailures
            .map((f) => f.summary)
            .join('; ')}`;
        } else if (!hasDeliverable) {
          status = 'failure';
          summary = 'no worker produced a deliverable';
        } else {
          status = 'success';
          summary = coordinatorSummary || assembleSummary(specialists, results);
        }
      } else if (hasDeliverable) {
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
    // PHASE 4.8B: look up the surfaces that were captured during ensureWorker.
    // The worker agent receives the workspace + job surfaces directly — it
    // never names the provider. The surfaces are provider-neutral.
    const surfaces = this.surfacesByWorker?.get(genome.identity.id);
    const agent = new WorkerAgent({
      genome,
      reasoning: participant.reasoning,
      computer: participant.computer,
      ...(surfaces === undefined ? {} : {
        workspace: surfaces.workspace,
        job: surfaces.job,
      }),
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

  /**
   * PHASE 4.6a / 4.7. Collects provider-OBSERVED deliverable evidence from
   * non-computer surfaces (workspace, job). This is the provider-neutral
   * completion criterion: a deliverable exists if EITHER computer-file
   * artifacts (confirmed by readFile) OR provider-observed surface results
   * exist.
   *
   * TRUST MODEL: the runtime is the trust authority, not the worker. A
   * WorkspaceHandle only exists if the adapter actually created/observed the
   * Space+Page (it throws on failure). A JobHandle only exists if the adapter
   * created a durable task — BUT handle existence does NOT mean the task
   * succeeded. The method polls the job's status and only produces deliverable
   * evidence when `status === 'succeeded'` AND `result !== undefined`.
   *
   * PHASE 4.7 §12: JOB EXISTS ≠ JOB SUCCEEDED ≠ DELIVERABLE EXISTS.
   */
  private async collectObservedDeliverables(
    ensured: readonly { handle: RuntimeHandle; genome: WorkerGenome }[],
  ): Promise<Evidence[]> {
    const deliverables: Evidence[] = [];
    for (const { handle } of ensured) {
      const surfaces = this.options.runtime.surfaces(handle);
      // Workspace surface: if the adapter observed a real Space+Page, the
      // handle exists. This is provider-observed evidence.
      if (surfaces.workspace?.handle !== undefined) {
        const wsHandle = surfaces.workspace.handle;
        deliverables.push({
          kind: 'artifact',
          description: `${handle.workerId} collaborative workspace deliverable`,
          location: `${wsHandle.provider}:${wsHandle.spaceId}:${wsHandle.pageId}`,
        });
      }
      // PHASE 4.7: job surface — handle existence is NOT sufficient.
      // Must poll status and only count as deliverable when succeeded + result.
      if (surfaces.job !== undefined) {
        try {
          const status = await surfaces.job.getStatus();
          if (status === 'succeeded') {
            const result = await surfaces.job.getResult();
            if (result !== undefined) {
              deliverables.push({
                kind: 'artifact',
                description: `${handle.workerId} durable delegated result`,
                location: `${surfaces.job.handle.provider}:${surfaces.job.handle.taskId}`,
              });
            }
          }
        } catch {
          // If the job status poll fails (provider unreachable), do NOT
          // produce deliverable evidence. Honest failure.
        }
      }
    }
    return deliverables;
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
