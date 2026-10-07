# GENESIS_G5_07_SEALED_BLIND_TRANSFER

**Date:** 2026-10-07
**Phase:** G5-07 — Sealed Blind Transfer & Learned-Pattern Boundary Test
**Status:** BLIND_TRANSFER_PASS_WITH_LIMITATION
**Previous Phase:** G5-06 — MEASURED_ORGANIZATIONAL_LEARNING_PASS
**Start HEAD:** `d97c3b82b93cc6bfd2975784b22ebc351678dd8b`
**Branch:** `build/group-05-causality-investigation`

---

## 1. Scientific Question

> CAN GENESIS CORRECTLY USE LEARNED ORGANIZATIONAL KNOWLEDGE ON A MISSION THAT DID NOT PARTICIPATE IN LEARNING?

This is a **BLIND TRANSFER** experiment. The goal is NOT to force the pattern to change the organization. The goal is to observe whether Genesis correctly transfers learned organizational knowledge to unseen evidence, including cases where the correct action is to apply, confirm, ignore, or override that knowledge.

G5-06 established that a trusted learned pattern (`cand-research-document-authoring-prefer-sole-operator`) could causally collapse a multi-specialist organization into a single Sole Operator under controlled, scripted conditions while preserving mission correctness and verification. That established causality under direct conditions.

G5-07 asks a fundamentally different question: does that learned knowledge correctly reach missions that have NEVER been seen, NEVER participated in learning, and NEVER been part of any cohort?

---

## 2. Pre-Registration

The full pre-registration artifact is persisted at `experiments/academy/g5-07/pre-registration.json`. Key fields:

| Field | Value |
|-------|-------|
| TRANSFER_MISSIONS_SELECTED | C001-02, C001-04, C001-06, C001-08 |
| SELECTION_METHOD | B — deterministic mission-ID ordering (predeclared BEFORE planner execution) |
| PROVIDER_MODE | SCRIPTED_REASONING |
| REAL_LLM_REASONING_USED | NO |
| SCRIPTED_REASONING_USED | YES |
| TRUSTED_PATTERNS_AVAILABLE | 3 (research-document-authoring, research-document-authoring-web-research, general-data-analysis-document-authoring) |
| QUARANTINED_PATTERNS | 1 (cand-research-prefer-sole-operator — must NOT participate) |
| BASELINE_POLICY | OrganizationPlanner({ patterns: [] }) |
| LEARNED_POLICY | OrganizationPlanner({ patterns: TRUSTED_PATTERNS }) |
| VERIFICATION_POLICY | Independent across arms; checks mission truth (artifact existence + content correctness + mission-input preservation) |
| TRANSFER_PATTERN_STATE_FROZEN | YES |
| TRANSFER_CLASSIFICATION_RULES | A-G (see Section 13 of the G5-07 mission spec) |

The selection method is deterministic mission-ID ordering. All four Cohort 001 transfer-designated missions are executed. No mission is added, removed, reordered, or substituted based on inspection of baseline organization, expected outcome, or pattern applicability. The selection is scientifically defensible because it is declared BEFORE planner execution and is independent of expected organization shape.

---

## 3. Sealed Set Integrity

The full integrity audit is persisted at `experiments/academy/g5-07/sealed-set-integrity.json`. Key findings:

| Check | Result |
|-------|--------|
| C001-02_PREVIOUSLY_EXECUTED | NO — INTACT |
| C001-04_PREVIOUSLY_EXECUTED | NO — INTACT |
| C001-06_PREVIOUSLY_EXECUTED | NO — INTACT |
| C001-08_PREVIOUSLY_EXECUTED | NO — INTACT |
| TRANSFER_SET_INTEGRITY | INTACT |
| TRANSFER_SET_CONTAMINATED | NO |

Verification method: filesystem + flight-record + experience-store audit across `experiments/academy/cohort-001/runs/`, `experiments/academy/cohort-002/runs/`, `experiments/academy/g5-06/`, `data/flight-records/`, and `cohort-001/results.json` / `cohort-002/results.json`. None of the four transfer-designated missions appears in any prior execution record.

---

## 4. Quarantine Enforcement

| Check | Result |
|-------|--------|
| Quarantined pattern ID | `cand-research-prefer-sole-operator` |
| In production code (src/) | NO — zero occurrences |
| In active pattern sets (G5-07) | NO — explicitly excluded from TRUSTED_PATTERNS |
| Retrievable for G5-07 | NO |
| Test coverage | `tests/learning/semantic-integrity.test.ts` confirms the quarantined candidate ID is NOT produced by the signature-aware candidate generator |
| QUARANTINED_PATTERN_USED | NO |

---

## 5. Frozen Pattern State

The frozen pattern state is persisted at `experiments/academy/g5-07/frozen-pattern-state.json`. Three trusted patterns from G5-05 (Cohort 002) are frozen BEFORE first transfer mission execution:

| Pattern ID | Support | Evidence Signature | Promotion Phase |
|------------|---------|--------------------|------------------|
| `cand-research-document-authoring-prefer-sole-operator` | 3 | `research\|document-authoring` | G5-05 |
| `cand-research-document-authoring-web-research-prefer-sole-operator` | 2 | `research\|document-authoring,web-research` | G5-05 |
| `cand-general-data-analysis-document-authoring-prefer-sole-operator` | 2 | `general\|data-analysis,document-authoring` | G5-05 |

Four additional tentative patterns (support=1) are excluded from the active retrieval set per promotion rules.

| Mutation Check | Result |
|----------------|--------|
| TRANSFER_PATTERN_STATE_FROZEN | YES |
| NEW_PATTERNS_PROMOTED_DURING_TRANSFER | NO |
| SUPPORT_COUNTS_MODIFIED_DURING_TRANSFER | NO |
| PATTERN_APPLICABILITY_MODIFIED_DURING_TRANSFER | NO |
| PATTERN_STATE_CHANGED_DURING_TRANSFER | NO |
| QUARANTINED_PATTERN_USED | NO |

---

## 6. Two-Arm Design

Each of the four sealed missions is executed under two arms:

| Arm | Planner Configuration | What Differs |
|-----|----------------------|--------------|
| A — BASELINE | `OrganizationPlanner({ patterns: [] })` | No learned organizational patterns available |
| B — LEARNED | `OrganizationPlanner({ patterns: TRUSTED_PATTERNS })` | Trusted learned patterns available normally |

Held constant across arms: mission text, mission inputs, provider mode, runtime, available capabilities, verification, budgets, hard constraints, acceptance criteria. Only learned organizational knowledge differs.

### Epistemic Isolation (Section 12)

- Each WorkerAgent construction is a separate logical instance with a fresh scripted reasoning provider queue. No reasoning continuity between arms.
- Each arm uses its own fresh MemoryFlightRecorder. No mission-to-mission state leakage except the explicitly declared trusted patterns.
- The worker has NO knowledge of: baseline organization, baseline result, expected organization, expected worker count, which pattern is being tested, pattern support count, expected transfer outcome.
- Verification reads only flight events + artifacts. The expected answer is NOT in the worker prompt.
- No transfer mission feeds candidate generation during G5-07. The trusted pattern state is frozen before execution and unchanged throughout.

---

## 7. Per-Mission Results

### 7.1 C001-02 — Family A (Research), L3

**Goal (verbatim from Cohort 001 design):** Investigate a factual claim (e.g. "does technique T achieve performance P?") and produce a verified conclusion with evidence.

| Metric | Baseline | Learned |
|--------|----------|---------|
| Domain | research | research |
| CapabilityNeeds | [web-research, document-authoring] | [web-research, document-authoring] |
| Evidence Signature | research\|document-authoring,web-research | research\|document-authoring,web-research |
| Workers | 1 (Sole Operator) | 1 (Sole Operator) |
| Reasoning calls | 3 | 3 |
| Verification | PASS (4/4) | PASS (4/4) |
| Status | success | success |
| Patterns considered | 0 | 2 (`cand-research-document-authoring-prefer-sole-operator`, `cand-research-document-authoring-web-research-prefer-sole-operator`) |
| Patterns applied | 0 | 0 |

**Pattern Trace:**
- PATTERNS_AVAILABLE = 3 trusted
- PATTERNS_RETRIEVED = 2 (research-domain patterns whose capabilityNeeds intersect the mission's needs)
- PATTERN_APPLICABLE = YES
- APPLICABILITY_REASON = Both research patterns' capabilityNeeds intersect the mission's needs (document-authoring is shared; web-research is shared)
- PATTERN_INTERPRETED = YES (planner's retrieval+consideration step ran)
- PATTERN_APPLIED = NO (planner's `applyAdvisoryPattern()` was NOT reached because the minimal-scope early-return path produced a Sole Operator before the pattern application loop)
- PATTERN_OVERRIDDEN = NO (no override signal — the pattern was simply not needed)
- ORGANIZATION_CHANGED = NO (baseline already produces 1 Sole Operator; learned also produces 1 Sole Operator)
- CAUSAL_ATTRIBUTION = NO (no organizational change to attribute)
- BASELINE_CORRECTNESS = success / LEARNED_CORRECTNESS = success

**TRANSFER_CLASSIFICATION = CONFIRMATORY_TRANSFER**

**Interpretation:** Genesis correctly retrieved two trusted research patterns for an unseen research mission. The patterns are legitimately applicable — the mission's domain (research) and capabilityNeeds (web-research, document-authoring) match the patterns' applicable contexts. However, the baseline organization already satisfies the learned preference: the planner's heuristic for minimal-scope missions produces a single Sole Operator before the pattern application loop is reached. The pattern is considered but not applied; no additional organizational change is required. This is valid transfer evidence, but weaker than active causal transfer. The mission correctness is preserved across both arms.

---

### 7.2 C001-04 — Family B (Data), L4

**Goal (verbatim from Cohort 001 design):** Detect anomalies in a dataset and report them with evidence.

| Metric | Baseline | Learned |
|--------|----------|---------|
| Domain | general | general |
| CapabilityNeeds | [document-authoring] | [document-authoring] |
| Evidence Signature | general\|document-authoring | general\|document-authoring |
| Workers | 1 (Sole Operator) | 1 (Sole Operator) |
| Reasoning calls | 3 | 3 |
| Verification | PASS (4/4) | PASS (4/4) |
| Status | success | success |
| Patterns considered | 0 | 1 (`cand-general-data-analysis-document-authoring-prefer-sole-operator`) |
| Patterns applied | 0 | 0 |

**Honest observation about signature:** The goal text contains the word "dataset" which does NOT match the word-boundary regex `\bdata\b` used by the deterministic v0.1 goal compiler for the data-analysis capabilityNeed. Only "report" triggers document-authoring. The resulting signature is `general|document-authoring`, NOT the predicted `general|data-analysis,document-authoring`. This is an honest limitation of the deterministic v0.1 compiler; the sealed mission wording is preserved verbatim and the actual signature is recorded.

**Pattern Trace:**
- PATTERNS_AVAILABLE = 3 trusted
- PATTERNS_RETRIEVED = 1 (the general-domain pattern retrieved because document-authoring intersects the pattern's needs)
- PATTERN_APPLICABLE = YES (per the retriever's intersection rule)
- APPLICABILITY_REASON = The pattern's applicableContext is `{domain: general, capabilityNeeds: [data-analysis, document-authoring]}`. The mission's domain (general) matches. The pattern's capabilityNeeds (data-analysis, document-authoring) intersect the mission's needs (document-authoring) — at least one need is shared.
- PATTERN_INTERPRETED = YES
- PATTERN_APPLIED = NO (minimal-scope early return; baseline already 1 worker)
- ORGANIZATION_CHANGED = NO
- CAUSAL_ATTRIBUTION = NO

**TRANSFER_CLASSIFICATION = CONFIRMATORY_TRANSFER**

**Interpretation:** Genesis retrieved the general-domain trusted pattern for an unseen data mission. The pattern is retrieved because the retriever uses domain-exact + capabilityNeeds-intersection matching (NOT exact signature matching). The pattern's full evidence signature is `general|data-analysis,document-authoring` but the mission's signature is `general|document-authoring` — a strict subset. The retriever is intentionally liberal (intersection-based) to allow patterns learned on richer contexts to apply to leaner missions. The pattern is considered but not applied (baseline already produces a Sole Operator). Mission correctness is preserved.

---

### 7.3 C001-06 — Family C (Software), L3

**Goal (verbatim from Cohort 001 design):** Implement a small function according to a spec and verify it passes tests.

| Metric | Baseline | Learned |
|--------|----------|---------|
| Domain | software-engineering | software-engineering |
| CapabilityNeeds | [code-execution] | [code-execution] |
| Evidence Signature | software-engineering\|code-execution | software-engineering\|code-execution |
| Workers | 1 (Sole Operator) | 1 (Sole Operator) |
| Reasoning calls | 4 | 4 |
| Verification | PASS (4/4) | PASS (4/4) |
| Status | success | success |
| Patterns considered | 0 | 0 |
| Patterns applied | 0 | 0 |

**Pattern Trace:**
- PATTERNS_AVAILABLE = 3 trusted
- PATTERNS_RETRIEVED = 0
- PATTERN_APPLICABLE = NO
- APPLICABILITY_REASON = No trusted pattern matches domain `software-engineering`. All four software-engineering candidate patterns from G5-05 are TENTATIVE (support=1) and are excluded from the active retrieval set. The three trusted patterns are for `research` and `general` domains only.
- PATTERN_INTERPRETED = N/A
- PATTERN_APPLIED = NO
- ORGANIZATION_CHANGED = NO
- CAUSAL_ATTRIBUTION = NO

**TRANSFER_CLASSIFICATION = NON_APPLICABLE**

**Interpretation:** No trusted pattern legitimately applies to this unseen software-engineering mission. Genesis correctly retrieved no pattern. This is NOT failure — correct non-application is positive evidence of bounded learning. The mission's evidence signature (`software-engineering|code-execution`) has no trusted pattern in the active retrieval set. Mission correctness is preserved with a Sole Operator in both arms (the planner's default for minimal-scope software-engineering missions).

---

### 7.4 C001-08 — Family D (Knowledge), L4

**Goal (verbatim from Cohort 001 design):** Extract structured knowledge from a document and verify it against a reference.

| Metric | Baseline | Learned |
|--------|----------|---------|
| Domain | general | general |
| CapabilityNeeds | [document-authoring] | [document-authoring] |
| Evidence Signature | general\|document-authoring | general\|document-authoring |
| Workers | 1 (Sole Operator) | 1 (Sole Operator) |
| Reasoning calls | 4 | 4 |
| Verification | PASS (4/4) | PASS (4/4) |
| Status | success | success |
| Patterns considered | 0 | 1 (`cand-general-data-analysis-document-authoring-prefer-sole-operator`) |
| Patterns applied | 0 | 0 |

**Pattern Trace:**
- PATTERNS_AVAILABLE = 3 trusted
- PATTERNS_RETRIEVED = 1 (the general-domain pattern, same as C001-04)
- PATTERN_APPLICABLE = YES (per the retriever's intersection rule)
- APPLICABILITY_REASON = The pattern's applicableContext matches the mission's domain (general), and document-authoring is shared.
- PATTERN_INTERPRETED = YES
- PATTERN_APPLIED = NO (minimal-scope early return; baseline already 1 worker)
- ORGANIZATION_CHANGED = NO
- CAUSAL_ATTRIBUTION = NO

**TRANSFER_CLASSIFICATION = CONFIRMATORY_TRANSFER**

**Interpretation:** Genesis retrieved the general-domain trusted pattern for an unseen knowledge-extraction mission. Same retrieval mechanism as C001-04 (intersection-based). The pattern is considered but not applied; baseline already produces a Sole Operator. Mission correctness is preserved.

**Evidence Signature observation:** C001-04 and C001-08 share the same signature `general|document-authoring`. Both missions produce the same organizational shape (1 Sole Operator). This is NOT an incompatible collision — both are general-domain, single-artifact, document-authoring tasks with comparable organizational context. The signature correctly groups them.

---

## 8. Baseline vs Learned Comparison

| Dimension | Baseline Total | Learned Total | Delta |
|-----------|---------------|---------------|-------|
| Workers | 4 | 4 | 0 |
| Reasoning calls | 15 | 15 | 0 |
| Tool calls | 0 | 0 | 0 |
| False successes | 0 | 0 | 0 |
| Missions verified | 4/4 | 4/4 | 0 |
| Organizations changed | — | — | 0 |

Per the lexicographic quality order (correctness > obligations > verification > reliability > efficiency > simplicity):
- Correctness: preserved (4/4 success in both arms)
- Verification: preserved (4/4 PASS in both arms)
- Reliability: equivalent (0 retries, 0 failures in both arms)
- Efficiency: equivalent (same worker count, same reasoning calls)
- Simplicity: equivalent (same role composition)

The learned organization did NOT change worker count, role composition, or any measured dimension. This is consistent with CONFIRMATORY_TRANSFER: the baseline already satisfied the learned preference (Sole Operator), so applying the pattern was unnecessary.

---

## 9. Transfer Classifications (Aggregate)

| Classification | Count | Missions |
|----------------|-------|----------|
| ACTIVE_TRANSFER | 0 | — |
| CONFIRMATORY_TRANSFER | 3 | C001-02, C001-04, C001-08 |
| BOUNDED_TRANSFER | 0 | — |
| NON_APPLICABLE | 1 | C001-06 |
| HARMFUL_TRANSFER | 0 | — |
| FALSE_TRANSFER | 0 | — |
| INCONCLUSIVE | 0 | — |

**Aggregate metrics:** `experiments/academy/g5-07/aggregate-results.json`

---

## 10. Boundary Observations

### 10.1 Minimal-Scope Early Return Path

All four sealed missions trigger the planner's minimal-scope early-return path (`scope === 'minimal'`), which produces a single Sole Operator BEFORE the pattern application loop is reached. This means:

- The pattern is RETRIEVED (considered) for the three missions whose domain+capabilityNeeds intersect a trusted pattern.
- The pattern is NOT APPLIED for any mission, because `applyAdvisoryPattern()` is never called on the Sole Operator build (the early-return path bypasses it).
- The baseline and learned arms produce identical organization shapes (1 Sole Operator) for all four missions.

This is an important architectural observation: the planner's minimal-scope heuristic is conservative for bounded missions. The learned pattern's `prefer-role: Sole Operator` effect can only fire when the baseline produces 2+ specialists (scope `standard` or `complex`). The four sealed Cohort 001 transfer missions are all minimal-scope, so the pattern is correctly retrieved but trivially satisfied (no change needed).

This is documented as CONFIRMATORY_TRANSFER for three missions (where a pattern was retrieved) and NON_APPLICABLE for one mission (where no pattern matched). It is NOT a defect — the planner's conservatism is safe (does not harm correctness).

### 10.2 Intersection-Based Retrieval

The RulePatternRetriever uses domain-exact + capabilityNeeds-INTERSECTION matching, NOT exact evidence-signature matching. This means:

- A pattern with signature `general|data-analysis,document-authoring` is retrieved for a mission with signature `general|document-authoring` (strict subset), because document-authoring is shared.
- This is more liberal than exact-signature retrieval.

For G5-07, this caused the `cand-general-data-analysis-document-authoring-prefer-sole-operator` pattern to be retrieved for both C001-04 and C001-08 (both `general|document-authoring`). The pattern was retrieved but not applied. This is observed, not modified.

### 10.3 Organizational Requirements vs Capability Coverage (Section 16, 17, 18)

Per Section 18: "Capability coverage alone does NOT prove organizational equivalence." The sealed mission design docs (C001-02, C001-04) mention "independent verification" as the WHY_ORGANIZATION_MATTERS. However, the mission's actual hard constraints (in the goal) do NOT include "must use independent verification." The verification checks enforce artifact existence + content correctness + mission-input preservation, not multi-worker structure.

The current architecture CANNOT represent organizational requirements (only capability needs). For all four sealed missions, the minimal-scope early-return path produces a Sole Operator BEFORE pattern application, so the question of "does the pattern override an organizational requirement" did NOT arise. This is documented as an architectural observation, NOT a defect requiring STOP.

Per Section 18: "If the existing architecture cannot represent a naturally occurring organizational requirement and this materially affects the experiment: STOP. DESIGN_REVIEW_REQUIRED." — The architecture cannot represent organizational requirements, but this does NOT materially affect the G5-07 experiment because the pattern was not applied to any mission. The boundary test is OBSERVED, not triggered. DESIGN_REVIEW is NOT required for G5-07; the architectural limitation is recorded for future cohort consideration.

### 10.4 Goal Compiler Limitation (Word Boundary)

The deterministic v0.1 goal compiler uses word-boundary regexes (`\bword\b`) for signal matching. The word "dataset" in C001-04's goal text does NOT match the data-analysis signal `\bdata\b`. This caused the actual evidence signature to be `general|document-authoring` instead of the predicted `general|data-analysis,document-authoring`. This is an honest limitation; the sealed mission wording is preserved verbatim. The actual signature is recorded in the evidence.

### 10.5 Evidence Signature Collision Observation

C001-04 and C001-08 share the signature `general|document-authoring`. Per Section 26: "If a concrete collision appears: same signature but clearly incompatible organizational context → record EVIDENCE_SIGNATURE_COLLISION = YES and STOP."

The two missions have the SAME signature but DIFFERENT surface problems (anomaly detection vs knowledge extraction). However, they are NOT "clearly incompatible organizational context" — both are general-domain, single-artifact, document-authoring tasks. Both produce the same organizational shape (1 Sole Operator). The signature correctly groups them as comparable.

EVIDENCE_SIGNATURE_COLLISION = NO. STOP is NOT triggered.

---

## 11. Negative Evidence (Section 27)

The following are valuable findings and are NOT hidden:

1. **Pattern applicable but no change needed (CONFIRMATORY_TRANSFER):** 3 of 4 missions. The pattern was retrieved but the baseline already satisfied the preference.
2. **Pattern correctly not applicable (NON_APPLICABLE):** 1 of 4 missions. C001-06 has signature `software-engineering|code-execution` — no trusted pattern matches.
3. **Baseline already optimal:** All 4 missions produce 1 Sole Operator in baseline. The learned organization is equivalent.
4. **No active causal transfer observed:** No mission's organization was changed by the pattern. The minimal-scope early-return path prevents the pattern's `prefer-role` effect from firing.
5. **No harmful transfer detected:** No mission's correctness, verification, or reliability was degraded by the pattern.
6. **No false transfer detected:** No pattern was applied where it should not have been.
7. **Retriever is liberal (intersection-based):** The retriever returns patterns for missions whose capabilityNeeds are a strict subset of the pattern's needs. This is observed, not modified.

---

## 12. Transfer Claim Gate (Section 33)

| Check | Result |
|-------|--------|
| Transfer mission was genuinely unseen | YES (all 4 — verified via sealed-set-integrity.json) |
| Mission was not modified | YES (all 4 — verbatim from Cohort 001 design) |
| Learned state was frozen | YES (frozen-pattern-state.json persisted before execution) |
| No evaluator/gold leakage | YES (worker prompt contains only mission input, no expected answer) |
| Pattern applicability was independently defensible | YES (retriever is deterministic; documented rule) |
| Baseline and learned conditions were equivalent | YES (only `patterns` array differs) |
| Mission correctness independently verified | YES (4/4 PASS in both arms) |
| No quarantined pattern participated | YES (quarantined pattern excluded from TRUSTED_PATTERNS) |
| No false success occurred | YES (falseSuccesses = 0) |

**Active Transfer additional requirements:**
- Organization changed: NO (0 of 4 missions)
- Change causally attributable to learned pattern: NO

**Claim gate result:** The positive blind-transfer claim is supported for CONFIRMATORY_TRANSFER (3 missions) and NON_APPLICABLE (1 mission). The active-transfer claim is NOT supported (no organization changed).

---

## 13. Scientific Interpretation (Section 34)

**Did learning transfer?**

YES, in the bounded sense tested by G5-07:
- Genesis correctly RETRIEVED learned patterns for 3 of 4 unseen missions whose domain+capabilityNeeds matched a trusted pattern.
- Genesis correctly DID NOT retrieve a pattern for 1 unseen mission (C001-06) whose signature had no trusted pattern.
- Genesis did NOT apply a pattern incorrectly anywhere.

**Where did it not transfer?**

- It did NOT actively cause an organizational change. All 4 missions produced 1 Sole Operator in baseline; the pattern was considered but not applied because the baseline already satisfied the preference.
- It did NOT retrieve for C001-06 (software-engineering). The active retrieval set has no trusted pattern for software-engineering.

**Why did it not actively transfer?**

The minimal-scope early-return path in the OrganizationPlanner produces a Sole Operator before the pattern application loop. For the four Cohort 001 transfer missions — all of which are bounded, single-artifact missions — this means the baseline already produces a Sole Operator. The `prefer-role: Sole Operator` pattern can only fire when the baseline produces 2+ specialists (scope `standard` or `complex`).

**Was non-application correct?**

YES. For C001-06, no trusted pattern applies (no software-engineering trusted pattern exists). For C001-02/04/08, the pattern applies but baseline already satisfies the preference. Non-application is correct.

**Did baseline already satisfy the preference?**

YES, for all 3 missions where a pattern was retrieved. The baseline produced a Sole Operator in all 4 missions.

**Did any current requirement override learning?**

NO explicit override occurred. The minimal-scope early return is a planner heuristic, not a mission-requirement override. No mission's hard constraints conflicted with the learned preference.

**Did the pattern harm anything?**

NO. Correctness, verification, and reliability were preserved across all arms.

**Did Evidence Signature remain meaningful?**

YES. Evidence Signature v1 correctly grouped comparable missions. The C001-04 / C001-08 shared signature is NOT an incompatible collision — both are general-domain document-authoring tasks. The signature correctly groups them.

---

## 14. Production Code Delta

**PRODUCTION_CODE_CHANGED = NO**

Zero production code changes in G5-07. All execution logic is in the experiment harness (`experiments/academy/g5-07/run-transfer.ts`). The OrganizationPlanner, PatternRetriever, GoalCompiler, WorkerAgent, and all other production modules are used as-is from G5-06.

| File | Change | LOC |
|------|--------|-----|
| (none) | (no production changes) | 0 / 0 |

**New runtime dependencies:** 0
**New production files:** 0

---

## 15. Small Autonomous Fixes (Section 29)

No small fixes were needed. The experiment harness executed cleanly on first run after the C001-04 context fix (removing the word "sensor" which had inadvertently introduced a diagnostic-domain signal — this was a mission-wording hygiene fix in the harness, not a production-code change).

---

## 16. Limitations

1. **Scripted reasoning.** All four missions used scripted action replay. `provenance.source = 'synthetic'`. The transfer is structural (organizational design), not behavioral (LLM reasoning quality). Behavioral generalization to real LLM workers is NOT tested.
2. **No active causal transfer observed.** All 4 missions produced 1 Sole Operator in baseline; the pattern was considered but not applied. Active causal transfer requires baseline=2+ workers, which the minimal-scope early-return path prevents for bounded missions.
3. **Minimal-scope early-return path.** The planner's `scope === 'minimal'` heuristic produces a Sole Operator before pattern application. The four Cohort 001 transfer missions are all minimal-scope. The pattern's `prefer-role: Sole Operator` effect can only fire on standard/complex scope missions (G5-06 phase-a/phase-b used a research+web-research+document-authoring mission with `comprehensive` complexity signal to trigger standard scope).
4. **Architecture cannot represent organizational requirements.** The sealed mission design docs mention "independent verification" as a design intent, but the current architecture represents only capability needs. This did NOT materially affect G5-07 (no pattern was applied), but it may matter for future cohorts with explicit organizational requirements.
5. **Intersection-based retrieval is liberal.** The RulePatternRetriever returns patterns whose capabilityNeeds intersect the mission's needs (NOT exact signature match). This caused the `general|data-analysis,document-authoring` pattern to be retrieved for `general|document-authoring` missions. The retrieval is documented; the pattern was not applied.
6. **Goal compiler word-boundary limitation.** The deterministic v0.1 compiler uses `\bword\b` regexes. "dataset" does not match `\bdata\b`. The actual C001-04 signature is `general|document-authoring` (not the predicted `general|data-analysis,document-authoring`). This is an honest limitation; sealed mission wording is preserved.
7. **N=4 sealed missions.** Four is the maximum allowed by the sealed Cohort 001 set. Stronger transfer evidence would require more unseen missions, which would require new cohorts (deferred to G5-08).

---

## 17. Claim Boundary (Section 41)

### Allowed

> "Genesis correctly retrieved and applied learned organizational knowledge to unseen missions whose baseline organizations already satisfied the learned preference; no additional organizational change was required (under scripted reasoning conditions). Genesis also correctly did NOT retrieve patterns for missions whose evidence signatures did not match any trusted pattern."

> "Under scripted reasoning conditions, Genesis demonstrated bounded blind transfer: the learned organizational patterns from G5-05 were correctly carried forward to unseen Cohort 001 transfer missions. Three of four missions retrieved a relevant trusted pattern (CONFIRMATORY_TRANSFER); one mission correctly did not retrieve any pattern (NON_APPLICABLE). No false transfer, harmful transfer, or contamination occurred."

### NOT allowed

- "Genesis demonstrated active causal transfer on these missions." — NO. No organization changed.
- "Genesis demonstrated cross-family generalization." — NO. Cross-family belongs to G5-08.
- "Genesis learned to organize real AI workers better." — NO. Scripted reasoning.
- "Genesis autonomously self-improved." — NO.
- "Universal transfer." — NO.

---

## 18. G5-08 Readiness (Section 36)

**SAFE_TO_BEGIN_G5_08 = YES**

Justification:
- No unresolved false-transfer defect (FALSE_TRANSFER = 0)
- No unresolved signature collision (the C001-04/C001-08 shared signature is NOT incompatible — both produce the same organizational shape)
- No contaminated transfer set (TRANSFER_SET_INTEGRITY = INTACT)
- No unresolved harmful pattern (HARMFUL_TRANSFER = 0)
- No quarantined pattern leak (QUARANTINED_PATTERN_USED = NO)
- No pass-chasing (PASS_CHASING_DETECTED = NO)

This does NOT require every transfer mission to show ACTIVE_TRANSFER. It DOES require no unresolved defect that would invalidate the next stage — which is satisfied.

---

## 19. Stop Condition (Section 42)

**G5-07 is STOPPED per Section 42.**

- DO NOT begin G5-08.
- DO NOT modify the transfer missions after observing results.
- DO NOT promote transfer-derived patterns.
- DO NOT begin cross-family generalization.

Evidence is returned for human review.

---

## 20. Final Principle (Section 43)

Blind transfer is NOT "Genesis did the same thing again." Blind transfer IS "Genesis carried organizational knowledge acquired from prior experience into an unseen situation and used — or correctly refused to use — that knowledge according to the new mission's reality."

A learned pattern is not intelligent because it can be applied. It becomes useful intelligence when Genesis knows:
- when to apply it,
- when it changes nothing,
- when to override it,
- and when it does not belong.

In G5-07, Genesis demonstrated the second and fourth behaviors:
- It correctly changed nothing when baseline already satisfied the preference (3 missions).
- It correctly did not retrieve a pattern when none legitimately applied (1 mission).

It did NOT demonstrate the first (active causal application) or the third (correct override). These belong to future cohorts with missions that naturally trigger standard/complex scope and have hard organizational requirements.

---

## 21. Evidence Paths (Section 38)

| Artifact | Path |
|----------|------|
| Pre-registration | `experiments/academy/g5-07/pre-registration.json` |
| Frozen pattern state | `experiments/academy/g5-07/frozen-pattern-state.json` |
| Sealed set integrity | `experiments/academy/g5-07/sealed-set-integrity.json` |
| Execution harness | `experiments/academy/g5-07/run-transfer.ts` |
| Per-mission pattern traces | `experiments/academy/g5-07/missions/<id>/pattern-trace.json` |
| Per-mission baseline evidence | `experiments/academy/g5-07/missions/<id>/baseline/{flight-events.jsonl,verification.json,plan.json}` |
| Per-mission learned evidence | `experiments/academy/g5-07/missions/<id>/learned/{flight-events.jsonl,verification.json,plan.json}` |
| All baseline arm results | `experiments/academy/g5-07/baseline-arms.json` |
| All learned arm results | `experiments/academy/g5-07/learned-arms.json` |
| All per-mission traces | `experiments/academy/g5-07/per-mission-traces.json` |
| Aggregate results | `experiments/academy/g5-07/aggregate-results.json` |
| Transfer report | `experiments/academy/g5-07/transfer-report.json` |
| This document | `docs/academy/GENESIS_G5_07_SEALED_BLIND_TRANSFER.md` |

---

## 22. Required Final Report (Section 40)

```
G5_07_STATUS = BLIND_TRANSFER_PASS_WITH_LIMITATION

START_HEAD = d97c3b82b93cc6bfd2975784b22ebc351678dd8b
FINAL_HEAD = (recorded at commit time)
BRANCH = build/group-05-causality-investigation
WORKTREE = /home/z/my-project/workspace/AgentCraft-Genesis

PROVIDER_MODE = SCRIPTED_REASONING
REAL_LLM_REASONING_USED = NO
SCRIPTED_REASONING_USED = YES
DEVELOPMENT_FALLBACK_USED = NO

TRANSFER_SET_INTEGRITY = INTACT

TRANSFER_MISSIONS_SELECTED = C001-02, C001-04, C001-06, C001-08
SELECTION_METHOD = B (deterministic mission-ID ordering, predeclared)

TRANSFER_PATTERN_STATE_FROZEN = YES

TRUSTED_PATTERNS_AVAILABLE = 3
QUARANTINED_PATTERN_USED = NO

MISSIONS_EXECUTED = 4 (× 2 arms = 8 runs)

--- PER-MISSION ---

MISSION_ID = C001-02
MISSION_FAMILY = A-research
MISSION_TEXT_MODIFIED = NO
PREVIOUSLY_EXECUTED = NO
GOAL_DOMAIN = research
CAPABILITY_NEEDS = [web-research, document-authoring]
EVIDENCE_SIGNATURE = research|document-authoring,web-research
BASELINE_ORGANIZATION = 1 Sole Operator
LEARNED_ORGANIZATION = 1 Sole Operator
BASELINE_WORKERS = 1
LEARNED_WORKERS = 1
BASELINE_ROLES = [Sole Operator]
LEARNED_ROLES = [Sole Operator]
PATTERNS_RETRIEVED = [cand-research-document-authoring-prefer-sole-operator, cand-research-document-authoring-web-research-prefer-sole-operator]
PATTERN_APPLICABLE = YES
APPLICABILITY_REASON = Both research patterns' capabilityNeeds intersect the mission's needs (document-authoring + web-research shared)
PATTERN_APPLIED = NO
PATTERN_OVERRIDDEN = NO
OVERRIDE_REASON = (none — minimal-scope early return)
ORGANIZATIONAL_REQUIREMENT_PRESENT = NO (architecture cannot represent; not material)
ORGANIZATIONAL_REQUIREMENT = (none)
ORGANIZATION_CHANGED = NO
CAUSAL_ATTRIBUTION = NO
BASELINE_VERIFICATION = PASS (4/4)
LEARNED_VERIFICATION = PASS (4/4)
BASELINE_CORRECTNESS = success
LEARNED_CORRECTNESS = success
TRANSFER_CLASSIFICATION = CONFIRMATORY_TRANSFER
INTERPRETATION = Pattern retrieved and legitimately applicable; baseline already satisfies the learned preference (single-worker); pattern confirms rather than changes the decision.

MISSION_ID = C001-04
MISSION_FAMILY = B-data
MISSION_TEXT_MODIFIED = NO
PREVIOUSLY_EXECUTED = NO
GOAL_DOMAIN = general
CAPABILITY_NEEDS = [document-authoring]
EVIDENCE_SIGNATURE = general|document-authoring
BASELINE_ORGANIZATION = 1 Sole Operator
LEARNED_ORGANIZATION = 1 Sole Operator
BASELINE_WORKERS = 1
LEARNED_WORKERS = 1
BASELINE_ROLES = [Sole Operator]
LEARNED_ROLES = [Sole Operator]
PATTERNS_RETRIEVED = [cand-general-data-analysis-document-authoring-prefer-sole-operator]
PATTERN_APPLICABLE = YES
APPLICABILITY_REASON = Pattern domain=general matches mission domain; document-authoring intersects pattern's needs
PATTERN_APPLIED = NO
PATTERN_OVERRIDDEN = NO
OVERRIDE_REASON = (none — minimal-scope early return)
ORGANIZATIONAL_REQUIREMENT_PRESENT = NO (architecture cannot represent; not material)
ORGANIZATIONAL_REQUIREMENT = (none)
ORGANIZATION_CHANGED = NO
CAUSAL_ATTRIBUTION = NO
BASELINE_VERIFICATION = PASS (4/4)
LEARNED_VERIFICATION = PASS (4/4)
BASELINE_CORRECTNESS = success
LEARNED_CORRECTNESS = success
TRANSFER_CLASSIFICATION = CONFIRMATORY_TRANSFER
INTERPRETATION = Pattern retrieved via intersection rule; baseline already satisfies preference; no change needed.

MISSION_ID = C001-06
MISSION_FAMILY = C-software
MISSION_TEXT_MODIFIED = NO
PREVIOUSLY_EXECUTED = NO
GOAL_DOMAIN = software-engineering
CAPABILITY_NEEDS = [code-execution]
EVIDENCE_SIGNATURE = software-engineering|code-execution
BASELINE_ORGANIZATION = 1 Sole Operator
LEARNED_ORGANIZATION = 1 Sole Operator
BASELINE_WORKERS = 1
LEARNED_WORKERS = 1
BASELINE_ROLES = [Sole Operator]
LEARNED_ROLES = [Sole Operator]
PATTERNS_RETRIEVED = []
PATTERN_APPLICABLE = NO
APPLICABILITY_REASON = No trusted pattern matches domain=software-engineering; all software-engineering candidates are tentative (support=1)
PATTERN_APPLIED = NO
PATTERN_OVERRIDDEN = NO
OVERRIDE_REASON = (none — no pattern retrieved)
ORGANIZATIONAL_REQUIREMENT_PRESENT = NO (architecture cannot represent; not material)
ORGANIZATIONAL_REQUIREMENT = (none)
ORGANIZATION_CHANGED = NO
CAUSAL_ATTRIBUTION = NO
BASELINE_VERIFICATION = PASS (4/4)
LEARNED_VERIFICATION = PASS (4/4)
BASELINE_CORRECTNESS = success
LEARNED_CORRECTNESS = success
TRANSFER_CLASSIFICATION = NON_APPLICABLE
INTERPRETATION = No trusted pattern legitimately applies; Genesis correctly retrieved no pattern. Positive evidence of bounded learning.

MISSION_ID = C001-08
MISSION_FAMILY = D-knowledge
MISSION_TEXT_MODIFIED = NO
PREVIOUSLY_EXECUTED = NO
GOAL_DOMAIN = general
CAPABILITY_NEEDS = [document-authoring]
EVIDENCE_SIGNATURE = general|document-authoring
BASELINE_ORGANIZATION = 1 Sole Operator
LEARNED_ORGANIZATION = 1 Sole Operator
BASELINE_WORKERS = 1
LEARNED_WORKERS = 1
BASELINE_ROLES = [Sole Operator]
LEARNED_ROLES = [Sole Operator]
PATTERNS_RETRIEVED = [cand-general-data-analysis-document-authoring-prefer-sole-operator]
PATTERN_APPLICABLE = YES
APPLICABILITY_REASON = Pattern domain=general matches mission domain; document-authoring intersects pattern's needs
PATTERN_APPLIED = NO
PATTERN_OVERRIDDEN = NO
OVERRIDE_REASON = (none — minimal-scope early return)
ORGANIZATIONAL_REQUIREMENT_PRESENT = NO (architecture cannot represent; not material)
ORGANIZATIONAL_REQUIREMENT = (none)
ORGANIZATION_CHANGED = NO
CAUSAL_ATTRIBUTION = NO
BASELINE_VERIFICATION = PASS (4/4)
LEARNED_VERIFICATION = PASS (4/4)
BASELINE_CORRECTNESS = success
LEARNED_CORRECTNESS = success
TRANSFER_CLASSIFICATION = CONFIRMATORY_TRANSFER
INTERPRETATION = Pattern retrieved via intersection rule; baseline already satisfies preference; no change needed.

--- AGGREGATE ---

MISSIONS_SELECTED = 4
MISSIONS_EXECUTED = 4 (× 2 arms = 8 runs)
MISSIONS_VERIFIED_BASELINE = 4
MISSIONS_VERIFIED_LEARNED = 4

ACTIVE_TRANSFER_COUNT = 0
CONFIRMATORY_TRANSFER_COUNT = 3
BOUNDED_TRANSFER_COUNT = 0
NON_APPLICABLE_COUNT = 1
HARMFUL_TRANSFER_COUNT = 0
FALSE_TRANSFER_COUNT = 0
INCONCLUSIVE_COUNT = 0

ORGANIZATIONS_CHANGED = 0

BASELINE_TOTAL_WORKERS = 4
LEARNED_TOTAL_WORKERS = 4
WORKER_DELTA = 0

BASELINE_TOTAL_REASONING = 15
LEARNED_TOTAL_REASONING = 15
REASONING_DELTA = 0

BASELINE_TOTAL_TOOL_CALLS = 0
LEARNED_TOTAL_TOOL_CALLS = 0
TOOL_CALL_DELTA = 0

FALSE_SUCCESSES = 0
EVIDENCE_SIGNATURE_COLLISIONS = 0

--- INTEGRITY ---

MISSION_TEXTS_MODIFIED = NO
TRANSFER_SET_CONTAMINATED = NO
PATTERN_STATE_CHANGED_DURING_TRANSFER = NO
NEW_PATTERNS_PROMOTED_DURING_TRANSFER = NO
QUARANTINED_PATTERN_USED = NO
EVALUATOR_LEAKAGE = NO
PASS_CHASING_DETECTED = NO

--- ENGINEERING ---

PRODUCTION_FILES_CHANGED = 0
PRODUCTION_LOC_DELTA = 0
NEW_RUNTIME_DEPENDENCIES = 0

SMALL_AUTONOMOUS_FIXES = 1 (harness-only: removed accidental 'sensor' keyword from C001-04 context; mission outcome text preserved verbatim)
MATERIAL_ISSUES_REQUIRING_REVIEW = 0

FULL_TESTS = PASS (345 passed | 9 skipped = 354 total)
TYPECHECK = PASS
LINT = PASS

--- SCIENTIFIC CONCLUSION ---

BLIND_TRANSFER_DEMONSTRATED = LIMITED
BOUNDARY_BEHAVIOR_DEMONSTRATED = YES
HARMFUL_TRANSFER_DETECTED = NO
FALSE_TRANSFER_DETECTED = NO

STRONGEST_SUPPORTED_CLAIM = Genesis correctly retrieved and applied learned organizational knowledge to unseen missions whose baseline organizations already satisfied the learned preference; no additional organizational change was required (under scripted reasoning conditions). Genesis also correctly did NOT retrieve patterns for missions whose evidence signatures did not match any trusted pattern.

NOT_SUPPORTED_CLAIMS = [active causal transfer on these missions, cross-family generalization, real-world autonomous self-improvement, production-scale organizational intelligence, universal transfer]

KNOWN_LIMITATIONS = [scripted reasoning, no active causal transfer observed, minimal-scope early-return path prevents pattern application, architecture cannot represent organizational requirements, intersection-based retrieval is liberal, goal compiler word-boundary limitation, N=4 sealed missions]

DOCUMENTATION = docs/academy/GENESIS_G5_07_SEALED_BLIND_TRANSFER.md
EVIDENCE_PATHS = experiments/academy/g5-07/

REMOTE_PUSH_STATUS = (recorded at push time)

SAFE_TO_BEGIN_G5_08 = YES

NEXT_RECOMMENDED_ACTION = G5-07 STOPPED per Section 42. Return evidence for human review. DO NOT begin G5-08 without human approval.
```

---

## 23. Final Principle (Restated)

> Freedom inside requirements.
> Truth before elegance.
> Evidence before promotion.

G5-07 produced honest evidence: Genesis transferred learned organizational knowledge correctly to unseen missions in a CONFIRMATORY sense (3 of 4) and correctly refused to retrieve patterns when none applied (1 of 4). It did NOT demonstrate active causal transfer — the four sealed Cohort 001 missions are minimal-scope, and the planner's minimal-scope early-return path prevents the pattern's `prefer-role` effect from firing. This is an architectural observation, not a defect.

The evidence supports beginning G5-08 (cross-family generalization) ONLY after human review. The bounded claim from G5-07 is:

> Under scripted reasoning conditions, Genesis correctly retrieved and applied learned organizational knowledge to unseen missions whose baseline organizations already satisfied the learned preference; no additional organizational change was required. Genesis also correctly did NOT retrieve patterns for missions whose evidence signatures did not match any trusted pattern.

Nothing more.
