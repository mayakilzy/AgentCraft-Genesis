# GENESIS_G6_02_A2A_FEDERATION

**Date:** 2026-10-07
**Mission:** G6-02 A2A Federation
**Status:** PASS_WITH_LIMITATION
**Branch:** `build/group-06-productionization` (continued from G6-01)
**Start HEAD:** `8798f83272cb14e809a0c0bdad295bf0b34e00eb` (G6-01 final)
**Final HEAD:** (recorded at mission close)

> Central question (Section 0): CAN GENESIS COLLABORATE WITH AN
> INDEPENDENT EXTERNAL AGENT / ORGANIZATION WITHOUT COUPLING ITS
> INTERNAL WORKERS TO A2A?
>
> Answer after G6-02: YES. A2A lives at the EDGE as a mission-level
> FederationService. Internal workers remain Genesis workers; external
> agents remain external agents. External success ≠ Genesis verified
> success.

---

## 1. Architectural Placement

A2A lives at the EDGE of Genesis. It is NOT a WorkerSurface, NOT a
capability provider, NOT a replacement for internal handoffs. The
`FederationService` is a mission-level service that the orchestrator
(or a worker with federation capability) can OPTIONALLY invoke.

```
Genesis mission
     │
     ▼
FederationService (src/runtime/federation/service.ts)
     │
     ▼
A2A SDK (ClientFactory + Client)
     │
     ▼
Independent external A2A agent (reference agent or any A2A 1.0 peer)
```

**Internal Genesis organization remains unchanged:**
- Goal → Requirements → OrganizationPlanner → WorkerGenome → Workers →
  WorkerSurfaces → MissionOrchestrator → Handoffs → Verification → Outcome
- Internal handoffs (`src/worker/handoff.ts`) are NOT modified.
- WorkerGenome is NOT modified.
- MissionOrchestrator is NOT made protocol-aware.
- OpenBot, OpenDots, OpenMuse, MCP, AG-UI boundaries are preserved.

---

## 2. SDK / Version

```
A2A_PROTOCOL_BASELINE = A2A Protocol Specification v1.0.0 (stable standard)
A2A_SDK              = @a2a-js/sdk
A2A_SDK_VERSION      = 1.3.0
SOURCE_OF_VERSION    = package.json + node_modules/@a2a-js/sdk/package.json
                       + data/dependency-baseline.json (verified 2026-10-05)
```

The SDK provides:
- `ClientFactory` — creates `Client` instances from `AgentCard` or URL
- `DefaultAgentCardResolver` — fetches `/.well-known/agent-card.json`
- `JsonRpcTransportFactory` — JSON-RPC over HTTP (the canonical A2A wire protocol)
- `Client` interface — `sendMessage()`, `getTask()`, `cancelTask()`

Genesis wraps; it does not reinvent (Section 13: CONFIGURE → REUSE).
No custom transport, session, JSON-RPC, or HTTP framework.

---

## 3. Why A2A is Edge-Only

Per Section 1: "A2A lives at the EDGE of Genesis. It does NOT replace
Genesis internal organization semantics."

**What A2A is NOT:**
- NOT a WorkerSurface — WorkerSurfaces are per-worker runtime resources
  (computer, workspace, job). A2A is cross-organizational delegation.
- NOT a capability provider (like MCP) — MCP invokes tools; A2A
  delegates tasks to independent agents (Section 30).
- NOT an internal handoff — handoffs are between Genesis workers in the
  same mission roster. A2A is between Genesis and an external agent
  (Section 1).
- NOT a WorkerGenome field — external agents are NOT internal workers
  (Section 32).

**What A2A IS:**
- A mission-level `FederationService` that the orchestrator can
  optionally invoke to delegate bounded work to an external A2A agent.
- The service discovers the agent (via AgentCard), sends a message
  (task delegation), polls the task to terminal state, and returns a
  `FederationResult` with provenance.
- The service maps A2A failures to the G6-01 `FailureClass` taxonomy
  (Section 24: no second failure ontology).
- The service emits federation events to the `FlightRecorder` (Section 28).

---

## 4. External Identity Model

Per Section 17: "Genesis must distinguish internal Worker Genome
instance from external independent A2A agent. Do NOT silently convert
external agents into internal Workers."

The `ExternalAgent` type (`src/runtime/federation/types.ts`):
- `id` — stable id derived from the endpoint URL
  (e.g. `ext:a2a:http://127.0.0.1:4173`). NOT a UUID — deterministic
  so flight events and artifact records can be correlated across missions.
- `name` — from the AgentCard.
- `endpoint` — the base URL Genesis used to reach the agent.
- `declaredSkills` — from the AgentCard (id, name, description).
- `protocolVersion` — from the AgentCard.

The external agent does NOT have a `WorkerGenome`. It does NOT
participate in internal handoffs. It does NOT receive a task brief. It
is an opaque peer that the FederationService communicates with over A2A.

---

## 5. Delegation Flow

1. **Discover:** `FederationService.discover(endpoint)` fetches the
   AgentCard from `/.well-known/agent-card.json` via the SDK's
   `DefaultAgentCardResolver`. Returns an `ExternalAgent` with stable
   identity. Caches the card and client for reuse.

2. **Delegate:** `FederationService.delegate(request)` sends a
   `sendMessage` JSON-RPC call to the external agent. The message
   contains the task text as a text Part. Constraints are passed in
   the message metadata.

3. **Poll:** If the returned Task is not terminal, the service polls
   `getTask()` at a configurable interval (default 500ms) until the
   task reaches a terminal state (`COMPLETED`, `FAILED`, `CANCELED`,
   `REJECTED`) or the delegation timeout elapses.

4. **Result:** The service extracts the result text from the Task's
   artifacts (concatenating all text Parts) and returns a
   `FederationResult` with provenance (`externalAgent`, `remoteTaskId`,
   `status`, `result`, `evidence`, `failureClass`, `failureMessage`).

5. **Verify:** The CALLER (orchestrator or worker) must subject the
   `result` to Genesis verification (e.g., the G6-01 `hash-match`
   check) before treating it as mission truth. Per Section 23:
   A2A RESULT ≠ VERIFIED GENESIS FACT.

---

## 6. Failure Semantics

Per Section 24: "Reuse the G6-01 failure taxonomy where possible. Do
not create a second failure ontology for A2A."

| A2A scenario | Genesis FailureClass |
|--------------|---------------------|
| External agent unreachable (ECONNREFUSED) | PROVIDER_FAILURE |
| AgentCard fetch fails (404, network) | PROVIDER_FAILURE |
| sendMessage SDK throws | PROVIDER_FAILURE |
| Task state = FAILED | WORKER_FAILURE |
| Task state = CANCELED | CANCELLED |
| Task state = REJECTED | WORKER_FAILURE |
| Polling timeout (task never reaches terminal state) | TIMEOUT |
| Malformed response (missing required fields) | PROVIDER_FAILURE |
| External success with empty/unusable result | (ok=true; caller must verify) |
| Local mission cancellation propagates to remote | CANCELLED |

No new failure classes are introduced. The G6-01 `classifyError()`
function handles the classification; the FederationService maps A2A
TaskState values to FailureClass.

---

## 7. Verification Boundary

Per Section 23: "A2A RESULT ≠ VERIFIED GENESIS FACT. An external agent
may return text, artifact, structured result, status. Genesis may use
it as evidence/input. But if mission correctness depends on a factual
or executable claim, Genesis verification remains authoritative. No
external 'success' flag may automatically become Genesis mission success."

**Implementation:**
- `FederationResult.ok=true` means the FEDERATION succeeded (the
  external agent returned a completed task). It does NOT mean the
  result is correct.
- `FederationResult` does NOT carry a `verified` flag. The caller must
  subject `result` to Genesis verification.
- The G6-01 `hash-match` check is the strongest verification: it
  catches plausible-but-wrong content from a real-LLM external agent.
- Probe C (Section 38) proves this invariant: an external agent
  returns a completed task with a WRONG result; the FederationService
  returns `ok=true`; Genesis verification would FAIL.

---

## 8. Observability

Per Section 28: "Use existing FlightRecorder / event model. Do not
build a second event bus. Do not freeze final G7 event schema yet."

Five new flight event types (additive; schema NOT frozen in G6-02):

| Event | When emitted |
|-------|-------------|
| `federation-delegated` | sendMessage succeeds; remote task id known |
| `federation-state-change` | remote task state changed (polled) |
| `federation-result-received` | terminal result received |
| `federation-failed` | delegation failed (failure class from G6-01) |
| `federation-cancelled` | delegation was cancelled (locally or remotely) |

Future Mission Control can distinguish internal worker activity from
external federation activity by filtering on these event types.

---

## 9. Security Limitations

Per Section 39: "Assess federation security only to the level needed
for this boundary."

**What is implemented:**
- Endpoint configuration: the reference agent listens on
  `http://127.0.0.1:<port>` (localhost only — no remote exposure).
- No secrets in events: the G6-01 secret redaction patterns apply to
  federation events.
- External input treated as untrusted: `FederationResult.result` is a
  STRING, not structured data. Genesis verification independently
  checks the result.
- Remote result treated as untrusted until validated (Section 23).

**What is NOT implemented (documented limitations):**
- `PRODUCTION_AUTHENTICATION = UNPROVEN` — no OAuth2, API keys, or mTLS.
  The reference agent does not require authentication. Production A2A
  authentication requires infrastructure not currently available.
- No PKI, no enterprise identity federation, no global trust network.

---

## 10. Real Probe

Per Section 34: "G6-02 must not PASS based only on mocks."

**Reference agent:** `experiments/g6-02/reference-agent/server.mjs`
- Independent Node.js process (NOT part of Genesis production runtime).
- Implements the A2A v1.0 JSON-RPC wire protocol using Node's built-in
  `http` module (no Express dependency — avoids anti-bloat trigger).
- Serves `/.well-known/agent-card.json` and handles `SendMessage`,
  `GetTask`, `CancelTask` JSON-RPC methods.
- Three modes: `success` (correct result), `failure` (failed task),
  `trust-boundary` (completed task with wrong result).

**Three required probes (all PASS):**

| Probe | Section | Result | Evidence |
|-------|---------|--------|----------|
| A. Successful federation | 36 | PASS | Genesis delegates → agent returns SHA-256 → result matches → provenance preserved |
| B. Failure probe | 37 | PASS | Agent returns FAILED task → FederationService maps to WORKER_FAILURE → no false success |
| C. Trust-boundary | 38 | PASS | Agent returns completed task with WRONG hash → FederationService returns ok=true → Genesis verification would FAIL → external success ≠ Genesis success |

**Two additional probes (both PASS):**

| Probe | Result |
|-------|--------|
| D. Agent discovery | PASS — AgentCard fetched via `/.well-known/agent-card.json` |
| E. Cancellation | PASS — local AbortSignal triggers CANCELLED; no silent success |

All probes use the real A2A protocol (HTTP POST + JSON-RPC 2.0). The
reference agent is an independent process; communication crosses the
real protocol boundary (Section 34).

---

## 11. Known Limitations

1. **Inbound federation DEFERRED.** Per Section 21: "Outbound
   federation alone may PASS G6-02 if proven correctly." Inbound
   federation (exposing Genesis as an A2A endpoint) requires:
   - A Genesis-side A2A server (DefaultRequestHandler + Express or
     similar) — Express is a new peer dependency (anti-bloat trigger).
   - A security boundary (who can call Genesis?).
   - A mapping from inbound A2A tasks to internal Genesis missions.
   Each is a meaningful expansion. Inbound is deferred to post-v1 or
   a later Group 6 stage.

2. **Production authentication UNPROVEN.** The reference agent uses no
   authentication. Production A2A authentication (OAuth2, API keys,
   mTLS) requires infrastructure not currently available.

3. **Only local reference-agent interoperability proven.** The probes
   use a bounded local reference agent. Internet-scale federation,
   production-grade public federation, and multi-organization consensus
   are NOT claimed (Section 53).

4. **Polling-based (not streaming).** The FederationService polls
   `getTask()` at a configurable interval. Streaming
   (`sendMessageStream`) is supported by the SDK but not used in
   G6-02 — polling is simpler and sufficient for bounded delegation.

5. **No retry on sendMessage.** Per Section 26: "Avoid: duplicate
   remote side effects; duplicate task creation." sendMessage is NOT
   retried. getTask polls are retried up to the delegation timeout
   (read-only, idempotent).

---

## 12. G7 Implications

Per Section 42: "G6-02 should leave enough structured information so
future G7 can display something like: External Agent / Acme Research
Agent / Protocol A2A / Remote Task task-123 / Status Completed /
Delegated By Research Worker / Result artifact-456 / Verification PASS."

**What G6-02 preserves for G7:**
- `ExternalAgent` identity (id, name, endpoint, declaredSkills).
- `FederationResult` provenance (remoteTaskId, evidence with
  `location='a2a:<agentId>:<taskId>'`).
- Federation flight events (delegated, state-change, result-received,
  failed, cancelled).

**What G7 still needs to build:**
- UI rendering of federation activity (Section 42 — DO NOT build in G6-02).
- Capability Hub integration (external agent skills → capability
  registry; deferred to G6-04/G6-06 per Section 19).
- Mission Control federation edge visualization (Section 44).

---

## 13. Production Size Report

```
START_PRODUCTION_FILES = 40
FINAL_PRODUCTION_FILES = 42
PRODUCTION_FILES_DELTA = +2

START_PRODUCTION_LOC = 11393
FINAL_PRODUCTION_LOC = 12217
PRODUCTION_LOC_DELTA = +824

NEW_MODULES              = 1  (src/runtime/federation/)
NEW_CONTRACTS            = 0  (new types are module-local)
NEW_RUNTIME_DEPENDENCIES = 1  (@a2a-js/sdk promoted from devDep)
NEW_STORAGE_TECHNOLOGIES = 0

ANTI_BLOAT_GATE = PASS
```

| Gate | Limit | Actual | Status |
|------|-------|--------|--------|
| New production files | ≤ 6 | 2 | PASS |
| Net new production LOC | ≤ 1,000 | 824 | PASS |
| New production modules | ≤ 1 | 1 | PASS (at limit) |
| New runtime dependencies | ≤ 1 (the A2A SDK) | 1 | PASS (at limit) |
| New storage technologies | 0 | 0 | PASS |
| New infrastructure services | 0 | 0 | PASS |

---

## 14. Final Principles (Section 73)

- **A2A is an edge protocol. It is not Genesis.** ✓ FederationService
  is mission-level; internal workers unchanged.
- **Genesis creates and operates organizations. A2A allows those
  organizations to collaborate beyond their boundary.** ✓ Outbound
  federation proven; inbound deferred.
- **Internal workers remain Genesis workers. External agents remain
  external agents.** ✓ ExternalAgent type; no WorkerGenome conversion.
- **External success ≠ Genesis verified success.** ✓ Probe C proves
  this invariant.
- **MCP invokes capabilities. AG-UI exposes observable activity. A2A
  federates independent agents/organizations. Do not confuse them.** ✓
  Three distinct protocols with distinct responsibilities.
- **Reuse the protocol. Own the orchestration boundary.** ✓ Official
  @a2a-js/sdk used; Genesis owns only the semantic adapter.

**Comprehensive knowledge. Minimal implementation.**
**Reuse primitives. Standardize protocols. Invent orchestration. Minimize code.**
