# G7-10 — Goal Satisfaction Verification: Design Document

**Status:** Design only. No implementation in G7-10.
**Target phase:** G7-11 (Real Execution Qualification) or a separately approved follow-up.
**Scope:** Document the future implementation path for genuine goal-satisfaction verification without changing frozen engine contracts during G7-10.

---

## 1. Problem Statement

The G7-09 audit established that the current Genesis product conflates three
distinct concepts under a single user-facing "SUCCEEDED + Verified" badge:

1. **Execution success** — the orchestration and runtime completed their
   expected execution path without infrastructure error.
2. **Artifact integrity** — the produced artifact exists and passed explicitly
   defined file/content/integrity checks.
3. **Goal satisfaction** — the resulting output fulfills the user's approved
   acceptance criteria (the actual goal).

In the controlled development environment, the development reasoning fallback
ignores the user's goal text entirely and emits a fixed `output.md`. The
gateway's `buildChecks()` produces only file-existence checks (no
`expectIncludes`, no `expectHash`). The orchestrator decides `status = 'success'`
when `verification.ok && hasDeliverable` — neither condition tests goal
alignment. The UI then renders a `SUCCEEDED` badge and marks the artifact as
`Verified`, implying to the user that their goal was achieved.

G7-10 Workstream A makes this limitation visible (UI disclosure + `NOT MEASURED`
metric). This document defines the future path to actually *measure* goal
satisfaction.

---

## 2. Three Verification Levels (Definition)

### 2.1 Execution Success

**Question:** Did the orchestration and runtime complete their expected
execution path?

**Authority:** `MissionResult.status` (returned by `MissionOrchestrator.run()`).

**Current behavior:** `status = 'success'` when `verification.ok && hasDeliverable`.
This is a *workflow* success — it means "the pipeline ran end-to-end and
produced something that passed verification checks." It does NOT mean the
produced artifact satisfies the user's goal.

**Evidence:** `src/mission/orchestrator.ts:807-842` (status decision).

### 2.2 Artifact Integrity

**Question:** Does the artifact exist, and did it pass explicitly defined
file/content/integrity checks?

**Authority:** `VerificationResult.ok` and `VerificationResult.outcomes[]`
(returned by `VerificationLoop`).

**Current behavior:** The gateway's `buildChecks()` emits only `{kind:'file',
path}` checks per produced path — pure existence checks. The `VerificationLoop`
supports 7 check kinds (command, file, evidence, mission-input, flight-action,
content-in-artifacts, hash-match), but only `file` (existence) is wired. The
per-artifact `verified` flag is `verificationOk && verifiedPaths.has(path)` —
truthful for "file-existence check passed" but misleading as a user-facing
"Verified" badge.

**Evidence:** `src/mission/verification.ts:25-125, 378-410`;
`src/gateway/mission-service.ts:1011-1038` (`buildChecks`);
`src/gateway/mission-service.ts:914-956` (`captureVerificationResult`).

### 2.3 Goal Satisfaction

**Question:** Does the resulting output fulfill the user's approved acceptance
criteria?

**Authority:** None today. There is no `GoalSatisfactionResult` type. The
`SuccessCriterion.description` field in `GoalRequirements` is free-text and
never evaluated. The `Goal` contract has no `acceptanceCriteria` field.

**Current behavior:** Not measured. The UI now discloses this as `NOT MEASURED`
(G7-10 Workstream A).

**Evidence:** `src/contracts/core.ts:65-76` (Goal — no acceptanceCriteria);
`src/contracts/core.ts:97-112` (GoalRequirements — successCriteria is
free-text); `src/goal/goal-compiler.ts:202-267` (word-signal classification
only, no filename/content extraction).

---

## 3. Existing Infrastructure That Can Be Reused

The engine already has the *mechanism* for strong goal-satisfaction checks.
What is missing is the *wiring* from the goal text to those checks.

### 3.1 AcceptanceCheck union (the mechanism)

`src/mission/verification.ts:25-125` defines 7 check kinds:

| Kind | Purpose | Currently produced by `buildChecks()`? |
|---|---|---|
| `command` | Run a shell command, check exit code / stdout | No |
| `file` | Check file exists, optionally `expectIncludes` | Yes (existence only) |
| `evidence` | Check flight-recorder evidence | No |
| `mission-input` | Check mission input hash (`expectHash`) | No |
| `flight-action` | Check a flight action occurred | No |
| `content-in-artifacts` | Check `expectIncludes` across all artifacts | No |
| `hash-match` | Check artifact content hash (`expectHash`) | No |

The `file`, `content-in-artifacts`, and `hash-match` checks are the primary
seams for goal-satisfaction verification. They are implemented and tested
(`tests/mission/verification-hash-match.test.ts`) but never produced by the
gateway.

### 3.2 MissionOrchestratorOptions.checks (the seam)

`src/mission/orchestrator.ts:86-90` defines:
```typescript
checks?: (ctx: { goal: Goal; requirements: GoalRequirements }) =>
  readonly AcceptanceCheck[];
```

This callback is the integration point. The gateway's `MissionService`
currently passes `checks: (ctx) => this.buildChecks(ctx)`, where
`buildChecks()` only emits file-existence checks. A future implementation can
read user-supplied acceptance criteria (from the POST body or from an extended
`Goal` contract) and emit `expectIncludes` / `expectHash` checks.

### 3.3 GoalCompiler (the extraction point)

`src/goal/goal-compiler.ts:202-267` currently classifies the goal text via
word signals (domain, capability needs, budget tier). It does NOT extract:
- The requested filename (e.g., `genesis_demo.md`)
- Required content sections (e.g., "problem", "solution", "success criteria")
- Required content inclusions (e.g., specific phrases)
- Hash expectations

A future `GoalCompiler` extension (or a sibling `AcceptanceCriteriaExtractor`)
can parse these from the goal text or from explicit user-supplied criteria.

---

## 4. Future Implementation Paths

### 4.1 Path A — Caller-Supplied Acceptance Criteria (no contract change)

**Approach:** Accept optional `acceptanceCriteria` in the `MissionSubmission`
POST body (not in the frozen `Goal` contract). The gateway maps these to
`AcceptanceCheck` entries in `buildChecks()`.

**Example POST body:**
```json
{
  "outcome": "Create genesis_demo.md with a project brief...",
  "acceptanceCriteria": [
    { "kind": "file", "path": "genesis_demo.md", "expectIncludes": ["# "] },
    { "kind": "content-in-artifacts", "expectIncludes": ["problem", "solution"] }
  ]
}
```

**Pros:**
- No frozen contract modification (`Goal` unchanged).
- The `MissionSubmission` type is transport-facing, not a frozen engine contract.
- The `AcceptanceCheck` union already supports these kinds.
- `VerificationLoop` already evaluates them.

**Cons:**
- The caller must explicitly supply criteria — not extracted from the goal text.
- The UI must expose a criteria composer (added complexity).
- Does not help users who type a natural-language goal without structured criteria.

**Effort:** ~2 modified files (`src/gateway/types.ts`, `src/gateway/mission-service.ts`),
0 new dependencies, 0 frozen contract changes.

### 4.2 Path B — GoalCompiler Acceptance Extraction (contract addition)

**Approach:** Add an optional `acceptanceCriteria` field to the frozen `Goal`
contract. Extend `GoalCompiler` to extract expected filenames, required
sections, and content inclusions from the goal text. Wire these into
`buildChecks()`.

**Example:**
- Goal: "Create a Markdown file named `genesis_demo.md` containing a project
  brief with problem, solution, and success criteria sections."
- Extracted:
  - `{ kind: 'file', path: 'genesis_demo.md' }`
  - `{ kind: 'content-in-artifacts', expectIncludes: ['problem', 'solution', 'success criteria'] }`

**Pros:**
- Automatic — no user-supplied criteria needed.
- Handles the common case (filename + content structure in the goal text).

**Cons:**
- Modifies the frozen `Goal` contract (`src/contracts/core.ts:65-76`).
- Requires explicit approval per the frozen-contract rule.
- NLP extraction is non-deterministic — may miss or misextract criteria.
- Does not handle goals that don't specify a filename or content structure.

**Effort:** ~4 modified files (`core.ts`, `goal-compiler.ts`,
`mission-service.ts`, `verification.ts`), 0 new dependencies, 1 frozen contract
change (requires approval).

### 4.3 Path C — LLM-Based Goal Satisfaction Evaluator (deferred)

**Approach:** After execution, an LLM evaluator compares the produced artifact
against the goal text and returns a `GoalSatisfactionResult` with a score and
rationale.

**Pros:**
- Handles arbitrary goals (no extraction needed).
- Can evaluate semantic satisfaction, not just structural.

**Cons:**
- Non-deterministic — the evaluator itself may be wrong.
- Adds cost (another LLM call per mission).
- Requires a `GoalSatisfactionResult` type (new contract).
- The evaluator's rationale is opaque — hard to debug.

**Recommendation:** DEFER. Not appropriate for G7-11. Consider only if Paths A
and B prove insufficient for real-execution qualification.

---

## 5. Recommendation for G7-11

**Implement Path A (caller-supplied acceptance criteria) first.**

Rationale:
1. It requires no frozen contract changes — respects the G7-10 constraint.
2. It uses existing `AcceptanceCheck` kinds and `VerificationLoop` — no new engine.
3. It is testable with a real reasoning provider (G7-11's goal): submit a goal
   with `{ kind: 'file', path: 'genesis_demo.md', expectIncludes: ['# '] }`,
   let the real LLM produce the file, and verify that the verification loop
   actually checks the content.
4. It provides a clear distinction: execution success (workflow completed) vs.
   artifact integrity (checks passed) vs. goal satisfaction (user-supplied
   criteria met). The UI can then show three separate badges.

**Path B (GoalCompiler extraction) can follow** if users find manual criteria
entry too cumbersome. It requires frozen-contract approval.

**Path C (LLM evaluator) is deferred** indefinitely until Paths A+B prove
insufficient.

---

## 6. Contract Boundary (G7-10 Constraint)

**No frozen contract is modified during G7-10.**

This document defines the *future* path. The following are NOT changed in
G7-10:
- `src/contracts/core.ts` — `Goal`, `GoalRequirements`, `MissionResult`,
  `ReasoningProvider` (all frozen).
- `src/mission/verification.ts` — `AcceptanceCheck` union (frozen mechanism).
- `src/mission/orchestrator.ts` — `MissionOrchestratorOptions.checks` (frozen seam).

The only G7-10 changes are:
- UI disclosure (Workstream A) — no contract changes.
- `GET /v1/missions` list endpoint + `MissionListSummary` type (Workstream B) —
  additive transport type, no frozen contract change.

---

## 7. Tracked Requirement

**Goal Satisfaction Verification remains an explicit requirement for
subsequent real-execution qualification (G7-11 or a separately approved
follow-up).**

This document is the tracking artifact. It must be referenced when G7-11
begins, and the chosen path (A, B, or C) must be documented in the G7-11
implementation report.

---

## 8. Evidence References

| Claim | Source |
|---|---|
| `buildChecks()` emits only file-existence | `src/gateway/mission-service.ts:1011-1038` |
| Orchestrator status decision | `src/mission/orchestrator.ts:807-842` |
| `AcceptanceCheck` union (7 kinds) | `src/mission/verification.ts:25-125` |
| `hash-match` check implemented but unused | `src/mission/verification.ts:552-588` |
| `MissionOrchestratorOptions.checks` seam | `src/mission/orchestrator.ts:86-90` |
| `Goal` contract (no acceptanceCriteria) | `src/contracts/core.ts:65-76` |
| `GoalRequirements.successCriteria` (free-text) | `src/contracts/core.ts:97-112` |
| `GoalCompiler` (word-signal only) | `src/goal/goal-compiler.ts:202-267` |
| `captureVerificationResult` (verified flag) | `src/gateway/mission-service.ts:914-956` |
| `SuccessCriterion` never evaluated | `src/contracts/core.ts:78-82` |

---

**End of design document.**
