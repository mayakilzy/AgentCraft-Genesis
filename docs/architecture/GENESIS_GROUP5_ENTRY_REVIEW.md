# GENESIS_GROUP5_ENTRY_REVIEW

**Date:** 2026-10-07
**Mode:** G5-00 — Recovery, Reading, Research, Architecture Verification, Planning
**Authority:** This document is the output of G5-00. It is documentation-only. No production code was changed, no dependencies installed, no MCP/AG-UI/Academy implementation begun.

---

## 1. Recovered Repository State

| Field | Value |
|-------|-------|
| Repository | `https://github.com/mayakilzy/AgentCraft-Genesis.git` |
| Branch | `build/group-03-repository-work` |
| HEAD | `d40ef21bc443cf5a99535425e6e9f4982c2c27b7` |
| Expected HEAD (from prompt) | `d40ef21bc443cf5a99535425e6e9f4982c2c27b7` |
| HEAD match | YES |
| Worktree | CLEAN |
| Test files | 39 passed |
| Tests | 310 passed \| 9 skipped (319 total) |
| Typecheck | PASS |
| Lint | PASS |
| Runtime dependencies | 1 (`yaml@2.9.1`) |
| Production LOC | ~9797 across 35 files |
| Node | v24.21.0 |
| Toolchain | TypeScript 5.9.3 (strict, NodeNext, ESM), vitest 5, eslint 10 |

The expected Group 4 final checkpoint is fully reproduced. No divergence in HEAD, branch, worktree, tests, typecheck, or lint. The default clone branch (`build/group-01-foundation-born-core`) was checked out to the expected Group 4 branch; the expected HEAD was reached exactly.

---

## 2. Group 4 Handoff Verification

### 2.1 `GENESIS_GROUP5_ENTRY_CONTRACT.md` — READ IN FULL

The entry contract is authoritative and internally consistent. Key frozen decisions:

- **GROUP_5_ENTRY_READY = YES**, **SAFE_TO_BEGIN_GROUP_5 = YES** (implicit).
- MCP = ADOPT, activation target = Group 5 entry. Pin spec `2026-07-28` (RC), SDK `@modelcontextprotocol/sdk@1.32.1`.
- AG-UI = ADOPT, activation target = Group 5 entry. Pin protocol `1.0`, SDK `@ag-ui/core@1.0.2`.
- A2A = ADOPT at federation edge; DEFER internally. Target = TASK-036+.
- CopilotKit = ADAPT (ADOPT AG-UI + CopilotKit OSS; DEFER Intelligence as optional/swappable backend).
- Jev = optional DecisionProvider primitive; wrap as MCP tool; benchmark at TASK-037.

### 2.2 `GENESIS_GROUP4_FINAL_STATE.md` — READ IN FULL

- **GROUP_4_STATUS = CLOSED**. All Group-4 responsibilities are CLOSED WITH EVIDENCE or EXPLICITLY DEFERRED with reason, owner, and target phase.
- **GROUP_5_ENTRY_READY = YES**.
- Final HEAD recorded in this doc as `99e25f8` (pending final commit); the actual pushed HEAD is `d40ef21` ("GROUP 4 FINAL CLOSURE: handoff package + Group 5 entry contract"), which is the final commit the doc anticipated. Consistent.
- Strongest evidence: Phase 4.8E (natural three-pillar execution PROVEN) and Phase 4.11 (measured learning LEARNING_PASS, 5→2 workers, 10→4 reasoning calls, pattern applied).

### 2.3 Supporting docs inspected

- `GENESIS_ARCHITECTURE_MAP_v1.md` — full pipeline + contracts + action vocabulary + verification check kinds + learning loop + LOC table.
- `GENESIS_FOUNDATION_AND_INTEROPERABILITY_MAP_v1.md` — ownership map, three-pillar model, protocol relationship map, activation timeline, protected future boundaries, anti-reimplementation rules (10 rules), Phase 4.9 success criteria all PASS.
- `GENESIS_LEARNING_STATE_v2.md` — learning loop CLOSED, engine classification (READY / NOT_READY per component), what Experience captures and intentionally does not, learning causality (8/8 steps), future extensions table.

No material contradiction between the prompt, the contract, and the persisted evidence. **Repository + persisted handoff evidence wins** — and it agrees with the prompt.

---

## 3. Current Architecture (verified from source)

```
                         USER GOAL
                            │
                            ▼
                    AGENTCRAFT GENESIS
                            │
                   GoalCompiler → GoalRequirements
                            │
                   OrganizationPlanner (+ patterns option)
                            │
                   GenomeCompiler (+ operationalNeeds + tool grants)
                            │
                   MissionOrchestrator
                   (+ missionInputs + missionObligations + patterns)
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
           OpenBot       OpenDots      OpenMuse
           (computer)    (workspace)  (durable)
              │             │             │
              └─────────────┼─────────────┘
                            │
                   CompositeRuntime → WorkerSurfaces
                            │
                   WorkerAgent (12 provider-neutral actions)
                            │
                   VerificationLoop (6 AcceptanceCheck kinds)
                            │
                   Experience → Learning → Patterns → OrganizationPlanner
```

**Verified contracts (`src/contracts/core.ts`):**

| Contract | Fields | Provider-neutral? |
|----------|--------|-------------------|
| `WorkerGenome` | 10 baseline + `operationalNeeds?` | YES — no provider names |
| `OperationalNeed` | 5 kinds (shell-execution, browser, workspace-files, collaborative-workspace, durable-delegation) | YES |
| `WorkerAction` | 12 actions (run_command, write_file, read_file, list_files, browser_navigate, browser_screenshot, ask_worker, read_shared_workspace, append_shared_workspace, check_durable_status, get_durable_result, finish) | YES — no provider names |
| `MissionObligation` | 3 kinds (delegated-result, shared-publication, computer-execution) | YES |
| `AcceptanceCheck` | 6 kinds (command, file, evidence, mission-input, flight-action, content-in-artifacts) | YES |
| `DecisionProvider` | `decide<T>(Decision<T>): Promise<DecisionOutcome<T>>` | YES — Jev-ready |
| `Experience` | schemaVersion 2 (resolvedNeeds, providerInvocations, verification, reasoning, wallMs, retries) | YES |

**Verified modules (`src/`):**

- `goal/goal-compiler.ts`, `goal/llm-understanding.ts`
- `organization/organization-planner.ts` (consumes `AdvisoryPattern[]` via orchestrator `patterns` option — Phase 4.10)
- `genome/genome-compiler.ts` (resolves `capabilityNeeds` → ownership registry → `<owner>:<domain>` grants; derives `operationalNeeds` + `ComputerSpec`)
- `routing/cognitive-router.ts` + `routing/decision-provider.ts` (RuleDecisionProvider + LLMDecisionProvider; Jev-ready seam)
- `mission/orchestrator.ts` (thin: create/coordinate/finish/retire; injects `FlightRecorder`, `patterns`, `missionInputs`, `missionObligations`)
- `mission/verification.ts` (clean-room + flight-action + content-in-artifacts)
- `mission/flight-recorder.ts` (structured `FlightEvent` vocabulary + `MemoryFlightRecorder` + `FileFlightRecorder` with secret redaction)
- `worker/worker-agent.ts` (reason → action → observe → repeat; grant-enforced; bounded)
- `worker/handoff.ts` (worker-to-worker channel)
- `runtime/composite-runtime.ts` (composes computer + workspace + job adapters; dispatches by `operationalNeeds`)
- `runtime/computer.ts` (`WorkerRuntime`, `WorkerSurfaces`, `WorkerComputer`, `WorkspaceSurface`, `JobSurface`)
- `runtime/openbot/*`, `runtime/opendots/*`, `runtime/openmuse/*` (three pillar adapters)
- `learning/*` (experience-store, candidate-generator, evaluation, pattern, evolution)
- `providers/zai-reasoning.ts`
- `work/*` (git-workspace, dev-runtime, repo-mission, integration-manager)

---

## 4. Current Learning State

**Learning loop status: CLOSED** (Phase 4.10 wiring + Phase 4.11 measured proof).

```
Experience (v2)
    ↓ resolvedNeeds, providerInvocations, verification, reasoning, wallMs, retries
StatisticalCandidateGenerator
    ↓ groups by domain, identifies redundant/valuable roles
RuleCandidateEvaluator
    ↓ promotes if ≥2 supporting + no contradictions + verification success
OrganizationalPattern
    ↓ avoid-role, prefer-role, prefer-shape, avoid-shape
RulePatternRetriever (in OrganizationPlanner)
    ↓ matches domain + capabilityNeeds
OrganizationPlanner (via orchestrator patterns option)
    ↓ applies advisory patterns, records learned field
GenomeCompiler
    ↓ different real organization
```

**READY:** experience capture, candidate generation, evaluation/promotion, pattern retrieval, planner consumption, provider-neutral learning, metric capture.

**NOT_READY (deferred to Group 5 Academy):**

- Autonomous operational-need inference — operational needs are explicitly injected (`EXPLICIT_TEST_INJECTION`). The planner does not yet infer needs from the goal.
- Mission-obligation learning — obligations are explicitly declared.
- Statistical learning claims — N=1 remains N=1.
- Cross-domain pattern transfer beyond the one measured experiment (solar/wind → rainwater).

**Measured evidence (Phase 4.11):** Experience A1/A2 → 5 candidates → 5 promoted → 5 patterns stored → retrieved for Mission B → organization changed 5→2 workers, 10→4 reasoning calls → success. Learning causality 8/8 proven.

---

## 5. MCP Activation Seam

### 5.1 Where MCP enters

MCP enters at the **capability/tool resolution seam**, alongside the existing three pillar adapters. The `CompositeRuntime` already composes:

- `computer: WorkerRuntime` (OpenBot)
- `workspace?: OpenDotsWorkspaceAdapter` (OpenDots, Phase 4.6)
- `job?: OpenMuseAdapter` (OpenMuse, Phase 4.7)

MCP enters as a **fourth optional adapter** providing MCP-backed capabilities. Two viable attachment points (G5-01 will pick the smaller):

1. **McpCapabilityProvider adapter** — implements the same surface contract; the `WorkerSurfaces` gains an optional `mcp?: McpToolSurface` field. The WorkerAgent gains a new provider-neutral action (e.g. `call_mcp_tool`) OR existing actions are routed to MCP when the grant is `mcp:<tool>`.
2. **McpToolGrant in genome.tools** — the GenomeCompiler records `mcp:<server>:<tool>` grants; the runtime resolves them to MCP `Client.callTool()` invocations. The WorkerAgent's action loop dispatches by grant prefix.

**Preferred (smaller): option 2.** It reuses the existing grant mechanism (`genome.tools` is already `<owner>:<domain>` strings) and the existing action vocabulary. No new surface contract; no new WorkerAction kind strictly required if MCP tools are exposed through a generic `call_tool` action gated by grants.

### 5.2 WorkerGenome semantics: UNCHANGED

- `operationalNeeds` stays provider-neutral (5 kinds, none say "mcp").
- `tools` gains a new grant prefix (`mcp:<tool>`), the same way it already has `openbot:*`, `opendots:*`, `openmuse:*`. The genome still says WHAT; the runtime still decides HOW.
- No new worker type. No `McpWorker`. Workers with MCP grants are the same `WorkerGenome` as every other worker.

### 5.3 Adapter, not new abstraction

The anti-reimplementation rule #1 ("Never build a Genesis-specific tool protocol. Use MCP.") means Genesis must use the official MCP SDK's `Client` / `McpServer` / transport (`InMemoryTransport`, stdio, HTTP/SSE) verbatim. Genesis wraps; it does not reinvent transport, session semantics, capability negotiation, or tool/resource protocol behavior.

### 5.4 MCP current spec/SDK state (verified 2026-10-07)

| Item | Value | Source |
|------|-------|--------|
| SDK (pinned + installed + latest) | `@modelcontextprotocol/sdk@1.32.1` | npm `latest` dist-tag = 1.32.1; no 2.x published under any dist-tag |
| Spec date | `2026-07-28` | Entry contract + ownership.yaml |
| Spec status label | Contract says "RC"; ownership.yaml says "final" — minor internal inconsistency | Track RC→GA (per contract) |
| Probe verdict | PASS (TASK-004, 2026-10-05) | In-process client↔server over `InMemoryTransport`; tool registration, listing, invocation verified end-to-end |
| Breaking change risk | LOW — SDK is stable on 1.32.x; no 2.x imminent | WATCH: re-verify before deep integration |

### 5.5 MCP activation target

**G5-01**, with a real MCP integration probe (e.g. expose one real MCP server tool to one Genesis worker, end-to-end, evidence captured in flight recorder).

---

## 6. AG-UI Activation Seam

### 6.1 Where AG-UI attaches

AG-UI attaches at the **FlightRecorder boundary**. Genesis already emits a structured `FlightEvent` vocabulary through a `FlightRecorder` port that the MissionOrchestrator already injects. AG-UI enters as a **new `FlightRecorder` implementation** — an `AgUiFlightRecorder` that translates Genesis `FlightEvent`s into AG-UI `Event`s.

Zero change to MissionOrchestrator semantics. The orchestrator emits; the AG-UI adapter translates outward. The orchestrator does not become AG-UI-shaped.

### 6.2 Event mapping (clean 1:1 mappings exist)

| Genesis `FlightEvent` | AG-UI `Event` |
|------------------------|---------------|
| `mission-started` | `RUN_STARTED` |
| `requirements-compiled` | `STATE_SNAPSHOT` |
| `plan-created` | `STATE_SNAPSHOT` (organization shape) |
| `genomes-compiled` | `STATE_SNAPSHOT` |
| `worker-started` | `SUBAGENT_STARTED` + `STEP_STARTED` |
| `worker-step` (action) | `TOOL_CALL_START` / `TOOL_CALL_END` |
| `worker-step` (reasoning) | `REASONING_*` |
| `worker-finished` | `SUBAGENT_FINISHED` + `STEP_FINISHED` |
| `verification` | `STATE_SNAPSHOT` + `STEP_FINISHED` |
| `mission-finished` | `RUN_FINISHED` |
| `worker-retry` | `STEP_FINISHED` (error) + `STEP_STARTED` |
| `human-intervention` | AG-UI HITL events (when CopilotKit OSS channels are wired, Phase 2) |
| `reasoning-fallback` | `REASONING_*` with metadata flagging source |

### 6.3 AG-UI events that must NOT leak inward

AG-UI's channel/HITL-specific events (`ACTIVITY_*`, channel-specific message routing, ephemeral `STATE_DELTA` for UI controls, frontend-only `MESSAGES_SNAPSHOT` rebuilds) must NOT become Genesis internal events. The internal `FlightEvent` taxonomy stays Genesis-owned. The AG-UI adapter is a **one-way emission bridge** (with an optional, narrow, well-defined inbound control channel for run cancellation only, deferred to Phase 2).

### 6.4 AG-UI current spec/SDK state (verified 2026-10-07)

| Item | Value | Source |
|------|-------|--------|
| Protocol version | `1.0` (`PROTOCOL_VERSION === "1.0"`, confirmed from installed package) | `@ag-ui/core` runtime export |
| SDK — pinned in contract | `@ag-ui/core@1.0.2` | Entry contract + final state |
| SDK — declared in package.json | `@ag-ui/core@1.0.1` | `package.json` devDependencies |
| SDK — installed | `1.0.1` | `node_modules/@ag-ui/core/package.json` |
| SDK — latest on npm | `1.0.2` | npm `latest` dist-tag |
| **DIVERGENCE** | package.json declares `1.0.1`; contract pins `1.0.2`; latest is `1.0.2` | Reconcile at G5-02: bump to `1.0.2` (safe — same 1.0.x line, same PROTOCOL_VERSION) |
| Event vocabulary | 31 types (TEXT_MESSAGE_*, TOOL_CALL_*, STATE_*, RUN_*, STEP_*, REASONING_*, SUBAGENT_*, ACTIVITY_*) | Probe verdict PASS |
| Breaking change risk | LOW — protocol 1.0 is frozen; 1.0.1→1.0.2 is a patch bump | — |

### 6.5 AG-UI activation target

**G5-02**, with a real AG-UI event probe (emit Genesis mission events as AG-UI events to a reference consumer, end-to-end). Includes the safe `1.0.1 → 1.0.2` patch bump.

---

## 7. A2A Protected Boundary

### 7.1 Current state

- `@a2a-js/sdk@1.3.0` is installed as a **dev-only** dependency (type definitions only).
- Zero A2A code in `src/`. `A2AClient` is not even imported (probe noted it lives in a subpath, intentionally not consumed).
- The `external-agent-interop` ownership domain is `DEFER`.
- The MissionOrchestrator's worker model is **internal-coordination-shaped** (one orchestrator, multiple WorkerAgents, `MissionHandoffs` channel), NOT federation-shaped.

### 7.2 Future separability

A2A can later attach at a **federation edge adapter** — analogous to how MCP attaches at the capability seam and AG-UI at the event seam — without touching internal worker coordination. No internal worker speaks A2A today; none will need to. The boundary is clean.

### 7.3 A2A current state (verified 2026-10-07)

| Item | Value |
|------|-------|
| SDK (pinned + installed + latest) | `@a2a-js/sdk@1.3.0` |
| Probe verdict | PASS (AgentCard construction, canonical JSON, task-state enum) |
| AG-UI ↔ A2A bridge semantics | UNVERIFIED — deferred to GROUP 6 federation milestone |
| Activation target | TASK-036+ (federation milestone) |
| G5-00 action | NONE — verify boundary stays clean; do not implement |

### 7.4 No accidental coupling found

The current architecture has not made future A2A integration difficult. The internal worker coordination is cleanly separable from external agent federation.

---

## 8. CopilotKit Decision

**COPILOTKIT_INTELLIGENCE = ADAPT** (verified from contract + foundation map).

- **ADOPT** AG-UI protocol (already decided) + CopilotKit OSS as reference AG-UI client and channel adapter (Slack/Teams).
- **DEFER** CopilotKit Intelligence (managed platform) as optional, swappable, self-hostable backend behind OpenDots/OpenMuse-owned interfaces.
- **Do NOT** make Intelligence the canonical thread/memory/learning store — that would strategically duplicate Genesis-owned subsystems.
- **Reconsider trigger:** when OpenDots/OpenMuse charters are finalized and if either cedes its memory/thread mandate to Intelligence.

### 8.1 CopilotKit current state (verified 2026-10-07)

| Item | Value |
|------|-------|
| `@copilotkit/*` latest | `1.77.0` (react-core, react-ui, runtime) |
| Installed in Genesis | NONE (correct — not a Group 5 entry dependency) |
| Group 5 entry role | NONE — AG-UI is the entry boundary; CopilotKit OSS is an early-Group-5 convenience (reference client + channels), not an entry blocker |
| Intelligence activation | Post-Academy evaluation |

**G5-00 conclusion:** CopilotKit adds nothing necessary at Group 5 entry beyond AG-UI. Defer to early Group 5 (after MCP + AG-UI probes pass).

---

## 9. Jev Boundary

**JEV_BOUNDARY = DecisionProvider (optional primitive, not a dependency)** (verified from contract + foundation map + source).

### 9.1 Current state

- Jev is NOT installed, NOT imported, NOT referenced in `src/` (only mentioned in comments and docs).
- The `DecisionProvider` contract (`decide<T>(Decision<T>): Promise<DecisionOutcome<T>>`) is already implemented by `RuleDecisionProvider` and `LLMDecisionProvider`.
- The `CognitiveRouter` consumes `DecisionProvider`, not any specific implementation.
- Future Jev activation = a new `JevDecisionProvider` class implementing `DecisionProvider` + an MCP tool wrapper (per contract: "wrap as MCP tool").
- Jev is GA (self-serve since Sep 2026 per contract).

### 9.2 Boundary cleanliness

The boundary is clean. Jev can implement `DecisionProvider` with zero contract change. The CognitiveRouter needs no modification. No G5-00 action needed.

### 9.3 Group 5 entry role

NONE at entry. Benchmark target = TASK-037 (post-Academy optimization), when Genesis has enough diverse routing decisions to measure improvement.

---

## 10. Academy Objectives

**GROUP 5 = ORGANIZATIONAL CAPABILITY ACADEMY.**

The Academy is NOT conventional model training. Its purpose is to expose Genesis to diverse mission families and accumulate evidence about:

- useful worker roles;
- organization shapes;
- operational capabilities and needs;
- mission obligations;
- surface usage;
- successful AND failed organizations;
- verification outcomes;
- reasoning cost, retries, latency, human intervention;
- reusable organizational patterns;
- transfer to related unseen missions.

**Central question the Academy must answer:** *What organization is appropriate for what kind of goal?*

### 10.1 Academy learning targets (progressive)

| Target | Current state | Academy goal |
|--------|---------------|--------------|
| Autonomous operational-need inference | EXPLICIT_TEST_INJECTION | Gather N>1 per family evidence; move from explicit injection toward planner/learned selection (keep explicit injection for tests/benchmarks) |
| Mission-obligation learning | Explicit declaration | Gather evidence for when organizational knowledge can help infer obligations from goal semantics (NOT keyword heuristics) |
| Cross-domain pattern transfer | N=1 measured | N>3 per family; test transfer to unseen missions |
| Statistical learning claims | N=1 | N>10 per family for statistical significance |

### 10.2 Measurement discipline

Where available, capture: verification success, outcome correctness, worker count, role selection, operational needs, mission obligations, surface utilization, reasoning operations, steps, retries, latency, cost, human intervention, failure type, transfer success. Do not invent unavailable metrics.

### 10.3 Anti-overfit

The Academy must NOT become a collection of hardcoded solutions to benchmark tasks. Do not encode "for mission X use workers A+B+C" as static application logic. The learning mechanism must discover and evaluate reusable organizational patterns from evidence.

### 10.4 Success philosophy

Group 5 succeeds when Genesis demonstrates:

```
EXPERIENCE → LEARNING → TRANSFER → BETTER ORGANIZATION → VERIFIED OUTCOME
```

across more than one narrow controlled experiment. NOT when "many missions ran" or "many patterns were stored."

---

## 11. Known Deferred Items

| Item | Reason | Owner | Target |
|------|--------|-------|--------|
| Autonomous operational-need inference | Needs diverse Academy evidence | Group 5 Academy | Group 5 |
| Mission-obligation learning | Needs diverse obligation evidence | Group 5 Academy | Group 5 |
| MCP runtime activation | ADOPTed; activate at Group 5 entry | Group 5 | G5-01 |
| AG-UI runtime activation | ADOPTed; activate at Group 5 entry | Group 5 | G5-02 |
| CopilotKit OSS | Early Group 5 convenience | Group 5 | Early Group 5 (post G5-02) |
| CopilotKit Intelligence | ADAPT; evaluate after Academy | Council | Post-Academy |
| Jev benchmark | Optional primitive | Council | TASK-037 |
| A2A federation | Federation milestone | Group 6 | TASK-036+ |
| OpenMuse in-flight checkpoint resume | NOT_PROVEN (queued-work recovery only) | Council | Future |
| Statistical learning claims | N=1 | Council | Post-Academy |
| Production hardening | Alpha, sample mode | Future | Post-Academy |
| AG-UI SDK patch bump (1.0.1 → 1.0.2) | package.json declares 1.0.1; contract pins 1.0.2 | Group 5 | G5-02 (safe patch) |
| MCP spec status label (RC vs final) | Minor internal inconsistency between contract and ownership.yaml | Group 5 | G5-01 (reconcile label; track RC→GA) |

---

## 12. G5-01 Plan — MCP Activation

**Goal:** Expose standard external capabilities through Genesis without creating a parallel tool architecture.

**Required:** one real MCP integration probe (end-to-end: a Genesis worker invokes a real MCP server tool, evidence captured in flight recorder).

**Smallest correct change:**

1. Add an `McpCapabilityProvider` (or thinner `McpToolGrant` resolver) to `CompositeRuntime` as a fourth optional adapter, mirroring how `workspace` and `job` were added in Phases 4.6/4.7.
2. Use the official MCP SDK `Client` + transport (`InMemoryTransport` for in-process probes; stdio/HTTP for external servers) verbatim. No custom transport, no custom session semantics, no custom capability negotiation.
3. Record MCP tool grants in `genome.tools` as `mcp:<tool>` (reuses existing `<owner>:<domain>` grant format). WorkerGenome semantics unchanged.
4. WorkerAgent dispatches MCP-backed tool calls through the existing action loop (either a generic `call_tool` action gated by grants, or extension of an existing surface). No new worker type.
5. Capture MCP invocations in the flight recorder (new `mcp-tool-call` event kind, or reuse `worker-step` with action metadata).
6. Write one real probe experiment under `experiments/g5-01-mcp-probe/` (e.g. a worker uses an MCP server that exposes a calculator or filesystem tool, end-to-end).
7. Update `docs/architecture/` with a short MCP activation note (spec version, SDK version, seam chosen, probe result).

**Anti-bloat budget:** target ≤ 300 net new production LOC, ≤ 2 new production files, zero new runtime dependencies (MCP SDK is already a dev dependency; promoting it to runtime is the one allowed dependency change). Soft warning at 700 LOC; hard stop at 1200 LOC / 6 files / any new framework.

**Sequencing discipline:** MCP activates ALONE first. AG-UI does NOT activate in the same change. Evidence isolation: if the MCP probe fails, the failure is attributable to MCP, not confounded by AG-UI.

---

## 13. G5-02 Plan — AG-UI Activation

**Goal:** Expose Genesis execution/interaction through the standard agent↔app event boundary without reshaping Genesis internals.

**Required:** one real AG-UI event/interaction probe (end-to-end: Genesis mission events emitted as AG-UI events to a reference consumer).

**Smallest correct change:**

1. Add an `AgUiFlightRecorder` implementing the existing `FlightRecorder` port. It translates each Genesis `FlightEvent` into the matching AG-UI `Event` (see §6.2 mapping table).
2. The MissionOrchestrator already injects a `FlightRecorder` — AG-UI is a new recorder implementation, not a new orchestrator concept. Zero change to orchestrator semantics.
3. Bump `@ag-ui/core` `1.0.1 → 1.0.2` (safe patch; same PROTOCOL_VERSION `1.0`).
4. Use the official `@ag-ui/core` `Event` types and `PROTOCOL_VERSION` verbatim. Do NOT invent parallel event types. The 31-type vocabulary covers lifecycle, tool, state, reasoning, subagent, and activity semantics.
5. AG-UI events flow OUTWARD (Genesis → consumer). Inbound control (e.g. run cancellation) is deferred to Phase 2 — a narrow, well-defined control channel, not a general inbound event sink.
6. Write one real probe experiment under `experiments/g5-02-agui-probe/` (e.g. a mission emits AG-UI events consumed by a minimal Node.js subscriber that asserts the event sequence).
7. Update `docs/architecture/` with a short AG-UI activation note.

**Anti-bloat budget:** target ≤ 300 net new production LOC, ≤ 2 new production files, zero new runtime dependencies (AG-UI SDK is already a dev dependency; promote to runtime — the one allowed change).

**Sequencing discipline:** AG-UI activates AFTER MCP probe passes. Each standard earns its own integration evidence.

---

## 14. Academy Bootstrap Recommendation (G5-03)

**Goal:** define curriculum, mission families, evidence collection, evaluation, promotion, and transfer methodology.

**Recommended curriculum (start small):**

- 3-5 mission families across DIFFERENT domains (e.g. research, software-engineering, diagnostic, data-analysis, document-authoring).
- For each family: run 2-3 missions, derive experiences, generate candidates, evaluate, promote patterns.
- Test pattern transfer to unseen missions in the same family.
- Measure improvement (workers, reasoning, verification, correctness).
- Only after N>3 per family: consider promoting operational-need learning from explicit injection to autonomous inference.

**Reuse, do not rebuild:**

- The learning loop (Experience → Candidate → Evaluation → Pattern → Retrieval → OrganizationPlanner) is already CLOSED. The Academy reuses it.
- The flight recorder already captures the metrics. The Academy reuses it.
- The CompositeRuntime already composes three pillars. The Academy reuses it.
- Mission inputs, mission obligations, verification — all reuse existing contracts.

**Bootstrap deliverables (mostly config + experiment scripts, minimal src/):**

- `experiments/academy/` curriculum definition (mission families, per-family missions, success criteria).
- Evidence collection harness (reuse flight recorder + Experience schema).
- Evaluation/promotion reuse (existing `StatisticalCandidateGenerator` + `RuleCandidateEvaluator`).
- Transfer test harness (run patterns from family A on unseen mission in family A).
- A short `docs/architecture/GENESIS_ACADEMY_CURRICULUM_v1.md`.

**Anti-bloat:** the Academy is about EVIDENCE, not INFRASTRUCTURE. If G5-03 wants to build a new framework, STOP. Reuse the existing learning loop. The Academy's job is to feed it diverse evidence and measure.

---

## 15. Anti-Bloat Constraints (active for all of Group 5)

- Soft warning: > 700 net new production LOC per phase.
- Hard stop: > 1200 LOC OR > 6 new production files OR any new runtime dependency OR new framework.
- Prefer: CONFIGURE → REUSE → WRAP → ADAPT → EXTEND → BUILD (BUILD last).
- Do NOT create: LearningGraph, OrganizationalKnowledgeGraph, Pattern Engine v2, Evolution Engine v2, Optimization Platform.
- Do NOT introduce provider-specific worker types (MuseWorker, BotWorker, McpWorker, etc.).
- Do NOT encode provider names in WorkerGenome / operationalNeeds / MissionObligations.
- Track: production LOC, production files, modules, contracts, runtime dependencies, coupling, context budget.

**Protocol activation must reuse official SDKs/specifications rather than reimplement them.** MCP, AG-UI, A2A SDKs are already dev dependencies (type definitions); promoting MCP and AG-UI to runtime dependencies at G5-01/G5-02 is the ONE allowed dependency change per protocol. No other runtime dependency may be added in Group 5.

---

## 16. Architecture Questions A–K (answered)

**A. Where exactly should MCP enter the current Genesis architecture?**
At the capability/tool resolution seam — as a fourth optional adapter in `CompositeRuntime` (alongside `computer`, `workspace`, `job`), OR as an `mcp:<tool>` grant prefix in `genome.tools` resolved by the runtime. The smallest seam reuses the existing grant mechanism.

**B. Can MCP capabilities be exposed without changing Worker Genome semantics?**
Yes. `operationalNeeds` and `tools` are already provider-neutral. MCP enters as a new grant kind (`mcp:<tool>`); the genome still says WHAT, the runtime still decides HOW. No genome field needs to learn "mcp".

**C. Does current capability/tool resolution need a tiny adapter, or is a new abstraction actually necessary?**
A tiny adapter is sufficient. The `CompositeRuntime` already composes multiple adapters. MCP enters as a 4th adapter (or a grant-prefix resolver). The anti-reimplementation rule forbids inventing a parallel tool protocol — Genesis must use the official MCP SDK verbatim.

**D. Where exactly should AG-UI attach?**
At the `FlightRecorder` boundary. Genesis already emits a structured `FlightEvent` vocabulary through an injected `FlightRecorder` port. AG-UI enters as a new `FlightRecorder` implementation that translates Genesis events into AG-UI events. Zero change to MissionOrchestrator semantics.

**E. Can AG-UI expose Genesis events without changing internal MissionOrchestrator semantics?**
Yes. The orchestrator emits `FlightEvent`s through a port; an `AgUiFlightRecorder` adapter translates outward. The orchestrator's internal logic is unchanged. AG-UI is a consumer of the existing event stream, not a driver of it. (Bidirectional control is a Phase-2 concern, not an entry blocker.)

**F. Which existing Flight Recorder / mission / worker events can map cleanly to AG-UI?**
See §6.2 — clean 1:1 mappings exist for all 12 Genesis event kinds (mission-started → RUN_STARTED, worker-step → TOOL_CALL_*, worker-finished → SUBAGENT_FINISHED, mission-finished → RUN_FINISHED, etc.).

**G. Which AG-UI events should NOT leak into internal architecture?**
Channel/HITL-specific events (`ACTIVITY_*`, channel message routing, ephemeral `STATE_DELTA` for UI controls, frontend-only `MESSAGES_SNAPSHOT` rebuilds). The internal `FlightEvent` taxonomy stays Genesis-owned. The AG-UI adapter is a one-way emission bridge (with an optional narrow inbound control channel for run cancellation only, deferred to Phase 2).

**H. Is future A2A federation still cleanly separable?**
Yes. Zero A2A code in `src/`. The internal worker model is coordination-shaped (one orchestrator, multiple WorkerAgents, `MissionHandoffs`), NOT federation-shaped. A2A can later attach at a federation edge adapter without touching internal coordination. The boundary is clean.

**I. Does CopilotKit add anything necessary at Group 5 entry beyond AG-UI?**
No. AG-UI is the entry boundary. CopilotKit OSS adds value as a reference AG-UI client + Slack/Teams channels, but those are early-Group-5 conveniences, not entry blockers. Intelligence is explicitly ADAPT/DEFER.

**J. Does Jev remain cleanly isolated behind DecisionProvider?**
Yes. The `DecisionProvider` contract is already implemented by `RuleDecisionProvider` and `LLMDecisionProvider`. Jev can implement the same interface with zero contract change. Jev is not installed/imported/referenced in `src/`. Boundary is clean. Future activation = `JevDecisionProvider` class + MCP tool wrapper.

**K. What is the smallest sequence that gets Genesis into the Academy without building infrastructure the Academy does not yet need?**
G5-00 (this) → G5-01 (MCP probe) → G5-02 (AG-UI probe) → G5-03 (Academy bootstrap, mostly config + experiment scripts) → G5-04+ (cohorts). Defer CopilotKit (early G5), Jev (TASK-037), A2A (federation milestone), any new framework, any new runtime dependency.

---

## 17. G5-00 Summary

- **Recovery:** complete. Repository state matches expected Group 4 final checkpoint exactly.
- **Handoff verification:** complete. Both authoritative handoff documents read in full. Group 4 is CLOSED; Group 5 entry is READY.
- **Architecture:** verified from source. Three-pillar foundation, learning loop closed, provider-neutrality rules honored, all contracts provider-neutral.
- **MCP seam:** identified (capability/tool resolution; 4th adapter or grant-prefix resolver). SDK stable at 1.32.1.
- **AG-UI seam:** identified (FlightRecorder boundary; new recorder implementation). Protocol 1.0 stable. Minor patch bump 1.0.1→1.0.2 needed at G5-02.
- **A2A boundary:** protected, cleanly separable, no action at G5-00.
- **CopilotKit:** ADAPT confirmed; no entry role beyond AG-UI.
- **Jev:** cleanly isolated behind DecisionProvider; no entry role.
- **Entry blockers:** NONE material. Two minor reconciliations noted (AG-UI patch bump; MCP spec status label) — neither blocks G5-01.
- **No code changed.** No dependencies installed. No MCP/AG-UI/Academy implementation begun.

**SAFE_TO_BEGIN_G5_01 = YES** (pending review of this document and explicit go-ahead).
