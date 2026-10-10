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
import type { McpServerConfig } from '../plugins/mcp-config.js';
import { LazyCompositeMcpProvider } from '../plugins/mcp-activation.js';
import type { McpCapabilityProvider } from '../runtime/mcp/capability-provider.js';

/**
 * G6-09C fix for C-053 (P2, defense-in-depth): scrub common secret patterns
 * from error messages before they are stored in failureMessage/cleanupError
 * and exposed via the public API.
 *
 * Patterns scrubbed:
 *   - Bearer tokens (Authorization: Bearer ...)
 *   - GitHub PATs (ghp_..., gho_..., ghs_..., ghu_..., gha_...)
 *   - OpenRouter API keys (sk-or-v1-...)
 *   - Anthropic API keys (sk-ant-...)
 *   - OpenAI API keys (sk-...)
 *   - AWS secret keys (AWS_SECRET_ACCESS_KEY=..., aws_secret_access_key=...)
 *   - Generic API key patterns (api_key=..., api-key=..., x-api-key=...)
 *
 * The scrub replaces the secret value with '[REDACTED]' while preserving
 * the surrounding error context (so operators can still diagnose the failure).
 *
 * This is defense-in-depth — the primary defense is preventing secrets from
 * reaching error messages in the first place (per the G6-09B env allowlist fix).
 * But when an upstream error DOES echo a secret (e.g., a misconfigured provider
 * includes "Authorization: Bearer ghp_..." in its error), this scrub prevents
 * the secret from leaking into the public failureMessage field.
 */
const SECRET_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }> = [
  // Authorization: Bearer <token>
  { pattern: /Bearer\s+[A-Za-z0-9_\-\.]+/g, label: 'Bearer token' },
  // GitHub PATs (ghp_, gho_, ghs_, ghu_, gha_ prefixes followed by 36+ chars)
  // Include underscores in the char class to handle non-canonical formats
  { pattern: /gh[opua]_[A-Za-z0-9_]{36,}/g, label: 'GitHub PAT' },
  // OpenRouter API keys (sk-or-v1- prefix followed by 20+ chars)
  // Permissive: real keys are 64 hex chars, but we scrub any 20+ char suffix
  { pattern: /sk-or-v1-[A-Za-z0-9_]{20,}/gi, label: 'OpenRouter key' },
  // Anthropic API keys (sk-ant- prefix followed by 20+ chars)
  { pattern: /sk-ant-[A-Za-z0-9_\-]{20,}/g, label: 'Anthropic key' },
  // OpenAI API keys (sk- prefix followed by 20+ chars, but NOT sk-or or sk-ant)
  // Use negative lookahead to avoid matching OpenRouter/Anthropic keys
  { pattern: /sk-(?!or-|ant-)[A-Za-z0-9_]{20,}/g, label: 'OpenAI key' },
  // AWS secret access key assignments (values can contain alnum, /, +, =, _)
  { pattern: /(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key)\s*[=:]\s*[A-Za-z0-9\/+=_]{20,}/g, label: 'AWS secret' },
  // Generic api_key / api-key / x-api-key assignments (values can contain alnum, _, -)
  { pattern: /(?:api_key|api-key|x-api-key)\s*[=:]\s*[A-Za-z0-9_\-]{20,}/gi, label: 'API key' },
];

/**
 * Scrub common secret patterns from a text string. Returns the scrubbed text
 * with secrets replaced by '[REDACTED]'.
 *
 * @param text - the text to scrub (typically an error message)
 * @param maxLength - the maximum length of the returned text (applied AFTER scrubbing)
 */
function scrubSecrets(text: string, maxLength: number = 300): string {
  let scrubbed = text;
  for (const { pattern } of SECRET_PATTERNS) {
    // Reset the regex lastIndex (patterns are global)
    pattern.lastIndex = 0;
    scrubbed = scrubbed.replace(pattern, '[REDACTED]');
  }
  return scrubbed.slice(0, maxLength);
}
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
import {
  FileMissionHistoryStore,
  MISSION_HISTORY_SCHEMA_VERSION,
  type MissionHistoryRecord,
} from '../mission/mission-history-store.js';
import { structuredLog } from './logger.js';
import { existsSync, rmSync, realpathSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import type {
  CallerIdentity,
  MissionSubmission,
  MissionSnapshot,
  MissionStatus,
  MissionArtifactRecord,
  MissionEventRecord,
  MissionListSummary,
  MissionListResult,
  AcceptanceCheckInput,
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
   * G7-11 (FM-07/FM-08): caller-supplied acceptance criteria. Stored on the
   * runtime so buildChecks() can merge them with the structural floor.
   */
  readonly acceptanceCriteria?: readonly AcceptanceCheckInput[];
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
  /**
   * G7-15B-H1: true when the terminal history write FAILED. The in-process
   * mission result is still the real outcome (SUCCEEDED/FAILED/etc.), but the
   * durable record does NOT confirm it. On restart, the stale non-terminal
   * record will be recovered as OUTCOME_UNCONFIRMED (not as a confirmed
   * failure). The caller can observe this flag via the snapshot's
   * `failureMessage` (which is appended with a persistence-warning note when
   * this flag is set) — the in-process result is NOT changed.
   */
  persistenceFailed?: boolean;
  /**
   * G7-16A-H1: the mission's workspace directory on disk (if any).
   * Populated by the runtimeFactory when the runtime adapter creates
   * a workspace directory (OpenBot adapter sets it to
   * `${OPENBOT_ROOT_DIR}/{missionId}`). Used by the sweeper to clean
   * up the workspace after the retention window. MemoryRuntime leaves
   * this undefined (no disk workspace).
   */
  workspaceDir?: string;
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
    /** G7-16A-H1: disk workspace directory (for cleanup after retention). */
    workspaceDir?: string;
  };
  /**
   * Factory for the reasoning provider. Default: a scripted reasoning
   * provider that emits the deterministic hello.md sequence.
   *
   * For real missions, callers should inject a real ReasoningProvider
   * (e.g., ZAIReasoningProvider) — but the gateway itself is provider-neutral.
   */
  readonly reasoningFactory?: () => ReasoningProvider;
  /**
   * G7-14: MCP server configurations. When provided, each mission gets a
   * LazyCompositeMcpProvider that connects servers on demand (only when
   * a worker whose genome grants `mcp:<tool>` actually invokes the tool).
   * The provider is closed after mission completion/failure/cancellation.
   */
  readonly mcpServers?: readonly McpServerConfig[];
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
  /**
   * G7-15B: durable mission history store. When provided, terminal mission
   * records are persisted to disk (one atomic JSON file per mission) and
   * recovered on startup. Interrupted missions (was RUNNING/ACCEPTED when
   * the process died) are recovered as FAILED with failureClass='RUNTIME_FAILURE'.
   *
   * The store is OPTIONAL — when absent, MissionService behaves exactly as
   * before (in-process registry only, no restart durability). This preserves
   * backward compatibility with all existing tests that construct
   * MissionService without a history store.
   *
   * No frozen-contract modification: the store is injected via this option;
   * MissionSnapshot, MissionResult, MissionStatus, and FailureClass are
   * unchanged.
   */
  readonly missionHistoryStore?: FileMissionHistoryStore;
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
  private readonly mcpServers: readonly McpServerConfig[];
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
  /**
   * G7-15B: durable mission history store. Optional — when absent, the
   * service behaves as before (in-process registry only, no restart
   * durability).
   */
  private readonly historyStore: FileMissionHistoryStore | null;
  /**
   * G7-15B: in-memory index of recovered history records, keyed by missionId.
   * Populated at construction time by `recoverHistory()`. Missions that
   * reach a terminal state in the current process are added here too (via
   * `persistTerminal()`) so that subsequent `get()` calls (after the
   * in-process registry evicts the mission) can still return a snapshot.
   *
   * Interrupted missions (was RUNNING/ACCEPTED when the previous process
   * died) are recovered as FAILED with failureClass='RUNTIME_FAILURE' and
   * a truthful failureMessage. The recovery rewrites the persisted record
   * so subsequent restarts see the FAILED state (not the pre-crash RUNNING
   * state).
   */
  private readonly historyIndex = new Map<string, MissionHistoryRecord>();

  constructor(options: MissionServiceOptions = {}) {
    this.runtimeFactory = options.runtimeFactory;
    this.reasoningFactory = options.reasoningFactory;
    this.mcpServers = options.mcpServers ?? [];
    this.ownership = loadOwnership(options.ownershipPath ?? 'data/ownership.yaml');
    this.defaultMissionTimeoutMs = options.defaultMissionTimeoutMs ?? DEFAULT_MISSION_TIMEOUT_MS;
    this.maxActiveMissionsGlobal = options.maxActiveMissionsGlobal ?? DEFAULT_MAX_ACTIVE_GLOBAL;
    this.maxOutcomeLength = options.maxOutcomeLength ?? DEFAULT_OUTCOME_MAX_LENGTH;
    this.terminalMissionRetentionMs =
      options.terminalMissionRetentionMs ?? DEFAULT_TERMINAL_RETENTION_MS;
    this.historyStore = options.missionHistoryStore ?? null;
    // G6-08 (Phase 3 / RC-6): start the background sweeper unless explicitly disabled.
    // The sweeper unref()s the timer so it does NOT keep the Node process alive.
    const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    if (sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => {
        try { this.sweepTerminalMissions(); } catch { /* best-effort */ }
      }, sweepIntervalMs);
      this.sweepTimer.unref();
    }
    // G7-15B: recover durable mission history from disk. Interrupted
    // missions (RUNNING/ACCEPTED/CANCELLATION_REQUESTED at crash time) are
    // rewritten to FAILED. This is the truthful recovery — never invent
    // success, artifact verification, or continued execution.
    if (this.historyStore !== null) {
      this.recoverHistory();
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
          cleanupError = scrubSecrets(e instanceof Error ? e.message : String(e), 200);
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
          closeError = scrubSecrets(e instanceof Error ? e.message : String(e), 200);
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
      // G7-16A: clean up the OpenBot workspace directory for this mission.
      // The workspace directory was created by the per-mission runtime adapter
      // at `${OPENBOT_ROOT_DIR}/{missionId}/`. At this point:
      //   - The mission is terminal (SUCCEEDED/FAILED/PARTIAL/CANCELLED).
      //   - persistTerminal() has already captured artifact metadata in the
      //     history store (if the history store is configured).
      //   - The retention window has elapsed (default 5 min).
      //   - The workspace content is no longer retrievable via the API after
      //     eviction (the history store has metadata only — documented).
      // This is the existing lifecycle boundary; no new background service.
      this.cleanupWorkspace(missionId, rt);
    }
    this.sweepCount += 1;
    return { evicted: toEvict.length, remaining: this.missions.size };
  }

  /**
   * G7-16A: clean up the OpenBot workspace directory for an evicted mission.
   * Safe: only called from sweepTerminalMissions() for terminal missions
   * past their retention window. The workspace directory is under
   * OPENBOT_ROOT_DIR; the mission's runtime adapter created it. The adapter
   * has already been stopped (stopWorker in orchestrator's finally{}).
   *
   * Defense-in-depth: verify the path is under the configured rootDir and
   * does NOT contain path traversal before deleting.
   */
  private cleanupWorkspace(missionId: string, rt: MissionRuntime): void {
    // G7-16A-H2: canonical path containment for workspace cleanup.
    const workspaceDir = rt.workspaceDir;
    if (workspaceDir === undefined || workspaceDir.length === 0) return;
    // Reject path traversal in the raw string.
    if (workspaceDir.includes('..')) return;

    // Resolve to a canonical absolute path (resolves '.', '..' segments
    // but does NOT resolve symlinks).
    const resolvedDir = resolvePath(workspaceDir);

    // Determine the trusted root from the OPENBOT_ROOT_DIR env var.
    // The workspaceDir should be `${OPENBOT_ROOT_DIR}/{missionId}`.
    // We verify that resolvedDir is strictly under the resolved root.
    const rootEnv = process.env.OPENBOT_ROOT_DIR;
    if (rootEnv === undefined || rootEnv.length === 0) return;
    const resolvedRoot = resolvePath(rootEnv);
    // Containment: resolvedDir must start with resolvedRoot + path separator.
    // This prevents sibling-prefix attacks (e.g., /root/mission-abc vs
    // /root/mission-abcdef) by requiring a path boundary.
    if (!resolvedDir.startsWith(resolvedRoot + '/') && resolvedDir !== resolvedRoot) {
      structuredLog('warn', 'workspace_cleanup', `rejected path outside root: ${resolvedDir} not under ${resolvedRoot}`, { missionId });
      return;
    }

    try {
      if (!existsSync(workspaceDir)) return; // already deleted or never existed

      // Resolve symlinks to check the real target.
      let resolved: string;
      try {
        resolved = realpathSync(workspaceDir);
      } catch {
        // realpathSync throws if the path doesn't exist or is a broken symlink.
        return; // Already gone or broken — skip safely.
      }
      // The resolved (real) path must also be under the root.
      // This catches symlinks that redirect outside OPENBOT_ROOT_DIR.
      if (!resolved.startsWith(resolvedRoot + '/') && resolved !== resolvedRoot) {
        structuredLog('warn', 'workspace_cleanup', `rejected symlink escape: ${resolved} not under ${resolvedRoot}`, { missionId });
        return;
      }

      rmSync(workspaceDir, { recursive: true, force: true });
      structuredLog('info', 'workspace_cleanup', `workspace deleted: ${workspaceDir}`, { missionId });
    } catch (err) {
      structuredLog('warn', 'workspace_cleanup', `failed to delete workspace: ${err instanceof Error ? err.message : String(err)}`, { missionId });
    }
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
    const reasoningInstance = this.reasoningFactory
      ? this.reasoningFactory()
      : this.buildDefaultReasoning();

    // G7-14: Create a lazy MCP provider if MCP servers are configured.
    // The provider connects servers on demand (only when a worker whose
    // genome grants mcp:<tool> actually invokes the tool). Closed after
    // mission completion/failure/cancellation in the promise handlers below.
    const mcpProvider: McpCapabilityProvider | null =
      this.mcpServers.length > 0
        ? new LazyCompositeMcpProvider(this.mcpServers)
        : null;

    const orchestrator = new MissionOrchestrator({
      goalCompiler: new GoalCompiler(),
      planner: new OrganizationPlanner(),
      genomeCompiler: new GenomeCompiler({
        registry: this.ownership,
        selectTier: (selection) =>
          new CognitiveRouter(new RuleDecisionProvider()).selectTier(selection),
      }),
      runtime,
      reasoning: reasoningInstance,
      recorder,
      missionId,
      // G7-11C: read actual token usage from the provider if it exposes a
      // usage() method (ZAIReasoningProvider does). This is an OPTIONAL
      // capability — the frozen ReasoningProvider contract does NOT require
      // it. Providers without usage() report zeros (backward compatible).
      // USD pricing is UNKNOWN for ZAI (included usage, no separate billing);
      // we report tokens truthfully and leave usd at 0.
      costSource: () => {
        const maybeUsage = reasoningInstance as ReasoningProvider & {
          usage?: () => { totalTokens?: number; promptTokens?: number; completionTokens?: number };
        };
        if (typeof maybeUsage.usage === 'function') {
          const u = maybeUsage.usage();
          return { usd: 0, tokens: u.totalTokens ?? 0 };
        }
        return { usd: 0, tokens: 0 };
      },
      maxWorkerSteps: 5,
      missionTimeoutMs: timeoutMs,
      signal: controller.signal,
      checks: (ctx) => this.buildChecks(ctx, missionRuntime.acceptanceCriteria),
      // G7-14: pass the lazy MCP provider to the orchestrator. The
      // orchestrator passes it to each WorkerAgent. The worker's genome
      // grants (mcp:<tool>) determine which tools it can invoke. The
      // lazy provider connects servers on first invokeTool call.
      ...(mcpProvider !== null ? { mcp: mcpProvider } : {}),
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
      // G7-11: store caller-supplied acceptance criteria for buildChecks().
      acceptanceCriteria: submission.acceptanceCriteria,
      computers,
      runtime,
      // G7-16A-H1: capture the workspace directory for cleanup after retention.
      ...(runtimeBuild.workspaceDir !== undefined ? { workspaceDir: runtimeBuild.workspaceDir } : {}),
    };
    this.missions.set(missionId, missionRuntime);
    if (submission.idempotencyKey) {
      this.idempotencyIndex.set(submission.idempotencyKey, missionId);
    }

    // G7-15B: persist the initial mission record (status=ACCEPTED) so that
    // an interrupted mission (process dies before terminal) has a durable
    // representation. On restart, recoverHistory() rewrites it to FAILED.
    if (this.historyStore !== null) {
      try {
        this.historyStore.write({
          schemaVersion: MISSION_HISTORY_SCHEMA_VERSION,
          missionId,
          callerId: caller.callerId,
          ...(submission.label !== undefined ? { label: submission.label } : {}),
          ...(submission.idempotencyKey !== undefined ? { idempotencyKey: submission.idempotencyKey } : {}),
          status: 'ACCEPTED',
          acceptedAt,
          goalOutcome: scrubSecrets(goalOutcome, 10_000),
        });
      } catch (err) {
        // Best-effort: a history-write failure does NOT block the mission.
        structuredLog('warn', 'history', `failed to persist initial history: ${err instanceof Error ? err.message : String(err)}`, { missionId });
      }
    }
    structuredLog('info', 'gateway', 'mission accepted', { missionId, callerId: caller.callerId });

    // 9. Start the orchestrator in the background.
    missionRuntime.status = 'RUNNING';
    missionRuntime.runPromise = orchestrator.run(goal).then(
      async (result) => {
        missionRuntime.result = result;
        missionRuntime.finishedAt = new Date().toISOString();
        missionRuntime.status = statusFromResult(result, missionRuntime.canceled);
        try {
          await this.captureVerificationResult(missionRuntime);
        } catch {
          missionRuntime.verificationOk = false;
          missionRuntime.verifiedPaths = new Set<string>();
        }
        // G7-14: close the MCP provider (cleanup after success/failure/cancellation).
        if (mcpProvider !== null) {
          try { await mcpProvider.close(); } catch { /* best-effort */ }
        }
        // G7-15B: persist the terminal record (atomic rewrite-by-id). This
        // updates the persisted file from ACCEPTED/RUNNING to the terminal
        // status, with the full MissionResult summary, cost, failure class,
        // and artifact metadata. The record is also added to the in-memory
        // historyIndex so subsequent get() calls (after the in-process
        // registry evicts the mission) can still return a snapshot.
        if (this.historyStore !== null) {
          this.persistTerminal(missionRuntime);
        }
        structuredLog('info', 'gateway', 'mission completed', { missionId, status: missionRuntime.status, callerId: missionRuntime.callerId });
        return result;
      },
      (error) => {
        const failureClass = classifyError(error);
        missionRuntime.failureClass = failureClass;
        missionRuntime.failureMessage = scrubSecrets(error instanceof Error ? error.message : String(error), 300);
        missionRuntime.finishedAt = new Date().toISOString();
        missionRuntime.status = missionRuntime.canceled ? 'CANCELLED' : 'FAILED';
        missionRuntime.result = {
          status: 'failure',
          summary: `infrastructure error: ${missionRuntime.failureMessage}`,
          evidence: [],
          cost: { usd: 0, tokens: 0, wallMs: 0, humanInterventions: 0 },
        };
        // G7-14: close the MCP provider even on infrastructure error.
        if (mcpProvider !== null) {
          mcpProvider.close().catch(() => { /* best-effort */ });
        }
        // G7-15B: persist the terminal record even on infrastructure error.
        if (this.historyStore !== null) {
          this.persistTerminal(missionRuntime);
        }
        structuredLog('error', 'gateway', 'mission failed', { missionId, status: missionRuntime.status, failureClass, callerId: missionRuntime.callerId });
        return missionRuntime.result;
      },
    );

    return { missionId, status: missionRuntime.status };
  }

  /**
   * Get a snapshot of a mission. Enforces caller isolation.
   *
   * G7-15B: when the mission is not in the in-process registry (evicted by
   * the sweeper OR the process restarted), consult the durable history
   * index. If a history record exists, return a snapshot built from it.
   * Caller isolation is enforced on the history record's `callerId`.
   *
   * The history snapshot is read-only and terminal (recovered missions are
   * always FAILED; persisted terminal missions are SUCCEEDED/FAILED/PARTIAL/
   * CANCELLED). The `result` field is reconstructed from the persisted
   * `resultSummary` + `resultStatus` + `cost` fields — the full evidence
   * array is NOT persisted (it could contain tool output; the history store
   * persists only metadata, never content).
   */
  get(missionId: string, caller: CallerIdentity): MissionSnapshot {
    const rt = this.missions.get(missionId);
    if (rt !== undefined) {
      if (rt.callerId !== caller.callerId) {
        // Per Section 11: cross-caller access is denied. Return
        // MissionNotFoundError (not AuthorizationError) to avoid leaking
        // the existence of another caller's mission.
        throw new MissionNotFoundError(missionId);
      }
      return this.toSnapshot(rt);
    }
    // G7-15B: not in the in-process registry — consult the history index.
    const record = this.historyIndex.get(missionId);
    if (record === undefined) {
      throw new MissionNotFoundError(missionId);
    }
    if (record.callerId !== caller.callerId) {
      throw new MissionNotFoundError(missionId);
    }
    return this.historyRecordToSnapshot(record);
  }

  /**
   * G7-10 — List missions owned by the authenticated caller.
   *
   * Server-authoritative listing of the in-process mission registry, filtered
   * to the caller's ownership boundary. NOT restart-durable: terminal missions
   * are evicted by sweepTerminalMissions() after the retention window, and the
   * entire registry is lost on process restart.
   *
   * Pagination: cursor-based. The cursor is the missionId of the last item in
   * the current page. The next page starts immediately after that missionId in
   * the deterministic sort order (descending acceptedAt, then descending
   * missionId as a stable tiebreaker). This is robust against the sweeper
   * evicting terminal missions between requests: the cursor is a position
   * marker, not a reference to a live mission — if the cursor mission was
   * evicted, pagination simply resumes from the next position.
   *
   * Ownership: a caller sees ONLY their own missions. Cross-caller isolation
   * is enforced by filtering on rt.callerId === caller.callerId BEFORE
   * building summaries. A caller cannot enumerate or infer the existence of
   * another caller's missions.
   *
   * Authorization: if the caller lacks 'mission:read' (or any operations
   * constraint), the list is still filtered to their own missions. The
   * allowedOperations check is intentionally NOT applied here (it is applied
   * at submission time); listing one's own missions is a read-only
   * observability operation that does not require an explicit operation grant
   * beyond authentication.
   *
   * @param caller - authenticated caller identity (ownership filter)
   * @param options - pagination options
   * @returns filtered, paginated mission summaries
   */
  listMissions(
    caller: CallerIdentity,
    options: { readonly limit?: number; readonly cursor?: string } = {},
  ): MissionListResult {
    // Bounded page size. Default 10, hard cap 100, floor 1.
    const requestedLimit = options.limit ?? 10;
    const limit = Math.max(1, Math.min(100, Math.trunc(requestedLimit)));
    const cursor = options.cursor;

    // G7-15B: collect from BOTH the in-process registry AND the durable
    // history index. Dedupe by missionId (in-process wins for active
    // missions; history fills the gap for terminal missions evicted from
    // the in-process registry OR recovered from a prior process).
    // Ownership filter is applied to BOTH sources.
    const seen = new Set<string>();
    const owned: Array<{
      missionId: string;
      acceptedAt: string;
      summary: MissionListSummary;
    }> = [];

    // In-process registry first (active + recent terminal missions).
    for (const [missionId, rt] of this.missions) {
      if (rt.callerId !== caller.callerId) continue;
      if (seen.has(missionId)) continue;
      seen.add(missionId);
      owned.push({
        missionId,
        acceptedAt: rt.acceptedAt,
        summary: this.toListSummary(rt),
      });
    }

    // History index (terminal + recovered missions NOT in the in-process registry).
    for (const [missionId, record] of this.historyIndex) {
      if (record.callerId !== caller.callerId) continue;
      if (seen.has(missionId)) continue;
      seen.add(missionId);
      owned.push({
        missionId,
        acceptedAt: record.acceptedAt,
        summary: this.historyRecordToListSummary(record),
      });
    }

    // Deterministic sort: descending acceptedAt, then descending missionId.
    // acceptedAt is an ISO string set by start() — lexicographic descending
    // sorts newest-first. missionId (UUID) is the stable tiebreaker.
    owned.sort((a, b) => {
      if (a.acceptedAt !== b.acceptedAt) {
        return a.acceptedAt > b.acceptedAt ? -1 : 1;
      }
      return a.missionId > b.missionId ? -1 : a.missionId < b.missionId ? 1 : 0;
    });

    // Find the starting position based on the cursor.
    // The cursor is the missionId of the last item on the PREVIOUS page.
    // We start AFTER that missionId. If the cursor mission was evicted
    // (no longer in the registry), we scan for the first mission that sorts
    // strictly before it — that's where the next page begins.
    let startIndex = 0;
    if (cursor !== undefined && cursor.length > 0) {
      // Find the cursor's position in the sorted list.
      const cursorIdx = owned.findIndex((o) => o.missionId === cursor);
      if (cursorIdx >= 0) {
        startIndex = cursorIdx + 1;
      } else {
        // Cursor mission was evicted (or invalid). We don't have the cursor
        // mission's acceptedAt (it's no longer in the registry), so we cannot
        // determine the exact resume position in the (acceptedAt-desc,
        // missionId-desc) sort order. Safest deterministic fallback: return
        // an empty page with nextCursor=null. The caller restarts pagination
        // from the beginning. This avoids inventing a position or returning
        // duplicate records.
        return { missions: [], nextCursor: null };
      }
    }

    // Slice the page.
    const page = owned.slice(startIndex, startIndex + limit);

    // Build summaries (redacted view — no MissionResult, no failure details).
    const missions: MissionListSummary[] = page.map((o) => o.summary);

    // Compute next cursor: the missionId of the last item, if there are more.
    const hasMore = startIndex + limit < owned.length;
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].missionId : null;

    return { missions, nextCursor };
  }

  /**
   * Build a redacted {@link MissionListSummary} from an internal MissionRuntime.
   * Omits MissionResult, failure details, and idempotency key. Truncates and
   * scrubs the goal outcome for safe display.
   */
  private toListSummary(rt: MissionRuntime): MissionListSummary {
    const outcomePreview = scrubSecrets(rt.goalOutcome, 120);
    return {
      missionId: rt.missionId,
      status: rt.status,
      terminal: isTerminal(rt.status),
      acceptedAt: rt.acceptedAt,
      ...(rt.finishedAt !== undefined ? { finishedAt: rt.finishedAt } : {}),
      ...(rt.label !== undefined ? { label: rt.label } : {}),
      outcomePreview,
    };
  }

  /**
   * Get the event stream for a mission. Enforces caller isolation.
   * Returns up to `limit` events starting from `fromSeq`.
   *
   * G7-15B: for missions recovered from the durable history index (not in
   * the in-process registry), the event stream is NOT available — the
   * in-process recorder is gone after restart. Return an empty array
   * (truthful: no events to replay) rather than throwing. The caller can
   * distinguish "mission exists but no events" from "mission not found"
   * via the GET /v1/missions/{id} endpoint, which returns the snapshot.
   */
  getEvents(
    missionId: string,
    caller: CallerIdentity,
    fromSeq = 0,
    limit = 100,
  ): MissionEventRecord[] {
    const rt = this.missions.get(missionId);
    if (rt !== undefined) {
      if (rt.callerId !== caller.callerId) {
        throw new MissionNotFoundError(missionId);
      }
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
    // G7-15B: recovered mission — event stream not available after restart.
    const record = this.historyIndex.get(missionId);
    if (record === undefined) {
      throw new MissionNotFoundError(missionId);
    }
    if (record.callerId !== caller.callerId) {
      throw new MissionNotFoundError(missionId);
    }
    return []; // truthful: no events to replay
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
    const rt = this.missions.get(missionId);
    if (rt !== undefined) {
      if (rt.callerId !== caller.callerId) {
        throw new MissionNotFoundError(missionId);
      }
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

    // G7-15B: mission not in the in-process registry — consult the history
    // index. Return the persisted artifact metadata (path + verified + bytes)
    // WITHOUT content (the workspace is gone after restart). This is truthful:
    // the paths and verification status are durable; the content is not.
    const record = this.historyIndex.get(missionId);
    if (record === undefined) {
      throw new MissionNotFoundError(missionId);
    }
    if (record.callerId !== caller.callerId) {
      throw new MissionNotFoundError(missionId);
    }
    const historyArtifacts: MissionArtifactRecord[] = [];
    if (record.artifacts !== undefined) {
      for (const a of record.artifacts) {
        historyArtifacts.push({
          workerId: 'recovered', // the original workerId is not persisted
          path: a.path,
          // content is NOT available after restart — the workspace is gone.
          // Return undefined; the caller sees the path + verified + bytes.
          verified: a.verified,
          bytes: a.bytes,
        });
      }
    }
    return historyArtifacts;
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
    // G7-15B-H1: if the terminal persistence write failed, append a truthful
    // note to the failureMessage so the caller can observe that the durable
    // record does NOT confirm the in-process result. The in-process status
    // is still the real outcome (SUCCEEDED/FAILED/etc.) — we do NOT change
    // it. The note is appended (not replacing) so the original failure
    // message (if any) is preserved.
    let failureMessage = rt.failureMessage;
    if (rt.persistenceFailed === true) {
      const note = ' [persistence warning: the durable history record does not confirm this outcome; on restart, this mission will be recovered as OUTCOME_UNCONFIRMED]';
      failureMessage = failureMessage !== undefined ? failureMessage + note : note;
    }
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
      failureMessage,
      idempotencyKey: rt.idempotencyKey,
    };
  }

  // -------------------------------------------------------------------------
  // G7-15B — Durable mission history helpers
  // -------------------------------------------------------------------------

  /**
   * G7-15B: load all persisted history records at construction time and
   * recover non-terminal records truthfully.
   *
   * Recovery semantics (G7-15B-H1):
   *   - Records with a terminal status (SUCCEEDED / FAILED / PARTIAL /
   *     CANCELLED / OUTCOME_UNCONFIRMED) are loaded as-is — they truthfully
   *     represent the mission's durable outcome.
   *   - Records with a non-terminal status (ACCEPTED / RUNNING /
   *     CANCELLATION_REQUESTED) represent missions whose last durable write
   *     happened before the mission reached a confirmed terminal state. The
   *     mission MAY have completed successfully before the process stopped
   *     (if the terminal write failed) OR may have been genuinely interrupted
   *     (if the process crashed mid-execution). Without a separate heartbeat
   *     mechanism, we CANNOT distinguish these two cases. The truthful
   *     representation is OUTCOME_UNCONFIRMED — NOT FAILED. We do NOT claim
   *     the mission failed when the only established fact is that the final
   *     outcome cannot be recovered.
   *
   * Never invent success: the recovery path does NOT fabricate artifacts,
   * verification, or a MissionResult. The OUTCOME_UNCONFIRMED record carries
   * no resultStatus, no resultSummary, no artifacts — the outcome is unknown.
   *
   * The rewrite is persisted (atomic) so subsequent restarts see
   * OUTCOME_UNCONFIRMED, not the pre-crash non-terminal status.
   */
  private recoverHistory(): void {
    if (this.historyStore === null) return;
    let records: Map<string, MissionHistoryRecord>;
    try {
      records = this.historyStore.loadAll();
    } catch (err) {
      structuredLog('warn', 'history_recovery', `failed to load mission history: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    structuredLog('info', 'history_recovery', `loaded ${records.size} mission record(s) from disk`);
    let recoveredCount = 0;
    for (const [missionId, record] of records) {
      if (isTerminal(record.status)) {
        // Terminal record — load as-is.
        this.historyIndex.set(missionId, record);
      } else {
        // G7-15B-H1: non-terminal record — the mission's outcome could NOT
        // be confirmed. We do NOT claim the mission failed (it may have
        // completed successfully before the process stopped). Represent as
        // OUTCOME_UNCONFIRMED — a terminal status that truthfully
        // communicates "outcome unknown" without claiming success or failure.
        const recovered: MissionHistoryRecord = {
          schemaVersion: MISSION_HISTORY_SCHEMA_VERSION,
          missionId: record.missionId,
          callerId: record.callerId,
          ...(record.label !== undefined ? { label: record.label } : {}),
          ...(record.idempotencyKey !== undefined ? { idempotencyKey: record.idempotencyKey } : {}),
          status: 'OUTCOME_UNCONFIRMED',
          acceptedAt: record.acceptedAt,
          finishedAt: new Date().toISOString(),
          goalOutcome: record.goalOutcome,
          // NO resultStatus / resultSummary / cost — the outcome is unknown;
          // we do NOT fabricate a MissionResult.
          failureClass: 'OUTCOME_UNCONFIRMED',
          failureMessage: 'mission outcome could not be confirmed after restart; the last durable record was non-terminal',
          recoveredFromInterruption: true,
        };
        // Persist the recovery so subsequent restarts see OUTCOME_UNCONFIRMED.
        try {
          this.historyStore.write(recovered);
        } catch (err) {
          console.error(
            `[mission-service] WARN: failed to persist recovery for ${missionId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        this.historyIndex.set(missionId, recovered);
        recoveredCount++;
      }
    }
    if (recoveredCount > 0) {
      structuredLog('warn', 'history_recovery', `recovered ${recoveredCount} interrupted mission(s) as OUTCOME_UNCONFIRMED`);
    }
  }

  /**
   * G7-15B: persist a terminal mission record (atomic rewrite-by-id). Called
   * from the runPromise.then() and .catch() handlers. Builds the record from
   * the in-process MissionRuntime + the captured verification result + the
   * artifact metadata. Also adds the record to the in-memory historyIndex
   * so subsequent get() calls (after the in-process registry evicts the
   * mission) can still return a snapshot.
   *
   * No secrets: the goalOutcome and failureMessage are scrubbed before
   * persistence. The record does NOT store the full MissionResult.evidence
   * (which could contain tool output) — only the summary, status, and cost.
   */
  private persistTerminal(rt: MissionRuntime): void {
    if (this.historyStore === null) return;
    if (!isTerminal(rt.status)) return; // safety: only persist terminal states
    try {
      // Build artifact metadata (paths + verified flags + bytes; NO content).
      const artifacts: Array<{ path: string; verified: boolean; bytes: number }> = [];
      const provider = rt.runtime as (WorkerRuntime & Partial<ArtifactsProvider>) | undefined;
      if (provider && typeof provider.listArtifacts === 'function') {
        // Async listArtifacts is not awaited here (this method is sync). We
        // read from the captured verifiedPaths set + the legacy computers Map.
        // The provider's listArtifacts was already awaited in
        // captureVerificationResult; the verifiedPaths set reflects it.
      }
      // Legacy dev-path fallback (MemoryComputer.files) — synchronous.
      for (const [workerId, computer] of rt.computers) {
        if (workerId === 'mission-verifier-1' || workerId.startsWith('mission-verifier')) {
          continue;
        }
        for (const [path, content] of computer.files) {
          if (path.includes('..') || path.startsWith('/')) continue;
          artifacts.push({
            path,
            verified: (rt.verificationOk ?? false) && (rt.verifiedPaths ?? new Set()).has(path),
            bytes: content.length,
          });
        }
      }

      const record: MissionHistoryRecord = {
        schemaVersion: MISSION_HISTORY_SCHEMA_VERSION,
        missionId: rt.missionId,
        callerId: rt.callerId,
        ...(rt.label !== undefined ? { label: rt.label } : {}),
        ...(rt.idempotencyKey !== undefined ? { idempotencyKey: rt.idempotencyKey } : {}),
        status: rt.status,
        acceptedAt: rt.acceptedAt,
        ...(rt.finishedAt !== undefined ? { finishedAt: rt.finishedAt } : {}),
        goalOutcome: scrubSecrets(rt.goalOutcome, 10_000),
        ...(rt.result !== undefined ? {
          resultSummary: scrubSecrets(rt.result.summary, 1_000),
          resultStatus: rt.result.status,
          costUsd: rt.result.cost.usd,
          costTokens: rt.result.cost.tokens,
          costWallMs: rt.result.cost.wallMs,
          costHumanInterventions: rt.result.cost.humanInterventions,
        } : {}),
        ...(rt.failureClass !== undefined ? { failureClass: rt.failureClass } : {}),
        ...(rt.failureMessage !== undefined ? { failureMessage: rt.failureMessage } : {}),
        ...(artifacts.length > 0 ? { artifacts } : {}),
      };
      this.historyStore.write(record);
      // G7-15B-H1: the write succeeded — the record is durably confirmed.
      // Add it to the in-memory historyIndex so subsequent get() calls
      // (after the in-process registry evicts the mission) return the
      // confirmed terminal snapshot.
      this.historyIndex.set(rt.missionId, record);
    } catch (err) {
      // G7-15B-H1: the terminal write FAILED. We must NOT silently present
      // the in-process result as durably confirmed. Mark the runtime so the
      // snapshot reflects the persistence failure — the in-process result
      // is still the real outcome (SUCCEEDED/FAILED/etc.), but the caller
      // can observe that the durable record does NOT confirm it.
      //
      // We do NOT add a false terminal record to historyIndex. The stale
      // non-terminal record (from the initial write in start()) remains on
      // disk. On restart, recoverHistory() will see the non-terminal record
      // and recover it as OUTCOME_UNCONFIRMED (not as a confirmed failure).
      // This is the truthful behavior: we do NOT know the mission failed;
      // we only know the durable record does not confirm the outcome.
      rt.persistenceFailed = true;
      structuredLog('warn', 'history', `failed to persist terminal record: ${err instanceof Error ? err.message : String(err)}. Outcome not durably confirmed; will recover as OUTCOME_UNCONFIRMED.`, { missionId: rt.missionId });
    }
  }

  /**
   * G7-15B: build a MissionSnapshot from a recovered/persisted history record.
   * The `result` field is reconstructed from the persisted `resultSummary` +
   * `resultStatus` + `cost` fields — the full evidence array is NOT persisted.
   *
   * G7-15B-H1: for OUTCOME_UNCONFIRMED records, the `result` field is
   * `undefined` — we do NOT fabricate a MissionResult. The `failureClass`
   * and `failureMessage` carry the truthful "outcome unknown" message.
   */
  private historyRecordToSnapshot(record: MissionHistoryRecord): MissionSnapshot {
    const status = record.status as MissionStatus;
    // G7-15B-H1: OUTCOME_UNCONFIRMED records have no resultStatus — the
    // outcome is unknown; we do NOT fabricate a MissionResult.
    const result = record.resultStatus !== undefined ? {
      status: record.resultStatus,
      summary: record.resultSummary ?? '',
      evidence: [],
      cost: {
        usd: record.costUsd ?? 0,
        tokens: record.costTokens ?? 0,
        wallMs: record.costWallMs ?? 0,
        humanInterventions: record.costHumanInterventions ?? 0,
      },
    } : undefined;
    return {
      missionId: record.missionId,
      callerId: record.callerId,
      label: record.label,
      status,
      terminal: isTerminal(status),
      acceptedAt: record.acceptedAt,
      finishedAt: record.finishedAt,
      goalOutcome: record.goalOutcome,
      ...(result !== undefined ? { result } : {}),
      ...(record.failureClass !== undefined ? { failureClass: record.failureClass } : {}),
      ...(record.failureMessage !== undefined ? { failureMessage: record.failureMessage } : {}),
      ...(record.idempotencyKey !== undefined ? { idempotencyKey: record.idempotencyKey } : {}),
    };
  }

  /**
   * G7-15B: build a MissionListSummary from a recovered/persisted history record.
   * Omits MissionResult, failure details, and idempotency key (same as
   * toListSummary). Truncates the goal outcome for safe display.
   */
  private historyRecordToListSummary(record: MissionHistoryRecord): MissionListSummary {
    const status = record.status as MissionStatus;
    return {
      missionId: record.missionId,
      status,
      terminal: isTerminal(status),
      acceptedAt: record.acceptedAt,
      ...(record.finishedAt !== undefined ? { finishedAt: record.finishedAt } : {}),
      ...(record.label !== undefined ? { label: record.label } : {}),
      outcomePreview: scrubSecrets(record.goalOutcome, 120),
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

  private buildChecks(
    context: {
      artifacts: ReadonlyArray<ArtifactSource>;
    },
    callerCriteria?: readonly AcceptanceCheckInput[],
  ): readonly AcceptanceCheck[] {
    // Structural floor: every produced artifact must exist in the clean-room
    // copy. This is the baseline verification that always applies.
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

    // G7-11 (FM-07/FM-08): merge caller-supplied acceptance criteria.
    // These are goal-satisfaction checks (exact filename, required content,
    // hash match) that go beyond the structural floor. They are evaluated
    // by the existing VerificationLoop — no new verification engine.
    //
    // G7-11B fix: caller-supplied `file` and `hash-match` checks use a
    // workspace-relative path (e.g., 'genesis_demo.md'), but the verification
    // clean-room copy stores artifacts under 'artifacts/<workerId>/<path>'.
    // We expand each caller `file`/`hash-match` check into one check per
    // artifact source that produced a matching path. This lets the caller
    // specify the logical filename without knowing the internal clean-room
    // layout. If no source produced the path, the check is emitted as-is
    // (it will fail honestly — file not found).
    if (callerCriteria !== undefined) {
      for (const c of callerCriteria) {
        if (c.kind === 'file') {
          // Find artifact sources that produced this path.
          const matchingSources = context.artifacts.filter((s) =>
            s.paths.some((p) => p === c.path),
          );
          if (matchingSources.length > 0) {
            // Emit one check per matching source (clean-room path).
            for (const source of matchingSources) {
              checks.push({
                kind: 'file',
                label: c.label,
                path: cleanRoomPath(source, c.path),
                ...(c.expectIncludes !== undefined ? { expectIncludes: c.expectIncludes } : {}),
              });
            }
          } else {
            // No source produced this path — emit as-is; it will fail honestly.
            checks.push({
              kind: 'file',
              label: c.label,
              path: c.path,
              ...(c.expectIncludes !== undefined ? { expectIncludes: c.expectIncludes } : {}),
            });
          }
        } else if (c.kind === 'content-in-artifacts') {
          checks.push({
            kind: 'content-in-artifacts',
            label: c.label,
            expectIncludes: c.expectIncludes,
          });
        } else if (c.kind === 'hash-match') {
          // Same expansion as `file` — find matching sources.
          const matchingSources = context.artifacts.filter((s) =>
            s.paths.some((p) => p === c.path),
          );
          if (matchingSources.length > 0) {
            for (const source of matchingSources) {
              checks.push({
                kind: 'hash-match',
                label: c.label,
                path: cleanRoomPath(source, c.path),
                expectHash: c.expectHash,
              });
            }
          } else {
            checks.push({
              kind: 'hash-match',
              label: c.label,
              path: c.path,
              expectHash: c.expectHash,
            });
          }
        }
      }
    }

    if (checks.length === 0) {
      // No artifacts produced AND no caller criteria — the mission must have
      // at least one deliverable to be considered successful. Add a check
      // that will fail honestly (no file at the expected path).
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
    workspaceDir?: string;
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
      // MemoryRuntime has no disk workspace — workspaceDir is undefined.
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
