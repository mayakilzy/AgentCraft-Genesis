# GENESIS_ACADEMY_CURRICULUM_v1

**Version:** v1 (frozen for G5-03)
**Date:** 2026-10-07
**Authority:** G5-03 curriculum design

---

## 1. Mission Families

The curriculum comprises **4 materially distinct mission families**, each exercising meaningfully different organizational requirements. These are NOT five superficial variants of the same coding task.

| Family | Name | Primary domain | Organizational pressure |
|--------|------|----------------|------------------------|
| A | Research / Evidence Synthesis | research | Multiple sources to reconcile; verification of claims; specialization (researcher vs synthesizer vs verifier) |
| B | Data / Analytical Work | data-analysis | Deterministic computation that can be verified; MCP capability use; false-success pressure (wrong answer looks plausible) |
| C | Software / Engineering | software-engineering | Code execution; test verification; reproduction + fix + verify cycle |
| D | Knowledge / Document Work | document-authoring | Multi-document comparison; structured extraction; reconciliation of conflicting evidence; artifact production |

### Why these 4 families

- **Family A (research)** exercises: web-research capability, evidence gathering, independent verification, specialist collaboration (researcher ≠ synthesizer ≠ verifier).
- **Family B (data)** exercises: code-execution + data-analysis, MCP tool invocation (G5-01 capability), deterministic verification (correct answer is computable), false-success pressure (a wrong sum is plausible).
- **Family C (software)** exercises: code-execution, browser-verification (if available), reproduction → fix → verify cycle, multi-step engineering.
- **Family D (knowledge)** exercises: document-authoring, multi-source reconciliation, structured knowledge extraction, artifact production with content verification.

### What is deliberately NOT included in Cohort 001

- **Family E (multi-surface operational work requiring OpenBot + OpenDots + OpenMuse + MCP together)** — this requires live upstream services that may not be available in the sandbox. Cohort 001 uses the MemoryComputer stub and scripted/real reasoning. Multi-surface missions are a future cohort concern.

### Diversity guarantee

At least 3 materially different families are represented before any broad organizational-learning claim. Cohort 001 has 4 families — satisfying the diversity requirement for Level 1 (EXPERIENCE) and Level 2 (REPEATED PATTERN).

---

## 2. Difficulty Ladder

Each family has a difficulty ladder. Difficulty increases **organizational pressure**, not merely input size.

| Level | Name | Organizational pressure |
|-------|------|------------------------|
| L1 | Simple bounded mission | Single worker suffices; organization is trivial |
| L2 | Multi-step mission | Multiple steps; sequencing matters; coordinator may help |
| L3 | Requires specialization | Different capabilities needed; specialist roles add value |
| L4 | Verification pressure / false-success possibility | Wrong answer is plausible; independent verification is necessary |
| L5 | Unseen transfer mission | Same organizational principle, different surface problem |

Cohort 001 primarily uses L1–L4 (learning missions). L5 (transfer) is reserved for Cohort 003+.

---

## 3. Train / Transfer Separation

**MANDATORY.** For each mission family, learning missions and transfer missions are SEPARATE.

### Learning missions

- Used to generate experiences and candidates.
- Their experiences feed the learning loop.
- Patterns promoted from these experiences may influence future missions.

### Transfer missions

- Used to TEST whether promoted patterns generalize.
- They must NOT be used to generate patterns before their evaluation.
- They share the underlying organizational principle but differ in:
  - Surface problem
  - Data
  - Wording
  - Exact solution

### Transfer pair example

| Learning mission | Transfer mission |
|-------------------|------------------|
| Analyze supplier-risk dataset and independently verify anomalies | Analyze machine-failure dataset and independently verify anomalies |

Same organizational principle (analyze + independently verify). Different problem, different data, different exact solution.

### Cohort 001 transfer status

Cohort 001 is **calibration** — it establishes baselines and captures clean experiences. Transfer missions are DESIGNED (identified in the Cohort 001 document) but NOT executed in Cohort 001. They are reserved for Cohort 003 (Blind Transfer).

---

## 4. Cohort Sequence

| Cohort | Purpose | Status |
|--------|---------|--------|
| 001 | Foundation Diversity — baseline behavior across 4 families; exercise evidence capture; discover gaps; collect clean initial experiences | DESIGNED (G5-03) |
| 002 | Within-Family Learning — generate candidates, promote patterns, measure before/after within each family | Future |
| 003 | Blind Transfer — apply promoted patterns to unseen L5 missions in the same family | Future |
| 004 | Cross-Family Generalization — test transfer across structurally related families | Future |
| 005 | OperationalNeed / Obligation Learning Evaluation — gather evidence for autonomous need/obligation inference | Future |

This is the smallest scientifically useful sequence. Do not create dozens of cohorts prematurely.

---

## 5. Baseline Strategy

A learned organization cannot be called "better" without comparison.

### Baselines

| Baseline | Description | When used |
|----------|-------------|-----------|
| A | Strong single worker | One worker with all grants; tests whether multi-worker is even needed |
| B | Static reasonable multi-worker | A fixed reasonable organization shape (e.g., the planner's default without patterns) | Reference for "unlearned but reasonable" |
| C | Genesis organization WITHOUT learned patterns | The planner's output with `patterns: []` | The primary before-learning baseline |
| Experiment | Genesis organization WITH promoted learned patterns | The planner's output with promoted patterns | The after-learning arm |

### Schedule

Not every Academy mission must run all four arms. Cost control:
- Cohort 001: run Baseline C (no patterns) for all missions. This establishes the baseline. Baseline A (single worker) is run on a SAMPLE of missions where single-worker is plausible.
- Cohort 002+: run Baseline C vs Experiment (with patterns) for before/after comparison.
- Baseline B (static multi-worker) is optional, used when the planner's default is suspected to be unreasonable.

### Cost control principle

Scripted runs for infrastructure calibration. Real LLM runs for evidence-bearing missions. Small mission inputs. Bounded retries (1 retry max). Reuse deterministic verification. Sample baseline arms rather than run all arms everywhere. Promote patterns only after enough evidence.

---

## 6. Cost Strategy

The Academy must not become an LLM-token furnace.

### Cost controls

| Control | Implementation |
|---------|----------------|
| Scripted reasoning for calibration | Cohort 001 may use scripted reasoning for infrastructure validation; `provenance.source` records it |
| Real LLM for evidence-bearing missions | Major claims require real LLM-driven missions; Cohort 001 records `source: 'real-mission'` or `source: 'synthetic'` honestly |
| Small mission inputs | Mission inputs are small datasets/files, not large corpora |
| Bounded retries | MissionOrchestrator does 1 bounded retry; no infinite retry loops |
| Deterministic verification | AcceptanceChecks are deterministic (command, file, content-in-artifacts, flight-action) — no LLM in verification unless reviewer is consulted on failure |
| Sample baseline arms | Not every mission runs all 4 arms; see Baseline Strategy |
| Promote patterns only after enough evidence | promotionThreshold ≥ 2 (default); no promotion from N=1 |

### Distinction: calibration run vs learning evidence run

| Type | Purpose | Evidence weight |
|------|---------|-----------------|
| CALIBRATION RUN | Validate infrastructure, verify pipeline, reproducibility check | `source: 'synthetic'`; NOT used for broad learning claims |
| LEARNING EVIDENCE RUN | Generate experiences that feed the learning loop | `source: 'real-mission'`; eligible for candidate generation |

Scripted reasoning may validate infrastructure. It must NOT silently become evidence for broad autonomous reasoning claims.

---

## 7. Real LLM vs Scripted Evidence

### Scripted reasoning is acceptable for

- Pipeline tests (does the learning loop execute end-to-end?)
- Failure tests (does a failing mission produce honest failure evidence?)
- Deterministic calibration (reproducibility checks)
- Infrastructure validation

### Real LLM is required for

- Claims like "Genesis learned to organize real AI workers better"
- Blind transfer experiments where the worker must make real decisions
- Any claim about autonomous organizational improvement

### Cohort 001 stance

Cohort 001 is primarily calibration. Scripted reasoning is acceptable for Cohort 001's infrastructure-validation purpose. The `provenance.source` field distinguishes scripted from real-mission evidence honestly. If a real LLM provider is available, Cohort 001 missions MAY be run with it — but Cohort 001 does NOT require it. The claim after Cohort 001 is bounded: "Genesis executed diverse Academy missions and captured comparable organizational experience" — NOT "Genesis autonomously learned."

---

## 8. Curriculum Diversity Checklist

| Capability exercised | Family A | Family B | Family C | Family D |
|----------------------|----------|----------|----------|----------|
| Reasoning (worker loop) | ✓ | ✓ | ✓ | ✓ |
| Files (workspace-files) | ✓ | ✓ | ✓ | ✓ |
| Shell execution | — | ✓ | ✓ | — |
| Browser | — | — | optional | — |
| Collaborative workspace (OpenDots) | — | — | — | optional |
| Durable delegation (OpenMuse) | — | optional | — | — |
| MCP capability | — | ✓ | — | — |
| Verification (deterministic) | ✓ | ✓ | ✓ | ✓ |
| Handoffs (multi-worker) | optional | optional | optional | optional |
| Single vs multi-worker | both | both | both | both |

Unused capability is itself useful evidence. A mission that does NOT need browser, and an organization that includes a browser-granted worker, produces evidence of unnecessary complexity.

---

## 9. Organizational Pressure Design

Every Cohort 001 mission is designed so that organization design MATERIALLY matters.

### Bad Academy mission (not included)

"write hello world" — a single worker with shell access can do this; no organizational decision matters.

### Good Academy mission (included)

A mission where:
- specialization (researcher vs analyst vs writer vs verifier) changes outcome;
- coordination (handoffs, shared workspace) helps or hurts;
- verification (independent check) prevents false success;
- capability allocation (which tools to grant) affects cost/reliability;
- delegation (durable task) is useful or unnecessary;
- or organization size (1 vs 2 vs 3 workers) materially changes cost/correctness.

The Academy must challenge ORGANIZATIONAL decisions, not just task completion.
