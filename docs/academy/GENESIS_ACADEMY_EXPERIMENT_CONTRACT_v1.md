# GENESIS_ACADEMY_EXPERIMENT_CONTRACT_v1

**Version:** v1 (frozen for G5-03)
**Date:** 2026-10-07
**Authority:** G5-03 experimental rigor contract

---

## 1. Epistemic Isolation

Strict isolation boundaries prevent hidden knowledge contamination.

### Isolation levels

| Level | Scope | Rule |
|-------|-------|------|
| Worker instance | One WorkerAgent construction | Each instance gets a scoped reasoning provider (TASK-022A: `forInstance(instanceKey)`). No cross-instance hidden memory. Stateless providers pass through unaffected. |
| Mission | One MissionOrchestrator.run() | Fresh recorder, fresh participants, fresh surfaces. No mission-to-mission state leakage except explicitly promoted patterns. |
| Cohort | A set of missions | Experiences from learning missions feed the learning loop. Transfer missions do NOT feed learning before their evaluation. |
| Learning mission | Used to generate patterns | Full evidence capture; experiences are eligible for candidate generation. |
| Transfer mission | Used to TEST patterns | Experiences are captured but NOT used to generate patterns until after the transfer evaluation is complete. |
| Evaluator | RuleCandidateEvaluator | Deterministic; reads only experience evidence; never reads model confidence. No access to gold answers. |
| Gold/reference data | Mission inputs and expected answers | Stored OUTSIDE the worker's scope. The worker receives only the mission input file. The expected answer is NEVER in the worker's prompt. |

### What is allowed

- Explicit handoffs between workers (via `ask_worker` action, recorded in flight events).
- Promoted patterns retrieved by the planner (legitimate prior knowledge).
- Normal tools and capabilities (OpenBot, MCP, etc.).

### What is NOT allowed (hidden continuity)

- No worker may know the future expected result.
- No worker may know the gold organization.
- No worker may know evaluation rubric details that leak the solution.
- No cross-mission memory in the reasoning provider (unless explicitly scoped and reset).
- No transfer mission may be used to generate patterns before its evaluation.

### Previously discovered contamination

The Experiment 003 review found cross-instance fallback memory contamination (one human actor serving multiple worker instances through a shared journal). The `ScopeableReasoningProvider` contract (TASK-022A) was introduced to prevent recurrence. The Academy inherits this protection — every WorkerAgent instance gets a scoped reasoning provider view.

---

## 2. Baseline Rules

### Baseline definitions

| Baseline | Description | How to run |
|----------|-------------|------------|
| A | Strong single worker | One worker with all relevant grants; `maxWorkers: 1` on the planner OR a single-worker plan |
| B | Static reasonable multi-worker | A fixed organization shape (not the planner's output); manually defined plan |
| C | Genesis organization WITHOUT learned patterns | `MissionOrchestrator({ planner: new OrganizationPlanner({ patterns: [] }) })` |
| Experiment | Genesis organization WITH promoted learned patterns | `MissionOrchestrator({ planner: new OrganizationPlanner({ patterns: promotedPatterns }) })` |

### Cohort 001 baseline schedule

Cohort 001 runs **Baseline C only** (no patterns) for all missions. This establishes the baseline organizational behavior across diverse families. Baseline A (single worker) is run on a sample of missions where single-worker is plausible (L1 missions). Baseline B is optional.

### Cohort 002+ baseline schedule

Before/after comparison: Baseline C (no patterns) vs Experiment (with patterns) on equivalent mission-family conditions.

### Baseline integrity

- Baselines use the SAME mission inputs, SAME capabilities, SAME verification checks.
- Only the organization (plan + patterns) differs.
- The reasoning provider is the SAME (scripted or real LLM) across arms for a given mission.

---

## 3. Metrics

### Primary metric hierarchy (lexicographic / gated)

**TIER 1 — CORRECTNESS (hard gate)**
- Mission status: success (must be `success` or `partial`, never fabricated)
- Verification ok: `true`
- No false success (a mission that appears successful but has incorrect output)
- Required obligations satisfied (flight-action checks pass)

**TIER 2 — RELIABILITY**
- Retries (fewer is better, among correct missions)
- Failures (fewer is better)
- Recovery (did the mission recover from a worker failure?)
- Variance across similar missions (lower is better)

**TIER 3 — EFFICIENCY**
- Reasoning operations (worker_reasoning_calls)
- Worker count (organization.workerCount)
- Tool calls (count of worker-step events with ok=true)
- Latency (outcome.wallMs)
- Monetary cost (if available; currently zeros from providers)

**TIER 4 — ORGANIZATIONAL QUALITY**
- Unnecessary roles (workers with artifactsCount=0)
- Coordination overhead (collaborationEdges count, handoff_calls)
- Unused capabilities (grants in genome.tools never invoked)
- Organizational complexity (workerCount + collaborationEdges)

### Decision rule: "Better Organization"

An organization B is BETTER than organization A if and only if:

1. **Correctness gate:** B's mission status is `success` (or at least as good as A's). If B fails where A succeeded, B is NOT better.
2. **Verification gate:** B's verification ok is `true` (or at least as good as A's). If B fails verification where A passed, B is NOT better.
3. **Obligation gate:** B satisfies all mission obligations (or at least as many as A). If B misses an obligation A satisfied, B is NOT better.
4. **Among missions satisfying gates 1–3:** B is better if it is more efficient (fewer workers, fewer reasoning calls, lower latency) OR more reliable (fewer retries, lower variance) OR simpler (fewer unnecessary roles, less coordination overhead).

**An organization that is cheaper but wrong is NOT better.**

### What is NOT reduced to a single score

Do NOT reduce everything to one arbitrary weighted score. The lexicographic/gated evaluation above preserves the priority: correctness > obligations > verification > reliability > efficiency.

---

## 4. Before/After Comparison

For transfer experiments (Cohort 003+), preserve enough evidence to compare:

### BEFORE LEARNING (Baseline C)

- Run the transfer mission's equivalent with NO patterns.
- Record: organization, workers, reasoning calls, tool calls, verification result, artifacts, experience.

### AFTER LEARNING (Experiment)

- Run the transfer mission WITH promoted patterns.
- Record: same dimensions.
- The `LearnedPatternInfluence` on the plan records which patterns were considered and applied.

### Comparison dimensions

| Dimension | Before | After | Delta |
|-----------|--------|-------|-------|
| Mission status | | | |
| Verification ok | | | |
| Obligations satisfied | | | |
| Worker count | | | |
| Reasoning calls | | | |
| Tool calls | | | |
| Retries | | | |
| Latency (wallMs) | | | |
| Human interventions | | | |
| Failure modes | | | |
| Unnecessary roles | | | |
| Coordination overhead | | | |

**Never optimize worker count at the expense of correctness.**

---

## 5. Blind Transfer

At least one future evaluation (Cohort 003) must be BLIND.

### During blind transfer

Genesis MAY access:
- Current mission inputs (the transfer mission's data, goal, context)
- Previously promoted legitimate patterns (retrieved via RulePatternRetriever)
- Normal tools/capabilities (OpenBot, MCP, etc.)

Genesis must NOT access:
- Gold answer
- Transfer expected organization
- Hidden evaluator notes
- Future transfer outcomes
- Test-specific solution hints

### Observer discipline

The observer (the human or script running the experiment) must NOT:
- Tell the worker the answer
- Inject MCP output into the worker prompt
- Repair the mission while it is running
- Manually invoke the capability on behalf of the worker
- Modify the expected answer after seeing the output

If intervention occurs:
- Record it.
- Do NOT classify the run as clean blind evidence.

---

## 6. Pattern Promotion Rules

### Promotion states (conceptual)

```
OBSERVATION (Experience captured)
    ↓
CANDIDATE (generated by StatisticalCandidateGenerator)
    ↓
SUPPORTED (≥2 supporting experiences, no contradictions)
    ↓
PROMOTED (RuleCandidateEvaluator status='promoted')
    ↓
VALIDATED_BY_TRANSFER (future: transfer mission improves with the pattern applied)
```

### Current promotion rule (RuleCandidateEvaluator)

1. **PROMOTE** when supportCount ≥ promotionThreshold (default 2) AND no contradiction AND verification quality is success or mixed (at least one verified success).
2. **REJECT** when there is at least one contradicting experience OR every supporting experience failed verification.
3. **Otherwise RETAIN as tentative.**

### Evidence authority

- LLM confidence alone can NEVER promote organizational knowledge.
- The evaluator reads ONLY experience evidence.
- Promotion is auditable: the Evaluation record cites the counts and the rule that fired.
- Repetition + evidence + successful transfer must carry more authority than one anecdotal success.

### Negative learning

- `avoid-role` / `avoid-shape` candidates are first-class.
- A candidate that says "do NOT use this pattern under these conditions" is evaluated by the same rules and promoted the same way.
- No separate failure-learning subsystem.
- Do not let one failure permanently ban a role — the evaluator requires contradiction across multiple experiences.

### Contradictory experience

- Patterns carry `applicableContext` (domain, capabilityNeeds).
- The evaluator scans the full experience set for same-domain experiences where the target role behaved opposite to the hypothesis.
- A single structural disconfirmation rejects an absolute hypothesis.
- Patterns should carry meaningful applicability context to avoid universalizing context-specific findings.

---

## 7. Reproducibility

Every evidence-bearing Academy run records:

| Record | Source |
|--------|--------|
| Mission definition | Experiment manifest (mission goal, inputs, capabilities) |
| Inputs | MissionInput files (staged into worker workspace) |
| Available capabilities | Genome grants, operationalNeeds |
| Organization selected | OrganizationPlan (flight event: plan-created) |
| Patterns available | Promoted patterns list |
| Patterns applied | LearnedPatternInfluence on plan |
| Worker genomes | flight event: genomes-compiled |
| Provider mode | Experience.provenance.source (`real-mission` or `synthetic`) |
| Reasoning count | flight event: mission-finished (worker_reasoning_calls) |
| Tool/action evidence | flight events: worker-step |
| Verification result | flight event: verification |
| Artifacts | WorkerResult.artifacts + Evidence[] |
| Experience record | Experience (schemaVersion 2) |
| Learning candidates | LearningCandidate[] |
| Promotion decision | Evaluation[] |
| Runtime versions | package.json, Node version |

Do NOT record: secrets, tokens, private chain-of-thought, unrestricted worker scratchpads.

### Evidence ledger

The existing **Flight Recorder** (JSONL per mission) + **Experience Store** (one Experience per mission) + **experiment artifacts** (evidence directory) already provide sufficient evidence.

**Do NOT build a new "Academy Evidence Platform."** Compose existing evidence sources. A tiny cohort manifest/index is enough.

---

## 8. Failure Classification

### Mission failure types

| Type | Description | Evidence |
|------|-------------|----------|
| Worker failure | A worker's own run failed (status='failure') | WorkerResult.status |
| Verification failure | AcceptanceChecks failed | VerificationResult.ok=false |
| Step budget exhausted | Worker did not finish within maxSteps | WorkerResult.summary contains "step budget" |
| Capability gap | No canonical owner satisfies a capability need | GenomeCompilation.ok=false |
| Timeout | Mission exceeded missionTimeoutMs | AbortController aborted |
| False success | Mission appeared successful but output was incorrect | Independent comparison with expected answer |

### False-success pressure

Cohort 001 includes missions where false success is possible:
- Missing source evidence (worker fabricates a result without reading the input)
- Unverified calculation (worker reports a number without computing it)
- Failed capability (worker claims to have used a tool but never invoked it)
- Incomplete artifact (artifact exists but is empty or wrong)
- Contradictory sources (worker picks one source, ignores the contradiction)

The Academy must reward organizations that PREVENT false success — not merely organizations that finish quickly.

### Failure evidence in learning

- Experiences with `outcome.status === 'failure'` or `verification.ok === false` are captured.
- These feed the evaluator's `verificationQuality` assessment (failure/mixed/success).
- `allSupportFailed` rule: rejects a candidate when every supporting experience failed verification.
- Contradiction mechanism: same-domain experiences with divergent outcomes provide negative evidence.

---

## 9. Stop-Learning Rule

Genesis must be allowed to conclude: **"NO RELIABLE PATTERN YET."**

This is a valid outcome. Do not force candidate promotion because the Academy expects learning.

- If supportCount < promotionThreshold → candidate stays `tentative`.
- If contradictions exist → candidate is `rejected`.
- If verification quality is `failure` → candidate is `rejected`.
- If no candidates are generated (no redundant/valuable role signals) → no patterns promoted.

"Insufficient evidence" is scientifically stronger than fake improvement.

---

## 10. Regression Control (future)

A newly promoted pattern may improve one mission but damage another.

### Future pattern lifecycle

| State | Transition |
|-------|------------|
| PROMOTED | Default after evaluation |
| CONFIRMED | After successful transfer (Cohort 003) |
| CONTEXT_RESTRICTED | Narrowed applicability when a contradiction appears in a different context |
| DOWNGRADED | Moved back to tentative when contradictory evidence accumulates |
| SUPERSEDED | Replaced by a more specific or better-supported pattern |
| RETIRED | Removed from the active pattern set |

### Current architecture

The current architecture supports PROMOTED and REJECTED (via the evaluator). CONFIRMED, CONTEXT_RESTRICTED, DOWNGRADED, SUPERSEDED, and RETIRED are future lifecycle states. Do NOT implement full lifecycle in G5-03. Document the future requirement.

### Current mitigation

- Patterns are advisory — the planner may ignore them.
- The planner applies `avoid-role` only when capability needs are covered by another specialist (structural safety).
- A promoted pattern that later encounters contradictory evidence is not automatically downgraded, but the evaluator WILL reject new candidates that contradict existing patterns if the full experience set is re-evaluated.

---

## 11. Organizational Complexity Metric

A lightweight way to observe unnecessary organizational complexity.

### Dimensions (raw metrics, not a theoretical score)

| Dimension | Source | Interpretation |
|-----------|--------|----------------|
| Worker count | Experience.organization.workerCount | More workers = more coordination overhead |
| Role count | Experience.organization.roles.length | Distinct roles (may equal worker count) |
| Collaboration edges | Experience.organization.collaborationEdges | More edges = more handoff overhead |
| Coordination reasoning | flight event: handoff_calls | Reasoning calls consumed by handoffs |
| Unused workers | contributions with artifactsCount=0 AND reasoningCalls=0 | Worker created but contributed nothing |
| Unused grants | genome.tools entries never invoked in flight events | Tool granted but never used |
| Unused operational surfaces | operationalNeeds declared but providerInvocations empty | Surface provisioned but never invoked |
| Duplicate work | multiple workers producing the same artifact | Redundant work |

### Cohort 001 observation

Cohort 001 records all raw dimensions (they are already in Experience v2 or derivable from flight events). No composite score is computed. Raw metrics are more useful initially — they reveal specific inefficiencies, not an opaque number.

---

## 12. Unused Resources Are Evidence

The Academy should notice:

| Observation | Source | Learning signal |
|-------------|--------|-----------------|
| Worker created but contributed nothing | WorkerContribution with artifactsCount=0 | Candidate: `avoid-role` for this domain |
| Tool granted but never used | genome.tools vs flight events | Candidate: `avoid-grant` (future) |
| Surface provisioned but never invoked | operationalNeeds vs providerInvocations | Candidate: `avoid-need` (future, Level 5) |
| Handoff created no useful evidence | handoff_calls=0 or handoff result unused | Candidate: `avoid-coordination` (future) |
| Coordinator added no measurable value | coordinator contribution artifactsCount=0 | Candidate: `avoid-coordinator` for this domain (proven in Phase 4.11) |

### Current telemetry capability

- `WorkerContribution.artifactsCount` — YES, detects unused workers.
- `providerInvocations` — YES, detects unused surfaces (need declared but not invoked).
- `handoff_calls` in mission-finished — YES, detects handoff activity.
- Coordinator value — YES, derivable from contributions (if coordinator's artifactsCount=0, it added no deliverable).

### Conclusion

Current telemetry CAN expose unused resources. No new instrumentation needed for Cohort 001. The `StatisticalCandidateGenerator.detectRedundantRoles()` already uses `artifactsCount=0` as the redundancy signal.
