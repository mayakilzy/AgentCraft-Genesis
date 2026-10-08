# G6-07 Final Audit Report — AgentCraft Genesis Comprehensive Engineering Discovery, Defect Hunting & Security Audit

**Audit Date:** 2026-10-08
**Auditor:** GLM (Z.ai) — operating as a co-developer of the AgentCraft-Genesis project
**Mode:** Read-only production audit; no production code modified, no commits pushed.

---

## Mandated Status Block

```
G6_07_AUDIT_STATUS = COMPLETE

REPOSITORY = https://github.com/mayakilzy/AgentCraft-Genesis
BRANCH = build/group-06-productionization
AUDITED_HEAD = 8e0ba68d8764d5769127b821cfc2b05918ca8810
WORKTREE = /home/z/my-project/audit-work/AgentCraft-Genesis
PRODUCTION_CODE_MODIFIED = NO
EXISTING_TESTS_MODIFIED = NO
CHANGES_PUSHED = NO

DOMAINS_REVIEWED = 22
DOMAINS_NOT_REVIEWED = 0

CONFIRMED_DEFECTS = 14
CODE_CONFIRMED_DEFECTS = 22
HIGH_CONFIDENCE_RISKS = 19
EVIDENCE_GAPS = 8
DOCUMENTATION_MISMATCHES = 16
ENVIRONMENT_BLOCKED = 2
DISPROVED_HYPOTHESES = 30

P0_FINDINGS = 3
P1_FINDINGS = 17
P2_FINDINGS = 38
P3_FINDINGS = 27

BASELINE_TESTS = 536 passed, 9 skipped, 545 total
AUDIT_TESTS_EXECUTED = 6 new audit tests + 4 probe scripts
FAILURE_INJECTION_SCENARIOS = 23
CONCURRENCY_SCENARIOS = 3
SECURITY_SCENARIOS = 12 findings across 20 control categories
CLEAN_ROOM_RESULT = FAIL (false-positive-prone, empirically reproduced)

TOP_ROOT_CAUSES = 7 clusters covering 49 of 90 findings
TOP_RELEASE_BLOCKERS = 3 (RB-1, RB-2, RB-3)
TOP_SECURITY_RISKS = 10
TOP_RELIABILITY_RISKS = 10

REMEDIATION_BATCHES_PROPOSED = 9
ESTIMATED_REMEDIATION_SCOPE = MEDIUM (targeted fixes, not rewrite)
ARCHITECTURAL_DECISIONS_REQUIRED = 2 (persistence layer, runtime isolation strategy)

FINDINGS_REGISTER_PATH = experiments/g6-07-audit/findings-register.json
REPRODUCTION_EVIDENCE_PATH = experiments/g6-07-audit/reproduction-evidence/
REMEDIATION_PLAN_PATH = experiments/g6-07-audit/remediation-plan.md
FINAL_AUDIT_REPORT_PATH = experiments/g6-07-audit/final-audit-report.md

SAFE_TO_BEGIN_G6_08_REMEDIATION = YES

SAFE_TO_BEGIN_G6_09_ADVERSARIAL_QUALIFICATION = NO
```

---

## 1. Mission Summary

The G6-07 audit was executed across all 10 mandated stages (A–J) and all 22 audit domains. It produced a comprehensive, evidence-driven findings register of 90 findings (3 CRITICAL, 17 HIGH, 38 MEDIUM, 27 LOW, 5 POSITIVE), grouped into 7 root-cause clusters, with a 9-batch remediation plan suitable for direct conversion into G6-08 tasks.

**Bottom line:** Genesis v1 is **not yet safe to release**. The deterministic core (dev-mode) is solid and reproducible (536/545 tests passing, fresh-clone `npm ci && typecheck && lint && test` all clean), but the production execution wiring has two CRITICAL defects that silently break the public contract, and the clean-room release gate has been passing on false positives. G6-08 remediation should focus on a small, targeted set of root-cause fixes that eliminate entire defect families rather than patching symptoms.

---

## 2. The Three Release Blockers

### RB-1. Production `getArtifacts()` silently returns `[]` (CRITICAL)

**Files:** `src/gateway/main.ts:145, 250` + `src/gateway/mission-service.ts:361-385` + `src/runtime/openbot/adapter.ts:49, 108`

**Impact:** Every successful production mission returns zero artifacts via `GET /v1/missions/{id}/artifacts` and the A2A artifact stream. The OpenBot adapter maintains its own internal `computers` Map; MissionService's `getArtifacts()` only iterates the empty Map that `main.ts` hands it. Callers cannot retrieve deliverables through the gateway API. The mission may run correctly internally but the contract surface is broken — callers see an apparently-empty mission. **Silent failure:** no error, no log, just empty results.

**Root cause:** RC-1 (production wiring structurally asymmetric with dev wiring). Dev mode's `buildDefaultRuntime()` returns `{ runtime, computers }` where the runtime populates the computers Map. Production mode returns `{ runtime, computers: new Map() }` where the adapter populates its OWN internal Map. TypeScript does not catch this because the empty `new Map()` is structurally assignable to `Map<string, MemoryComputer>`.

**Evidence:** B-EXEC-FINDING-001 (code inspection + logical derivation); confirmed by C-LEARNING-FINDING-016, G-CLAIMS-FINDING-002, F-PACKAGE reproduction.

**Fix:** Make `runtimeFactory` return a fresh adapter per mission that exposes its internal computers Map (or expose an artifact-retrieval adapter method). See `remediation-plan.md` Batch 1a.

---

### RB-2. Concurrent production missions collide on shared OpenBot adapter (CRITICAL)

**Files:** `src/gateway/main.ts:248-252` + `src/runtime/openbot/adapter.ts:48-49, 82-87` + `src/mission/orchestrator.ts:207` + `src/organization/organization-planner.ts:197, 245`

**Impact:** `runtimeFactory` reuses the SAME `OpenBotRuntimeAdapter` for every mission. Worker IDs are deterministic (`generalist-worker-1`, `mission-coordinator-1`, `mission-verifier-1`), and `ensureWorker` is idempotent by botId. Two concurrent missions produce workers that share the same child process, the same workspace directory (`${rootDir}/mission-verifier-1/workspace/`), and the same computer token. Mission A's `stopWorker` (in the orchestrator's retirement `finally` block) tears down Mission B's worker out from under it. **Cross-mission data contamination. Cross-caller isolation contract defeated.**

**Root cause:** RC-1 (shared adapter) + RC-2 (deterministic worker IDs). The factory contract was designed per-mission-fresh (the dev `buildDefaultRuntime()` returns fresh state each call), but the production wiring returns the same adapter on every call. Combined with deterministic worker IDs, the second concurrent mission's `ensureWorker('mission-verifier-1')` finds the first mission's worker in the adapter's Map and returns a handle to it.

**Evidence:** B-EXEC-FINDING-002 (code inspection); expanded by C-VERIFY-FINDING-003, E-CONCURRENCY-FINDING-005, C-LEARNING-FINDING-015, G-CLAIMS-FINDING-003.

**Fix:** Make `runtimeFactory` return a fresh adapter per mission (preferred — also fixes RB-1), OR namespace worker IDs by missionId. See `remediation-plan.md` Batch 1a.

---

### RB-3. Clean-room "PASS" is a false positive — orphaned gateway processes survive SIGTERM (CRITICAL for release integrity)

**Files:** `experiments/g6-06/clean-room-run.sh:127-128` + `tests/gateway/clean-room-gateway.test.ts:110-127, 145, 218` + `tests/gateway/separate-process-e2e.test.ts:100-116, 151` + `src/gateway/main.ts:274-285`

**Impact:** `child.kill('SIGTERM')` on a gateway spawned via `npx tsx` kills only the npx parent. The actual gateway (grandchild) is orphaned, keeps its ports open, and `process.on('SIGTERM')` in `main.ts:284` is never invoked. The clean-room test "GATEWAY-04: process shuts down cleanly on SIGTERM" passes vacuously — it only asserts the npx parent's exit, never verifies ports are released, never verifies the SIGTERM handler ran. **Empirically reproduced:** 14 orphaned gateway processes left after a single script + test run. The G6-06 release gate `CLEAN_ROOM_INSTALL = PASS` was passing against orphaned processes, not freshly-cloned builds. A regression introduced in commit N could be masked by an orphan built from commit N-1 still serving on the reused port.

**Root cause:** RC-3 (test infrastructure masquerading as production infrastructure). The `detached: true` + `process.kill(-pgid, signal)` pattern is already correctly implemented in `src/runtime/openbot/computer-process.ts:173-290` — the gateway tests should mirror it.

**Evidence:** B-GATEWAY-FINDING-001, B-GATEWAY-FINDING-004 (empirically reproduced with 3-scenario kill-mode comparison); confirmed by F-PACKAGE-FINDING-002, G-CLAIMS-FINDING-006.

**Fix:** Spawn with `detached: true` and kill via `process.kill(-pgid, signal)` in tests and `clean-room-run.sh`. Tighten GATEWAY-04 to verify SIGTERM handler logged + ports released + no orphan processes. See `remediation-plan.md` Batch 1b.

---

## 3. Top Security Risks (10)

| # | Finding | Severity | Domain |
|---|---|---|---|
| 1 | Worker `run_command` unrestricted shell execution, no Genesis-layer policy (C-SECURITY-001) | HIGH | D20 |
| 2 | Prompt injection via unescaped MCP tool output fed back to LLM scratchpad (C-PROTOCOLS-001) | HIGH | D11/D20 |
| 3 | Cross-caller A2A `cancelTask` leaks FULL mission status (C-PROTOCOLS-019, expands B-A2A-001) | HIGH | D12/D20 |
| 4 | AgentCard advertises empty `securitySchemes` for a Bearer-authenticated gateway (C-PROTOCOLS-004) | HIGH | D12 |
| 5 | Streaming methods silently truncated to first event — client sees misleading partial response (C-PROTOCOLS-005) | HIGH | D12 |
| 6 | AG-UI SUBAGENT_ERROR never emitted — worker failures invisible to consumers (C-PROTOCOLS-007) | HIGH | D13 |
| 7 | MemoryFlightRecorder + getEvents leaks secrets; toEventRecord has no SECRET_PATTERNS (C-VERIFY-007) | HIGH | D16/D20 |
| 8 | `extractCallerFromUser` fallback grants `mission:submit` to any SDK `User` with `isAuthenticated=true` (B-A2A-005, C-SECURITY-004) | MEDIUM | D12/D20 |
| 9 | No remote agent identity verification in federation (no TLS pin, no signature check) (C-PROTOCOLS-013) | MEDIUM | D12 |
| 10 | Worker writeFile/readFile paths never validated at Genesis layer; MemoryComputer does zero validation (C-SECURITY-003) | MEDIUM-HIGH | D20 |

---

## 4. Top Reliability Risks (10)

| # | Finding | Severity |
|---|---|---|
| 1 | Terminal missions never evicted from MissionService.missions — unbounded memory growth (B-REGISTRY-001) | P1 |
| 2 | `idempotencyIndex` grows unbounded AND prevents reuse post-terminal (B-REGISTRY-002) | P1 |
| 3 | No graceful teardown of OpenBot workers on shutdown — orphaned `bun` child processes (B-EXEC-003) | HIGH |
| 4 | No CI workflows — no automated enforcement of typecheck/lint/tests on PRs (F-PACKAGE-006) | MEDIUM |
| 5 | `OPENBOT_ENDPOINT` documented but never read; actual required vars are `OPENBOT_CHECKOUT_DIR`/`OPENBOT_ROOT_DIR` (B-EXEC-004, G-CLAIMS-001, F-PACKAGE-004) | HIGH |
| 6 | `pollToTerminal` has no wall-clock deadline — a hung mission pins execute() and the HTTP connection (B-A2A-002) | P2 |
| 7 | `bindings` Map leaks when `execute()` never returns (B-A2A-003) | P2 |
| 8 | No production-mode startup validation that `OPENBOT_CHECKOUT_DIR` exists, `bun` is on PATH, ZAI SDK importable (B-EXEC-006) | MEDIUM |
| 9 | `ZAIReasoningProvider` has NO per-call timeout — hangs until `missionTimeoutMs` (D-FAILURE-001) | HIGH |
| 10 | FederationService `getTask` not retried despite documentation claiming it is (C-PROTOCOLS-012) | MEDIUM |

---

## 5. Top Root Causes (7 clusters)

| Cluster | Title | Findings Covered | Priority |
|---------|-------|------------------|----------|
| RC-1 | Production wiring structurally asymmetric with dev wiring | 7 | P0 |
| RC-2 | Mutable shared state across missions (deterministic worker IDs) | 4 | P0 |
| RC-3 | Test infrastructure masquerading as production infrastructure | 6 | P0 |
| RC-4 | Documentation drift — release docs describe G6-04 behavior | 18 | P1 |
| RC-5 | Production code imports test infrastructure | 1 | P2 |
| RC-6 | Unbounded in-memory state with no eviction policy | 8 | P1 |
| RC-7 | Missing verification lifecycle invariants | 5 | P1 |

**Total findings covered by root-cause clusters: 49 of 90.** The remaining 41 findings are isolated defects addressed individually in `remediation-plan.md` Batches 7–9.

---

## 6. Audit Execution Summary

The audit was executed in 10 stages:

- **Stage A — Recovery and inventory:** Cloned the repository at audited HEAD; verified branch, local HEAD, remote HEAD, worktree, Node/npm versions, production LOC (15,060), test LOC (17,319), test count (545). Ran `npm ci`, `typecheck`, `lint`, `test` — all passing.
- **Stage B — High-risk mandatory investigations:** 4 parallel subagents investigated A2A caller identity (B-A2A), gateway startup (B-GATEWAY), production execution wiring (B-EXEC), and mission registry memory (B-REGISTRY). Found all 3 release blockers.
- **Stage C — Full architecture and code review:** 4 parallel subagents investigated verification/artifacts (C-VERIFY), security (C-SECURITY), protocols (C-PROTOCOLS), and learning/persistence (C-LEARNING). Found 49 additional findings.
- **Stage D — Controlled failure injection:** 1 subagent executed the 23-scenario Failure Injection Matrix. 16 covered by existing tests, 5 reproduced in new audit tests, 2 partial. Found 4 silent/partial-silent failure paths.
- **Stage E — Concurrency and security probes:** 1 subagent ran 3 concurrency scenarios (all passed) and consolidated security findings.
- **Stage F — Packaging and clean-room review:** 1 subagent ran a fresh-clone reproduction (all passing) and the G6-06 clean-room script (found 14 orphaned processes). Found 14 packaging findings.
- **Stage G — Evidence and claims audit:** 1 subagent compared all 14 claim sources against code. Found 13 documentation mismatches.
- **Stage H — Root-cause clustering:** Main agent grouped 49 of 90 findings into 7 root-cause clusters.
- **Stage I — Remediation planning:** Main agent produced a 9-batch remediation plan.
- **Stage J — Final reporting:** Main agent produced this report + 8 supporting documents.

**Subagents dispatched:** 12 (B-A2A, B-GATEWAY, B-EXEC, B-REGISTRY, C-VERIFY, C-SECURITY, C-PROTOCOLS, C-LEARNING, E-CONCURRENCY, D-FAILURE, F-PACKAGE, G-CLAIMS). All returned successfully.

**Reproduction artifacts:** 7 probe scripts + captured logs in `reproduction-evidence/`.

---

## 7. Stop Conditions Encountered

- **No external destructive probes were performed.** All probes used local stubs or controlled fault injection.
- **No real ZAI credentials were used.** The fail-closed probes used fake env vars to verify the gateway refuses to start without real providers.
- **No real OpenBot checkout was exercised end-to-end.** The OpenBot adapter's actual child-process spawning was not reproduced with a real `bun src/index.ts` (no OpenBot checkout in sandbox). The `detached: true` + process-group-kill pattern was verified by code inspection.
- **No unbounded load tests.** Concurrency probes used N=10 max.
- **No paid API charges.**

---

## 8. Honest Coverage Statement

**Inspected:** All 48 production source files in `src/`; all 66 test files in `tests/`; all 14 claim sources in `docs/` and `experiments/`; the dependency tree; the lockfile; the `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `.gitignore`.

**Not inspected at runtime:** Real OpenBot child-process spawning. Real ZAI SDK calls. Real federation to a remote A2A agent. Real MCP server. Real AG-UI consumer over a network.

**Code paths exercised:** Dev-mode mission execution end-to-end. Production-mode fail-closed matrix (7 variants). Production-mode positive path is **NOT** exercised by any test — this is the gap that allowed RB-1 and RB-2 to ship.

**Code paths NOT exercised:** Successful production mission; concurrent production missions; real OpenBot worker spawning; real ZAI reasoning; real MCP tool invocation; real federation delegation; AG-UI over a real network sink; restart recovery (none exists).

**Do not equate the absence of discovered P0 defects with proof that no P0 defects exist.** This audit found 3 CRITICAL release blockers, but the production execution path is largely unverified at runtime. A real production-mode integration test might surface additional defects.

**Do not equate a passing unit test suite with production reliability.** The 536 passing tests all run in dev mode. RB-1 and RB-2 are precisely the kind of defects that a passing dev-mode test suite cannot catch.

---

## 9. Recommendation for G6-08

**SAFE_TO_BEGIN_G6_08_REMEDIATION = YES**

G6-08 should execute the remediation batches in this order:

1. **Batch 1 (P0):** Fix RB-1 + RB-2 (production runtime isolation) and RB-3 (clean-room process-tree shutdown). These are targeted fixes, not a rewrite. After Batch 1, add a **positive production-mode integration test** — this is the single most important regression test, because its absence is why RB-1 and RB-2 shipped.
2. **Batch 3 (P0):** Make `startHttpServer` async; remove `setTimeout` pads.
3. **Batch 4 (P1):** Terminal mission eviction + bound `MemoryFlightRecorder.events` + `pollToTerminal` deadline.
4. **Batch 5 (P1):** Verification lifecycle invariants (per-artifact verified flag, clear verifier workspace, decouple flight-action from recorder type, hash-match for staged inputs, default case for unknown check kinds).
5. **Batch 6 (P1):** Documentation drift + CI workflow + promote `MemoryComputer`.
6. **Batch 7 (P1, parallel with Batch 1):** Top security risks (command policy, MCP output framing, cross-caller cancelTask, AgentCard securitySchemes, reject streaming methods).
7. **Batches 8–9 (P2, defer to G6-08.5 or G6-09):** Protocol compliance + persistence/recovery design.

**Estimated remediation scope:** MEDIUM. The 3 release blockers are targeted fixes (~10 lines each plus tests). The systemic fixes (Batches 4–6) are each ~20–50 lines of new code plus tests. Batch 7a (command policy) is the largest single item (~200 lines). Batch 9 is the only item that requires an architectural decision.

---

## 10. Recommendation for G6-09

**SAFE_TO_BEGIN_G6_09_ADVERSARIAL_QUALIFICATION = NO**

G6-09 should not begin until RB-1, RB-2, RB-3 and the top-10 security risks (Section 3) are resolved. Adversarial qualification against the current code would find the production contract violation (RB-1) and the cross-caller status leak (C-PROTOCOLS-FINDING-019) within minutes. The clean-room false positive (RB-3) would also undermine any G6-09 reproduction attempt.

---

## 11. Audit Package Contents

```
experiments/g6-07-audit/
  executive-summary.md            ← headline findings + numbers
  architecture-coverage.md        ← full architecture + coverage matrix
  findings-register.json          ← machine-readable, suitable for G6-08 task conversion
  findings-detailed.md            ← full finding records (~90 findings, G6-07 Section 7 schema)
  reproduction-evidence/          ← 7 probe scripts + captured logs
    g6-07-clean-room-probe.mjs
    g6-07-prod-failclosed-probe.mjs
    g6-07-registry-growth-probe.mjs
    g6-07-concurrency-probe.mjs
    g6-07-failure-injection.test.ts
    fresh-clone-results.txt
    g6-06-cleanroom-run-output.txt
  failure-injection-results.md    ← 23-scenario matrix
  security-review.md              ← security findings consolidated
  claims-vs-evidence.md           ← 16-row claims matrix
  root-cause-analysis.md          ← 7 root-cause clusters
  remediation-plan.md             ← 9-batch prioritized fix plan
  residual-uncertainty.md         ← honest gaps
  final-audit-report.md           ← this file (G6-07 Section 14 mandated status block)
```

---

## 12. Auditor's Note

As a co-developer of AgentCraft-Genesis, I approached this audit with two obligations: (1) find defects before external reviewers do, and (2) recommend corrections that are minimal and reuse existing primitives. The audit found 3 CRITICAL release blockers, but the deterministic core is genuinely solid — the dev-mode Born chain is well-tested, the failure-class taxonomy is thoughtful, and the engineering rule (`CONFIGURE → REUSE → WRAP → ADAPT → EXTEND → BUILD`) is consistently honored. The defects cluster in two areas: (a) the production-mode wiring that was added in G6-06-R1 without a positive integration test, and (b) the test infrastructure that masks real process-lifecycle issues. Both are fixable with targeted changes, not a rewrite.

The single most important recommendation for G6-08: **add a positive production-mode integration test.** Its absence is the root cause of RB-1 and RB-2. With that test in place, future regressions in the production path would be caught before release.

**Find defects. Establish truth. Recommend corrections. Do not modify production.**

END OF G6-07 AUDIT MISSION.
