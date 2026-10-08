# G6-07 Executive Summary — AgentCraft Genesis Comprehensive Engineering Discovery, Defect Hunting & Security Audit

**Audit Date:** 2026-10-08
**Audited Repository:** https://github.com/mayakilzy/AgentCraft-Genesis
**Audited Branch:** `build/group-06-productionization`
**Audited HEAD:** `8e0ba68d8764d5769127b821cfc2b05918ca8810` ("G6-06-R1: final release blocker verification & correction")
**Auditor:** GLM (Z.ai) — operating as a co-developer of the AgentCraft-Genesis project
**Mode:** Read-only production audit; no production code modified, no commits pushed.

---

## 1. Mission Outcome

**G6_07_AUDIT_STATUS = COMPLETE**

The audit was executed across all 10 mandated stages (A–J) and all 22 audit domains. It produced a comprehensive, evidence-driven findings register suitable for direct conversion into G6-08 remediation tasks.

**Bottom line:** Genesis v1 is **not yet safe to release**. The deterministic core (dev-mode) is solid and reproducible, but the production execution wiring has two CRITICAL defects that silently break the public contract, and the clean-room release gate has been passing on false positives. G6-08 remediation should focus on a small, targeted set of root-cause fixes that eliminate entire defect families rather than patching symptoms.

---

## 2. Headline Numbers

| Metric | Value |
|---|---|
| Total findings | **90** |
| CRITICAL (release blockers) | **3** |
| HIGH | **17** |
| MEDIUM | **38** |
| LOW | **27** |
| POSITIVE / NOT_A_DEFECT | **5** |
| Domains reviewed | **22 / 22** |
| Domains not reviewed | 0 |
| Baseline tests passing | 536 / 545 (9 skipped) |
| Audit tests executed (controlled) | 6 new + 4 probes |
| Failure-injection scenarios | 23 (16 covered by existing tests, 5 reproduced in audit tests, 2 partial) |
| Concurrency scenarios | 3 (all passed) |
| Security scenarios | 12 findings across 20 control categories |
| Clean-room result | **FAIL** — empirically reproduced false-positive (14 orphaned processes) |
| Reproduction artifacts | 7 scripts + logs in `reproduction-evidence/` |
| Root-cause clusters | **7** (cover 41 of the 90 findings) |

---

## 3. Top Release Blockers (must fix before G6-08 can be considered safe)

### RB-1. Production `getArtifacts()` silently returns `[]` (CRITICAL)
- **Files:** `src/gateway/main.ts:145, 250` + `src/gateway/mission-service.ts:361-385`
- **Impact:** Every successful production mission returns zero artifacts via `GET /v1/missions/{id}/artifacts` and the A2A artifact stream. The OpenBot adapter maintains its own internal `computers` Map; MissionService's `getArtifacts()` only iterates the empty Map that `main.ts` hands it. Callers cannot retrieve deliverables through the gateway API. The mission may run correctly internally but the contract surface is broken — callers see an apparently-empty mission. Silent failure: no error, no log, just empty results.
- **Found by:** B-EXEC-FINDING-001; confirmed by C-LEARNING-FINDING-016, G-CLAIMS-FINDING-002, F-PACKAGE reproduction.

### RB-2. Concurrent production missions collide on shared OpenBot adapter (CRITICAL)
- **Files:** `src/gateway/main.ts:248-252` + `src/runtime/openbot/adapter.ts:48-49, 82-87` + `src/mission/orchestrator.ts:207` + `src/organization/organization-planner.ts:197, 245`
- **Impact:** `runtimeFactory` reuses the SAME `OpenBotRuntimeAdapter` for every mission. Worker IDs are deterministic (`generalist-worker-1`, `mission-coordinator-1`, `mission-verifier-1`), and `ensureWorker` is idempotent by botId. Two concurrent missions produce workers that share the same child process, the same workspace directory (`${rootDir}/mission-verifier-1/workspace/`), and the same computer token. Mission A's `stopWorker` (in the orchestrator's retirement `finally` block) tears down Mission B's worker out from under it. Cross-mission data contamination. Cross-caller isolation contract defeated.
- **Found by:** B-EXEC-FINDING-002; expanded by C-VERIFY-FINDING-003, E-CONCURRENCY-FINDING-005, C-LEARNING-FINDING-015, G-CLAIMS-FINDING-003.

### RB-3. Clean-room "PASS" is a false positive — orphaned gateway processes survive SIGTERM (CRITICAL for release integrity)
- **Files:** `experiments/g6-06/clean-room-run.sh:127-128` + `tests/gateway/clean-room-gateway.test.ts:110-127, 145, 218` + `tests/gateway/separate-process-e2e.test.ts:100-116, 151`
- **Impact:** `child.kill('SIGTERM')` on a gateway spawned via `npx tsx` kills only the npx parent. The actual gateway (grandchild) is orphaned, keeps its ports open, and `process.on('SIGTERM')` in `main.ts:284` is never invoked. The clean-room test "GATEWAY-04: process shuts down cleanly on SIGTERM" passes vacuously — it only asserts the npx parent's exit, never verifies ports are released, never verifies the SIGTERM handler ran. Empirically reproduced: 14 orphaned gateway processes left after a single script + test run. The G6-06 release gate `CLEAN_ROOM_INSTALL = PASS` was passing against orphaned processes, not freshly-cloned builds. A regression introduced in commit N could be masked by an orphan built from commit N-1 still serving on the reused port.
- **Found by:** B-GATEWAY-FINDING-001, B-GATEWAY-FINDING-004; confirmed by F-PACKAGE-FINDING-002.

---

## 4. Top Security Risks

| # | Finding | Severity | Domain |
|---|---|---|---|
| 1 | Worker `run_command` unrestricted shell execution, no Genesis-layer policy (C-SECURITY-001) | HIGH | D20 |
| 2 | Prompt injection via unescaped MCP tool output fed back to LLM scratchpad (C-PROTOCOLS-001) | HIGH | D11/D20 |
| 3 | Cross-caller A2A `cancelTask` leaks FULL mission status, not just existence (C-PROTOCOLS-019, expands B-A2A-001) | HIGH | D12/D20 |
| 4 | AgentCard advertises empty `securitySchemes` for a Bearer-authenticated gateway (C-PROTOCOLS-004) | HIGH | D12 |
| 5 | Streaming methods silently truncated to first event — client sees misleading partial response (C-PROTOCOLS-005) | HIGH | D12 |
| 6 | AG-UI SUBAGENT_ERROR never emitted — worker failures invisible to consumers (C-PROTOCOLS-007) | HIGH | D13 |
| 7 | MemoryFlightRecorder + getEvents leaks secrets; toEventRecord has no SECRET_PATTERNS (C-VERIFY-007) | HIGH | D16/D20 |
| 8 | `extractCallerFromUser` fallback grants `mission:submit` to any SDK `User` with `isAuthenticated=true` (B-A2A-005, C-SECURITY-004) | MEDIUM | D12/D20 |
| 9 | No remote agent identity verification in federation (no TLS pin, no signature check) (C-PROTOCOLS-013) | MEDIUM | D12 |
| 10 | Worker writeFile/readFile paths never validated at Genesis layer; MemoryComputer does zero validation (C-SECURITY-003) | MEDIUM-HIGH | D20 |

---

## 5. Top Reliability Risks

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

## 6. Top Root Causes (systemic — fixing one fixes many)

### RC-1. Production wiring is structurally asymmetric with dev wiring
**Covers:** RB-1 (getArtifacts []), RB-2 (concurrent collision), B-EXEC-003 (orphan workers), B-EXEC-006 (no startup validation), B-EXEC-007 (test helper in production).
Dev mode constructs a fresh runtime per mission via `buildDefaultRuntime()` which returns `{ runtime, computers }` where the runtime populates the computers Map. Production mode returns the SAME `{ runtime, computers: new Map() }` for every mission — the adapter populates its OWN internal Map, not the empty one. Fix: make `runtimeFactory` return a fresh adapter per mission that exposes its internal computers Map (or expose an artifact-retrieval adapter method).

### RC-2. Mutable shared state across missions (worker IDs are deterministic and idempotent)
**Covers:** RB-2 (concurrent collision), C-VERIFY-002 (clean-room workspace not cleared), C-VERIFY-003 (verifier genome hardcoded), E-CONCURRENCY-005.
The verifier genome hardcodes `identity.id = 'mission-verifier-1'` for every mission. Worker IDs are deterministic by role (`generalist-worker-1`). Combined with idempotent `ensureWorker`, two missions sharing an adapter collide. Fix: namespace worker IDs by missionId (or, equivalently, give each mission its own adapter — see RC-1).

### RC-3. Test infrastructure masquerading as production infrastructure (orphaned processes)
**Covers:** RB-3 (clean-room false positive), B-GATEWAY-002 (startHttpServer listen race), B-GATEWAY-003 (setTimeout pads masking races), F-PACKAGE-002, F-PACKAGE-003.
Tests spawn `npx tsx src/gateway/main.ts` and kill via `child.kill('SIGTERM')` — only the npx parent dies, the gateway grandchild orphans. The `detached: true` + `process.kill(-pgid, signal)` pattern is already correctly implemented in `src/runtime/openbot/computer-process.ts:173-290`. The gateway tests should mirror it. Fix: kill via process group; tighten GATEWAY-04 assertion to verify ports released + SIGTERM handler logged.

### RC-4. Documentation drift — release docs describe G6-04 behavior, not G6-06-R1 reality
**Covers:** B-EXEC-004 (OPENBOT_ENDPOINT), G-CLAIMS-001..013, F-PACKAGE-004, F-PACKAGE-010 (test count drift), F-PACKAGE-011 (dependency-baseline drift), F-PACKAGE-014 (secure/ gitignore claim false).
G6-06-R1 corrected `main.ts:111-153` to require `OPENBOT_CHECKOUT_DIR` and `OPENBOT_ROOT_DIR`. Docs were never updated. The test count, dependency baseline, and even the `.gitignore` claim about `secure/` are all stale. No CI exists to catch drift. Fix: add CI step asserting doc-claimed env vars match code, doc-claimed test counts match actual, and `.gitignore` entries match doc claims.

### RC-5. Production code imports test infrastructure
**Covers:** B-EXEC-007, B-REGISTRY reproduction artifacts.
`src/gateway/mission-service.ts:49` and `src/gateway/main.ts:45` import `MemoryComputer` from `../../tests/helpers/memory-runtime.js`. The runtime import means production builds must include `tests/helpers/`. Fix: promote `MemoryComputer` (or a slimmer dev-runtime helper) to `src/runtime/memory-computer.ts`.

### RC-6. Unbounded in-memory state with no eviction policy
**Covers:** B-REGISTRY-001 (missions Map), B-REGISTRY-002 (idempotencyIndex), B-REGISTRY-003 (MemoryFlightRecorder.events), C-VERIFY-009 (FileFlightRecorder unbounded), C-LEARNING-009..011 (no durability).
The G6-06 fix added active-only COUNTING for admission control but no EVICTION of terminal missions. The `missions` Map, `idempotencyIndex`, `MemoryFlightRecorder.events`, and `bindings` all grow monotonically for the process lifetime. Fix: add a retention policy (TTL or LRU) for terminal missions + idempotency keys + flight events.

### RC-7. Missing verification lifecycle invariants
**Covers:** C-VERIFY-001 (binary all-or-nothing verified flag), C-VERIFY-002 (clean-room not cleared), C-VERIFY-004 (flight-action disabled with FileFlightRecorder), C-VERIFY-005 (60-char fingerprint fabrication), C-VERIFY-012 (unknown check kinds silently dropped).
The VerificationLoop has several latent correctness issues: the per-artifact `verified` flag is binary (mission-level, not per-file), the verifier workspace is never cleared between verify() calls (within-mission and cross-mission false positives), flight-action checks silently fail when FileFlightRecorder is used, mission-input checks use a 60-char substring fingerprint that can be fabricated, and unknown check kinds are silently dropped. Fix: store the full VerificationResult with outcomes, clear the verifier workspace at the start of each verify() call, decouple event capture from durable recording, add hash-match checks for staged inputs, and add a default case for unknown check kinds.

---

## 7. Stop Conditions Encountered

- **No external destructive probes were performed.** All probes used local stubs or controlled fault injection.
- **No real ZAI credentials were used.** The fail-closed probes used fake env vars to verify the gateway refuses to start without real providers.
- **No real OpenBot checkout was exercised end-to-end.** The OpenBot adapter's actual child-process spawning was not reproduced with a real `bun src/index.ts` (no OpenBot checkout in sandbox). The `detached: true` + process-group-kill pattern was verified by code inspection against `src/runtime/openbot/computer-process.ts`.
- **No unbounded load tests.** Concurrency probes used N=10 max.
- **No paid API charges.**

---

## 8. Stop / Continue Recommendation

**SAFE_TO_BEGIN_G6_08_REMEDIATION = YES (with priority ordering)**

G6-08 should focus first on the 3 release blockers (RB-1, RB-2, RB-3) — all three are root-cause fixes that eliminate entire defect families. After RB-1 and RB-2 are fixed, a positive production-mode integration test (real or stubbed OpenBot + ZAI) MUST be added — the current test suite only verifies the fail-closed path, never a successful production mission. After RB-3 is fixed, the clean-room script's `kill` line must be replaced with process-group kill, and GATEWAY-04 must verify port release + SIGTERM handler invocation.

**SAFE_TO_BEGIN_G6_09_ADVERSARIAL_QUALIFICATION = NO**

G6-09 should not begin until RB-1, RB-2, RB-3 and the top-10 security risks (Section 4) are resolved. Adversarial qualification against the current code would find the production contract violation (RB-1) and the cross-caller status leak (C-PROTOCOLS-019) within minutes.

---

## 9. Honest Coverage Statement

**Inspected:** All 48 production source files in `src/`; all 66 test files in `tests/`; all 14 claim sources in `docs/` and `experiments/`; the dependency tree (`npm audit`, `npm ls`); the lockfile; the `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `.gitignore`.

**Not inspected at runtime:** Real OpenBot child-process spawning (no checkout in sandbox). Real ZAI SDK calls (no credentials). Real federation to a remote A2A agent (no remote agent). Real MCP server (no server available). Real AG-UI consumer over a network (in-process sink only).

**Code paths exercised:** Dev-mode mission execution end-to-end (smoke tests + audit probes). Production-mode fail-closed matrix (7 variants). Production-mode positive path is **NOT** exercised by any test — this is the gap that allowed RB-1 and RB-2 to ship.

**Code paths NOT exercised:** Successful production mission; concurrent production missions; real OpenBot worker spawning; real ZAI reasoning; real MCP tool invocation; real federation delegation; AG-UI over a real network sink; restart recovery (none exists).

**External systems unavailable:** OpenBot (v0.1.0), ZAI SDK (default `z-ai-web-dev-sdk`), real remote A2A agents, real MCP servers.

**Real integrations tested:** `@a2a-js/sdk@1.3.0` InMemoryTaskStore + DefaultRequestHandler (in-process); `@ag-ui/core@1.0.2` EventType schemas (validated against `node_modules/@ag-ui/core/dist/schemas.d.ts`); `@modelcontextprotocol/sdk@1.32.1` Client (verified by reading test fixtures); native `node:http` server; native `node:crypto` timingSafeEqual; native `node:async_hooks` AsyncLocalStorage.

**Simulated integrations tested:** Stub reasoning providers (deterministic scripted responses); stub slow reasoning providers (never-resolving promises); MemoryComputer (in-memory filesystem); stub federation clients (in `tests/runtime/federation-service.test.ts`); stub MCP server (in `tests/runtime/mcp-capability-provider.test.ts`).

**Security scenarios covered:** API key auth (constant-time comparison, length-leak analysis); cross-caller isolation (HTTP 404 + A2A TaskNotFoundError); prompt injection vectors (tool output, tool description); path traversal (getArtifacts filter, MemoryComputer zero-validation); secret redaction (10 patterns, gap analysis); dependency vulnerabilities (`npm audit` 0 findings); credential leakage (GENESIS_API_KEYS prefix leak, worker-step event leakage, error message leakage).

**Remaining uncertainty:**
1. Whether the real ZAI SDK reads `ZAI_API_KEY` from `process.env` when no `sdkPath` is configured (B-EXEC-005). The fail-closed check accepts it but never wires it through `createEnv`. Latent credential failure.
2. Whether a real OpenBot checkout (v0.1.0) actually starts successfully under the adapter's spawn contract. The adapter's `detached: true` + process-group-kill pattern is correct by inspection, but the `bun src/index.ts` command was never executed in this audit.
3. Whether concurrent production missions with a fresh-per-mission adapter (the proposed RB-2 fix) actually isolate workspaces — the fix is straightforward but unverified at runtime.
4. Whether the AG-UI event bridge interoperates with a real AG-UI consumer (e.g., CopilotKit). The schema violations (C-PROTOCOLS-006, -007, -008) suggest a strict consumer would reject or misinterpret events.

---

## 10. Files in this audit package

```
experiments/g6-07-audit/
  executive-summary.md            ← this file
  architecture-coverage.md        ← full architecture + coverage matrix
  findings-register.json          ← machine-readable, suitable for G6-08 task conversion
  findings-detailed.md            ← full finding records (FINDING_ID, TITLE, DOMAIN, EVIDENCE_CLASS, SEVERITY, AFFECTED_FILES, RELEVANT_LINES, ENTRYPOINT, PRECONDITIONS, REPRODUCTION_STEPS, EXPECTED_BEHAVIOR, ACTUAL_BEHAVIOR, OBSERVED_OUTPUT, ROOT_CAUSE, SECURITY_OR_RELIABILITY_IMPACT, MINIMAL_RECOMMENDED_FIX, ALTERNATIVE_FIX, REGRESSION_TEST_REQUIRED, DEPENDENCIES, ESTIMATED_FIX_COMPLEXITY, RELATED_FINDINGS)
  reproduction-evidence/          ← 7 probe scripts + captured logs
  failure-injection-results.md    ← 23-scenario matrix
  security-review.md              ← security findings consolidated
  claims-vs-evidence.md           ← 16-row claims matrix
  root-cause-analysis.md          ← 7 root-cause clusters
  remediation-plan.md             ← prioritized fix plan
  residual-uncertainty.md         ← honest gaps
  final-audit-report.md           ← G6-07 final report with mandated status block
```

END OF EXECUTIVE SUMMARY.
