/**
 * AgentCraft Genesis G7 — Verified Gateway Type Contracts
 *
 * These types mirror the public gateway contract verified at pinned SHA
 * bff7b0a6f8b4e35880a9c7453d4e6de343e4e001 (branch build/group-06-productionization).
 *
 * Source-of-truth:
 *   - experiments/g6-05a/gateway-contract.md
 *   - src/gateway/types.ts (verified line-by-line)
 *   - src/contracts/core.ts (MissionResult, MissionCost, Evidence)
 *
 * Rule: every field below has a verified backend source. No invented routes,
 * payloads, fields, event names, authorization or persistence.
 *
 * Per 04_GATEWAY_DISCOVERY_AND_ADAPTER_CONTRACT.md, the typed UI adapter returns
 * discriminated results: ok | unsupported | unauthorized | unavailable | uncertain | error.
 */

// ---------------------------------------------------------------------------
// Mission lifecycle (src/gateway/types.ts:41-63)
// ---------------------------------------------------------------------------

export type MissionStatus =
  | "ACCEPTED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "PARTIAL"
  | "CANCELLATION_REQUESTED"
  | "CANCELLED";

export const TERMINAL_STATES: readonly MissionStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "PARTIAL",
  "CANCELLED",
];

export function isTerminalStatus(status: MissionStatus): boolean {
  return TERMINAL_STATES.includes(status);
}

// ---------------------------------------------------------------------------
// Mission result (src/contracts/core.ts:340-353)
// ---------------------------------------------------------------------------

export interface Evidence {
  readonly kind: "artifact" | "log" | "test-run" | "metric";
  readonly description: string;
  readonly location: string;
}

export interface MissionCost {
  readonly usd: number;
  readonly tokens: number;
  readonly wallMs: number;
  readonly humanInterventions: number;
}

export interface MissionResult {
  readonly status: "success" | "partial" | "failure";
  readonly summary: string;
  readonly evidence: readonly Evidence[];
  readonly cost: MissionCost;
}

// ---------------------------------------------------------------------------
// Mission snapshot (src/gateway/types.ts:98-123)
// ---------------------------------------------------------------------------

export interface MissionSnapshot {
  readonly missionId: string;
  readonly callerId: string;
  readonly label?: string;
  readonly status: MissionStatus;
  readonly terminal: boolean;
  readonly acceptedAt: string;
  readonly finishedAt?: string;
  readonly goalOutcome: string;
  readonly result?: MissionResult;
  readonly failureClass?: string;
  readonly failureMessage?: string;
  readonly idempotencyKey?: string;
}

// ---------------------------------------------------------------------------
// Mission event (src/gateway/types.ts:130-139)
// ---------------------------------------------------------------------------

export interface MissionEventRecord {
  readonly seq: number;
  readonly timestamp: string;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Mission list (G7-10 — src/gateway/types.ts:141-186)
// ---------------------------------------------------------------------------

/**
 * Compact mission summary returned by GET /v1/missions (list endpoint).
 * Redacted view of MissionSnapshot — omits MissionResult, failure details,
 * idempotency key. Contains only fields supported by authoritative state.
 */
export interface MissionListSummary {
  readonly missionId: string;
  readonly status: MissionStatus;
  readonly terminal: boolean;
  readonly acceptedAt: string;
  readonly finishedAt?: string;
  readonly label?: string;
  readonly outcomePreview: string;
}

/**
 * Result of GET /v1/missions (list endpoint). Cursor-based pagination.
 * nextCursor is the missionId of the last item; null means no more pages.
 */
export interface MissionListResult {
  readonly missions: readonly MissionListSummary[];
  readonly nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Mission artifact (src/gateway/types.ts:145-156)
// ---------------------------------------------------------------------------

export interface MissionArtifactRecord {
  readonly workerId: string;
  readonly path: string;
  readonly content?: string;
  readonly verified: boolean;
  readonly bytes: number;
}

// ---------------------------------------------------------------------------
// Mission submission (src/gateway/types.ts:69-90 + http-server.ts:310-344)
// ---------------------------------------------------------------------------

export interface MissionSubmission {
  readonly outcome: string;
  readonly context?: string;
  readonly constraints?: readonly string[];
  readonly budget?: {
    readonly maxUsd?: number;
    readonly tier?: "cheap" | "default" | "frontier";
  };
  readonly idempotencyKey?: string;
  readonly label?: string;
  /**
   * G7-11: caller-supplied acceptance criteria for goal-satisfaction verification.
   * When provided, the gateway's VerificationLoop evaluates these checks against
   * the actual produced artifacts. A missing criterion is NOT interpreted as
   * success — the structural floor (file existence) always applies.
   */
  readonly acceptanceCriteria?: readonly AcceptanceCheckInput[];
}

/**
 * G7-11: caller-supplied acceptance criteria (transport-facing shape).
 * Mirrors the engine's AcceptanceCheck union subset supported by the gateway.
 */
export type AcceptanceCheckInput =
  | { readonly kind: "file"; readonly label: string; readonly path: string; readonly expectIncludes?: string }
  | { readonly kind: "content-in-artifacts"; readonly label: string; readonly expectIncludes: string }
  | { readonly kind: "hash-match"; readonly label: string; readonly path: string; readonly expectHash: string };

// ---------------------------------------------------------------------------
// Health response (src/gateway/types.ts:257-263 + http-server.ts:93-108)
// ---------------------------------------------------------------------------

export interface HealthResponse {
  readonly status: "ok" | "degraded" | "down";
  readonly version: string;
  readonly uptimeMs: number;
  readonly activeMissions: number;
  readonly limitations: readonly string[];
}

// ---------------------------------------------------------------------------
// Gateway error (src/gateway/types.ts:246-252 + http-server.ts:100-108, 386-407)
// ---------------------------------------------------------------------------

export type GatewayErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "ADMISSION_DENIED"
  | "MISSION_NOT_FOUND"
  | "NOT_FINISHED"
  | "INVALID_JSON"
  | "INVALID_SUBMISSION"
  | "INVALID_LIMIT"
  | "INTERNAL_ERROR"
  | "NOT_FOUND";

export interface GatewayErrorBody {
  readonly error: {
    readonly code: GatewayErrorCode;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

// ---------------------------------------------------------------------------
// Discriminated adapter result (04_GATEWAY_DISCOVERY_AND_ADAPTER_CONTRACT.md)
// ---------------------------------------------------------------------------

export type AdapterResultKind =
  | "ok"
  | "unsupported"
  | "unauthorized"
  | "unavailable"
  | "uncertain"
  | "error";

export interface AdapterResult<T> {
  readonly kind: AdapterResultKind;
  readonly data?: T;
  readonly status?: number;
  readonly code?: GatewayErrorCode;
  readonly message?: string;
  /** Raw response body for debugging (sanitized server-side, never returned to client verbatim). */
  readonly raw?: unknown;
  /** ISO timestamp when the result was received by the UI adapter. */
  readonly receivedAt: string;
}

// ---------------------------------------------------------------------------
// Submission ack (http-server.ts:166-177)
// ---------------------------------------------------------------------------

export interface MissionSubmissionAck {
  readonly missionId: string;
  readonly status: MissionStatus;
  readonly accepted: true;
  readonly links: {
    readonly self: string;
    readonly events: string;
    readonly result: string;
    readonly artifacts: string;
    readonly cancel: string;
  };
}

// ---------------------------------------------------------------------------
// Cancel ack (http-server.ts:230-233)
// ---------------------------------------------------------------------------

export interface MissionCancelAck {
  readonly missionId: string;
  readonly status: MissionStatus;
  readonly cancelRequested: true;
}
