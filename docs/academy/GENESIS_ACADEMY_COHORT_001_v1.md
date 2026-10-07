# GENESIS_ACADEMY_COHORT_001_v1

**Version:** v1 (frozen for G5-03)
**Date:** 2026-10-07
**Authority:** G5-03 Cohort 001 concrete mission design

---

## Purpose

Cohort 001 is **calibration, not victory.**

Its purpose:
- Establish baseline organizational behavior across diverse mission families.
- Exercise evidence capture (Flight Recorder + Experience Store).
- Discover learning-schema gaps.
- Identify where organization decisions matter.
- Collect clean initial experiences.

It does NOT try to prove self-improvement immediately. That is Cohort 002+.

---

## Cohort 001 Summary

| Metric | Value |
|--------|-------|
| Total missions | 8 |
| Mission families | 4 (Research, Data, Software, Knowledge) |
| Missions per family | 2 (one learning, one transfer-designated) |
| Difficulty levels | L1–L4 |
| Baseline strategy | Baseline C (no patterns) for all; Baseline A (single worker) for L1 sample |
| Reasoning provider | Scripted (calibration) OR real LLM if available; `provenance.source` records which |
| Learning eligibility | Learning missions: YES. Transfer-designated: NO (reserved for Cohort 003). |
| Execution status | NOT EXECUTED in G5-03 — design only |

---

## Mission Roster

### Mission C001-01 — Family A (Research), Learning

| Field | Value |
|-------|-------|
| MISSION_ID | C001-01 |
| MISSION_FAMILY | A — Research / Evidence Synthesis |
| DIFFICULTY | L2 (multi-step) |
| GOAL | Compare two technology options (e.g. "Option X vs Option Y for use case Z") and produce an evidence-backed recommendation. |
| WHY_ORGANIZATION_MATTERS | A single worker could research both, but specialization (researcher focuses on gathering, synthesizer focuses on reconciling, verifier checks claims) can improve quality and reduce false claims. The coordinator role may or may not add value. |
| EXPECTED_AVAILABLE_CAPABILITIES | workspace-files (write report), shell-execution (optional, for running small scripts) |
| KNOWN_REQUIRED_INPUTS | A staged input file `sources.txt` containing 2–3 brief source summaries with conflicting claims |
| BASELINE_STRATEGY | Baseline C (no patterns). Optional: Baseline A (single worker) for comparison. |
| VERIFICATION_STRATEGY | `content-in-artifacts` check: the report must mention both options AND contain a recommendation. `mission-input` check: `sources.txt` must be referenced (worker read it, not fabricated). |
| METRICS | workerCount, reasoningCalls, verification ok, artifactsCount per worker, false-success (does recommendation match evidence?) |
| LEARNING_ELIGIBILITY | YES — experience feeds candidate generation |
| TRANSFER_RELATIONSHIP | Transfer mission: C001-05 (different technologies, different sources, different recommendation) |
| ESTIMATED_REASONING_BUDGET | 4–8 reasoning calls per worker; ≤20 total |

---

### Mission C001-02 — Family A (Research), Transfer-Designated

| Field | Value |
|-------|-------|
| MISSION_ID | C001-02 |
| MISSION_FAMILY | A — Research / Evidence Synthesis |
| DIFFICULTY | L3 (requires specialization) |
| GOAL | Investigate a factual claim (e.g. "does technique T achieve performance P?") and produce a verified conclusion with evidence. |
| WHY_ORGANIZATION_MATTERS | The claim may be false. A worker that merely trusts the claim produces false success. Independent verification (a second worker checking the evidence) prevents this. |
| EXPECTED_AVAILABLE_CAPABILITIES | workspace-files |
| KNOWN_REQUIRED_INPUTS | `claim.txt` containing the claim + `evidence.txt` containing supporting and contradicting evidence |
| BASELINE_STRATEGY | Baseline C |
| VERIFICATION_STRATEGY | `content-in-artifacts`: conclusion must reference evidence. `mission-input`: both input files must be read. `flight-action`: if a `shared-publication` obligation is declared, `append_shared_workspace` must be invoked. |
| METRICS | workerCount, reasoningCalls, false-success (did worker verify or just trust the claim?) |
| LEARNING_ELIGIBILITY | NO — transfer-designated; experience captured but NOT used for candidate generation until Cohort 003 evaluation |
| TRANSFER_RELATIONSHIP | Transfer target for C001-01 patterns (same family, different problem) |
| ESTIMATED_REASONING_BUDGET | 4–8 per worker; ≤20 total |

---

### Mission C001-03 — Family B (Data), Learning

| Field | Value |
|-------|-------|
| MISSION_ID | C001-03 |
| MISSION_FAMILY | B — Data / Analytical Work |
| DIFFICULTY | L3 (requires specialization + MCP capability) |
| GOAL | Analyze a dataset and compute summary statistics (sum, mean, min, max), then write a verified report. |
| WHY_ORGANIZATION_MATTERS | The statistics must be computed correctly. A worker that guesses the answer produces false success. The MCP `analyze` tool (activated in G5-01) provides the correct computation. A worker without the MCP grant must compute manually (error-prone). Organization decides: grant MCP or not? |
| EXPECTED_AVAILABLE_CAPABILITIES | workspace-files, shell-execution, MCP `analyze` tool (granted to one worker) |
| KNOWN_REQUIRED_INPUTS | `data.json` containing an array of numbers (e.g. `[47, 23, 89, 12, 64, 38, 91, 55, 6, 77]`) |
| BASELINE_STRATEGY | Baseline C (no patterns). Run two arms: one with MCP grant, one without. |
| VERIFICATION_STRATEGY | `content-in-artifacts`: report must contain `"sum":502` (the correct sum). `mission-input`: `data.json` must be read. `flight-action`: if MCP grant exists, `call_tool` with `analyze` must be invoked. |
| METRICS | workerCount, reasoningCalls, MCP invocation count, false-success (is sum correct?), tool-call count |
| LEARNING_ELIGIBILITY | YES |
| TRANSFER_RELATIONSHIP | Transfer mission: C001-07 (different dataset, different analysis, same organizational principle: use MCP tool for deterministic computation) |
| ESTIMATED_REASONING_BUDGET | 3–6 per worker; ≤15 total |

---

### Mission C001-04 — Family B (Data), Transfer-Designated

| Field | Value |
|-------|-------|
| MISSION_ID | C001-04 |
| MISSION_FAMILY | B — Data / Analytical Work |
| DIFFICULTY | L4 (false-success pressure) |
| GOAL | Detect anomalies in a dataset and report them with evidence. |
| WHY_ORGANIZATION_MATTERS | "Anomaly" is subjective. A worker that reports the wrong values as anomalies produces false success. Independent verification (a second worker checking the anomaly list) or MCP-based computation prevents this. |
| EXPECTED_AVAILABLE_CAPABILITIES | workspace-files, shell-execution, MCP `analyze` tool |
| KNOWN_REQUIRED_INPUTS | `dataset.json` containing values with known anomalies (e.g. outliers at specific indices) + `expected_anomalies.json` (GOLD — not visible to worker, used by verifier) |
| BASELINE_STRATEGY | Baseline C |
| VERIFICATION_STRATEGY | `content-in-artifacts`: report must list the correct anomaly indices. `mission-input`: `dataset.json` must be read. Independent comparison: reported anomalies vs `expected_anomalies.json`. |
| METRICS | workerCount, reasoningCalls, false-success rate (wrong anomalies reported), verification ok |
| LEARNING_ELIGIBILITY | NO — transfer-designated |
| TRANSFER_RELATIONSHIP | Transfer target for C001-03 patterns |
| ESTIMATED_REASONING_BUDGET | 4–8 per worker; ≤20 total |

---

### Mission C001-05 — Family C (Software), Learning

| Field | Value |
|-------|-------|
| MISSION_ID | C001-05 |
| MISSION_FAMILY | C — Software / Engineering |
| DIFFICULTY | L2 (multi-step) |
| GOAL | Fix a small bug in a provided script and verify the fix works. |
| WHY_ORGANIZATION_MATTERS | Reproduction (run the script, see the bug), fix (edit the script), and verify (run again, confirm fix) are distinct steps. A single worker can do all three, but specialization (reproduction engineer + fixer + verifier) may improve reliability. |
| EXPECTED_AVAILABLE_CAPABILITIES | workspace-files, shell-execution |
| KNOWN_REQUIRED_INPUTS | `script.mjs` containing a script with a known bug (e.g. off-by-one error in a loop) + `expected_output.txt` (GOLD — not visible to worker) |
| BASELINE_STRATEGY | Baseline C. Optional: Baseline A (single worker). |
| VERIFICATION_STRATEGY | `command` check: run the fixed script, assert exit code 0 and output matches `expected_output.txt`. `mission-input`: `script.mjs` must be read. |
| METRICS | workerCount, reasoningCalls, retries, verification ok, false-success (did the fix actually work?) |
| LEARNING_ELIGIBILITY | YES |
| TRANSFER_RELATIONSHIP | Transfer mission: C001-08 (different script, different bug type, same reproduce→fix→verify principle) |
| ESTIMATED_REASONING_BUDGET | 4–8 per worker; ≤20 total |

---

### Mission C001-06 — Family C (Software), Transfer-Designated

| Field | Value |
|-------|-------|
| MISSION_ID | C001-06 |
| MISSION_FAMILY | C — Software / Engineering |
| DIFFICULTY | L3 (requires specialization) |
| GOAL | Implement a small function according to a spec and verify it passes tests. |
| WHY_ORGANIZATION_MATTERS | Implementation and verification are distinct concerns. A worker that writes and "verifies" its own code may miss bugs (confirmation bias). An independent verifier worker (different instance, reads only the code + tests) catches more. |
| EXPECTED_AVAILABLE_CAPABILITIES | workspace-files, shell-execution |
| KNOWN_REQUIRED_INPUTS | `spec.md` (function specification) + `test.mjs` (test runner, already written) + `expected_result.txt` (GOLD) |
| BASELINE_STRATEGY | Baseline C |
| VERIFICATION_STRATEGY | `command` check: run `node test.mjs`, assert exit code 0. `content-in-artifacts`: implementation file must exist. `mission-input`: `spec.md` must be read. |
| METRICS | workerCount, reasoningCalls, verification ok, false-success (do tests actually pass?) |
| LEARNING_ELIGIBILITY | NO — transfer-designated |
| TRANSFER_RELATIONSHIP | Transfer target for C001-05 patterns |
| ESTIMATED_REASONING_BUDGET | 4–8 per worker; ≤20 total |

---

### Mission C001-07 — Family D (Knowledge), Learning

| Field | Value |
|-------|-------|
| MISSION_ID | C001-07 |
| MISSION_FAMILY | D — Knowledge / Document Work |
| DIFFICULTY | L3 (requires specialization) |
| GOAL | Compare two documents and produce a structured diff highlighting agreements and contradictions. |
| WHY_ORGANIZATION_MATTERS | Reading two documents, identifying agreements, and identifying contradictions are different cognitive tasks. A single worker may miss contradictions (confirmation bias). Specialization (reader + comparator + contradiction-flagger) may improve coverage. |
| EXPECTED_AVAILABLE_CAPABILITIES | workspace-files |
| KNOWN_REQUIRED_INPUTS | `doc_a.txt` + `doc_b.txt` (two brief documents with overlapping and conflicting content) |
| BASELINE_STRATEGY | Baseline C |
| VERIFICATION_STRATEGY | `content-in-artifacts`: diff report must contain both "agreements" and "contradictions" sections. `mission-input`: both input docs must be read. |
| METRICS | workerCount, reasoningCalls, verification ok, false-success (are contradictions correctly identified?) |
| LEARNING_ELIGIBILITY | YES |
| TRANSFER_RELATIONSHIP | Transfer mission: C001-02 (different documents, different domain, same compare-and-reconcile principle — note: cross-family transfer design) |
| ESTIMATED_REASONING_BUDGET | 4–8 per worker; ≤20 total |

---

### Mission C001-08 — Family D (Knowledge), Transfer-Designated

| Field | Value |
|-------|-------|
| MISSION_ID | C001-08 |
| MISSION_FAMILY | D — Knowledge / Document Work |
| DIFFICULTY | L4 (conflicting evidence / verification pressure) |
| GOAL | Extract structured knowledge from a document and verify it against a reference. |
| WHY_ORGANIZATION_MATTERS | Extraction may miss fields or hallucinate them. Independent verification (a second worker checking the extraction against the source) prevents false success. |
| EXPECTED_AVAILABLE_CAPABILITIES | workspace-files |
| KNOWN_REQUIRED_INPUTS | `source.txt` (a document with structured information) + `expected_extraction.json` (GOLD — not visible to worker) |
| BASELINE_STRATEGY | Baseline C |
| VERIFICATION_STRATEGY | `content-in-artifacts`: extraction must match `expected_extraction.json` (field-by-field). `mission-input`: `source.txt` must be read. Independent comparison: extracted fields vs expected fields. |
| METRICS | workerCount, reasoningCalls, verification ok, false-success (are extracted fields correct?) |
| LEARNING_ELIGIBILITY | NO — transfer-designated |
| TRANSFER_RELATIONSHIP | Transfer target for C001-07 patterns |
| ESTIMATED_REASONING_BUDGET | 4–8 per worker; ≤20 total |

---

## Cohort 001 Mission Summary Table

| ID | Family | Difficulty | Learning? | Transfer pair | Key verification |
|----|--------|-----------|-----------|---------------|-------------------|
| C001-01 | A (Research) | L2 | YES | → C001-02 | content-in-artifacts + mission-input |
| C001-02 | A (Research) | L3 | NO (transfer) | ← C001-01 | content-in-artifacts + flight-action |
| C001-03 | B (Data) | L3 | YES | → C001-04 | content-in-artifacts (sum=502) + call_tool |
| C001-04 | B (Data) | L4 | NO (transfer) | ← C001-03 | content-in-artifacts + independent comparison |
| C001-05 | C (Software) | L2 | YES | → C001-06 | command check + mission-input |
| C001-06 | C (Software) | L3 | NO (transfer) | ← C001-05 | command check (tests pass) |
| C001-07 | D (Knowledge) | L3 | YES | → C001-08 | content-in-artifacts + mission-input |
| C001-08 | D (Knowledge) | L4 | NO (transfer) | ← C001-07 | content-in-artifacts + independent comparison |

---

## Learning Eligibility Rule

- **Learning missions (C001-01, 03, 05, 07):** Experiences are captured AND eligible for candidate generation. These feed the learning loop.
- **Transfer-designated missions (C001-02, 04, 06, 08):** Experiences are captured but NOT used for candidate generation. They are reserved for Cohort 003 (Blind Transfer) evaluation.

This separation prevents: train on transfer mission → "learn" the exact solution → repeat the same mission → call it transfer.

---

## Execution Budget

| Dimension | Estimate |
|-----------|----------|
| Total missions | 8 |
| Reasoning calls per mission | ≤20 |
| Total reasoning calls (Cohort 001) | ≤160 |
| Mission timeout | 10 minutes each |
| Expected wall time | <5 minutes per mission (scripted); longer with real LLM |
| Verification | Deterministic (command, file, content-in-artifacts, mission-input, flight-action) |

---

## What Cohort 001 Does NOT Prove

- It does NOT prove Genesis autonomously learned optimal organizations.
- It does NOT prove blind transfer (that is Cohort 003).
- It does NOT prove cross-family generalization (that is Cohort 004).
- It does NOT prove operationalNeed or obligation learning (that is Cohort 005 / Level 5).

## What Cohort 001 DOES Establish

- The Academy pipeline executes across 4 diverse mission families.
- Evidence capture works (Flight Recorder + Experience Store).
- Experiences are comparable across families (same schema, same metrics).
- Baseline organizational behavior is recorded for each family.
- Learning-schema gaps (if any) are discovered.
- Clean initial experiences are collected for Cohort 002 candidate generation.

---

## Cohort 001 Execution Protocol

**NOT EXECUTED in G5-03.** This is design only.

When Cohort 001 is approved for execution (G5-04):

1. For each mission C001-01 through C001-08:
   a. Stage the mission inputs as MissionInput files.
   b. Construct the MissionOrchestrator with Baseline C (no patterns).
   c. Run the mission; capture FlightRecorder events + Experience.
   d. Run verification (AcceptanceChecks).
   e. Record the experience with `provenance.source` = `real-mission` or `synthetic`.
2. After all 8 missions: generate candidates from the 4 learning missions' experiences.
3. Evaluate candidates (RuleCandidateEvaluator).
4. Promote patterns (if any meet the threshold).
5. Record the Cohort 001 evidence ledger.
6. Report: experiences captured, candidates generated, patterns promoted (if any), gaps discovered.

**STOP after Cohort 001.** Do NOT proceed to Cohort 002 without human review of Cohort 001 evidence.
