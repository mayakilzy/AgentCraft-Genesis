# TASK-028 — Measured Learning Experiment Design

## The Question (truth gate)

> Did validated prior organizational experience measurably improve a later
> organizational decision/outcome?

## Hypothesis (stated BEFORE execution)

When Genesis observes that a specific organization role consistently
contributes nothing to a class of missions, it can learn to omit that role
for future missions of the same class — producing a smaller organization
that achieves an equivalent verified outcome at lower operational cost
(fewer workers, fewer reasoning calls).

## Workload

A diagnostic-class goal where the baseline (Group 1) OrganizationPlanner
produces a 4-worker plan including a Reproduction Engineer, but the
Reproduction Engineer contributes nothing (the telemetry is self-evident;
there is nothing to reproduce).

The SAME goal text is used in all three phases — the only variable is
whether the OrganizationPlanner has access to promoted organizational
patterns.

## Phases

### PHASE A — BEFORE LEARNING

1. Run 2 diagnostic missions through the REAL MissionOrchestrator
   (MemoryRuntime + scripted ReasoningProvider). The script models a
   realistic scenario where the Reproduction Engineer immediately finishes
   with no artifacts because the telemetry was self-evident.
2. Derive a compact Experience from each mission (TASK-024).
3. Persist both experiences to the ExperienceStore.
4. Record the BEFORE state: worker count, per-worker contributions,
   verification outcome, reasoning-call count.

### PHASE B — LEARNING

1. Generate candidates from the 2 experiences (TASK-025).
   The StatisticalCandidateGenerator detects the redundant-role signal:
   Reproduction Engineer produced 0 artifacts and 0 reasoning calls in
   BOTH experiences → candidate "Reproduction Engineer is redundant for
   diagnostic missions" (avoid-role).
2. Evaluate the candidate (TASK-026).
   Support = 2, contradictions = 0, verification quality = success
   → PROMOTED.
3. Promote the candidate to an OrganizationalPattern.
4. The pattern's provenance traces to the 2 supporting experiences.

### PHASE C — AFTER LEARNING

1. Construct an OrganizationPlanner with the promoted pattern.
2. Run a comparable diagnostic mission through the SAME real runtime
   conditions.
3. The planner retrieves the pattern, applies it (avoids the Reproduction
   Engineer role, redistributes its capability needs to preserve coverage),
   and records the influence in `plan.learned`.
4. Record the AFTER state: worker count, per-worker contributions,
   verification outcome, reasoning-call count.

## Success Criteria (defined BEFORE execution)

The experiment is classified as `MEASURED_LEARNING_PASS` if and only if ALL
of the following hold:

1. The AFTER plan has FEWER workers than the BEFORE plan.
   (Expected: BEFORE 4 workers, AFTER ≤ 3 workers.)
2. The AFTER mission's verification outcome is equivalent to BEFORE.
   (Expected: both pass — the Reproduction Engineer wasn't contributing
   anyway, so removing it must not break verification.)
3. The AFTER mission uses FEWER OR EQUAL reasoning calls than BEFORE.
   (Expected: fewer — the omitted role's calls and the coordinator's
   integration calls for it are saved.)
4. The promoted pattern's provenance traces to the 2 supporting experiences.
5. The plan's `learned.applied` field records that the pattern was actually
   applied (not just considered).

If criteria 1 and 2 hold but criterion 3 does not (reasoning calls
increased), classify as `MEASURED_LEARNING_NO_IMPROVEMENT`.

If criterion 2 fails (verification regressed), classify as
`MEASURED_LEARNING_REGRESSION`.

If the experiment cannot run cleanly (contamination, infrastructure
failure), classify as `EXPERIMENT_INCONCLUSIVE`.

## Metrics (chosen BEFORE execution, not cherry-picked after)

- **worker count**: total planned workers (specialists + coordinator).
- **verification outcome**: ok=true/false, passed/failed counts.
- **reasoning calls**: total worker loop reasoning calls
  (mission-finished event's `reasoningCalls` field).
- **pattern influence**: `plan.learned.applied.length` > 0.
- **provenance**: pattern's `supportingExperienceIds` matches the 2 BEFORE
  experiences.

## Integrity Rules

- Use ACTUAL PERSISTED STATE as ground truth (the flight record, the
  mission result, the plan, the experience store). Do NOT reconstruct truth
  from telemetry alone (TASK-023 lesson).
- The BEFORE and AFTER missions use the SAME:
  - goal text
  - GoalCompiler, GenomeCompiler, CognitiveRouter, RuleDecisionProvider
  - MemoryRuntime (fresh instance per mission)
  - ReasoningProvider script (adjusted only for the roles that actually run)
- Preserve negative results. If the AFTER mission does NOT improve, REPORT
  THAT. Do not tune the script until the experiment becomes green.
- One honest negative result is more valuable than a manufactured success.

## What This Experiment Is NOT

- NOT a multi-arm benchmark (TASK-023 lesson).
- NOT a sealed-gold machinery exercise.
- NOT a benchmark-specific provider orchestration.
- NOT elaborate experimental scaffolding.

It is one narrow question with one controlled comparison.
