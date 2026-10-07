# G6-02 Pre-Registration

**Date:** 2026-10-07
**Mission:** G6-02 A2A Federation
**Branch:** `build/group-06-productionization` (continued from G6-01)
**Start HEAD:** `8798f83272cb14e809a0c0bdad295bf0b34e00eb` (G6-01 final)

This pre-registration is IMMUTABLE per Section 51. If observed reality
differs from what is predicted here, an observation/corrigendum will be
added; the original pre-registration will NOT be rewritten.

---

## 1. Architectural Placement (Section 1, 15, 16)

**Decision:** A2A lives at the EDGE of Genesis as a mission-level
`FederationService`. It is NOT a WorkerSurface, NOT a capability
provider, NOT a replacement for internal handoffs. Internal Genesis
workers remain Genesis workers; external agents remain external agents.

**New module:** `src/runtime/federation/` (one new module — at the
Section 46 limit).

**New files (planned):**
1. `src/runtime/federation/types.ts` — Genesis-side federation contracts
   (FederationRequest, FederationResult, ExternalAgent, etc.)
2. `src/runtime/federation/service.ts` — FederationService that wraps
   the A2A SDK ClientFactory; maps A2A Task states to Genesis
   FederationResult; emits flight events; maps failures to the G6-01
   FailureClass taxonomy.

**Modified files (planned):**
- `src/mission/flight-recorder.ts` — add `MissionEventFederation*`
  event types (additive; no schema freeze per Section 28).
- `package.json` — promote `@a2a-js/sdk` from devDependency to
  dependency (one new runtime dependency — at the Section 46 limit).
- `data/ownership.yaml` — update `external-agent-interop` decision
  from `DEFER` to `REUSE` (documentation-only change).

---

## 2. SDK Adoption (Section 12, 13, 47)

**SDK:** `@a2a-js/sdk@1.3.0` (already installed as devDependency).
**Protocol:** A2A Protocol Specification v1.0.0 (stable standard).
**Source of version evidence:** `node_modules/@a2a-js/sdk/package.json`,
`data/dependency-baseline.json` (verified 2026-10-05).

**Surface used:**
- `ClientFactory` with `JsonRpcTransportFactory` (default JSON-RPC
  transport — the canonical A2A wire protocol).
- `DefaultAgentCardResolver` for agent discovery (fetches
  `/.well-known/agent-card.json`).
- `Client.sendMessage()` for task delegation.
- `Client.getTask()` for polling task state to terminal.
- `Client.cancelTask()` for cancellation (if supported by the remote
  agent).

**NOT used:**
- `DefaultRequestHandler` / server exports (inbound federation is
  evaluated separately in Section 3 below).
- gRPC transport (adds peer dependencies; JSON-RPC is sufficient).
- Persistent stores (PostgreSQL/MySQL/SQLite — no database; the
  reference agent uses in-memory task state).
- v0.3 compat layer (v1.0 is the stable target).

---

## 3. Outbound vs Inbound Federation (Section 21)

**Outbound federation:** REQUIRED. Genesis delegates bounded work to
an external A2A agent and receives a result.

**Inbound federation:** EVALUATED.

Per Section 21, inbound federation is implemented only if:
- the SDK makes it small;
- the architecture remains clean;
- security boundary is understandable;
- it materially proves bidirectional interoperability;
- anti-bloat limits remain healthy.

**Prediction:** Inbound federation will be DEFERRED in G6-02. The
outbound path is the primary requirement (Section 20). Inbound
requires:
- A Genesis-side A2A server (DefaultRequestHandler + Express or
  similar).
- Express as a new peer dependency (anti-bloat trigger).
- A security boundary (who can call Genesis? what authentication?).
- A mapping from inbound A2A tasks to internal Genesis missions
  (a new architectural concept).

Each of these is a meaningful expansion. Per Section 21: "Outbound
federation alone may PASS G6-02 if proven correctly." Prediction:
`G6_02_STATUS = PASS_WITH_LIMITATION` with inbound deferred to
post-v1 or a later Group 6 stage.

---

## 4. Required Probes (Section 34, 36, 37, 38)

### Probe A — Successful Federation (Section 36)

**Objective:** Genesis delegates a bounded subtask to an independent
external A2A agent. The agent returns a result. Genesis records
provenance. Genesis verifies the relevant result independently.
Mission succeeds only after verification.

**External agent setup:** A bounded local reference agent
(`experiments/g6-02/reference-agent/`) running as an independent
Node.js process. The agent:
- Exposes an AgentCard at `/.well-known/agent-card.json`.
- Speaks A2A v1.0 JSON-RPC over HTTP.
- Handles `sendMessage` requests by computing a deterministic
  result (e.g., computing the SHA-256 hash of the input, or counting
  words in a string).
- Returns a `Task` with `status=completed` and an `Artifact` containing
  the result.

**Expected protocol path:**
1. Genesis `FederationService` constructs a `ClientFactory`.
2. `ClientFactory.createFromAgentCard(card)` resolves the agent card
   and creates a `Client`.
3. `Client.sendMessage({ message: { parts: [{ kind: 'text', text: '...' }] } })`
   sends the task.
4. The SDK returns a `SendMessageResult` (Message or Task).
5. If a Task is returned, `FederationService` polls `Client.getTask()`
   until the task reaches a terminal state (`completed`, `failed`,
   `canceled`).
6. `FederationService` extracts the result text and artifacts from the
   terminal Task.
7. `FederationService` returns a `FederationResult` to Genesis with
   provenance (externalAgent, remoteTaskId, status, result, evidence).
8. Genesis verification (using the existing VerificationLoop with a
   `hash-match` check from G6-01) independently verifies the result.
9. Mission succeeds only after Genesis verification passes.

**Acceptance criteria:**
- The A2A SDK is actually invoked (no in-process fake).
- The reference agent runs as an independent process.
- The federation result carries provenance (externalAgent,
  remoteTaskId).
- Genesis verification is authoritative — the mission does NOT pass
  on the external agent's success flag alone.

**Failure criteria:**
- The probe uses an in-process fake adapter that bypasses the A2A
  protocol.
- The external agent is a Genesis Worker in disguise.
- Genesis accepts the external success flag as mission success
  without independent verification.

### Probe B — Failure Probe (Section 37)

**Objective:** At least one real protocol-level failure path is proven
safe. Genesis remains truthful; no false success; failure observable;
mission state coherent.

**Predicted scenario:** The reference agent returns a `Task` with
`status=failed` (e.g., the agent refuses to handle the requested
capability, or the agent process is unavailable when the task is
polled).

**Expected behavior:**
- `FederationService` detects the failed task state.
- `FederationService` maps the failure to a `FailureClass` (likely
  `WORKER_FAILURE` or `PROVIDER_FAILURE`).
- `FederationService` returns a `FederationResult` with `ok=false` and
  the failure class.
- `FederationService` emits a `federation-failed` flight event.
- The Genesis mission fails honestly (does NOT silently become
  success).
- The flight record shows the failure class and provenance.

**Acceptance criteria:**
- The failure is observable in the flight record.
- The mission state is coherent (failure → no false success).
- The failure class is from the G6-01 taxonomy (no second ontology).

### Probe C — Trust-Boundary Probe (Section 38)

**Objective:** External A2A agent claims success BUT the returned
result does not satisfy Genesis verification. Genesis rejects or fails
verification. External success does NOT become Genesis success.

**Predicted scenario:** The reference agent returns a `Task` with
`status=completed` and an `Artifact` containing a result that is
plausible-but-wrong (e.g., the agent returns the wrong hash for the
input). Genesis verification (using the G6-01 `hash-match` check with
the known-correct hash) FAILS.

**Expected behavior:**
- `FederationService` receives the external "success" result.
- `FederationService` returns a `FederationResult` with `ok=true`
  (the federation itself succeeded — the agent returned a result).
- Genesis verification runs independently and FAILS.
- The mission status is `failure` (verification failed), NOT `success`
  (federation succeeded).
- The flight record shows both the federation success AND the
  verification failure.

**Acceptance criteria:**
- External success does NOT force Genesis success.
- The verification failure is observable.
- The mission state is `failure` (not `partial` or `success`).

**This is the critical G6-02 acceptance test (Section 38).**

---

## 5. Reference Agent Design (Section 35)

**Location:** `experiments/g6-02/reference-agent/` (NOT production
code per Section 35).

**Design:**
- Single Node.js script (`server.mjs`) using `@a2a-js/sdk/server`.
- In-memory task store (no database).
- Handles three modes via a command-line flag or environment variable:
  1. `mode=success` — returns the correct deterministic result.
  2. `mode=failure` — returns a `failed` task state.
  3. `mode=trust-boundary` — returns a `completed` task with a
     wrong result (for Probe C).
- Exposes an AgentCard declaring one skill: `deterministic-compute`.
- Listens on a configurable port (default 4173).
- Independent process: spawned separately from the Genesis test
  process; communication crosses the real HTTP/JSON-RPC boundary.

**NOT part of Genesis production runtime.** The reference agent is
test infrastructure.

---

## 6. Failure Semantics Mapping (Section 24)

| A2A scenario | Genesis FailureClass |
|--------------|---------------------|
| External agent unreachable (ECONNREFUSED) | PROVIDER_FAILURE |
| AgentCard fetch fails (404, network) | PROVIDER_FAILURE |
| sendMessage SDK throws | PROVIDER_FAILURE |
| Task state = `failed` | WORKER_FAILURE |
| Task state = `canceled` | CANCELLED |
| Polling timeout (task never reaches terminal state) | TIMEOUT |
| Malformed response (missing required fields) | PROVIDER_FAILURE |
| External success with empty/unusable result | UNKNOWN_FAILURE |
| Local mission cancellation propagates to remote | CANCELLED |

Per Section 24: "Reuse the G6-01 failure taxonomy where possible. Do
not create a second failure ontology for A2A." No new failure classes
are introduced.

---

## 7. Timeout / Cancellation (Section 25)

**Delegation timeout:** `FederationService` accepts a
`timeoutMs` option (default 30,000ms). If the task does not reach a
terminal state within the timeout, the service cancels the task (if
supported) and returns a `TIMEOUT` failure.

**Remote task timeout:** The reference agent enforces its own task
timeout (e.g., 10s per task). If the agent's task times out, it
returns `status=failed` with a timeout reason.

**Local mission cancellation:** If the Genesis mission's `AbortSignal`
fires during federation, `FederationService` calls `Client.cancelTask()`
(if the task is not yet terminal) and returns a `CANCELLED` failure.

**Remote cancellation:** Supported via `Client.cancelTask()`. The
reference agent honors cancellation requests.

**Invariant (Section 25):** cancelled or timed-out remote work must
NOT later silently turn the Genesis mission into success. Verified by
Probe B.

---

## 8. Retry (Section 26)

**Conservative retry policy:** `FederationService` does NOT retry
`sendMessage` calls. Each delegation creates exactly one remote task.
If the task fails, the failure is reported truthfully.

**Rationale (Section 26):** "Avoid: duplicate remote side effects;
duplicate task creation; retry storms." A2A task creation is a side
effect on the remote agent. Retrying `sendMessage` would create a
second task, which is NOT idempotent.

**Task polling retry:** `FederationService` retries
`Client.getTask()` polls (read-only, idempotent) up to the delegation
timeout. This is safe — polling does not create side effects.

**No universal distributed idempotency infrastructure** (Section 26).
A2A task IDs (assigned by the SDK) are reused where they exist; no
custom idempotency keys.

---

## 9. Result Provenance (Section 27)

**`FederationResult` carries:**
- `externalAgent` — `ExternalAgent` record (id, name, endpoint,
  declared skills).
- `remoteTaskId` — the A2A Task ID assigned by the remote agent.
- `status` — terminal task state (`completed`, `failed`, `canceled`,
  or `unknown`).
- `result` — the result text extracted from the Task's artifacts
  (when status=completed).
- `evidence` — Genesis `Evidence[]` with `kind='artifact'`,
  `description` naming the external agent, `location` =
  `a2a:<agentId>:<taskId>`.
- `failureClass` — G6-01 `FailureClass` when status != completed.
- `failureMessage` — one-line message (scrubbed of secrets).

This is sufficient for future G7 Artifacts UI to display:
"External Agent / Acme Research Agent / Protocol A2A / Remote Task
task-123 / Status Completed / Result artifact-456 / Verification PASS"
(Section 42).

**Artifact Registry integration (G6-01):** When the federation result
includes content, `FederationService` records it in the G6-01
`ArtifactRegistry` with `provider='a2a'`, `workerId=<externalAgentId>`,
`sourceWorkerId=<delegatingWorkerId>` (lineage). This reuses existing
storage (no new technology per Section 27).

---

## 10. Observability (Section 28)

**New flight event types (additive; no schema freeze per Section 28):**

- `MissionEventFederationDelegated` — emitted when a task is delegated
  to an external agent. Fields: `missionId`, `externalAgentId`,
  `externalAgentName`, `remoteTaskId`, `taskDescription`.
- `MissionEventFederationStateChange` — emitted when a remote task
  changes state (polled or streamed). Fields: `missionId`,
  `remoteTaskId`, `remoteState`, `at`.
- `MissionEventFederationResultReceived` — emitted when a terminal
  result is received. Fields: `missionId`, `remoteTaskId`,
  `status`, `resultChars`, `evidenceCount`.
- `MissionEventFederationFailed` — emitted on failure. Fields:
  `missionId`, `remoteTaskId`, `failureClass`, `message`.
- `MissionEventFederationCancelled` — emitted on cancellation.
  Fields: `missionId`, `remoteTaskId`, `reason`.

**AG-UI relationship (Section 29):** Federation events flow through
the existing FlightRecorder → AG-UI boundary. A2A does NOT depend on
AG-UI; AG-UI is NOT responsible for federation. AG-UI observes.

---

## 11. Security (Section 39)

**Minimal security boundary:**
- Endpoint configuration: the reference agent listens on
  `http://127.0.0.1:<port>` (localhost only — no remote exposure).
- Credential handling: NO credentials are used in G6-02. The reference
  agent does not require authentication. Production A2A authentication
  (OAuth2, API keys, mTLS) is documented as a limitation.
- No secrets in events: the G6-01 secret redaction patterns apply to
  federation events. The reference agent's URL is `http://127.0.0.1`
  (not a secret).
- External input treated as untrusted: the `FederationResult.result`
  is a STRING, not structured data. Genesis verification independently
  checks the result; it does NOT trust the external agent's structure.
- Remote result treated as untrusted until validated: per Section 23,
  external success ≠ Genesis verified success. Probe C verifies this.

**NOT built (Section 39):** OAuth platform, PKI, enterprise identity
federation, global trust network.

**Production authentication limitation:** documented as
`PRODUCTION_AUTHENTICATION = UNPROVEN` in the final report.

---

## 12. Test Strategy (Section 49, 50)

**Unit tests** (`tests/runtime/federation-service.test.ts`):
- External identity mapping (ExternalAgent ← AgentCard).
- Task delegation (FederationRequest → sendMessage params).
- Status mapping (A2A TaskState → FederationResult.status).
- Result mapping (Task artifacts → FederationResult.result + evidence).
- Failure mapping (each A2A failure scenario → FailureClass).
- Timeout/cancellation semantics.
- Provenance (FederationResult carries externalAgent + remoteTaskId).
- Event emission (each transition emits the right event).
- External success ≠ Genesis verification success (mocked verification).
- Malformed result handling.
- Secret redaction (no secrets in federation events).
- Internal Worker ≠ external Agent identity.

**Integration tests** (`tests/runtime/federation-integration.test.ts`):
- Genesis ↔ adapter boundary with a stub A2A client (no real network).
- Verifies the FederationService correctly wraps the SDK Client
  interface without coupling to the wire protocol.

**Real protocol probes** (`experiments/g6-02/`):
- Probe A: success — real HTTP/JSON-RPC to the reference agent.
- Probe B: failure — real protocol-level failure path.
- Probe C: trust-boundary — external success ≠ Genesis success.

The real probes run as vitest tests that spawn the reference agent as
a child process, wait for it to be ready, run the federation, and
tear it down. They are marked `@slow` so they can be skipped in fast
CI runs.

---

## 13. Anti-Bloat Gate Final Pre-Check (Section 46)

| Gate | Limit | Planned | Status |
|------|-------|---------|--------|
| New production files | ≤ 6 | 2 (types.ts, service.ts) | PASS |
| Net new production LOC | ≤ 1,000 | ~500 | PASS |
| New production modules | ≤ 1 | 1 (src/runtime/federation/) | PASS (at limit) |
| New runtime dependencies | ≤ 1 (the A2A SDK) | 1 (@a2a-js/sdk promoted) | PASS (at limit) |
| New storage technologies | 0 | 0 (reuse JSONL + ArtifactRegistry) | PASS |
| New infrastructure services | 0 | 0 (no database, no broker) | PASS |

`ANTI_BLOAT_GATE = PASS` (planned).

---

## 14. Acceptance Criteria Self-Check (Section 54)

| # | Criterion | How G6-02 satisfies it |
|---|-----------|------------------------|
| 1 | A2A remains an edge boundary | FederationService is mission-level; internal workers unchanged |
| 2 | Internal handoffs unchanged | handoff.ts is NOT modified; FederationService is separate |
| 3 | At least one real A2A protocol path executes | Probe A uses real HTTP/JSON-RPC |
| 4 | Independent external agent participates | Reference agent runs as separate process |
| 5 | Genesis successfully delegates bounded work | Probe A verifies |
| 6 | Result provenance preserved | FederationResult carries externalAgent + remoteTaskId |
| 7 | Genesis verification remains authoritative | Probe C verifies |
| 8 | External success cannot force Genesis success | Probe C verifies |
| 9 | At least one federation failure path proven safe | Probe B verifies |
| 10 | Federation events/state observable | 5 new flight event types |
| 11 | No secret leakage | G6-01 redaction applies; reference agent uses no secrets |
| 12 | No major architecture bloat | Anti-bloat gate PASS |
| 13 | Full tests/typecheck/lint pass | Final validation |

All 13 criteria are addressed. G6-02 is expected to PASS (or
PASS_WITH_LIMITATION if inbound federation is deferred per Section 21).
