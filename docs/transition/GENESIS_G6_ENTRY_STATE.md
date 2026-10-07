# GENESIS_G6_ENTRY_STATE

**Date:** 2026-10-07
**Transition:** G5 → G6 (Engine Baseline Freeze, Production Readiness Preparation, G7 Backend Readiness)
**Authoritative HEAD (G5 final):** `c100f84667775f0a3e5ba2b637f9b3a0851064d0`
**Branch:** `build/group-05-causality-investigation`
**Worktree:** `/home/z/my-project/workspace/AgentCraft-Genesis`
**GROUP_5_STATUS:** CLOSED_PASS_WITH_LIMITATIONS
**SAFE_TO_OPEN_FRESH_G6_SESSION:** YES

> This document is the authoritative handoff for the next Group 6 conversation. It is intentionally authoritative, not enormous. Where deeper detail exists in upstream Group 5 documentation, this entry state references it rather than duplicating it.

---

## A. PRODUCT IDENTITY

AgentCraft Genesis is a **Goal-to-Organization Runtime**. Give it a goal; it builds the AI organization needed to achieve it.

Core runtime flow:
```
Goal → Requirements → Organization → Workers → Capabilities → Execution → Verification → Outcome → Experience → Future organizational learning
```

Genesis owns the **organizational layer** (goal understanding, organization design, worker composition, operational-requirement selection, experience, learning, evolution). It does NOT own infrastructure (OpenBot, OpenDots, OpenMuse) or protocols (MCP, AG-UI, A2A).

Group 5 self-learning is a **supporting capability**, NOT the main product. The product is the runtime. Group 6 makes the runtime **reliable, recoverable, interoperable, measurable, reproducible, defensible**. Group 7 transforms that runtime into the final product experience.

---

## B. CURRENT ARCHITECTURE

Reference: `docs/architecture/GENESIS_ARCHITECTURE_MAP_v1.md` (Group 5 closure update).

**Key contracts** (`src/contracts/core.ts`):
- `Goal` — outcome + context + constraints + budget
- `GoalRequirements` — domain, capabilityNeeds, successCriteria, hardConstraints, budget
- `OrganizationPlan` — workers + collaboration edges + capabilityNeeds + learned influence
- `WorkerGenome` — 10 fields + operationalNeeds (provider-neutral)
- `OperationalNeed` — 5 kinds: shell-execution, browser, workspace-files, collaborative-workspace, durable-delegation
- `MissionObligation` — 3 kinds: delegated-result, shared-publication, computer-execution
- `MissionResult` — status + summary + evidence + cost
- `RuntimeAdapter` / `WorkerRuntime` — lifecycle + surfaces

**Worker Action vocabulary** (provider-neutral): `run_command`, `write_file`, `read_file`, `list_files`, `browser_navigate`, `browser_screenshot`, `ask_worker`, `read_shared_workspace`, `append_shared_workspace`, `check_durable_status`, `get_durable_result`, `call_tool`, `finish`. **No provider names in actions.**

**Verification check kinds**: `command`, `file`, `evidence`, `mission-input`, `flight-action`, `content-in-artifacts`.

**Key modules**:
- `GoalCompiler` → `OrganizationPlanner` → `GenomeCompiler` → `MissionOrchestrator` → `WorkerAgent`
- `CompositeRuntime` → `OpenBotRuntimeAdapter` + `OpenDotsWorkspaceAdapter` + `OpenMuseAdapter`
- `VerificationLoop` (clean-room + flight-action + content-in-artifacts)
- `Experience` → `StatisticalCandidateGenerator` → `RuleCandidateEvaluator` → `OrganizationalPattern` → `RulePatternRetriever` → `OrganizationPlanner`

**Three-pillar model**:

| Pillar | Provider | Surface | Worker Actions |
|--------|----------|---------|----------------|
| Computer | OpenBot | ComputerSurface | run_command, read_file, write_file, list_files, browser_* |
| Workspace | OpenDots | WorkspaceSurface | read_shared_workspace, append_shared_workspace |
| Durable | OpenMuse | JobSurface | check_durable_status, get_durable_result |

---

## C. AUTHORITATIVE HEAD

- **G5 final commit (full SHA):** `c100f84667775f0a3e5ba2b637f9b3a0851064d0`
- **Short SHA:** `c100f84`
- **Branch:** `build/group-05-causality-investigation`
- **Remote:** `https://github.com/mayakilzy/AgentCraft-Genesis.git`
- **GROUP_6_ENTRY_BASELINE:** (recorded after the freeze commit at end of this transition)

Repository state is authoritative. A fresh Group 6 session MUST start from this HEAD or the freeze-commit SHA recorded at the end of this transition.

---

## D. GROUP 1–5 HIGH-LEVEL COMPLETION

| Group | Phase | Outcome |
|-------|-------|---------|
| **Group 1** | Born Core | Foundation contracts, ownership registry, baseline build. `707fb1c` |
| **Group 2** | Born Runtime | MissionOrchestrator, WorkerAgent, VerificationLoop, durable FlightRecorder. Real three-pillar runtime composition. |
| **Group 3** | Repository Work | Repo missions, integration manager, GitWorkspace, before-verification hook. |
| **Group 4** | Capability Foundation + Learning Loop | GoalCompiler, OrganizationPlanner (+ patterns), GenomeCompiler, CognitiveRouter, learning loop closed (Phase 4.11: 5→2 workers, 10→4 reasoning calls measured). |
| **Group 5** | Organizational Capability Academy | G5-01 MCP + G5-02 AG-UI activations; Academy charter/curriculum/contract; Cohorts 001/002; G5-04A semantic-integrity remediation (Evidence Signature v1, quarantine); G5-06 causality proof (`prefer-role: Sole Operator`, +62 LOC); G5-07 sealed blind transfer (3 CONFIRMATORY + 1 NON_APPLICABLE); G5-08 final generalization (1 GENERALIZATION_ACTIVE + 1 NON_APPLICABLE) + greenfield validation. **CLOSED_PASS_WITH_LIMITATIONS.** |

Group 5 produced **+62 production LOC** (single `prefer-role` implementation) and zero other production changes. All other Group 5 work was experiment harnesses, docs, tests, and evidence packages.

---

## E. CURRENT PROVEN CAPABILITIES

1. **Natural three-pillar execution** (Phase 4.8E): a genuinely LLM-driven worker can execute a natural mission across real computer, durable-delegation, and collaborative-workspace surfaces, satisfy mission-required obligations using runtime evidence, reconcile results, publish to shared workspace, and pass independent verification without developer intervention.
2. **Learning loop closed** (Phase 4.11 + G5-06): Experience → Candidate → Evaluation → Pattern → Retrieval → OrganizationPlanner → different real organization → measured improvement.
3. **Mission obligations enforced** (Phase 4.8D): worker prose alone cannot satisfy a mission requirement — runtime evidence (flight-action checks) is required.
4. **Provider-neutral architecture** (Phase 4.5-4.8): WorkerGenome, operationalNeeds, MissionObligations, and worker actions contain NO provider names.
5. **Bounded organizational learning** (Group 5 closure): 9 capability criteria supported — capture experience, distinguish comparable/non-comparable, derive candidates, evaluate/promote bounded trusted patterns, retrieve during planning, causally influence organization, preserve applicability boundaries, carry across unseen mission boundary, execute fresh end-to-end without learning corrupting truth.
6. **Generalization observed** (G5-08 phase A mission B): a pattern learned from solar/wind/database/renewable-energy missions transferred to a NOVEL content domain (note-taking-app evaluation for academic researchers) and causally collapsed a 2-specialist baseline into a 1-Sole-Operator learned organization while preserving mission correctness (under scripted reasoning conditions).
7. **Greenfield end-to-end** (G5-08 phase B): Genesis executed Goal → Requirements → Organization (emerged) → Genomes → Worker → Verification on a fresh Node.js CLI tool mission. Independent runtime verification PASS — the produced artifacts actually function when executed.

---

## F. CURRENT KNOWN LIMITATIONS

1. **Scripted reasoning in Academy missions** — every Experience has `provenance.source = 'synthetic'`. Behavioral generalization to real LLM workers is NOT tested.
2. **Only `prefer-role: Sole Operator` implemented** — specialist `prefer-role` is recognized but unimplemented (seam open in `applyAdvisoryPattern`).
3. **Architecture cannot represent organizational requirements** — only capability needs. No mission currently has hard organizational requirements (e.g., "must use independent verification"); the architecture does not model them.
4. **GoalCompiler v0.1 word-boundary heuristics** — occasionally misclassify domains (e.g., "Rust vs Go" → software-engineering because 'service'/'code' signals; "Detect anomalies in a dataset" → general because 'dataset' does not match `\bdata\b`).
5. **Intersection-based retrieval is liberal** — `RulePatternRetriever` returns patterns whose capabilityNeeds intersect the mission's needs (NOT exact signature match). This caused `general|data-analysis,document-authoring` pattern to be retrieved for `general|document-authoring` missions.
6. **N is small** — 14 training experiences (Cohort 001 + 002); 4 sealed transfer missions (G5-07); 2 generalization + 1 greenfield (G5-08). Statistical significance is NOT claimed.
7. **Single session** — all Group 5 work executed in one session. Longitudinal learning across sessions is not tested.
8. **Academy missions used StubComputer** — real OpenBot/OpenDots/OpenMuse execution was proven in Phase 4.8E (benchmark-023), but Academy missions used stubs for calibration and reproducibility.
9. **No real-LLM behavioral proof in Group 5** — Phase 4.8E (benchmark-023) is the only real-LLM proof; Academy missions are scripted.
10. **No production hardening** — error handling, retries, cancellation, partial failure, durable recovery, concurrency, secret management are at sample/alpha level. This is what Group 6 addresses.

---

## G. PRODUCTION READINESS SUMMARY

**Current production readiness: SAMPLE / ALPHA.** Genesis is not production-hardened. Group 6 must address:

- Error handling, timeouts, retries, cancellation across MissionOrchestrator and WorkerAgent
- Partial failure, worker failure, provider failure, runtime disconnect
- Malformed output, verification failure, retry exhaustion
- Resource cleanup, process restart, durable recovery
- Concurrent missions, duplicate execution, idempotency
- Secret handling, configuration validation, dependency version stability
- Network failure, observability, auditability, artifact persistence

**Detailed census:** `docs/transition/PRODUCTION_HARDENING_MATRIX.md`.

**Production readiness census result:** PRODUCTION_READINESS_STATUS = PRE_PRODUCTION (not yet hardened; safe for sample/experimental use only).

---

## H. HARDENING PRIORITIES

| Priority | Definition | Count (approximate) |
|----------|-----------|---------------------|
| **P0** | false success / corruption / security / unrecoverable mission truth risk | ~3 items |
| **P1** | major production reliability issue | ~8 items |
| **P2** | important but non-blocking | ~12 items |
| **P3** | nice-to-have / later | ~11 items |

Full matrix: `docs/transition/PRODUCTION_HARDENING_MATRIX.md` (Sections 12-13 of the G5→G6 transition spec).

**P0 items (must address in G6-01):**
1. **False-success prevention under real provider failure** — current verification checks artifact existence + content presence; if a real provider returns malformed output that happens to satisfy checks, false success is possible. Currently mitigated by scripted reasoning (deterministic) but a real-LLM provider could hallucinate plausible-but-wrong content.
2. **Worker-instance epistemic isolation under real provider** — TASK-022A `ScopeableReasoningProvider.forInstance()` exists but is only verified under scripted/dev-fallback; real-LLM providers may retain state across worker instances if not properly scoped.
3. **Secret exposure to workers** — `WorkerGenome.tools` carries grant strings like `mcp:analyze`; if a worker is granted a tool that requires credentials, where the credentials live and whether they leak into worker prompts is not currently enforced.

---

## I. GROUP 7 BACKEND READINESS SUMMARY

Group 7 will transform the engine into the final product experience. Its surfaces include Genesis Work, Genesis Agent, Mission Control, Capability Hub, Learning UI, Artifacts, Replay, Insights, Studio. Group 7 should **consume, visualize, interact, compose, control** — NOT invent core backend infrastructure.

**Backend readiness summary** (per surface):

| Surface | Readiness | Critical Gap |
|---------|-----------|--------------|
| Genesis Work (persistent projects) | PARTIAL | No persistent project state model; missions are one-shot |
| Genesis Agent (worker-genome-backed) | READY | WorkerGenome is the primary backend model; metadata sufficient |
| Mission Control (org graph, handoffs) | PARTIAL | Live state via FlightRecorder; no durable mission history store |
| Capability Hub (plugins, MCP, models) | PARTIAL | No central capability registry; ownership.yaml is the closest |
| Learning UI (patterns, evidence) | READY | All learning artifacts are persisted JSON; explainability data available |
| Artifacts (metadata, lineage) | PARTIAL | Artifacts exist in clean room; no artifact registry with lineage/version |
| Replay | PARTIAL | Flight events support structural replay; no replay engine |
| Insights (performance metrics) | READY | All metrics captured in Experience + flight events |
| Decision Explainability | PARTIAL | Structured evidence (requirements, patterns, verification) sufficient; no explanation API |

**Detailed inventory:** `docs/transition/G7_PRODUCT_EXPERIENCE_BACKEND_READINESS.md`.

**Critical G7 backend gaps** (must be addressed in Group 6 to avoid G7 becoming an infrastructure phase):
1. **Persistent project/mission history store** — currently one-shot; G7 Genesis Work needs durable project state.
2. **Capability registry** — no central "what capabilities are available right now?" answer; ownership.yaml + GenomeCompiler grants are partial.
3. **Artifact registry with lineage** — artifacts exist in clean room but lack durable metadata (version, lineage, ownership, verification state across revisions).
4. **Event schema freeze** — FlightRecorder event types are stable but not formally versioned; G7 needs a frozen event schema.

---

## J. G6 → G7 PREPARATION OBLIGATIONS

Group 6 should prepare Group 7 by addressing the four critical gaps above. Mapping:

| G6 stage | G6→G7 prep obligation |
|----------|----------------------|
| **G6-01 Production Hardening** | Event reliability; mission state model; failure/recovery state; artifact persistence; telemetry correctness |
| **G6-02 A2A Federation** | External agent/org metadata; federation state; external capability visibility |
| **G6-03 Jev Decision Benchmark** | Decision-provider telemetry; decision metadata |
| **G6-04 RC / Reproducibility** | Configuration metadata; provider health; capability inventory; environment readiness |
| **G6-05 Final Benchmark** | Performance metrics; comparison metrics; mission evidence |
| **G6-06 Engine v1 Closure** | Stable backend contracts; **event schema freeze**; **capability metadata freeze**; **artifact metadata freeze**; UI-facing read models if needed |

This mapping is planning only. Group 6 execution decides what is actually needed.

**Group 7 protection rule (Section 31):** By the end of Group 6, Group 7 should NOT have to build new runtime state model, new event bus, new mission/worker history system, new artifact registry, new verification evidence model, new capability inventory from scratch, new telemetry pipeline, or new organization history model — unless Group 6 execution proves the existing architecture cannot support them.

**Anti-bloat rule (Section 32):** Do NOT build speculative frontend backends now (GraphQL, BFF, UI database, analytics warehouse, event streaming platform, plugin marketplace backend, design-system service, WebSocket layer, frontend API gateway) — unless Group 6 execution proves one is required.

---

## K. GROUP 6 ROADMAP

| Stage | Name | Purpose |
|-------|------|---------|
| **G6-01** | Production Hardening | Error handling, retries, cancellation, partial failure, worker/provider failure, recovery, concurrency, idempotency, observability, auditability. Addresses all P0 and P1 items in the hardening matrix. |
| **G6-02** | A2A Federation | External agent federation (TASK-036+). Internal Genesis workers do NOT speak A2A. Activate when Genesis needs to call or expose external agents. |
| **G6-03** | Jev Decision Benchmark | Wrap Jev (GA, self-serve since Sep 2026) as MCP tool behind DecisionProvider contract. Benchmark at TASK-037. |
| **G6-04** | Release Candidate + Reproducibility Gate | Configuration metadata, provider health checks, capability inventory freeze, environment readiness. RC tag. |
| **G6-05** | Final Benchmark + Claims | Performance metrics, comparison metrics, mission evidence. Final defensible claims. |
| **G6-06** | Engine v1 Closure | Stable backend contracts; event schema freeze; capability/artifact metadata freeze; UI-facing read models if needed. Engine v1 closed. |

**DO NOT start any of them in this transition mission.**

---

## L. EXECUTION PRINCIPLES

1. **Repository reality is authoritative.** Verify HEAD, branch, worktree, remote, tests, typecheck, lint before starting any G6 stage.
2. **Comprehensive knowledge, minimal implementation.** Genesis principle: "large in capability, small in code." Soft warning: > 700 net new production LOC per phase. Hard stop: > 1200 LOC OR > 6 new production files OR any new runtime dependency OR new framework.
3. **Reuse primitives. Standardize protocols. Invent orchestration. Minimize code.** Complexity belongs in capabilities, not in the Genesis codebase.
4. **Pre-registration immutability.** Once an experiment pre-registration has been persisted and execution has started, treat it as immutable. If observed reality differs from predicted reality, do NOT rewrite the original pre-registration — create an observation, corrigendum, or post-execution note. Apply this rule to all G6 benchmarks.
5. **No chain-of-thought storage.** Group 7 readiness must NEVER create a requirement to store hidden model reasoning. Future explainability uses structured decisions, evidence, inputs, outputs, constraints, events, verification — NOT internal chain-of-thought.
6. **Truth before elegance. Evidence before promotion.** No claim without evidence. No pattern promotion without verified support. No benchmark claim without reproducible evidence.
7. **Provider neutrality.** WorkerGenome describes WHAT (operationalNeeds), not HOW (providers). Worker actions are provider-neutral. MissionObligations map to provider-neutral actions. Learned patterns use domain + capabilityNeeds, never provider names.
8. **User explicit requirements outrank learned optimization.** Patterns are advisory. The planner may apply or ignore. User hard constraints always win.

---

## M. STOP / CONSULT RULES

**STOP and consult human review if:**
- A G6 stage exposes a material defect in the engine baseline (false-success path, data corruption, broken recovery, critical security issue, unstable core contract).
- A G6 stage requires changes to learning semantics, Evidence Signature, Pattern schema, GoalCompiler architecture, OrganizationPlanner architecture, verification truth model, Academy methodology, Worker Genome contract, or runtime ownership boundaries.
- A G6 stage requires > 1200 net new production LOC OR > 6 new production files OR any new runtime dependency OR new framework.
- Group 6 execution proves that Group 7 cannot be built on the existing architecture (in which case the gap is documented and Group 7 backend work is reclassified from G7_UI_ONLY to G7_BACKEND_REQUIREMENT, addressed in G6).

**DO NOT STOP for:**
- Small documentation inconsistency (correct in place).
- Small correctness fix (path bug, serialization issue, missing telemetry field, fixture loader error, null handling, incorrect file reference, small runtime adapter mismatch) — fix, test, document, continue.

---

## N. SCIENTIFIC NOTE FROM G5-08 (Section 7 of transition spec)

Once an experiment pre-registration has been persisted and execution has started, it should be treated as **immutable**. If observed reality differs from predicted reality (e.g., the v0.1 GoalCompiler classified a mission's domain differently than the pre-registration predicted), do NOT rewrite the original pre-registration. Instead, create:
- an **observation** field recording the actual observed signature, OR
- a **corrigendum** documenting the discrepancy, OR
- a **post-execution note** appending what was learned.

This rule applies to all future Group 6 benchmarks (Jev decision benchmark, final benchmark, reproducibility gates).

**Do not rerun G5-08.** Group 5 is closed.

---

## O. NEXT STEP

Open a fresh Group 6 conversation starting from:
- This document (`docs/transition/GENESIS_G6_ENTRY_STATE.md`)
- `docs/transition/PRODUCTION_HARDENING_MATRIX.md`
- `docs/transition/G7_PRODUCT_EXPERIENCE_BACKEND_READINESS.md`
- The frozen `GROUP_6_ENTRY_BASELINE` SHA (recorded at end of this transition)

Begin with **G6-01 Production Hardening**. Address all P0 items first, then P1. Do not begin G6-02 until G6-01 closure review PASS.
