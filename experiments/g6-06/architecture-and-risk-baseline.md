# G6-06 — Architecture and Risk Baseline

**Date:** 2026-10-08
**Source HEAD:** `3db5ca4b5cefea4c545b7ee4c2a44f917499200f`
**Branch:** `build/group-06-productionization`

## Subsystem Inventory

### 1. Mission Orchestration
- **COMPONENT:** `src/mission/orchestrator.ts` — `MissionOrchestrator`
- **ACTUAL_IMPLEMENTATION:** One-shot `async run(goal): Promise<MissionResult>`. AbortSignal via `options.signal`; missionTimeoutMs via setTimeout. Checks `signal.aborted` before each specialist worker and before coordinator. Status decision: aborted → partial/failure (never success).
- **ENTRYPOINT:** `new MissionOrchestrator({...}).run(goal)`
- **DEPENDENCIES:** GoalCompiler, OrganizationPlanner, GenomeCompiler, WorkerRuntime, ReasoningProvider, FlightRecorder
- **PROVEN_BEHAVIOR:** Real goal→organization→genome→worker→verification chain. Cancellation propagates via AbortController (proven in tests/gateway/cancellation.test.ts).
- **KNOWN_LIMITATIONS:** No abort check inside ensureWorker loop or mission-input staging loop (P2). beforeVerification runs on aborted missions if artifacts exist (P2).
- **INTEGRATION_RISKS:** Repository missions can execute git operations after cancellation (P2-ORCHESTRATOR-BEFOREVERIFICATION-RUN-ON-ABORT).
- **REQUIRED_G6_06_ACTION:** No P1 fix needed. Document P2 for G6-07.

### 2. Gateway Service
- **COMPONENT:** `src/gateway/mission-service.ts` — `MissionService`
- **ACTUAL_IMPLEMENTATION:** In-process Map registry. `start()` creates AbortController + MemoryFlightRecorder + MemoryComputer runtime + scripted reasoning (default). `cancel()` calls `controller.abort()`. `getArtifacts()` iterates all computers.
- **ENTRYPOINT:** `new MissionService({...})` → `start(submission, caller)`
- **PROVEN_BEHAVIOR:** 38 gateway tests pass (HTTP API, A2A inbound, isolation, cancellation, E2E).
- **KNOWN_LIMITATIONS:** Registry never evicts terminal missions (P1-REGISTRY-MEMORY-LEAK-DOS). `getArtifacts()` hardcodes `verified: true` (P1-ARTIFACTS-VERIFIED-HARDCODED). Verifier clean-room copies exposed as artifacts (P2-ARTIFACTS-INCLUDE-VERIFIER-COPIES).
- **REQUIRED_G6_06_ACTION:** Fix P1-REGISTRY-MEMORY-LEAK-DOS (count only active missions for admission; evict terminal). Fix P1-ARTIFACTS-VERIFIED-HARDCODED (track per-artifact verification outcome).

### 3. Gateway HTTP API
- **COMPONENT:** `src/gateway/http-server.ts` — `startHttpServer()`
- **ACTUAL_IMPLEMENTATION:** Native `node:http`. Bearer API key auth with `timingSafeEqual`. Routes: POST /v1/missions, GET /v1/missions/{id}[/events|result|artifacts], POST /v1/missions/{id}/cancel, GET /health, /ready.
- **PROVEN_BEHAVIOR:** 17 HTTP API tests pass. Path traversal impossible (regex `[^/]+`). Body size enforced.
- **KNOWN_LIMITATIONS:** None P1/P0.
- **REQUIRED_G6_06_ACTION:** No fix needed.

### 4. A2A Inbound Server
- **COMPONENT:** `src/gateway/a2a-server.ts` — `GenesisAgentExecutor` + SDK `DefaultRequestHandler`
- **ACTUAL_IMPLEMENTATION:** Official `@a2a-js/sdk` server abstractions (DefaultRequestHandler, AgentExecutor, InMemoryTaskStore, JsonRpcTransportHandler). AuthenticatedGatewayUser carries CallerIdentity. `execute()` delegates to MissionService.start(), polls to terminal, publishes task events.
- **PROVEN_BEHAVIOR:** 7 A2A inbound tests pass. Agent Card discovery, SendMessage, GetTask, CancelTask, auth rejection all work.
- **KNOWN_LIMITATIONS:** `cancelTask` does not verify requesting caller owns the task (P1-A2A-CANCELTASK-NO-CALLER-AUTHZ). `pollToTerminal` has no wall-clock deadline (P2-A2A-POLL-NO-TIMEOUT). `extractCallerFromUser` has a permissive fallback (P2-A2A-EXTRACT-CALLER-FALLBACK).
- **REQUIRED_G6_06_ACTION:** Fix P1-A2A-CANCELTASK-NO-CALLER-AUTHZ (plumb caller through to cancelTask; reject cross-caller cancel).

### 5. A2A Outbound Federation
- **COMPONENT:** `src/runtime/federation/service.ts` — `FederationService`
- **ACTUAL_IMPLEMENTATION:** Official `@a2a-js/sdk/client` (ClientFactory, DefaultAgentCardResolver, JsonRpcTransportFactory). `discover()` + `delegate()` + `cancel()`. Trust-boundary invariant: A2A RESULT ≠ VERIFIED GENESIS FACT.
- **PROVEN_BEHAVIOR:** 22 outbound tests pass (17 unit + 5 integration against reference agent).
- **KNOWN_LIMITATIONS:** None P1/P0.
- **REQUIRED_G6_06_ACTION:** No fix needed.

### 6. Gateway Entry Point
- **COMPONENT:** `src/gateway/main.ts`
- **ACTUAL_IMPLEMENTATION:** Reads `GENESIS_API_KEYS` env (fail-closed). Creates `MissionService` with NO runtimeFactory and NO reasoningFactory → silently uses MemoryComputer + DEVELOPMENT_REASONING_FALLBACK. Starts HTTP + A2A servers.
- **PROVEN_BEHAVIOR:** Separate-process E2E test spawns main.ts and successfully submits/retrieves missions.
- **KNOWN_LIMITATIONS:** **P1-MAIN-DEV-FALLBACK**: No `GENESIS_EXECUTION_MODE` env var. Production gateway silently presents dev fixtures as real execution. Imports from `tests/helpers/` in production code.
- **REQUIRED_G6_06_ACTION:** Add `GENESIS_EXECUTION_MODE=development|production`. In production mode, require real runtimeFactory + reasoningFactory (fail-closed). Remove test-helper import from production code.

### 7. Verification System
- **COMPONENT:** `src/mission/verification.ts` — `VerificationLoop`
- **ACTUAL_IMPLEMENTATION:** Clean-room copy from producer computers to verifier computer. Checks: file existence, expectIncludes, hash-match, command, content-in-artifacts, mission-input, flight-action.
- **PROVEN_BEHAVIOR:** Clean-room isolation sound — verifier only reads its own computer. Hash-match catches plausible-but-wrong content.
- **KNOWN_LIMITATIONS:** No AbortSignal threading (P2-VERIFICATION-NO-ABORT-CHECK). Verification runs to completion after cancellation.
- **REQUIRED_G6_06_ACTION:** No P1 fix. Document P2 for G6-07.

### 8. Decision Providers
- **COMPONENT:** `src/routing/decision-provider.ts` — `RuleDecisionProvider`; `src/providers/jev-decision-provider.ts`
- **ACTUAL_IMPLEMENTATION:** RuleDecisionProvider: deterministic criticality→tier mapping. Jev: official OpenRouter Decisions API (EU/US endpoints), fail-closed on missing credentials, no silent fallback to Rule.
- **PROVEN_BEHAVIOR:** 32 Jev tests pass. 7 failure-truthfulness probes all PASS.
- **KNOWN_LIMITATIONS:** None P1/P0.
- **REQUIRED_G6_06_ACTION:** No fix needed.

### 9. Learning and Evolution
- **COMPONENT:** `src/learning/` — ExperienceStore, CandidateGenerator, Evaluation, Pattern, Evolution
- **ACTUAL_IMPLEMENTATION:** Bounded learning loop. Pattern retrieval is advisory. Quarantined patterns enforced.
- **PROVEN_BEHAVIOR:** G5-06 measured learning PASS. G5-07 sealed blind transfer PASS.
- **KNOWN_LIMITATIONS:** Scripted reasoning throughout Academy cohorts.
- **REQUIRED_G6_06_ACTION:** No fix needed. Do not start another Academy cohort.

### 10. Flight Recorder & Evidence
- **COMPONENT:** `src/mission/flight-recorder.ts` — `MemoryFlightRecorder`, `FileFlightRecorder`
- **ACTUAL_IMPLEMENTATION:** Event vocabulary: mission-started, requirements-compiled, plan-created, genomes-compiled, worker-started/step/finished, verification, mission-finished. Secret redaction via SECRET_PATTERNS (Bearer, GitHub PAT, OpenAI, Anthropic, AWS, generic env-var patterns).
- **PROVEN_BEHAVIOR:** 12 secret-redaction tests pass. Events reconstruct full mission lifecycle.
- **KNOWN_LIMITATIONS:** No JWT/Slack/GitLab/PEM coverage (not needed — no such credentials flow through this codebase).
- **REQUIRED_G6_06_ACTION:** No fix needed.

### 11. Persistence and Restart
- **COMPONENT:** In-process Maps in MissionService
- **ACTUAL_IMPLEMENTATION:** No durability. Mission registry, events, artifacts, idempotency keys all in-process. Lost on restart.
- **KNOWN_LIMITATIONS:** RESTART_RECOVERY = UNSUPPORTED. No persisted mission recovery.
- **REQUIRED_G6_06_ACTION:** Document as release limitation. Do NOT build a new database.

### 12. Security Boundaries
- **COMPONENT:** Gateway auth (API key + timingSafeEqual), caller isolation (callerId scoping)
- **PROVEN_BEHAVIOR:** 4 cross-caller isolation tests pass. 3 auth-rejection tests pass.
- **KNOWN_LIMITATIONS:** P1-A2A-CANCELTASK-NO-CALLER-AUTHZ (cross-caller cancel bypass). API-key-only auth (no mTLS/OAuth).
- **REQUIRED_G6_06_ACTION:** Fix P1-A2A-CANCELTASK-NO-CALLER-AUTHZ.

### 13. Type Mappings
- **COMPONENT:** `src/gateway/types.ts` — statusFromResult(), statusToA2ATaskState()
- **KNOWN_LIMITATIONS:** P1-A2A-PARTIAL-TO-COMPLETED: PARTIAL maps to A2A COMPLETED (3) with no metadata indicator.
- **REQUIRED_G6_06_ACTION:** Fix: map PARTIAL to FAILED in A2A, or populate task.metadata with partial indicator.

## Defect Summary

| ID | Severity | Component | Defect | Fix Required |
|----|----------|-----------|--------|---------------|
| P1-MAIN-DEV-FALLBACK | P1 | main.ts | Gateway silently uses dev fixtures as real execution | YES — add GENESIS_EXECUTION_MODE |
| P1-ARTIFACTS-VERIFIED-HARDCODED | P1 | mission-service.ts | getArtifacts() always returns verified:true | YES — track real verification outcome |
| P1-REGISTRY-MEMORY-LEAK-DOS | P1 | mission-service.ts | Registry never evicts; admission counts all missions | YES — count only active; evict terminal |
| P1-A2A-PARTIAL-TO-COMPLETED | P1 | types.ts + a2a-server.ts | PARTIAL maps to COMPLETED with no metadata | YES — map to FAILED or add metadata |
| P1-A2A-CANCELTASK-NO-CALLER-AUTHZ | P1 | a2a-server.ts | CancelTask doesn't verify caller ownership | YES — plumb caller through |
| P2-A2A-EXTRACT-CALLER-FALLBACK | P2 | a2a-server.ts | Permissive user fallback | DEFER G6-07 |
| P2-A2A-POLL-NO-TIMEOUT | P2 | a2a-server.ts | pollToTerminal has no deadline | DEFER G6-07 |
| P2-ARTIFACTS-INCLUDE-VERIFIER-COPIES | P2 | mission-service.ts | Verifier clean-room copies exposed | DEFER G6-07 |
| P2-ORCHESTRATOR-NO-ABORT-IN-LOOPS | P2 | orchestrator.ts | No abort check in ensureWorker/staging loops | DEFER G6-07 |
| P2-VERIFICATION-NO-ABORT-CHECK | P2 | verification.ts | No AbortSignal in verification | DEFER G6-07 |
| P2-ORCHESTRATOR-BEFOREVERIFICATION-RUN-ON-ABORT | P2 | orchestrator.ts | beforeVerification runs on aborted missions | DEFER G6-07 |
| P3-WORKER-ABORT-COARSENESS | P3 | worker-agent.ts | Worker abort is coarse-grained | DEFER G6-07 |

**P0 count: 0. P1 count: 5. P2 count: 6. P3 count: 1.**

## Areas Verified Sound (NO_DEFECT_FOUND)

- Clean-room verification isolation (verifier only reads its own computer)
- Orchestrator aborted-mission success path (aborted → partial/failure, never success)
- Jev provider fail-closed & no silent fallback
- Flight recorder secret redaction coverage
- HTTP path traversal protection (regex `[^/]+`)
- HTTP body size enforcement
- HTTP auth bypass (no header injection)

END OF ARCHITECTURE AND RISK BASELINE.
