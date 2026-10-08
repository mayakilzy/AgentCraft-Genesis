# Genesis Engine v1 — Changelog

**Branch:** `build/group-06-productionization`

## G6-06 (2026-10-08) — Engine v1 Integration, Reliability Baseline & Release Readiness

### P1 Defects Fixed

1. **P1-MAIN-DEV-FALLBACK** — Gateway now has `GENESIS_EXECUTION_MODE=development|production`.
   In production mode, the gateway fails closed if real reasoning and
   runtime providers are missing. No silent fallback to dev fixtures.
   Development mode logs a loud banner. (src/gateway/main.ts)

2. **P1-ARTIFACTS-VERIFIED-HARDCODED** — `getArtifacts()` now tracks
   per-artifact verification outcome. The `verified` flag is based on
   the actual `VerificationResult` captured from flight events, not
   hardcoded `true`. Verifier clean-room copies are excluded.
   (src/gateway/mission-service.ts)

3. **P1-REGISTRY-MEMORY-LEAK-DOS** — Admission control now counts only
   ACTIVE (non-terminal) missions, not all missions in the registry.
   The gateway no longer becomes permanently unusable after 50 lifetime
   submissions. (src/gateway/mission-service.ts)

4. **P1-A2A-PARTIAL-TO-COMPLETED** — `PARTIAL` status now maps to A2A
   `FAILED` (state 4) instead of `COMPLETED` (state 3). PARTIAL means
   "deliverable produced but verification failed" — mapping to COMPLETED
   would mislead A2A consumers. (src/gateway/types.ts)

5. **P1-A2A-CANCELTASK-NO-CALLER-AUTHZ** — `GenesisAgentExecutor.cancelTask()`
   now verifies the requesting caller owns the task. A `currentRequestCaller`
   bridge passes the authenticated caller from the HTTP handler to the
   executor. Cross-caller cancellation is rejected. (src/gateway/a2a-server.ts)

### New Tests

- `tests/gateway/execution-mode.test.ts` (2 tests):
  - Production mode fails closed when reasoning provider is missing.
  - Development mode starts with dev fixtures banner.

### Evidence

- `experiments/g6-06/architecture-and-risk-baseline.md` — Subsystem inventory
  with P0/P1/P2 classification.
- `experiments/g6-06/clean-room-reproduction.md` — Clean-room clone + tests + smoke.
- `experiments/g6-06/residual-risk-register.md` — P2/P3 risks deferred to G6-07.
- `experiments/g6-06/defects-and-remediation.md` — P1 defect details and fixes.

### Documentation

- `docs/release/engine-v1-scope.md` — Capability matrix.
- `docs/release/engine-v1-configuration.md` — Environment variables and fail-closed behavior.
- `docs/release/engine-v1-install-and-run.md` — Installation and startup procedures.
- `docs/release/engine-v1-security-boundaries.md` — Authentication, authorization, isolation.
- `docs/release/engine-v1-known-limitations.md` — Release limitations.

### Test Results

- Baseline: 525 passed / 9 skipped = 534 total
- After G6-06: 527 passed / 9 skipped = 536 total (2 new tests)
- typecheck: PASS
- lint: PASS
- clean-room: PASS (clone + npm ci + tests + smoke + gateway startup)

### Scope Discipline

- NEW_PRODUCTION_FILES = 0 (focused edits to existing files)
- NEW_RUNTIME_DEPENDENCIES = 0
- No new database, message broker, policy DSL, or agent framework
- One orchestration engine (preserved)
- One verification system (preserved)
- One evidence model (preserved)

## G6-05A-R1 (2026-10-08) — Gateway Compliance & Evidence Closure

- Replaced manual A2A JSON-RPC dispatch with official @a2a-js/sdk server abstractions.
- Added separate-process E2E test (spawns main.ts as child process).
- Added real cancellation proof (long-running mission, AbortSignal propagation).
- 6 new tests, 38 total gateway tests.

## G6-05A (2026-10-08) — Service Gateway & Bidirectional A2A

- Implemented MissionService, HTTP Service API, A2A inbound server.
- 5 production files under src/gateway/ (~1940 LOC).
- 32 gateway tests.

## G6-05 (2026-10-08) — Final Benchmark & Evidence-Based Claims

- 6 new bounded experiments (A-F), all PASS.
- 16 claims evaluated: 1 PROVEN, 10 PROVEN_WITH_LIMITATIONS, 4 REJECTED.
- Evidence ledger with 30 traceable entries.

## G6-04 (2026-10-07) — Release Candidate & Reproducibility Gate

- Two independent clean-room runs from commit cf92318 produce semantically
  identical results.
- 487 tests passed / 9 skipped = 496 total.
- Deterministic smoke mission PASS.
