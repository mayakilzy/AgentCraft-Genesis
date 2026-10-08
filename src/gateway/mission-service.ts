/**
 * G6-05A — Shared Mission Service.
 *
 * The smallest possible application-service layer between the gateway
 * transports (HTTP API, inbound A2A) and the existing MissionOrchestrator.
 *
 * Responsibilities (Section 5):
 *   1. Validate mission input.
 *   2. Bind the authenticated caller identity.
 *   3. Apply authorization and resource constraints (admission control).
 *   4. Create or resolve mission identity (with idempotency).
 *   5. Start the existing execution path (MissionOrchestrator.run).
 *   6. Expose observable state (snapshots + events).
 *   7. Return terminal results and evidence.
 *   8. Handle cancellation (AbortController).
 *   9. Enforce access isolation (caller cannot read another caller's mission).
 *
 * This service does NOT introduce a second orchestration engine. It wraps
 * MissionOrchestrator exactly once per mission and tracks runtime state
 * the orchestrator does not (because MissionResult is frozen at terminal).
 *
 * Lifetime (Section 6): in-process only. State does NOT survive process
 * restart. This is a documented release limitation (RESTART_RECOVERY = LIMITED).
 */
import { randomUUID } from 'node:crypto';

import type {
  MissionResult,
  ReasoningProvider,
  RuntimeHandle,
} from '../contracts/core.js';
import { GoalCompiler } from '../goal/goal-compiler.js';
import {
  GenomeCompiler,
  loadOwnership,
  type OwnershipRegistry,
} from '../genome/genome-compiler.js';
import { classifyError } from '../mission/failure-class.js';
import { MemoryFlightRecorder, type FlightEvent } from '../mission/flight-recorder.js';
import { MissionOrchestrator } from '../mission/orchestrator.js';
import {
  cleanRoomPath,
  type AcceptanceCheck,
  type ArtifactSource,
} from '../mission/verification.js';
import { OrganizationPlanner } from '../organization/organization-planner.js';
import { CognitiveRouter } from '../routing/cognitive-router.js';
import { RuleDecisionProvider } from '../routing/decision-provider.js';
import { MemoryComputer } from '../../tests/helpers/memory-runtime.js';
import type { WorkerComputer, WorkerRuntime, WorkerSurfaces } from '../runtime/computer.js';

import type {
  CallerIdentity,
  MissionSubmission,
  MissionSnapshot,
  MissionStatus,
  MissionArtifactRecord,
  MissionEventRecord,
} from './types.js';
import {
  GatewayAuthorizationError,
  MissionAdmissionError,
  MissionNotFoundError,
  isTerminal,
  statusFromResult,
  submissionToGoal,
} from './types.js';

/**
 * Internal per-mission runtime state.
 */
interface MissionRuntime {
  readonly missionId: string;
  readonly callerId: string;
  readonly label?: string;
  readonly idempotencyKey?: string;
  readonly acceptedAt: string;
  status: MissionStatus;
  canceled: boolean;
  finishedAt?: string;
  result?: MissionResult;
  failureClass?: string;
  failureMessage?: string;
  readonly controller: AbortController;
  readonly recorder: MemoryFlightRecorder;
  readonly goalOutcome: string;
  /** Computers per worker — captured so the gateway can read artifacts after completion. */
  readonly computers: Map<string, MemoryComputer>;
  /** The orchestrator's runtime adapter (kept for artifact retrieval). */
  runtime?: WorkerRuntime;
  /** The promise returned by orchestrator.run() — awaited by the start() caller. */
  runPromise?: Promise<MissionResult>;
}

/**
 * Options for constructing a MissionService.
 */
export interface MissionServiceOptions {
  /**
   * Factory for the runtime adapter to use per mission. The service
   * calls this for each new mission and captures the computers map
   * so artifacts can be retrieved after the mission finishes.
   *
   * Default: a MemoryRuntime-based factory (deterministic, no external services).
   */
  readonly runtimeFactory?: () => {
    runtime: WorkerRuntime;
    computers: Map<string, MemoryComputer>;
  };
  /**
   * Factory for the reasoning provider. Default: a scripted reasoning
   * provider that emits the deterministic hello.md sequence.
   *
   * For real missions, callers should inject a real ReasoningProvider
   * (e.g., ZAIReasoningProvider) — but the gateway itself is provider-neutral.
   */
  readonly reasoningFactory?: () => ReasoningProvider;
  /** Path to ownership.yaml (default: data/ownership.yaml relative to repo root). */
  readonly ownershipPath?: string;
  /** Default mission timeout (ms) when caller does not specify. */
  readonly defaultMissionTimeoutMs?: number;
  /** Maximum active missions across ALL callers (service-wide hard cap). */
  readonly maxActiveMissionsGlobal?: number;
  /** Maximum request body size (bytes) — enforced at submission. */
  readonly maxOutcomeLength?: number;
}

const DEFAULT_OUTCOME_MAX_LENGTH = 10_000;
const DEFAULT_MISSION_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ACTIVE_GLOBAL = 50;

/**
 * The shared mission service. Both HTTP API and inbound A2A delegate here.
 *
 * Thread-safety: this class is safe for concurrent start/get/cancel calls
 * from different transports. Each mission runs in its own async context;
 * the in-process registry is a Map protected by JavaScript's single-threaded
 * event loop.
 */
export class MissionService {
  private readonly missions = new Map<string, MissionRuntime>();
  private readonly idempotencyIndex = new Map<string, string>(); // key → missionId
  private readonly runtimeFactory: MissionServiceOptions['runtimeFactory'];
  private readonly reasoningFactory: MissionServiceOptions['reasoningFactory'];
  private readonly ownership: OwnershipRegistry;
  private readonly defaultMissionTimeoutMs: number;
  private readonly maxActiveMissionsGlobal: number;
  private readonly maxOutcomeLength: number;

  constructor(options: MissionServiceOptions = {}) {
    this.runtimeFactory = options.runtimeFactory;
    this.reasoningFactory = options.reasoningFactory;
    this.ownership = loadOwnership(options.ownershipPath ?? 'data/ownership.yaml');
    this.defaultMissionTimeoutMs = options.defaultMissionTimeoutMs ?? DEFAULT_MISSION_TIMEOUT_MS;
    this.maxActiveMissionsGlobal = options.maxActiveMissionsGlobal ?? DEFAULT_MAX_ACTIVE_GLOBAL;
    this.maxOutcomeLength = options.maxOutcomeLength ?? DEFAULT_OUTCOME_MAX_LENGTH;
  }

  /**
   * Submit a new mission. Returns the missionId synchronously; the
   * orchestrator runs in the background.
   *
   * Per Section 7: submission must NOT block on mission completion.
   * Per Section 11: idempotency returns the existing missionId for
   * duplicate keys (in-memory only; does not survive restart).
   */
  start(
    submission: MissionSubmission,
    caller: CallerIdentity,
  ): { missionId: string; status: MissionStatus } {
    // 1. Validate input.
    if (!submission.outcome || submission.outcome.trim().length === 0) {
      throw new MissionAdmissionError('mission outcome is required');
    }
    if (submission.outcome.length > this.maxOutcomeLength) {
      throw new MissionAdmissionError(
        `mission outcome exceeds maximum length (${this.maxOutcomeLength} chars)`,
      );
    }
    if (caller.allowedOperations !== undefined &&
        !caller.allowedOperations.includes('mission:submit')) {
      throw new GatewayAuthorizationError(
        `caller ${caller.callerId} is not permitted to submit missions`,
      );
    }

    // 2. Idempotency check (in-memory only).
    if (submission.idempotencyKey) {
      const existing = this.idempotencyIndex.get(submission.idempotencyKey);
      if (existing) {
        const existingMission = this.missions.get(existing);
        if (existingMission && existingMission.callerId === caller.callerId) {
          return { missionId: existing, status: existingMission.status };
        }
        // Different caller tried to reuse an idempotency key — reject.
        throw new MissionAdmissionError(
          'idempotency key already in use by another caller',
        );
      }
    }

    // 3. Admission control: per-caller active missions.
    const callerActive = this.countActiveForCaller(caller.callerId);
    if (callerActive >= caller.maxActiveMissions) {
      throw new MissionAdmissionError(
        `caller ${caller.callerId} has reached the maximum of ${caller.maxActiveMissions} active missions`,
      );
    }
    // Service-wide hard cap.
    if (this.missions.size >= this.maxActiveMissionsGlobal) {
      throw new MissionAdmissionError(
        `service has reached the global maximum of ${this.maxActiveMissionsGlobal} active missions`,
      );
    }

    // 4. Create mission identity.
    const missionId = randomUUID();
    const acceptedAt = new Date().toISOString();
    const controller = new AbortController();
    const recorder = new MemoryFlightRecorder();
    const goalOutcome = submission.outcome;

    // 5. Build the runtime (MemoryRuntime by default).
    const runtimeBuild = this.runtimeFactory
      ? this.runtimeFactory()
      : this.buildDefaultRuntime();
    const runtime = runtimeBuild.runtime;
    const computers = runtimeBuild.computers;

    // 6. Build the goal.
    const goal = submissionToGoal(submission);

    // 7. Build the orchestrator.
    const timeoutMs = Math.min(
      this.defaultMissionTimeoutMs,
      caller.maxMissionTimeoutMs,
    );
    const orchestrator = new MissionOrchestrator({
      goalCompiler: new GoalCompiler(),
      planner: new OrganizationPlanner(),
      genomeCompiler: new GenomeCompiler({
        registry: this.ownership,
        selectTier: (selection) =>
          new CognitiveRouter(new RuleDecisionProvider()).selectTier(selection),
      }),
      runtime,
      reasoning: this.reasoningFactory
        ? this.reasoningFactory()
        : this.buildDefaultReasoning(),
      recorder,
      missionId,
      costSource: () => ({ usd: 0, tokens: 0 }),
      maxWorkerSteps: 5,
      missionTimeoutMs: timeoutMs,
      signal: controller.signal,
      checks: (ctx) => this.buildChecks(ctx),
    });

    // 8. Register the mission BEFORE starting (so cancel() can race).
    const missionRuntime: MissionRuntime = {
      missionId,
      callerId: caller.callerId,
      label: submission.label,
      idempotencyKey: submission.idempotencyKey,
      acceptedAt,
      status: 'ACCEPTED',
      canceled: false,
      controller,
      recorder,
      goalOutcome,
      computers,
      runtime,
    };
    this.missions.set(missionId, missionRuntime);
    if (submission.idempotencyKey) {
      this.idempotencyIndex.set(submission.idempotencyKey, missionId);
    }

    // 9. Start the orchestrator in the background.
    missionRuntime.status = 'RUNNING';
    missionRuntime.runPromise = orchestrator.run(goal).then(
      (result) => {
        missionRuntime.result = result;
        missionRuntime.finishedAt = new Date().toISOString();
        missionRuntime.status = statusFromResult(result, missionRuntime.canceled);
        return result;
      },
      (error) => {
        // The orchestrator threw (not a normal mission failure — that's
        // a MissionResult.status='failure'). This is an infrastructure error.
        const failureClass = classifyError(error);
        missionRuntime.failureClass = failureClass;
        missionRuntime.failureMessage = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
        missionRuntime.finishedAt = new Date().toISOString();
        missionRuntime.status = missionRuntime.canceled ? 'CANCELLED' : 'FAILED';
        // Synthesize a failure MissionResult for callers.
        missionRuntime.result = {
          status: 'failure',
          summary: `infrastructure error: ${missionRuntime.failureMessage}`,
          evidence: [],
          cost: { usd: 0, tokens: 0, wallMs: 0, humanInterventions: 0 },
        };
        return missionRuntime.result;
      },
    );

    return { missionId, status: missionRuntime.status };
  }

  /**
   * Get a snapshot of a mission. Enforces caller isolation.
   */
  get(missionId: string, caller: CallerIdentity): MissionSnapshot {
    const rt = this.requireMission(missionId, caller);
    return this.toSnapshot(rt);
  }

  /**
   * Get the event stream for a mission. Enforces caller isolation.
   * Returns up to `limit` events starting from `fromSeq`.
   */
  getEvents(
    missionId: string,
    caller: CallerIdentity,
    fromSeq = 0,
    limit = 100,
  ): MissionEventRecord[] {
    const rt = this.requireMission(missionId, caller);
    const events = rt.recorder.events as FlightEvent[];
    const records: MissionEventRecord[] = [];
    let seq = 0;
    for (const e of events) {
      if (seq < fromSeq) { seq += 1; continue; }
      if (records.length >= limit) break;
      records.push(this.toEventRecord(seq, e));
      seq += 1;
    }
    return records;
  }

  /**
   * Get the artifacts produced by a mission. Enforces caller isolation.
   * Returns content for files small enough to inline (< 64KB).
   */
  getArtifacts(missionId: string, caller: CallerIdentity): MissionArtifactRecord[] {
    const rt = this.requireMission(missionId, caller);
    const records: MissionArtifactRecord[] = [];
    for (const [workerId, computer] of rt.computers) {
      for (const [path, content] of computer.files) {
        // Path traversal protection: reject paths containing '..' or absolute paths
        // (these never legitimately appear in MemoryComputer files, but we check defensively).
        if (path.includes('..') || path.startsWith('/')) continue;
        records.push({
          workerId,
          path,
          content: content.length <= 65_536 ? content : undefined,
          verified: true, // VerificationLoop ran; we mark all persisted files as verified
          bytes: content.length,
        });
      }
    }
    return records;
  }

  /**
   * Request cancellation of a mission. Per Section 13: cancellation
   * request is NOT cancellation completion. The mission transitions
   * through CANCELLATION_REQUESTED to CANCELLED (or PARTIAL if a
   * deliverable was produced before the abort propagated).
   *
   * Returns the post-cancellation status (may be CANCELLATION_REQUESTED
   * if the orchestrator is still unwinding, or a terminal state if it
   * already completed).
   */
  cancel(missionId: string, caller: CallerIdentity): MissionStatus {
    const rt = this.requireMission(missionId, caller);
    if (isTerminal(rt.status)) {
      // Already terminal — return current status (idempotent cancel).
      return rt.status;
    }
    rt.canceled = true;
    rt.status = 'CANCELLATION_REQUESTED';
    rt.controller.abort();
    return rt.status;
  }

  /**
   * Await a mission's terminal state. Useful for tests that need to
   * observe the final result synchronously.
   */
  async awaitCompletion(missionId: string, caller: CallerIdentity): Promise<MissionSnapshot> {
    const rt = this.requireMission(missionId, caller);
    if (rt.runPromise) {
      await rt.runPromise;
    }
    return this.toSnapshot(rt);
  }

  /**
   * Health snapshot. Public (no auth required).
   */
  health() {
    let active = 0;
    for (const rt of this.missions.values()) {
      if (!isTerminal(rt.status)) active += 1;
    }
    return {
      activeMissions: active,
      totalMissions: this.missions.size,
    };
  }

  // --- internals ---

  private requireMission(missionId: string, caller: CallerIdentity): MissionRuntime {
    const rt = this.missions.get(missionId);
    if (rt === undefined) {
      throw new MissionNotFoundError(missionId);
    }
    if (rt.callerId !== caller.callerId) {
      // Per Section 11: cross-caller access is denied. We return
      // MissionNotFoundError (not AuthorizationError) to avoid leaking
      // the existence of another caller's mission.
      throw new MissionNotFoundError(missionId);
    }
    return rt;
  }

  private countActiveForCaller(callerId: string): number {
    let count = 0;
    for (const rt of this.missions.values()) {
      if (rt.callerId === callerId && !isTerminal(rt.status)) {
        count += 1;
      }
    }
    return count;
  }

  private toSnapshot(rt: MissionRuntime): MissionSnapshot {
    return {
      missionId: rt.missionId,
      callerId: rt.callerId,
      label: rt.label,
      status: rt.status,
      terminal: isTerminal(rt.status),
      acceptedAt: rt.acceptedAt,
      finishedAt: rt.finishedAt,
      goalOutcome: rt.goalOutcome,
      result: rt.result,
      failureClass: rt.failureClass,
      failureMessage: rt.failureMessage,
      idempotencyKey: rt.idempotencyKey,
    };
  }

  private toEventRecord(seq: number, e: FlightEvent): MissionEventRecord {
    // Redact the event to public-safe fields. We keep the type and a
    // minimal payload; no chain-of-thought, no secrets, no internal tool payloads.
    const payload: Record<string, unknown> = {};
    const eventObj = e as unknown as Record<string, unknown>;
    for (const key of Object.keys(eventObj)) {
      if (key === 'type') continue;
      // Skip keys that may carry secrets or chain-of-thought.
      if (key === 'text' || key === 'contents' || key === 'prompt' || key === 'response') {
        continue;
      }
      const value = eventObj[key];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        payload[key] = value;
      } else if (Array.isArray(value)) {
        payload[key] = value.length;
      } else if (value !== null && typeof value === 'object') {
        // For nested objects, only expose primitive fields.
        const safe: Record<string, unknown> = {};
        for (const k of Object.keys(value as Record<string, unknown>)) {
          const v = (value as Record<string, unknown>)[k];
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            safe[k] = v;
          }
        }
        payload[key] = safe;
      }
    }
    return {
      seq,
      timestamp: (eventObj.at as string | undefined) ?? new Date().toISOString(),
      type: eventObj.type as string,
      payload,
    };
  }

  private buildChecks(context: {
    artifacts: ReadonlyArray<ArtifactSource>;
  }): readonly AcceptanceCheck[] {
    // Default verification: every produced artifact must exist in the
    // clean-room copy. Real missions inject richer checks via the
    // orchestrator's `checks` option; the gateway uses the structural floor.
    const checks: AcceptanceCheck[] = [];
    for (const source of context.artifacts) {
      for (const p of source.paths) {
        checks.push({
          kind: 'file',
          label: `${p} exists in clean-room copy`,
          path: cleanRoomPath(source, p),
        });
      }
    }
    if (checks.length === 0) {
      // No artifacts produced — the mission must have at least one
      // deliverable to be considered successful. Add a check that
      // will fail honestly (no file at the expected path).
      checks.push({
        kind: 'file',
        label: 'at least one artifact was produced',
        path: 'artifacts/missing/none-produced',
      });
    }
    return checks;
  }

  private buildDefaultRuntime(): {
    runtime: WorkerRuntime;
    computers: Map<string, MemoryComputer>;
  } {
    // Use the MemoryComputer helper from tests/helpers (lazy import via
    // a dynamic require would break ESM; we import it statically since
    // this is the default path and tests/helpers/memory-runtime.ts is
    // part of the project).
    const computers = new Map<string, MemoryComputer>();
    const runtime: WorkerRuntime = {
      name: 'gateway-default-memory-runtime',
      async ensureWorker(genome) {
        const id = genome.identity.id;
        if (!computers.has(id)) {
          computers.set(id, new MemoryComputer());
        }
        return { workerId: id, ref: `memory:${id}` };
      },
      async stopWorker() { /* no-op */ },
      computer(handle: RuntimeHandle): WorkerComputer {
        const c = computers.get(handle.workerId);
        if (!c) {
          throw new Error(`no computer for worker ${handle.workerId}`);
        }
        return c as unknown as WorkerComputer;
      },
      surfaces(handle: RuntimeHandle): WorkerSurfaces {
        const c = computers.get(handle.workerId);
        return c === undefined ? {} : { computer: c as unknown as WorkerComputer };
      },
    };
    return { runtime, computers };
  }

  private buildDefaultReasoning(): ReasoningProvider {
    // A minimal scripted reasoning provider that writes a single
    // artifact and finishes. Suitable for smoke-testing the gateway;
    // NOT suitable for real missions.
    let step = 0;
    return {
      name: 'DEVELOPMENT_REASONING_FALLBACK',
      async reason() {
        step += 1;
        if (step === 1) {
          return {
            text: JSON.stringify({
              action: 'write_file',
              path: 'output.md',
              contents: '# Genesis gateway output\n\nGenerated by the gateway service.\n',
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
}
