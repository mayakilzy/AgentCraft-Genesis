# PHASE 4.11 — Measured Learning Experiment II

## PHASE A — BEFORE (no learned patterns)

### Mission A1: "Comprehensively research and evaluate multiple competing sol..."
- Workers: 5 (Mission Coordinator, Web Researcher, Report Writer, Data Analyst, Generalist Worker)
- Status: success

### Mission A2: "Comprehensively research and evaluate multiple competing win..."
- Workers: 5 (Mission Coordinator, Web Researcher, Report Writer, Data Analyst, Generalist Worker)
- Status: success

## PHASE B — LEARNING

- Experiences derived: 2
- Candidates generated: 5
  - cand-research-avoid-data-analyst: The "Data Analyst" role is redundant for research missions: across 2 experience(s) it produced no ar
  - cand-research-avoid-web-researcher: The "Web Researcher" role is redundant for research missions: across 2 experience(s) it produced no 
  - cand-research-prefer-generalist-worker: The "Generalist Worker" role is valuable for research missions: across 2 verified experience(s) it c
  - cand-research-prefer-mission-coordinator: The "Mission Coordinator" role is valuable for research missions: across 2 verified experience(s) it
  - cand-research-prefer-report-writer: The "Report Writer" role is valuable for research missions: across 2 verified experience(s) it consi

- cand-research-avoid-data-analyst: promoted — Promoted: 2 supporting experience(s) (≥ threshold 2), no contradictions, verification quality success (success rate 1.00
- cand-research-avoid-web-researcher: promoted — Promoted: 2 supporting experience(s) (≥ threshold 2), no contradictions, verification quality success (success rate 1.00
- cand-research-prefer-generalist-worker: promoted — Promoted: 2 supporting experience(s) (≥ threshold 2), no contradictions, verification quality success (success rate 1.00
- cand-research-prefer-mission-coordinator: promoted — Promoted: 2 supporting experience(s) (≥ threshold 2), no contradictions, verification quality success (success rate 1.00
- cand-research-prefer-report-writer: promoted — Promoted: 2 supporting experience(s) (≥ threshold 2), no contradictions, verification quality success (success rate 1.00
- Patterns promoted: 5

## PHASE C — AFTER (WITH promoted patterns, unseen Mission B)

### Mission B: "Comprehensively research and evaluate multiple competing rai..."
- Workers: 2 (Report Writer, Generalist Worker)
- Status: success
- Pattern applied: YES
- Learned field: {"considered":["cand-research-avoid-data-analyst","cand-research-avoid-web-researcher","cand-research-prefer-generalist-worker","cand-research-prefer-mission-coordinator","cand-research-prefer-report-

## MEASUREMENT

| Metric | BEFORE (A1) | AFTER (B) | Delta |
|--------|-------------|-----------|-------|
| Worker count | 5 | 2 | -3 |
| Reasoning calls | 10 | 4 | -6 |
| Pattern applied | — | YES | — |
| Mission status | success | success | — |

## CLASSIFICATION

**LEARNING_PASS** — experience-derived organizational knowledge was promoted, retrieved by future planning, changed the subsequent organization, and the changed organization executed.

### Learning Causality Evidence

1. Experience A1 and A2 existed: YES (2 experiences stored)
2. Learning produced candidates: YES (5 candidates)
3. Candidates were evaluated: YES (5 evaluations)
4. Patterns were stored: YES (5 patterns promoted)
5. Mission B planning retrieved patterns: YES (passed via orchestrator patterns option)
6. Organization B changed due to learning: YES
7. The changed organization executed: YES (status: success)
8. The outcome was measured: YES (workers=2, reasoning=4)