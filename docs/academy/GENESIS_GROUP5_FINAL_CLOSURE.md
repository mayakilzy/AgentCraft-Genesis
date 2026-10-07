# GENESIS_GROUP5_FINAL_CLOSURE

**Date:** 2026-10-07
**Phase:** G5-08 — Final Generalization, Greenfield Validation & Group 5 Closure
**Status:** CLOSED_PASS_WITH_LIMITATIONS
**Group 5 Started:** 2026-10-07 (G5-01 MCP activation)
**Group 5 Closed:** 2026-10-07 (G5-08 Phase C)
**Final HEAD:** (recorded at commit time)
**Branch:** `build/group-05-causality-investigation`

---

## 1. GROUP 5 PURPOSE

**GROUP 5 = ORGANIZATIONAL CAPABILITY ACADEMY**

Group 5 exposed Genesis to diverse real mission families so it could accumulate, test, and refine reusable organizational capability. The Academy is NOT the product — Genesis is the product. The learning subsystem has done its job when prior experience can make future organization design better informed without becoming more important than the mission itself.

The Academy is NOT LLM fine-tuning, weight training, RLHF, prompt memorization, or dataset memorization. It operates at the organizational layer: WHO should work, HOW they should collaborate, WHAT capabilities they need, WHEN complexity is unnecessary.

---

## 2. STAGES COMPLETED

| Stage | Name | Status | Date |
|-------|------|--------|------|
| G5-01 | MCP Activation | PASS | 2026-10-07 |
| G5-02 | AG-UI Activation | PASS | 2026-10-07 |
| G5-03 | Academy Bootstrap (Charter, Curriculum, Experiment Contract, Cohort 001 design) | PASS | 2026-10-07 |
| G5-04 | Cohort 001 Execution (4 learning missions, 4 experiences, 4 candidates, 1 promoted — contaminated) | PASS_WITH_INCIDENT | 2026-10-07 |
| G5-04A | Semantic Integrity Investigation & Remediation (Evidence Signature v1, quarantine) | PASS | 2026-10-07 |
| G5-05 | Cohort 002 — Within-Family Repetition & Counterevidence (10 missions, 3 trusted patterns promoted) | PASS_WITH_EVIDENCE_LIMITATION | 2026-10-07 |
| G5-06 | Causality & Measured Impact (prefer-role: Sole Operator implemented; 2→1 worker causal proof) | MEASURED_ORGANIZATIONAL_LEARNING_PASS | 2026-10-07 |
| G5-07 | Sealed Blind Transfer (4 unseen missions; 3 CONFIRMATORY + 1 NON_APPLICABLE) | BLIND_TRANSFER_PASS_WITH_LIMITATION | 2026-10-07 |
| G5-08 | Final Generalization + Greenfield + Closure (2 gen missions, 1 greenfield; GENERALIZATION_ACTIVE observed) | CLOSED_PASS_WITH_LIMITATIONS | 2026-10-07 |

**Total production code delta across Group 5:** +62 LOC (single prefer-role implementation in `src/organization/organization-planner.ts`, lines 527-573, from G5-06). All other Group 5 work was experiment harnesses, docs, tests, and evidence packages — zero additional production changes.

---

## 3. KEY EVIDENCE

| # | Stage | Evidence | Path |
|---|-------|----------|------|
| 1 | G5-04 | Cohort 001 results — 4 experiences captured across 4 families | `experiments/academy/cohort-001/results.json` |
| 2 | G5-04A | Evidence Signature v1 + quarantine of contaminated pattern | `experiments/academy/cohort-001/pattern-quarantine.json` |
| 3 | G5-05 | Cohort 002 results — 10 experiences; 3 trusted patterns promoted | `experiments/academy/cohort-002/results.json` |
| 4 | G5-06 | Causality proof — 2 specialists → 1 Sole Operator (workerDelta = -1, correctness preserved) | `experiments/academy/g5-06/phase-a/phase-a-evidence.json` |
| 5 | G5-07 | Sealed blind transfer — 3 CONFIRMATORY + 1 NON_APPLICABLE; 0 false/harmful | `experiments/academy/g5-07/aggregate-results.json` |
| 6 | G5-08-A | Generalization — Mission B (note-taking-app evaluation) produced GENERALIZATION_ACTIVE on NOVEL content | `experiments/academy/g5-08/generalization/phase-a-b-evidence.json` |
| 7 | G5-08-B | Greenfield — Genesis executed end-to-end (Goal→Org→Workers→Verify); independent runtime verification PASS | `experiments/academy/g5-08/greenfield/phase-b-evidence.json` + `independent-verification.json` |

---

## 4. WHAT WAS PROVEN

### Capability 1 — Capture organizational experience
Genesis captured 14 experiences across 4 mission families (research, data, software, knowledge) with full provenance (missionId, flight record, repositorySha, source=synthetic).

### Capability 2 — Distinguish comparable from non-comparable evidence
Evidence Signature v1 (domain + sorted capabilityNeeds) prevents the false-aggregation case discovered in G5-04A. Tests in `tests/learning/semantic-integrity.test.ts` enforce: same-signature experiences aggregate; different-signature experiences do NOT aggregate as contradictions.

### Capability 3 — Derive candidate organizational patterns
StatisticalCandidateGenerator produced 7 candidates in Cohort 002 (under v1 signature semantics). Candidate kinds include `prefer-role` and `avoid-role`, both first-class.

### Capability 4 — Evaluate/promote bounded trusted patterns
RuleCandidateEvaluator promoted 3 trusted patterns (support=2-3, no contradictions, all verified). 4 remained tentative (support=1). Quarantine mechanism preserves historical evidence while preventing contaminated patterns from influencing future planning.

### Capability 5 — Retrieve learned knowledge during future planning
RulePatternRetriever (domain-exact + capabilityNeeds-intersection) confirmed retrieval on 3 of 4 G5-07 sealed missions and on G5-08 phase A mission B (a NOVEL content domain).

### Capability 6 — Let learned knowledge causally influence organization
G5-06 phase A: prefer-role: Sole Operator collapsed 2 specialists → 1 Sole Operator. G5-08 phase A mission B: same causal effect on a NOVEL content domain. The causal mechanism is part of production behavior (`src/organization/organization-planner.ts` lines 527-573).

### Capability 7 — Preserve applicability boundaries
G5-07: 1 of 4 sealed missions correctly produced NON_APPLICABLE (C001-06 software-engineering; no trusted pattern matched). G5-08 phase A mission A: same NON_APPLICABLE on a software-engineering mission (Rust vs Go). G5-08 phase B Greenfield: NON_APPLICABLE on a software-engineering mission (CLI tool). Three independent observations confirm Genesis does NOT apply learned knowledge where its applicability context does not match.

### Capability 8 — Carry learned knowledge across an unseen mission boundary
G5-07: 3 of 4 sealed missions produced CONFIRMATORY_TRANSFER (pattern retrieved, baseline already satisfied preference). G5-08 phase A mission B: GENERALIZATION_ACTIVE — pattern transferred to a NOVEL content domain (note-taking-app evaluation for academic researchers, distinct from training content: solar/wind power, databases, renewable energy) and causally collapsed a 2-specialist baseline into a 1-Sole-Operator learned organization.

### Capability 9 — Execute a fresh end-to-end Genesis mission without learning corrupting current mission truth
G5-08 phase B Greenfield: Genesis executed Goal → Requirements → Organization (emerged, not hand-designed: 2 workers Software Engineer + Documentation Writer) → Genomes → Worker → Execution → Independent Verification, all PASS. No false success. No evaluator/gold leakage. Learned patterns did not override stronger current requirements (none applied). Independent runtime verification confirms artifacts (wordfreq.mjs + test.mjs) actually function when executed with Node.js.

---

## 5. WHAT WAS NOT PROVEN

- **Universal pattern generalization** — N=1 GENERALIZATION_ACTIVE on a content-novel mission; broad cross-family generalization is not claimed.
- **Real-LLM behavioral superiority** — all missions used scripted reasoning (`provenance.source = 'synthetic'`). Behavioral generalization to real LLM workers is NOT tested.
- **Production-scale autonomous self-improvement** — Genesis is alpha software, sample mode.
- **Universal transfer** — only `prefer-role: Sole Operator` is implemented. Specialist `prefer-role`, pattern retirement, and statistical confidence are NOT implemented.
- **OperationalNeeds / MissionObligation learning** — operational needs and obligations remain explicitly injected (Level 5 deferred).
- **Cross-family universal ontology** — Evidence Signature v1 uses domain + capabilityNeeds; cross-family transfer belongs to a future cohort (Group 5 did not run Cohort 004).
- **Optimal organization** — Genesis produces MORE APPROPRIATE organization, not OPTIMAL. Learning is advisory, not mandatory.
- **Real-world longitudinal learning** — all Group 5 missions ran in a single sandboxed session.

---

## 6. KNOWN LIMITATIONS

1. **Scripted reasoning** — every Experience has `provenance.source = 'synthetic'`. The transfer is structural (organizational design), not behavioral (LLM reasoning quality). Behavioral generalization to real LLM workers is not tested.
2. **Only `prefer-role: Sole Operator` implemented** — specialist `prefer-role` (e.g., "prefer Software Engineer") is recognized but not implemented (seam open in `applyAdvisoryPattern`).
3. **Architecture cannot represent organizational requirements** — only capability needs. The sealed mission design docs mention "independent verification" but the architecture represents only capabilities. This did NOT materially affect Group 5 (no pattern was applied where it would conflict), but may matter for future cohorts with explicit organizational requirements.
4. **GoalCompiler v0.1 word-boundary heuristics** — occasionally misclassify domains (e.g., "Rust vs Go" classified as software-engineering rather than research, because 'service' and 'code' trigger the software-engineering signal). Sealed mission wording is preserved verbatim; the actual signature is recorded.
5. **Intersection-based retrieval is liberal** — RulePatternRetriever returns patterns whose capabilityNeeds intersect the mission's needs (NOT exact signature match). This caused the `general|data-analysis,document-authoring` pattern to be retrieved for `general|document-authoring` missions. Documented; not modified.
6. **N is small** — 14 training experiences (Cohort 001 + 002); 4 sealed transfer missions (Cohort 001 transfer-designated); 2 generalization missions (G5-08-A, B); 1 greenfield mission (G5-08-GF-A). Statistical significance is not claimed.
7. **Single session** — all Group 5 work executed in one session. Longitudinal learning across sessions is not tested.
8. **No real OpenBot/OpenDots/OpenMuse execution in Academy missions** — Academy missions used StubComputer. Real-runtime execution was proven in Phase 4.8E (benchmark-023) and is the Group 5 entry contract; Academy missions used stubs for calibration and reproducibility.

---

## 7. FUTURE LEARNING BACKLOG

Maximum 10 items. Do NOT implement in G5-08.

| # | Item | Priority | Reason |
|---|------|----------|--------|
| 1 | Real-LLM replication of Cohort 002 + G5-06/07/08 | HIGH | Upgrade evidence from synthetic to real-mission; unblock behavioral generalization claims. |
| 2 | Specialist `prefer-role` implementation (e.g., "prefer Software Engineer") | MEDIUM | Currently only Sole Operator is implemented; the seam is open in `applyAdvisoryPattern`. |
| 3 | Hard organizational requirement representation (e.g., independent verification, separation of duties) | MEDIUM | Architecture currently represents only capability needs; a future cohort may test whether learned simplification respects organizational requirements. |
| 4 | OperationalNeeds learning (Level 5) | MEDIUM | Diverse mission evidence could feed a candidate generator for `avoid-grant` patterns (e.g., `openbot:shell-execution` was over-provisioned in 10/10 Cohort 002 missions). |
| 5 | MissionObligation learning (Level 5) | LOW | Same — requires diverse evidence that certain obligations improve verified outcomes. |
| 6 | Pattern retirement lifecycle (CONFIRMED → CONTEXT_RESTRICTED → DOWNGRADED → SUPERSEDED → RETIRED) | LOW | Current architecture supports only PROMOTED and REJECTED. Pattern retirement requires accumulated contradictory evidence. |
| 7 | Same-signature counterevidence (within-family contradiction) | LOW | G5-05 counterevidence missions had different signatures and did NOT produce technical contradictions. Same-signature counterevidence would test the evaluator's contradiction mechanism. |
| 8 | Statistical confidence framework | LOW | N is currently 2-3 per signature. Statistical significance requires N>10 per family. |
| 9 | Cross-family universal ontology | LOW | Evidence Signature v1 uses domain + capabilityNeeds. Cross-family transfer (Cohort 004) was not run in Group 5. |
| 10 | Longitudinal learning across sessions | LOW | All Group 5 work ran in one session. Longitudinal learning would test pattern persistence and decay. |

---

## 8. FINAL LEARNING ARCHITECTURE

```
MISSION
   ↓
ORGANIZATION          ← Academy learning operates here
   ↓
EXECUTION
   ↓
EVIDENCE
   ↓
EXPERIENCE            ← schemaVersion 2; provenance.source ∈ {synthetic, real-mission}
   ↓
LEARNING CANDIDATES   ← StatisticalCandidateGenerator groups by Evidence Signature v1
   ↓
EVALUATION            ← RuleCandidateEvaluator: promote if support≥2 + no contradiction + verification success
   ↓
PROMOTED PATTERNS     ← OrganizationalPattern (applicableContext + proposedEffect)
   ↓
FUTURE ORGANIZATION   ← RulePatternRetriever (domain-exact + capabilityNeeds-intersection)
   ↓
ORGANIZATION PLANNER  ← applyAdvisoryPattern: prefer-role (Sole Operator only) + avoid-role
```

**Key contracts (unchanged from Group 5 entry):**
- `Experience` (schemaVersion 2)
- `LearningCandidate` (hypothesis, applicableContext, proposedEffect, supportingExperienceIds)
- `Evaluation` (status ∈ {promoted, tentative, rejected}, evidence, reason)
- `OrganizationalPattern` (id, applicableContext, proposedEffect, promotionEvidence)
- `AdvisoryPattern` (planner-side mirror; same shape, decoupled from learning module)
- `Evidence Signature v1` = `domain + sorted(capabilityNeeds)`

**Key modules (production code):**
- `src/learning/experience.ts` — `deriveExperience()`
- `src/learning/candidate-generator.ts` — `StatisticalCandidateGenerator` (signature-aware grouping since G5-04A)
- `src/learning/evaluation.ts` — `RuleCandidateEvaluator`
- `src/learning/pattern.ts` — `promoteCandidate()`, `RulePatternRetriever`
- `src/organization/organization-planner.ts` — `applyAdvisoryPattern()` (prefer-role implemented in G5-06; avoid-role from Phase 4.11)

**Quarantine:** `experiments/academy/cohort-001/pattern-quarantine.json` preserves the contaminated pattern `cand-research-prefer-sole-operator` as an audit record. It is NOT in any active pattern set and is NOT retrievable.

---

## 9. GROUP 5 CLOSURE DECISION

### GROUP_5_STATUS = CLOSED_PASS_WITH_LIMITATIONS

**Justification:** All 9 capability criteria in Section 33 of the G5-08 mission spec are supported by evidence. The strongest generalization evidence (G5-08 phase A mission B) demonstrates active causal transfer to a novel content domain under scripted reasoning. The Greenfield validation (G5-08 phase B) confirms Genesis can execute a fresh end-to-end mission with organization emerging from Genesis (not hand-designed), independent verification PASS, no false success.

**Important evidence limitations remain:**
1. Scripted reasoning (provenance.source = synthetic) — behavioral generalization to real LLM workers is not tested.
2. Only prefer-role: Sole Operator is implemented.
3. Architecture cannot represent organizational requirements.
4. GoalCompiler v0.1 word-boundary heuristics occasionally misclassify domains.
5. N is small (14 training experiences; 7 transfer/generalization missions).

These limitations do NOT prevent Group 5 from closing. They are recorded as future work and do NOT represent material defects that would make learning unsafe as a bounded supporting capability.

### LEARNING_CAPABILITY_SUPPORTED

YES — Genesis contains a bounded organizational learning loop that can:
- capture prior execution experience,
- derive and evaluate organizational patterns,
- retrieve relevant learned knowledge during future planning,
- allow that knowledge to influence organization design,
- preserve current-mission verification and applicability boundaries.

### LEARNING_CAPABILITY_NOT_SUPPORTED

- Universal autonomous self-improvement.
- Real-LLM behavioral generalization (scripted reasoning only).
- OperationalNeeds / MissionObligation autonomous inference.
- Pattern retirement lifecycle.
- Statistical confidence.

---

## 10. ALLOWED CLAIMS (Section 47)

After Group 5 closure, the strongest acceptable product-level claim:

> "Genesis contains a bounded organizational learning loop that can capture prior execution experience, derive and evaluate organizational patterns, retrieve relevant learned knowledge during future planning, and allow that knowledge to influence organization design while preserving current-mission verification and applicability boundaries."

Additionally (per G5-08 phase A mission B):

> "Bounded generalization of learned organizational knowledge was observed outside the original mission content under controlled conditions: a pattern learned from solar/wind/database/renewable-energy comparison missions transferred to a novel content domain (note-taking-app evaluation for academic researchers) and causally collapsed a 2-specialist baseline into a 1-Sole-Operator learned organization while preserving independently verified mission correctness."

Limitation (scripted reasoning):

> "Under scripted reasoning conditions (provenance.source = synthetic on every Experience)."

### FORBIDDEN OVERCLAIMS

- General autonomous self-improvement.
- Universal transfer.
- Universal cross-family learning.
- Production-scale learning superiority.
- Human-level organizational intelligence.
- Real-LLM organizational superiority (scripted only).

---

## 11. GROUP 6 HANDOFF

**SAFE_TO_BEGIN_GROUP_6 = YES**

Group 6 returns focus to the primary Genesis product. Expected remaining roadmap areas include:

- Production Hardening
- A2A Federation
- Jev Benchmark
- Release Candidate / Reproducibility Gate
- Final Benchmark / Claims
- v1.0 Closure

**DO NOT begin any of them in this mission.** Group 5 has closed. Group 6 requires human approval.

### GROUP_5_PRODUCTION_DEBT

| Item | Status |
|------|--------|
| `prefer-role: Sole Operator` implementation | +62 LOC in `src/organization/organization-planner.ts` (G5-06). Production code; tested. |
| Evidence Signature v1 | No production code change — `StatisticalCandidateGenerator` was updated in G5-04A to group by domain + capabilityNeeds (already in production). |
| Quarantine mechanism | No production code change — quarantine is enforced by exclusion from the active pattern set (a test-time invariant, not a runtime check). |
| New runtime dependencies | 0 |
| New production files | 0 |

---

## 12. DOCUMENTATION

| Document | Path |
|----------|------|
| Group 5 Final Closure (this document) | `docs/academy/GENESIS_GROUP5_FINAL_CLOSURE.md` |
| G5-08 Phase A summary | `experiments/academy/g5-08/generalization/phase-a-summary.json` |
| G5-08 Phase B evidence | `experiments/academy/g5-08/greenfield/phase-b-evidence.json` |
| G5-08 Phase B independent verification | `experiments/academy/g5-08/greenfield/independent-verification.json` |
| G5-08 Phase C closure review | `experiments/academy/g5-08/phase-c-closure-review.json` |
| G5-07 sealed blind transfer report | `docs/academy/GENESIS_G5_07_SEALED_BLIND_TRANSFER.md` |
| G5-06 causality report | `docs/academy/GENESIS_G5_06_CAUSALITY_AND_MEASURED_IMPACT.md` |
| G5-05 Cohort 002 results | `docs/academy/GENESIS_ACADEMY_COHORT_002_RESULTS.md` |
| G5-04A semantic integrity | `docs/academy/GENESIS_G5_04A_SEMANTIC_INTEGRITY.md` |
| Cohort 001 design | `docs/academy/GENESIS_ACADEMY_COHORT_001_v1.md` |
| Academy Charter | `docs/academy/GENESIS_ACADEMY_CHARTER_v1.md` |
| Academy Curriculum | `docs/academy/GENESIS_ACADEMY_CURRICULUM_v1.md` |
| Academy Experiment Contract | `docs/academy/GENESIS_ACADEMY_EXPERIMENT_CONTRACT_v1.md` |
| Architecture Map | `docs/architecture/GENESIS_ARCHITECTURE_MAP_v1.md` |
| Learning State v2 | `docs/architecture/GENESIS_LEARNING_STATE_v2.md` |
| Group 5 Entry Contract | `docs/architecture/GENESIS_GROUP5_ENTRY_CONTRACT.md` |

### EVIDENCE_PATHS

- `experiments/academy/cohort-001/` — Cohort 001 execution + quarantine
- `experiments/academy/cohort-002/` — Cohort 002 execution + before/after
- `experiments/academy/g5-06/` — Phase A + Phase B causality evidence
- `experiments/academy/g5-07/` — Sealed blind transfer evidence package
- `experiments/academy/g5-08/generalization/` — Phase A generalization evidence (Missions A + B)
- `experiments/academy/g5-08/greenfield/` — Phase B greenfield evidence + independent verification
- `experiments/academy/g5-08/phase-c-closure-review.json` — Phase C closure review

### REMOTE_PUSH_STATUS

(Recorded at commit time.)

---

## 13. STOP CONDITION (Section 49)

**G5-08 STOPPED.** Group 5 closed.

- DO NOT create G5-09.
- DO NOT begin another Academy cohort.
- DO NOT implement Future Learning Backlog items.
- DO NOT begin Group 6.

Return the evidence for human review.

---

## 14. FINAL PRINCIPLE (Section 50)

> The Academy is not the product.
> Genesis is the product.
>
> The learning subsystem has done its job when prior experience can make future organization design better informed without becoming more important than the mission itself.
>
> We do not need to solve self-learning before building Genesis.
> We need enough learning to make Genesis improve safely over time.
> Then move on.
>
> Comprehensive knowledge.
> Minimal implementation.
>
> Freedom inside requirements.
> Truth before elegance.
> Evidence before promotion.
>
> Design for the final Genesis.
> Build only the next Genesis.

Group 5 has done its job. Group 6 begins the next Genesis.
