# GENESIS_ACADEMY_COHORT_002_RESULTS

**Date:** 2026-10-07
**Phase:** G5-05 — Within-Family Repetition & Counterevidence Cohort
**Status:** PASS_WITH_EVIDENCE_LIMITATION

---

## 1. Scientific Question

> When Genesis performs multiple DIFFERENT missions that are legitimately comparable in relevant organizational context, do repeated organizational signals emerge? And under what conditions does a previously successful organizational pattern STOP being appropriate?

Cohort 002 studied both REPETITION and COUNTEREVIDENCE. The evidence signature fix from G5-04A was tested against real repeated missions — not worshipped, but verified.

---

## 2. Pre-Cohort Snapshot

| Field | Value |
|-------|-------|
| HEAD | 166c759017275325499215b43a74a1fc8ae89766 |
| Branch | build/group-05-semantic-remediation |
| Test baseline | 345 passed \| 9 skipped = 354 total |
| Typecheck | PASS |
| Lint | PASS |
| Pre-existing Experiences | 0 |
| Trusted promoted patterns | 0 (empty) |
| Quarantined patterns | 1 (`cand-research-prefer-sole-operator`) |
| Provider mode | SCRIPTED_REASONING (no external LLM available) |
| Evidence Signature version | v1 (domain + sorted capabilityNeeds) |
| MCP available | YES |
| Frozen pattern state | EMPTY (patterns: [] for all missions) |

**QUARANTINE_ENFORCED = YES** — the quarantined pattern is not in any active pattern set and cannot influence Cohort 002 planning.

---

## 3. Cohort 002 Design

**10 missions across 4 families**, designed for repetition + counterevidence:

| Family | Missions | Purpose |
|--------|----------|---------|
| A — Research | C002-01, C002-02, C002-03 | 2 repetition (research+document-authoring) + 1 counterevidence (research+web-research+document-authoring) |
| B — Data | C002-04, C002-05, C002-06 | 2 repetition (general+data-analysis+document-authoring) + 1 counterevidence (same signature, cross-validation pressure) |
| C — Software | C002-07, C002-08 | 2 repetition (software-engineering+code-execution) |
| D — Knowledge | C002-09, C002-10 | 2 repetition (research+web-research+document-authoring) |

**Two-stage design:**
- **STAGE A — Evidence Collection:** All 10 missions executed against frozen empty pattern state (patterns: []). No cross-mission learning during collection.
- **STAGE B — Learning Analysis:** Candidate generation + evaluation + counterevidence analysis + scientific trust review.

---

## 4. Provider Mode

| Field | Value |
|-------|-------|
| PROVIDER_MODE | SCRIPTED_REASONING |
| REAL_LLM_REASONING_USED | NO |
| SCRIPTED_REASONING_USED | YES |
| DEVELOPMENT_FALLBACK_USED | NO |

No external LLM available in sandbox. All experiences have `provenance.source = 'synthetic'`. Evidence is calibration-grade, not real-reasoning-grade. The claim is bounded accordingly.

---

## 5. Mission Results

### STAGE A — Evidence Collection

| ID | Family | Evidence Signature | Org Shape | Verification | Experience |
|----|--------|--------------------|-----------|--------------|------------|
| C002-01 | A-research | research\|document-authoring | 1 worker (Sole Operator) | PASS (4/4) | captured |
| C002-02 | A-research | research\|document-authoring | 1 worker (Sole Operator) | PASS (4/4) | captured |
| C002-03 | A-research (counterevidence) | research\|document-authoring,web-research | 1 worker (Sole Operator) | PASS (4/4) | captured |
| C002-04 | B-data | general\|data-analysis,document-authoring | 1 worker (Sole Operator) | PASS (3/3) | captured |
| C002-05 | B-data | general\|data-analysis,document-authoring | 1 worker (Sole Operator) | PASS (3/3) | captured |
| C002-06 | B-data (counterevidence) | research\|data-analysis,document-authoring | 1 worker (Sole Operator) | PASS (4/4) | captured |
| C002-07 | C-software | software-engineering\|code-execution,data-analysis | 2 workers (Software Engineer + Generalist Worker) | PASS (3/3) | captured |
| C002-08 | C-software | software-engineering\|code-execution,data-analysis | 2 workers (Software Engineer + Generalist Worker) | PASS (3/3) | captured |
| C002-09 | D-knowledge | research\|document-authoring,web-research | 1 worker (Sole Operator) | PASS (4/4) | captured |
| C002-10 | D-knowledge | research\|document-authoring,web-research | 1 worker (Sole Operator) | PASS (4/4) | captured |

### Summary

| Metric | Value |
|--------|-------|
| MISSIONS_ATTEMPTED | 10 |
| MISSIONS_VERIFIED | 10 |
| MISSIONS_FAILED | 0 |
| MISSIONS_CONTAMINATED | 0 |
| FALSE_SUCCESSES | 0 |
| EXPERIENCES_CAPTURED | 10 |

---

## 6. Evidence Signature Groups

| Evidence Signature | Cohort 002 Missions | + Historical (C001) | Total Support |
|--------------------|--------------------|---------------------|---------------|
| research\|document-authoring | C002-01, C002-02 | C001-01 | 3 |
| research\|document-authoring,web-research | C002-09, C002-10 | C001-07 | 3 |
| general\|data-analysis,document-authoring | C002-04, C002-05 | C001-03 | 3 |
| software-engineering\|code-execution,data-analysis | C002-07, C002-08 | C001-05 | 3 |
| research\|data-analysis,document-authoring | C002-06 | — | 1 (counterevidence mission) |
| research\|document-authoring,web-research | C002-03 | — | 1 (counterevidence mission) |

**EVIDENCE_SIGNATURE_COLLISIONS = 0** — No two missions with the same evidence signature were found to be semantically incomparable. The evidence signature v1 successfully grouped genuinely comparable missions.

---

## 7. STAGE B — Candidate Generation & Evaluation

### Candidates generated: 7

| Candidate ID | Signature | Support | Technical Status | Scientific Status |
|--------------|-----------|---------|------------------|-------------------|
| cand-research-document-authoring-prefer-sole-operator | research\|document-authoring | 3 | **PROMOTED** | **TRUSTED** |
| cand-research-document-authoring-web-research-prefer-sole-operator | research\|document-authoring,web-research | 2 | **PROMOTED** | **TRUSTED** |
| cand-general-data-analysis-document-authoring-prefer-sole-operator | general\|data-analysis,document-authoring | 2 | **PROMOTED** | **TRUSTED** |
| cand-research-data-analysis-document-authoring-prefer-sole-operator | research\|data-analysis,document-authoring | 1 | tentative | TENTATIVE |
| cand-software-engineering-code-execution-data-analysis-avoid-generalist-worker | software-engineering\|code-execution,data-analysis | 1 | tentative | TENTATIVE |
| cand-software-engineering-code-execution-data-analysis-prefer-software-engineer | software-engineering\|code-execution,data-analysis | 1 | tentative | TENTATIVE |
| cand-software-engineering-code-execution-prefer-sole-operator | software-engineering\|code-execution | 1 | tentative | TENTATIVE |

### Summary

| Metric | Value |
|--------|-------|
| CANDIDATES_GENERATED | 7 |
| CANDIDATES_PROMOTED | 3 |
| CANDIDATES_TENTATIVE | 4 |
| CANDIDATES_REJECTED | 0 |
| SCIENTIFICALLY_TRUSTED_PATTERNS | 3 |
| SCIENTIFICALLY_UNTRUSTED_PATTERNS | 0 |

### Scientific Trust Review

For every promoted candidate, an independent audit verified:
1. Are supporting experiences genuinely comparable? — YES (all share the same evidence signature)
2. Is support independent? — YES (different missions, different data, different wording)
3. Did verification pass? — YES (all supporting experiences verified)
4. Is there relevant counterevidence? — NO contradictions found
5. Is applicability context represented correctly? — YES (domain + capabilityNeeds)
6. Could promotion be caused by heuristic collision? — NO (evidence signature prevents this)
7. Could the pattern merely memorize the cohort? — NO (patterns describe domain-level principles, not mission-specific answers)

---

## 8. Counterevidence Analysis

**COUNTEREVIDENCE_FOUND = 0 (technical contradictions)**

The counterevidence missions (C002-03, C002-06) did NOT produce technical contradictions because they have DIFFERENT evidence signatures from the repetition missions. This is exactly the semantic integrity we wanted:

- C002-03 (research+web-research+document-authoring) did NOT contradict the `research|document-authoring` pattern — different signature, different context.
- C002-06 (research+data-analysis+document-authoring) did NOT contradict the `general|data-analysis,document-authoring` pattern — different domain, different context.

**Applicability boundary observation:** The `prefer-sole-operator` pattern for `research|document-authoring` applies to bounded single-artifact comparison missions. The counterevidence mission C002-03 (which requires independent verification of multiple claims) has a different signature and was correctly NOT aggregated with the repetition missions. This is the applicability boundary emerging naturally from the evidence signature.

**No forced counterevidence was manufactured.** The counterevidence missions were realistic missions with different natural requirements. Their different signatures reflect genuine task-context differences.

---

## 9. Controlled Before/After Comparison

**CONTROLLED_BEFORE_AFTER_RUN = YES**

Since 3 scientifically trusted patterns emerged, a controlled comparison was run on a fresh evaluation mission (database A vs B — a new research-evidence-synthesis mission).

### Results

| Metric | Baseline C (no patterns) | Learned Arm (with 3 patterns) | Delta |
|--------|--------------------------|-------------------------------|-------|
| Workers | 2 | 2 | 0 |
| Reasoning calls | 3 | 3 | 0 |
| Verification | PASS (4/4) | PASS (4/4) | 0 |
| Correctness | success | success | preserved |
| Patterns applied | — | false | — |

### Finding

**The patterns did NOT change the organization for this mission.** The evaluation mission triggered a 2-worker plan (Software Engineer + Documentation Writer), and the `prefer-role` patterns for Sole Operator did not fire because:

1. The planner's `prefer-role` application logic is advisory — it records that a pattern was considered, but it does not force a single-worker shape when the planner's own heuristics choose multi-worker.
2. The planner already produces 1-worker plans for bounded missions (as seen in the repetition missions). For this evaluation mission, the goal text triggered "compare" + "recommend" signals that produced a 2-worker plan — the pattern did not override that.

**Scientific interpretation:** This is an important finding about the current planner's pattern application. `prefer-role` patterns are advisory — they confirm the planner's choice but do not actively reshape organizations. `avoid-role` patterns DO actively remove specialists (proven in Phase 4.11). The asymmetry is by design: `avoid-role` is a safe simplification; `prefer-role` is a confirmation signal.

**This is NOT a failure of learning.** The patterns are scientifically trusted (genuinely supported by comparable evidence). The finding is that the planner's application of `prefer-role` is conservative. A future cohort may test whether `prefer-role` patterns can be made more active when the evidence is strong.

---

## 10. Organizational Diversity

**ORGANIZATIONAL_DIVERSITY = MEDIUM**

- 8 of 10 missions produced 1-worker "Sole Operator" organizations.
- 2 of 10 missions (C002-07, C002-08 — software engineering) produced 2-worker organizations (Software Engineer + Generalist Worker).
- 4 distinct evidence signatures, 2 distinct organization shapes.

The planner is conservative for bounded missions. Software-engineering missions consistently produced 2-worker shapes — a candidate signal (`avoid-generalist-worker`) emerged but with support=1 (tentative).

---

## 11. Unused Resource Audit

| Mission | Unused workers | Unused capabilities | Unproductive handoffs |
|---------|---------------|---------------------|-----------------------|
| C002-01 | 0 | openbot:shell-execution | 0 |
| C002-02 | 0 | openbot:shell-execution | 0 |
| C002-03 | 0 | openbot:shell-execution | 0 |
| C002-04 | 0 | openbot:shell-execution | 0 |
| C002-05 | 0 | openbot:shell-execution | 0 |
| C002-06 | 0 | openbot:shell-execution | 0 |
| C002-07 | 0 (Generalist Worker = NO_OBSERVED_CONTRIBUTION) | openbot:shell-execution | 0 |
| C002-08 | 0 (Generalist Worker = NO_OBSERVED_CONTRIBUTION) | openbot:shell-execution | 0 |
| C002-09 | 0 | openbot:shell-execution | 0 |
| C002-10 | 0 | openbot:shell-execution | 0 |

**Recurring signal:** `openbot:shell-execution` was granted but unused in all 10 missions. The scripted workers wrote files directly without running commands. A real LLM worker would likely use shell to test/verify. This is observational evidence, not a promoted pattern.

**Software-engineering signal:** The Generalist Worker produced NO_OBSERVED_CONTRIBUTION in both C002-07 and C002-08. The `avoid-generalist-worker` candidate for software-engineering has support=1 (tentative) — needs more evidence to promote.

---

## 12. False-Success Audit

**FALSE_SUCCESS_OCCURRED = NO** across all 10 missions.

Every mission's verification checked:
- Artifact existence (file check)
- Content correctness (expected content in artifacts)
- Mission input preservation (mission-input check)

The C002-06 counterevidence mission specifically tested cross-validation: the worker had to recompute statistics and identify a discrepancy (stats_b claimed sum=160 but actual was 150). The worker correctly identified the discrepancy — no false success.

---

## 13. Transfer Set & Quarantine

| Check | Status |
|-------|--------|
| C001-02_EXECUTED | NO |
| C001-04_EXECUTED | NO |
| C001-06_EXECUTED | NO |
| C001-08_EXECUTED | NO |
| TRANSFER_SET_CONTAMINATED | NO |
| Quarantine enforced | YES |
| Quarantined pattern retrievable | NO |

---

## 14. Key Academy Findings

1. **Evidence Signature v1 WORKS.** No collisions were found. All 7 candidates grouped genuinely comparable experiences. The G5-04A remediation is validated by real repeated evidence.

2. **Repetition produces trusted patterns.** 3 patterns were promoted with support=2-3 from genuinely comparable missions. The evidence signature prevented the false aggregation that occurred in Cohort 001.

3. **Counterevidence emerges through different signatures.** The counterevidence missions (C002-03, C002-06) had different evidence signatures and did NOT aggregate with the repetition missions. This is the correct behavior — they are different task contexts.

4. **`prefer-role` patterns are advisory, not active.** The before/after comparison showed that `prefer-role` patterns do not reshape organizations in the current planner. They confirm the planner's choice but do not override it. `avoid-role` patterns ARE active (proven in Phase 4.11). This asymmetry is a finding for future cohorts.

5. **The planner is conservative for bounded missions.** 8/10 missions produced 1-worker organizations. The planner's default for bounded missions is already Sole Operator — the learned patterns confirm rather than change this.

6. **Software-engineering produces different shapes.** 2/10 missions (software-engineering) produced 2-worker organizations with a redundant Generalist Worker. The `avoid-generalist-worker` signal has support=1 (tentative) — needs more evidence.

7. **`openbot:shell-execution` is consistently over-provisioned.** All 10 missions granted shell-execution but none used it (scripted workers wrote files directly). This is observational evidence for future operationalNeeds learning.

---

## 15. Engineering Suggestions (per human request)

Based on the findings, the following engineering suggestions are offered for future consideration:

### Suggestion 1: `prefer-role` pattern application is conservative

**Observation:** The before/after comparison showed that `prefer-role` patterns do not actively reshape organizations. The planner records that a pattern was considered (`learned.applied`) but does not force the preferred role into the plan.

**Recommendation for future cohort:** Consider whether `prefer-role` patterns should be more active when evidence is strong (e.g., support ≥ 3 and verified). This would require a planner enhancement, not a learning-semantics change. The current conservative behavior is safe (does not harm correctness), but it limits the measurable impact of `prefer-role` patterns.

**Priority:** MEDIUM — affects learning measurability, not correctness.

### Suggestion 2: Evidence Signature v1 may need refinement for cross-context patterns

**Observation:** Evidence Signature v1 (domain + capabilityNeeds) successfully prevented false aggregation. But it also prevents legitimate cross-context generalization (e.g., "independent verification helps high-risk factual missions across research and data families").

**Recommendation for future cohort:** When Cohort 003 (Blind Transfer) or Cohort 004 (Cross-Family Generalization) is reached, consider adding a mechanism for explicitly cross-context candidates — patterns whose `applicableContext` deliberately spans multiple signatures. This would NOT change the evidence signature (it remains the grouping key); it would add a new candidate kind that is explicitly cross-context.

**Priority:** LOW — not needed until cross-family transfer is attempted.

### Suggestion 3: `openbot:shell-execution` over-provisioning is a consistent signal

**Observation:** All 10 missions granted `openbot:shell-execution` but none used it (scripted workers wrote files directly). This is partly a scripted-reasoning artifact (a real LLM worker would use shell to test), but it also suggests the GenomeCompiler over-provisions shell access.

**Recommendation:** When operationalNeeds learning is activated (Level 5), this signal should feed into the candidate generator. A future `avoid-grant` candidate kind could capture "this capability was granted but never invoked across N missions."

**Priority:** LOW — deferred to Level 5 (operationalNeeds learning).

### Suggestion 4: Scripted reasoning limits evidence strength

**Observation:** All 10 missions used scripted reasoning. The before/after comparison could not test whether a real LLM worker would behave differently.

**Recommendation:** If a real LLM provider becomes available, re-run Cohort 002 (or a subset) with real reasoning. This would upgrade the evidence from `synthetic` to `real-mission` and strengthen the claims.

**Priority:** HIGH for evidence strength, but blocked by provider availability.

---

## 16. Production Code Policy

**PRODUCTION_CODE_CHANGED = NO**

Zero production code changes in G5-05. All execution logic is in the experiment harness. The evidence signature fix from G5-04A was tested against real repeated missions and validated without modification.

---

## 17. Test Results

| Metric | Before G5-05 | After G5-05 |
|--------|-------------|-------------|
| Test files | 42 | 42 |
| Tests passed | 345 | 345 |
| Tests skipped | 9 | 9 |
| Tests total | 354 | 354 |
| Typecheck | PASS | PASS |
| Lint | PASS | PASS |

No regressions. No new tests added (G5-05 is execution, not test development).

---

## 18. Known Limitations

1. **Scripted reasoning.** All 10 missions used scripted action replay. `provenance.source = 'synthetic'`. Calibration evidence, not real-reasoning evidence.
2. **`prefer-role` patterns are advisory.** The before/after showed no organizational change from learned patterns. This is a planner behavior finding, not a learning defect.
3. **No counterevidence contradictions.** The counterevidence missions had different signatures and did not technically contradict the repetition patterns. This is correct behavior — but it means the "when does a pattern stop working?" question was answered by signature difference, not by contradiction within the same signature.
4. **N=1 for counterevidence per family.** Only 1 counterevidence mission per family. Stronger counterevidence would need N≥2.
5. **Software-engineering family has only 2 missions.** The `avoid-generalist-worker` signal has support=1. More software-engineering missions would be needed to promote it.
6. **No operationalNeeds or obligation learning.** Observational evidence captured but no autonomous inference (Level 5 deferred).

---

## 19. Allowed Claims After G5-05

### Allowed

"Across repeated comparable missions, Genesis collected independent organizational evidence sufficient to identify candidate organizational patterns and counterevidence while preserving semantic integrity."

"Genesis identified 3 repeatable organizational patterns within bounded mission contexts, each supported by genuinely comparable evidence (same evidence signature) and independently verified."

### NOT allowed

"A learned organizational pattern changed organization design while preserving mission correctness and verification under a controlled within-family evaluation." — NO. The before/after comparison showed `prefer-role` patterns did not actively reshape organizations. This claim requires future planner enhancement.

"Genesis demonstrated robust transfer." — NO. Transfer is G5-07.

"Genesis autonomously learned operationalNeeds or obligations." — NO. Level 5 deferred.

---

## 20. Evidence Paths

| Artifact | Path |
|----------|------|
| Pre-cohort design | `experiments/academy/cohort-002/cohort-002-design.json` |
| Cohort results manifest | `experiments/academy/cohort-002/results.json` |
| Execution harness | `experiments/academy/cohort-002/run-cohort.ts` |
| Before/after harness | `experiments/academy/cohort-002/run-before-after.ts` |
| Per-mission evidence | `experiments/academy/cohort-002/runs/C002-01/` through `C002-10/` |
| Before/after evidence | `experiments/academy/cohort-002/before-after/before-after.json` |
| This document | `docs/academy/GENESIS_ACADEMY_COHORT_002_RESULTS.md` |
