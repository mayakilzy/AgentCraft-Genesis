# G6-07 Architecture and Coverage Matrix

**Audit Date:** 2026-10-08
**Audited Repository:** https://github.com/mayakilzy/AgentCraft-Genesis
**Audited Branch:** `build/group-06-productionization`
**Audited HEAD:** `8e0ba68d8764d5769127b821cfc2b05918ca8810`
**Auditor:** GLM (Z.ai) — operating as a co-developer of the AgentCraft-Genesis project
**Mode:** Read-only production audit; no production code modified, no commits pushed.

---

## 1. Purpose

This document provides (a) a file-by-file inventory of every component inspected during the G6-07 audit, (b) the per-domain findings and evidence gaps for each of the 22 mandated domains, and (c) a coverage matrix mapping each domain × each component × inspection status × test status × real-vs-simulated execution. The matrix is the basis for the residual-uncertainty disclosures in `residual-uncertainty.md`.

---

## 2. Architecture Overview

AgentCraft Genesis v1 is a single-process TypeScript gateway that turns a natural-language `Goal` into verified artifacts via an LLM-orchestrated worker pipeline. The deterministic core (dev-mode) is fully wired and tested. The production execution wiring (OpenBot adapter + ZAI reasoning) is structurally asymmetric with dev wiring, which is the root cause of two of the three release blockers (RB-1, RB-2).

### High-level data flow

```
Goal (caller)
  │
  ▼
HTTP /v1/missions  ──or──  A2A JSON-RPC (sendMessage)
  │                              │
  ▼                              ▼
MissionService.start()    GenesisAgentExecutor.execute()
  │                              │
  └────►  bindings(taskId → missionId)
                │
                ▼
        MissionService.start()
                │
                ▼
        GoalCompiler.compile()
                │
                ▼
        OrganizationPlanner.plan()   ← AdvisoryPattern[] (currently empty: learning loop not wired)
                │
                ▼
        GenomeCompiler.compile()     ← grants each worker tools via data/ownership.yaml
                │
                ▼
        MissionOrchestrator.run()
          │
          ├─ stageMissionInputs()           (write operator-supplied inputs to each worker workspace)
          ├─ for each specialist worker:
          │    └─ WorkerAgent.run()
          │         ├─ loop: parseAction → grantsFor → execute → scratchpad push → repeat
          │         ├─ ReasoningProvider (ZAI / scripted)
          │         ├─ WorkerComputer (OpenBot HTTP / MemoryComputer)
          │         └─ MCP / Federation / OpenDots / OpenMuse as granted
          ├─ VerificationLoop.verify()      (clean-room copy + 7 check kinds)
          ├─ bounded retry (orchestrator.ts:684-757)
          └─ finishMission() → MissionResult
                │
                ▼
        MemoryFlightRecorder.events[]   (in-memory; never FileFlightRecorder in gateway)
                │
                ▼
        MissionService.missions Map<missionId, MissionRuntime>  (never evicted — RC-6)
                │
                ▼
        GET /v1/missions/{id}     ← toSnapshot
        GET /v1/missions/{id}/events   ← getEvents (caller-isolated)
        GET /v1/missions/{id}/artifacts ← getArtifacts (PROD returns [] — RB-1)
        AG-UI RunStarted/Finished/ToolCall/Subagent* events (event-bridge.ts)
        A2A Task lifecycle (buildTask, pollToTerminal)
```

### Runtime asymmetry (the root of RB-1 / RB-2)

| Mode | `runtimeFactory` returns | Computers map populated by | Verifier genome |
|---|---|---|---|
| Development (default) | `buildDefaultRuntime()` — fresh per mission | `ensureWorker` closure in mission-service.ts:603 | hardcoded `mission-verifier-1` (per-mission adapter so collision-safe) |
| Production | `() => ({ runtime: sharedAdapter, computers: new Map() })` | OpenBot adapter's private internal map | hardcoded `mission-verifier-1` (shared adapter → collision) |

In dev mode, `getArtifacts()` iterates the per-mission `MemoryComputer.files` map and returns real artifacts. In production mode, the same method iterates an empty `Map` because the OpenBot adapter populates its OWN internal `computers` map (`adapter.ts:49`) and never writes to the empty one passed by `main.ts:145`. The verifier genome is hardcoded to `mission-verifier-1` in both modes (`orchestrator.ts:207`); in dev mode each mission gets a fresh adapter so this is safe, in production mode the shared adapter makes two concurrent missions collide on the same worker process, workspace directory, and computer token.

---

## 3. Component Inventory (every src/ file inspected)

48 production source files, organized by domain. For each file: brief description, what was audited, and the primary findings touching it.

### 3.1 Gateway (`src/gateway/`)

| File | Lines | Description | Audited | Key findings |
|---|---|---|---|---|
| `main.ts` | 290 | Process entrypoint. Reads env vars, builds runtime/reasoning, starts HTTP+A2A servers, installs SIGTERM/SIGINT handlers. | full | RB-1 (line 145: `computers: new Map()`), RB-2 (lines 248-252: shared adapter), RB-3 (lines 274-285: shutdown), B-EXEC-004 (line 30: stale `OPENBOT_ENDPOINT` comment), B-EXEC-007 (line 45: imports MemoryComputer), C-SECURITY-005 (lines 179, 185: `key.slice(0,4)` leak), C-SECURITY-011 (lines 219-222: agentName/agentDescription not scrubbed), F-PACKAGE-005 (line 126: env var name drift) |
| `http-server.ts` | 395 | Native `node:http` server. Auth (constant-time API key comparison), JSON body parsing, `/health`, mission routes. | full | B-GATEWAY-002 (line 59: `server.listen()` non-blocking), C-SECURITY-010 (caller isolation at service layer; future persistence risk) |
| `a2a-server.ts` | 671 | A2A JSON-RPC server via `@a2a-js/sdk/server`. AgentCard, executor, CancelTask, streaming methods. | full | B-A2A-001 (lines 177-190: cross-caller cancelTask leak), C-PROTOCOLS-004 (lines 428-429: empty securitySchemes), C-PROTOCOLS-005 (lines 365-378: streaming truncation), C-PROTOCOLS-016 (lines 159-176: fabricated CANCELLED/FAILED), C-PROTOCOLS-017 (lines 95-155: no per-request timeout), C-PROTOCOLS-019 (lines 177-190: status leak), C-SECURITY-004 (lines 467-482: extractCallerFromUser fallback), G-CLAIMS-009 (line 81: AsyncLocalStorage renamed), B-A2A-002 (lines 209-231: pollToTerminal no deadline), B-A2A-003 (line 68: bindings Map leak), B-A2A-005 (lines 440-482: SDK User fallback) |
| `mission-service.ts` | 653 | In-process mission registry. start/get/cancel/getEvents/getArtifacts. `MissionRuntime` interface. `buildDefaultRuntime()`. | full | RB-1 (lines 361-385, 476-507: getArtifacts iterates empty Map), B-REGISTRY-001 (line 145: missions Map never evicted), B-REGISTRY-002 (line 146: idempotencyIndex never pruned), C-VERIFY-001 (line 379: binary verified flag), C-VERIFY-007 (lines 329-346, 526-560: getEvents/toEventRecord no scrub), C-VERIFY-009 (line 225: MemoryFlightRecorder unbounded), C-VERIFY-010 (line 374: substring `..` filter), C-LEARNING-009 (in-memory only), C-LEARNING-013 (no shutdown method), E-CONCURRENCY-001 (lines 171-315: synchronous-start invariant), E-CONCURRENCY-002 (lines 285, 290, 302, 404: status mutation race), G-CLAIMS-012 (lines 138-143: thread-safety claim) |
| `types.ts` | ~310 | Shared gateway types. `CallerIdentity`, `MissionSubmission`, `statusFromResult`, `isTerminal`. | full | G-CLAIMS-009 (line 82: idempotency docstring), E-CONCURRENCY-002 (lines 290-300: statusFromResult mapping) |

### 3.2 Mission (`src/mission/`)

| File | Lines | Description | Audited | Key findings |
|---|---|---|---|---|
| `orchestrator.ts` | 1035 | Mission execution. `run()` lifecycle, specialist loop, verifier wiring, bounded retry. | full | RB-2 (line 207: hardcoded `mission-verifier-1`), C-VERIFY-001 (line 677: full VerificationResult dropped at 938-952), C-VERIFY-002 (lines 750-754: retry uses same checks but different retriedSources), C-VERIFY-004 (lines 672-674: flightEvents only when MemoryFlightRecorder), C-VERIFY-005 (line 607: 60-char fingerprint), C-LEARNING-015 (line 633: verifier genome shared), E-CONCURRENCY-003 (lines 285-289: `surfacesByWorker` instance field), E-CONCURRENCY-005 (line 207: hardcoded verifier ID), D-FAILURE-009 (lines 587-592: `checks: () => []` silent-success window) |
| `verification.ts` | 601 | `VerificationLoop`. 7 check kinds: file, command, evidence, mission-input, flight-action, content-in-artifacts, hash-match. | full | C-VERIFY-002 (lines 219-294: clean-room not cleared), C-VERIFY-005 (lines 330-368: 60-char substring match), C-VERIFY-010 (lines 300, 448, 486: path traversal), C-VERIFY-011 (lines 444-480: empty-file edge case), C-VERIFY-012 (lines 242-264: no default case) |
| `flight-recorder.ts` | 401 | `MemoryFlightRecorder`, `FileFlightRecorder`, `SECRET_PATTERNS`, `sanitize()`, `scrub()`. | full | C-VERIFY-007 (lines 265-267: MemoryFlightRecorder no scrub), C-VERIFY-008 (lines 286-302: pattern gaps), C-VERIFY-009 (lines 373-390: FileFlightRecorder unbounded), C-LEARNING-011 (line 225: gateway uses MemoryFlightRecorder) |
| `artifact-record.ts` | 231 | `ArtifactRegistry`, `buildArtifactRecord`, `hashContent`. **Dead code** (no production imports). | full | C-VERIFY-006 (dead code — G6-01 P1 H-41 not delivered), C-LEARNING-012 (confirmed dead) |
| `failure-class.ts` | ~150 | `classifyError` → 11-class taxonomy. | full | D-FAILURE-002 (lines 110-125: 'mcp tool' substring heuristic), D-FAILURE-003 (lines 98-108: 'missing' substring too broad) |
| `config-validator.ts` | ~210 | Validates env var presence + format. Throws `ConfigurationError`. | full | B-EXEC-004 (line 188: declares OPENBOT_ENDPOINT as optional), C-SECURITY-009 (no echo of values — positive) |

### 3.3 Worker (`src/worker/`)

| File | Lines | Description | Audited | Key findings |
|---|---|---|---|---|
| `worker-agent.ts` | 994 | `WorkerAgent.run()` loop. parseAction, grantsFor, execute, scratchpad, finish. | full | C-SECURITY-001 (lines 386-433, 555-580: unrestricted run_command), C-SECURITY-002 (lines 715-723, 839-842: scratchpad injection), C-SECURITY-003 (lines 602-622: no path validation), C-SECURITY-006 (lines 885-902: worker-finished.summary leak), C-SECURITY-007 (lines 369-384: permissive parseAction), C-PROTOCOLS-001 (lines 562-580: MCP output unescaped), D-FAILURE-002 (lines 853-861: BUDGET_EXHAUSTED misclassifies MCP failures) |
| `handoff.ts` | 195 | `MissionHandoffs` channel. Depth cap with try/finally decrement. | full | E-CONCURRENCY-011 (positive: depth bounded) |

### 3.4 Runtime (`src/runtime/`)

| File | Lines | Description | Audited | Key findings |
|---|---|---|---|---|
| `computer.ts` | 220 | `WorkerComputer` contract interface. | full | C-SECURITY-003 (no validateWorkspacePath helper) |
| `composite-runtime.ts` | ~150 | Composes multiple runtimes. | head | none — not used in gateway |
| `openbot/adapter.ts` | 197 | `OpenBotRuntimeAdapter`. `ensureWorker` (idempotent by botId), `stopWorker`, `close()`. | full | RB-1 (line 49: internal computers Map not exposed), RB-2 (lines 82-87: idempotent ensure), B-EXEC-003 (lines 155-166: stopWorker never called on shutdown), C-VERIFY-002 (lines 155-166: workspace dir not deleted), C-VERIFY-003 (lines 72-110: shared botId collision), C-LEARNING-014 (close() never called by gateway) |
| `openbot/computer-process.ts` | 321 | Spawns `bun src/index.ts` for each worker. `detached: true` process-group kill pattern. | full | B-EXEC-003 (orphaned workers on shutdown), C-VERIFY-002 (lines 167-168: mkdir without clearing), C-SECURITY-001 (line 181: `EGRESS_POLICY_REQUIRED: '0'` default), C-LEARNING-014 (no parent-death detection), B-GATEWAY-005 (positive: correct process-group kill pattern) |
| `openbot/computer-api.ts` | 228 | HTTP client to OpenBot worker. Bearer auth. `assertOk` includes 300-char body excerpt. | full | C-SECURITY-008 (lines 59-74: body echo in error), D-FAILURE-FINDING-004 path (60s timeout present at line 87) |
| `mcp/capability-provider.ts` | 192 | MCP client wrapper. `invokeTool`, `listTools` (names only). | full | C-PROTOCOLS-001 (lines 125-128: raw text returned), C-PROTOCOLS-002 (line 128: ok misclassified for empty-text), D-FAILURE-002 (lines 130-136: catches all exceptions) |
| `federation/service.ts` | 503 | Outbound A2A delegation. `delegate()`, `cancel()`, polling loop, `extractTask` heuristic. | full | C-PROTOCOLS-012 (lines 30-31, 269-275: getTask not retried vs comment), C-PROTOCOLS-013 (lines 107-113: no identity verification), C-PROTOCOLS-014 (lines 227-248: cancel() no deadline), C-PROTOCOLS-015 (lines 298-305: non-terminal states poll to timeout), C-LEARNING-018 (lines 150-174: non-idempotent messageId) |
| `federation/types.ts` | 264 | Federation types + status mapping. | full | C-PROTOCOLS-013 (lines 211-213: no signature check) |
| `opendots/client.ts` | ~200 | OpenDots REST client. Bearer token. | full | C-SECURITY-008 (lines 63-72, 181-185: 500-char body echo) |
| `opendots/adapter.ts` | ~150 | OpenDots workspace adapter. | full | none new (C-SECURITY-008 inherits) |
| `openmuse/client.ts` | ~190 | OpenMuse REST client. | full | C-SECURITY-008 (lines 180-184: 500-char body echo) |
| `openmuse/adapter.ts` | ~150 | OpenMuse durable delegation adapter. | full | none new |

### 3.5 Providers (`src/providers/`)

| File | Lines | Description | Audited | Key findings |
|---|---|---|---|---|
| `zai-reasoning.ts` | ~200 | `ZAIReasoningProvider`. Wraps `z-ai-web-dev-sdk`. 6-step rate-limit backoff. | full | D-FAILURE-001 (lines 120-169: NO per-call timeout), B-EXEC-005 (line 142-157: no `signal` to SDK), G-CLAIMS-001 (ZAI_API_KEY resolution path unverified) |
| `jev-decision-provider.ts` | ~440 | JEV decision provider. | full | C-SECURITY-008 (lines 121-127, 381-391: 200-char body echo) |

### 3.6 Organization / Genome / Goal / Routing / Work / Learning / AG-UI / Contracts

| File | Lines | Description | Audited | Key findings |
|---|---|---|---|---|
| `organization/organization-planner.ts` | ~640 | Plans specialist roster. `applyAdvisoryPattern`, `redistributeNeeds`. | full | RB-2 (lines 197, 245: deterministic worker IDs), C-LEARNING-003 (lines 452-470: intersection matching), C-LEARNING-006 (lines 497-525, 590-622: capability drift) |
| `genome/genome-compiler.ts` | ~350 | Compiles worker genomes from plan + ownership registry. Tool grants. | full | C-LEARNING-008 (line 155, 270-308: `extraOperationalNeeds` seam) |
| `goal/goal-compiler.ts` | ~360 | `compile(goal)` → MissionPlan. `validateGoal`. | full | none new (positive: validation is loud — D-FAILURE scenarios #1, #2) |
| `goal/llm-understanding.ts` | ~100 | `parseRequirements` (first-`{`-to-last-}`}`). | full | C-SECURITY-007 (lines 69-74: permissive parse) |
| `routing/decision-provider.ts` | ~100 | Routing decision abstraction. | head | none |
| `routing/cognitive-router.ts` | ~150 | Cognitive router. | head | none — not used in gateway hot path |
| `work/git-workspace.ts` | ~440 | Git workspace manager. `inside()`, `shellQuote`. | lines 1-200 | C-SECURITY-012 (lines 90-94: shellQuote helper exists, not used everywhere) |
| `work/dev-runtime.ts` | ~250 | Development runtime with httpProbeCommand + previewServerCommand. | full | C-SECURITY-012 (lines 189-202: previewServerCommand no escaping), F-PACKAGE-005 (env var name drift) |
| `work/integration-manager.ts` | ~150 | Integration manager. | head | none new |
| `work/repo-mission.ts` | ~100 | Repo mission adapter. | head | none |
| `learning/experience.ts` | ~80 | `deriveExperience` pure function. | full | none — not wired into gateway (C-LEARNING-001) |
| `learning/experience-store.ts` | ~100 | `MemoryExperienceStore`, `FileExperienceStore`. | full | C-LEARNING-002 (no FilePatternStore equivalent) |
| `learning/candidate-generator.ts` | ~150 | `StatisticalCandidateGenerator`. | full | C-LEARNING-003 (signature-based grouping) |
| `learning/candidate.ts` | ~50 | Candidate type. | full | none |
| `learning/evaluation.ts` | ~250 | `RuleCandidateEvaluator`. 3 rules: PROMOTE/REJECT/TENTATIVE. | full | C-LEARNING-004 (lines 213-251: signature-aware contradictions too narrow) |
| `learning/pattern.ts` | ~180 | `RulePatternRetriever`, `promoteCandidate`. | full | C-LEARNING-005 (no expiry/TTL), C-LEARNING-002 (no FilePatternStore) |
| `learning/evolution.ts` | ~250 | Evolution sandbox. `promoteVariant`. | full | C-LEARNING-007 (lines 222-237: no governance check) |
| `learning/index.ts` | ~10 | Re-exports. | head | none |
| `agui/event-bridge.ts` | 308 | FlightEvent → AG-UI event mapper. | full | C-PROTOCOLS-006 (line 230: invalid `name` field on SUBAGENT_FINISHED), C-PROTOCOLS-007 (lines 224-259: no SUBAGENT_ERROR), C-PROTOCOLS-008 (line 280: lossy TOOL_CALL_RESULT), C-PROTOCOLS-009 (lines 143-169: silently drops failure-classified + federation events), C-PROTOCOLS-010 (line 264: toolCallId collisions on reasoning-retry), C-PROTOCOLS-011 (no reconnection/replay), C-PROTOCOLS-018 (lines 186-211: no terminal event if start missed) |
| `contracts/core.ts` | ~50 | Shared contract types. | head | none |
| `index.ts` | ~30 | Public API re-exports. | full | F-PACKAGE-008 (lines 24-25: wildcard re-exports leak internal classes) |

### 3.7 Tests (`tests/`) and experiments

66 test files were inspected at varying depth. Full inspection (full file read) for the gateway, mission, worker, runtime, agui, learning, and protocol-probe test suites. Head or grep-only for peripheral suites. Key test-file observations:

- `tests/gateway/clean-room-gateway.test.ts` — RB-3 source. GATEWAY-04 only asserts npx parent exit.
- `tests/gateway/separate-process-e2e.test.ts` — RB-3 secondary. Adds 200ms `setTimeout` padding.
- `tests/gateway/helpers.ts` — uses `MemoryComputer` default; `key.slice(0,4)` test keys reveal 80% of 5-char keys.
- `tests/gateway/isolation.test.ts` — ISO-01..04 cover cross-caller 404s (dev mode only).
- `tests/gateway/concurrent-a2a.test.ts` — CONCURRENT-01..05 (passes in dev mode).
- `tests/gateway/cancellation.test.ts` — CANCEL-01..04 (dev mode only).
- `tests/gateway/execution-mode.test.ts` — verifies fail-closed path; no positive production-mode test exists (G-CLAIMS-013).
- `tests/mission/verification.test.ts`, `verification-hash-match.test.ts`, `flight-recorder.test.ts`, `artifact-record.test.ts`, `secret-redaction.test.ts` — comprehensive per-feature coverage; gaps listed in C-VERIFY coverage matrix.
- `tests/runtime/federation-service.test.ts`, `federation-integration.test.ts` — outbound A2A delegation; gaps in C-PROTOCOLS Section.
- `tests/runtime/mcp-capability-provider.test.ts` — MCP client; gaps in C-PROTOCOLS Section.
- `tests/agui/event-bridge.test.ts` — AG-UI mapping; gaps in C-PROTOCOLS Section.
- `tests/learning/*` — thorough semantic-integrity tests for the (unwired) learning loop.

---

## 4. Per-Domain Findings Summary (D01–D22)

### D01 — Project structure and packaging
- **Inspected:** Yes (full). `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `.gitignore`, `README.md`, `src/index.ts` re-exports.
- **Findings:** F-PACKAGE-001 (positive reproducibility), F-PACKAGE-006 (no CI), F-PACKAGE-007 (engines advisory only), F-PACKAGE-008 (wildcard re-exports), F-PACKAGE-009 (`bun` undeclared), F-PACKAGE-012 (scripts/ ignored), F-PACKAGE-013 (positive supply-chain), F-PACKAGE-014 (false secure/ gitignore claim).
- **Evidence gaps:** None.

### D02 — Build pipeline
- **Inspected:** Yes (full). Fresh-clone reproduction at `/tmp/fresh-clone-g6-07/` confirmed `npm ci && npm run typecheck && npm run lint && npm test` all PASS.
- **Findings:** F-PACKAGE-001 (positive). F-PACKAGE-010 (test count drift across 5 docs).
- **Evidence gaps:** None.

### D03 — Type safety and TypeScript configuration
- **Inspected:** Yes. `tsconfig.json` reviewed. No `eslint-disable` in production code.
- **Findings:** F-PACKAGE-H5 (informational: `noUncheckedIndexedAccess` not enabled).
- **Evidence gaps:** None.

### D04 — Lint rules and code style
- **Inspected:** Yes. `eslint.config.js` reviewed. `eslint .` passes.
- **Findings:** None.
- **Evidence gaps:** None.

### D05 — Test harness
- **Inspected:** Yes. `vitest.config.ts` + all 66 test files. 536 passing / 9 skipped / 545 total.
- **Findings:** D-FAILURE-004 through D-FAILURE-008 (5 audit tests for untested edge cases), G-CLAIMS-013 (production-mode evidence gap), F-PACKAGE-010 (test-count drift).
- **Evidence gaps:** None — gaps are now pinned by audit tests awaiting promotion to permanent regression tests.

### D06 — Public API surface
- **Inspected:** Yes. `src/index.ts` + 17 re-exports.
- **Findings:** F-PACKAGE-008 (wildcard re-exports).
- **Evidence gaps:** None.

### D07 — Smoke and integration tests
- **Inspected:** Yes. `experiments/g6-04/smoke-mission.ts` runs cleanly. G6-06 clean-room script inspected.
- **Findings:** F-PACKAGE-002 (orphaned gateway processes), F-PACKAGE-003 (regressive failure-handling vs G6-04 script), G-CLAIMS-006 (false-positive PASS).
- **Evidence gaps:** Clean-room script run inside the sandbox CI network has different latency characteristics than GitHub Actions (not measured).

### D08 — Reproducibility
- **Inspected:** Yes. `docs/REPRODUCIBILITY.md`, `data/dependency-baseline.json`.
- **Findings:** F-PACKAGE-011 (data/dependency-baseline.json stale @ag-ui/core version), F-PACKAGE-007 (engine-strict not set), F-PACKAGE-014 (secure/ gitignore claim false).
- **Evidence gaps:** None.

### D09 — Goal understanding
- **Inspected:** Yes. `src/goal/goal-compiler.ts`, `src/goal/llm-understanding.ts`.
- **Findings:** C-SECURITY-007 (permissive parseRequirements).
- **Evidence gaps:** `parseRequirements` only invoked from experiment runners; never exercised by gateway tests because gateway uses `goalCompiler.compile()` directly.

### D10 — Organization planning
- **Inspected:** Yes. `src/organization/organization-planner.ts`.
- **Findings:** RB-2 (lines 197, 245: deterministic worker IDs), C-LEARNING-003, C-LEARNING-006.
- **Evidence gaps:** None.

### D11 — MCP integration
- **Inspected:** Yes. `src/runtime/mcp/capability-provider.ts`, `tests/runtime/mcp-capability-provider.test.ts`.
- **Findings:** C-PROTOCOLS-001 (HIGH: prompt injection via tool output), C-PROTOCOLS-002 (MEDIUM: ok misclassified for empty-text), D-FAILURE-002 (MEDIUM: BUDGET_EXHAUSTED misclassification).
- **Evidence gaps:** No real MCP server was available in the sandbox. All tests use `InMemoryTransport`. Real wire-level MCP behavior (transport drops, JSON-RPC framing failures) is unverified.

### D12 — A2A integration
- **Inspected:** Yes. `src/gateway/a2a-server.ts`, `src/runtime/federation/service.ts`, `src/runtime/federation/types.ts`, all federation tests.
- **Findings:** C-PROTOCOLS-003 (AgentCard missing required fields), C-PROTOCOLS-004 (HIGH: empty securitySchemes), C-PROTOCOLS-005 (HIGH: streaming truncation), C-PROTOCOLS-012 (getTask not retried), C-PROTOCOLS-013 (no identity verification), C-PROTOCOLS-014 (cancel() no deadline), C-PROTOCOLS-015 (non-terminal state polling), C-PROTOCOLS-016 (fabricated CANCELLED/FAILED), C-PROTOCOLS-017 (no per-request timeout), C-PROTOCOLS-019 (HIGH: cross-caller status leak), B-A2A-001, B-A2A-002, B-A2A-003, B-A2A-005, G-CLAIMS-005, G-CLAIMS-009.
- **Evidence gaps:** No real remote A2A agent was available. Inbound A2A tested in-process via SDK's `DefaultRequestHandler`. Outbound A2A tested via stub federation clients.

### D13 — AG-UI integration
- **Inspected:** Yes. `src/agui/event-bridge.ts`, `tests/agui/event-bridge.test.ts`.
- **Findings:** C-PROTOCOLS-006 (invalid `name` field on SUBAGENT_FINISHED), C-PROTOCOLS-007 (HIGH: no SUBAGENT_ERROR), C-PROTOCOLS-008 (lossy TOOL_CALL_RESULT), C-PROTOCOLS-009 (silent event drops), C-PROTOCOLS-010 (toolCallId collisions), C-PROTOCOLS-011 (no replay), C-PROTOCOLS-018 (no terminal event if start missed).
- **Evidence gaps:** No real AG-UI consumer (CopilotKit, etc.) was tested. Event schemas validated against `node_modules/@ag-ui/core/dist/schemas.d.ts` only.

### D14 — Worker agent and reasoning provider
- **Inspected:** Yes. `src/worker/worker-agent.ts`, `src/providers/zai-reasoning.ts`, `src/providers/jev-decision-provider.ts`.
- **Findings:** C-SECURITY-001, C-SECURITY-002, C-SECURITY-003, C-SECURITY-006, C-SECURITY-007, D-FAILURE-001, D-FAILURE-002, B-EXEC-005 (ZAI_API_KEY path unverified).
- **Evidence gaps:** Real ZAI SDK calls not exercised (no credentials). Real JEV provider calls not exercised.

### D15 — Artifacts and verification
- **Inspected:** Yes. `src/mission/verification.ts`, `src/mission/artifact-record.ts`, `src/mission/orchestrator.ts` (verifier wiring).
- **Findings:** RB-1, C-VERIFY-001 (binary verified flag), C-VERIFY-002 (clean-room not cleared), C-VERIFY-003 (hardcoded verifier genome), C-VERIFY-004 (flight-action disabled with FileFlightRecorder), C-VERIFY-005 (60-char fingerprint), C-VERIFY-006 (ArtifactRegistry dead), C-VERIFY-010 (path traversal), C-VERIFY-011 (hash edge cases), C-VERIFY-012 (no default case), C-LEARNING-012, C-LEARNING-016.
- **Evidence gaps:** Real OpenBot verifier workspace on disk not exercised end-to-end (no OpenBot checkout).

### D16 — Flight recorder and observability
- **Inspected:** Yes. `src/mission/flight-recorder.ts`, `src/gateway/mission-service.ts` (`getEvents`, `toEventRecord`, `toSnapshot`).
- **Findings:** C-VERIFY-007 (secret leak), C-VERIFY-008 (pattern gaps), C-VERIFY-009 (unbounded growth), C-SECURITY-006 (worker-finished.summary leak), C-SECURITY-008 (error body echo), C-LEARNING-011 (MemoryFlightRecorder in gateway; no replay).
- **Evidence gaps:** None.

### D17 — Learning and evolution
- **Inspected:** Yes. All of `src/learning/`. Learning loop is fully implemented but **not wired into the gateway**.
- **Findings:** C-LEARNING-001 (integration gap), C-LEARNING-002 (no pattern persistence), C-LEARNING-003 (intersection matching), C-LEARNING-004 (signature-aware contradictions too narrow), C-LEARNING-005 (no expiry/TTL), C-LEARNING-006 (capability drift), C-LEARNING-007 (no governance on promoteVariant), C-LEARNING-008 (extraOperationalNeeds seam).
- **Evidence gaps:** Because the learning loop is dormant in the gateway, all C-LEARNING-001..008 findings are latent. The 7 negative-transfer/governance findings cannot be triggered through the gateway without first wiring the loop in. The positive findings (Cohort 001 contamination prevention, evaluator soundness) are verified at the unit-test level only.

### D18 — Persistence and recovery
- **Inspected:** Yes. `src/gateway/mission-service.ts`, `src/gateway/main.ts` (shutdown handler), `src/runtime/openbot/computer-process.ts` (orphan detection).
- **Findings:** C-LEARNING-009 (in-memory missions), C-LEARNING-010 (InMemoryTaskStore), C-LEARNING-011 (MemoryFlightRecorder), C-LEARNING-013 (no shutdown cleanup), C-LEARNING-014 (no parent-death detection), C-LEARNING-017 (no checkpoints/WAL/snapshot), C-LEARNING-018 (duplicate side-effect risk on restart).
- **Evidence gaps:** No actual restart-recovery test was performed (none exists in code). The `RECOVERY-GATE.md` is a one-off historical incident doc, not a general mechanism.

### D19 — Concurrency and resource exhaustion
- **Inspected:** Yes. `src/gateway/mission-service.ts`, `src/gateway/a2a-server.ts`, `src/mission/orchestrator.ts`, `src/worker/worker-agent.ts`, `src/runtime/openbot/adapter.ts`, `tests/gateway/concurrent-a2a.test.ts`. 3 concurrency probe scenarios executed.
- **Findings:** B-REGISTRY-001, B-REGISTRY-002, B-REGISTRY-003, E-CONCURRENCY-001..005, E-CONCURRENCY-006..011 (6 positive confirmations), B-A2A-002, B-A2A-003, B-EXEC-003 (orphaned workers), C-LEARNING-015.
- **Evidence gaps:** Concurrency probes used N=10 max. Real production load (N=50 active missions) not exercised. OpenBot adapter concurrent-mission collision is CODE-CONFIRMED but not runtime-reproduced (no OpenBot checkout).

### D20 — Security and trust boundaries
- **Inspected:** Yes. 20 control categories. 12 security findings. `npm audit` run; 0 vulnerabilities.
- **Findings:** C-SECURITY-001..012, C-PROTOCOLS-001, C-PROTOCOLS-013, C-PROTOCOLS-019, B-A2A-001, B-A2A-005, C-VERIFY-007, C-VERIFY-010, C-VERIFY-008, C-SECURITY-009 (positive supply-chain).
- **Evidence gaps:** No prompt-injection attack was executed against a real LLM (no credentials). The C-SECURITY-001 finding (run_command unrestricted) is HIGH_CONFIDENCE_RISK based on code inspection + threat model, not empirical exploit. Real OpenBot egress policy not measured.

### D21 — Packaging and deployment
- **Inspected:** Yes. `.github/` ABSENT. `experiments/g6-06/clean-room-run.sh` inspected and executed.
- **Findings:** F-PACKAGE-001..014, B-GATEWAY-001..006.
- **Evidence gaps:** CI behavior unverified (no CI exists). Clean-room run inside sandbox vs GitHub Actions: network latency for `git clone https://github.com/...` not measured.

### D22 — Documentation and claims
- **Inspected:** Yes. All 14 claim sources cross-checked against code at audited commit.
- **Findings:** G-CLAIMS-001..013 (13 mismatches), F-PACKAGE-004, F-PACKAGE-010, F-PACKAGE-011, F-PACKAGE-014, B-EXEC-004.
- **Evidence gaps:** None — every claim was verified against code at `8e0ba68`.

---

## 5. Coverage Matrix

The matrix below maps Domain × Component × Inspection × Test × Real/Simulated. Components are abbreviated: `main` = gateway/main.ts, `mSvc` = gateway/mission-service.ts, `a2a` = gateway/a2a-server.ts, `orch` = mission/orchestrator.ts, `ver` = mission/verification.ts, `fr` = mission/flight-recorder.ts, `ar` = mission/artifact-record.ts, `fc` = mission/failure-class.ts, `wa` = worker/worker-agent.ts, `oa` = runtime/openbot/adapter.ts, `cp` = runtime/openbot/computer-process.ts, `ca` = runtime/openbot/computer-api.ts, `mcp` = runtime/mcp/capability-provider.ts, `fed` = runtime/federation/service.ts, `eb` = agui/event-bridge.ts, `zai` = providers/zai-reasoning.ts, `op` = organization/organization-planner.ts, `gc` = genome/genome-compiler.ts, `goal` = goal/goal-compiler.ts, `lrn` = learning/* (all), `pkg` = package.json + .github + experiments scripts, `docs` = docs/release/*.

**Inspected (Insp):** F=full, H=head, G=grep, N=not inspected
**Tested (Tst):** Y=yes, P=partial, N=no
**Real/Sim (R/S):** R=real integration exercised, S=simulated/stubbed, N=not exercised at runtime

| Domain | Component | Insp | Tst | R/S | Notes |
|---|---|---|---|---|---|
| D01 | pkg | F | Y | R | fresh clone + npm ci |
| D01 | src/index.ts | F | Y | S | export surface inventory |
| D02 | pkg | F | Y | R | typecheck + lint + tests pass |
| D03 | tsconfig.json | F | Y | R | tsc --noEmit exit 0 |
| D04 | eslint.config.js | F | Y | R | eslint . exit 0 |
| D05 | tests/* | F | Y | S | 536/9/545 in dev mode |
| D06 | src/index.ts | F | Y | S | wildcard re-export audit |
| D07 | experiments/g6-04/smoke-mission.ts | F | Y | R | smoke runs cleanly |
| D07 | experiments/g6-06/clean-room-run.sh | F | Y | R | leaves 14 orphan processes |
| D08 | data/dependency-baseline.json | F | N | S | @ag-ui/core version stale |
| D08 | docs/REPRODUCIBILITY.md | F | N | — | engine-strict overstated |
| D09 | goal | F | Y | S | dev-mode tests only |
| D09 | goal/llm-understanding.ts | F | P | S | parseRequirements only in experiments |
| D10 | op | F | Y | S | dev-mode planner tests |
| D11 | mcp | F | Y | S | InMemoryTransport only |
| D12 | a2a (inbound) | F | Y | S | in-process DefaultRequestHandler |
| D12 | fed (outbound) | F | Y | S | stub federation clients |
| D12 | a2a (cross-caller) | F | Y | S | isolation tests dev mode |
| D12 | a2a (streaming) | F | N | N | sendMessageStream/subscribe untested |
| D12 | a2a (AgentCard) | F | N | S | schema validated, not served to real client |
| D13 | eb | F | Y | S | in-process event-bridge tests |
| D13 | eb (real AG-UI consumer) | F | N | N | no CopilotKit-style sink tested |
| D14 | wa | F | Y | S | scripted reasoning provider |
| D14 | zai | F | N | N | no ZAI credentials; provider path untested |
| D14 | zai (429 backoff) | F | N | N | DEFAULT_RETRY_BACKOFF_MS untested |
| D14 | zai (timeout) | F | N | N | no per-call timeout exists |
| D15 | ver | F | Y | S | per-check tests in tests/mission/ |
| D15 | ver (path traversal) | F | N | N | no test for `..` in check.path |
| D15 | ver (unknown kind) | F | N | N | no default-case test |
| D15 | ar | F | N | N | dead code; no production test |
| D15 | orch (verifier genome) | F | N | N | verifier-id collision untested |
| D15 | orch (clean-room clear) | F | N | N | no within-mission retry test |
| D16 | fr | F | Y | S | MemoryFlightRecorder tests |
| D16 | fr (FileFlightRecorder) | F | P | S | used only in experiments |
| D16 | mSvc.getEvents | F | Y | S | secret-leak gap not tested |
| D17 | lrn | F | Y | S | unit tests only; not wired into gateway |
| D17 | lrn (gateway integration) | F | N | N | learning loop dormant in gateway |
| D18 | mSvc.missions Map | F | Y | S | in-memory; restart loss documented |
| D18 | main.shutdown() | F | N | N | no abortAll/stopAll test |
| D18 | cp (parent-death) | F | N | N | no parent-death test |
| D19 | mSvc.start() (concurrency) | F | Y | S | probe N=10 |
| D19 | mSvc.cancel() (concurrent) | F | Y | S | probe N=5 |
| D19 | mSvc (idempotency race) | F | Y | S | probe N=5 same-key |
| D19 | oa (shared adapter) | F | N | N | collision untested at runtime |
| D19 | orch (surfacesByWorker) | F | Y | S | per-mission instance safe |
| D20 | wa.run_command policy | F | N | N | no command-content test |
| D20 | wa.parseAction injection | F | N | N | no injection regression test |
| D20 | mSvc (caller isolation) | F | Y | S | ISO-01..04 dev mode |
| D20 | http-server (constant-time) | F | N | S | code inspection only |
| D20 | main (GENESIS_API_KEYS) | F | P | S | slice(0,4) leak not tested |
| D20 | a2a (extractCallerFromUser) | F | N | N | fallback path untested |
| D21 | pkg | F | Y | R | fresh-clone pipeline |
| D21 | .github/ | F | N | N | ABSENT |
| D22 | docs/release/* | F | Y | R | every claim cross-checked |
| D22 | experiments/g6-06/* | F | Y | R | clean-room run reproduced |

### Aggregate coverage

| Coverage | Count | % of 22 domains |
|---|---|---|
| Fully inspected (F) on all primary components | 22 | 100% |
| Domain has at least one runtime-tested path | 19 | 86% |
| Domain has at least one simulated-only path | 22 | 100% |
| Domain has at least one not-exercised path | 18 | 82% |
| Domain has zero evidence gaps | 4 (D01, D02, D03, D04, D06, D22) | 27% (6/22) |
| Domain has runtime-reproduction evidence | 9 (D01, D02, D03, D04, D05, D07, D19, D21, D22) | 41% |

### Test execution summary

| Suite | Real | Simulated | Not exercised |
|---|---|---|---|
| Baseline (`npm test`) | 536 passing | MemoryComputer + scripted reasoning | production positive path |
| Audit tests | 6 new tests | stub providers | — |
| Probe scripts | 4 (clean-room v1/v2/v3, concurrency, prod fail-closed) | stub providers | — |
| Failure injection | 23 scenarios (16 covered + 5 audit + 2 partial) | dev-mode only | ZAI 429 backoff, ZAI timeout |
| Concurrency scenarios | 3 (10 submits, 5 same-key, 5 cancels) | dev-mode only | production-mode concurrency |
| Security scenarios | 12 findings across 20 controls | dev-mode only | real prompt-injection attack |

---

## 6. Components Not Exercised at Runtime

The following components exist in code, were inspected statically, but were NOT exercised at runtime during the audit:

1. **`src/providers/zai-reasoning.ts` — ZAI SDK call path.** No ZAI credentials available. The 6-step rate-limit backoff schedule (`DEFAULT_RETRY_BACKOFF_MS`) and the absence of per-call timeout are CODE-CONFIRMED but never reproduced.
2. **`src/runtime/openbot/adapter.ts` — OpenBot worker spawning.** No OpenBot checkout in the sandbox. The `detached: true` + process-group-kill pattern in `computer-process.ts:173-290` is verified by code inspection but never executed against a real `bun src/index.ts` child.
3. **`src/runtime/federation/service.ts` — outbound A2A to a remote agent.** No remote A2A endpoint available. All federation tests use stub clients.
4. **`src/runtime/mcp/capability-provider.ts` — real MCP server.** No MCP server available. All MCP tests use `InMemoryTransport`.
5. **`src/agui/event-bridge.ts` — real AG-UI consumer (CopilotKit, etc.).** No network sink available. All AG-UI tests use an in-process event collector.
6. **Production-mode positive path (RB-1 gap).** No test in the entire suite exercises a successful production mission. All gateway tests use `MemoryComputer` + scripted reasoning (development mode). This is the gap that allowed RB-1 and RB-2 to ship.
7. **`src/learning/*` — learning loop in gateway.** The loop is fully implemented and unit-tested but never invoked from `src/gateway/`. All C-LEARNING-001..008 findings are latent.
8. **`src/mission/artifact-record.ts` — ArtifactRegistry.** Implemented, unit-tested, but never imported by production code (dead code).
9. **Restart recovery.** No persistence layer exists; no restart-recovery test exists; the `RECOVERY-GATE.md` is a one-off historical incident doc.

---

## 7. Real Integrations Tested (in-process, against real SDK code paths)

| Integration | Real path exercised | Evidence |
|---|---|---|
| `@a2a-js/sdk@1.3.0` InMemoryTaskStore + DefaultRequestHandler | YES (in-process) | `tests/gateway/a2a-inbound.test.ts`, `tests/gateway/concurrent-a2a.test.ts` |
| `@ag-ui/core@1.0.2` EventType schemas | YES (schema validation) | `node_modules/@ag-ui/core/dist/schemas.d.ts` |
| `@modelcontextprotocol/sdk@1.32.1` Client | YES (in-process) | `tests/runtime/mcp-capability-provider.test.ts` |
| native `node:http` server | YES | `tests/gateway/http-api.test.ts`, fresh-clone probe |
| native `node:crypto` `timingSafeEqual` | YES (code inspection) | `src/gateway/http-server.ts:293-304`, `src/gateway/a2a-server.ts:512-522` |
| native `node:async_hooks` `AsyncLocalStorage` | YES (in-process) | `tests/gateway/concurrent-a2a.test.ts` CONCURRENT-01..05 |
| `express@5.2.1` (transitive, optional peer) | NO | not opted in via `@a2a-js/sdk/express` |

## 8. Simulated Integrations (stubbed)

| Integration | Stub used | Where |
|---|---|---|
| Reasoning provider | `ScriptedReasoningProvider`, `SlowReasoningProvider` | `tests/helpers/*` |
| WorkerComputer | `MemoryComputer` (in-memory filesystem, no path validation) | `tests/helpers/memory-runtime.ts` |
| Federation client | `StubClient` returning canned Tasks | `tests/runtime/federation-service.test.ts` |
| MCP server | `InMemoryTransport` (no wire-level behavior) | `tests/runtime/mcp-capability-provider.test.ts` |
| AG-UI consumer | in-process event collector | `tests/agui/event-bridge.test.ts` |
| OpenBot worker process | n/a — `OpenBotRuntimeAdapter` not exercised | — |

---

## 9. Audit Trail

- All probe scripts are in `experiments/g6-07-audit/reproduction-evidence/`.
- All 5 audit tests are in `experiments/g6-07-audit/reproduction-evidence/g6-07-failure-injection.test.ts`.
- The findings register is at `experiments/g6-07-audit/findings-register.json` (machine-readable).
- The detailed finding records are in `findings-detailed.md`.

END OF ARCHITECTURE AND COVERAGE MATRIX.
