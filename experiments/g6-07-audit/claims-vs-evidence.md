# G6-07 Claims-vs-Evidence Audit

**Audited commit:** `8e0ba68d8764d5769127b821cfc2b05918ca8810`
**Branch:** `build/group-06-productionization`

This document compares actual code and evidence against every claim source in the repository. Each materially misleading, unsupported, or contradictory claim is flagged with `MISMATCH` status. Accurate claims are flagged `ACCURATE`.

---

## Claims-vs-Evidence Matrix

| # | Claim | Source | Reality | Status |
|---|-------|--------|---------|--------|
| 1 | `OPENBOT_ENDPOINT` is required when `GENESIS_RUNTIME_PROVIDER=openbot` | `engine-v1-configuration.md:45,84,99`; `engine-v1-install-and-run.md:98` | `main.ts:111-153` never reads it; reads only `OPENBOT_CHECKOUT_DIR`/`OPENBOT_ROOT_DIR`. Adapter spawns local process. | **MISMATCH** (G-CLAIMS-FINDING-001, F-PACKAGE-FINDING-004) |
| 2 | "Evidence and artifacts \| Verified" | `engine-v1-scope.md:31`; `engine-v1-evidence-index.md:16`; `changelog.md:14-17` | `main.ts:250` passes empty `computers` Map; OpenBot adapter populates its OWN internal map; `getArtifacts()` returns `[]` in production. | **MISMATCH** (G-CLAIMS-FINDING-002, B-EXEC-FINDING-001) |
| 3 | "No Cross-Mission Concurrency Isolation — Specialists run sequentially in v0.1" | `engine-v1-known-limitations.md:90-92` | MissionService accepts concurrent submissions; production missions share ONE OpenBotRuntimeAdapter; deterministic botIds collide. | **MISMATCH** (G-CLAIMS-FINDING-003, B-EXEC-FINDING-002) |
| 4 | "P1-REGISTRY-MEMORY-LEAK-DOS — fixed" | `changelog.md:20-23`; `final-analysis.md:88-89` | Only admission-count half fixed; eviction half mandated but NOT implemented; zero eviction code in `mission-service.ts`. | **MISMATCH** (G-CLAIMS-FINDING-004, B-REGISTRY-FINDING-001) |
| 5 | A2A cancelTask comment: "do not leak that the task exists" | `a2a-server.ts:178-181` | Code publishes taskId + FULL mission status to cross-caller — leaks existence AND state. | **MISMATCH** (G-CLAIMS-FINDING-005, B-A2A-FINDING-001, C-PROTOCOLS-FINDING-019) |
| 6 | "Clean-room reproducibility ... PASS" | `evidence-index.md:10`; `clean-room-reproduction.md:36,76`; `final-analysis.md:79,141,207` | SIGTERM kills only npx parent; gateway orphaned (B-GATEWAY); health "PASS (intermittent)"; test asserts only npx exit. | **MISMATCH** (G-CLAIMS-FINDING-006, B-GATEWAY-FINDING-001) |
| 7 | "Cancellation \| Verified" | `engine-v1-scope.md:32` | Proven ONLY with stub slowRuntime + MemoryComputer; not through OpenBot adapter. | **MISMATCH** (G-CLAIMS-FINDING-008) |
| 8 | "currentRequestCaller bridge" | `evidence-index.md:17`; `security-boundaries.md:32`; `defects-and-remediation.md:84` | Implementation uses `callerContext = new AsyncLocalStorage<CallerIdentity>()` (`a2a-server.ts:81`); renamed. | **MISMATCH** (G-CLAIMS-FINDING-009) |
| 9 | "REQUIRED_G6_06_ACTION: ... evict terminal" + "P1_FIXED = 5" | `architecture-and-risk-baseline.md:25,106`; `final-analysis.md:87-89` | Eviction code does not exist; only admission-count half implemented. | **MISMATCH** (G-CLAIMS-FINDING-010) |
| 10 | Memory: terminal missions not evicted (classified as "Hypothetical Threat") | `residual-risk-register.md:90` | Confirmed code behavior (zero eviction code); was a P1 mandate; should be Observed P2, not Hypothetical. | **MISMATCH** (G-CLAIMS-FINDING-011) |
| 11 | "Thread-safety: ... safe for concurrent start/get/cancel calls" | `mission-service.ts:138-143` | True at Map level; FALSE at runtime-isolation level (shared OpenBot adapter, deterministic botId collision). | **MISMATCH** (G-CLAIMS-FINDING-012) |
| 12 | "Production mode fail-closed \| PASS" (implies production mode is otherwise verified) | `evidence-index.md:15` | Only the fail-closed path is tested; no positive production-mode test exists. | **MISMATCH** (G-CLAIMS-FINDING-013) |
| 13 | "Cross-caller A2A cancel \| PASS" | `evidence-index.md:17`; `security-boundaries.md:32,83` | Passes in dev mode; inline comment contradicted by code (existence leak); HTTP/A2A asymmetry undisclosed. | **MISMATCH** (G-CLAIMS-FINDING-005) |
| 14 | "Restart recovery \| Unsupported" | `engine-v1-scope.md:42` | Accurate — no persistence code in `mission-service.ts`. | **ACCURATE** |
| 15 | C13 "production-ready" REJECTED | `claims-registry.json:238-254` | Accurate classification. | **ACCURATE** |
| 16 | "Cross-caller artifact access → 404" | `engine-v1-security-boundaries.md:30` | Accurate at HTTP layer; but `getArtifacts()` returns `[]` in production regardless. | **PARTIALLY ACCURATE** |

---

## Detailed Mismatch Analysis

### MISMATCH #1 — OPENBOT_ENDPOINT documented but never read (HIGH)

**The claim (verbatim):**
> `docs/release/engine-v1-configuration.md:45`: "`OPENBOT_ENDPOINT` | OpenBot server URL (required when provider=openbot)"
> `docs/release/engine-v1-configuration.md:84`: "Missing `OPENBOT_ENDPOINT` when `GENESIS_RUNTIME_PROVIDER=openbot` → gateway refuses to start."
> `docs/release/engine-v1-install-and-run.md:98`: `export OPENBOT_ENDPOINT="http://your-openbot-server:port"`

**The reality:**
- `src/gateway/main.ts:111-153` `buildRealRuntime()` reads ONLY `OPENBOT_CHECKOUT_DIR` and `OPENBOT_ROOT_DIR`.
- The OpenBot adapter (`src/runtime/openbot/adapter.ts`) spawns a local process (`computer-process.ts:173`); it has no HTTP endpoint parameter.
- Setting `OPENBOT_ENDPOINT` has zero effect; omitting it does NOT cause fail-closed.
- The G6-04 audit (`experiments/g6-04/evidence/configuration-matrix.json:20`) correctly classified it as a TEST env var; the G6-06 release docs regressed.
- **Empirically reproduced** by F-PACKAGE-FINDING-004: gateway fail-closed with `FATAL: GENESIS_RUNTIME_PROVIDER=openbot requires OPENBOT_CHECKOUT_DIR` when only `OPENBOT_ENDPOINT` was set.

**Minimal fix:** Replace `OPENBOT_ENDPOINT` with `OPENBOT_CHECKOUT_DIR` and `OPENBOT_ROOT_DIR` in the docs; delete the false fail-closed claim. Remove stale docstring at `main.ts:30`.

---

### MISMATCH #2 — "Evidence and artifacts \| Verified" (CRITICAL)

**The claim (verbatim):**
> `docs/release/engine-v1-scope.md:31`: "Evidence and artifacts | Verified"
> `docs/release/engine-v1-evidence-index.md:16`: "Per-artifact verified flag | ... PASS"
> `docs/release/engine-v1-changelog.md:14-17`: "P1-ARTIFACTS-VERIFIED-HARDCODED — `getArtifacts()` now tracks per-artifact verification outcome"

**The reality:**
- `src/gateway/main.ts:250` wires production `runtimeFactory` to `() => ({ runtime: runtimeBuild.runtime, computers: runtimeBuild.computers })`, where `runtimeBuild.computers = new Map()` (`main.ts:145`).
- The `OpenBotRuntimeAdapter` maintains its OWN internal `computers` map (`adapter.ts:49`), populates it inside `ensureWorker` (`adapter.ts:108`), and NEVER writes to the empty map passed by `main.ts`.
- `MissionService.getArtifacts()` iterates `rt.computers` (`mission-service.ts:366-383`) → empty in production → `[]`.
- All artifact tests run in dev mode (`tests/gateway/http-api.test.ts`, `tests/gateway/e2e.test.ts`, `tests/gateway/isolation.test.ts` — all use the default `MemoryRuntime`).

**Minimal fix:** Code: expose the adapter's internal computers map (or have `MissionService` record workerIds and read via `adapter.computer()`). Doc: change "Verified" → "Limited — verified in development mode only".

---

### MISMATCH #3 — "No Cross-Mission Concurrency Isolation" understates the defect (CRITICAL)

**The claim (verbatim):**
> `docs/release/engine-v1-known-limitations.md:90-92`: "Specialists run sequentially in v0.1. No parallel execution, no concurrent mission isolation testing."
> `src/gateway/mission-service.ts:138-143`: "Thread-safety: this class is safe for concurrent start/get/cancel calls from different transports."

**The reality:**
- `main.ts:248-252` constructs ONE `OpenBotRuntimeAdapter`; the closure returns the SAME instance for every mission.
- `adapter.ts:82-87` "Idempotent ensure" returns the existing worker if the botId exists.
- `botId = genome.identity.id = worker.id` (`genome-compiler.ts:344`); `worker.id` is deterministic per role (`organization-planner.ts:197, 245` — e.g., `generalist-worker-1`, `mission-coordinator-1`).
- Two concurrent missions producing the same role share the same computer process, workspace directory (`computer-process.ts:165`), and files.
- The limitation doc says "Specialists run sequentially" — but `MissionService.start()` returns synchronously and the orchestrator runs in the background, so concurrent missions ARE possible (and the `maxActiveMissionsGlobal=50` default encourages them).

**Minimal fix:** Doc: add Critical limitation — "Concurrent production missions share a single OpenBotRuntimeAdapter; deterministic worker IDs cause cross-mission collision. Either run one mission at a time, or fix the runtime isolation (see G6-07 RB-2)." Code (out of scope for doc fix): one adapter per mission OR namespace botIds by missionId.

---

### MISMATCH #4 — P1-REGISTRY-MEMORY-LEAK-DOS only half-fixed (HIGH)

**The claim (verbatim):**
> `docs/release/engine-v1-changelog.md:20-23`: "P1-REGISTRY-MEMORY-LEAK-DOS — Admission control now counts only ACTIVE (non-terminal) missions... The gateway no longer becomes permanently unusable after 50 lifetime submissions."
> `experiments/g6-06/final-analysis.md:88-89`: "P1 | 5 | 5 | 0"

**The reality:**
- The defect name has TWO failure modes: (1) DoS via admission count, (2) memory leak via never-evicted terminal missions.
- `mission-service.ts` has zero `delete`/`evict`/`cleanup`/`clear` operations on the `missions` Map (grep confirmed).
- Only mode (1) is fixed (`countActiveGlobal()` at lines 461-469).
- The architecture-baseline.md:25 mandate to "evict terminal" was silently dropped.
- Empirically reproduced by B-REGISTRY-FINDING-001: 100 sequential missions → `totalMissions=100`, never decreases; `activeMissions` returns to 0 between iterations.

**Minimal fix:** Rename the changelog entry to `P1-REGISTRY-ADMISSION-COUNT`; add a P2 row for `P2-REGISTRY-NO-TERMINAL-EVICTION`. Implement the eviction (see remediation-plan.md Batch 4).

---

### MISMATCH #5 — A2A cancelTask comment contradicts code (HIGH)

**The claim (verbatim):**
> `src/gateway/a2a-server.ts:178-181`: "Cross-caller cancellation attempt. Return the current task state without cancelling — **do not leak that the task exists to a different caller**."

**The reality:**
- `a2a-server.ts:182-188` calls `this.service.get(...).status` and `eventBus.publish({ kind: 'task', data: buildTask(taskId, snapshot) })` — publishing the taskId AND current status to the cross-caller.
- Existence and state ARE leaked. The comment is internally contradictory and contradicted by the code.
- HTTP path returns 404 (no leak); A2A path leaks.

**Minimal fix:** Rewrite the comment to acknowledge the leak; document the HTTP/A2A asymmetry in `security-boundaries.md`. Code fix: return a JSON-RPC error that does NOT distinguish "not found" from "not authorized" (see C-PROTOCOLS-FINDING-019).

---

### MISMATCH #6 — Clean-room "PASS" is false-positive-prone (HIGH)

**The claim (verbatim):**
> `experiments/g6-06/clean-room-reproduction.md:76`: "Clean-room result: PASS."
> `experiments/g6-06/clean-room-reproduction.md:36`: "health endpoint | PASS (intermittent) | Gateway logs confirm startup; curl timing sensitive in clean-room"
> `experiments/g6-06/final-analysis.md:79`: "CLEAN_ROOM_INSTALL = PASS"

**The reality:**
- Per B-GATEWAY-FINDING-001 (empirically reproduced), `child.kill('SIGTERM')` on `npx tsx src/gateway/main.ts` kills only the npx parent; the actual gateway (grandchild) is orphaned.
- `clean-room-gateway.test.ts:212-240` GATEWAY-04 passes vacuously — only asserts the npx parent's exit.
- Same anti-pattern in `clean-room-run.sh:127-128`.
- The "PASS (intermittent)" health check + unverifiable process termination = false-positive-prone.
- F-PACKAGE-FINDING-002 confirmed: 14 orphaned gateway processes left after a single script + test run.

**Minimal fix:** Doc: change "PASS" to "PASS (with caveat — process-tree shutdown unverified)". Code (out of scope): use `detached: true` + process-group kill as the OpenBot adapter already does (`computer-process.ts:193-290`).

---

### MISMATCH #7 — "Cancellation \| Verified" overstates (MEDIUM)

**The claim (verbatim):**
> `docs/release/engine-v1-scope.md:32`: "Cancellation | Verified"

**The reality:**
- Cancellation is verified ONLY with `tests/gateway/cancellation.test.ts` which uses the default `MemoryRuntime` (dev mode).
- No cancellation test exercises the OpenBot adapter.
- No cancellation test exercises concurrent production missions (where RB-2 makes cancellation dangerous — Mission A's cancel could abort Mission B's worker).

**Minimal fix:** Doc: change "Cancellation | Verified" → "Cancellation | Verified in development mode only". Add a production-mode cancellation test after RB-2 is fixed.

---

### MISMATCH #8 — "currentRequestCaller bridge" naming is stale (LOW)

**The claim (verbatim):**
> `docs/release/engine-v1-evidence-index.md:17`: "currentRequestCaller bridge"
> `docs/release/engine-v1-security-boundaries.md:32`: "currentRequestCaller bridge"
> `experiments/g6-06/defects-and-remediation.md:84`: "currentRequestCaller"

**The reality:**
- Implementation uses `callerContext = new AsyncLocalStorage<CallerIdentity>()` (`a2a-server.ts:81`); renamed in G6-06-R1.

**Minimal fix:** Update all three doc references to `callerContext (AsyncLocalStorage)`.

---

### MISMATCH #9 — Architecture baseline mandates "evict terminal" but no eviction code exists (MEDIUM)

**The claim (verbatim):**
> `experiments/g6-06/architecture-and-risk-baseline.md:25`: "REQUIRED_G6_06_ACTION: ... evict terminal"
> `experiments/g6-06/architecture-and-risk-baseline.md:106`: same mandate
> `experiments/g6-06/final-analysis.md:87-89`: "P1_FIXED = 5"

**The reality:**
- Eviction code does not exist; only admission-count half implemented.
- The mandate was silently dropped from the changelog.

**Minimal fix:** Either implement the eviction (Batch 4) OR explicitly document that eviction is deferred to G6-08 and update the architecture baseline to reflect the deferral.

---

### MISMATCH #10 — Residual risk register classifies a confirmed code defect as "Hypothetical" (MEDIUM)

**The claim (verbatim):**
> `experiments/g6-06/residual-risk-register.md:90`: classifies "memory: terminal missions not evicted" as a "Hypothetical Threat"

**The reality:**
- Confirmed code behavior (zero eviction code in `mission-service.ts`); was a P1 mandate; should be Observed P2, not Hypothetical.

**Minimal fix:** Reclassify as "Observed P2 — confirmed by code inspection and reproduction probe (B-REGISTRY-FINDING-001)".

---

### MISMATCH #11 — "concurrency-safe" claim unsupported by production-mode tests (MEDIUM)

**The claim (verbatim):**
> `src/gateway/mission-service.ts:138-143`: "Thread-safety: this class is safe for concurrent start/get/cancel calls from different transports. Each mission runs in its own async context; the in-process registry is a Map protected by JavaScript's single-threaded event loop."
> `experiments/g6-06/final-analysis.md:54-55,70-71`: "concurrency-safe" claims

**The reality:**
- True at the Map level (JS single-threaded event loop protects Map operations).
- FALSE at the runtime-isolation level (shared OpenBot adapter, deterministic botId collision — B-EXEC-FINDING-002, C-VERIFY-FINDING-003, E-CONCURRENCY-FINDING-005).
- The concurrency probe (E-CONCURRENCY) confirmed 10 concurrent dev-mode missions work correctly — but dev mode uses per-mission-fresh `MemoryRuntime`, which does NOT exhibit the production collision.

**Minimal fix:** Qualify the comment: "Thread-safe at the registry level (Map operations). Production-mode runtime isolation is NOT concurrency-safe — see G6-07 RB-2." Add a production-mode concurrency test after RB-2 is fixed.

---

### MISMATCH #12 — Evidence-index "PASS" assertions mask the production-mode evidence gap (MEDIUM)

**The claim (verbatim):**
> `docs/release/engine-v1-evidence-index.md:14-17,65-94`: multiple "PASS" assertions for production-mode behavior

**The reality:**
- Only the fail-closed path is tested (`tests/gateway/execution-mode.test.ts`).
- No positive production-mode test exists.
- The "PASS" assertions mask the fact that production-mode `getArtifacts()` returns `[]` (RB-1) and concurrent production missions collide (RB-2).

**Minimal fix:** Add a "Production-mode positive path | UNTESTED" row to the evidence index. After RB-1 and RB-2 are fixed, add a positive production-mode integration test and update the evidence index.

---

## Investigated Hypotheses Disproved (claims that turned out to be accurate)

- **`engine-v1-scope.md:42` "Restart recovery | Unsupported"** — Accurate. No persistence code in `mission-service.ts`.
- **`engine-v1-known-limitations.md:107-111` "no LRU eviction in v1"** — Accurate at code level (the mismatch is that the changelog claims the P1 is "fixed" while this limitation acknowledges it isn't — see MISMATCH #4).
- **`engine-v1-scope.md:46-47` execution-mode boundary** — Accurate. `main.ts:233-261` implements it; `execution-mode.test.ts:35-86` verifies fail-closed.
- **`claims-registry.json` C13 "production-ready" REJECTED** — Accurate classification.
- **`engine-v1-security-boundaries.md:30,49` cross-caller artifact → 404 and path filtering** — Accurate at the HTTP layer (the mismatch is that `getArtifacts()` returns `[]` in production regardless — see MISMATCH #2).

---

## Summary

- **12 MISMATCH** claims identified.
- **3 ACCURATE** claims identified (for calibration).
- **1 PARTIALLY ACCURATE** claim.
- The most critical mismatches are #2 (artifacts verified), #3 (concurrency isolation), and #6 (clean-room PASS) — these directly misled the G6-06 release decision.
- The root cause of most mismatches is RC-4 (documentation drift): G6-06-R1 corrected the code but the docs were never updated, and no CI exists to catch the drift.

END OF CLAIMS-VS-EVIDENCE AUDIT.
