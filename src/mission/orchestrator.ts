import { randomBytes, createHash } from 'node:crypto';

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
import { OrganizationPlanner, type AdvisoryPattern } from '../organization/organization-planner.js';
import type { WorkerComputer, WorkerRuntime, WorkspaceSurface, JobSurface } from '../runtime/computer.js';
import type { McpCapabilityProvider } from '../runtime/mcp/capability-provider.js';
import type { WorkerResult } from '../worker/worker-agent.js';
import { WorkerAgent } from '../worker/worker-agent.js';
import {
  MissionHandoffs,
  type HandoffParticipant,
} from '../worker/handoff.js';
import { MemoryFlightRecorder as _MemoryFlightRecorder, type FlightEvent, type FlightRecorder } from './flight-recorder.js';

// G6-08 (Phase 8 lint fix): MemoryFlightRecorder is no longer directly referenced
// in this file after the Phase 4 C-VERIFY-FINDING-004 fix (inMemoryFlightEvents
// replaces the instanceof check). The import is kept as `_MemoryFlightRecorder`
// to avoid breaking any re-export patterns, but the underscore signals intentional
// non-use to eslint. The type-only imports (FlightEvent, FlightRecorder) ARE used.
void _MemoryFlightRecorder;
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
  /**
   * PHASE 4.8D: Mission obligations — mandatory behaviors the mission
   * explicitly requires. Each obligation augments the worker's task brief
   * (telling the worker it's mandatory) AND auto-generates a `flight-action`
   * verification check (enforcing it at verification regardless of worker
   * prose). This closes the Phase 4.8C gap: a worker that claims "I used the
   * durable worker" but never called get_durable_result fails verification.
   */
  readonly missionObligations?: readonly MissionObligation[];
  /**
   * PHASE 4.10 (Group 4 closure): promoted organizational patterns from the
   * learning loop. When provided, these are passed to the OrganizationPlanner
   * as advisory patterns — the planner may apply or ignore each one. This
   * closes the learning loop: Experience → Candidate → Evaluation → Pattern
   * → PatternRetrieval → OrganizationPlanner → future organization. The
   * planner records which patterns were considered and applied in the plan's
   * `learned` field so the learning loop can observe real influence.
   */
  readonly patterns?: readonly AdvisoryPattern[];
  /**
   * G5-01: the MCP capability provider. When provided, every worker whose
   * genome grants `mcp:<tool>` entries can invoke external capabilities
   * through the official MCP protocol. The provider is the mechanism; genome
   * grants are the policy. Null/undefined when the mission has no MCP tools.
   */
  readonly mcp?: McpCapabilityProvider;
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

/**
 * PHASE 4.8D: A mission obligation — a mandatory behavior the mission
 * explicitly requires, not merely a capability that's available. Each
 * obligation augments the worker's task brief (telling the worker it's
 * mandatory) AND auto-generates a `flight-action` verification check
 * (enforcing it at verification regardless of worker prose).
 *
 * Provider-neutral: the obligation kinds do not name providers. They map
 * to provider-neutral worker actions:
 *   delegated-result  → get_durable_result (worker must observe the durable task result)
 *   shared-publication → append_shared_workspace (worker must publish to shared workspace)
 *   computer-execution → run_command (worker must execute a computer command)
 *
 * This closes the Phase 4.8C gap: a worker that claims "I used the durable
 * worker" but never called get_durable_result fails verification honestly.
 */
export interface MissionObligation {
  readonly kind: 'delegated-result' | 'shared-publication' | 'computer-execution';
  /** Human-readable description for the task brief. */
  readonly description: string;
}

/** Maps an obligation kind to the provider-neutral worker action it requires. */
const OBLIGATION_ACTION: Readonly<Record<MissionObligation['kind'], string>> = {
  'delegated-result': 'get_durable_result',
  'shared-publication': 'append_shared_workspace',
  'computer-execution': 'run_command',
};

const COORDINATOR_ROLE = 'Mission Coordinator';

/**
 * G6-08 (Phase 4 / C-VERIFY-FINDING-005): compute the SHA-256 hex digest of
 * the staged input contents. Used as the expected hash for the `hash-match`
 * check that replaces the fabricable 60-char `mission-input` `expectIncludes`
 * fingerprint.
 */
function computeSha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

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
    // PHASE 4.8D: augment the brief with mandatory obligations. This tells
    // the worker these are NOT optional capabilities — they are mission
    // requirements that will be verified at completion. The LLM is free to
    // choose HOW to satisfy them, but cannot skip them.
    const obligations = this.options.missionObligations;
    const obligationNote =
      obligations !== undefined && obligations.length > 0
        ? `\n\nMANDATORY MISSION OBLIGATIONS (you MUST satisfy these — verification will enforce them):\n${obligations.map((o) => `- ${o.kind === 'delegated-result' ? 'Obtain an independent delegated result' : o.kind === 'shared-publication' ? 'Publish meaningful content to the shared team workspace' : 'Perform real computer execution'}: ${o.description}`).join('\n')}\nThese are verified by runtime evidence, not by your summary prose. You must actually perform the corresponding action (e.g. get_durable_result, append_shared_workspace, run_command).`
        : '';
    const suffix = this.options.workerBriefSuffix === undefined
      ? ''
      : `\n\n${this.options.workerBriefSuffix}`;
    return brief + inputNote + obligationNote + suffix;
  }

  async run(goal: Goal): Promise<MissionResult> {
    const startedAt = Date.now();
    const missionId = this.options.missionId ?? newMissionId();
    const recorder = this.options.recorder;
    // G6-08 (Phase 4 / C-VERIFY-FINDING-004): maintain an in-memory FlightEvent[]
    // ALONGSIDE the recorder so flight-action checks work regardless of
    // recorder type (MemoryFlightRecorder OR FileFlightRecorder). Previously,
    // flightEvents was only passed when recorder instanceof MemoryFlightRecorder
    // — meaning flight-action checks silently failed (returned ok=false with
    // empty events) when FileFlightRecorder was used.
    //
    // The in-memory log is bounded by the mission's lifetime and the
    // MemoryFlightRecorder's maxEvents cap (when used). For FileFlightRecorder,
    // the in-memory log here is the authoritative source for verification;
    // the file is for durable persistence only.
    const inMemoryFlightEvents: FlightEvent[] = [];
    const record: RecordFn = (event) => {
      recorder?.record(event);
      // G6-08 (Phase 4 / C-VERIFY-004): capture in-memory for verification
      // regardless of recorder type. Bound to prevent unbounded growth in
      // extreme cases (default cap matches MemoryFlightRecorder's default).
      if (inMemoryFlightEvents.length < 10_000) {
        inMemoryFlightEvents.push(event);
      }
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

      // PHASE 4.10: when promoted patterns are provided, wrap the injected
      // planner with those patterns so the learning loop reaches future
      // organization design. The planner treats patterns as advisory — it
      // may apply or ignore each one, and records its decisions in the
      // plan's `learned` field.
      const planner =
        this.options.patterns !== undefined && this.options.patterns.length > 0
          ? new OrganizationPlanner({ patterns: this.options.patterns })
          : this.options.planner;
      const plan = planner.plan(requirements);
      record({
        type: 'plan-created',
        missionId,
        workers: plan.workers.map((w) => ({
          id: w.id,
          role: w.role,
          needs: [...w.capabilityNeeds],
        })),
        rationale: plan.rationale,
        ...(plan.learned === undefined ? {} : { learned: plan.learned }),
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
            // G6-08 (Phase 4 / C-VERIFY-FINDING-005): use `expectHash` (full
            // SHA-256) instead of the 60-char `expectIncludes` fingerprint.
            // The 60-char fingerprint was fabricable — a worker could write a
            // file at the same path with the first 60 chars matching but the
            // rest fabricated, and the check would pass. The hash check
            // compares the actual file bytes (read from the worker's own
            // workspace, not the clean-room copy) against the staged input's
            // SHA-256 hash. This proves the authoritative bytes reached the
            // worker's workspace — not a fabricated substitute.
            const expectedHash = computeSha256Hex(input.contents);
            stagedInputChecks.push({
              kind: 'mission-input',
              label: `mission-input:${input.path}`,
              path: input.path,
              expectHash: expectedHash,
            });
          }
        }
        // PHASE 4.8D: auto-generate flight-action checks from mission
        // obligations. Each obligation maps to a provider-neutral worker
        // action that MUST be invoked with ok=true. This enforces the
        // requirement at verification — worker prose alone cannot satisfy it.
        const obligationChecks: AcceptanceCheck[] = [];
        if (this.options.missionObligations !== undefined) {
          for (const obl of this.options.missionObligations) {
            obligationChecks.push({
              kind: 'flight-action',
              label: `obligation:${obl.kind}`,
              action: OBLIGATION_ACTION[obl.kind],
            });
          }
        }
        const checks = [...stagedInputChecks, ...obligationChecks, ...userChecks];

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
            // PHASE 4.8D: pass flight events so flight-action checks can
            // verify that specific worker actions were actually invoked.
            // G6-08 (Phase 4 / C-VERIFY-FINDING-004): use the in-memory
            // flightEvents captured by the record() wrapper, regardless of
            // recorder type. Previously this was conditioned on
            // `recorder instanceof MemoryFlightRecorder`, which silently
            // broke flight-action checks when FileFlightRecorder was used.
            ...(inMemoryFlightEvents.length > 0
              ? { flightEvents: inMemoryFlightEvents }
              : {}),
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
      // G5-01: pass the MCP capability provider through. The worker's own
      // genome grants decide which tools it may actually call.
      ...(this.options.mcp === undefined ? {} : { mcp: this.options.mcp }),
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
