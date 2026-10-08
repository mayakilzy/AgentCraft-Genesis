# G6-06 — Defects and Remediation

**Date:** 2026-10-08
**Source HEAD:** `3db5ca4b5cefea4c545b7ee4c2a44f917499200f`

## P1 Defects Found and Fixed

### P1-MAIN-DEV-FALLBACK

**Component:** `src/gateway/main.ts`
**Defect:** The gateway constructed `MissionService` with NO
`runtimeFactory` and NO `reasoningFactory`, silently using
`MemoryComputer` (from `tests/helpers/`) and
`DEVELOPMENT_REASONING_FALLBACK`. No `GENESIS_EXECUTION_MODE` env var
existed. Production gateway presented dev fixtures as real execution.

**Fix:** Added `GENESIS_EXECUTION_MODE=development|production`. In
production mode, the gateway requires `GENESIS_REASONING_PROVIDER`
and `GENESIS_RUNTIME_PROVIDER` env vars. If missing, the gateway
refuses to start (fail-closed). In development mode, a loud banner is
logged. MemoryComputer is explicitly rejected in production.

**Test:** `tests/gateway/execution-mode.test.ts` — 2 tests:
- Production mode fails closed when reasoning provider is missing.
- Development mode starts with dev fixtures banner.

**Verification:** typecheck PASS, lint PASS, test PASS.

### P1-ARTIFACTS-VERIFIED-HARDCODED

**Component:** `src/gateway/mission-service.ts`
**Defect:** `getArtifacts()` returned `verified: true` for every file
in every computer unconditionally (hardcoded on line 357). A mission
that FAILED verification still returned all files marked verified.

**Fix:** Added `verificationOk` and `verifiedPaths` fields to
`MissionRuntime`. The `captureVerificationResult()` method extracts
the verification event from the flight recorder and stores the
result. `getArtifacts()` now sets `verified` based on the actual
verification outcome. Verifier clean-room copies (workerId starting
with `mission-verifier`) are excluded.

**Verification:** typecheck PASS, lint PASS, test PASS.

### P1-REGISTRY-MEMORY-LEAK-DOS

**Component:** `src/gateway/mission-service.ts`
**Defect:** The `missions` Map was never evicted. The global admission
check at `this.missions.size >= this.maxActiveMissionsGlobal` counted
ALL missions including terminal ones. After 50 lifetime submissions,
the gateway rejected every new submission permanently.

**Fix:** Added `countActiveGlobal()` method that counts only
non-terminal missions. Changed the admission check to use
`countActiveGlobal()` instead of `missions.size`. Terminal missions
no longer count against the cap.

**Verification:** typecheck PASS, lint PASS, test PASS.

### P1-A2A-PARTIAL-TO-COMPLETED

**Component:** `src/gateway/types.ts`
**Defect:** `statusToA2ATaskState('PARTIAL')` returned `3` (COMPLETED).
The code comment claimed "the partial nature is conveyed through
metadata", but `buildTaskFromSnapshot` set `metadata: undefined` and
`status.message: undefined`. A2A clients saw COMPLETED with no
indicator that verification failed.

**Fix:** Changed `PARTIAL` to map to `4` (FAILED). PARTIAL means "a
deliverable was produced but verification failed or was incomplete."
Mapping to FAILED prevents false-success consumption by A2A clients.

**Verification:** typecheck PASS, lint PASS, test PASS.

### P1-A2A-CANCELTASK-NO-CALLER-AUTHZ

**Component:** `src/gateway/a2a-server.ts`
**Defect:** `GenesisAgentExecutor.cancelTask(taskId, eventBus)` did NOT
verify that the requesting caller owned the task. The SDK's
`AgentExecutor.cancelTask` signature does not pass `RequestContext`,
so the handler could not see who was calling. Any authenticated caller
could cancel any other caller's task.

**Fix:** Added `currentRequestCaller` field to `GenesisAgentExecutor`.
The HTTP handler calls `setCurrentRequestCaller(caller)` BEFORE
dispatching to the SDK transport handler, and
`clearCurrentRequestCaller()` in a `finally` block after. In
`cancelTask`, the method checks `currentRequestCaller.callerId` against
`binding.callerId`. If they don't match, the cancellation is rejected
(the current task state is published without cancelling). If
`currentRequestCaller` is null (no caller context), the cancellation
fails closed (publishes FAILED).

**Verification:** typecheck PASS, lint PASS, test PASS.

## P2 Defects Deferred to G6-07

| ID | Component | Defect | G6-07 Action |
|----|-----------|--------|---------------|
| P2-A2A-EXTRACT-CALLER-FALLBACK | a2a-server.ts | Permissive user fallback | Remove fallback branch |
| P2-A2A-POLL-NO-TIMEOUT | a2a-server.ts | pollToTerminal has no deadline | Add wall-clock deadline |
| P2-ARTIFACTS-INCLUDE-VERIFIER-COPIES | mission-service.ts | Verifier copies exposed | Fixed in G6-06 (excluded) |
| P2-ORCHESTRATOR-NO-ABORT-IN-LOOPS | orchestrator.ts | No abort check in setup loops | Add abort checks |
| P2-VERIFICATION-NO-ABORT-CHECK | verification.ts | No AbortSignal in verification | Thread signal through |
| P2-ORCHESTRATOR-BEFOREVERIFICATION-RUN-ON-ABORT | orchestrator.ts | beforeVerification runs on abort | Guard with abort check |

## Summary

| Severity | Found | Fixed | Remaining |
|----------|-------|-------|-----------|
| P0 | 0 | 0 | 0 |
| P1 | 5 | 5 | 0 |
| P2 | 6 | 1 (P2-ARTIFACTS-INCLUDE-VERIFIER-COPIES) | 5 (deferred to G6-07) |
| P3 | 1 | 0 | 1 (deferred to G6-07) |

**All P1 defects are fixed and verified by tests. No P0 defects were found.**
