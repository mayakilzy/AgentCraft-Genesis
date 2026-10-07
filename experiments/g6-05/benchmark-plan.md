# G6-05 — Final Benchmark Plan

**Mission:** G6-05 — FINAL BENCHMARK & EVIDENCE-BASED CLAIMS
**Branch:** `build/group-06-productionization`
**Source HEAD (start of G6-05):** `15243efae798f2ef90ec3a2ea185b17e798858fc`
**Authoritative repo:** `https://github.com/mayakilzy/AgentCraft-Genesis.git`

This document defines the compact, fair, evidence-first benchmark plan
G6-05 will execute. It extends the existing harness where possible, adds
no new production modules, and adds no runtime dependencies.

## 1. Scope — What G6-05 Will and Will NOT Do

### Will
- Audit historical evidence (G1..G6) and classify each artifact by
  evidence level (E1..E5) per Section 4 of the mission spec.
- Run a small number (5) of carefully selected NEW bounded experiments
  (A..E below). Experiment F is an interoperability AUDIT of existing
  evidence — no new external calls.
- Produce four artifacts: `benchmark-results.json`, `evidence-ledger.json`,
  `claims-registry.json`, `final-analysis.md`.

### Will NOT
- Make paid external API calls. Per Section 23, default G6-05 to zero
  external paid calls. Existing persisted real-provider evidence
  (G6-03/G6-03B real Jev, Phase 4.8A/C/E real LLM) is reused as
  evidence; no new Jev, OpenRouter, or ZAI calls are authorized.
- Build a new benchmark framework. Reuse the G6-04 smoke harness,
  MemoryComputer, MemoryFlightRecorder, the existing learning
  experience-store / pattern / candidate-generator / evaluator, and
  existing verification loop.
- Add production modules. `NEW_PRODUCTION_FILES = 0`,
  `NEW_RUNTIME_DEPENDENCIES = 0` (target).
- Declare Engine v1.0. G6-05 only authorizes G6-06 closure.

## 2. Evidence Levels (per mission spec Section 4)

| Level | Definition |
|-------|------------|
| E1 | Independently reproducible from documented commit + config, with real execution and independent verification |
| E2 | Real observed execution (mission succeeded) but reproducibility across independent envs not established |
| E3 | Controlled experimental evidence (deterministic/scripted), valid only for tested behavior |
| E4 | Historical reported evidence (persisted report without supporting artifacts for independent verification) |
| E5 | Unsupported assertion |

A claim's evidence level must NOT exceed what its weakest essential supporting component establishes.

## 3. New Experiments (A..E)

### Experiment A — Goal → Organization (controlled, real production code)

**Research question:** Can Genesis transform a meaningful goal into an
executable worker organization whose structure genuinely varies with
the goal (different domains → different organizations) and whose
capability needs are fully covered?

**Hypothesis (H_A):** The real GoalCompiler + OrganizationPlanner +
GenomeCompiler pipeline produces an organization whose (domain,
capabilityNeeds, worker count, role set) varies meaningfully across at
least 3 distinct non-trivial goals, with full capability coverage.

**Independent variable:** goal text (3 distinct goals from 3 distinct
mission domains: software-engineering, diagnostic, research).

**Controlled variables:** RuleDecisionProvider, MemoryComputer, no
learning patterns, deterministic GoalCompiler v0.1.

**Comparator:** NONE. We do NOT compare against a fixed/static
organization baseline because the production harness does not ship
one. Per Section 17, an artificial baseline would be a deliberately
weakened competitor; we report absolute capability evidence instead.

**Test missions (real, non-trivial):**
- A1 — software-engineering: "Audit and improve the README in this repo
  by adding a Usage section; verify it parses as valid markdown."
- A2 — diagnostic: "Diagnose the intermittent test failure in the
  flaky counter module and document the root cause."
- A3 — research: "Research and document the three most important
  differences between REST and gRPC, as a short markdown brief."

**Metrics:** domain, capabilityNeeds, workerCount, roleSet,
capabilityCoverage (all needs have an owner?), coordinatorAdded,
genomeTierAssignments, unsupportedAssumptions, planningFailures,
executionReadiness (genome compiled without error).

**Repetition:** 1 run per goal (deterministic). 3 total runs.

**Expected cost:** USD 0 (deterministic core, no external calls).

**Evidence output:** `experiments/g6-05/exp-A/results.json`.

**Limitations:** Organization is generated but NOT executed in this
experiment; execution is Experiment B. The GoalCompiler is the
deterministic v0.1 heuristic; LLM-based understanding is not exercised.

**Evidence level target:** E3 (controlled, scripted reasoning not
needed for planning; the planning path is real production code that
could in principle be reproduced in any clean checkout, but
independent env reproducibility is not the focus of this experiment;
G6-04 already covers that for the smoke mission path).

### Experiment B — End-to-End Execution (real worker actions, independent verification)

**Research question:** Does the generated organization produce a
verified outcome through the full Genesis chain, with real worker
actions on the MemoryComputer and independent verification?

**Hypothesis (H_B):** Genesis executes a non-trivial mission end-to-end
(goal → requirements → organization → genome → worker real actions →
artifact → independent verification) and the mission succeeds with no
false-success path.

**Independent variable:** mission type (deterministic core).

**Controlled variables:** RuleDecisionProvider, MemoryComputer,
DEVELOPMENT_REASONING_FALLBACK reasoning (clearly labeled), single
worker, MemoryFlightRecorder.

**Comparator:** NONE for superiority. We compare against the truth
criterion: artifact correctness + verification pass.

**Test mission (non-trivial but bounded):**
A multi-file software-engineering mission: "Generate two markdown
files: `greet.md` with content `# Greetings from Genesis` and
`farewell.md` with content `# Farewell from Genesis`. Both files must
have a single H1 heading."

This is non-trivial because it requires:
- Multiple file writes (planning a 2-artifact goal).
- File-existence + content correctness verification on BOTH files.
- Independent verification on the clean-room copies.

The worker's ScriptedReasoningProvider emits two `write_file` actions
then `finish`. The Genesis production code (WorkerAgent action loop,
grant checking, anti-degenerate-loop, success-verification,
VerificationLoop clean-room copy, hash-match check) runs unmodified.

**Metrics:** mission_status, verification_passed, verification_failed,
worker_actions_executed, reasoning_calls, retries, flight_event_count,
false_success_observed (must be 0), artifact_correctness (both files
correct in clean-room copy).

**Repetition:** 3 runs (deterministic, confirms repeatability).

**Expected cost:** USD 0.

**Evidence output:** `experiments/g6-05/exp-B/results.json`.

**Limitations:** Deterministic reasoning; the worker's actions are
scripted. This is real Genesis production behavior on a controlled
reasoning stub, NOT real-LLM evidence. It complements (does not
replace) Phase 4.8A/E real-LLM evidence for the end-to-end claim.

**Evidence level target:** E3 (controlled; full chain real but
deterministic).

### Experiment C — Organizational Learning (control vs treatment, same goal/provider/tools)

**Research question:** Does an applicable validated learned pattern
reduce organizational complexity (worker count) while preserving
verification correctness, under controlled conditions with the same
goal, provider, tools, and runtime?

**Hypothesis (H_C):** With a trusted prefer-role: Sole Operator
pattern available for the goal's domain, the OrganizationPlanner
collapses a multi-specialist baseline organization into a single
Sole Operator, while verification correctness is preserved (both arms
PASS the same checks).

**Independent variable:** learned-pattern availability.

- CONTROL arm: `OrganizationPlanner({ patterns: [] })` — empty pattern set.
- TREATMENT arm: `OrganizationPlanner({ patterns: [patternForDomain] })`.

**Controlled variables:** goal text, RuleDecisionProvider,
MemoryComputer, DEVELOPMENT_REASONING_FALLBACK reasoning,
MemoryFlightRecorder, verification checks (same in both arms), budgets.

**Test mission:** A research-domain mission with two capability needs
(web-research, document-authoring) that historically triggered the
multi-specialist baseline (Web Researcher + Report Writer). The
trusted pattern is
`cand-research-document-authoring-prefer-sole-operator` (frozen in
`experiments/academy/g5-07/frozen-pattern-state.json`, support=3).

**Metrics:** workerCount (control vs treatment), roleSet (control vs
treatment), pattern_considered, pattern_applied, organization_changed,
verification_passed (control vs treatment), verification_failed,
reasoning_calls (control vs treatment), false_success (must be 0).

**Repetition:** 3 runs per arm (deterministic, confirms repeatability).

**Expected cost:** USD 0.

**Evidence output:** `experiments/g6-05/exp-C/results.json`.

**Limitations:** Scripted reasoning — the worker's actions are the
same in both arms; only the organizational shape differs. The
measured "complexity reduction" is structural (worker count, role
count), not behavioral (reasoning quality, token cost). This is the
exact limitation the mission spec Section 11 requires us to disclose:
"A reduction in worker count is not automatically proof of lower
real-world cost." We respect this and report structural reduction
only.

**Evidence level target:** E3 (controlled, scripted reasoning, same
limitation as G5-06).

### Experiment D — Transfer & Non-Applicability

**Research question:** Does Genesis apply learned patterns to
relevant unseen tasks WITHOUT blindly applying them to unrelated
tasks?

**Hypothesis (H_D):** Genesis retrieves and considers an applicable
pattern for an unseen research mission (CONFIRMATORY_TRANSFER or
ACTIVE_TRANSFER) AND retrieves no pattern for an unseen
software-engineering mission (NON_APPLICABLE), with mission
correctness preserved in both cases.

**Independent variable:** mission domain (research vs software-engineering).

**Controlled variables:** RuleDecisionProvider, MemoryComputer,
DEVELOPMENT_REASONING_FALLBACK, frozen pattern state (3 trusted
research/general patterns; 0 software-engineering patterns).

**Test missions (held-out, never used to create the patterns):**
- D1 — research (applicable): "Investigate and document the three
  most important differences between REST and gRPC."
- D2 — software-engineering (non-applicable): "Implement a function
  `add(a, b)` that returns the sum, and verify it passes a test."

The transfer set integrity audit (G5-07 sealed-set-integrity.json)
confirmed C001-02 and C001-06 were not used to create any pattern.
Our D1 and D2 are NEW mission wordings distinct from C001-02/06.

**Metrics:** patterns_available, patterns_retrieved (D1 vs D2),
pattern_applicable (D1 vs D2), pattern_applied (D1 vs D2),
organization_changed (D1 vs D2), verification_passed,
harmful_transfer (must be 0).

**Repetition:** 1 run per mission per arm (control + treatment).

**Expected cost:** USD 0.

**Evidence output:** `experiments/g6-05/exp-D/results.json`.

**Limitations:** The pattern retrieval is structural (intersection
rule) — confirmatory retrieval is NOT active causal transfer. This
matches the G5-07 finding (0 ACTIVE_TRANSFER, 3 CONFIRMATORY_TRANSFER,
1 NON_APPLICABLE). We do not claim more.

**Evidence level target:** E3.

### Experiment E — Failure Truthfulness

**Research question:** Does Genesis avoid declaring success when
required work has not been verified, across the failure modes that
the deterministic core can exercise without external providers?

**Hypothesis (H_E):** Across 5 failure-injection scenarios, Genesis
reports `mission_status != 'success'` AND `verification.ok = false`
AND `false_success_observed = 0` for every failure mode.

**Independent variable:** injected failure mode.

**Failure scenarios:**
- E1 — worker action fails: ScriptedReasoningProvider returns an
  unknown action → worker fails → mission fails.
- E2 — required artifact missing: worker writes nothing and finishes
  → verification cannot find the artifact → mission fails.
- E3 — artifact contents incorrect: worker writes the wrong content
  → verification's `expectIncludes` check fails → mission fails.
- E4 — verification hash-mismatch: worker writes content whose
  SHA-256 differs from `expectHash` → hash-match check fails →
  mission fails.
- E5 — verification gates explicitly fail: an `expectIncludes`
  check for an absent substring proves the failure is reported
  truthfully.

**Controlled variables:** same production code, same MemoryComputer,
same MemoryFlightRecorder, deterministic execution.

**Metrics:** for each scenario: injected_failure_class, mission_status
(must NOT be 'success'), verification_ok (must be false),
false_success_observed (must be 0), evidence_preserved (flight
records still complete), retry_behavior (if any).

**Repetition:** 1 run per scenario. 5 total runs.

**Expected cost:** USD 0.

**Evidence output:** `experiments/g6-05/exp-E/results.json`.

**Limitations:** Deterministic failure injection. Does NOT exercise
the optional-provider-unavailable case (Jev) directly — that case is
covered by G6-03A's persisted evidence (7 failure-truthfulness probes
all PASS).

**Evidence level target:** E3.

## 4. Experiment F — Interoperability Audit (NO new external calls)

Experiment F is an AUDIT of EXISTING persisted evidence for:
OpenBot, OpenDots, OpenMuse, MCP, AG-UI, A2A, Jev.

For each integration:
- Reference the strongest persisted evidence file.
- Classify as `REFERENCE_INTEGRATION_PROVEN`,
  `REAL_PROVIDER_INTEGRATION_PROVEN`, or
  `PRODUCTION_SCALE_NOT_PROVEN`.
- Note known limitations explicitly.

This experiment runs NO new code. It is a structured review.

**Evidence output:** `experiments/g6-05/exp-F/audit.json`.

## 5. Fairness Rules (per Section 8)

For each controlled comparison (Experiment C and D):
- Same goal text in both arms.
- Same input data (where applicable).
- Same allowed capabilities.
- Same runtime environment.
- Same verification criteria.
- Same reasoning provider.
- Same model configuration (none — scripted).
- Same resource limits (maxWorkerSteps, missionTimeoutMs).
- Same time limits.
- Only the studied factor varies (pattern availability in C; mission
  domain in D).

If a fair comparison is impossible, we mark the experiment
INCONCLUSIVE — we do not silently substitute a different task.

## 6. Repetition & Uncertainty (per Section 16)

- For deterministic experiments (A, B, C, D, E), we run 3 independent
  repetitions to confirm repeatability and report median + range.
- We do NOT report a percentage from N=1. For N=3 we report `3/3
  verified successes` (not `100% reliability`).
- We do NOT extrapolate to production-scale reliability.

## 7. Evidence Ledger

Every reported metric will be linked to:
- `CLAIM_ID`
- `EXPERIMENT_ID`
- `RUN_ID`
- `SOURCE_COMMIT`
- `CONTROL_OR_TREATMENT`
- `METRIC`
- `VALUE`
- `EVIDENCE_PATH`
- `VERIFICATION_PATH`
- `LIMITATION`

Output: `experiments/g6-05/evidence-ledger.json`.

## 8. Claims Registry (per Section 19)

For each candidate claim C01..C16, we assign one of:
- `PROVEN` — supported directly by appropriate reproducible or real
  observed evidence within the stated scope.
- `PROVEN_WITH_LIMITATIONS` — supported for a bounded configuration,
  reference environment, or controlled experiment.
- `NOT_PROVEN` — insufficient evidence.
- `REJECTED` — contradicted by evidence or framed more broadly than
  the evidence permits.

Each claim includes:
- `CLAIM_ID`, `CLAIM_TEXT`, `STATUS`, `EVIDENCE_LEVEL`,
  `SUPPORTING_EXPERIMENTS`, `SCOPE`, `LIMITATIONS`,
  `APPROVED_PUBLIC_WORDING`, `PROHIBITED_WORDING`.

Output: `experiments/g6-05/claims-registry.json`.

## 9. Final Report

The final report (`experiments/g6-05/final-analysis.md`) returns the
report block specified in Section 31 of the mission spec, including:

- G6_05_STATUS (PASS / PASS_WITH_LIMITATIONS / FAIL / BLOCKED)
- HEAD values, baseline + final test counts, typecheck, lint, secret scan
- Audit summary (experiments audited, evidence level counts,
  inconsistencies)
- New benchmark summary (experiments, controlled comparisons, total
  runs, real vs scripted, external calls, cost)
- Per-experiment results (A..F)
- Mission success / verification / false-success counts
- Worker count / reasoning call / elapsed time / observed cost comparisons
- Claims proven / proven-with-limitations / not-proven / rejected
- Paths to claims registry, evidence ledger, benchmark results,
  final analysis
- Known limitations, unresolved evidence gaps, production code delta,
  runtime dependencies added
- Session credentials cleaned, remote URL clean
- SAFE_TO_BEGIN_G6_06 (YES/NO)
- NEXT_RECOMMENDED_ACTION

## 10. Anti-Bloat Targets

```
NEW_PRODUCTION_FILES = 0
NEW_RUNTIME_DEPENDENCIES = 0
NEW_PRODUCTION_MODULES = 0
NEW_TESTS = 0   (we are not adding new tests in this measurement phase)
```

All experiment code lives under `experiments/g6-05/` only.

## 11. Commit & Push Policy

Per Section 27:
- Use coherent commits only if repository changes are necessary.
- Evidence commits are sufficient (no production code changes needed).
- Before push: full tests PASS, typecheck PASS, lint PASS, secret scan
  PASS, worktree consistency PASS.
- After push: fetch remote, verify local and remote HEAD match.

## 12. Credential Policy

Per Section 28:
- The user's authorized temporary GitHub credential is used ONLY for
  pushing evidence commits.
- Credentials are stored in `/home/z/my-project/secure/` (gitignored).
- After final remote verification, the secure directory is deleted.
- We do not claim secure deletion beyond what the environment
  establishes (filesystem `rm`).

END OF G6-05 BENCHMARK PLAN.
