# G6-07 Root Cause Analysis

**Audited commit:** `8e0ba68d8764d5769127b821cfc2b05918ca8810`

This document groups the 90 G6-07 findings into root-cause clusters. Each cluster represents a systemic deficiency where a single architectural or implementation gap produces multiple observed defects. Fixing the root cause eliminates the entire defect family; fixing only the symptoms leaves the family intact.

---

## Cluster Summary

| Cluster | Title | Findings Covered | Priority |
|---------|-------|------------------|----------|
| RC-1 | Production wiring structurally asymmetric with dev wiring | 7 | P0 |
| RC-2 | Mutable shared state across missions (deterministic worker IDs) | 4 | P0 |
| RC-3 | Test infrastructure masquerading as production infrastructure | 6 | P0 |
| RC-4 | Documentation drift — release docs describe G6-04 behavior | 18 | P1 |
| RC-5 | Production code imports test infrastructure | 1 | P2 |
| RC-6 | Unbounded in-memory state with no eviction policy | 8 | P1 |
| RC-7 | Missing verification lifecycle invariants | 5 | P1 |

**Total findings covered by root-cause clusters: 49 of 90.** The remaining 41 findings are isolated defects that do not share a systemic root cause (e.g., specific secret-redaction pattern gaps, specific AG-UI schema violations, specific federation edge cases). These are addressed individually in `remediation-plan.md`.

---

## RC-1 — Production wiring structurally asymmetric with dev wiring

**Description:** The dev-mode `buildDefaultRuntime()` returns `{ runtime, computers }` where the runtime's `ensureWorker` closure populates the `computers` Map. The production-mode `buildRealRuntime()` returns `{ runtime, computers: new Map() }` where the OpenBot adapter populates its OWN internal `computers` Map, not the empty one handed to MissionService. This structural asymmetry means production-mode artifact retrieval, verification-result capture, and concurrent-mission isolation all silently break.

**Findings covered:**
- B-EXEC-FINDING-001 (RB-1): Production `getArtifacts()` returns `[]`
- B-EXEC-FINDING-002 (RB-2): Concurrent production missions collide on shared adapter
- B-EXEC-FINDING-003: No graceful teardown of OpenBot workers on shutdown
- B-EXEC-FINDING-006: No startup validation of `OPENBOT_CHECKOUT_DIR` exists, `bun` on PATH, ZAI SDK importable
- B-EXEC-FINDING-007: Production code imports test helper module
- C-LEARNING-FINDING-015: Production mode shares single adapter; concurrent missions contaminate
- C-LEARNING-FINDING-016: Production mode `getArtifacts` returns empty array

**Recommended correction:** Make `runtimeFactory` return a fresh adapter per mission that exposes its internal `computers` Map (or expose an artifact-retrieval adapter method). This single change eliminates RB-1, RB-2, and the concurrent-contamination findings. The fresh-per-mission contract also matches the dev-mode semantics, restoring structural symmetry.

**Estimated impact:** Eliminates 7 findings, including 2 of the 3 release blockers.

**Primitives reused:** `OpenBotRuntimeAdapter` constructor already accepts `opts: { checkoutDir, rootDir }` — no new constructor needed. The adapter's internal `computers` Map already exists at `adapter.ts:49` — just needs an accessor.

**New code required:** A `computersForMission(): Map<string, WorkerComputer>` accessor on `OpenBotRuntimeAdapter` (or equivalent). The `runtimeFactory` closure in `main.ts:248-252` changes from returning the shared adapter to constructing a fresh one per call.

**Regression risk:** Low. Dev-mode tests already use the fresh-per-mission pattern. Production-mode tests do not exist (which is why RB-1 and RB-2 shipped). Adding a positive production-mode integration test is part of the fix.

---

## RC-2 — Mutable shared state across missions (deterministic worker IDs)

**Description:** Worker IDs are deterministic by role (`generalist-worker-1`, `mission-coordinator-1`, `mission-verifier-1`). The verifier genome hardcodes `identity.id = 'mission-verifier-1'` for every mission (`orchestrator.ts:207`). `OpenBotRuntimeAdapter.ensureWorker` is idempotent by botId — a second `ensureWorker` for the same botId returns the EXISTING worker handle. Combined with RC-1 (shared adapter across missions), two concurrent missions produce workers that share the same child process, the same workspace directory, and the same computer token.

**Findings covered:**
- B-EXEC-FINDING-002 (RB-2): Concurrent production missions collide
- C-VERIFY-FINDING-002: Verifier clean-room workspace never cleared between verify() calls
- C-VERIFY-FINDING-003: Hardcoded verifier genome `mission-verifier-1` collides across concurrent missions
- E-CONCURRENCY-FINDING-005: Shared runtime adapter + hardcoded verifier genome = concurrent-mission verifier collision

**Recommended correction:** Either (a) namespace worker IDs by missionId (e.g., `mission-verifier-1` → `${missionId}-mission-verifier-1`), or (b) give each mission its own adapter (see RC-1 fix). Option (b) is preferred because it also fixes RC-1. Option (a) is more invasive (requires changes in the orchestrator, planner, and genome compiler) but does not require per-mission adapter construction.

**Estimated impact:** Eliminates 4 findings. Combined with RC-1, eliminates the entire concurrent-mission collision family.

**Primitives reused:** `randomBytes` from `node:crypto` is already used for mission IDs (`orchestrator.ts:220-226`). The same primitive can namespace worker IDs.

**New code required:** If option (a): a `missionId` parameter threaded through `verifierGenome()`, `OrganizationPlanner.plan()`, and `GenomeCompiler.compilePlan()`. If option (b): the RC-1 fix.

**Regression risk:** Medium for option (a) — changes the worker ID contract, which may affect tests that assert specific worker IDs. Low for option (b) — only changes the factory closure.

---

## RC-3 — Test infrastructure masquerading as production infrastructure

**Description:** Tests spawn the gateway via `npx tsx src/gateway/main.ts` and kill via `child.kill('SIGTERM')`. The `npx` shim creates a two-level process tree; `child.kill` delivers SIGTERM only to the npx parent. The actual gateway (grandchild) is orphaned, reparented to PID 1, keeps its ports open, and the `process.on('SIGTERM')` handler in `main.ts:284` is never invoked. The `detached: true` + `process.kill(-pgid, signal)` pattern is already correctly implemented in `src/runtime/openbot/computer-process.ts:173-290` — the gateway tests should mirror it.

**Findings covered:**
- B-GATEWAY-FINDING-001 (RB-3): `child.kill('SIGTERM')` on npx tsx kills only npx parent
- B-GATEWAY-FINDING-002: `startHttpServer` calls `server.listen()` without awaiting the 'listening' event
- B-GATEWAY-FINDING-003: `setTimeout` pads mask the listen-race
- B-GATEWAY-FINDING-004: Clean-room script polling cannot distinguish fresh gateway from stale orphan
- F-PACKAGE-FINDING-002: G6-06 clean-room script leaves orphaned gateway processes (empirical confirmation)
- F-PACKAGE-FINDING-003: G6-06 clean-room script is regressive vs G6-04 script (failure-handling)

**Recommended correction:** Three changes:
1. Spawn with `detached: true` and kill via `process.kill(-pgid, signal)` in `clean-room-gateway.test.ts`, `separate-process-e2e.test.ts`, and `clean-room-run.sh`.
2. Tighten the GATEWAY-04 assertion to verify (a) the SIGTERM handler logged `"received SIGTERM, shutting down..."`, (b) `/health` returns ECONNREFUSED after kill (port released), (c) no `pgrep -f gateway/main.ts` remains.
3. Make `startHttpServer` async and await the listening event (mirror `startA2AServer`).

**Estimated impact:** Eliminates 6 findings, including RB-3. Restores trust in the clean-room release gate.

**Primitives reused:** The `detached: true` + `process.kill(-pgid, signal)` + cwd-sweep pattern from `src/runtime/openbot/computer-process.ts:173-290` is the reference implementation.

**New code required:** Test-side changes only. No production code changes (except making `startHttpServer` async, which is a 3-line change).

**Regression risk:** Low. The existing tests pass vacuously; after the fix they will actually verify shutdown. No production behavior changes.

---

## RC-4 — Documentation drift — release docs describe G6-04 behavior

**Description:** G6-06-R1 (commit `8e0ba68`) corrected `main.ts:111-153` to require `OPENBOT_CHECKOUT_DIR` and `OPENBOT_ROOT_DIR` (replacing the unsafe type-cast that read `OPENBOT_ENDPOINT`). The release docs, header comments, config-validator, evidence-index, changelog, known-limitations, and security-boundaries were never updated. No CI exists to catch the drift. The test count (525/527 vs actual 536), the dependency baseline (`@ag-ui/core@1.0.1` vs actual `1.0.2`), and even the `.gitignore` claim about `secure/` are all stale.

**Findings covered (18):**
- B-EXEC-FINDING-004: `OPENBOT_ENDPOINT` documented but never read
- G-CLAIMS-FINDING-001 through G-CLAIMS-FINDING-013 (13 documentation mismatches)
- F-PACKAGE-FINDING-004: `OPENBOT_ENDPOINT` documented as production-required but never read (empirical)
- F-PACKAGE-FINDING-010: Test-count drift across 5 docs (525/527/487 vs actual 536)
- F-PACKAGE-FINDING-011: `data/dependency-baseline.json` claims `@ag-ui/core@1.0.1` but package.json pins `1.0.2`
- F-PACKAGE-FINDING-014: `engine-v1-configuration.md` claims `secure/` is gitignored but `.gitignore` has no such entry

**Recommended correction:**
1. Update all release docs to match G6-06-R1 reality (env vars, test counts, dependency versions).
2. Add a CI step that asserts doc-claimed env vars match code, doc-claimed test counts match `vitest run`, and `.gitignore` entries match doc claims.
3. Add `secure/` to `.gitignore` (or remove the doc claim).

**Estimated impact:** Eliminates 18 findings. Prevents future drift.

**Primitives reused:** None — this is a documentation + CI fix.

**New code required:** A CI workflow (`.github/workflows/ci.yml`) running `npm ci && typecheck && lint && test` plus doc-consistency checks. Doc edits across 5+ files.

**Regression risk:** None. Documentation-only changes.

---

## RC-5 — Production code imports test infrastructure

**Description:** `src/gateway/mission-service.ts:49` imports `MemoryComputer` from `../../tests/helpers/memory-runtime.js` (runtime import, not type-only). `src/gateway/main.ts:45` imports it type-only (OK, erased at compile). The runtime import means production builds must include `tests/helpers/memory-runtime.ts` in the bundle. This inverts the usual layering invariant: production code depends on test code.

**Findings covered:**
- B-EXEC-FINDING-007: Production code imports a test helper module at runtime

**Recommended correction:** Promote `MemoryComputer` (or a slimmer dev-runtime helper) to `src/runtime/memory-computer.ts` and update imports. Alternatively, gate the import behind a dynamic `import()` inside `buildDefaultRuntime()` so production bundles can tree-shake it.

**Estimated impact:** Eliminates 1 finding. Restores layering invariant.

**Primitives reused:** `MemoryComputer` is already a self-contained class (`tests/helpers/memory-runtime.ts:17`).

**New code required:** Move the file, update 2 import sites.

**Regression risk:** Low. The move is mechanical.

---

## RC-6 — Unbounded in-memory state with no eviction policy

**Description:** The G6-06 fix added active-only COUNTING for admission control (`countActiveGlobal`, `countActiveForCaller`) but no EVICTION of terminal missions. The `missions` Map, `idempotencyIndex`, `MemoryFlightRecorder.events`, and the A2A `bindings` Map all grow monotonically for the process lifetime. There is no TTL, no LRU, no periodic sweeper, no post-terminal cleanup. A long-running gateway that processes 1,000–10,000+ missions/day will leak memory monotonically until V8 OOM.

**Findings covered:**
- B-REGISTRY-FINDING-001: Terminal missions never evicted from `MissionService.missions`
- B-REGISTRY-FINDING-002: `idempotencyIndex` grows unbounded AND prevents reuse post-terminal
- B-REGISTRY-FINDING-003: `MemoryFlightRecorder.events` array has no cap
- B-A2A-FINDING-003: `bindings` Map leaks when `execute()` never returns
- C-VERIFY-FINDING-009: Flight recorder unbounded growth; no retention policy
- C-LEARNING-FINDING-009: `MissionService.missions` + `idempotencyIndex` in-memory only; lost on restart
- C-LEARNING-FINDING-010: A2A `InMemoryTaskStore` + `bindings` in-memory only; lost on restart
- C-LEARNING-FINDING-011: Gateway uses `MemoryFlightRecorder`; no durable flight record; no replay logic

**Recommended correction:**
1. Add a retention policy for terminal missions: a periodic sweeper (every N seconds) that removes `MissionRuntime` entries whose `isTerminal(status)` is true AND whose `finishedAt` is older than a configurable retention window (e.g., `terminalMissionRetentionMs`, default 5 minutes). On eviction, also delete the `idempotencyIndex` entry.
2. Bound `MemoryFlightRecorder.events` with a configurable cap (e.g., `maxEvents`, default 1000) — drop oldest when exceeded.
3. Add a wall-clock deadline to `pollToTerminal` (B-A2A-FINDING-002) which transitively fixes the `bindings` leak.
4. For C-LEARNING-FINDING-009/010/011 (persistence): these are larger architectural decisions — see remediation-plan.md Batch 9.

**Estimated impact:** Eliminates 5 findings (B-REGISTRY-001/002/003, B-A2A-003, C-VERIFY-009). The 3 C-LEARNING persistence findings require a separate architectural decision.

**Primitives reused:** `isTerminal()` from `types.ts:61-63`. `setInterval` for the sweeper.

**New code required:** A `sweepTerminalMissions()` method on `MissionService`. A `maxEvents` option on `MemoryFlightRecorder`. A deadline parameter on `pollToTerminal`.

**Regression risk:** Medium. Existing tests assume indefinite retention (B-REGISTRY-FINDING-004). The eviction policy must be configurable so tests can set a long retention window. The post-terminal query tests (`tests/gateway/http-api.test.ts:55-64, 83-92, 94-105`) will still pass within the retention window.

---

## RC-7 — Missing verification lifecycle invariants

**Description:** The `VerificationLoop` has several latent correctness issues that share a common root: the verification lifecycle is not modeled as a state machine with invariants. Specifically: (a) the per-artifact `verified` flag is binary all-or-nothing (mission-level, not per-file), (b) the verifier workspace is never cleared between `verify()` calls (within-mission retry and cross-mission), (c) `flight-action` checks silently fail when `FileFlightRecorder` is used (because the orchestrator only passes `flightEvents` when the recorder is `MemoryFlightRecorder`), (d) `mission-input` checks use a 60-char substring fingerprint that can be fabricated, (e) unknown check kinds are silently dropped (no default case in the switch).

**Findings covered:**
- C-VERIFY-FINDING-001: Per-artifact `verified` flag is binary all-or-nothing
- C-VERIFY-FINDING-002: Verifier clean-room workspace never cleared between verify() calls
- C-VERIFY-FINDING-004: `flight-action` checks silently disabled when recorder is `FileFlightRecorder`
- C-VERIFY-FINDING-005: `mission-input` check fabrication via 60-char fingerprint substring
- C-VERIFY-FINDING-012: `VerificationLoop` never validates check structure; unknown check kinds silently dropped

**Recommended correction:**
1. Store the full `VerificationResult` (with `outcomes`) on `MissionRuntime` and read per-outcome `path`/`label` in `captureVerificationResult` to mark only paths that were actually examined.
2. At the start of `verify()`, delete the `artifacts/` subtree in the verifier's workspace.
3. Decouple event capture from durable recording: have the orchestrator keep its own in-memory `FlightEvent[]` alongside the recorder, OR add a `getEvents()` method to the `FlightRecorder` interface.
4. Auto-generate a `hash-match` check for each staged input (requires the hash-match check to read from the WORKER's workspace, not the clean-room copy).
5. Add a `default` case to the `verify` switch that pushes a failing outcome for unknown check kinds.

**Estimated impact:** Eliminates 5 findings. Restores verification integrity.

**Primitives reused:** `sha256` from `node:crypto` (already used in `checkHashMatch`). The `VerificationResult` type already carries `outcomes`.

**New code required:** A `clearArtifacts()` method on `WorkerComputer` (or a shell command in `verify()`). A `getEvents()` method on `FlightRecorder`. A `default` case in the switch.

**Regression risk:** Medium. The binary `verified` flag change may break consumers that expect `verified=true` for all files when verification passes. The fix should be accompanied by a doc update clarifying the per-artifact semantics.

---

## Findings NOT covered by root-cause clusters

The remaining 41 findings are isolated defects that do not share a systemic root cause. They are grouped by domain in `findings-detailed.md` and addressed individually in `remediation-plan.md` Batches 7–9. Notable isolated findings:

- **Security:** C-SECURITY-FINDING-001 (unrestricted `run_command`), C-PROTOCOLS-FINDING-001 (MCP prompt injection), C-PROTOCOLS-FINDING-019 (cross-caller status leak), C-PROTOCOLS-FINDING-004 (empty securitySchemes), C-PROTOCOLS-FINDING-005 (streaming truncation).
- **AG-UI schema:** C-PROTOCOLS-FINDING-006/007/008/009/010/011/018.
- **Federation:** C-PROTOCOLS-FINDING-012/013/014/015.
- **Learning (latent):** C-LEARNING-FINDING-001/002/003/004/005/006/007/008.
- **Persistence (active):** C-LEARNING-FINDING-013/014/017/018.
- **Failure injection:** D-FAILURE-FINDING-001/002/003/009.
- **Concurrency (positive):** E-CONCURRENCY-FINDING-006/007/008/009/010/011.

---

END OF ROOT CAUSE ANALYSIS.
