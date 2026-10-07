# GENESIS_G5_04A_SEMANTIC_INTEGRITY

**Date:** 2026-10-07
**Phase:** G5-04A — Semantic Integrity Investigation & Remediation
**Status:** PASS

---

## 1. INCIDENT

**What happened:** During G5-04 (Cohort 001), the Academy executed 4 learning missions across 4 designed families. Two missions from DIFFERENT families accidentally aggregated support=2 for the same context-specific organizational pattern:

- **C001-01** (Family A — Research / Evidence Synthesis): goal text "Compare Option A (solar panels) vs Option B (wind turbines)..." → GoalCompiler classified domain = `research`
- **C001-07** (Family D — Knowledge / Document Work): goal text "Compare doc_a.txt and doc_b.txt..." → GoalCompiler classified domain = `research`

Both missions produced a single "Sole Operator" worker that produced 1 artifact. The `StatisticalCandidateGenerator` grouped them by `domain === 'research'` and emitted:

```
cand-research-prefer-sole-operator
  support = 2 (C001-01 + C001-07)
  no contradictions
  verification quality = success
```

The `RuleCandidateEvaluator` promoted this candidate (support ≥ 2 threshold met). The pattern `cand-research-prefer-sole-operator` became the first promoted Academy pattern.

**The problem:** C001-01 (evidence synthesis) and C001-07 (document comparison) belong to DIFFERENT Academy families with DIFFERENT task contexts. They share the coarse domain label `research` only because both goal texts contain the word "compare" — a GoalCompiler keyword-heuristic artifact, not genuine task comparability.

---

## 2. ROOT CAUSE

**The `StatisticalCandidateGenerator.generate()` grouped experiences by `exp.goal.domain` ALONE (line 74 of the original code).** This coarse semantic label is a keyword-heuristic classification (4 values: research, software-engineering, diagnostic, general), designed as a broad descriptor for planner shape selection — NOT as an evidence-grouping key for organizational learning.

### Complete causal chain

```
Mission Definition (C001-01: "Compare solar vs wind...")
    ↓
GoalCompiler.classifyDomain("...Compare...")
    ↓ matches "compare" → research signal
domain = 'research'
    ↓
Experience.goal.domain = 'research'
Experience.goal.capabilityNeeds = ['document-authoring']
    ↓
StatisticalCandidateGenerator.generate()
    ↓ groups by exp.goal.domain ALONE (line 74)
    ↓ C001-01 and C001-07 both in the 'research' bucket
    ↓
detectValuableRoles('research', [C001-01, C001-07])
    ↓ role 'Sole Operator' in both, artifactsCount > 0 in both
    ↓
candidate: cand-research-prefer-sole-operator
    supportingExperienceIds = [exp-C001-01, exp-C001-07]
    support = 2
    ↓
RuleCandidateEvaluator.evaluate()
    ↓ support(2) >= threshold(2), no contradictions, verification=success
    ↓ PROMOTED
    ↓
OrganizationalPattern: applicableContext = { domain: 'research' }
    ↓
RulePatternRetriever.retrieve()
    ↓ future research mission → pattern retrieved → planner applies
```

**Why support became 2:** The generator's grouping key was `domain` only. C001-01 and C001-07 both had `domain: 'research'`, so they landed in the same bucket. The `Sole Operator` role appeared in both and produced artifacts in both → `prefer-role` candidate with support=2.

**Why the evaluator considered it legitimate:** The evaluator's rules (support ≥ threshold, no contradictions, verification quality) are correct GIVEN its inputs. The problem was that the inputs (grouped experiences) were semantically invalid — two incomparable experiences were treated as comparable.

---

## 3. WHY IT WAS POSSIBLE

1. **GoalCompiler domain taxonomy is intentionally coarse** (4 values). It was never designed to be the sole evidence-grouping key. C001-03 (data mission) being `general` and C001-07 (document comparison) being `research` are expected behaviors of a coarse heuristic classifier.

2. **The CandidateGenerator had no notion of "task context" beyond domain.** It grouped by `domain` alone, ignoring `capabilityNeeds` — a field that was already on every Experience but was not used for grouping.

3. **The evaluator trusted the generator's grouping.** It counted support and contradictions within the bucket it was given. If the bucket contained semantically incomparable experiences, the evaluator had no way to detect that.

4. **No "evidence signature" concept existed.** The architecture conflated three distinct concepts:
   - **Semantic domain** (research, software-engineering, diagnostic, general) — a broad planner descriptor
   - **Mission family / task class** (research-evidence-synthesis, document-comparison, data-analysis) — the actual organizational context
   - **Experimental family** (Academy Family A, B, C, D) — the Academy's experimental provenance

   The generator used `domain` (concept 1) as if it were `task class` (concept 2). They are not the same.

---

## 4. WHY COHORT 001 WAS USEFUL

**The Academy discovered the failure before scaling.** This is exactly what calibration is for. Cohort 001 was designed to "exercise evidence capture; discover learning-schema gaps; identify where organization decisions matter." It discovered a semantic-integrity gap in the learning system — not a schema gap, but a grouping-logic gap.

If this had been discovered in Cohort 003 (Blind Transfer), the contaminated pattern would have influenced transfer mission planning, producing confounded evidence. Cohort 001's calibration purpose was fulfilled.

---

## 5. WAS GOALCOMPILER ACTUALLY WRONG?

**No — partially.** The GoalCompiler's domain taxonomy is intentionally coarse (4 values). It was designed as a broad semantic descriptor for planner shape selection, NOT as an evidence-grouping key. C001-03 being `general` and C001-07 being `research` are expected coarse-taxonomy behaviors, not defects.

The GoalCompiler IS partially wrong in the sense that "compare" triggering `research` is a very broad heuristic — a document comparison is not a research mission in the Academy's sense. But fixing the GoalCompiler's keyword heuristics would not solve the structural problem: even a perfect classifier would still be a single coarse label, and the generator would still need a richer grouping key to prevent accidental aggregation.

**Verdict: GoalCompiler is PARTIALLY wrong (heuristic too broad) but NOT the root cause.**

---

## 6. WAS THE CANDIDATE GENERATOR WRONG?

**Yes — this is the root cause.** The generator grouped by `domain` alone, which is a coarse semantic descriptor, not a task-context identity. It should have grouped by a richer evidence signature that captures whether two experiences are actually comparable.

**Verdict: CandidateGenerator is the root cause.**

---

## 7. WAS THE EVALUATOR WRONG?

**No.** The evaluator's rules (support ≥ threshold, no contradictions, verification quality) are correct given its inputs. The problem was that the inputs (grouped experiences) were semantically invalid. The evaluator cannot and should not second-guess the generator's grouping — that would duplicate the grouping logic.

**Verdict: Evaluator is NOT wrong. It was given semantically invalid support.**

---

## 8. WAS THE EXPERIENCE SCHEMA INSUFFICIENT?

**No.** The Experience v2 schema already has `goal.capabilityNeeds` — a field that distinguishes C001-01 (`[document-authoring]`) from C001-07 (`[web-research, document-authoring]`). The schema was sufficient; the generator was not using it for grouping.

**Verdict: Experience schema is SUFFICIENT. No schema extension needed.**

---

## 9. HUMAN HYPOTHESIS EVALUATION

**Human hypothesis: "Mission Family ≠ GoalCompiler Domain."**

**Verdict: CONFIRMED.** The hypothesis is correct. The Academy's mission families (A, B, C, D) are NOT the same as the GoalCompiler's semantic domains. A document-comparison mission (Academy Family D) can legitimately have `semanticDomain = research` while belonging to `taskFamily = document-comparison` and `experimentalFamily = Academy D`.

The human's conceptual representation is valid:
```
Mission
├── semanticDomain          (GoalCompiler: research, software-engineering, etc.)
├── taskClass / missionFamily (not explicitly in production; derivable from capabilityNeeds)
├── academyFamily           (experimental provenance; Academy-only)
├── capabilities            (goal.capabilityNeeds — already exists)
├── verificationClass       (not needed for this fix)
└── experimentalCohort      (Academy metadata)
```

The solution does NOT add a `taskClass` field. Instead, it uses the EXISTING `capabilityNeeds` field as the task-context distinguisher, combined with `domain` into an **evidence signature**.

---

## 10. OPTIONS CONSIDERED

### Option A — Academy-only experimental family stratification

Add `academyFamily` to Experience provenance. The generator groups by (domain, academyFamily).

- **Correctness:** Solves the Academy case but NOT the production case.
- **Generalizability:** LOW — production missions don't carry Academy labels.
- **Complexity:** LOW (one field).
- **Production coupling:** NONE.
- **Academy coupling:** HIGH — production learning can't use it.
- **Migration impact:** Minimal.
- **Risk of overfitting:** HIGH — encodes Academy structure into production.
- **Future compatibility:** Blocks production learning generalization.

**Rejected.** Does not generalize beyond Academy.

### Option B — General mission/task-class metadata

Add a `taskClass` field to Experience, inferred by a new classifier or supplied by the caller.

- **Correctness:** Solves the problem if the classifier is good.
- **Generalizability:** HIGH.
- **Complexity:** HIGH — requires a new classifier or a new caller-supplied field.
- **Production coupling:** Medium.
- **Academy coupling:** Low.
- **Migration impact:** Schema change; all existing Experiences need backfill.
- **Risk of overfitting:** Medium — depends on classifier quality.
- **Future compatibility:** Good, but overkill for the current problem.

**Rejected.** Overkill — the existing `capabilityNeeds` field already captures task context.

### Option C — Richer evidence signature from existing fields (CHOSEN)

Group candidates by an **evidence signature** = `(domain, sorted capabilityNeeds)`. Two experiences support the same candidate only when they share the same signature.

- **Correctness:** Solves the problem. C001-01 (`[document-authoring]`) and C001-07 (`[web-research, document-authoring]`) have different signatures → cannot aggregate.
- **Generalizability:** HIGH — uses existing fields, no Academy coupling.
- **Complexity:** LOW — ~30 LOC change to the generator.
- **Production coupling:** NONE — uses existing fields.
- **Academy coupling:** NONE.
- **Migration impact:** NONE — no schema change. Existing candidates with domain-only context still work (backward-compatible).
- **Risk of overfitting:** LOW — does not encode Academy structure.
- **Future compatibility:** Good. Cross-context patterns remain possible when a candidate is explicitly emitted with broader applicability (future extension).

**CHOSEN.** Smallest semantically correct change; uses existing fields; generalizes; no schema bloat.

### Option D — Candidate support requires contextual compatibility

Similar to Option C but defines "compatibility" as a function (e.g., domain match AND capabilityNeeds intersection ≥ threshold) rather than exact signature equality.

- **Correctness:** Solves the problem.
- **Generalizability:** HIGH.
- **Complexity:** Medium — requires defining the compatibility function.
- **Risk:** A loose compatibility function (intersection) could re-introduce the problem. An exact-match function is Option C.

**Rejected in favor of Option C** (exact signature match is simpler and stricter; compatibility functions can be explored in future cohorts if exact match proves too conservative).

### Option E — Hierarchical taxonomy (domain → task class → mission characteristics)

- **Complexity:** HIGH — requires a new ontology.
- **Migration impact:** HIGH.
- **Risk:** Overkill.

**Rejected.** Overkill for this problem; >500 LOC; would trigger DESIGN_REVIEW_REQUIRED.

---

## 11. CHOSEN SOLUTION

**Evidence Signature** — the `StatisticalCandidateGenerator` now groups experiences by `(domain, sorted capabilityNeeds)` instead of `domain` alone.

### Implementation

**`src/learning/candidate-generator.ts` (+87 LOC):**
- New `EvidenceSignature` interface: `{ domain, capabilityNeeds }`
- New `evidenceSignature(exp)` function: extracts signature from an Experience
- New `signatureKey(sig)` function: stable string key for Map grouping
- New `signatureLabel(sig)` function: human-readable label for candidate text
- `generate()` now groups by signature key, not domain alone
- `detectRedundantRoles(sig, bucket)` and `detectValuableRoles(sig, bucket)` now take the signature (not just domain)
- Candidate `applicableContext` now carries BOTH `domain` AND `capabilityNeeds`
- Candidate `id` now includes the capabilityNeeds (e.g., `cand-research-document-authoring-prefer-sole-operator`)

**`src/learning/evaluation.ts` (+15 LOC):**
- `findContradictions()` now checks that a contradicting experience shares the SAME evidence signature (domain + capabilityNeeds), not just the same domain. An experience from a different task context is NOT a contradiction — it's a different context.
- Backward-compatible: when a candidate has NO `capabilityNeeds` (old-style candidates), falls back to domain-only matching (the original behavior).

### What did NOT change

- **Experience schema:** UNCHANGED. `goal.capabilityNeeds` already existed.
- **GoalCompiler:** UNCHANGED. Its coarse domain taxonomy remains a broad descriptor.
- **RulePatternRetriever:** UNCHANGED. It already matches by domain AND capabilityNeeds intersection — the new candidates carry both, so retrieval works correctly.
- **OrganizationPlanner:** UNCHANGED.
- **WorkerAgent, MissionOrchestrator:** UNCHANGED.
- **Cohort 001 historical evidence:** UNCHANGED. The old `cand-research-prefer-sole-operator` remains in `results.json` as a historical audit record.

---

## 12. HISTORICAL PATTERN STATUS

| Field | Value |
|-------|-------|
| HISTORICAL_PATTERN_ID | `cand-research-prefer-sole-operator` |
| HISTORICAL_PATTERN_PRESERVED | YES |
| HISTORICAL_PATTERN_SCIENTIFIC_STATUS | QUARANTINED |
| REASON | DOMAIN_CLASSIFICATION_ARTIFACT |
| MAY_INFLUENCE_FUTURE_ACADEMY_LEARNING | NO |
| MAY_INFLUENCE_FUTURE_ACADEMY_RETRIEVAL | NO |

**Quarantine mechanism:** `experiments/academy/cohort-001/pattern-quarantine.json` records the contaminated pattern with its original support, reason, and remediation. The pattern is NOT deleted from historical evidence (`results.json` retains it as an audit record). Under the new semantics, re-running the candidate generator on the same 4 Cohort 001 experiences does NOT produce this candidate — C001-01 and C001-07 have different evidence signatures.

**CONTAMINATED_PATTERN_RETRIEVABLE_FOR_G5_05 = NO.** The quarantined pattern is not in any active pattern set. The G5-05 cohort will start with the frozen pre-cohort pattern state (which is empty or contains only signature-aware patterns).

---

## 13. REGRESSION TEST

**File:** `tests/learning/semantic-integrity.test.ts` (8 tests)

### Adversarial: false support aggregation is prevented (2 tests)

1. **"two experiences with same domain but DIFFERENT capabilityNeeds do NOT aggregate support"** — C001-01 analog (research, [document-authoring]) + C001-07 analog (research, [web-research, document-authoring]) → no candidate with support=2; no candidate listing both as support. **PASS.**

2. **"the old contaminated candidate ID is NOT produced under the new semantics"** — re-running the generator on C001-01 + C001-07 analogs → `cand-research-prefer-sole-operator` is NOT in the output. **PASS.**

### Positive: valid support aggregation still works (2 tests)

3. **"two experiences with the SAME evidence signature DO aggregate support=2"** — two research+document-authoring experiences → prefer-role candidate with support=2. **PASS.**

4. **"a validly supported candidate CAN still be promoted by the evaluator"** — the evaluator promotes the support=2 candidate. **PASS.**

### Evaluator signature-aware contradictions (1 test)

5. **"a contradiction from a DIFFERENT signature does NOT count"** — an avoid-role candidate for [document-authoring] signature; a different-signature experience where the role produced artifacts is NOT a contradiction. **PASS.**

### Quarantine (1 test)

6. **"the quarantined pattern ID does not match any candidate produced under new semantics"** — re-running on all 4 Cohort 001 analogs → no candidate with the old ID; no candidate aggregating C001-01 + C001-07. **PASS.**

### C001-03 context preservation (1 test)

7. **"a data mission classified as general still has its capabilityNeeds signature"** — two general+[data-analysis,document-authoring] experiences aggregate correctly despite coarse domain. **PASS.**

### Cross-context generalization still possible (1 test)

8. **"the retriever still matches patterns by domain + capabilityNeeds intersection"** — a promoted pattern with a specific signature is retrieved for a future mission with the same domain and overlapping capabilityNeeds. Cross-context generalization is not architecturally prohibited. **PASS.**

---

## 14. POSITIVE GENERALIZATION TEST

Test 3 and 4 above prove that genuinely comparable experiences (same evidence signature) still aggregate support=2 and can be promoted. The remediation did NOT make learning impossible — it made it semantically correct.

---

## 15. CROSS-CONTEXT GENERALIZATION

Test 8 proves that the `RulePatternRetriever` still matches patterns by domain + capabilityNeeds intersection. A pattern promoted with a specific signature (e.g., research + [document-authoring]) can be retrieved for a future mission that shares the same domain and has overlapping capabilityNeeds.

Cross-context generalization (a pattern that explicitly spans multiple signatures) is NOT implemented yet — but it is NOT architecturally prohibited. A future candidate generator could emit a candidate with a broader `applicableContext` (e.g., domain only, no capabilityNeeds restriction) if the evidence genuinely supports cross-context generalization. The current fix prevents ACCIDENTAL aggregation; it does not prevent DELIBERATE cross-context patterns.

**CROSS_CONTEXT_GENERALIZATION_STILL_POSSIBLE = NOT_YET_IMPLEMENTED_BUT_NOT_BLOCKED**

---

## 16. C001-03 CONTEXT PRESERVATION

C001-03 (data mission) was classified as `general` by the GoalCompiler. Under the old semantics, this meant it could only aggregate with other `general` experiences — losing its data-analysis task context.

Under the new semantics, C001-03's evidence signature is `(general, [document-authoring, data-analysis])`. Another data mission with the same signature will aggregate correctly, even though both are classified as `general`. The capabilityNeeds preserve the task context despite the coarse domain.

**C001_03_CONTEXT_PRESERVED = YES**

---

## 17. REMAINING LIMITATIONS

1. **capabilityNeeds is also heuristic-derived.** The GoalCompiler infers capabilityNeeds from goal text keywords, just like domain. If two genuinely different missions happen to produce the same capabilityNeeds, they could still aggregate. However, capabilityNeeds is STRICTLY more specific than domain alone — it captures the mission's capability requirements, not just its broad semantic category.

2. **No explicit cross-context patterns yet.** A pattern that genuinely applies across multiple signatures (e.g., "independent verification helps high-risk factual missions") cannot be expressed yet — the generator emits candidates with a single signature. Future cohorts may need a cross-context candidate generator.

3. **Scripted reasoning limitation persists.** G5-04A did NOT solve the scripted-reasoning evidence limitation from G5-04. That is a separate concern (provider availability).

4. **No pattern retirement system.** A promoted pattern that later encounters contradictory evidence cannot be automatically downgraded. The quarantine mechanism is manual (a JSON manifest). Future cohorts may need automated pattern lifecycle management.

5. **GoalCompiler keyword heuristics unchanged.** "compare" still triggers `research`. This is acceptable — the evidence signature compensates for domain coarseness. A future GoalCompiler improvement (better domain classification) would be welcome but is not required for semantic integrity.

---

## 18. G5-05 ENTRY STATE

| Condition | Status |
|-----------|--------|
| Contaminated pattern retrievable for G5-05 | NO |
| Historical evidence preserved | YES |
| Historical pattern not deleted | YES (in results.json as audit record) |
| Transfer set sealed (C001-02/04/06/08) | YES — NOT EXECUTED |
| Evidence signature semantics active | YES |
| Learning loop closed and semantically correct | YES |
| Full tests pass | YES (345 passed, 9 skipped, 354 total) |
| Typecheck pass | YES |
| Lint pass | YES |
| Production code changed | YES (2 files, +105/-18 LOC) |
| New runtime dependencies | 0 |

---

## 19. LEARNING INVARIANT AFTER G5-04A

> **TWO EXPERIENCES MUST NOT COUNT AS TWO INDEPENDENT SUPPORTING EXAMPLES FOR A CONTEXT-SPECIFIC ORGANIZATIONAL PATTERN MERELY BECAUSE THEY SHARE A COARSE OR ACCIDENTAL CLASSIFICATION.**

This invariant now holds structurally. The evidence signature `(domain, sorted capabilityNeeds)` ensures that two experiences support the same candidate only when they share a comparable task context — not merely the same coarse domain label.

Cross-family generalization remains possible when a candidate is explicitly emitted with broader applicability, but accidental aggregation from a shared coarse label is structurally prevented.

---

## 20. ALLOWED CLAIM AFTER G5-04A

"Genesis identified and remediated a semantic-integrity defect in its organizational learning system: the candidate generator previously grouped experiences by coarse domain alone, allowing semantically incomparable missions to aggregate false statistical support. The fix introduces an evidence signature (domain + capabilityNeeds) as the grouping key, preventing accidental cross-context aggregation while preserving legitimate support aggregation and not architecturally prohibiting future cross-family generalization."

---

## 21. PRODUCTION CODE DELTA

| File | Change | LOC |
|------|--------|-----|
| `src/learning/candidate-generator.ts` | Evidence signature grouping + signature-aware candidate context | +87 |
| `src/learning/evaluation.ts` | Signature-aware contradiction checking (backward-compatible) | +15 |
| **Total** | | **+105 / -18** |

**New runtime dependencies:** 0
**New production files:** 0 (only existing files modified)
**Within anti-bloat budget:** YES (well under 500 LOC; no DESIGN_REVIEW_REQUIRED)

---

## 22. TEST RESULTS

| Metric | Before G5-04A | After G5-04A |
|--------|---------------|-------------|
| Test files | 42 | 42 |
| Tests passed | 337 | 345 |
| Tests skipped | 9 | 9 |
| Tests total | 346 | 354 |
| Typecheck | PASS | PASS |
| Lint | PASS | PASS |

+8 new tests (semantic-integrity.test.ts), 0 regressions.
