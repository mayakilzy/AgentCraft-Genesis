# GENESIS_ACADEMY_CHARTER_v1

**Version:** v1 (frozen for G5-03)
**Date:** 2026-10-07
**Phase:** G5-03 — Academy Bootstrap
**Authority:** This document defines what the Academy is, what it is not, and the scientific rules it follows.

---

## 1. What the Academy Is

The Organizational Capability Academy is Genesis's experimental framework for determining whether it can learn reusable organizational knowledge from real missions and apply that knowledge to NEW missions it has not previously seen.

The Academy is **not model training**. It does not fine-tune LLM weights, perform RLHF, memorize prompts, or memorize datasets. The Academy trains Genesis's **organizational intelligence** — the layer that decides WHO should work, HOW they should collaborate, WHAT capabilities they need, and WHEN complexity is unnecessary.

### The central scientific question

> **AFTER GENESIS EXECUTES DIVERSE MISSIONS, CAN IT USE PRIOR EXPERIENCE TO DESIGN A BETTER ORGANIZATION FOR A PREVIOUSLY UNSEEN MISSION?**

"Better" is gated — not merely "cheaper." An organization that is cheaper but wrong is NOT better. The full metric hierarchy is defined in the Experiment Contract.

---

## 2. What the Academy Is Not

| Not this | Why |
|----------|-----|
| LLM fine-tuning | The Academy operates at the organizational layer, not the model layer |
| Weight training | No model parameters are modified |
| RLHF | No reinforcement learning loop touches the reasoning provider |
| Prompt memorization | Patterns describe organizational principles, not mission answers |
| Dataset memorization | Transfer missions use different data, different wording, different exact solutions |
| A benchmark suite | The Academy's goal is learning, not scoring |
| A plugin marketplace | No dynamic capability discovery or installation |
| Self-modifying code | Genesis does not autonomously edit its own source code |

---

## 3. Learning Target

The Academy targets the organizational layer:

```
MISSION
   ↓
ORGANIZATION          ← Academy learning operates here
   ↓
EXECUTION
   ↓
EVIDENCE
   ↓
EXPERIENCE
   ↓
LEARNING CANDIDATES
   ↓
EVALUATION
   ↓
PROMOTED PATTERNS
   ↓
FUTURE ORGANIZATION DESIGN
```

The model may reason. Genesis must learn at the organizational layer. These are distinct — a better LLM does not automatically produce a better organization, and a better organization does not require a better LLM.

---

## 4. What Genesis Should Learn (Target Dimensions)

| Dimension | Description | Current readiness |
|-----------|-------------|-------------------|
| A. Organization shape | Which roles are useful/redundant; when coordinator vs specialist vs generalist; parallelism vs sequential | READY (proven in Phase 4.11) |
| B. Cognitive allocation | Which work deserves stronger reasoning; where cheap reasoning suffices; where review is valuable | PARTIALLY_READY (tier selection exists; learning does not yet adjust it) |
| C. Capability needs | Which mission types tend to require browser/shell/files/workspace/durable/MCP | NOT_READY (explicit injection remains the mechanism) |
| D. Mission obligations | Which mission semantics imply delegated-result/shared-publication/computer-execution/independent-verification | NOT_READY (obligations are explicitly declared) |
| E. Coordination patterns | Handoff structure; specialist collaboration; aggregation; review; reconciliation; delegation | PARTIALLY_READY (collaboration edges exist; learning does not yet adjust them) |
| F. Failure/recovery patterns | Which organization shapes repeatedly fail; which capabilities are missing; which patterns reduce false success | PARTIALLY_READY (avoid-role/avoid-shape candidates exist; failure-pattern learning needs more evidence) |

The detailed readiness audit is in `GENESIS_ACADEMY_LEARNING_GAP_AUDIT_v1.md`.

---

## 5. Scientific Rules

### Rule 1: Evidence before claims

No claim about organizational learning may be made without evidence. "Genesis learned X" requires:
- Real missions executed
- Experiences captured
- Candidates generated from those experiences
- Candidates evaluated (promoted/rejected/tentative)
- Promoted patterns retrieved by a future mission's planner
- The future mission's organization measurably changed
- The outcome was verified

### Rule 2: Transfer is not memorization

A "transfer" mission must share the underlying organizational principle but differ in:
- Surface problem
- Data
- Wording
- Exact solution

If a transfer mission is the same mission with cosmetic changes, it is not transfer — it is repetition.

### Rule 3: Baselines are mandatory

A learned organization cannot be called "better" without comparison. Every major claim requires at least:
- Baseline C: Genesis organization WITHOUT learned patterns
- Experiment: Genesis organization WITH promoted learned patterns

### Rule 4: Correctness outranks efficiency

An organization that is cheaper but wrong is NOT better. Correctness and verification are hard gates. Only among organizations satisfying those gates should efficiency gains count as improvement.

### Rule 5: "Insufficient evidence" is a valid outcome

Genesis must be allowed to conclude "no reliable pattern yet." Forcing candidate promotion because the Academy expects learning is scientifically dishonest. Insufficient evidence is stronger than fake improvement.

### Rule 6: Blind transfer is the gold standard

At least one future evaluation must be blind: Genesis accesses only current mission inputs, previously promoted legitimate patterns, and normal tools/capabilities. It must NOT access gold answers, expected organizations, hidden evaluator notes, or test-specific solution hints.

### Rule 7: Scripted reasoning ≠ natural reasoning

Scripted reasoning is acceptable for:
- Pipeline tests
- Failure tests
- Deterministic calibration
- Reproducibility checks

But claims such as "Genesis learned to organize real AI workers better" require real LLM-driven missions. This distinction must be recorded in every experience's provenance.

---

## 6. Academy Success Levels

The Academy progresses through bounded evidence levels. Claims must correspond to the achieved level.

| Level | Name | Evidence required |
|-------|------|-------------------|
| 0 | PIPELINE | Academy infrastructure executes (mission definitions load, experiences capture, learning loop runs) |
| 1 | EXPERIENCE | Diverse clean experiences captured across multiple mission families |
| 2 | REPEATED PATTERN | Same organizational principle supported by ≥2 experiences in a family |
| 3 | WITHIN-FAMILY TRANSFER | Promoted pattern improves an unseen mission in the same family (blind) |
| 4 | CROSS-FAMILY TRANSFER | Pattern helps structurally related mission in another family |
| 5 | LEARNED NEED/OBLIGATION | Genesis reliably infers capability/obligation requirement from accumulated evidence |
| 6 | ROBUST IMPROVEMENT | Improvement persists across multiple mission families and repeated trials |

Do not inflate levels. A level is reached only when its evidence is demonstrated and verified.

---

## 7. Claim Discipline

Claims must grow slower than implementation.

| After | Allowed claim |
|-------|---------------|
| Cohort 001 | "Genesis executed diverse Academy missions and captured comparable organizational experience." |
| Successful blind within-family transfer | "Genesis applied prior organizational learning to improve an unseen mission in the same mission family." |
| Repeated cross-family evidence | "Genesis demonstrated transferable organizational learning across multiple mission families." |

| After | NOT allowed |
|-------|-------------|
| Cohort 001 | "Genesis autonomously learned optimal organizations." |
| Any scripted run | "Genesis learned to organize real AI workers better." |
| N=1 | "Genesis universally self-improves." |

---

## 8. Safety / Governance Boundary

A promoted pattern must NEVER override:
- Hard security rules
- Worker grants
- Mission truth
- Verification requirements
- Budget ceilings
- Human-required actions
- Provider availability reality

Learning may influence organization design. Learning must not rewrite governance.

### No self-modifying code

Academy learning means: experience → organizational patterns → future planning. It does NOT mean Genesis autonomously edits its own source code. Code evolution remains an explicit engineering process.

---

## 9. Anti-Bloat Rules

- The Academy is about EVIDENCE, not INFRASTRUCTURE.
- Reuse existing: learning loop, flight recorder, CompositeRuntime, experience store, candidate generator, evaluator, pattern retriever, organization planner.
- Do NOT create: LearningGraph, OrganizationalKnowledgeGraph, Pattern Engine v2, Evolution Engine v2, Optimization Platform, Academy Evidence Platform.
- Do NOT introduce provider-specific worker types.
- Do NOT encode mission-specific answers as static application logic.
- Soft warning: >700 net new production LOC per phase.
- Hard stop: >1200 LOC OR >6 new production files OR any new runtime dependency OR new framework.

For G5-03 specifically: **preferred production code delta is ZERO.** Design-first. Only documentation, experiment manifests, and mission definitions.

---

## 10. Cohort Model

The Academy executes in cohorts. Each cohort has a specific scientific purpose.

| Cohort | Purpose | Status |
|--------|---------|--------|
| 001 | Foundation Diversity — baseline organizational behavior across diverse families; exercise evidence capture; discover gaps; collect clean initial experiences | DESIGNED in G5-03 (not executed) |
| 002 | Within-Family Learning — generate candidates, promote patterns, measure before/after within a family | Future |
| 003 | Blind Transfer — apply promoted patterns to unseen missions in the same family | Future |
| 004 | Cross-Family Generalization — test transfer across structurally related families | Future |
| 005 | OperationalNeed / Obligation Learning Evaluation — gather evidence for autonomous need/obligation inference | Future |

This is illustrative. The smallest scientifically useful sequence is chosen. Do not create dozens of cohorts prematurely.

---

## 11. Reproducibility

Every evidence-bearing Academy run must record enough information to reproduce or audit:
- Mission definition
- Inputs
- Available capabilities
- Organization selected
- Patterns available / patterns applied
- Worker genomes
- Provider mode (scripted vs real LLM)
- Reasoning count
- Tool/action evidence
- Verification result
- Artifacts
- Experience record
- Learning candidates
- Promotion decision
- Runtime versions

Do NOT record secrets or private chain-of-thought.

The existing Flight Recorder + Experience Store + experiment artifacts already provide sufficient evidence. No new "Academy Evidence Platform" is needed.

---

## 12. Authority

This charter is the authoritative definition of the Academy's purpose, rules, and boundaries. The Curriculum, Experiment Contract, and Cohort 001 documents elaborate on specific aspects but must remain consistent with this charter.

If a conflict arises between this charter and another document, **this charter wins** for matters of scientific principle, claim discipline, and safety boundaries.
