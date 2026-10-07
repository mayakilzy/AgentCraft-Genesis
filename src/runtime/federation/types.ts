/**
 * G6-02 — A2A Federation types.
 *
 * Genesis-side contracts for federating bounded work to an independent
 * external A2A agent. These types are the EDGE boundary: internal
 * Genesis workers never see them; only the FederationService (and the
 * optional caller — the orchestrator or a worker with federation
 * capability) consumes them.
 *
 * Per Section 1: A2A lives at the EDGE of Genesis. It does NOT replace
 * internal organization semantics, internal handoffs, or WorkerGenome.
 *
 * Per Section 17: external agents are NOT internal Workers. The
 * ExternalAgent type preserves enough information for endpoint identity,
 * declared capabilities, evidence provenance, and failure attribution
 * WITHOUT silently converting an external agent into a WorkerGenome.
 *
 * Per Section 23: A2A RESULT ≠ VERIFIED GENESIS FACT. FederationResult
 * carries the external agent's reported status and result; Genesis
 * verification remains authoritative.
 */

import type { Evidence } from '../../contracts/core.js';
import type { FailureClass } from '../../mission/failure-class.js';

/**
 * A known external A2A agent. Constructed from the agent's AgentCard
 * (fetched via the SDK's DefaultAgentCardResolver) plus the endpoint
 * URL Genesis used to reach it.
 *
 * Identity preservation (Section 17): the external agent has an `id`
 * (derived from the endpoint URL — stable per endpoint), a `name`
 * (from the AgentCard), an `endpoint` (the base URL Genesis used to
 * reach it), and optional `declaredSkills` (from the AgentCard).
 *
 * This is NOT a WorkerGenome. It does not participate in internal
 * handoffs; it does not receive a task brief; it does not run inside
 * Genesis. It is an opaque peer that the FederationService communicates
 * with over A2A.
 */
export interface ExternalAgent {
  /** Stable id derived from the endpoint URL (e.g. "ext:a2a:http://127.0.0.1:4173"). */
  readonly id: string;
  /** Human-readable name from the AgentCard. */
  readonly name: string;
  /** The base URL Genesis used to fetch the AgentCard. */
  readonly endpoint: string;
  /** Skills declared in the AgentCard (id + name + description). Empty when the card declares none. */
  readonly declaredSkills: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly description: string;
  }>;
  /** Protocol version reported by the AgentCard (e.g. "1.0.0"). */
  readonly protocolVersion?: string;
}

/**
 * A bounded delegation request from Genesis to an external A2A agent.
 *
 * The request carries:
 *   - the target external agent (already discovered);
 *   - the task text (the bounded work to delegate);
 *   - optional constraints (echoed into the message metadata);
 *   - optional timeoutMs (bounded delegation per Section 25);
 *   - optional AbortSignal (local mission cancellation per Section 25).
 *
 * The request does NOT carry Genesis-internal state (worker scratchpads,
 * chain-of-thought, internal handoff context). Per Section 41: no
 * chain-of-thought crosses the federation boundary.
 */
export interface FederationRequest {
  /** The external agent to delegate to. */
  readonly agent: ExternalAgent;
  /** The bounded task text. */
  readonly task: string;
  /** Optional constraints echoed into the message metadata. */
  readonly constraints?: readonly string[];
  /** Delegation timeout in milliseconds (default 30,000). */
  readonly timeoutMs?: number;
  /** Local mission cancellation signal. */
  readonly signal?: AbortSignal;
  /** Mission id (for flight-event provenance). */
  readonly missionId?: string;
}

/**
 * The terminal status of a federated delegation. Mirrors the A2A
 * TaskState terminal states plus Genesis-side failure modes.
 *
 * `completed` — the remote task reached TASK_STATE_COMPLETED and
 *   returned a result. NOTE: per Section 23, this is the EXTERNAL
 *   agent's claim; Genesis verification is authoritative.
 * `failed` — the remote task reached TASK_STATE_FAILED or
 *   TASK_STATE_REJECTED, OR the federation itself failed (connection,
 *   protocol, malformed response).
 * `canceled` — the remote task reached TASK_STATE_CANCELED, OR the
 *   local mission's AbortSignal fired and the service cancelled the
 *   remote task.
 * `timed_out` — the delegation timeout elapsed before the task
 *   reached a terminal state.
 * `unknown` — the task reached an unexpected state (TASK_STATE_UNSPECIFIED
 *   or an unrecognized enum value).
 */
export type FederationStatus =
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'timed_out'
  | 'unknown';

/**
 * The result of a federated delegation. Carries provenance (Section 27),
 * the external agent's reported status, and — when status='failed'/
 * 'canceled'/'timed_out'/'unknown' — a G6-01 FailureClass (Section 24).
 *
 * CRITICAL INVARIANT (Section 23): `status='completed'` means the
 * EXTERNAL agent reported success. It does NOT mean Genesis has
 * verified the result. The caller (orchestrator or worker) MUST
 * subject `result` to Genesis verification before treating it as
 * mission truth.
 */
export interface FederationResult {
  /** The external agent that handled the delegation. */
  readonly agent: ExternalAgent;
  /** The remote task id assigned by the external agent. */
  readonly remoteTaskId: string;
  /** The terminal federation status. */
  readonly status: FederationStatus;
  /**
   * The result text extracted from the remote task's artifacts.
   * Present when status='completed' and the task produced at least
   * one text artifact. Empty string otherwise.
   */
  readonly result: string;
  /**
   * Genesis Evidence[] with provenance. Each entry has
   * `kind='artifact'`, `description` naming the external agent and
   * remote task, `location='a2a:<agentId>:<taskId>'`. This is the
   * structured form future G7 Artifacts UI will render (Section 42).
   */
  readonly evidence: readonly Evidence[];
  /**
   * G6-01 FailureClass when status != 'completed'. Undefined on
   * success. Per Section 24: reuse the G6-01 taxonomy; do not create
   * a second failure ontology for A2A.
   */
  readonly failureClass?: FailureClass;
  /** One-line failure message (scrubbed of secrets). Empty on success. */
  readonly failureMessage: string;
  /** Whether the federation itself succeeded (status='completed'). */
  readonly ok: boolean;
}

/**
 * A flight-event sink for federation events. The FederationService
 * emits structured events (Section 28) through this sink; the caller
 * wires it to the mission's FlightRecorder.
 */
export interface FederationEventSink {
  (event: FederationEvent): void;
}

/**
 * Federation flight events (Section 28). Additive to the FlightEvent
 * vocabulary; the schema is NOT frozen in G6-02 (Section 28).
 */
export type FederationEvent =
  | {
      readonly type: 'federation-delegated';
      readonly missionId?: string;
      readonly externalAgentId: string;
      readonly externalAgentName: string;
      readonly remoteTaskId: string;
      readonly taskChars: number;
    }
  | {
      readonly type: 'federation-state-change';
      readonly missionId?: string;
      readonly remoteTaskId: string;
      readonly remoteState: string;
    }
  | {
      readonly type: 'federation-result-received';
      readonly missionId?: string;
      readonly remoteTaskId: string;
      readonly status: FederationStatus;
      readonly resultChars: number;
      readonly evidenceCount: number;
    }
  | {
      readonly type: 'federation-failed';
      readonly missionId?: string;
      readonly remoteTaskId: string;
      readonly failureClass: string;
      readonly message: string;
    }
  | {
      readonly type: 'federation-cancelled';
      readonly missionId?: string;
      readonly remoteTaskId: string;
      readonly reason: string;
    };

/**
 * Build an ExternalAgent id from an endpoint URL. Stable per endpoint:
 * the same URL always produces the same id. This is NOT a UUID — it
 * is a deterministic derivation so flight events and artifact records
 * can be correlated across missions.
 */
export function externalAgentId(endpoint: string): string {
  return `ext:a2a:${endpoint}`;
}

/**
 * Build a FederationResult for a successful delegation.
 */
export function buildSuccessResult(
  agent: ExternalAgent,
  remoteTaskId: string,
  result: string,
  missionId?: string,
): FederationResult {
  const evidence: Evidence[] = result.length === 0 ? [] : [
    {
      kind: 'artifact',
      description: `External A2A agent "${agent.name}" (${agent.id}) delivered result for remote task ${remoteTaskId}`,
      location: `a2a:${agent.id}:${remoteTaskId}`,
    },
  ];
  void missionId; // missionId is carried by the flight event, not the evidence
  return {
    agent,
    remoteTaskId,
    status: 'completed',
    result,
    evidence,
    failureMessage: '',
    ok: true,
  };
}

/**
 * Build a FederationResult for a failed delegation.
 */
export function buildFailureResult(
  agent: ExternalAgent,
  remoteTaskId: string,
  status: FederationStatus,
  failureClass: FailureClass,
  failureMessage: string,
): FederationResult {
  return {
    agent,
    remoteTaskId,
    status,
    result: '',
    evidence: [],
    failureClass,
    failureMessage: failureMessage.slice(0, 300),
    ok: false,
  };
}
