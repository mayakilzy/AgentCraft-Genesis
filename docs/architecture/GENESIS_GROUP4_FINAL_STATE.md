# GENESIS_GROUP4_FINAL_STATE

**Date:** 2026-10-07
**Final HEAD:** `99e25f8` (pending final commit)
**Branch:** `build/group-03-repository-work`

---

## 1. Group 4 Purpose

Group 4 = Organizational Learning. Give Genesis the ability to store useful organizational experience, learn from it, promote useful patterns, retrieve them, apply them to future organization design, and measurably improve future organizational behavior.

---

## 2. Tasks / Phases Completed

| Task/Phase | Status | Evidence |
|------------|--------|----------|
| TASK-024 Experience Store | PASS | `src/learning/experience-store.ts` + tests |
| TASK-025 Learning Candidate Generator | PASS | `src/learning/candidate-generator.ts` + tests |
| TASK-026 Learning Evaluation / Promotion | PASS | `src/learning/evaluation.ts` + tests |
| TASK-027 Organizational Pattern Retrieval | PASS | `src/learning/pattern.ts` + tests |
| TASK-028 Measured Learning Experiment | PASS | `experiments/learning-028/REPORT.md` — MEASURED_LEARNING_PASS |
| TASK-029 Evolution Sandbox | PASS (INCONCLUSIVE) | `experiments/evolution-029/REPORT.md` — mechanism exists, variant inconclusive |
| Phase 4.5 Multi-Environment Foundation | PASS | `WorkerSurfaces` + `operationalNeeds` + Experience v2 |
| Phase 4.6 OpenDots Integration | PASS | `WorkspaceSurface` + `CompositeRuntime` + real OpenDots probe |
| Phase 4.6a Provider-Neutral Completion | PASS | `hasDeliverable = artifacts \|\| observedDeliverables` |
| Phase 4.7 OpenMuse Integration | PASS | `JobSurface` + real OpenMuse probe + recovery probe |
| Phase 4.8 Three-Pillar Composition | PASS | 0 LOC composition — real three providers in one mission |
| Phase 4.8A Blind Natural Mission I | FAIL | Exposed 7 gaps (worker action surface, input staging, false-success) |
| Phase 4.8B Natural Worker Capability Closure | PASS | +396 LOC — 4 new worker actions, input staging, fail-closed verification |
| Phase 4.8C Blind Natural Mission II | PARTIAL | 2/3 pillars proven — LLM didn't use OpenMuse job surface |
| Phase 4.8D Mission Obligation Closure | PASS | +165 LOC — flight-action checks, content-in-artifacts, MissionObligation |
| Phase 4.8E Blind Natural Mission III | PASS | All 3 surfaces used, obligations enforced, correct result, verification PASS |
| Phase 4.9 Foundation & Interoperability Review | PASS | MCP/AG-UI/A2A/CopilotKit/Jev decisions frozen |
| Phase 4.10 Learning Compatibility Audit | PASS | +19 LOC — patterns option wires learning into orchestrator |
| Phase 4.11 Measured Learning Experiment II | PASS | LEARNING_PASS — 5→2 workers, 10→4 reasoning, pattern applied |

---

## 3. Strongest Evidence

### Natural Three-Pillar Execution (Phase 4.8E)
- Real LLM-driven worker (glm-4-plus)
- GLM observer only after submission
- Authoritative input staged and observed (no fabrication)
- Real OpenBot computer execution (Python script, correct average 22.23)
- Real OpenMuse durable delegation (get_durable_result observed)
- Real OpenDots shared publication (append_shared_workspace, revision 2)
- Mission obligations enforced by flight-action checks (all 3 passed)
- Verification PASS (5 checks, 0 failed)
- No source changes during blind execution

### Learning Loop Closed (Phase 4.11)
- Experience → Candidate (5) → Evaluation (5 promoted) → Pattern (5 stored)
- Pattern retrieved by OrganizationPlanner via orchestrator `patterns` option
- Organization changed: 5→2 workers, 10→4 reasoning calls
- Pattern applied: YES (learned field populated)
- Learning causality: 8/8 evidence steps proven

---

## 4. Phase 4.8 Closure

**PHASE_4_8_FOUNDATION_CLOSURE = PASS**
**NATURAL_THREE_PILLAR_EXECUTION = PROVEN**

The foundation is closed. A genuinely LLM-driven worker can execute a natural mission across real computer, durable-delegation, and collaborative-workspace surfaces, satisfy mission-required obligations using runtime evidence, and pass independent verification.

---

## 5. Phase 4.9 Decisions

| Protocol | Decision | Activation |
|----------|----------|------------|
| MCP | ADOPT verbatim | Group 5 entry (pin spec 2026-07-28, SDK 1.32.1) |
| AG-UI | ADOPT | Group 5 entry (pin protocol 1.0, @ag-ui/core 1.0.2) |
| A2A | ADOPT at federation edge; DEFER internally | Federation milestone (TASK-036+) |
| CopilotKit Intelligence | ADAPT (ADOPT OSS + AG-UI; DEFER managed platform) | Phase-1 OSS; Phase-2 evaluate Intelligence |
| Jev | ADOPT as optional decision primitive (wrap as MCP tool) | Phase-2 optimization |

See `GENESIS_FOUNDATION_AND_INTEROPERABILITY_MAP_v1.md` for full details.

---

## 6. Learning Compatibility Findings

The forensic audit found the learning loop was architecturally complete (TASK-028 proved it) but the WIRING was manual — the MissionOrchestrator did not pass promoted patterns to the OrganizationPlanner. Phase 4.10 fixed this with a `patterns` option (+19 LOC).

Experience captures: resolvedNeeds, providerInvocations, verification outcome, reasoning calls, wallMs, retries, humanInterventions.

Experience does NOT capture: missionObligations, actual surface usage (flight-action evidence). This is intentional — the spec says "smallest information necessary." Operational-need learning and obligation learning remain future (Group 5 Academy) — they require more diverse mission evidence than N=1.

---

## 7. Learning Changes

- `MissionOrchestratorOptions.patterns?: readonly AdvisoryPattern[]` — when provided, the orchestrator creates `new OrganizationPlanner({ patterns })` so promoted patterns reach future planning.
- `plan-created` flight event now includes `plan.learned` (was previously omitted).

---

## 8. Phase 4.11 Experiment

**MEASURED_LEARNING_EXPERIMENT_II = LEARNING_PASS**

| Metric | BEFORE (A1) | AFTER (B) | Delta |
|--------|-------------|-----------|-------|
| Worker count | 5 | 2 | -3 |
| Reasoning calls | 10 | 4 | -6 |
| Pattern applied | — | YES | — |
| Mission status | success | success | — |

Mission B (rainwater harvesting) was similar but unseen. The learned patterns (avoid Data Analyst, avoid Web Researcher for research domain) were promoted from Mission A1/A2 (solar panels, wind turbines) and applied to Mission B, changing the organization from 5 workers to 2.

---

## 9. Protocol Activation Roadmap

| Phase | Activate |
|-------|----------|
| Group 5 entry | MCP + AG-UI (pin versions) |
| Early Group 5 | CopilotKit OSS (React + Channels) |
| Mid Group 5 | Jev (as MCP tool) |
| Late Group 5 / Group 6 | A2A (federation edge) |
| Post-Academy | CopilotKit Intelligence (evaluate) |

---

## 10. Deferred Limitations

| Item | Reason | Owner | Target Phase |
|------|--------|-------|--------------|
| OpenMuse in-flight checkpoint resume | Phase 4.7 proved queued-work recovery only | Council | Future (not Group 4 blocker) |
| Autonomous operational-need inference | Explicit injection is honest; Academy needs diverse evidence | Group 5 Academy | Group 5 |
| CopilotKit Intelligence activation | ADAPT decision; evaluate after OpenDots/OpenMuse charters | Council | Post-Academy |
| MCP runtime activation | ADOPTed; activate at Group 5 entry | Group 5 | Group 5 |
| AG-UI runtime activation | ADOPTed; activate at Group 5 entry | Group 5 | Group 5 |
| A2A federation | DEFER; activate at federation milestone | Group 6 | TASK-036+ |
| Jev benchmark | Optional primitive; benchmark at TASK-037 | Council | TASK-037 |
| Statistical learning claims | N=1 remains N=1 | Council | Post-Academy |
| Production hardening | Alpha software, sample mode | Future | Post-Academy |

---

## 11. Exact Final Tests

- **Test files:** 39 passed
- **Tests:** 310 passed | 9 skipped (319 total)
- **typecheck:** PASS
- **lint:** PASS
- **9 skipped tests:** all environment-gated on OpenBot checkout presence (intentional, documented)

---

## 12. Exact Final HEAD

(pending final commit — will be recorded post-push)

---

## 13. Group 5 Readiness

**GROUP_5_ENTRY_READY = YES**

All Group-4 responsibilities are CLOSED WITH EVIDENCE or EXPLICITLY DEFERRED with reason, owner, and target phase. No material blocker remains. The foundation is coherent. Interoperability decisions are explicit. The learning loop reaches OrganizationPlanner. Measured learning evidence obtained. Full regression green. Repository clean.
