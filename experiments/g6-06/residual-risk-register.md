# G6-06 — Residual Risk Register

**Date:** 2026-10-08
**Source HEAD:** `3db5ca4b5cefea4c545b7ee4c2a44f917499200f`

Risks deferred to G6-07 (Deep Hardening). Separated into observed
defects (with evidence) and hypothetical threats (untested).

## Observed Defects (P2 — deferred to G6-07)

### RISK-001: A2A extractCallerFromUser permissive fallback
- **COMPONENT:** src/gateway/a2a-server.ts
- **SEVERITY:** P2
- **FAILURE_SCENARIO:** If a different User implementation is ever injected (SDK upgrade, custom UserBuilder), `extractCallerFromUser` grants submit privileges based on a boolean getter.
- **OBSERVED_OR_HYPOTHETICAL:** Hypothetical (current code path is unreachable — always uses AuthenticatedGatewayUser).
- **CURRENT_EVIDENCE:** Code inspection (a2a-server.ts lines 414-429). No test exercises this path.
- **IMPACT:** Latent auth bypass if User implementation changes.
- **MITIGATION:** Remove the fallback branch; return null for unknown User types.
- **REPRODUCTION_STEPS:** Inject a custom User with `isAuthenticated: true` but not AuthenticatedGatewayUser.
- **RECOMMENDED_G6_07_ACTION:** Remove fallback branch; add test for unknown User rejection.

### RISK-002: A2A pollToTerminal has no deadline
- **COMPONENT:** src/gateway/a2a-server.ts
- **SEVERITY:** P2
- **FAILURE_SCENARIO:** If `service.get(missionId, caller)` returns non-terminal indefinitely (orchestrator hang, registry corruption), the executor's `execute()` never resolves and the SDK's blocking `sendMessage` hangs forever.
- **OBSERVED_OR_HYPOTHETICAL:** Hypothetical (orchestrator has missionTimeoutMs that bounds the realistic worst case).
- **CURRENT_EVIDENCE:** Code inspection (a2a-server.ts lines 163-185). The `signal.aborted` check does not break the loop.
- **IMPACT:** Single hung mission pins one A2A executor + one HTTP connection indefinitely.
- **MITIGATION:** Add wall-clock deadline (missionTimeoutMs + 30s slack); break with FAILED task when exceeded.
- **REPRODUCTION_STEPS:** Inject a mission that never reaches terminal state.
- **RECOMMENDED_G6_07_ACTION:** Add deadline to pollToTerminal; add test for hung-mission timeout.

### RISK-003: Orchestrator no abort check in ensureWorker/staging loops
- **COMPONENT:** src/mission/orchestrator.ts
- **SEVERITY:** P2
- **FAILURE_SCENARIO:** After cancellation, the orchestrator can still create N more workers and stage M more files before noticing the abort.
- **OBSERVED_OR_HYPOTHETICAL:** Observed (code inspection confirms no `signal.aborted` check inside loops at lines 434-452 and 460-481).
- **CURRENT_EVIDENCE:** Code inspection. Tests do not cover this specific timing.
- **IMPACT:** Wastes real resources (OpenBot containers) after cancellation.
- **MITIGATION:** Add `if (controller.signal.aborted) break;` at the top of each affected loop body.
- **REPRODUCTION_STEPS:** Cancel a repository mission with 3+ specialists during ensureWorker loop.
- **RECOMMENDED_G6_07_ACTION:** Add abort checks to setup loops; add test for abort-during-setup.

### RISK-004: VerificationLoop has no AbortSignal
- **COMPONENT:** src/mission/verification.ts
- **SEVERITY:** P2
- **FAILURE_SCENARIO:** If the mission is aborted mid-verification, every check runs to completion (including shell commands in the verifier computer).
- **OBSERVED_OR_HYPOTHETICAL:** Observed (code inspection confirms no signal parameter in VerificationLoopOptions).
- **CURRENT_EVIDENCE:** Code inspection (verification.ts lines 219-294).
- **IMPACT:** Aborted mission can still spawn real shell commands in the verifier.
- **MITIGATION:** Thread `signal?: AbortSignal` through VerificationLoopOptions; check between checks.
- **REPRODUCTION_STEPS:** Cancel a mission during verification with a slow `command` check.
- **RECOMMENDED_G6_07_ACTION:** Add signal to VerificationLoop; add test for abort-during-verification.

### RISK-005: beforeVerification runs on aborted missions
- **COMPONENT:** src/mission/orchestrator.ts
- **SEVERITY:** P2
- **FAILURE_SCENARIO:** When the mission is aborted BUT `artifactSources.length > 0`, the orchestrator still calls `beforeVerification` (git operations for repository missions).
- **OBSERVED_OR_HYPOTHETICAL:** Observed (code inspection confirms no abort guard at lines 580-586 and 747-749).
- **CURRENT_EVIDENCE:** Code inspection. Tests do not cover this specific timing.
- **IMPACT:** After cancellation, repository missions still execute git operations.
- **MITIGATION:** Guard both `beforeVerification` calls with `if (!controller.signal.aborted)`.
- **REPRODUCTION_STEPS:** Cancel a repository mission with artifacts produced.
- **RECOMMENDED_G6_07_ACTION:** Add abort guard; add test for abort-before-verification.

### RISK-006: Worker abort coarseness
- **COMPONENT:** src/worker/worker-agent.ts
- **SEVERITY:** P3
- **FAILURE_SCENARIO:** The worker checks `signal.aborted` only at the top of each loop iteration. A long-running action (30s shell script, slow browser navigation) cannot be interrupted mid-action.
- **OBSERVED_OR_HYPOTHETICAL:** Observed (code inspection confirms no signal check between reasoning return and execute call).
- **CURRENT_EVIDENCE:** Code inspection (worker-agent.ts lines 710-713, 925-965).
- **IMPACT:** Post-abort delay of seconds for slow actions.
- **MITIGATION:** Pass AbortSignal through to WorkerComputer.exec/browser.navigate.
- **REPRODUCTION_STEPS:** Cancel a mission while a worker is mid-action on a slow command.
- **RECOMMENDED_G6_07_ACTION:** Thread signal through to computer exec; add test for mid-action abort.

## Hypothetical Threats (G6-08 evaluation scope)

### Concurrency and Race Conditions
- Concurrent mission submission with same idempotency key.
- Concurrent cancel + get on same mission.
- Concurrent A2A SendMessage with same goal text.

### Crash and Restart
- Gateway crash mid-mission: in-flight work lost (no restart recovery).
- Crash during verification: partial evidence.
- Crash during A2A delegation: remote task orphaned.

### Resource Exhaustion
- Memory: terminal missions not evicted (bounded by maxActiveMissionsGlobal but retained for process lifetime).
- Connections: no HTTP connection pool limit.
- Event subscriptions: no limit on pending SSE consumers (not implemented in v1).

### Cross-Mission Isolation
- Artifact path collision between concurrent missions (MemoryComputer per-worker, so no collision in v1).
- Event ordering across missions (per-mission recorder, so no cross-mission ordering issue).

### Learning/Pattern Corruption
- Quarantined pattern retrieval (verified: NOT retrievable in G5-07).
- Pattern injection through external goals (goals are untrusted input; orchestrator governance handles).

### Dependency and Supply-Chain
- @a2a-js/sdk version pinning (1.3.0 in package-lock.json).
- @modelcontextprotocol/sdk version pinning (1.32.1).
- No `npm audit` failures (0 vulnerabilities as of G6-06).

## Summary

| Severity | Count | Action |
|----------|-------|--------|
| P0 | 0 | — |
| P1 | 0 (all 5 fixed in G6-06) | — |
| P2 | 5 | Deferred to G6-07 |
| P3 | 1 | Deferred to G6-07 |

**No P0 or P1 issues remain.** All P1 defects found in the G6-06
architecture audit have been fixed and verified by tests.
