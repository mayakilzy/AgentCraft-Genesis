# G6-05A — Implementation Map

**Date:** 2026-10-08
**Branch:** `build/group-06-productionization`
**Source HEAD (start):** `0573b42d1c36cd6ded7273975ec451ad57c70b19`

## Reconnaissance Summary

The G6-05A reconnaissance inspected 20 source files plus the
`@a2a-js/sdk` package surface. Key findings:

### Existing Components Reused

| Component | Reusable API | How G6-05A Uses It |
|-----------|--------------|---------------------|
| `MissionOrchestrator` | `async run(goal): Promise<MissionResult>` with `signal: AbortSignal` and `missionTimeoutMs` | Wrapped once per mission by `MissionService.start()`; cancellation via `AbortController.abort()` |
| `FlightRecorder` / `MemoryFlightRecorder` | `record(event: FlightEvent)` | Used per mission to capture the event stream; exposed via `GET /v1/missions/{id}/events` |
| `GoalCompiler` | `async compile(goal): Promise<GoalRequirements>` | Called internally by the orchestrator (no gateway-level usage) |
| `OrganizationPlanner` | `plan(requirements): OrganizationPlan` | Called internally by the orchestrator |
| `GenomeCompiler` | `async compilePlan(plan, requirements)` | Called internally by the orchestrator |
| `RuleDecisionProvider` | `async decide(request)` | Default tier selector (deterministic; no external calls) |
| `CognitiveRouter` | `async selectTier(selection)` | Wraps the decision provider |
| `MemoryComputer` / `MemoryRuntime` | `writeFile`, `readFile`, `files: Map` | Default runtime for deterministic missions; artifact retrieval via the captured `computers` map |
| `VerificationLoop` + `cleanRoomPath` | Clean-room artifact verification | Default `checks` callback in `MissionService` verifies every produced artifact exists in the clean-room copy |
| `classifyError` (FailureClass taxonomy) | 11-class failure ontology | Reused for infrastructure-error classification (no second failure ontology) |
| Outbound `FederationService` | `discover` + `delegate` + `cancel` | UNCHANGED — outbound A2A regression verified by existing tests |

### Missing Capabilities Added

| Missing Capability | New Module | Lines |
|--------------------|------------|-------|
| Shared mission service (registry, lifecycle, cancellation, isolation) | `src/gateway/mission-service.ts` | ~580 |
| HTTP Service API (node:http, auth, routes) | `src/gateway/http-server.ts` | ~410 |
| A2A inbound server (node:http, JSON-RPC, AgentCard) | `src/gateway/a2a-server.ts` | ~480 |
| Shared types (MissionStatus, MissionSnapshot, CallerIdentity, etc.) | `src/gateway/types.ts` | ~360 |
| Gateway main entry point (starts both servers) | `src/gateway/main.ts` | ~110 |

### Architecture Decisions

1. **Native `node:http`** (no express, no new runtime dependencies).
   The A2A inbound server uses the official `@a2a-js/sdk` server
   abstractions (`DefaultRequestHandler`, `AgentExecutor`,
   `InMemoryTaskStore`, `JsonRpcTransportHandler`) mounted on native
   `node:http`. The SDK's `JsonRpcTransportHandler.handle()` returns
   a `JSONRPCResponse` that we serialize ourselves — no express
   dependency required. This honors `NEW_RUNTIME_DEPENDENCIES = 0`
   AND `Section 4.2: "Use official SDK abstractions."`

2. **One MissionService, two transports.** Both HTTP API and A2A
   inbound call the same `MissionService.start()`, `get()`, `cancel()`
   methods. No second orchestration engine. Per Section 3: "Access
   transports may differ. Execution semantics must not."

3. **In-process registry only.** The mission registry is a `Map` in
   the MissionService. State does NOT survive process restart. This is
   a documented release limitation (RESTART_RECOVERY = LIMITED). Per
   Section 19: "Do not claim production-grade durability without evidence."

4. **API-key authentication (constant-time comparison).** Bearer token
   in the `Authorization` header. Deny-by-default. No anonymous
   submission. Fail-closed on missing configuration. Per Section 10.

5. **Cross-caller isolation via `callerId` on every mission.** A caller
   cannot read, cancel, or retrieve artifacts from another caller's
   mission. Cross-caller access returns 404 (not 403) to avoid leaking
   the existence of another caller's mission. Per Section 11.

6. **Cancellation via `AbortController`.** `MissionService.cancel()`
   aborts the orchestrator's signal. Cancellation request is NOT
   cancellation completion — the mission transitions through
   `CANCELLATION_REQUESTED` to `CANCELLED` (or `PARTIAL` if a
   deliverable was produced before the abort propagated). Per Section 13.

7. **Idempotency (in-memory only).** Caller-supplied idempotency keys
   are tracked in a `Map`. Duplicate submissions return the existing
   missionId. Idempotency does NOT survive process restart. Per Section 7.

## Anti-Bloat Compliance

```text
NEW_PRODUCTION_MODULES = 1 (src/gateway/)
NEW_PRODUCTION_FILES = 5 (types.ts, mission-service.ts, http-server.ts, a2a-server.ts, main.ts)
NEW_RUNTIME_DEPENDENCIES = 0
NEW_DATABASE = NO
NEW_MESSAGE_BROKER = NO
NEW_POLICY_DSL = NO
NEW_AGENT_FRAMEWORK = NO
```

The gateway reuses:
- The existing `MissionOrchestrator` (one engine).
- The existing `FlightRecorder` (one evidence model).
- The existing `VerificationLoop` (one verification system).
- The existing `FailureClass` taxonomy (one failure ontology).
- The existing `MemoryComputer` (one worker organization model).
- The existing outbound `FederationService` (unchanged).

## Test Coverage

| Test File | Tests | Covers |
|-----------|-------|--------|
| `tests/gateway/helpers.ts` | (setup) | Shared test fixtures + http/a2a helpers |
| `tests/gateway/http-api.test.ts` | 17 | API-01..API-12 + health/ready |
| `tests/gateway/isolation.test.ts` | 4 | ISO-01..ISO-04 cross-caller isolation |
| `tests/gateway/a2a-inbound.test.ts` | 7 | A2A-01..A2A-06 inbound A2A (official SDK server) |
| `tests/gateway/e2e.test.ts` | 4 | E2E-01..E2E-02 + FAIL-01..FAIL-02 |
| `tests/gateway/separate-process-e2e.test.ts` | 2 | Separate-process E2E (spawns main.ts) |
| `tests/gateway/cancellation.test.ts` | 4 | CANCEL-01..CANCEL-04 (AbortSignal propagation proof) |
| **Total gateway tests** | **38** | |

Full test suite: 525 passed / 9 skipped (534 total) — up from 519/9 (528)
at the G6-05A baseline. The 6 new R1 tests are additive; no existing
test was modified or removed.

## Known Limitations

1. **In-process state only.** No durability across process restart.
   Active missions are lost on restart. (RESTART_RECOVERY = LIMITED)
2. **MemoryComputer default runtime.** Real OpenBot requires runtime
   configuration via `runtimeFactory` injection.
3. **DEVELOPMENT_REASONING_FALLBACK default reasoning.** Real LLM
   requires `reasoningFactory` injection.
4. **API-key authentication only.** No mTLS, no OAuth, no signed Agent
   Cards. Suitable for server-to-server; not for browser-facing.
5. **Polling only.** No SSE/WebSocket streaming for events.
6. **Single-process.** No horizontal scaling, no load balancing.

END OF IMPLEMENTATION MAP.
