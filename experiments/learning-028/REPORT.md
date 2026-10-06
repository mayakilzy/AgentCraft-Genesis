# TASK-028 — Measured Learning Experiment — Result

## Classification

**MEASURED_LEARNING_PASS**

Workers decreased (4 → 2, Δ=-2), reasoning calls decreased or equal (6 → 4, Δ=-2), verification equivalent (both passed), pattern was applied, provenance traces to supporting experiences.

## Metrics

| Metric | BEFORE | AFTER | Delta |
|--------|--------|-------|-------|
| Worker count | 4 | 2 | -2 |
| Reasoning calls | 6 | 4 | -2 |
| Verification ok | true | true | — |
| Pattern applied | — | true | — |
| Provenance traces | — | true | — |

## PHASE A — BEFORE (2 missions, no patterns)

### before-1-728e72
- Workers: 4 (Mission Coordinator, Reproduction Engineer, Report Writer, Diagnostic Analyst)
- Reasoning calls: 6
- Verification: ok=true, passed=2, failed=0
- Reproduction Engineer contribution: reasoningCalls=1, artifacts=0
- Mission status: success

### before-2-497c3a
- Workers: 4 (Mission Coordinator, Reproduction Engineer, Report Writer, Diagnostic Analyst)
- Reasoning calls: 6
- Verification: ok=true, passed=2, failed=0
- Reproduction Engineer contribution: reasoningCalls=1, artifacts=0
- Mission status: success

## PHASE B — LEARNING

- Candidates generated: 4
  - cand-diagnostic-avoid-mission-coordinator
  - cand-diagnostic-avoid-reproduction-engineer
  - cand-diagnostic-prefer-diagnostic-analyst
  - cand-diagnostic-prefer-report-writer
- Evaluations:
  - cand-diagnostic-avoid-mission-coordinator: **promoted** — Promoted: 2 supporting experience(s) (≥ threshold 2), no contradictions, verification quality success (success rate 1.00). support=2 contradiction=0 quality=success.
  - cand-diagnostic-avoid-reproduction-engineer: **promoted** — Promoted: 2 supporting experience(s) (≥ threshold 2), no contradictions, verification quality success (success rate 1.00). support=2 contradiction=0 quality=success.
  - cand-diagnostic-prefer-diagnostic-analyst: **promoted** — Promoted: 2 supporting experience(s) (≥ threshold 2), no contradictions, verification quality success (success rate 1.00). support=2 contradiction=0 quality=success.
  - cand-diagnostic-prefer-report-writer: **promoted** — Promoted: 2 supporting experience(s) (≥ threshold 2), no contradictions, verification quality success (success rate 1.00). support=2 contradiction=0 quality=success.
- Patterns promoted: 4
  - cand-diagnostic-avoid-mission-coordinator
    - hypothesis: The "Mission Coordinator" role is redundant for diagnostic missions: across 2 experience(s) it produced no artifacts.
    - effect: avoid-role → Mission Coordinator
    - supporting experiences: exp-before-1-728e72, exp-before-2-497c3a
  - cand-diagnostic-avoid-reproduction-engineer
    - hypothesis: The "Reproduction Engineer" role is redundant for diagnostic missions: across 2 experience(s) it produced no artifacts.
    - effect: avoid-role → Reproduction Engineer
    - supporting experiences: exp-before-1-728e72, exp-before-2-497c3a
  - cand-diagnostic-prefer-diagnostic-analyst
    - hypothesis: The "Diagnostic Analyst" role is valuable for diagnostic missions: across 2 verified experience(s) it consistently produced artifacts.
    - effect: prefer-role → Diagnostic Analyst
    - supporting experiences: exp-before-1-728e72, exp-before-2-497c3a
  - cand-diagnostic-prefer-report-writer
    - hypothesis: The "Report Writer" role is valuable for diagnostic missions: across 2 verified experience(s) it consistently produced artifacts.
    - effect: prefer-role → Report Writer
    - supporting experiences: exp-before-1-728e72, exp-before-2-497c3a

## PHASE C — AFTER (1 mission WITH promoted pattern)

### after-1-83b3e4
- Workers: 2 (Report Writer, Diagnostic Analyst)
- Reasoning calls: 4
- Verification: ok=true, passed=2, failed=0
- Reproduction Engineer: NOT IN PLAN (pattern applied)
- Mission status: success

## What this proved

Genesis converted real organizational execution experience into validated reusable knowledge that measurably improved a later organization: fewer workers, equivalent verified outcome, fewer reasoning calls. The learning loop is closed and the improvement is real.