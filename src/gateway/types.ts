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
  | 'CANCELLED';

/**
 * The terminal states. After a mission reaches one of these, its status
 * is immutable.
 */
export const TERMINAL_STATES: readonly MissionStatus[] = [
  'SUCCEEDED',
  'FAILED',
  'PARTIAL',
  'CANCELLED',
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
 * An artifact descriptor returned by GET /v1/missions/{id}/artifacts.
 * Resolves to actual produced content (not a placeholder).
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
    default:
      return 0; // UNSPECIFIED
  }
}

/**
 * Evidence kind type re-exported for gateway consumers.
 */
export type { Evidence, MissionCost };
