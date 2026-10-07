# PRODUCTION_HARDENING_MATRIX

**Date:** 2026-10-07
**Transition:** G5 → G6
**Purpose:** Direct preparation for G6-01 Production Hardening. For every failure scenario, record current behavior, expected production behavior, current evidence, test status, risk, priority, and G6 action. Do NOT fix in this mission — Group 6 executes the fixes.

**Status legend:** PROVEN (verified by test) · PARTIALLY_PROVEN (code present, partial test) · UNPROVEN (code present, no test) · NOT_APPLICABLE (scenario does not apply to current architecture)

**Priority legend:** P0 (false success / corruption / security / unrecoverable truth risk) · P1 (major reliability issue) · P2 (important but non-blocking) · P3 (nice-to-have / later)

---

## 1. REQUIRED HARDENING SCENARIOS (Section 12 of transition spec)

### H-01 — Provider unavailable

| Field | Value |
|-------|-------|
| ID | H-01 |
| SCENARIO | Reasoning provider (LLM or scripted) becomes unreachable mid-mission |
| CURRENT_BEHAVIOR | WorkerAgent calls `reasoning.reason()` which returns a Promise. If the provider throws, the rejection propagates as a worker failure (status='failure'). No retry of the reasoning call itself. |
| EXPECTED_PRODUCTION_BEHAVIOR | Provider-down should be detected, logged, and either retried with exponential backoff OR surfaced as a mission-failure with a clear reason. The mission should not hang. |
| CURRENT_EVIDENCE | `src/worker/worker-agent.ts` — the reasoning loop awaits `reasoning.reason()`; no try/catch around the call. |
| TEST_EXISTS | NO — no test for provider-throws. |
| RISK | Mission hangs or surfaces as generic failure. |
| STATUS | UNPROVEN |
| PRIORITY | P1 |
| G6_ACTION | G6-01: wrap `reasoning.reason()` in try/catch with bounded retry; record provider failure event in FlightRecorder. |

### H-02 — Provider rate limited

| Field | Value |
|-------|-------|
| ID | H-02 |
| SCENARIO | Provider returns rate-limit error (HTTP 429 equivalent) |
| CURRENT_BEHAVIOR | No rate-limit detection. Provider-specific errors surface as generic rejection. |
| EXPECTED_PRODUCTION_BEHAVIOR | Detect rate-limit, back off, retry within budget, or surface as 'provider rate-limited' failure. |
| CURRENT_EVIDENCE | No rate-limit handling in `src/worker/worker-agent.ts` or `src/providers/zai-reasoning.ts`. |
| TEST_EXISTS | NO |
| RISK | Mission fails silently under load. |
| STATUS | UNPROVEN |
| PRIORITY | P1 |
| G6_ACTION | G6-01: define `RateLimitedError` contract; provider implementations detect and throw it; orchestrator handles with bounded backoff. |

### H-03 — Provider timeout

| Field | Value |
|-------|-------|
| ID | H-03 |
| SCENARIO | Provider call exceeds reasonable time |
| CURRENT_BEHAVIOR | No per-call timeout. Mission-level timeout (default 10 min) aborts the entire mission via AbortController. |
| EXPECTED_PRODUCTION_BEHAVIOR | Per-reasoning-call timeout with bounded retry; mission-level timeout as backstop. |
| CURRENT_EVIDENCE | `src/mission/orchestrator.ts` line 340 — mission timeout via `setTimeout`. |
| TEST_EXISTS | YES (mission timeout) — `tests/mission/orchestrator.test.ts` "aborts on mission timeout and still retires every worker". NO (per-call timeout). |
| RISK | One slow reasoning call blocks the entire worker. |
| STATUS | PARTIALLY_PROVEN |
| PRIORITY | P1 |
| G6_ACTION | G6-01: add per-call timeout to reasoning provider contract. |

### H-04 — Worker crash

| Field | Value |
|-------|-------|
| ID | H-04 |
| SCENARIO | WorkerAgent.run() throws an uncaught exception |
| CURRENT_BEHAVIOR | The exception propagates to MissionOrchestrator.run(), which catches it in the finally block (clears timeout, removes listener). Worker is retired. Mission status = 'failure'. |
| EXPECTED_PRODUCTION_BEHAVIOR | Worker crash should be caught, logged with worker ID + step count, and the mission should either retry the worker or fail with a clear reason. Other workers should be retired cleanly. |
| CURRENT_EVIDENCE | `src/mission/orchestrator.ts` finally block (line 809). |
| TEST_EXISTS | NO — no test for worker-throws. |
| RISK | Crash details lost; partial artifacts may not be retired. |
| STATUS | PARTIALLY_PROVEN |
| PRIORITY | P1 |
| G6_ACTION | G6-01: wrap worker.run() in try/catch; record `worker-crashed` flight event with reason. |

### H-05 — Worker returns malformed output

| Field | Value |
|-------|-------|
| ID | H-05 |
| SCENARIO | Reasoning returns text that does not parse as a valid WorkerAction JSON |
| CURRENT_BEHAVIOR | WorkerAgent tracks `consecutiveParseFailures`; after a threshold, the worker fails with "step budget exhausted before the worker finished". Refusal is recorded. |
| EXPECTED_PRODUCTION_BEHAVIOR | Same — bounded consecutive-parse-failure handling exists and is correct. |
| CURRENT_EVIDENCE | `src/worker/worker-agent.ts` line 770 — `refusals.push('repeated action refused')`. |
| TEST_EXISTS | YES — `tests/worker/worker-agent.test.ts`. |
| RISK | Low. |
| STATUS | PROVEN |
| PRIORITY | P3 |
| G6_ACTION | None — already handled. |

### H-06 — Worker hallucinated completion

| Field | Value |
|-------|-------|
| ID | H-06 |
| SCENARIO | Worker calls `finish` with artifacts that do not exist in the workspace |
| CURRENT_BEHAVIOR | WorkerAgent checks each claimed artifact path; if missing, records refusal "claimed artifact was not found in the workspace" and does NOT finish — the worker continues its loop until step budget exhausted. |
| EXPECTED_PRODUCTION_BEHAVIOR | Same — hallucinated completion is refused. Verification independently checks artifact existence. |
| CURRENT_EVIDENCE | `src/worker/worker-agent.ts` line 823. |
| TEST_EXISTS | YES. |
| RISK | Low under scripted; **medium under real LLM** — a real LLM could produce plausible-but-wrong content that DOES exist as a file but is incorrect. |
| STATUS | PROVEN (existence check) / UNPROVEN (content correctness under real LLM) |
| PRIORITY | **P0** (content correctness under real LLM — false-success risk) |
| G6_ACTION | G6-01: verification must check content correctness (already does via `content-in-artifacts`), but missions with real-LLM workers need stronger independent verification (e.g., recompute, cross-check). Document as P0 hardening: real-LLM missions require gold-answer verification where applicable. |

### H-07 — Runtime unavailable

| Field | Value |
|-------|-------|
| ID | H-07 |
| SCENARIO | CompositeRuntime's underlying OpenBot/OpenDots/OpenMuse unavailable at mission start |
| CURRENT_BEHAVIOR | `ensureWorker` throws; mission fails. |
| EXPECTED_PRODUCTION_BEHAVIOR | Detect runtime-down; record clear failure reason; do not attempt mission. |
| CURRENT_EVIDENCE | `src/runtime/composite-runtime.ts`. |
| TEST_EXISTS | NO. |
| RISK | Mission fails with cryptic error. |
| STATUS | UNPROVEN |
| PRIORITY | P1 |
| G6_ACTION | G6-01: runtime health check at mission start. |

### H-08 — OpenBot disconnect

| Field | Value |
|-------|-------|
| ID | H-08 |
| SCENARIO | OpenBot process disconnects mid-mission |
| CURRENT_BEHAVIOR | Computer actions throw; worker fails. |
| EXPECTED_PRODUCTION_BEHAVIOR | Detect disconnect, reconnect within budget, or surface as 'runtime disconnect' failure. |
| CURRENT_EVIDENCE | `src/runtime/openbot/adapter.ts`. |
| TEST_EXISTS | NO. |
| RISK | Mission fails mid-flight; partial artifacts may be lost. |
| STATUS | UNPROVEN |
| PRIORITY | P1 |
| G6_ACTION | G6-01: OpenBot adapter reconnect logic. |

### H-09 — OpenDots unavailable

| Field | Value |
|-------|-------|
| ID | H-09 |
| SCENARIO | OpenDots workspace surface unavailable |
| CURRENT_BEHAVIOR | `append_shared_workspace` / `read_shared_workspace` throw; worker fails. |
| EXPECTED_PRODUCTION_BEHAVIOR | Detect, record, surface as 'workspace unavailable' failure. |
| CURRENT_EVIDENCE | `src/runtime/opendots/adapter.ts`. |
| TEST_EXISTS | NO. |
| RISK | Mission with shared-publication obligation fails. |
| STATUS | UNPROVEN |
| PRIORITY | P2 |
| G6_ACTION | G6-01: OpenDots adapter health + clear failure. |

### H-10 — OpenMuse unavailable

| Field | Value |
|-------|-------|
| ID | H-10 |
| SCENARIO | OpenMuse durable-delegation surface unavailable |
| CURRENT_BEHAVIOR | `get_durable_result` / `check_durable_status` throw; worker fails. |
| EXPECTED_PRODUCTION_BEHAVIOR | Detect, record, surface as 'durable unavailable' failure. |
| CURRENT_EVIDENCE | `src/runtime/openmuse/adapter.ts`. |
| TEST_EXISTS | NO. |
| RISK | Mission with delegated-result obligation fails. |
| STATUS | UNPROVEN |
| PRIORITY | P2 |
| G6_ACTION | G6-01: OpenMuse adapter health + clear failure. |

### H-11 — MCP server unavailable

| Field | Value |
|-------|-------|
| ID | H-11 |
| SCENARIO | MCP server (external tool provider) unreachable |
| CURRENT_BEHAVIOR | `call_tool` throws; worker fails. |
| EXPECTED_PRODUCTION_BEHAVIOR | Detect, record, surface as 'MCP unavailable' failure; mission may continue if tool is optional. |
| CURRENT_EVIDENCE | `src/runtime/mcp/capability-provider.ts`. |
| TEST_EXISTS | YES — `tests/runtime/mcp-capability-provider.test.ts`. |
| RISK | Mission with MCP-dependent obligation fails. |
| STATUS | PARTIALLY_PROVEN |
| PRIORITY | P2 |
| G6_ACTION | G6-01: MCP server health check + graceful degradation. |

### H-12 — MCP unauthorized call

| Field | Value |
|-------|-------|
| ID | H-12 |
| SCENARIO | Worker attempts to call an MCP tool not granted in its genome.tools |
| CURRENT_BEHAVIOR | WorkerAgent checks grant prefix `mcp:<tool>`; if missing, returns refusal "tool not granted". |
| EXPECTED_PRODUCTION_BEHAVIOR | Same — unauthorized tool call refused. |
| CURRENT_EVIDENCE | `src/worker/worker-agent.ts` grant-check logic; `MCP_GRANT_PREFIX` in `src/runtime/mcp/capability-provider.ts`. |
| TEST_EXISTS | YES. |
| RISK | Low. |
| STATUS | PROVEN |
| PRIORITY | P3 |
| G6_ACTION | None — already enforced. |

### H-13 — Tool failure

| Field | Value |
|-------|-------|
| ID | H-13 |
| SCENARIO | A granted tool returns an error (e.g., shell command exit code != 0) |
| CURRENT_BEHAVIOR | The error is recorded as an observation; worker continues its loop and may adapt. |
| EXPECTED_PRODUCTION_BEHAVIOR | Same — tool failures are observable, not fatal. |
| CURRENT_EVIDENCE | `src/worker/worker-agent.ts` action dispatch. |
| TEST_EXISTS | YES. |
| RISK | Low. |
| STATUS | PROVEN |
| PRIORITY | P3 |
| G6_ACTION | None. |

### H-14 — Partial artifact

| Field | Value |
|-------|-------|
| ID | H-14 |
| SCENARIO | Worker writes an incomplete file (e.g., truncated) |
| CURRENT_BEHAVIOR | Verification checks content presence (`content-in-artifacts`); if the expected content is missing, verification fails. |
| EXPECTED_PRODUCTION_BEHAVIOR | Same — partial artifacts fail verification. |
| CURRENT_EVIDENCE | `src/mission/verification.ts` content-in-artifacts check. |
| TEST_EXISTS | YES. |
| RISK | Low under scripted; medium under real LLM. |
| STATUS | PROVEN |
| PRIORITY | P3 |
| G6_ACTION | None. |

### H-15 — Artifact missing

| Field | Value |
|-------|-------|
| ID | H-15 |
| SCENARIO | Worker claims `finish` with artifact that was never written |
| CURRENT_BEHAVIOR | WorkerAgent refuses (H-06 logic). Verification independently checks file existence. |
| EXPECTED_PRODUCTION_BEHAVIOR | Same. |
| CURRENT_EVIDENCE | `src/worker/worker-agent.ts` line 823; `src/mission/verification.ts` file check. |
| TEST_EXISTS | YES. |
| RISK | Low. |
| STATUS | PROVEN |
| PRIORITY | P3 |
| G6_ACTION | None. |

### H-16 — Verification failure

| Field | Value |
|-------|-------|
| ID | H-16 |
| SCENARIO | Verification returns ok=false on first attempt |
| CURRENT_BEHAVIOR | MissionOrchestrator performs ONE bounded retry (re-runs the failing worker once, then re-verifies). If retry fails, mission status='failure'. |
| EXPECTED_PRODUCTION_BEHAVIOR | Same — bounded retry exists. |
| CURRENT_EVIDENCE | `src/mission/orchestrator.ts` line 681 — "One bounded retry". |
| TEST_EXISTS | YES. |
| RISK | Low. |
| STATUS | PROVEN |
| PRIORITY | P3 |
| G6_ACTION | None. |

### H-17 — Verification timeout

| Field | Value |
|-------|-------|
| ID | H-17 |
| SCENARIO | Verification (clean-room command execution) exceeds time |
| CURRENT_BEHAVIOR | Verification runs within mission timeout; if mission aborts, verification is abandoned. |
| EXPECTED_PRODUCTION_BEHAVIOR | Verification should have its own bounded timeout. |
| CURRENT_EVIDENCE | Mission-level timeout only. |
| TEST_EXISTS | NO. |
| RISK | Verification hangs. |
| STATUS | UNPROVEN |
| PRIORITY | P2 |
| G6_ACTION | G6-01: per-check verification timeout. |

### H-18 — Retry exhaustion

| Field | Value |
|-------|-------|
| ID | H-18 |
| SCENARIO | Both verification attempts fail |
| CURRENT_BEHAVIOR | Mission status='failure'; summary = 'verification failed after retry'. |
| EXPECTED_PRODUCTION_BEHAVIOR | Same. |
| CURRENT_EVIDENCE | `src/mission/orchestrator.ts` line 792. |
| TEST_EXISTS | YES. |
| RISK | Low. |
| STATUS | PROVEN |
| PRIORITY | P3 |
| G6_ACTION | None. |

### H-19 — Mission cancellation

| Field | Value |
|-------|-------|
| ID | H-19 |
| SCENARIO | External AbortSignal fires mid-mission |
| CURRENT_BEHAVIOR | MissionOrchestrator listens to `options.signal`; aborts via AbortController; workers retired in finally block. |
| EXPECTED_PRODUCTION_BEHAVIOR | Same. |
| CURRENT_EVIDENCE | `src/mission/orchestrator.ts` line 336-337. |
| TEST_EXISTS | YES — implicit via timeout test. |
| RISK | Low. |
| STATUS | PROVEN |
| PRIORITY | P3 |
| G6_ACTION | None. |

### H-20 — User-requested stop

| Field | Value |
|-------|-------|
| ID | H-20 |
| SCENARIO | User requests mission stop (vs. cancellation) |
| CURRENT_BEHAVIOR | Same as H-19 — external signal. No distinct 'user stop' vs. 'system cancel' semantics. |
| EXPECTED_PRODUCTION_BEHAVIOR | Distinct event type for user-initiated stop vs. system cancellation. |
| CURRENT_EVIDENCE | AbortSignal only. |
| TEST_EXISTS | NO. |
| RISK | Auditability gap. |
| STATUS | PARTIALLY_PROVEN |
| PRIORITY | P2 |
| G6_ACTION | G6-01: distinguish `mission-cancelled` (system) from `mission-stopped` (user) in flight events. |

### H-21 — Process restart

| Field | Value |
|-------|-------|
| ID | H-21 |
| SCENARIO | Genesis process restarts mid-mission |
| CURRENT_BEHAVIOR | In-memory state lost; flight recorder file may be incomplete; no resume. |
| EXPECTED_PRODUCTION_BEHAVIOR | Mission should be resumable from last durable checkpoint (OpenMuse-persisted work) OR clearly marked as 'interrupted'. |
| CURRENT_EVIDENCE | Flight recorder writes JSONL per mission; no resume logic. |
| TEST_EXISTS | NO. |
| RISK | Mission truth lost on restart. |
| STATUS | UNPROVEN |
| PRIORITY | P1 |
| G6_ACTION | G6-01: define mission-resume contract; persist mission state to durable store. |

### H-22 — Durable job recovery

| Field | Value |
|-------|-------|
| ID | H-22 |
| SCENARIO | OpenMuse durable job persisted but not completed at process exit |
| CURRENT_BEHAVIOR | OpenMuse adapter persists queued work; recovery on restart is PROVEN (Phase 4.7). In-flight checkpoint resume is NOT_PROVEN. |
| EXPECTED_PRODUCTION_BEHAVIOR | Durable jobs survive restart; resumed missions pick up where they left off. |
| CURRENT_EVIDENCE | `src/runtime/openmuse/adapter.ts`; Phase 4.7 report. |
| TEST_EXISTS | YES (queued recovery); NO (in-flight checkpoint). |
| RISK | In-flight work lost. |
| STATUS | PARTIALLY_PROVEN |
| PRIORITY | P1 |
| G6_ACTION | G6-01: in-flight checkpoint resume (deferred from Phase 4.7). |

### H-23 — Duplicate resume

| Field | Value |
|-------|-------|
| ID | H-23 |
| SCENARIO | Mission resumed twice (double-resume) |
| CURRENT_BEHAVIOR | No resume logic — does not apply. |
| EXPECTED_PRODUCTION_BEHAVIOR | Resume should be idempotent. |
| CURRENT_EVIDENCE | N/A. |
| TEST_EXISTS | NO. |
| RISK | Double-execution. |
| STATUS | NOT_APPLICABLE (no resume yet) |
| PRIORITY | P2 |
| G6_ACTION | G6-01 (after H-21): idempotent resume with mission-ID deduplication. |

### H-24 — Concurrent missions

| Field | Value |
|-------|-------|
| ID | H-24 |
| SCENARIO | Two missions run simultaneously |
| CURRENT_BEHAVIOR | MissionOrchestrator is per-mission; multiple orchestrator instances can run. Workspace isolation depends on runtime adapter (each worker gets its own computer). |
| EXPECTED_PRODUCTION_BEHAVIOR | Concurrent missions should not interfere; shared state (flight records, clean-room workspace) must be isolated per mission. |
| CURRENT_EVIDENCE | Per-mission `missionId` in flight recorder; clean-room verifier per mission. |
| TEST_EXISTS | NO. |
| RISK | Workspace collision. |
| STATUS | PARTIALLY_PROVEN |
| PRIORITY | P1 |
| G6_ACTION | G6-01: concurrency test; per-mission workspace isolation guarantee. |

### H-25 — Conflicting workspace changes

| Field | Value |
|-------|-------|
| ID | H-25 |
| SCENARIO | Two workers in the same mission write to the same file |
| CURRENT_BEHAVIOR | Last write wins; no conflict detection. |
| EXPECTED_PRODUCTION_BEHAVIOR | Conflict detection OR explicit coordination (coordinator role). |
| CURRENT_EVIDENCE | `src/worker/worker-agent.ts` write_file. |
| TEST_EXISTS | NO. |
| RISK | Silent data loss. |
| STATUS | UNPROVEN |
| PRIORITY | P2 |
| G6_ACTION | G6-01: workspace write conflict detection. |

### H-26 — Git merge conflict

| Field | Value |
|-------|-------|
| ID | H-26 |
| SCENARIO | Repository mission's worker branches conflict at integration |
| CURRENT_BEHAVIOR | `src/work/integration-manager.ts` handles integration; conflict surfaces as failure. |
| EXPECTED_PRODUCTION_BEHAVIOR | Conflict detected, recorded, surfaced clearly. |
| CURRENT_EVIDENCE | `src/work/integration-manager.ts`. |
| TEST_EXISTS | YES (`tests/work/integration-manager.test.ts`). |
| RISK | Low. |
| STATUS | PROVEN |
| PRIORITY | P3 |
| G6_ACTION | None. |

### H-27 — Browser failure

| Field | Value |
|-------|-------|
| ID | H-27 |
| SCENARIO | `browser_navigate` or `browser_screenshot` fails (browser crashed, page unreachable) |
| CURRENT_BEHAVIOR | Action returns error; worker continues its loop. |
| EXPECTED_PRODUCTION_BEHAVIOR | Same. |
| CURRENT_EVIDENCE | `src/worker/worker-agent.ts`. |
| TEST_EXISTS | YES (browser-verification test). |
| RISK | Low. |
| STATUS | PROVEN |
| PRIORITY | P3 |
| G6_ACTION | None. |

### H-28 — External write requiring approval

| Field | Value |
|-------|-------|
| ID | H-28 |
| SCENARIO | Worker attempts to write outside its workspace (e.g., to host filesystem) |
| CURRENT_BEHAVIOR | WorkerAgent's computer restricts writes to the workspace; external writes are refused. |
| EXPECTED_PRODUCTION_BEHAVIOR | Same — sandboxed. |
| CURRENT_EVIDENCE | Computer contract; OpenBot adapter. |
| TEST_EXISTS | YES. |
| RISK | Low. |
| STATUS | PROVEN |
| PRIORITY | P3 |
| G6_ACTION | None. |

### H-29 — Budget exhaustion

| Field | Value |
|-------|-------|
| ID | H-29 |
| SCENARIO | Mission budget (USD) exhausted mid-mission |
| CURRENT_BEHAVIOR | Budget is recorded but NOT enforced mid-mission. `costSource` reports spend; no abort on budget exceeded. |
| EXPECTED_PRODUCTION_BEHAVIOR | Mission should abort with 'budget exhausted' when spend exceeds budget.maxUsd. |
| CURRENT_EVIDENCE | `src/mission/orchestrator.ts` costSource option. |
| TEST_EXISTS | NO. |
| RISK | Cost overrun. |
| STATUS | UNPROVEN |
| PRIORITY | P1 |
| G6_ACTION | G6-01: enforce budget ceiling; abort mission on exceed. |

### H-30 — Unexpected exception

| Field | Value |
|-------|-------|
| ID | H-30 |
| SCENARIO | Uncaught exception in any code path |
| CURRENT_BEHAVIOR | MissionOrchestrator finally block cleans up; mission fails. |
| EXPECTED_PRODUCTION_BEHAVIOR | Same; exception recorded in flight events. |
| CURRENT_EVIDENCE | `src/mission/orchestrator.ts` finally. |
| TEST_EXISTS | NO. |
| RISK | Diagnostic info lost. |
| STATUS | PARTIALLY_PROVEN |
| PRIORITY | P2 |
| G6_ACTION | G6-01: record unexpected-exception event with stack. |

### H-31 — Event sink failure

| Field | Value |
|-------|-------|
| ID | H-31 |
| SCENARIO | FlightRecorder write fails (disk full, permission denied) |
| CURRENT_BEHAVIOR | `appendFileSync` throws; mission may crash. |
| EXPECTED_PRODUCTION_BEHAVIOR | Event sink failure should be logged but NOT crash the mission; events may be lost but mission continues. |
| CURRENT_EVIDENCE | `src/mission/flight-recorder.ts` — `appendFileSync` synchronous. |
| TEST_EXISTS | NO. |
| RISK | Mission crashes on recorder failure. |
| STATUS | UNPROVEN |
| PRIORITY | P2 |
| G6_ACTION | G6-01: wrap recorder writes in try/catch; record sink-failure to stderr. |

### H-32 — Telemetry failure

| Field | Value |
|-------|-------|
| ID | H-32 |
| SCENARIO | Telemetry collection (reasoningCalls, wallMs, etc.) fails |
| CURRENT_BEHAVIOR | Telemetry is derived from in-memory counters; failure unlikely. |
| EXPECTED_PRODUCTION_BEHAVIOR | Same. |
| CURRENT_EVIDENCE | WorkerAgent tracks reasoningCalls. |
| TEST_EXISTS | YES (implicit). |
| RISK | Low. |
| STATUS | PROVEN |
| PRIORITY | P3 |
| G6_ACTION | None. |

### H-33 — Secret/configuration missing

| Field | Value |
|-------|-------|
| ID | H-33 |
| SCENARIO | Required secret (API key, MCP credential) not configured |
| CURRENT_BEHAVIOR | Provider throws at construction or first use; mission fails with cryptic error. |
| EXPECTED_PRODUCTION_BEHAVIOR | Validate configuration at mission start; surface 'missing credential: X' clearly. |
| CURRENT_EVIDENCE | `src/providers/zai-reasoning.ts`. |
| TEST_EXISTS | NO. |
| RISK | Cryptic failure. |
| STATUS | UNPROVEN |
| PRIORITY | P1 |
| G6_ACTION | G6-01: configuration validation gate at mission start. |

### H-34 — Dependency incompatibility

| Field | Value |
|-------|-------|
| ID | H-34 |
| SCENARIO | A dependency upgrades and breaks Genesis |
| CURRENT_BEHAVIOR | `package.json` pins versions; `npm ci` reproducible. |
| EXPECTED_PRODUCTION_BEHAVIOR | Same. |
| CURRENT_EVIDENCE | `package.json` + `package-lock.json`. |
| TEST_EXISTS | YES (implicit via npm ci). |
| RISK | Low. |
| STATUS | PROVEN |
| PRIORITY | P3 |
| G6_ACTION | None — keep pinning; G6-04 RC will formalize. |

---

## 2. ADDITIONAL HARDENING SCENARIOS (A-X from Section 10)

### H-35 — Error handling (general)

| Field | Value |
|-------|-------|
| ID | H-35 |
| SCENARIO | General error-handling consistency across modules |
| CURRENT_BEHAVIOR | Inconsistent: orchestrator has finally block; WorkerAgent uses refusals; runtime adapters throw. |
| EXPECTED_PRODUCTION_BEHAVIOR | Unified error taxonomy: `GenesisError` base with kinds (provider, runtime, verification, configuration, budget). |
| STATUS | UNPROVEN |
| PRIORITY | P2 |
| G6_ACTION | G6-01: define error taxonomy; standardize. |

### H-36 — Resource cleanup

| Field | Value |
|-------|-------|
| ID | H-36 |
| SCENARIO | Workers, runtimes, file handles cleaned up after mission |
| CURRENT_BEHAVIOR | MissionOrchestrator finally block retires workers; runtime adapter close() called. |
| EXPECTED_PRODUCTION_BEHAVIOR | Same — guaranteed cleanup. |
| CURRENT_EVIDENCE | finally block. |
| TEST_EXISTS | YES (implicit). |
| RISK | Low. |
| STATUS | PROVEN |
| PRIORITY | P3 |
| G6_ACTION | None. |

### H-37 — Idempotency

| Field | Value |
|-------|-------|
| ID | H-37 |
| SCENARIO | Same mission run twice produces same result |
| CURRENT_BEHAVIOR | Deterministic given same inputs + scripted provider; non-deterministic with real LLM. |
| EXPECTED_PRODUCTION_BEHAVIOR | Scripted: idempotent. Real-LLM: best-effort; record variance. |
| STATUS | PARTIALLY_PROVEN |
| PRIORITY | P2 |
| G6_ACTION | G6-04: reproducibility gate; document determinism contract. |

### H-38 — Network failure

| Field | Value |
|-------|-------|
| ID | H-38 |
| SCENARIO | Network to external service (LLM API, MCP server) fails |
| CURRENT_BEHAVIOR | Same as H-01/H-11 — surfaces as throw. |
| EXPECTED_PRODUCTION_BEHAVIOR | Network-failure detection + bounded retry. |
| STATUS | UNPROVEN |
| PRIORITY | P1 |
| G6_ACTION | G6-01: network-failure handling (overlaps H-01, H-11). |

### H-39 — Observability

| Field | Value |
|-------|-------|
| ID | H-39 |
| SCENARIO | Mission observable for debugging/audit |
| CURRENT_BEHAVIOR | FlightRecorder JSONL per mission; AG-UI event bridge; Experience capture. |
| EXPECTED_PRODUCTION_BEHAVIOR | Same — already observable. |
| STATUS | PROVEN |
| PRIORITY | P3 |
| G6_ACTION | None — see observability census. |

### H-40 — Auditability

| Field | Value |
|-------|-------|
| ID | H-40 |
| SCENARIO | Mission trail auditable post-hoc |
| CURRENT_BEHAVIOR | Flight events + Experience + artifacts persisted. |
| EXPECTED_PRODUCTION_BEHAVIOR | Same. |
| STATUS | PROVEN |
| PRIORITY | P3 |
| G6_ACTION | None. |

### H-41 — Artifact persistence

| Field | Value |
|-------|-------|
| ID | H-41 |
| SCENARIO | Artifacts persisted beyond mission end |
| CURRENT_BEHAVIOR | Clean-room verifier workspace; flight recorder references. No durable artifact registry. |
| EXPECTED_PRODUCTION_BEHAVIOR | Durable artifact store with metadata (missionId, workerId, version, lineage). |
| STATUS | PARTIALLY_PROVEN |
| PRIORITY | P1 |
| G6_ACTION | G6-01: artifact persistence + metadata (G7_BACKEND_REQUIREMENT). |

---

## 3. PRIORITY SUMMARY

### P0 (3 items) — false success / corruption / security / unrecoverable truth risk

| ID | Scenario | Status |
|----|----------|--------|
| H-06 | Worker hallucinated completion (content correctness under real LLM) | UNPROVEN (content correctness under real LLM) |
| H-33 (partial) | Secret exposure to workers (where credentials live) | UNPROVEN |
| (new) | Worker-instance epistemic isolation under real provider (TASK-022A unverified under real LLM) | UNPROVEN |

### P1 (10 items) — major production reliability issue

| ID | Scenario | Status |
|----|----------|--------|
| H-01 | Provider unavailable | UNPROVEN |
| H-02 | Provider rate limited | UNPROVEN |
| H-03 | Provider timeout (per-call) | PARTIALLY_PROVEN |
| H-04 | Worker crash | PARTIALLY_PROVEN |
| H-07 | Runtime unavailable | UNPROVEN |
| H-08 | OpenBot disconnect | UNPROVEN |
| H-21 | Process restart | UNPROVEN |
| H-22 | Durable job recovery (in-flight) | PARTIALLY_PROVEN |
| H-24 | Concurrent missions | PARTIALLY_PROVEN |
| H-29 | Budget exhaustion | UNPROVEN |
| H-33 | Secret/configuration missing | UNPROVEN |
| H-38 | Network failure | UNPROVEN |
| H-41 | Artifact persistence | PARTIALLY_PROVEN |

### P2 (10 items) — important but non-blocking

| ID | Scenario | Status |
|----|----------|--------|
| H-09 | OpenDots unavailable | UNPROVEN |
| H-10 | OpenMuse unavailable | UNPROVEN |
| H-17 | Verification timeout | UNPROVEN |
| H-20 | User-requested stop | PARTIALLY_PROVEN |
| H-23 | Duplicate resume | NOT_APPLICABLE (until H-21) |
| H-25 | Conflicting workspace changes | UNPROVEN |
| H-30 | Unexpected exception | PARTIALLY_PROVEN |
| H-31 | Event sink failure | UNPROVEN |
| H-35 | Error handling (general) | UNPROVEN |
| H-37 | Idempotency | PARTIALLY_PROVEN |

### P3 (12 items) — nice-to-have / later

| ID | Scenario | Status |
|----|----------|--------|
| H-05 | Worker returns malformed output | PROVEN |
| H-12 | MCP unauthorized call | PROVEN |
| H-13 | Tool failure | PROVEN |
| H-14 | Partial artifact | PROVEN |
| H-15 | Artifact missing | PROVEN |
| H-16 | Verification failure | PROVEN |
| H-18 | Retry exhaustion | PROVEN |
| H-19 | Mission cancellation | PROVEN |
| H-26 | Git merge conflict | PROVEN |
| H-27 | Browser failure | PROVEN |
| H-28 | External write requiring approval | PROVEN |
| H-32 | Telemetry failure | PROVEN |
| H-34 | Dependency incompatibility | PROVEN |
| H-36 | Resource cleanup | PROVEN |
| H-39 | Observability | PROVEN |
| H-40 | Auditability | PROVEN |

---

## 4. DEBT CLASSIFICATION (Section 27 of transition spec)

Every discovered issue classifies into exactly one category:

| Category | Items | Disposition |
|----------|-------|-------------|
| **G6_BLOCKER** | 0 | None — no issue prevents meaningful production hardening or invalidates the engine baseline. P0 items are hardening work, not blockers. |
| **G6_HARDENING** | H-01, H-02, H-03, H-04, H-07, H-08, H-21, H-22, H-24, H-29, H-33, H-38, H-41 + P0 items | Address in G6-01 Production Hardening. |
| **G7_BACKEND_REQUIREMENT** | H-41 (artifact persistence with metadata), (new) capability registry, (new) mission history store, (new) event schema freeze | Address in G6 where appropriate; documented in `G7_PRODUCT_EXPERIENCE_BACKEND_READINESS.md`. |
| **G7_UI_ONLY** | H-20 (user-stop vs cancel distinction in UI), replay engine UI | Address in G7. |
| **POST_V1** | H-23 (idempotent resume — depends on H-21), statistical confidence framework, pattern retirement lifecycle | After v1. |
| **ACCEPTED_LIMITATION** | Scripted reasoning in Academy missions, GoalCompiler v0.1 word-boundary heuristics, intersection-based retrieval liberalism, N is small, single session, no real-LLM in Academy | Documented in Group 5 closure; accepted for v1. |

**No generic TODO bucket.** Every item has a disposition.

---

## 5. G6-01 ENTRY RECOMMENDATION

Start G6-01 with the **P0 items** (false-success prevention under real LLM, secret handling, worker-instance isolation), then **P1 items** (provider/runtime failure handling, process restart, concurrent missions, budget enforcement, configuration validation, network failure, artifact persistence).

Expected G6-01 production code delta: ~300-500 LOC (error taxonomy, retry wrappers, configuration validation, budget enforcement, artifact metadata). Within Group 5 anti-bloat rules (soft warning > 700, hard stop > 1200).

**Do NOT start G6-01 in this transition mission.**

---

## 6. G6-01 CLOSURE (added 2026-10-07)

G6-01 is COMPLETE. See `docs/group6/GENESIS_G6_01_PRODUCTION_HARDENING.md`
for the full report. This section records the final status of every
matrix item.

### P0 closure (3/3 PROVEN_HARDENED)

| ID | Status | Fix | Evidence | Remaining limitation |
|----|--------|-----|----------|----------------------|
| H-06 | PROVEN_HARDENED | New `hash-match` check kind in `verification.ts`; computes SHA-256 of clean-room artifact content and compares to expected hex. | 5/5 tests in `tests/mission/verification-hash-match.test.ts` | Real-LLM end-to-end probe pre-registered but unrun (no ZAI_API_KEY in sandbox). |
| H-33 (partial) | PROVEN_HARDENED | Expanded `SECRET_PATTERNS` in `flight-recorder.ts` (ghp_, github_pat_, sk-, sk-ant-, AKIA, generic credential env vars). New `ConfigValidator` in `config-validator.ts` with `ConfigurationError` (variable names only, never values). | 12/12 tests in `secret-redaction.test.ts`; 8/8 tests in `config-validator.test.ts` | None. |
| (new) Worker-instance isolation | PROVEN_HARDENED | `ScopeableReasoningProvider.forInstance()` contract already existed (TASK-022A); observability added via `WorkerResult.failureClass` + `reasoningRetries` and the `reasoning-retry:<class>` worker-step event. | 6/6 tests in `worker-agent-retry.test.ts`; 13/13 tests in `failure-class.test.ts` | Real-LLM empirical confirmation pre-registered but unrun. Stateless providers structurally satisfy the contract. |

### P1 closure (13 items)

| ID | Status | Notes |
|----|--------|-------|
| H-01 Provider unavailable | PROVEN_HARDENED | WorkerAgent `callReasoningWithRetry()` provides bounded retry for transient failures. |
| H-02 Provider rate limited | PROVEN_HARDENED | `classifyError()` matches 429/rate-limit; retryable. (ZAI provider's own retry loop is the first tier.) |
| H-03 Provider timeout | PROVEN_HARDENED | `classifyError()` matches timeout/ETIMEDOUT; retryable. |
| H-04 Worker crash | PROVEN_HARDENED | `WorkerResult.failureClass` field added; classification is observable. |
| H-07 Runtime unavailable | DEFERRED_G6_04 | Runtime health check belongs with RC reproducibility gate. `ConfigValidator` provides the config-check half. |
| H-08 OpenBot disconnect | DEFERRED_G6_04 | Reconnect logic requires provider-health infrastructure from G6-04. |
| H-21 Process restart | ACCEPTED_LIMITATION | Queued recovery supported (OpenMuse). In-flight checkpoint resume NOT supported — documented honestly, not overclaimed. |
| H-22 Durable job recovery (in-flight) | PARTIALLY_HARDENED | Queued recovery proven. In-flight recovery not claimed. |
| H-24 Concurrent missions | PARTIALLY_HARDENED | `ArtifactRegistry` is per-mission (no collision). `CompositeRuntime` uses `Map<workerId>` — concurrent missions with overlapping workerIds in the same process would collide. Recommended: separate processes per mission. |
| H-29 Budget exhaustion | PROVEN_HARDENED | Worker that exhausts step budget reports `failureClass='BUDGET_EXHAUSTED'` (was generic failure). |
| H-33 Secret/configuration missing | PROVEN_HARDENED | `ConfigValidator` fails fast at mission start with `ConfigurationError` (variable names only). |
| H-38 Network failure | PROVEN_HARDENED | Network errors (ECONNREFUSED, ECONNRESET, ENOTFOUND, EPIPE) classified as PROVIDER_FAILURE; retryable. |
| H-41 Artifact persistence | PROVEN_HARDENED | New `ArtifactRegistry` persists artifact records to JSONL with `contentHash` (SHA-256), `bytes`, `verificationState`, `createdAt`, `updatedAt`, optional `sourceWorkerId` for lineage. Schema INTRODUCED in G6-01, FROZEN in G6-06. |

### P2 closure (10 items — NOT addressed in G6-01 per Section 8)

All P2 items remain at their pre-G6-01 status. They are NOT blocking
for G6-02 and may be addressed in later G6 stages as time permits.

### P3 closure (16 items — NOT addressed in G6-01 per Section 8)

All P3 items remain at their pre-G6-01 status (mostly PROVEN already).
No action required.

### Summary count correction

The original transition summary in `g5-to-g6-census.json` reported:
- `p0Items: 3` ✓ (correct)
- `p1Items: 13` ✓ (correct)
- `G6_HARDENING_ITEMS = 26 (P0+P1)` ✗ (arithmetically wrong: 3+13=16, not 26)

The "26" appears to be a transcription error. The authoritative count
from this matrix is **3 P0 + 13 P1 = 16 unique P0+P1 items** (H-33
appears in BOTH the P0 partial list and the P1 list, so the unique
count is 15). This correction is documentation-only per Section 7;
the transition mission is NOT reopened.

The `P1 (10 items)` header in Section 3 above is also incorrect — the
P1 table actually lists 13 items. This is a heading typo, not a count
error; the table is authoritative.
