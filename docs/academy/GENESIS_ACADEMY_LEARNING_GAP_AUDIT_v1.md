# GENESIS_ACADEMY_LEARNING_GAP_AUDIT_v1

**Version:** v1 (frozen for G5-03)
**Date:** 2026-10-07
**Authority:** G5-03 learning system capability audit

---

## Purpose

This audit classifies the current learning system's capability for each Academy learning dimension. It determines what is READY, PARTIALLY_READY, NOT_READY, or DEFER, and identifies the minimal changes (if any) required for Cohort 001.

---

## 1. Current Learning Loop Status

**Learning loop: CLOSED** (verified in Phase 4.11, measured LEARNING_PASS).

```
Experience (schemaVersion 2)
    ↓ resolvedNeeds, providerInvocations, verification, reasoning, wallMs, retries
StatisticalCandidateGenerator
    ↓ groups by domain, detects redundant-role + valuable-role signals
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

### Proven (Phase 4.11)

- Organization A (diagnostic, before learning): 4 workers, 6 reasoning calls, verification PASS
- Learning: 4 candidates generated, 4 promoted (2 avoid-role, 2 prefer-role)
- Organization B (diagnostic, after learning): 2 workers, 4 reasoning calls, verification PASS
- Pattern applied: YES. Provenance traces to supporting experiences.

### Limitation

The Phase 4.11 experiment used **scripted reasoning** and **no independent verification gates** beyond the structural check. It proves learning causality and organizational change under controlled conditions. It does NOT prove broad autonomous real-world organizational learning.

---

## 2. Learning Dimension Capability Matrix

| Dimension | Status | Evidence | Gap for Cohort 001 |
|-----------|--------|----------|---------------------|
| **A. Organization shape** | READY | avoid-role + prefer-role candidates proven; planner applies them; measured 4→2 worker reduction | None — Cohort 001 can use this immediately |
| **B. Cognitive allocation** | PARTIALLY_READY | ReasoningTier (cheap/default/frontier) exists; CognitiveRouter + DecisionProvider select tiers; but learning does not yet adjust tier selection | Cohort 001 does NOT require tier-learning; record tier per worker in Experience for future analysis |
| **C. Capability needs (operationalNeeds)** | NOT_READY | Operational needs are explicitly injected (EXPLICIT_TEST_INJECTION); no autonomous inference | Cohort 001 records need→provider→outcome evidence; promotion to autonomous inference deferred (Level 5) |
| **D. Mission obligations** | NOT_READY | Mission obligations are explicitly declared; no learning | Cohort 001 records obligation→verification evidence; promotion deferred (Level 5) |
| **E. Coordination patterns** | PARTIALLY_READY | Collaboration edges exist in OrganizationPlan; learning does not yet adjust edge structure or handoff patterns | Cohort 001 records collaborationEdges count + handoff evidence; future cohorts may learn coordination patterns |
| **F. Failure/recovery patterns** | PARTIALLY_READY | avoid-shape candidates exist in the CandidateEffectKind union; but the generator does not yet emit avoid-shape from failure evidence; evaluator handles contradictions | Cohort 001 includes failure-possible missions; experiences with status=failure feed negative evidence into the existing contradiction mechanism |

---

## 3. Detailed Audit

### A. Organization Shape Learning — READY

**What exists:**
- `StatisticalCandidateGenerator.detectRedundantRoles()` — detects roles that appear in every experience of a domain but produce zero artifacts → emits `avoid-role` candidate.
- `StatisticalCandidateGenerator.detectValuableRoles()` — detects roles present in every verified experience that consistently produce artifacts → emits `prefer-role` candidate.
- `RuleCandidateEvaluator` — promotes if support ≥ threshold (default 2), no contradictions, verification quality success/mixed.
- `RulePatternRetriever` — matches domain + capabilityNeeds; returns relevant patterns.
- `OrganizationPlanner` — applies `avoid-role` patterns by omitting redundant specialists when their capability needs are covered by another specialist.
- `LearnedPatternInfluence` — records which patterns were considered and applied on the plan.

**Proven:** Phase 4.11 measured 4→2 worker reduction with pattern applied.

**Cohort 001 readiness:** YES — this is the primary learning dimension for Cohort 001. No code changes needed.

---

### B. Cognitive Allocation Learning — PARTIALLY_READY

**What exists:**
- `ReasoningTier = 'cheap' | 'default' | 'frontier'` — three cognitive resource tiers.
- `CognitiveRouter` + `DecisionProvider` — select tiers per worker based on criticality + budget ceiling.
- `RuleDecisionProvider` — deterministic: routine→cheap, important→default, mission-critical→frontier.
- `LLMDecisionProvider` — delegates to a reasoning provider with rule fallback.

**What does NOT exist:**
- Learning does not feed back into tier selection. A mission where `frontier` was unnecessary (success with `cheap`) does not yet produce a candidate like "prefer cheap tier for routine X."
- The DecisionProvider contract is swappable (Jev-ready), but no learning-driven DecisionProvider exists.

**Gap for Cohort 001:** None blocking. Cohort 001 records the tier per worker in Experience (already captured via `contributions[].reasoningCalls` and the genome's `model` field). Future cohorts may generate candidates from tier-outcome correlations.

---

### C. Operational Needs Learning — NOT_READY

**What exists:**
- `OperationalNeedKind` — 5 kinds (shell-execution, browser, workspace-files, collaborative-workspace, durable-delegation).
- `extraOperationalNeeds` option on GenomeCompiler — caller injects needs explicitly.
- `ResolvedNeed` on WorkerContribution — records which need was declared and which provider realized it.
- `ProviderInvocation` — records INVOKED + OBSERVED evidence (provider, need, operation, observed, resultRef).

**What does NOT exist:**
- The GoalCompiler does not infer operational needs from goal semantics.
- The OrganizationPlanner does not infer operational needs from domain + capabilityNeeds.
- No candidate generator emits "prefer-need" or "avoid-need" patterns.
- Operational needs are explicitly injected (EXPLICIT_TEST_INJECTION). This is honest — the system does not pretend to infer what it cannot.

**Evidence path for future promotion (Level 5):**
```
mission characteristics (domain, capabilityNeeds, goal keywords)
    ↓
selected operational needs (explicit injection)
    ↓
actual provider invocation (ProviderInvocation records)
    ↓
mission outcome (success/failure, verification)
    ↓
cost/failure evidence (reasoning calls, retries, wallMs)
    ↓
correlation analysis (future candidate generator)
    ↓
"missions of type X generally require browser" (future promoted pattern)
```

**Cohort 001 action:** Record all evidence dimensions. Do NOT implement automatic operationalNeeds learning. The evidence path and promotion threshold are designed here; execution is deferred.

**Promotion threshold:** N>3 per family with consistent need-outcome correlation before considering autonomous inference. Keep explicit injection for tests/benchmarks/debugging.

---

### D. Mission Obligation Learning — NOT_READY

**What exists:**
- `MissionObligation` — 3 kinds (delegated-result, shared-publication, computer-execution).
- `missionObligations` option on MissionOrchestrator — caller declares obligations explicitly.
- `flight-action` AcceptanceCheck — enforces obligations at verification (worker prose alone cannot satisfy).

**What does NOT exist:**
- The GoalCompiler does not infer obligations from goal semantics.
- No candidate generator emits "prefer-obligation" patterns.
- Obligations are explicitly declared. This is honest.

**Evidence path for future promotion (Level 5):**
```
mission characteristics (goal semantics, domain)
    ↓
obligations selected (explicit declaration)
    ↓
whether obligation was actually necessary (flight-action evidence)
    ↓
verification outcome (ok, passed, failed)
    ↓
false-success prevention evidence
    ↓
cost/benefit analysis
    ↓
correlation (future candidate generator)
    ↓
"claims requiring independent confirmation should require delegated-result" (future pattern)
```

**Cohort 001 action:** Record obligation→verification evidence. Do NOT implement automatic obligation learning. Do NOT hardcode "learning" as keyword heuristics.

**Promotion threshold:** N>3 per obligation kind with consistent necessity evidence before considering autonomous inference.

---

### E. Coordination Pattern Learning — PARTIALLY_READY

**What exists:**
- `CollaborationEdge` — `from`, `to`, `kind: 'report' | 'handoff'`.
- `OrganizationPlan.collaboration` — the edge set.
- `MissionHandoffs` — worker-to-worker channel at runtime.
- `HandoffEvent` in FlightRecorder — handoff-served reasoning calls are counted separately.

**What does NOT exist:**
- No candidate generator emits "prefer-handoff-structure" or "avoid-coordination-overhead" patterns.
- The planner does not adjust collaboration edges based on learned patterns.
- `prefer-shape` / `avoid-shape` candidates exist in the union but the generator does not emit them from collaboration evidence.

**Gap for Cohort 001:** None blocking. Cohort 001 records `collaborationEdges` count (already in Experience.organization.collaborationEdges) and handoff call counts (already in mission-finished event). Future cohorts may learn coordination patterns.

---

### F. Failure/Recovery Pattern Learning — PARTIALLY_READY

**What exists:**
- `avoid-shape` and `avoid-role` candidate kinds exist.
- `RuleCandidateEvaluator.findContradictions()` — finds same-domain experiences where the target role behaved opposite to the hypothesis (structural disconfirmation).
- Experiences with `outcome.status === 'failure'` or `verification.ok === false` feed into the evaluator's verification quality assessment.
- `allSupportFailed` rule: rejects a candidate when every supporting experience failed verification.

**What does NOT exist:**
- The generator does not explicitly emit "this organization shape repeatedly failed" candidates from failure clusters.
- No dedicated failure-pattern candidate generator.
- Negative evidence enters through the contradiction mechanism (same-domain experiences with divergent outcomes), which is functional but not failure-focused.

**Gap for Cohort 001:** None blocking. Cohort 001 includes failure-possible missions (where false success can occur). Experiences with failure outcomes provide negative evidence. The existing contradiction mechanism handles it. A dedicated failure-pattern generator is a future extension, not a Cohort 001 blocker.

---

## 4. Experience Schema Sufficiency for Cohort 001

**Schema: Experience v2** (schemaVersion: 2)

### What Experience v2 captures (sufficient for Cohort 001)

| Field | Captured | Cohort 001 use |
|-------|----------|----------------|
| `goal.outcome` | YES | Mission family identification |
| `goal.domain` | YES | Pattern context matching |
| `goal.capabilityNeeds` | YES | Pattern context matching |
| `organization.workerCount` | YES | Efficiency metric |
| `organization.roles` | YES | Redundant/valuable role detection |
| `organization.collaborationEdges` | YES | Coordination complexity observation |
| `organization.rationale` | YES | Planner reasoning trace |
| `contributions[].workerId, role` | YES | Per-worker contribution |
| `contributions[].reasoningCalls` | YES | Efficiency metric |
| `contributions[].artifactsCount` | YES | Contribution signal (the key metric for redundant/valuable role detection) |
| `contributions[].status` | YES | Per-worker success/failure |
| `contributions[].resolvedNeeds` | YES (Phase 4.5) | Need→provider→outcome evidence (for future operationalNeeds learning) |
| `outcome.status` | YES | Mission success/partial/failure |
| `outcome.reasoningCalls` | YES | Total efficiency metric |
| `outcome.wallMs` | YES | Latency metric |
| `outcome.retries` | YES | Reliability metric |
| `outcome.humanInterventions` | YES | Reliability metric |
| `verification.ok, passed, failed` | YES | Correctness gate |
| `evidence[]` | YES | Artifact references |
| `providerInvocations[]` | YES (Phase 4.6) | INVOKED + OBSERVED evidence |
| `provenance.missionId` | YES | Reproducibility |
| `provenance.flightRecordPath` | YES | Full audit trail |
| `provenance.source` | YES | `real-mission` vs `synthetic` distinction |

### What Experience v2 does NOT capture (intentional)

| Field | Reason | Needed for Cohort 001? |
|-------|--------|------------------------|
| `missionObligations` | "Smallest information necessary" — obligations are mission-specific | NO (Cohort 001 records obligations in the mission definition, not in Experience) |
| Actual surface usage (flight-action evidence) | Captured in flight recorder; Experience stores references, not copies | NO (flight recorder is the authority; Experience references it) |
| Cost (USD) | Not available from current reasoning providers | NO (zeros reported; not a Cohort 001 metric) |
| Tokens | Not available from current reasoning providers | NO |
| Reasoning tier per worker | Captured in genome.model, not directly in Experience | NO (derivable from flight record via genomes; Cohort 001 does not need tier learning) |

### Conclusion

**EXPERIENCE_SCHEMA_SUFFICIENT_FOR_COHORT_001 = YES**

No schema extension is needed. Experience v2 captures every dimension Cohort 001 requires. The `provenance.source` field already distinguishes scripted from real-mission evidence, satisfying the real-LLM vs scripted distinction requirement.

---

## 5. Pattern Schema Audit

### Current pattern schema (OrganizationalPattern)

```typescript
{
  id: string
  hypothesis: string
  applicableContext: { domain?, capabilityNeeds? }
  proposedEffect: { kind, description, targetRole?, targetShape? }
  promotionEvidence: { supportingExperienceIds[], evaluationId?, promotedAt }
  source: 'learning-candidate'
}
```

### Applicability context fields

| Field | Present | Sufficient? |
|-------|---------|-------------|
| `domain` | YES | Matches on exact domain |
| `capabilityNeeds` | YES | Matches on intersection |
| `goalKeywords` | YES (on CandidateContext, not OrganizationalPattern) | PARTIALLY — candidates can carry keywords, but promoted patterns drop them. Minor gap for future. |
| `evidence` (support count, contradiction count) | YES (via promotionEvidence.supportingExperienceIds) | Sufficient — count is derivable |
| `confidence` | NO | Deliberately absent — evidenceStrength is on the candidate, not the pattern. The pattern's authority comes from promotion, not a score. |

### Contradictory experience handling

- `RuleCandidateEvaluator.findContradictions()` scans the full experience set for same-domain experiences where the target role behaved opposite to the hypothesis.
- If a contradiction is found, the candidate is REJECTED (not promoted).
- If a promoted pattern later encounters contradictory evidence, the current architecture does NOT automatically downgrade it. This is a known future requirement (pattern retirement / regression control).

### Conflict resolution

When two retrieved patterns disagree (e.g., "prefer generalist for small analytical" vs "prefer specialist for high-risk analytical"), the planner currently receives both and applies them advisory. The planner's `avoid-role` application omits a specialist only when its capability needs are covered by another specialist — so a `prefer-role` for a different role does not conflict.

**Gap:** The planner does not yet weigh conflicting patterns by evidence strength or context specificity. This is acceptable for Cohort 001 (patterns are advisory; the planner remains the owner). Future cohorts may need a conflict-resolution strategy if patterns genuinely conflict.

---

## 6. Memorization vs Generalization Risk

### Current candidate generation

The `StatisticalCandidateGenerator` generates candidates per **domain**, not per mission. A candidate says "the Reproduction Engineer role is redundant for diagnostic missions" — not "for mission ID X use workers A+B."

This is generalization, not memorization. The candidate describes a reusable organizational principle (role redundancy in a domain), not a mission-specific answer.

### Risk audit

| Risk | Status | Mitigation |
|------|--------|------------|
| Candidate encodes mission-specific solution | LOW | Generator groups by domain, not mission ID; hypothesis references the role/domain, not the mission |
| Pattern retrieval returns mission-specific pattern | LOW | Retriever matches domain + capabilityNeeds, not mission ID |
| Planner applies a pattern that only helps one mission | LOW | Planner applies `avoid-role` only when capability needs are covered by another specialist (structural, not anecdotal) |
| Transfer mission is the same mission with cosmetic changes | ADDRESSED in curriculum design | Transfer missions use different data, different wording, different exact solutions (see Curriculum) |

### Conclusion

The current learning architecture is structurally biased toward generalization over memorization. No code changes needed for Cohort 001. The risk is monitored through the transfer test design (different data, different wording, different exact solutions).

---

## 7. Summary

| Dimension | Status | Code change needed for Cohort 001? |
|-----------|--------|-------------------------------------|
| Experience capture | READY | NO |
| Candidate generation | READY | NO |
| Evaluation / promotion | READY | NO |
| Pattern retrieval | READY | NO |
| Planner consumption | READY | NO |
| Organization shape learning | READY | NO |
| Cognitive allocation learning | PARTIALLY_READY | NO (records evidence; learning deferred) |
| Operational needs learning | NOT_READY | NO (records evidence; promotion deferred to Level 5) |
| Mission obligation learning | NOT_READY | NO (records evidence; promotion deferred to Level 5) |
| Coordination pattern learning | PARTIALLY_READY | NO (records evidence; learning deferred) |
| Failure pattern learning | PARTIALLY_READY | NO (failure evidence feeds existing contradiction mechanism) |
| Negative learning | PARTIALLY_READY | NO (avoid-role/avoid-shape candidates exist) |
| Pattern conflict handling | PARTIALLY_READY | NO (planner receives both; applies advisory) |
| Pattern retirement | NOT_READY | NO (future requirement; documented) |
| Experience schema sufficiency | SUFFICIENT | NO (no extension needed) |

**G5-03 conclusion:** The current learning system is READY for Cohort 001 without any production code changes. The Academy can begin. Known gaps (operationalNeeds learning, obligation learning, pattern retirement) are documented and deferred to their respective future levels.
