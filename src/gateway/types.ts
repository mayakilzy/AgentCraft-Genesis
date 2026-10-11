/**
 * G6-05A — Gateway shared types.
 *
 * Transport-neutral mission lifecycle contracts shared by the HTTP
 * Service API and the inbound A2A server. Both transports delegate to
 * the same MissionService; these types are the public contract.
 *
 * Invariants (Section 6):
 *   - A mission receives a stable identifier.
 *   - Terminal state is immutable.
 *   - A verified failure cannot become success through transport translation.
 *   - A missing artifact cannot be reported as completed output.
 *   - Cancellation request is not automatically cancellation completion.
 *   - Mission state and event history remain consistent.
 *
 * These types do NOT replace MissionResult (which stays frozen at
 * src/contracts/core.ts). They layer a transport-facing runtime status
 * on top of the terminal MissionResult.
 */
import type {
  Evidence,
  Goal,
  MissionCost,
  MissionResult,
} from '../contracts/core.js';

/**
 * External mission lifecycle states. Transport-neutral.
 *
 * Mapped to internal orchestrator behavior:
 *   ACCEPTED              — MissionService.start() returned a missionId; orchestrator not yet running.
 *   RUNNING              — orchestrator.run() in flight (workers executing).
 *   SUCCEEDED            — orchestrator returned MissionResult.status='success'.
 *   FAILED               — orchestrator returned MissionResult.status='failure'.
 *   PARTIAL              — orchestrator returned MissionResult.status='partial' (deliverable produced, verification incomplete).
 *   CANCELLATION_REQUESTED — cancel() called; AbortController signaled; orchestrator may still be unwinding.
 *   CANCELLED            — orchestrator returned after cancellation; no deliverable.
 *   OUTCOME_UNCONFIRMED  — G7-15B-H1: the mission's terminal outcome could NOT be
 *                          confirmed after a gateway restart. The last durable
 *                          record was non-terminal (ACCEPTED/RUNNING/CANCELLATION_REQUESTED),
 *                          which means the mission MAY have completed successfully
 *                          before the process stopped — but the terminal write
 *                          either failed or never happened. This status does NOT
 *                          claim success, failure, partial, or cancellation; it
 *                          truthfully communicates "outcome unknown." It is
 *                          terminal (the mission is no longer active) but carries
 *                          no MissionResult (the result is not durably confirmed).
 *
 * WAITING_FOR_APPROVAL is NOT advertised (no human-approval hook is wired through the gateway in v1).
 */
export type MissionStatus =
  | 'ACCEPTED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'PARTIAL'
  | 'CANCELLATION_REQUESTED'
  | 'CANCELLED'
  | 'OUTCOME_UNCONFIRMED';

/**
 * The terminal states. After a mission reaches one of these, its status
 * is immutable.
 *
 * G7-15B-H1: OUTCOME_UNCONFIRMED is terminal — the mission is no longer
 * active (the process that was executing it is gone), but its outcome
 * is not durably confirmed.
 */
export const TERMINAL_STATES: readonly MissionStatus[] = [
  'SUCCEEDED',
  'FAILED',
  'PARTIAL',
  'CANCELLED',
  'OUTCOME_UNCONFIRMED',
];

export function isTerminal(status: MissionStatus): boolean {
  return TERMINAL_STATES.includes(status);
}

/**
 * A request to start a mission. Translated from either an HTTP POST
 * /v1/missions body or an A2A SendMessage.
 */
export interface MissionSubmission {
  /** The goal text (Goal.outcome). Required. */
  readonly outcome: string;
  /** Optional context (Goal.context). */
  readonly context?: string;
  /** Optional constraints (Goal.constraints). */
  readonly constraints?: readonly string[];
  /** Optional budget hint. */
  readonly budget?: { readonly maxUsd?: number; readonly tier?: 'cheap' | 'default' | 'frontier' };
  /**
   * Caller-supplied idempotency key. If provided, a duplicate submission
   * with the same key (while the first is in-flight OR within the
   * retention window) returns the existing missionId instead of creating
   * new work. Idempotency does NOT survive process restart (in-memory only).
   */
  readonly idempotencyKey?: string;
  /**
   * Caller-supplied mission label (for caller's own correlation). Not
   * used by Genesis for routing or authorization.
   */
  readonly label?: string;
  /**
   * G7-11 (FM-07/FM-08): caller-supplied acceptance criteria. When provided,
   * these checks are MERGED with the structural floor (file-existence checks)
   * and evaluated by the existing VerificationLoop. This is the mechanism for
   * goal-satisfaction verification: the caller specifies what the mission must
   * produce (exact filename, required content, hash match), and the verifier
   * rejects incorrect artifacts.
   *
   * This field is on the TRANSPORT type (MissionSubmission), NOT on the frozen
   * Goal contract. It flows through MissionService.buildChecks() to the
   * orchestrator's existing `checks` seam — no frozen contract modification.
   *
   * A missing acceptance criterion is NOT interpreted as success: the structural
   * floor (at least one artifact must exist) always applies. If a caller wants
   * stronger verification, they must supply explicit criteria here.
   */
  readonly acceptanceCriteria?: readonly AcceptanceCheckInput[];
  /**
   * G7-18B: caller-supplied mission input files. When provided, these files
   * are staged into every computer-bearing worker's workspace BEFORE the
   * worker starts (via the orchestrator's existing `missionInputs` staging
   * mechanism — Phase 4.8B in `src/mission/orchestrator.ts`).
   *
   * This field is on the TRANSPORT type (MissionSubmission), NOT on the frozen
   * Goal contract. The orchestrator's `missionInputs` option is the engine
   * seam; the gateway simply wires it through. No frozen contract modification.
   *
   * Paths must be safe project-relative paths (no absolute paths, no `..`
   * traversal, no Windows separators, no leading/trailing slashes). The
   * `parseSubmission()` function in `http-server.ts` validates and rejects
   * malformed paths, duplicates, conflicts, and oversized payloads. The
   * orchestrator's staging loop writes each file inside the per-worker
   * workspace directory only — the caller cannot select a workspace or
   * host path.
   */
  readonly missionInputs?: readonly MissionInputInput[];
}

/**
 * G7-11: caller-supplied acceptance criteria (transport-facing shape).
 *
 * This mirrors the engine's `AcceptanceCheck` union but is defined on the
 * transport type to avoid importing the verification module into the gateway
 * types module (and to keep the frozen `AcceptanceCheck` union untouched).
 * `MissionService.buildChecks()` converts these to engine `AcceptanceCheck`
 * instances.
 */
export type AcceptanceCheckInput =
  | { readonly kind: 'file'; readonly label: string; readonly path: string; readonly expectIncludes?: string }
  | { readonly kind: 'content-in-artifacts'; readonly label: string; readonly expectIncludes: string }
  | { readonly kind: 'hash-match'; readonly label: string; readonly path: string; readonly expectHash: string };

/**
 * G7-18B: caller-supplied mission input file (transport-facing shape).
 *
 * Mirrors the engine's `MissionInput` (defined in `src/mission/orchestrator.ts`)
 * but lives on the transport type so the gateway types module does not import
 * the orchestrator (which depends on engine internals). `MissionService.start()`
 * converts these to engine `MissionInput` instances when wiring the orchestrator.
 *
 * `path` must be a safe project-relative path. `parseSubmission()` in
 * `http-server.ts` enforces the safety rules: no absolute paths, no `..`
 * traversal, no Windows separators, no leading/trailing slashes, no empty
 * segments, no NUL bytes, no duplicates, no parent/child conflicts. Paths
 * that survive validation are joined onto the worker's workspace directory
 * by the orchestrator's staging loop — the caller cannot select a workspace
 * or host path.
 */
export interface MissionInputInput {
  /** Workspace-relative path (e.g. "expenses.csv", "input/orders.json"). */
  readonly path: string;
  /** The authoritative file contents (UTF-8 string). */
  readonly contents: string;
}

/**
 * A snapshot of a mission at a point in time. Returned by GET /v1/missions/{id}
 * and by the A2A GetTask mapping.
 *
 * The snapshot is read-only; callers cannot mutate mission state through it.
 */
export interface MissionSnapshot {
  /** Stable mission identifier (UUID). */
  readonly missionId: string;
  /** Authenticated caller identity that submitted this mission. */
  readonly callerId: string;
  /** Caller-supplied label, if any. */
  readonly label?: string;
  /** Current lifecycle status. */
  readonly status: MissionStatus;
  /** Whether the mission has reached a terminal state. */
  readonly terminal: boolean;
  /** ISO timestamp when the mission was accepted. */
  readonly acceptedAt: string;
  /** ISO timestamp when the mission reached a terminal state, if it has. */
  readonly finishedAt?: string;
  /** Original goal outcome text (for caller correlation). */
  readonly goalOutcome: string;
  /** Terminal MissionResult, present only after the mission finishes. */
  readonly result?: MissionResult;
  /** Failure class if the mission failed (reuses G6-01 taxonomy). */
  readonly failureClass?: string;
  /** Failure message (scrubbed of secrets). */
  readonly failureMessage?: string;
  /** Optional idempotency key (echoed back for caller correlation). */
  readonly idempotencyKey?: string;
}

/**
 * A mission event in the public progress stream. Mirrors FlightEvent
 * but exposes only public-safe fields (no chain-of-thought, no secrets,
 * no internal tool payloads).
 */
export interface MissionEventRecord {
  /** Sequence number within the mission's event stream. */
  readonly seq: number;
  /** ISO timestamp. */
  readonly timestamp: string;
  /** Event type (subset of FlightEvent types). */
  readonly type: string;
  /** Public-safe payload (redacted). */
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * A compact mission summary returned by GET /v1/missions (list endpoint).
 *
 * This is a REDACTED view of {@link MissionSnapshot} suitable for listing:
 * it omits the full MissionResult, failure details, and idempotency key.
 * It contains only fields supported by existing authoritative state —
 * no invented timestamps or metadata.
 *
 * G7-10: the list endpoint is server-authoritative (reads the in-process
 * MissionService registry) but NOT restart-durable. Terminal missions are
 * evicted by sweepTerminalMissions() after the retention window.
 */
export interface MissionListSummary {
  /** Stable mission identifier (UUID). */
  readonly missionId: string;
  /** Current lifecycle status. */
  readonly status: MissionStatus;
  /** Whether the mission has reached a terminal state. */
  readonly terminal: boolean;
  /** ISO timestamp when the mission was accepted (authoritative — set at start()). */
  readonly acceptedAt: string;
  /** ISO timestamp when the mission reached a terminal state, if it has. */
  readonly finishedAt?: string;
  /** Caller-supplied label, if any (for caller correlation only). */
  readonly label?: string;
  /** Safe outcome summary (truncated; scrubbed of secrets). */
  readonly outcomePreview: string;
}

/**
 * The result of GET /v1/missions (list endpoint). Cursor-based pagination.
 *
 * The cursor is the missionId of the last item in the current page. The
 * next page starts immediately AFTER that missionId in the deterministic
 * sort order (descending acceptedAt, then descending missionId as tiebreaker).
 *
 * If nextCursor is null, there are no more pages. If a cursor is invalid
 * or points to an evicted mission, the endpoint returns an empty page
 * (NOT an error) — the caller can restart pagination from the beginning.
 */
export interface MissionListResult {
  /** Mission summaries for this page, filtered to the caller's ownership. */
  readonly missions: readonly MissionListSummary[];
  /** Cursor for the next page, or null if this is the last page. */
  readonly nextCursor: string | null;
}

/**
 * An artifact descriptor returned by GET /v1/missions/{id}/artifacts.
 * Resolves to actual produced content (not a placeholder).
 *
 * G7-19A: optional `contentHash`, `conflict`, and `conflictVersions`
 * fields are added for deterministic conflict detection. These fields
 * are OPTIONAL so existing clients continue to work unchanged (backward
 * compatibility). Provenance (`workerId`, `path`, `bytes`) is preserved
 * exactly as before.
 */
export interface MissionArtifactRecord {
  /** The worker that produced this artifact. */
  readonly workerId: string;
  /** Artifact path within the worker's workspace. */
  readonly path: string;
  /** Artifact content (when small enough to inline; otherwise omitted). */
  readonly content?: string;
  /** Whether the artifact was verified by the verification loop. */
  readonly verified: boolean;
  /** Content length in bytes. */
  readonly bytes: number;
  /**
   * G7-19A: SHA-256 hash of the artifact content (hex). Empty string when
   * content was not inlined (large files). Use this field to compare
   * versions across workers without re-hashing the inlined content.
   */
  readonly contentHash?: string;
  /**
   * G7-19A: `true` when at least one OTHER worker wrote the same `path`
   * with a DIFFERENT `contentHash`. When `true`, `conflictVersions`
   * lists every other version. When `false` (or omitted), no conflict
   * was detected — either this is the only version, or all versions
   * at this path have the same hash.
   */
  readonly conflict?: boolean;
  /**
   * G7-19A: when `conflict=true`, the list of OTHER workers' versions
   * of the same path. Each entry has the worker's id, content hash,
   * and byte size. Use this to inspect which workers disagree.
   * Omitted when `conflict=false` or when there is no conflict.
   */
  readonly conflictVersions?: ReadonlyArray<{
    readonly workerId: string;
    readonly contentHash: string;
    readonly bytes: number;
  }>;
}

/**
 * An authenticated caller identity. Constructed by the gateway's
 * authentication layer (API key verification) and passed to the
 * MissionService for authorization enforcement.
 */
export interface CallerIdentity {
  /** Stable caller id (derived from the verified API key). */
  readonly callerId: string;
  /** Operations this caller is permitted to invoke. */
  readonly allowedOperations: readonly string[];
  /** Maximum concurrent active missions for this caller. */
  readonly maxActiveMissions: number;
  /** Mission timeout ceiling (ms) this caller can request. */
  readonly maxMissionTimeoutMs: number;
}

/**
 * Gateway configuration.
 */
export interface GatewayConfig {
  /** Map of valid API keys to caller identities. */
  readonly apiKeys: ReadonlyMap<string, CallerIdentity>;
  /** HTTP Service API listen host. */
  readonly httpHost: string;
  /** HTTP Service API listen port. */
  readonly httpPort: number;
  /** A2A inbound server listen host. */
  readonly a2aHost: string;
  /** A2A inbound server listen port. */
  readonly a2aPort: number;
  /** Public base URL for the A2A server (used in the AgentCard). */
  readonly a2aBaseUrl: string;
  /** Default mission timeout (ms) when caller does not specify. */
  readonly defaultMissionTimeoutMs: number;
  /** Maximum request body size (bytes). */
  readonly maxRequestBodyBytes: number;
  /** Maximum events returned per GET /events call. */
  readonly maxEventsPerResponse: number;
  /** Agent name for the A2A AgentCard. */
  readonly agentName: string;
  /** Agent description for the A2A AgentCard. */
  readonly agentDescription: string;
}

/**
 * Error thrown when authentication fails.
 */
export class GatewayAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayAuthenticationError';
  }
}

/**
 * Error thrown when authorization fails (authenticated caller lacks
 * permission for the requested operation or resource).
 */
export class GatewayAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayAuthorizationError';
  }
}

/**
 * Error thrown when a mission is not found.
 */
export class MissionNotFoundError extends Error {
  constructor(missionId: string) {
    super(`mission not found: ${missionId}`);
    this.name = 'MissionNotFoundError';
  }
}

/**
 * Error thrown when admission control rejects a new mission.
 */
export class MissionAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissionAdmissionError';
  }
}

/**
 * Standard gateway error response body.
 */
export interface GatewayErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

/**
 * Health response (public, no auth required).
 */
export interface HealthResponse {
  readonly status: 'ok' | 'degraded' | 'down';
  readonly version: string;
  readonly uptimeMs: number;
  readonly activeMissions: number;
  readonly limitations: readonly string[];
}

/**
 * A complete MissionSubmission resolved into a Goal for the orchestrator.
 */
export function submissionToGoal(submission: MissionSubmission): Goal {
  return {
    outcome: submission.outcome,
    context: submission.context,
    constraints: submission.constraints,
    budget: submission.budget,
  };
}

/**
 * Map a MissionResult to a MissionStatus.
 *
 *   success → SUCCEEDED
 *   failure → FAILED
 *   partial → PARTIAL
 *
 * Cancellation is handled at the MissionService layer (the orchestrator's
 * signal fired before run() returned). When a canceled mission produces
 * a partial result, we preserve the PARTIAL classification (the deliverable
 * exists; verification may have been incomplete). When it produces no
 * deliverable, we classify as CANCELLED.
 */
export function statusFromResult(
  result: MissionResult,
  canceled: boolean,
): MissionStatus {
  if (canceled) {
    return result.status === 'partial' ? 'PARTIAL' : 'CANCELLED';
  }
  if (result.status === 'success') return 'SUCCEEDED';
  if (result.status === 'failure') return 'FAILED';
  return 'PARTIAL';
}

/**
 * Map a MissionStatus to the A2A TaskState numeric code.
 *
 * A2A TaskState enum (from @a2a-js/sdk):
 *   0 UNSPECIFIED, 1 SUBMITTED, 2 WORKING, 3 COMPLETED,
 *   4 FAILED, 5 CANCELED, 6 INPUT_REQUIRED, 7 REJECTED, 8 AUTH_REQUIRED
 *
 * PARTIAL maps to FAILED (not COMPLETED) because PARTIAL means "a
 * deliverable was produced but verification failed or was incomplete."
 * Mapping to COMPLETED would mislead A2A consumers into treating
 * unverified deliverables as verified success. The partial nature
 * is conveyed through the task's artifact metadata when the A2A
 * server builds the response.
 */
export function statusToA2ATaskState(status: MissionStatus): number {
  switch (status) {
    case 'ACCEPTED':
      return 1; // SUBMITTED
    case 'RUNNING':
      return 2; // WORKING
    case 'SUCCEEDED':
      return 3; // COMPLETED
    case 'FAILED':
      return 4; // FAILED
    case 'CANCELLED':
      return 5; // CANCELED
    case 'PARTIAL':
      // PARTIAL = deliverable produced but verification failed/incomplete.
      // Map to FAILED to prevent false-success consumption by A2A clients.
      return 4; // FAILED
    case 'CANCELLATION_REQUESTED':
      // Still WORKING from A2A's perspective; the cancellation is in-flight.
      return 2; // WORKING
    case 'OUTCOME_UNCONFIRMED':
      // G7-15B-H1: the mission's terminal outcome could not be confirmed
      // after a gateway restart. A2A has no "unknown" TaskState; the closest
      // truthful mapping is FAILED (NOT COMPLETED — we must NOT mislead A2A
      // consumers into treating an unconfirmed outcome as success). The
      // A2A response body carries the failureMessage which explicitly states
      // the outcome is unconfirmed, so consumers can distinguish a confirmed
      // failure from an unconfirmed outcome.
      return 4; // FAILED
    default:
      return 0; // UNSPECIFIED
  }
}

/**
 * Evidence kind type re-exported for gateway consumers.
 */
export type { Evidence, MissionCost };
