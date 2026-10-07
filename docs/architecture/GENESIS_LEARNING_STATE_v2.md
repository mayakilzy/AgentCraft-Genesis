# GENESIS_LEARNING_STATE_v2

**Version:** v2 (Phase 4.10/4.11 output; Group 5 closure update 2026-10-07)
**Date:** 2026-10-07

> **Group 5 closure update (2026-10-07):** The Academy has closed with
> GROUP_5_STATUS = CLOSED_PASS_WITH_LIMITATIONS. The learning loop remains
> CLOSED; the G5-06 `prefer-role: Sole Operator` implementation is in production
> (`src/organization/organization-planner.ts` lines 527-573). Evidence Signature
> v1 (domain + sorted capabilityNeeds) is frozen. The quarantined pattern
> `cand-research-prefer-sole-operator` remains excluded from active retrieval.
> See `docs/academy/GENESIS_GROUP5_FINAL_CLOSURE.md` for the authoritative
> closure record, supported claims, known limitations, and future learning
> backlog.

---

## Learning Loop Status: CLOSED

The learning loop reaches OrganizationPlanner through the MissionOrchestrator's `patterns` option (Phase 4.10). Phase 4.11 empirically proved the loop works end-to-end with a measured LEARNING_PASS.

---

## Learning Engine Classification

| Component | Status | Evidence |
|-----------|--------|----------|
| EXPERIENCE_CAPTURE | READY | schemaVersion 2; captures resolvedNeeds, providerInvocations, verification, reasoning, wallMs, retries |
| CANDIDATE_GENERATION | READY | StatisticalCandidateGenerator groups by domain, identifies redundant/valuable roles |
| EVALUATION_PROMOTION | READY | RuleCandidateEvaluator promotes if ≥2 supporting + no contradictions + verification success |
| PATTERN_RETRIEVAL | READY | RulePatternRetriever matches domain + capabilityNeeds |
| PLANNER_CONSUMPTION | READY | OrganizationPlanner consumes AdvisoryPattern[] via orchestrator patterns option (Phase 4.10) |
| OPERATIONAL_NEEDS_LEARNING | NOT_READY | Requires diverse mission evidence (Group 5 Academy); explicit injection remains the test mechanism |
| MISSION_OBLIGATION_LEARNING | NOT_READY | Same — requires diverse evidence; obligations are currently explicitly declared |
| PROVIDER_NEUTRAL_LEARNING | READY | Patterns use domain + capabilityNeeds, never provider names |
| METRIC_CAPTURE | READY | reasoningCalls, wallMs, retries, humanInterventions, verification ok/passed/failed |

---

## What Experience Captures

| Field | Phase | Purpose |
|-------|-------|---------|
| goal.outcome, domain, capabilityNeeds | v1 | Mission family identification |
| organization.workerCount, roles, collaborationEdges, rationale | v1 | Organization shape |
| contributions[].workerId, role, reasoningCalls, artifactsCount, status | v1 | Per-worker contribution |
| contributions[].resolvedNeeds (need→provider) | 4.5 | Which provider realized each need |
| outcome.status, summary, reasoningCalls, wallMs, retries, humanInterventions | v1 | Mission outcome |
| verification.ok, passed, failed | v1 | Verification outcome |
| evidence[].kind, description, location | v1 | Artifact references (not copies) |
| providerInvocations[] (provider, need, operation, workerId, observed, resultRef) | 4.6 | INVOKED vs OBSERVED evidence |
| provenance.missionId, flightRecordPath, repositorySha, source | v1 | Ground truth recovery |

---

## What Experience Does NOT Capture (intentional)

| Field | Reason |
|-------|--------|
| missionObligations | "Smallest information necessary" — obligations are mission-specific, not pattern-worthy at N=1 |
| Actual surface usage (flight-action evidence) | Captured in flight recorder; Experience stores references, not copies |
| Cost (USD) | Not available from current reasoning providers (zeros reported) |
| Tokens | Not available from current reasoning providers |

---

## Learning Causality (Phase 4.11 proof)

1. Experience A1 and A2 existed: YES
2. Learning produced candidates: YES (5)
3. Candidates were evaluated: YES (5 promoted)
4. Patterns were stored: YES (5)
5. Mission B planning retrieved patterns: YES (via orchestrator `patterns` option)
6. Organization B changed due to learning: YES (5→2 workers)
7. The changed organization executed: YES (success)
8. The outcome was measured: YES (workers=2, reasoning=4)

---

## Explicit User Requirements vs Learned Optimization

**Rule:** USER EXPLICIT REQUIREMENT always outranks LEARNED OPTIMIZATION.

The planner applies patterns as ADVISORY — it may apply or ignore each one. A learned "avoid-role" pattern cannot remove a role the user explicitly requested. The planner records which patterns were considered and applied in the plan's `learned` field.

---

## Future Learning Extensions (Group 5 Academy)

| Extension | Trigger | Evidence Required |
|-----------|---------|-------------------|
| Operational-need learning | Diverse mission families | N>1 per family, evidence that certain needs correlate with success |
| Mission-obligation learning | Diverse obligation patterns | Evidence that certain obligations improve verified outcomes |
| Cross-domain pattern transfer | Academy curriculum | Evidence that patterns generalize beyond one domain |
| Statistical learning claims | Large N | N>10 per family, statistical significance |
