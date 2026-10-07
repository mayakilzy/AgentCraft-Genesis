# G6-02 A2A Repository Census

**Date:** 2026-10-07
**Mission:** G6-02 A2A Federation
**Per Section 10:** A2A repository census before design.

---

## A2A_CURRENT_STATUS = DOCUMENTATION_ONLY

A2A is referenced throughout the codebase as a planned-but-deferred
interoperability protocol. No production code uses A2A. No tests
exercise A2A. The `@a2a-js/sdk@1.3.0` package is installed as a
devDependency but nothing imports it.

### Evidence

1. **`package.json` line 22:** `"@a2a-js/sdk": "1.3.0"` (devDependency)
2. **`data/ownership.yaml`:** domain `external-agent-interop` has
   `canonical_owner: a2a`, `decision: DEFER`,
   `notes: "A2A 1.0.0; defer internal use — simpler Bot-to-Bot first."`
3. **`data/dependency-baseline.json`:** A2A entry with
   `internal_use: "deferred — prefer simpler Bot-to-Bot primitives
   until true agent independence is required"`,
   `npm_sdk: "@a2a-js/sdk@1.3.0 (verified 2026-10-05)"`,
   `probe: "PASS — AgentCard.fromJSON + canonicalizeAgentCard +
   task-state enum verified; integration into Genesis remains DEFER"`
4. **`docs/transition/GENESIS_G6_ENTRY_STATE.md`:** G6-02 row reads
   "External agent federation (TASK-036+). Internal Genesis workers
   do NOT speak A2A. Activate when Genesis needs to call or expose
   external agents."
5. **`src/worker/handoff.ts` comment (lines 30-31):** "A2A stays out
   (per the ownership registry): workers in one mission are not
   independent agents across deployments; when they are, A2A is the
   protocol."

### EXISTING_A2A_FILES = (none)

No production source files import `@a2a-js/sdk`. No test files import
it. The SDK is dormant in `node_modules`.

### EXISTING_A2A_DEPENDENCIES

- `@a2a-js/sdk@1.3.0` — devDependency (will be promoted to runtime
  dependency in G6-02)

### EXISTING_A2A_CONTRACTS = (none)

No Genesis-side A2A contracts, adapters, or surfaces exist. The
ownership registry declares the DOMAIN (`external-agent-interop`) but
no Genesis code realizes it.

---

## A2A_PROTOCOL_BASELINE = A2A Protocol Specification v1.0.0

Per `data/dependency-baseline.json`:
- `spec: "1.0.0 stable"`
- `specification: "https://a2a-protocol.org/dev/specification/"`
- `announcement: "https://github.com/a2aproject/A2A/blob/main/docs/blog/posts/announcing-1.0.md"`
- `status: "stable-standard"`

## A2A_SDK = @a2a-js/sdk

## A2A_SDK_VERSION = 1.3.0

## SOURCE_OF_VERSION_EVIDENCE

1. `package.json` line 22: `"@a2a-js/sdk": "1.3.0"`
2. `node_modules/@a2a-js/sdk/package.json`: `"version": "1.3.0"`,
   `"description": "Server & Client SDK for Agent2Agent protocol"`
3. `node_modules/@a2a-js/sdk/README.md`: "v1.0 stable release
   implementing A2A Protocol Specification v1.0.0"
4. `data/dependency-baseline.json`:
   `npm_sdk: "@a2a-js/sdk@1.3.0 (verified 2026-10-05)"`

### SDK Surface Verified

The SDK exposes (from `dist/index.d.ts` and `dist/client/index.d.ts`):

**Top-level exports** (`@a2a-js/sdk`):
- Types: `AgentCard`, `Task`, `Message`, `Artifact`, `TaskState`,
  `Part`, `Role`, `SendMessageResult`, `SendMessageRequest`,
  `GetTaskRequest`, `CancelTaskRequest`, `ListTasksRequest`,
  `ListTasksResponse`, `TaskStatusUpdateEvent`, `TaskArtifactUpdateEvent`
- Constants: `A2A_PROTOCOL_VERSION`, `A2A_VERSION_HEADER`,
  `AGENT_CARD_PATH`, `A2A_CONTENT_TYPE`
- Utilities: `formatSSEEvent`, `formatSSEErrorEvent`, `parseSseStream`

**Client exports** (`@a2a-js/sdk/client`):
- `ClientFactory` — creates a `Client` from an `AgentCard` or a URL
- `DefaultAgentCardResolver` — fetches and normalizes agent cards
- `JsonRpcTransportFactory` — JSON-RPC transport
- `RestTransportFactory` — HTTP+JSON/REST transport
- `Client` interface with methods:
  - `sendMessage(params, options)` → `SendMessageResult` (Message | Task)
  - `sendMessageStream(params, options)` → streaming `StreamResponse`
  - `getTask(params, options)` → `Task`
  - `cancelTask(params, options)` → `Task`
  - `listTasks(params, options)` → `ListTasksResponse`
  - `getExtendedAgentCard(params, options)` → `AgentCard`

**Server exports** (`@a2a-js/sdk/server`):
- `DefaultRequestHandler` — server-side handler (not used in G6-02
  unless inbound federation is implemented)

### Decision

The SDK is **stable, official, and sufficient** for G6-02. No custom
transport, session, or JSON-RPC implementation is needed. Per Section
13 (Reuse Rule): CONFIGURE → REUSE — adopt the SDK directly.

Per Section 47 (Dependency Rule): one A2A SDK dependency is allowed.
`@a2a-js/sdk` will be promoted from devDependency to dependency.

---

## Existing Genesis Architecture — Reuse Candidates

### WorkerSurface pattern (Section 16)

The runtime already exposes `WorkerSurfaces` (`src/runtime/computer.ts`):
- `computer?: WorkerComputer` (OpenBot)
- `workspace?: WorkspaceSurface` (OpenDots)
- `job?: JobSurface` (OpenMuse)

A2A is NOT a WorkerSurface. Per Section 32: "Do NOT add A2A-specific
fields to Worker Genome." Per Section 16: A2A represents "delegated/
collaborative work across an independent agent boundary" — that is a
mission-level federation service, not a per-worker surface.

### Handoff pattern (`src/worker/handoff.ts`)

The internal `HandoffSink` interface is:
```ts
interface HandoffSink {
  ask(request: HandoffRequest): Promise<HandoffResult>;
}
```

This is the closest existing abstraction to A2A delegation. However:
- Handoffs are between INTERNAL workers (same mission roster).
- A2A is between Genesis and an EXTERNAL independent agent.
- Per Section 1: "Do NOT replace existing handoffs."

The shape is inspirational, not a direct reuse target. A2A federation
needs its own boundary, but the HandoffResult shape (`ok`, `answer`,
`evidence`, `reason`) is a good model for the federation result.

### MissionOrchestrator (Section 33)

Per Section 33: "Do not make MissionOrchestrator protocol-aware if
avoidable. Prefer an adapter/surface boundary."

Decision: G6-02 introduces a `FederationService` that the orchestrator
can optionally invoke. The orchestrator remains protocol-neutral — it
calls `federation.delegate(...)` and receives a `FederationResult`,
without knowing the result came from A2A.

### FlightRecorder (Section 28)

The flight recorder already supports structured events. G6-02 adds
new event types for federation activity (additive — no schema freeze
per Section 28).

### Failure taxonomy (G6-01)

G6-01 introduced `FailureClass` (11 classes) in
`src/mission/failure-class.ts`. Per Section 24: "Reuse the G6-01
failure taxonomy where possible. Do not create a second failure
ontology for A2A."

A2A failures map to:
- `PROVIDER_FAILURE` — external agent unavailable, connection failure,
  protocol failure, malformed response
- `TIMEOUT` — delegation timeout, remote task timeout
- `CANCELLED` — task cancelled (local or remote)
- `WORKER_FAILURE` — task rejected, task failed, unsupported capability
- `UNKNOWN_FAILURE` — external success with unusable result (when no
  more specific class applies)

---

## Architectural Decision — Surface or Capability?

Per Section 16: investigate whether A2A should be a WorkerSurface, a
mission-level federation service, a capability provider, or another
existing compatible abstraction.

### Decision: mission-level FederationService

**Rationale:**

1. **NOT a WorkerSurface.** WorkerSurfaces are per-worker runtime
   resources (computer, workspace, job). A2A federation is delegated
   work ACROSS an organizational boundary — it is a mission-level
   concern, not a per-worker resource. Adding A2A as a WorkerSurface
   would conflate the per-worker resource model with the
   cross-organizational delegation model.

2. **NOT a capability provider (like MCP).** Per Section 30: "MCP
   capability invocation and A2A agent delegation are different."
   MCP exposes tools/resources; A2A exposes independent agents. A
   worker calls an MCP tool with structured args and gets a structured
   result. A worker (or the orchestrator) delegates a TASK to an A2A
   agent and receives a Task with status, artifacts, and provenance.
   The semantics are different — MCP is synchronous tool invocation;
   A2A is asynchronous task delegation.

3. **NOT an internal handoff.** Per Section 1: "Do NOT replace
   existing handoffs." Internal handoffs are between Genesis workers
   in the same mission roster. A2A is between Genesis and an external
   independent agent. Mixing them would couple internal worker
   identity with external agent identity (Section 17 violation).

4. **YES: a mission-level FederationService.** The orchestrator (or a
   worker, via an injected surface) can delegate bounded work to an
   external A2A agent. The service:
   - Discovers the external agent (via AgentCard)
   - Sends a message (task delegation)
   - Polls or streams the task to completion
   - Returns a `FederationResult` with provenance
   - Maps A2A failures to the G6-01 failure taxonomy
   - Emits federation events to the FlightRecorder

   The service is OPTIONAL — missions without federation needs do
   not construct it. The orchestrator remains protocol-neutral.

### Naming

Per Section 15: "Names are NOT frozen. Use existing project naming
conventions."

- File: `src/runtime/federation/service.ts` (new module
  `src/runtime/federation/` — one new module per Section 46 limit)
- Types: `FederationService`, `FederationRequest`, `FederationResult`,
  `ExternalAgent`, `ExternalAgentCard`
- The service is constructed with an A2A `ClientFactory` (injected,
  not imported at module load time — keeps the SDK loadable without
  the package present at import time, mirroring the MCP adapter
  pattern in `src/runtime/mcp/capability-provider.ts`)

---

## Anti-Bloat Gate Pre-Check (Section 46)

G6-02 review triggers:
- > 6 new production files
- > 1,000 net new production LOC
- > 1 new production module
- > 1 new runtime dependency beyond the A2A SDK
- new storage technology
- new infrastructure service

**Planned:**
- New production files: 2-3 (`federation/service.ts`,
  `federation/types.ts`, possibly `federation/adapter.ts`)
- New production module: 1 (`src/runtime/federation/`) — AT the limit
- New runtime dependencies: 1 (`@a2a-js/sdk` promoted from devDep) —
  AT the limit
- New storage technologies: 0 (reuse FlightRecorder JSONL + G6-01
  ArtifactRegistry)
- New infrastructure services: 0 (no database, no message broker)

**Estimated LOC:** 400-600 (within the 1,000 limit)

`ANTI_BLOAT_GATE_PRE_CHECK = PASS` (at the limits but within them).
