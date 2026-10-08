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
import { MemoryComputer, MemoryRuntime } from '../runtime/memory-computer.js';
import type {
  ArtifactsProvider,
  WorkerRuntime,
} from '../runtime/computer.js';

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
  /**
   * Computers per worker — captured so the gateway can read artifacts after completion.
   *
   * G6-08 (RB-1): used only by the legacy dev-path runtime constructed inside
   * MissionService (`buildDefaultRuntime`). For runtimes that implement
   * {@link ArtifactsProvider} (MemoryRuntime, OpenBotRuntimeAdapter), the
   * gateway reads artifacts through {@link MissionRuntime.runtime}.listArtifacts().
   */
  readonly computers: Map<string, MemoryComputer>;
  /** The orchestrator's runtime adapter (kept for artifact retrieval). */
  runtime?: WorkerRuntime;
  /** The promise returned by orchestrator.run() — awaited by the start() caller. */
  runPromise?: Promise<MissionResult>;
  /** Verification result captured when the mission finishes (for per-artifact verified flag). */
  verificationOk?: boolean;
  /** Set of artifact paths that passed verification (in the clean-room copy). */
  verifiedPaths?: Set<string>;
}

/**
 * Options for constructing a MissionService.
 */
export interface MissionServiceOptions {
  /**
   * Factory for the runtime adapter to use per mission.
   *
   * G6-08 (RB-2): the factory receives the missionId so it can construct a
   * FRESH adapter per mission (no shared adapter, no shared workers, no
   * shared workspace directories across concurrent missions). The factory
   * MUST return a distinct adapter instance on every call.
   *
   * The returned runtime SHOULD implement {@link ArtifactsProvider} so the
   * gateway can retrieve mission artifacts via `getArtifacts()`. If it does
   * not, the gateway falls back to iterating the dev-path `computers` Map
   * (only present for the default MemoryRuntime).
   *
   * Default: a MemoryRuntime-based factory (deterministic, no external services).
   */
  readonly runtimeFactory?: (ctx: { missionId: string }) => {
    runtime: WorkerRuntime;
    computers?: Map<string, MemoryComputer>;
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
  /**
   * G6-08 (Phase 3 / RC-6): retention window for terminal missions (ms).
   * Missions that have reached a terminal state AND whose `finishedAt` is
   * older than this window are evicted from the in-memory registry to
   * bound memory growth. Default: 5 minutes (300_000 ms).
   *
   * Set to a large value (e.g., 24h = 86_400_000) in tests that need
   * indefinite retention.
   */
  readonly terminalMissionRetentionMs?: number;
  /**
   * G6-08 (Phase 3 / RC-6): interval between sweeper runs (ms).
   * Default: 60 seconds. Set to 0 to disable background sweeping.
   */
  readonly sweepIntervalMs?: number;
}

const DEFAULT_OUTCOME_MAX_LENGTH = 10_000;
const DEFAULT_MISSION_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ACTIVE_GLOBAL = 50;
/** G6-08 (Phase 3): 5 minutes — see terminalMissionRetentionMs. */
const DEFAULT_TERMINAL_RETENTION_MS = 5 * 60_000;
/** G6-08 (Phase 3): 60 seconds — see sweepIntervalMs. */
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

/**
 * G6-08-R1 (B-EXEC-FINDING-003): structured result of a graceful shutdown.
 *
 * `clean: true` iff every active mission drained within its deadline AND
 * every runtime adapter's close() succeeded. The caller (gateway shutdown
 * handler) uses `clean` to decide exit code: 0 if clean, 1 otherwise.
 */
export interface ShutdownResult {
  /** True iff all missions drained and all runtimes closed without errors. */
  readonly clean: boolean;
  /** Total elapsed wall-clock ms (bounded by `deadlineMs`). */
  readonly elapsedMs: number;
  /** Active missions that reached terminal within their per-mission deadline. */
  readonly activeMissionsDrained: number;
  /** Active missions that did NOT reach terminal within their deadline. */
  readonly activeMissionsTimedOut: number;
  /** Runtime adapters whose close() succeeded (or had no close() method). */
  readonly runtimeAdaptersClosed: number;
  /** Runtime adapters whose close() threw. */
  readonly runtimeAdapterCloseErrors: number;
  /** Per-mission breakdown. */
  readonly perMission: readonly ShutdownMissionResult[];
  /** Per-runtime-adapter breakdown. */
  readonly perRuntime: readonly ShutdownRuntimeResult[];
}

interface ShutdownMissionResult {
  readonly missionId: string;
  readonly callerId: string;
  readonly drained: boolean;
  readonly timedOut: boolean;
  readonly finalStatus: MissionStatus;
  readonly cleanupError?: string;
}

interface ShutdownRuntimeResult {
  readonly missionId: string;
  readonly runtimeName: string;
  readonly closed: boolean;
  readonly closeError?: string;
}

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
  /** G6-08 (Phase 3): retention window for terminal missions (ms). */
  private readonly terminalMissionRetentionMs: number;
  /** G6-08 (Phase 3): sweeper interval handle (kept so close() can clear it). */
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  /** G6-08 (Phase 3): count of eviction sweeps performed (for tests/observability). */
  private sweepCount = 0;
  /** G6-08-R1 (B-EXEC-FINDING-003): true once shutdown() has been invoked. */
  private shuttingDown = false;

  constructor(options: MissionServiceOptions = {}) {
    this.runtimeFactory = options.runtimeFactory;
    this.reasoningFactory = options.reasoningFactory;
    this.ownership = loadOwnership(options.ownershipPath ?? 'data/ownership.yaml');
    this.defaultMissionTimeoutMs = options.defaultMissionTimeoutMs ?? DEFAULT_MISSION_TIMEOUT_MS;
    this.maxActiveMissionsGlobal = options.maxActiveMissionsGlobal ?? DEFAULT_MAX_ACTIVE_GLOBAL;
    this.maxOutcomeLength = options.maxOutcomeLength ?? DEFAULT_OUTCOME_MAX_LENGTH;
    this.terminalMissionRetentionMs =
      options.terminalMissionRetentionMs ?? DEFAULT_TERMINAL_RETENTION_MS;
    // G6-08 (Phase 3 / RC-6): start the background sweeper unless explicitly disabled.
    // The sweeper unref()s the timer so it does NOT keep the Node process alive.
    const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    if (sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => {
        try { this.sweepTerminalMissions(); } catch { /* best-effort */ }
      }, sweepIntervalMs);
      this.sweepTimer.unref();
    }
  }

  /**
   * G6-08 (Phase 3 / RC-6): stop the background sweeper and release all
   * per-mission state. Safe to call multiple times. Used by tests and
   * graceful shutdown paths.
   */
  close(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /**
   * G6-08-R1 (B-EXEC-FINDING-003): graceful shutdown of all active missions
   * and their owned runtime workers.
   *
   * INTERNAL lifecycle operation — NOT exposed through the public API used
   * by HTTP/A2A transports. Called only by the gateway's SIGTERM/SIGINT
   * handler. Does NOT use a synthetic public caller identity; operates
   * directly on the internal MissionRuntime registry.
   *
   * Lifecycle:
   *   1. Mark service as shuttingDown (start() rejects new submissions).
   *   2. Stop the background sweeper.
   *   3. For each active mission: abort controller, await runPromise with
   *      a per-mission deadline (orchestrator finally{} calls stopWorker()
   *      for each ensured worker).
   *   4. Safety net: call runtime.close() on each mission's runtime adapter
   *      to stop any workers that survived per-mission stopWorker.
   *   5. Report structured result so the caller can decide exit code.
   *
   * Does NOT call process.exit() — caller's responsibility.
   */
  async shutdown(deadlineMs: number = 10_000): Promise<ShutdownResult> {
    this.shuttingDown = true;
    this.close();

    const startedAt = Date.now();
    const perMission: ShutdownMissionResult[] = [];
    const perRuntime: ShutdownRuntimeResult[] = [];

    // Snapshot active missions (defensive copy).
    const activeSnapshots: Array<{ missionId: string; rt: MissionRuntime }> = [];
    for (const [missionId, rt] of this.missions) {
      if (!isTerminal(rt.status)) {
        activeSnapshots.push({ missionId, rt });
      }
    }

    // Abort each active mission's controller.
    for (const { rt } of activeSnapshots) {
      if (!rt.canceled) {
        rt.canceled = true;
        rt.status = 'CANCELLATION_REQUESTED';
        try { rt.controller.abort(); } catch { /* best-effort */ }
      }
    }

    // Await each mission's runPromise with a per-mission deadline.
    const perMissionDeadline = Math.min(deadlineMs, 5_000);
    for (const { missionId, rt } of activeSnapshots) {
      const missionDeadline = Math.min(
        perMissionDeadline,
        Math.max(0, deadlineMs - (Date.now() - startedAt)),
      );
      let drained = false;
      let timedOut = false;
      let cleanupError: string | undefined;
      if (rt.runPromise !== undefined) {
        try {
          await Promise.race([
            rt.runPromise,
            new Promise<void>((resolve) => setTimeout(resolve, missionDeadline)),
          ]);
          if (isTerminal(rt.status)) {
            drained = true;
          } else {
            timedOut = true;
          }
        } catch (e) {
          cleanupError = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
          drained = isTerminal(rt.status);
        }
      } else {
        // No runPromise — mission accepted but orchestrator never started.
        rt.status = 'CANCELLED';
        rt.finishedAt = new Date().toISOString();
        drained = true;
      }
      perMission.push({
        missionId,
        callerId: rt.callerId,
        drained,
        timedOut,
        finalStatus: rt.status,
        ...(cleanupError !== undefined ? { cleanupError } : {}),
      });
    }

    // Safety net: call runtime.close() on each mission's runtime adapter.
    // G6-09B fix for G6-09-001 (P1): each close() is wrapped in
    // Promise.race with a per-runtime deadline. Without this, a hung
    // close() would block the entire shutdown indefinitely — the
    // gateway's outer 10s deadline was aspirational, not enforced.
    // The per-runtime deadline is 2s by default, or the remaining time
    // to the outer deadline if less. If the timeout wins, we record
    // closeError='timeout after Xms' and set closed=false — the
    // structured ShutdownResult.clean reflects the unclean state.
    const seenRuntimes = new Set<WorkerRuntime>();
    for (const [missionId, rt] of this.missions) {
      if (rt.runtime === undefined) continue;
      if (seenRuntimes.has(rt.runtime)) continue;
      seenRuntimes.add(rt.runtime);
      const runtimeName = rt.runtime.name ?? '<unnamed>';
      let closed = false;
      let closeError: string | undefined;
      if (typeof rt.runtime.close === 'function') {
        const perRuntimeDeadline = Math.min(
          2_000,
          Math.max(0, deadlineMs - (Date.now() - startedAt)),
        );
        let timedOut = false;
        try {
          await Promise.race([
            rt.runtime.close(),
            new Promise<void>((resolve) => {
              setTimeout(() => {
                timedOut = true;
                resolve();
              }, perRuntimeDeadline);
            }),
          ]);
          if (timedOut) {
            closeError = `timeout after ${perRuntimeDeadline}ms`;
            // closed stays false — the close() did not actually resolve
          } else {
            closed = true;
          }
        } catch (e) {
          closeError = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
        }
      } else {
        closed = true;
      }
      perRuntime.push({
        missionId,
        runtimeName,
        closed,
        ...(closeError !== undefined ? { closeError } : {}),
      });
    }

    const totalDrained = perMission.filter((p) => p.drained).length;
    const totalTimedOut = perMission.filter((p) => p.timedOut).length;
    const totalClosed = perRuntime.filter((p) => p.closed).length;
    const totalCloseErrors = perRuntime.filter((p) => p.closeError !== undefined).length;
    const elapsedMs = Date.now() - startedAt;

    return {
      clean: totalTimedOut === 0 && totalCloseErrors === 0,
      elapsedMs,
      activeMissionsDrained: totalDrained,
      activeMissionsTimedOut: totalTimedOut,
      runtimeAdaptersClosed: totalClosed,
      runtimeAdapterCloseErrors: totalCloseErrors,
      perMission,
      perRuntime,
    };
  }

  /**
   * G6-08 (Phase 3 / RC-6): evict terminal missions whose `finishedAt` is
   * older than the retention window. Also evicts the corresponding
   * idempotencyIndex entries (so the key can be reused by a future
   * submission from the same caller — RC-6 / B-REGISTRY-FINDING-002).
   *
   * This method is safe to call from the setInterval background sweeper.
   * It does NOT touch active (non-terminal) missions.
   *
   * Verifier workspaces, runtime adapters, and other per-mission state
   * are NOT explicitly closed here — they will be garbage-collected once
   * the MissionRuntime reference is dropped. Production runtimes
   * (OpenBotRuntimeAdapter) clean up their worker processes via
   * stopWorker() in the orchestrator's finally{} block.
   */
  sweepTerminalMissions(now: number = Date.now()): { evicted: number; remaining: number } {
    const cutoff = now - this.terminalMissionRetentionMs;
    const toEvict: string[] = [];
    for (const [missionId, rt] of this.missions) {
      if (!isTerminal(rt.status)) continue;
      const finishedAtMs = rt.finishedAt ? Date.parse(rt.finishedAt) : NaN;
      // If finishedAt is missing or unparseable, fall back to acceptedAt
      // (defensive — the mission reached terminal somehow).
      const referenceMs = Number.isNaN(finishedAtMs)
        ? Date.parse(rt.acceptedAt)
        : finishedAtMs;
      if (Number.isNaN(referenceMs) || referenceMs <= cutoff) {
        toEvict.push(missionId);
      }
    }
    for (const missionId of toEvict) {
      const rt = this.missions.get(missionId);
      if (rt === undefined) continue;
      this.missions.delete(missionId);
      // RC-6 / B-REGISTRY-FINDING-002: also remove the idempotency key so it
      // can be reused by a future submission from the same caller.
      if (rt.idempotencyKey !== undefined) {
        this.idempotencyIndex.delete(rt.idempotencyKey);
      }
    }
    this.sweepCount += 1;
    return { evicted: toEvict.length, remaining: this.missions.size };
  }

  /**
   * G6-08 (Phase 3): test/observability accessor for sweep stats.
   */
  getSweepStats(): { sweepCount: number; totalMissions: number; terminalMissions: number; activeMissions: number } {
    let terminal = 0;
    let active = 0;
    for (const rt of this.missions.values()) {
      if (isTerminal(rt.status)) terminal += 1; else active += 1;
    }
    return {
      sweepCount: this.sweepCount,
      totalMissions: this.missions.size,
      terminalMissions: terminal,
      activeMissions: active,
    };
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
    // G6-08-R1 (B-EXEC-FINDING-003): reject new submissions during shutdown.
    if (this.shuttingDown) {
      throw new MissionAdmissionError(
        'gateway is shutting down — new mission submissions are not accepted',
      );
    }
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
    // Service-wide hard cap (counts only ACTIVE, non-terminal missions).
    const globalActive = this.countActiveGlobal();
    if (globalActive >= this.maxActiveMissionsGlobal) {
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

    // 5. Build the runtime — FRESH per mission (G6-08 RB-2).
    //    Production runtimes (OpenBot) get a per-mission rootDir so worker
    //    workspace directories do not collide across concurrent missions.
    const runtimeBuild = this.runtimeFactory
      ? this.runtimeFactory({ missionId })
      : this.buildDefaultRuntime();
    const runtime = runtimeBuild.runtime;
    const computers = runtimeBuild.computers ?? new Map<string, MemoryComputer>();

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
      async (result) => {
        missionRuntime.result = result;
        missionRuntime.finishedAt = new Date().toISOString();
        missionRuntime.status = statusFromResult(result, missionRuntime.canceled);
        // Capture verification result from flight events for per-artifact verified flag.
        // G6-08 (RB-1): this is now async — it may call runtime.listArtifacts()
        // to enumerate actual worker workspace files (production OpenBot path).
        // Awaiting here means any subsequent awaitCompletion() / getArtifacts()
        // call sees a fully-populated verifiedPaths set.
        try {
          await this.captureVerificationResult(missionRuntime);
        } catch {
          // Capture failure must not mask the mission result itself.
          missionRuntime.verificationOk = false;
          missionRuntime.verifiedPaths = new Set<string>();
        }
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
   *
   * G6-08 (RB-1): the gateway reads artifacts from the runtime adapter
   * (which is the source of truth for what files exist in each worker's
   * workspace) via {@link ArtifactsProvider.listArtifacts} when available.
   * Falls back to iterating the legacy dev-path `computers` Map for runtimes
   * that do not implement ArtifactsProvider.
   *
   * Per-artifact `verified` flag: based on the actual VerificationResult
   * captured when the mission finished. If the mission has not reached
   * verification (e.g., still RUNNING or CANCELLED before verification),
   * `verified` is false. If verification passed, files in the verified
   * paths set are `verified: true`; others are `verified: false`.
   *
   * Verifier clean-room copies (workerId='mission-verifier-1') are excluded
   * — they are internal verifier bookkeeping, not mission deliverables.
   */
  async getArtifacts(missionId: string, caller: CallerIdentity): Promise<MissionArtifactRecord[]> {
    const rt = this.requireMission(missionId, caller);
    const verificationOk = rt.verificationOk ?? false;
    const verifiedPaths = rt.verifiedPaths ?? new Set<string>();

    // G6-08 (RB-1): prefer the runtime's listArtifacts() when available.
    // This is the production path — OpenBotRuntimeAdapter populates its
    // internal `computers` Map from the actual worker processes, which
    // the gateway previously could not see.
    const provider = rt.runtime as (WorkerRuntime & Partial<ArtifactsProvider>) | undefined;
    if (provider && typeof provider.listArtifacts === 'function') {
      const snapshots = await provider.listArtifacts();
      const records: MissionArtifactRecord[] = [];
      for (const s of snapshots) {
        records.push({
          workerId: s.workerId,
          path: s.path,
          content: s.content,
          verified: verificationOk && verifiedPaths.has(s.path),
          bytes: s.bytes,
        });
      }
      return records;
    }

    // Legacy dev-path fallback (default MemoryRuntime built inside MissionService).
    const records: MissionArtifactRecord[] = [];
    for (const [workerId, computer] of rt.computers) {
      if (workerId === 'mission-verifier-1' || workerId.startsWith('mission-verifier')) {
        continue;
      }
      for (const [path, content] of computer.files) {
        // Path traversal protection: reject paths containing '..' or absolute paths
        if (path.includes('..') || path.startsWith('/')) continue;
        records.push({
          workerId,
          path,
          content: content.length <= 65_536 ? content : undefined,
          verified: verificationOk && verifiedPaths.has(path),
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

  private countActiveGlobal(): number {
    let count = 0;
    for (const rt of this.missions.values()) {
      if (!isTerminal(rt.status)) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * Extract the verification result from the flight recorder events
   * and store it on the mission runtime. This is used by getArtifacts()
   * to set the per-artifact `verified` flag truthfully.
   *
   * G6-08 (RB-1): the verified-paths set is populated from the runtime's
   * listArtifacts() when available — that path reflects actual worker
   * workspaces (production OpenBot path), not just the legacy dev Map.
   * The verification event itself is read synchronously from the flight
   * recorder; the artifact enumeration is async, so this method is async.
   */
  private async captureVerificationResult(rt: MissionRuntime): Promise<void> {
    const events = rt.recorder.events as FlightEvent[];
    const verificationEvent = events.find((e) => e.type === 'verification') as
      | { ok: boolean; passed: number; failed: number; failures: readonly string[] }
      | undefined;
    if (verificationEvent !== undefined) {
      rt.verificationOk = verificationEvent.ok;
      // If verification passed, mark all artifact paths as verified.
      // The verification event doesn't list which specific paths passed,
      // but if ok=true, all checks passed. We mark every non-verifier
      // file path as verified.
      if (verificationEvent.ok) {
        const paths = new Set<string>();
        // G6-08 (RB-1): prefer runtime's listArtifacts() (production path).
        const provider = rt.runtime as (WorkerRuntime & Partial<ArtifactsProvider>) | undefined;
        if (provider && typeof provider.listArtifacts === 'function') {
          try {
            const snapshots = await provider.listArtifacts();
            for (const s of snapshots) paths.add(s.path);
          } catch {
            // Adapter may have been closed already — fall through to legacy path.
          }
        }
        // Legacy dev-path fallback (MemoryComputer.files).
        for (const [workerId, computer] of rt.computers) {
          if (workerId === 'mission-verifier-1' || workerId.startsWith('mission-verifier')) {
            continue;
          }
          for (const p of computer.files.keys()) {
            paths.add(p);
          }
        }
        rt.verifiedPaths = paths;
      } else {
        rt.verifiedPaths = new Set<string>();
      }
    } else {
      // No verification event — mission may have been cancelled before
      // verification ran. Mark as not verified.
      rt.verificationOk = false;
      rt.verifiedPaths = new Set<string>();
    }
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
    // G6-08 (RB-1): use the promoted MemoryRuntime from src/runtime/memory-computer.ts.
    // MemoryRuntime implements ArtifactsProvider so the gateway's getArtifacts()
    // reads actual worker workspace files through the same contract as the
    // production OpenBot path. The legacy `computers` Map is still kept as a
    // fallback for runtimes that do not implement ArtifactsProvider.
    const runtime = new MemoryRuntime();
    return {
      runtime,
      computers: runtime.computers as Map<string, MemoryComputer>,
    };
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
