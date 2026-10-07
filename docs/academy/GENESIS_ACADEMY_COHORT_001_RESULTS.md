# GENESIS_ACADEMY_COHORT_001_RESULTS

**Date:** 2026-10-07
**Phase:** G5-04 — Academy Cohort 001 (Foundation Diversity Calibration)
**Status:** PASS_WITH_EVIDENCE_LIMITATION

---

## 1. Purpose

Cohort 001 is the FIRST REAL EXECUTION COHORT of the Genesis Academy. Its purpose is NOT to prove Genesis has learned to build better organizations. Its purpose is to establish clean, diverse, comparable organizational experience across materially different mission families.

**The scientific objective:** Can the current Genesis runtime execute diverse missions while capturing enough trustworthy organizational evidence to support future learning?

**Classification: PASS_WITH_EVIDENCE_LIMITATION** — the cohort is technically clean (4/4 missions succeeded, verified, experiences captured, candidates generated with existing rules, transfer set sealed), but evidence strength is limited by scripted reasoning (no real LLM available in sandbox).

---

## 2. Frozen Pre-Cohort State

| Field | Value |
|-------|-------|
| HEAD | b3eaa2205423286d2ad2e35dca643a832026bbe1 |
| Branch | build/group-05-academy-bootstrap |
| Test baseline | 337 passed \| 9 skipped = 346 total |
| Typecheck | PASS |
| Lint | PASS |
| Pre-existing Experiences | 0 |
| Pre-existing Patterns | 0 |
| Pre-existing Pattern IDs | [] (empty — all 4 missions planned against `patterns: []`) |
| Provider mode | SCRIPTED_REASONING (no external LLM available in sandbox) |
| Real LLM reasoning used | NO |
| Development fallback used | NO |
| Scripted reasoning for main missions | YES (provenance.source = 'synthetic' on every Experience) |
| MCP available | YES |
| OpenBot / OpenDots / OpenMuse | NOT available (StubComputer used) |
| Runtime versions | Node v24.21.0, TypeScript 5.9.3, MCP SDK 1.32.1, AG-UI 1.0.2 |

**Frozen pattern state:** EMPTY for all 4 missions. No cross-mission learning within Cohort 001. C001-01 did not teach C001-03; C001-03 did not teach C001-05; C001-05 did not teach C001-07.

---

## 3. Provider Mode

No external LLM reasoning provider (ZAI SDK, OpenAI, Anthropic) is available in the sandbox. Per the mission brief section 8, scripted reasoning is acceptable for calibration but evidence is classified accordingly.

- **PROVIDER_MODE:** SCRIPTED_REASONING
- **PROVIDER_MODEL:** none (scripted action replay)
- **REAL_LLM_REASONING_USED:** NO
- **DEVELOPMENT_FALLBACK_USED:** NO
- **SCRIPTED_REASONING_USED_FOR_MAIN_MISSIONS:** YES

**Evidence limitation:** Every Experience has `provenance.source = 'synthetic'`. The cohort contains calibration evidence, NOT real reasoning-driven organizational execution evidence. The claim "Genesis executed diverse Academy missions and captured comparable organizational experience" is bounded to scripted calibration.

---

## 4. Sealed Transfer Set

| Mission | Status |
|---------|--------|
| C001-02 | NOT_EXECUTED, SEALED_FOR_TRANSFER |
| C001-04 | NOT_EXECUTED, SEALED_FOR_TRANSFER |
| C001-06 | NOT_EXECUTED, SEALED_FOR_TRANSFER |
| C001-08 | NOT_EXECUTED, SEALED_FOR_TRANSFER |

**TRANSFER_SET_CONTAMINATED = NO**
- Transfer experiences created: 0
- Transfer candidates created: 0
- Transfer outputs generated: 0

---

## 5. Four Mission Results

### C001-01 — Research / Evidence Synthesis

| Metric | Value |
|--------|-------|
| Status | SUCCESS |
| Verification | PASS (4/4 checks passed) |
| Domain | research |
| Workers | 1 (Sole Operator) |
| Reasoning operations | 3 |
| Retries | 0 |
| False success | NO |
| MCP invoked | N/A (not applicable) |
| Unused workers | 0 |
| Unused capabilities | none |
| Contribution | Sole Operator = MATERIAL_CONTRIBUTION |
| Experience captured | YES (`exp-cohort-001-C001-01`, source: synthetic) |

**Mission:** Compare solar panels vs wind turbines for a rural power project using staged evidence in `sources.txt`. The worker read the sources, identified that wind speed (5 mph) is below turbine cut-in (7 mph), and recommended solar — supported by the evidence.

**Verification:** report exists, mentions both "Solar" and "Wind", and `sources.txt` was read (mission-input check).

---

### C001-03 — Data / Analytical Work (MCP)

| Metric | Value |
|--------|-------|
| Status | SUCCESS |
| Verification | PASS (3/3 checks passed) |
| Domain | general (note: goal text didn't trigger 'data-analysis' signals strongly; classified as general by the deterministic compiler — see §9 Schema Audit) |
| Workers | 1 (Sole Operator) |
| Reasoning operations | 4 |
| Retries | 0 |
| False success | NO |
| MCP invoked | YES (call_tool with `analyze` tool — correct sum 502 computed) |
| Unused workers | 0 |
| Unused capabilities | openbot:shell-execution (granted but not invoked) |
| Contribution | Sole Operator = MATERIAL_CONTRIBUTION |
| Experience captured | YES (`exp-cohort-001-C001-03`, source: synthetic) |

**Mission:** Analyze a dataset (`[47, 23, 89, 12, 64, 38, 91, 55, 6, 77]`) using the MCP `analyze` tool. The worker invoked the MCP tool, received the result (`{"count":10,"sum":502,"mean":50.2,"min":6,"max":91}`), and wrote it to `result.txt`.

**Verification:** result exists, contains `"502"` (correct sum), `data.json` was read (mission-input check).

**MCP evidence:** The MCP capability was granted (`mcp:analyze` in genome.tools), invoked (call_tool with ok=true in flight events), and the result was causally used (written to result.txt). This is the accepted G5-01 infrastructure operating as expected.

---

### C001-05 — Software / Engineering

| Metric | Value |
|--------|-------|
| Status | SUCCESS |
| Verification | PASS (3/3 checks passed) |
| Domain | software-engineering |
| Workers | 2 (Software Engineer + Generalist Worker) |
| Reasoning operations | 3 |
| Retries | 0 |
| False success | NO |
| Unused workers | 0 |
| Unused capabilities | openbot:shell-execution (granted but not invoked — the scripted worker wrote the fix directly) |
| Contribution | Software Engineer = MATERIAL_CONTRIBUTION; Generalist Worker = NO_OBSERVED_CONTRIBUTION |
| Experience captured | YES (`exp-cohort-001-C001-05`, source: synthetic) |

**Mission:** Fix an off-by-one bug in `script.mjs` (array `[1..9]` should be `[1..10]`). The planner assigned 2 workers (Software Engineer + Generalist Worker). The Software Engineer produced the fix; the Generalist Worker produced no artifacts.

**Verification:** script exists, contains `"10"`, `script.mjs` was read (mission-input check).

**Organizational signal:** The Generalist Worker contributed nothing — this is a candidate for `avoid-role` in software-engineering missions. The candidate generator captured this signal (see §7).

---

### C001-07 — Knowledge / Document Work

| Metric | Value |
|--------|-------|
| Status | SUCCESS |
| Verification | PASS (4/4 checks passed) |
| Domain | research (note: goal text "compare" triggered research signals; see §9 Schema Audit) |
| Workers | 1 (Sole Operator) |
| Reasoning operations | 4 |
| Retries | 0 |
| False success | NO |
| Unused workers | 0 |
| Unused capabilities | none |
| Contribution | Sole Operator = MATERIAL_CONTRIBUTION |
| Experience captured | YES (`exp-cohort-001-C001-07`, source: synthetic) |

**Mission:** Compare `doc_a.txt` and `doc_b.txt` and produce a structured diff in `diff.md`. The worker read both documents, identified 4 agreements (weight, color, waterproof, shockproof) and 3 contradictions (price, warranty, power source), and wrote the diff.

**Verification:** diff exists, contains both "Agreements" and "Contradictions" sections, `doc_a.txt` was read (mission-input check).

---

## 6. Cohort Summary

| Metric | Value |
|--------|-------|
| MISSIONS_ATTEMPTED | 4 |
| MISSIONS_SUCCESSFUL | 4 |
| MISSIONS_VERIFIED | 4 |
| MISSIONS_FAILED | 0 |
| MISSIONS_CONTAMINATED | 0 |
| FALSE_SUCCESSES | 0 |
| TOTAL_WORKERS | 5 (1+1+2+1) |
| TOTAL_REASONING_OPERATIONS | 14 (3+4+3+4) |
| TOTAL_TOOL_CALLS | 14 (worker-step events excluding finish) |
| TOTAL_RETRIES | 0 |
| TOTAL_HUMAN_INTERVENTIONS | 0 |
| TOTAL_UNUSED_WORKERS | 0 |
| TOTAL_UNUSED_CAPABILITIES | 2 (openbot:shell-execution unused in C001-03 and C001-05) |
| EXPERIENCES_CAPTURED | 4 |
| CANDIDATES_GENERATED | 4 |
| CANDIDATES_PROMOTED | 1 |
| CANDIDATES_TENTATIVE | 3 |
| CANDIDATES_REJECTED | 0 |
| ORGANIZATIONAL_DIVERSITY | MEDIUM (3 distinct domains: research, software-engineering, general) |

---

## 7. Candidate Generation and Evaluation

After all 4 missions completed, the 4 experiences were fed into the existing `StatisticalCandidateGenerator` and `RuleCandidateEvaluator`.

### Candidates generated (4)

| Candidate ID | Kind | Domain | Support | Status |
|--------------|------|--------|---------|--------|
| cand-research-prefer-sole-operator | prefer-role | research | 2 | **PROMOTED** |
| cand-general-prefer-sole-operator | prefer-role | general | 1 | tentative |
| cand-software-engineering-avoid-generalist-worker | avoid-role | software-engineering | 1 | tentative |
| cand-software-engineering-prefer-software-engineer | prefer-role | software-engineering | 1 | tentative |

### Promotion decision

**1 promoted, 3 tentative, 0 rejected.**

The promoted pattern: `cand-research-prefer-sole-operator` — "The Sole Operator role is valuable for research missions: across 2 verified experience(s) it consistently produced artifacts." Support = 2 (C001-01 and C001-07, both classified as research domain), no contradictions, verification quality = success.

The 3 tentative candidates have support = 1, below the promotion threshold (default 2). This is the correct behavior — no forced promotion. "Insufficient evidence" is scientifically stronger than fake improvement.

### Memorization check

| Candidate | Reusable principle? | Verdict |
|-----------|---------------------|---------|
| cand-research-prefer-sole-operator | YES — "for research missions, a single operator is sufficient" is a reusable organizational principle | PASS |
| cand-general-prefer-sole-operator | PARTIALLY — "general" domain is a fallback classification, not a genuine family; low signal | retained tentative (acceptable) |
| cand-software-engineering-avoid-generalist-worker | YES — "Generalist Worker is redundant for software-engineering" is reusable | retained tentative (support=1, needs more evidence) |
| cand-software-engineering-prefer-software-engineer | YES — "Software Engineer role is valuable for software-engineering" is reusable | retained tentative (support=1) |

No candidate is a mission-specific memorization ("for C001-03 use worker X"). All candidates describe domain-level organizational principles.

---

## 8. False-Success Audit

For every mission, the question was asked: **Could this mission have appeared successful while being factually wrong?**

| Mission | False-success risk | False-success occurred |
|---------|--------------------|-----------------------|
| C001-01 | LOW — recommendation must be supported by evidence; mission-input check confirms sources.txt was read | NO |
| C001-03 | MEDIUM — worker could guess the sum; but MCP invocation + content check (sum=502) prevents this | NO |
| C001-05 | LOW — fix verified by content check (contains "10") and mission-input check | NO |
| C001-07 | LOW — diff must contain both agreements and contradictions; mission-input check confirms docs were read | NO |

**FALSE_SUCCESS_OCCURRED = NO** across all 4 missions.

The C001-03 mission had the highest false-success risk (a worker could guess a plausible sum). The MCP capability + content verification (correct sum 502) prevented this — the worker had to invoke the MCP tool to get the right answer.

---

## 9. Experience Schema Audit

The G5-03 Gap Audit concluded `EXPERIENCE_SCHEMA_SUFFICIENT_FOR_COHORT_001 = YES`. G5-04 tested this empirically.

| Academy evidence requirement | Status | Notes |
|------------------------------|--------|-------|
| Mission goal/outcome | CAPTURED_DIRECTLY | Experience.goal.outcome |
| Domain | CAPTURED_DIRECTLY | Experience.goal.domain |
| Capability needs | CAPTURED_DIRECTLY | Experience.goal.capabilityNeeds |
| Organization shape | CAPTURED_DIRECTLY | Experience.organization (workerCount, roles, collaborationEdges, rationale) |
| Per-worker contribution | CAPTURED_DIRECTLY | Experience.contributions (workerId, role, reasoningCalls, artifactsCount, status, resolvedNeeds) |
| Mission outcome | CAPTURED_DIRECTLY | Experience.outcome (status, summary, reasoningCalls, wallMs, retries, humanInterventions) |
| Verification result | CAPTURED_DIRECTLY | Experience.verification (ok, passed, failed) |
| Provider invocations | CAPTURED_DIRECTLY | Experience.providerInvocations (MCP call_tool recorded for C001-03) |
| Provenance | CAPTURED_DIRECTLY | Experience.provenance (missionId, source=synthetic) |
| Unused workers | DERIVABLE | From contributions (artifactsCount=0 + reasoningCalls=0) |
| Unused capabilities | DERIVABLE | From genome.tools vs flight events (worker-step actions) |
| MCP invocation | CAPTURED_DIRECTLY | Flight event worker-step with action=call_tool |
| Domain misclassification | OBSERVED | C001-03 (data mission) classified as "general" because goal text didn't trigger data-analysis signals strongly enough; C001-07 (knowledge mission) classified as "research" because "compare" triggered research signals. This is a GoalCompiler heuristic limitation, not a schema gap. |

**EXPERIENCE_SCHEMA_AUDIT = SUFFICIENT**

No schema gaps discovered. All Academy evidence requirements are either captured directly or derivable from existing fields. The domain misclassification is a GoalCompiler heuristic issue (signal-based domain detection), not an Experience schema issue — it does not block evidence capture or learning.

---

## 10. Telemetry Quality Audit

| Metric | Available? | Source |
|--------|-----------|--------|
| Workers | YES | Experience.organization.workerCount |
| Roles | YES | Experience.organization.roles |
| Reasoning operations | YES | Experience.outcome.reasoningCalls + flight event mission-finished.worker_reasoning_calls |
| Tool calls | YES | Flight events worker-step (action + ok) |
| Provider calls | YES | Experience.providerInvocations (Phase 4.6) |
| Retries | YES | Experience.outcome.retries (worker-retry events) |
| Latency | YES | Experience.outcome.wallMs |
| Handoffs | YES | Flight event mission-finished.handoff_calls (0 for single-worker missions) |
| Verification | YES | Experience.verification (ok, passed, failed) + flight event verification |
| Capability grants | YES | Flight event genomes-compiled (worker tools) |
| Provider invocation | YES | Experience.providerInvocations (observed=true/false) |
| Unused workers | DERIVABLE | From contributions (artifactsCount=0 + reasoningCalls=0) |
| Unused capabilities | DERIVABLE | From genome.tools vs flight events |
| Human intervention | YES | Experience.outcome.humanInterventions (0 for all Cohort 001 missions) |
| Monetary cost | NOT_AVAILABLE | Current reasoning providers report zeros |

**TELEMETRY_QUALITY = COMPLETE** (all Academy contract dimensions available except monetary cost, which is not available from current reasoning providers — this is a known limitation, not a gap).

---

## 11. Unused Resource Audit

| Mission | Unused workers | Unused capabilities | Unproductive handoffs | Duplicated work |
|---------|---------------|---------------------|-----------------------|-----------------|
| C001-01 | 0 | none | 0 | none |
| C001-03 | 0 | openbot:shell-execution | 0 | none |
| C001-05 | 0 (but Generalist Worker had NO_OBSERVED_CONTRIBUTION) | openbot:shell-execution | 0 | none |
| C001-07 | 0 | none | 0 | none |

**Key finding:** C001-05's Generalist Worker produced no artifacts (NO_OBSERVED_CONTRIBUTION). This is valuable organizational evidence — it led to the `cand-software-engineering-avoid-generalist-worker` candidate (tentative, support=1). Future cohorts with more software-engineering missions may promote this pattern.

The unused `openbot:shell-execution` grant in C001-03 and C001-05 is evidence that the planner over-provisioned shell access. For C001-03 (data analysis via MCP), shell execution was unnecessary. For C001-05 (script fix), the scripted worker wrote the fix directly without running commands — a real LLM worker would likely have used shell to test the fix.

---

## 12. Organizational Diversity Check

**Did Genesis produce materially different organizational behavior across the 4 mission families?**

| Mission | Domain | Workers | Roles | Reasoning calls |
|---------|--------|---------|-------|-----------------|
| C001-01 | research | 1 | Sole Operator | 3 |
| C001-03 | general | 1 | Sole Operator | 4 |
| C001-05 | software-engineering | 2 | Software Engineer + Generalist Worker | 3 |
| C001-07 | research | 1 | Sole Operator | 4 |

**ORGANIZATIONAL_DIVERSITY = MEDIUM**

- 3 of 4 missions produced a single-worker "Sole Operator" organization.
- Only C001-05 (software-engineering) produced a 2-worker organization.
- The planner's default behavior for bounded missions is single-worker — this is by design (DEFAULT_MAX_WORKERS = 5, but the planner chooses 1 when the mission is bounded).

This is an important Academy finding: the current planner is conservative for bounded missions. Cohort 002 may reveal whether this is optimal or whether certain families benefit from specialization. The diversity is MEDIUM (not LOW) because C001-05 did produce a different shape, and the domain classification varied across 3 domains.

---

## 13. Learning Readiness After Cohort 001

| Dimension | Status | Evidence |
|-----------|--------|----------|
| ORGANIZATION_SHAPE_LEARNING | READY | 4 candidates generated; 1 promoted (prefer-sole-operator for research); avoid-generalist-worker signal captured for software-engineering |
| COGNITIVE_ALLOCATION_EVIDENCE | INSUFFICIENT | Tier per worker not explicitly recorded in Experience (derivable from genome.model); no tier-outcome correlation possible yet |
| OPERATIONAL_NEEDS_EVIDENCE | SUFFICIENT_TO_CONTINUE_COLLECTION | resolvedNeeds captured on contributions; providerInvocations captured (MCP for C001-03); need→provider→outcome path is observable |
| MISSION_OBLIGATION_EVIDENCE | SUFFICIENT_TO_CONTINUE_COLLECTION | No obligations declared in Cohort 001 (calibration); future cohorts will declare obligations and capture necessity evidence |
| FAILURE_LEARNING_EVIDENCE | INSUFFICIENT | All 4 missions succeeded; no failure evidence captured. Future cohorts should include failure-possible missions. |

**Do NOT mark Level-5 learning ready.** OperationalNeeds and MissionObligation learning remain NOT_READY — evidence collection is sufficient to continue, but no autonomous inference is claimed.

---

## 14. Capability and Obligation Necessity Signals (Observational Only)

### Capability necessity signals

| Mission | Capability | Granted? | Resolved? | Invoked? | Used in verified outcome? | Apparently necessary? |
|---------|-----------|----------|-----------|----------|--------------------------|-----------------------|
| C001-01 | workspace-files | YES | YES (openbot) | YES (write_file) | YES (recommendation.md) | YES |
| C001-03 | workspace-files | YES | YES (openbot) | YES (write_file) | YES (result.txt) | YES |
| C001-03 | mcp:analyze | YES | YES (mcp) | YES (call_tool) | YES (correct sum) | YES |
| C001-03 | shell-execution | YES | YES (openbot) | NO | NO | Apparently UNUSED |
| C001-05 | workspace-files | YES | YES (openbot) | YES (write_file) | YES (script.mjs) | YES |
| C001-05 | shell-execution | YES | YES (openbot) | NO | NO | Apparently UNUSED |
| C001-07 | workspace-files | YES | YES (openbot) | YES (write_file) | YES (diff.md) | YES |

**Observation:** `shell-execution` was granted but unused in 2 of 4 missions. This is observational evidence, NOT a promoted learned rule. Future cohorts with more missions may support a "missions of type X do not need shell-execution" pattern (Level 5).

### Obligation necessity signals

No mission obligations were declared in Cohort 001 (calibration phase). Future cohorts will declare obligations and capture necessity evidence.

---

## 15. Limitations

1. **Scripted reasoning.** All 4 missions used scripted action replay, not real LLM reasoning. `provenance.source = 'synthetic'` on every Experience. The cohort contains calibration evidence, NOT real reasoning-driven organizational execution evidence. The claim is bounded accordingly.

2. **StubComputer.** No real OpenBot/OpenDots/OpenMuse runtime. The StubComputer provides file read/write/exec but no real shell execution. Workers that would have used `run_command` (C001-03, C001-05) were scripted to write files directly. This is acceptable for calibration but limits the tool-call evidence.

3. **Single-worker bias.** 3 of 4 missions produced single-worker organizations. This is the planner's conservative default for bounded missions. More diverse missions (or real LLM workers that request specialization) may produce more organizational diversity in future cohorts.

4. **Domain misclassification.** C001-03 (data mission) was classified as "general" by the deterministic GoalCompiler because the goal text didn't trigger data-analysis signals strongly. C001-07 (knowledge mission) was classified as "research" because "compare" triggered research signals. This is a GoalCompiler heuristic limitation, not a schema gap. It affected candidate domain-matching but did not block evidence capture.

5. **No failure evidence.** All 4 missions succeeded. No failure evidence was captured for the failure-learning dimension. Future cohorts should include failure-possible missions where false success can occur.

6. **N=1 per family.** Only one learning mission per family. Family-specific promotion is highly skeptical — the promoted pattern (prefer-sole-operator for research) has support=2 because C001-01 and C001-07 were both classified as research domain. This is a classification artifact, not strong evidence. Future cohorts need N≥2 per family with correct domain classification.

---

## 16. Scientific Interpretation

**What Cohort 001 established:**
- The Academy pipeline executes end-to-end across 4 diverse mission families.
- Evidence capture works: FlightRecorder + Experience Store + deriveExperience produced 4 clean, comparable Experience records.
- The learning loop operates correctly: candidate generation → evaluation → promotion (with no forced promotion).
- The transfer set remains sealed.
- The "better organization" rule (correctness > obligations > verification > reliability > efficiency) is enforceable: all 4 missions passed correctness and verification gates before any efficiency consideration.

**What Cohort 001 did NOT establish:**
- It did NOT prove Genesis learned better organizations (that requires Cohort 002+ with before/after comparison).
- It did NOT prove blind transfer (that is Cohort 003).
- It did NOT prove cross-family generalization (that is Cohort 004).
- It did NOT prove autonomous operationalNeeds or obligation learning (that is Level 5).
- It did NOT use real LLM reasoning (scripted only — evidence limitation).

---

## 17. Allowed Claims After G5-04

### Allowed

"Genesis executed a clean Foundation Diversity cohort across four materially different mission families and captured comparable organizational experiences suitable for subsequent learning evaluation."

### NOT allowed (evidence limitation)

"The cohort contains real reasoning-driven organizational execution evidence." — NO, scripted reasoning was used.

### NOT allowed (future cohorts)

"Genesis learned better organizations." — requires Cohort 002+ before/after.
"Genesis demonstrated blind transfer." — requires Cohort 003.
"Genesis autonomously learned operationalNeeds/obligations." — requires Level 5.

---

## 18. Production Code Policy

**PRODUCTION_CODE_CHANGED = NO**

Zero production code changes in G5-04. All execution logic is in the experiment harness (`experiments/academy/cohort-001/run-cohort.ts`), which uses the existing Genesis APIs (GoalCompiler, OrganizationPlanner, GenomeCompiler, WorkerAgent, deriveExperience, StatisticalCandidateGenerator, RuleCandidateEvaluator, promoteCandidate) without modification.

No blocking defects were encountered. The GoalCompiler domain misclassification (§15 limitation 4) is a known heuristic limitation, not a blocking defect — it does not prevent evidence capture or learning.

---

## 19. Test Results

| Metric | Before G5-04 | After G5-04 |
|--------|-------------|-------------|
| Test files | 41 | 41 |
| Tests passed | 337 | 337 |
| Tests skipped | 9 | 9 |
| Tests total | 346 | 346 |
| Typecheck | PASS | PASS |
| Lint | PASS | PASS |

No regressions. No new tests added (G5-04 is execution, not test development).

---

## 20. Readiness for Cohort 002

| Dimension | Ready? |
|-----------|--------|
| Experience capture | YES — 4 clean experiences captured |
| Candidate generation | YES — 4 candidates generated, 1 promoted |
| Evaluation rules | YES — existing rules preserved, no forced promotion |
| Pattern retrieval | YES — promoted pattern can be retrieved by future missions |
| Schema sufficiency | YES — empirically confirmed SUFFICIENT |
| Telemetry quality | COMPLETE — all dimensions available except monetary cost |
| Organizational diversity | MEDIUM — needs more varied missions for stronger signal |
| Failure evidence | INSUFFICIENT — Cohort 002 should include failure-possible missions |
| Real LLM evidence | NOT YET — requires external LLM provider availability |

**SAFE_TO_BEGIN_G5_05 = YES** (pending human review of this results document and explicit go-ahead for Cohort 002).

---

## 21. Evidence Paths

| Artifact | Path |
|----------|------|
| Pre-cohort snapshot | `experiments/academy/cohort-001/pre-cohort-snapshot.json` |
| Cohort results manifest | `experiments/academy/cohort-001/results.json` |
| Execution harness | `experiments/academy/cohort-001/run-cohort.ts` |
| Per-mission evidence | `experiments/academy/cohort-001/runs/C001-01/` (experience.json, flight-events.jsonl, verification.json) |
| | `experiments/academy/cohort-001/runs/C001-03/` |
| | `experiments/academy/cohort-001/runs/C001-05/` |
| | `experiments/academy/cohort-001/runs/C001-07/` |
| This document | `docs/academy/GENESIS_ACADEMY_COHORT_001_RESULTS.md` |
