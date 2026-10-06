# Group 4 — Organizational Learning & Evolution

## Architecture

Group 4 closes the learning loop:

```
GOAL
 ↓
Goal Compiler
 ↓
Organization Planner ←── Relevant Promoted Experience / Patterns
 ↓
Genome Compiler
 ↓
Workers
 ↓
Runtime
 ↓
Verification / Outcome
 ↓
Experience Store (TASK-024)
 ↓
Learning Candidate Generator (TASK-025)
 ↓
Evaluation / Promotion (TASK-026)
 ↓
Organizational Pattern Knowledge
 ↓
future Organization Planner (TASK-027)
 ↓
Measured Learning Experiment (TASK-028)
 ↓
Evolution Sandbox (TASK-029)
```

## Files Added

### Production code (7 files, ~1100 LOC)

| File | Purpose |
|------|---------|
| `src/learning/experience.ts` | Experience contract + `deriveExperience()` |
| `src/learning/experience-store.ts` | Memory + File (JSONL) experience stores |
| `src/learning/candidate.ts` | LearningCandidate contract |
| `src/learning/candidate-generator.ts` | StatisticalCandidateGenerator (deterministic signals) |
| `src/learning/evaluation.ts` | Evaluation contract + RuleCandidateEvaluator |
| `src/learning/pattern.ts` | OrganizationalPattern + promoteCandidate + RulePatternRetriever |
| `src/learning/evolution.ts` | EvolutionSandbox + promoteVariant + verifyIsolation |
| `src/learning/index.ts` | Public re-exports |

### Contract extension (1 file)

| File | Change |
|------|--------|
| `src/contracts/core.ts` | Added `LearnedPatternInfluence` + optional `learned` field on `OrganizationPlan` |

### Planner extension (1 file)

| File | Change |
|------|--------|
| `src/organization/organization-planner.ts` | Added advisory `patterns` option; `applyAdvisoryPattern` redistributes needs to preserve coverage; coordinator decision re-evaluated after patterns |

### Experiments (2 directories)

| Directory | Purpose |
|-----------|---------|
| `experiments/learning-028/` | Measured learning experiment (BEFORE/LEARNING/AFTER) |
| `experiments/evolution-029/` | Evolution sandbox experiment (baseline vs variant) |

### Tests (6 files)

| File | Tests |
|------|-------|
| `tests/learning/experience-store.test.ts` | 6 |
| `tests/learning/candidate-generator.test.ts` | 8 |
| `tests/learning/evaluation.test.ts` | 8 |
| `tests/learning/pattern-retrieval.test.ts` | 8 |
| `tests/learning/experiment-028.test.ts` | 1 |
| `tests/learning/evolution-sandbox.test.ts` | 9 |
| `tests/learning/experiment-029.test.ts` | 1 |

**Total new tests: 41. All passing.**

## Complexity Budget

| Metric | Value |
|--------|-------|
| First-party production files added | 8 |
| First-party production LOC added | ~1100 |
| Test LOC added | ~900 |
| Modules added | 1 (`src/learning/`) |
| Contracts/interfaces added | 2 (`LearnedPatternInfluence`, `AdvisoryPattern`) |
| New runtime dependencies | 0 |
| New storage technologies | 0 (JSONL, like FlightRecorder) |

## Task Gates

| Task | Gate | Status |
|------|------|--------|
| TASK-024 | Experience: derive, persist, retrieve, provenance | PASS |
| TASK-025 | Candidate: generation, evidence linkage | PASS |
| TASK-026 | Evaluation: promotion, rejection, negative learning | PASS |
| TASK-027 | Retrieval: relevant pattern, irrelevant exclusion, planner consumption | PASS |
| TASK-028 | Measured learning: BEFORE/LEARNING/AFTER, honest classification | MEASURED_LEARNING_PASS |
| TASK-029 | Evolution: isolated variant, explicit promote/reject, no production mutation | EVOLUTION_MECHANISM_EXISTS |

## TASK-028 Result

**Classification: MEASURED_LEARNING_PASS**

| Metric | BEFORE | AFTER | Delta |
|--------|--------|-------|-------|
| Worker count | 4 | 2 | -2 |
| Reasoning calls | 6 | 4 | -2 |
| Verification | passed (2/2) | passed (2/2) | equivalent |
| Pattern applied | — | yes | — |
| Provenance traces | — | yes (2 supporting experiences) | — |

The learning loop is closed and the improvement is real: Genesis converted
real organizational execution experience into validated reusable knowledge
that measurably improved a later organization.

## TASK-029 Result

**Classification: EVOLUTION_MECHANISM_EXISTS (inconclusive)**

The evolution sandbox correctly evaluated a variant in isolation. The
variant (avoid Mission Coordinator) was inconclusive — the baseline pattern
from TASK-028 is already optimal for this workload, and the variant didn't
change the plan. Production behavior was unchanged throughout.

**Explicit distinction (per spec):**
- EVOLUTION MECHANISM EXISTS = YES
- EVOLUTION IMPROVES GENESIS = NO (this variant was inconclusive)

## Evidence Discipline

Per the TASK-023 lesson (telemetry is evidence about execution, NOT
authoritative state):

- Experience stores REFERENCES to flight records, not copies of payloads.
- The experiment uses actual persisted state (MissionResult, flight events,
  plan, experience store) as ground truth.
- Telemetry (flight record events) supports the conclusion but does not
  silently replace the underlying authoritative state.
- The experiment's classification is derived from measured metrics, not
  from mechanism execution alone.

## Anti-Bloat Compliance

- No Learning Platform, Experience Platform, Pattern Platform, or Evolution
  Platform was built.
- No vector database, PostgreSQL, Redis, or Elasticsearch was introduced.
- No new runtime dependencies were added.
- The learning subsystem is 8 files, ~1100 LOC — small relative to its
  capability.
- Existing contracts (Goal, GoalRequirements, OrganizationPlan, WorkerGenome,
  MissionResult, Evidence) were reused wherever possible.
- The planner extension is a bounded seam (optional `patterns` parameter),
  not a replacement of the planner's ownership.
