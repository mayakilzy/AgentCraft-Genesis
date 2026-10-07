# G7_PRODUCT_EXPERIENCE_BACKEND_READINESS

**Date:** 2026-10-07
**Transition:** G5 → G6
**Purpose:** Backend readiness inventory for Group 7 product experience surfaces. This is NOT a frontend specification — it is a backend readiness inventory. For each future Group 7 surface, record: UI surface, data required, current source, current status, missing data, missing contract, best phase to address, notes.

**Goal (Section 4 of transition spec):** Group 7 should NOT need to discover that the engine lacks mission state, worker state, organization state, capability metadata, runtime events, artifact metadata, verification evidence, learning evidence, historical events, replay data, decision explanations, provider usage, task relationships, or mission lineage. If backend data required for Group 7 is missing, we want to know BEFORE Group 7.

**Anti-bloat rule (Section 32):** Do NOT build speculative frontend backends now (GraphQL, BFF, UI database, analytics warehouse, event streaming platform, plugin marketplace backend, design-system service, WebSocket layer, frontend API gateway) — unless Group 6 execution proves one is required.

---

## 1. READINESS CLASSIFICATION

Each field is classified as: **READY** (data exists, accessible) · **PARTIAL** (data exists but incomplete or not exposed) · **MISSING** (data does not exist or is not currently captured).

---

## 2. G7 SURFACE A — GENESIS WORK (Persistent Project/Workspace)

| Field | Value |
|-------|-------|
| UI SURFACE | Genesis Work — persistent project/workspace experience |
| DATA REQUIRED | persistent projects, project metadata, mission history, project files, sources, artifacts, task history, organization history, runtime history, browser/workspace state, preview state, evidence, checkpoints, project-level activity feed |
| CURRENT SOURCE | Per-mission: `MissionOrchestrator` (in-memory) + `FlightRecorder` (JSONL per mission) + `data/flight-records/` directory. No persistent project model. |
| CURRENT STATUS | **PARTIAL** — mission-level data is captured; project-level persistence does not exist. |
| MISSING DATA | • Persistent project entity (id, name, createdAt, owner)<br>• Project → mission history link<br>• Project → file/artifact store<br>• Project → activity feed<br>• Checkpoints (mission resume state) |
| MISSING CONTRACT | `Project` entity + `ProjectStore` interface. Mission history queryable by projectId. |
| BEST PHASE TO ADDRESS | G6-01 (Project model + persistence) — critical for G7 Genesis Work. |
| NOTES | Genesis Work is the primary G7 surface. Without persistent projects, G7 Genesis Work cannot exist. This is the highest-priority G7 backend requirement. |

---

## 3. G7 SURFACE B — GENESIS AGENT (Worker-Genome-Backed)

| Field | Value |
|-------|-------|
| UI SURFACE | Genesis Agent — direct interaction with a single worker/agent |
| DATA REQUIRED | worker identity, role, objective, model, skills, tools, computer, memory reference, budget, autonomy, operational needs, capabilities, workspace, task state, runtime state, artifacts, evidence |
| CURRENT SOURCE | `WorkerGenome` contract (`src/contracts/core.ts`) — 10 fields + operationalNeeds. `WorkerAgent` exposes identity, role, genome. |
| CURRENT STATUS | **READY** — WorkerGenome is the primary backend model. All required fields exist. |
| MISSING DATA | None material. WorkerGenome may benefit from a `displayName` (already in `identity`), `createdAt` timestamp, `lastActiveAt` — minor. |
| MISSING CONTRACT | None — WorkerGenome contract is stable. |
| BEST PHASE TO ADDRESS | G6-06 (freeze WorkerGenome contract). |
| NOTES | WorkerGenome can serve as the primary backend model for the Agent UI. No material Genome changes needed unless a correctness gap is discovered. |

---

## 4. G7 SURFACE C — MISSION CONTROL & ORGANIZATION

| Field | Value |
|-------|-------|
| UI SURFACE | Mission Control — live organization graph, workers, roles, current task, handoffs, coordination, runtime usage, retries, verification, organizational changes |
| DATA REQUIRED | organization graph, worker relationships, handoffs, current worker state, current task, task dependencies, execution state, organization changes, runtime provider per worker, verification state, mission obligations, retries, failures |
| CURRENT SOURCE | `OrganizationPlan` (workers + collaboration edges + capabilityNeeds + learned influence) + `FlightRecorder` events (`plan-created`, `worker-started`, `worker-step`, `worker-finished`, `handoff`, `verification`, `worker-retry`, `mission-finished`) + `AG-UI event-bridge`. |
| CURRENT STATUS | **PARTIAL** — live events exist; durable mission history store does not. |
| MISSING DATA | • Durable mission history (queryable by missionId, projectId)<br>• Organization change log (delta over time)<br>• Live worker-state query API<br>• Task dependency graph (handoffs exist; dependencies are implicit) |
| MISSING CONTRACT | `MissionHistoryStore` interface; `OrganizationChangeLog` interface. |
| BEST PHASE TO ADDRESS | G6-01 (mission state model), G6-06 (event schema freeze). |
| NOTES | Live mission visualization is feasible with current FlightRecorder + AG-UI. Replay and historical queries need a durable store. |

---

## 5. G7 SURFACE D — CAPABILITY HUB / PLUGIN ECOSYSTEM

| Field | Value |
|-------|-------|
| UI SURFACE | Capability Hub — plugins, skills, MCP servers, models, APIs, agents, capability packages (Installed/Marketplace/Personal/Organization/Development), capability permissions, compatibility, assignment to WorkerGenome |
| DATA REQUIRED | For each capability type: ID, name, version, description, provider, capability type, capabilities provided, required credentials, permissions, allowed workers, runtime requirements, status, health, source, installation state |
| CURRENT SOURCE | `data/ownership.yaml` (capability ownership registry) + `data/upstream-capabilities.yaml` (upstream capability inventory) + `GenomeCompiler` grants (per-worker tool grants) + `McpCapabilityProvider` (MCP tools). |
| CURRENT STATUS | **PARTIAL** — ownership registry exists; no central capability registry with full metadata. |
| MISSING DATA | • Central capability registry (ID, name, version, description, provider, type, capabilities, credentials required, permissions, allowed workers, runtime requirements, status, health, source, installation state)<br>• Capability health check API<br>• Capability compatibility metadata |
| MISSING CONTRACT | `CapabilityRegistry` interface; `Capability` entity. |
| BEST PHASE TO ADDRESS | G6-04 (RC — capability inventory freeze), G6-06 (capability metadata freeze). |
| NOTES | The existing Plugin Builder repository may later be evaluated for reuse — NOT in this transition. Group 6 should avoid designs that make future capability packaging difficult. |

### Capability Registry Question (Section 20 of transition spec)

**Can Genesis answer "What capabilities are available right now?"**

**Current answer: PARTIAL.** `data/ownership.yaml` + `data/upstream-capabilities.yaml` provide a static census. `GenomeCompiler` resolves per-worker grants. `McpCapabilityProvider` lists MCP tools at runtime. But there is no single query API that returns "all capabilities available right now with metadata."

**Can Genesis answer "Which provider/plugin/tool can satisfy this worker need?"**

**Current answer: PARTIAL.** `GenomeCompiler` + `CognitiveRouter` resolve needs to tiers and grants, but the resolution is not exposed as a queryable contract.

**Classification:** A minimal capability registry is a **G7 backend prerequisite** (address in G6-04 RC / G6-06 closure). Do NOT implement automatically — avoid architecture expansion.

---

## 6. G7 SURFACE E — LEARNING / INTELLIGENCE

| Field | Value |
|-------|-------|
| UI SURFACE | Learning UI — learned patterns, candidate patterns, trusted patterns, pattern evidence, support, applications, overrides, applicability, organizational knowledge |
| DATA REQUIRED | experience records, candidate patterns, trusted patterns, quarantined patterns, pattern support, pattern evidence, pattern applicability, pattern retrieval, pattern application, pattern override, pattern outcome |
| CURRENT SOURCE | `Experience` (schemaVersion 2) + `LearningCandidate` + `Evaluation` + `OrganizationalPattern` + quarantine JSON (`experiments/academy/cohort-001/pattern-quarantine.json`) + cohort results JSON. |
| CURRENT STATUS | **READY** — all learning artifacts are persisted JSON; explainability data available. |
| MISSING DATA | None material. Pattern application/override outcome is recorded in `OrganizationPlan.learned`. |
| MISSING CONTRACT | None — existing contracts sufficient. A query API over the JSON store would help G7 but is not blocking. |
| BEST PHASE TO ADDRESS | G6-06 (freeze learning contracts). |
| NOTES | Future UI can answer "What has Genesis learned?", "Why was this pattern trusted?", "Where was it used?", "Why was it overridden?" using current data. |

---

## 7. G7 SURFACE F — ARTIFACTS / OBSERVABILITY

| Field | Value |
|-------|-------|
| UI SURFACE | Artifacts — outputs, files, code, reports, pages, runtime evidence, verification evidence, mission replay, performance metrics, provider usage, organization decisions |
| DATA REQUIRED | artifact ID, mission ID, worker ID, type, path/location, created time, updated time, provider, verification state, content reference, version, lineage |
| CURRENT SOURCE | Clean-room verifier workspace (artifacts exist post-mission) + `FlightRecorder` (artifact references in worker-finished events) + `Experience.evidence[]`. |
| CURRENT STATUS | **PARTIAL** — artifacts exist; artifact registry with metadata/version/lineage does not. |
| MISSING DATA | • Artifact registry (durable store with metadata)<br>• Artifact version history<br>• Artifact lineage (which worker/mission produced this)<br>• Artifact verification state across revisions |
| MISSING CONTRACT | `ArtifactRegistry` interface; `Artifact` entity with metadata. |
| BEST PHASE TO ADDRESS | G6-01 (artifact persistence), G6-06 (artifact metadata freeze). |
| NOTES | Critical G7 backend gap. Without an artifact registry, G7 artifact browser/history/ownership cannot exist. |

---

## 8. REPLAY READINESS (Section 23 of transition spec)

| Field | Value |
|-------|-------|
| Future G7 intent | Organization Replay / Mission Replay: goal received → requirements compiled → organization created → worker started → tool used → handoff → verification failed → retry → verification passed → artifact delivered |
| CURRENT STATUS | **PARTIAL** — FlightRecorder captures all structural events; replay is feasible from flight events. No replay engine. |
| Missing for READY | • Replay engine (reads flight events, reconstructs timeline)<br>• Replay query API (by missionId, by time range)<br>• Replay visualization data shape (event → UI frame) |
| MISSING CONTRACT | `ReplayEngine` interface; `ReplayFrame` schema. |
| BEST PHASE TO ADDRESS | G6-06 (event schema freeze — prerequisite for stable replay). Replay engine itself can be G7_UI_ONLY (consumes frozen events). |
| NOTES | The flight event schema is stable but not formally versioned. G6-06 should freeze it so G7 replay does not break on schema drift. |

**REPLAY_READINESS = PARTIAL**

---

## 9. PERFORMANCE / INSIGHTS READINESS (Section 24 of transition spec)

| Metric | Availability | Source |
|--------|-------------|--------|
| mission success | AVAILABLE | `MissionResult.status` |
| verification pass rate | AVAILABLE | `VerificationResult.ok/passed/failed` |
| false success | AVAILABLE | Derived: status=success && verification.ok=false |
| worker count | AVAILABLE | `OrganizationPlan.workers.length` |
| reasoning operations | AVAILABLE | `WorkerResult.reasoningCalls` + flight event `worker_reasoning_calls` |
| tool calls | AVAILABLE | Flight events `worker-step` with action != finish |
| runtime calls | AVAILABLE | Flight event `worker_reasoning_calls` |
| provider calls | PARTIAL | `costSource` callback exists; not always populated |
| retries | AVAILABLE | Flight event `worker-retry` |
| latency | AVAILABLE | `MissionResult.cost.wallMs` + flight event `elapsedMs` |
| human intervention | AVAILABLE | `Experience.outcome.humanInterventions` (currently always 0) |
| pattern retrieval | AVAILABLE | `OrganizationPlan.learned.considered` |
| pattern application | AVAILABLE | `OrganizationPlan.learned.applied` |
| pattern override | PARTIAL | Not explicitly recorded (override = considered but not applied) |
| organization changes | AVAILABLE | Derived: compare baseline vs learned organization |
| failure classification | PARTIAL | Failure summary exists; no taxonomy |
| cost (USD) | NOT_AVAILABLE | Providers report zeros; no real cost telemetry |

**PERFORMANCE_INSIGHTS_READINESS = READY** (most metrics available; cost and failure-classification are partial)

---

## 10. DECISION EXPLAINABILITY READINESS (Section 25 of transition spec)

Future UI should support questions: "Why did Genesis create 3 workers?", "Why did it choose this capability?", "Why was a learned pattern overridden?", "Why did verification retry?"

| Question | Answerable from current data? | Source |
|----------|-------------------------------|--------|
| "Why did Genesis create N workers?" | YES | `OrganizationPlan.rationale` (human-readable explanation string) |
| "Why did it choose this capability?" | PARTIAL | `GenomeCompiler` grants + `CognitiveRouter.selectTier` — grants visible; tier selection rationale not recorded |
| "Why was a learned pattern overridden?" | PARTIAL | `OrganizationPlan.learned.considered` vs `applied` — override inferred from absence; explicit override reason not recorded |
| "Why did verification retry?" | YES | Flight event `worker-retry` with reason |

**Critical constraint (Section 26 of transition spec):** Group 7 readiness must NEVER create a requirement to store hidden model reasoning. Future explainability uses structured decisions, evidence, inputs, outputs, constraints, events, verification — NOT internal chain-of-thought.

**DECISION_EXPLAINABILITY_READINESS = PARTIAL**

Missing for READY:
- Tier-selection rationale recording (CognitiveRouter decision trace)
- Explicit pattern-override reason field
- Decision API (queryable by missionId + decisionType)

**BEST PHASE TO ADDRESS:** G6-06 (decision metadata freeze).

---

## 11. CRITICAL G7 BACKEND GAPS (Summary)

The following are **G7_BACKEND_REQUIREMENT** — future UI requires backend data/events/state AND the missing support would be expensive or invasive to add after engine freeze. These should be handled during Group 6 where appropriate.

| # | Gap | Best Phase | Why Critical |
|---|-----|-----------|---------------|
| 1 | Persistent project/mission history store | G6-01 | Without it, G7 Genesis Work cannot exist. Mission-level data is captured; project-level is not. |
| 2 | Capability registry (central) | G6-04 / G6-06 | Without it, G7 Capability Hub must build from scratch. ownership.yaml is partial. |
| 3 | Artifact registry with metadata/lineage | G6-01 / G6-06 | Without it, G7 Artifacts browser cannot show history/ownership/lineage. |
| 4 | Event schema freeze (formal versioning) | G6-06 | Without it, G7 Replay breaks on schema drift. |
| 5 | Decision metadata (tier-selection rationale, override reason) | G6-06 | Without it, G7 Decision Explainability cannot answer "why this capability / why overridden." |

---

## 12. G6 → G7 PREPARATION PLAN

| G6 Stage | G7 Prep Obligation |
|----------|-------------------|
| **G6-01 Production Hardening** | • Persistent project/mission history store (Gap 1)<br>• Mission state model + failure/recovery state<br>• Artifact persistence + metadata (Gap 3, partial)<br>• Event reliability + telemetry correctness |
| **G6-02 A2A Federation** | • External agent/org metadata<br>• Federation state<br>• External capability visibility |
| **G6-03 Jev Decision Benchmark** | • Decision-provider telemetry<br>• Decision metadata (Gap 5, partial) |
| **G6-04 RC / Reproducibility** | • Configuration metadata<br>• Provider health checks<br>• Capability inventory freeze (Gap 2, partial)<br>• Environment readiness |
| **G6-05 Final Benchmark** | • Performance metrics<br>• Comparison metrics<br>• Mission evidence |
| **G6-06 Engine v1 Closure** | • Stable backend contracts<br>• **Event schema freeze** (Gap 4)<br>• **Capability metadata freeze** (Gap 2)<br>• **Artifact metadata freeze** (Gap 3)<br>• **Decision metadata freeze** (Gap 5)<br>• UI-facing read models if needed |

This mapping is planning only. Group 6 execution decides what is actually needed.

---

## 13. GROUP 7 PROTECTION RULE (Section 31 of transition spec)

By the end of Group 6, Group 7 should NOT have to build:

- new runtime state model
- new event bus
- new mission history system
- new worker history system
- new artifact registry (if G6-01 builds it)
- new verification evidence model
- new capability inventory from scratch (if G6-04/06 builds it)
- new telemetry pipeline
- new organization history model

— unless evidence during Group 6 proves that existing architecture cannot support them.

Group 7 should mainly: **consume, visualize, interact, compose, control** — not invent core backend infrastructure.

---

## 14. READINESS SUMMARY

| Surface | Readiness |
|---------|-----------|
| Genesis Work | PARTIAL (persistent project store missing) |
| Genesis Agent | READY (WorkerGenome is the model) |
| Mission Control | PARTIAL (live events exist; durable history missing) |
| Capability Hub | PARTIAL (ownership.yaml partial; no central registry) |
| Learning UI | READY (all learning artifacts persisted JSON) |
| Artifacts | PARTIAL (artifacts exist; registry missing) |
| Replay | PARTIAL (events sufficient; no engine; schema not frozen) |
| Performance Insights | READY (most metrics available) |
| Decision Explainability | PARTIAL (rationale partial; override reason missing) |

**Overall:** No G7 surface is NOT_READY. All surfaces are READY or PARTIAL. The 5 critical gaps above are the work Group 6 must do to keep Group 7 focused on UI/UX rather than infrastructure.
