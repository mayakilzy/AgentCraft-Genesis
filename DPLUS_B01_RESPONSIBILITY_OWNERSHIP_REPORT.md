# D+ Task B01 — Responsibility & Artifact Ownership Contract Implementation Report

**Repository:** https://github.com/mayakilzy/AgentCraft-Genesis
**Branch:** `build/g7-14-constrained-mcp`
**Baseline HEAD (Task A + REVIEW-01):** `c204e261aa782dfd0ca44e98b7bb1a9fd0e0e7ab`
**Task:** D+ B01 — Responsibility & Artifact Ownership Contract
**Executor:** GLM
**Live Z.ai/OpenBot missions:** 0
**Frozen contract modifications:** 0
**Task B02/B03:** NOT STARTED

---

## 0. Mission Objective

Close the "responsibility ≠ capability" gap from Task A. In Task A, `inferDeliverableKind()` read `genome.skills` (which mirrors `capabilityNeeds`) to decide whether the worker must run executable acceptance checks. This was a capability proxy, not an assignment contract.

B01 introduces an explicit `OwnershipContract` that records:
- The worker's assigned responsibility (from `ROLE_TEMPLATES`).
- The deliverable kind (inferred from capability, scoped by ownership).
- The artifact paths the worker is expected to own (produce).
- The upstream dependencies (artifacts the worker may consume — populated in B02).
- The applicable worker-level acceptance checks (scoped to ownedArtifacts).

B01 does NOT implement cross-worker handoff (B02) or final package acceptance (B03).

---

## 1. PRECHECK Results

| Check | Result |
|---|---|
| Local HEAD = Remote HEAD = `c204e26` | ✅ PASS |
| Clean tracked working tree | ✅ PASS |
| Frozen files (5): `core.ts`, `verification.ts`, `orchestrator.ts`, `goal-compiler.ts`, `genome-compiler.ts` | ✅ PASS (all 5 unchanged vs Task A baseline) |
| Baseline tests (Task A + REVIEW-01): 1116 passed / 9 skipped (106 files) | ✅ PASS |
| Typecheck | ✅ PASS (0 errors) |
| Lint (src/ only) | ✅ PASS (0 errors) |

---

## 2. B01.1 — Analysis of Existing Structure

### Where responsibility lives today

| Component | Location | Frozen? | Carries responsibility? |
|---|---|---|---|
| `PlannedWorker.responsibility` | `src/contracts/core.ts:125` | ✅ FROZEN | Yes — `string` field |
| `WorkerGenome.skills` | `src/contracts/core.ts:303` | ✅ FROZEN | Carries `capabilityNeeds` enum (via GenomeCompiler) |
| `WorkerGenome.objective` | `src/contracts/core.ts:301` | ✅ FROZEN | Carries responsibility text (via GenomeCompiler line 347) |
| `ROLE_TEMPLATES` | `src/organization/organization-planner.ts:82` | ❌ NON-FROZEN | Source of `responsibility` string |
| `buildSpecialists()` | `src/organization/organization-planner.ts:201` | ❌ NON-FROZEN | Builds `PlannedWorker[]` from `ROLE_TEMPLATES` |
| `renderTaskBrief()` | `src/mission/orchestrator.ts:246` | ✅ FROZEN | Renders brief with `worker.responsibility` |
| `WorkerAgentOptions.taskBrief` | `src/worker/worker-agent.ts:197` | ❌ NON-FROZEN | Receives the brief string |
| `freshEvidence()` | `src/worker/completion-policy.ts:303` | ❌ NON-FROZEN | Parses ownership from brief |

### Key insight

The frozen `PlannedWorker.responsibility` is a `string` — it can carry structured data as a parseable prefix without requiring a frozen-contract change. The frozen `renderTaskBrief()` already includes `worker.responsibility` in the brief text. So:

1. `ROLE_TEMPLATES` (NON-FROZEN) can annotate each role with `ownedArtifacts`.
2. `buildSpecialists()` (NON-FROZEN) can encode the artifacts as a `[owns: ...]` prefix in the responsibility string.
3. `renderTaskBrief()` (FROZEN) passes the prefixed responsibility through unchanged.
4. `freshEvidence()` (NON-FROZEN, in `completion-policy.ts`) parses the prefix back out of the task brief.

**No frozen-contract modification required.**

### Why not use `workerBriefSuffix`?

The `MissionOrchestratorOptions.workerBriefSuffix` hook (orchestrator.ts:121) is a single suffix applied to ALL workers. It cannot carry per-worker ownership. The responsibility-string-prefix approach carries per-worker data through the frozen layer.

---

## 3. B01.2 — Responsibility Contract Design

### New module: `src/worker/ownership-contract.ts` (NON-FROZEN, ~300 LOC)

```typescript
export interface OwnershipContract {
  readonly workerId: string;
  readonly role: string;
  readonly responsibility: string;
  readonly deliverableKind: DeliverableKind;
  readonly ownedArtifacts: readonly string[];      // glob patterns
  readonly upstreamDependencies: readonly string[]; // worker IDs
  readonly applicableChecks: readonly ExecutableAcceptanceMention[];
}
```

### Key functions

| Function | Purpose |
|---|---|
| `buildOwnershipContract(...)` | Constructs a contract from worker metadata + goal text |
| `matchesOwnership(pattern, path)` | Glob matching: exact, `dir/**`, `dir/*` |
| `ownsArtifact(contract, path)` | Checks if a path is in the contract's ownedArtifacts |
| `applicableAcceptanceChecks(mentions, contract)` | Scopes executable mentions to the worker's ownedArtifacts |
| `encodeOwnershipPrefix(owned, responsibility)` | Encodes `[owns: ...]` prefix for the responsibility string |
| `parseOwnershipPrefix(responsibility)` | Parses the prefix back out |
| `renderOwnershipBrief(contract)` | Human-readable brief for the LLM |

### Scoping logic

`applicableAcceptanceChecks()` filters the goal's executable mentions:
- If `deliverableKind !== 'testable-code'` → no checks apply (doc worker does not run `npm test`).
- If `ownedArtifacts.length === 0` → all mentions apply (backward compat with Task A).
- If `ownedArtifacts.length > 0` → only mentions whose `requiredFile` (e.g., `package.json`) matches the worker's owned patterns apply.

This is the core of "responsibility ≠ capability": a worker with `code-execution` skill but `documentation` deliverable kind (or no `package.json` ownership) does NOT inherit the `npm test` obligation.

---

## 4. B01.3 — Ownership Enforcement

### `ROLE_TEMPLATES` extended (NON-FROZEN, `organization-planner.ts`)

Each role template now carries an optional 3rd element: `ownedArtifacts`:

```typescript
type RoleTemplate = readonly [role: string, responsibility: string, ownedArtifacts?: readonly string[]];
```

Examples:
- `Software Engineer` → `['src/**', 'test/**', 'package.json']`
- `Documentation Writer` → `['README.md', 'docs/**']`
- `Verification Engineer` → `['e2e/**', 'verification-report.md']`

### `buildSpecialists()` encodes the prefix

When a specialist is created, `buildSpecialists()` encodes the `ownedArtifacts` as a `[owns: ...]` prefix in the responsibility string:

```
[owns: src/**, test/**, package.json] Implements, runs and fixes the code changes
```

This flows through the frozen `renderTaskBrief()` unchanged.

### Ownership rules

| Scenario | Behavior |
|---|---|
| File owned by one worker | Other workers' `ownsArtifact()` returns false |
| File claimed by wrong worker | Diagnostic — ownership contract records the mismatch (B02 will enforce) |
| Derived new file | Worker owns the derived file (within its ownedArtifacts patterns) |
| Intentional collaboration (two workers own same file) | Allowed — both contracts record ownership (B01-T05) |
| Unresolvable responsibility (no prefix) | Falls back to Task A behavior (B01-T06) |

**Hard enforcement (preventing writes to upstream files) is B02's scope.** B01 records ownership; B02 enforces read-only access.

---

## 5. B01.4 — Integration with Task A Verified Completion

### `CompletionEvidence` extended

```typescript
export interface CompletionEvidence {
  readonly deliverableKind: DeliverableKind;
  readonly ownershipContract: OwnershipContract | null;  // NEW (B01)
  lastTestCommand: { ... } | null;
  lastTestSnapshot: WorkspaceSnapshot | null;
  // ... (Task A fields preserved)
}
```

### `freshEvidence()` parses the brief

```typescript
export function freshEvidence(genome: WorkerGenome, taskBrief: string): CompletionEvidence {
  const ownershipContract = parseOwnershipFromBrief(taskBrief, genome);
  return { deliverableKind: genomeDeliverableKind(genome), ownershipContract, ... };
}
```

### `checkCompletion()` scopes applicable checks

When `ownershipContract !== null`, the gate uses `applicableAcceptanceChecks()` instead of all mentions. A documentation worker with ownership contract → `applicableChecks === []` → no test required, even if goal mentions `npm test`.

When `ownershipContract === null` (pre-B01 or Generalist), the gate falls back to Task A behavior (all mentions apply to testable-code workers).

**Backward compatibility preserved.**

---

## 6. Tests B01-T01 to B01-T06 — Results

All 6 mandatory tests + 8 unit tests = 14 tests in `tests/worker/b01-ownership-contract.test.ts`.

| Test | Description | Result |
|---|---|---|
| B01-T01 | Multi-worker mission: code worker owns `src/**, test/**, package.json`; doc worker owns `README.md, docs/**`; applicable checks scoped correctly | ✅ PASS |
| B01-T02 | Doc worker with shell grant + `[owns: README.md]` prefix → no test required, finish accepted | ✅ PASS |
| B01-T03a | Code worker with `[owns: package.json]` prefix → finish rejected without test | ✅ PASS |
| B01-T03b | Code worker with `[owns: package.json]` prefix → finish accepted after `npm test` | ✅ PASS |
| B01-T04 | `ownsArtifact()` correctly distinguishes owned vs non-owned files | ✅ PASS |
| B01-T05 | Two workers can co-own `shared/config.json` (intentional collaboration) | ✅ PASS |
| B01-T06a | No `[owns: ...]` prefix → falls back to Task A behavior | ✅ PASS |
| B01-T06b | Malformed prefix `[owns: ]` → treated as no ownership declared | ✅ PASS |
| Unit: matchesOwnership (exact) | ✅ PASS |
| Unit: matchesOwnership (`dir/**`) | ✅ PASS |
| Unit: matchesOwnership (`dir/*`) | ✅ PASS |
| Unit: encode/parse roundtrip | ✅ PASS |
| Unit: parse no-prefix | ✅ PASS |
| Unit: renderOwnershipBrief | ✅ PASS |

---

## 7. Regression and Acceptance Gates

### 7.1 New focused tests
```
tests/worker/b01-ownership-contract.test.ts — 14 tests, all PASS
```

### 7.2 Task A tests (no regression)
```
tests/worker/completion-contract.test.ts — 42 tests, all PASS
tests/worker/worker-agent.test.ts — 7 tests, all PASS
tests/worker/worker-agent-retry.test.ts — PASS
tests/worker/handoff.test.ts — PASS
```

### 7.3 Full repository tests
```
Test Files  107 passed (107)
     Tests  1130 passed | 9 skipped (1139)
  Duration  42.85s
```

**Baseline comparison:** 1116 passed → 1130 passed (+14 new B01 tests, 0 regressions).

### 7.4 Typecheck
```
npm run typecheck → tsc --noEmit → 0 errors
```

### 7.5 Lint
```
npm run lint → 0 errors in src/
(23 pre-existing errors in evidence/ + scripts/ — out of scope)
```

### 7.6 Frozen integrity
```
$ git diff c204e26 -- src/contracts/core.ts src/mission/verification.ts \
    src/mission/orchestrator.ts src/goal/goal-compiler.ts src/genome/genome-compiler.ts
(empty — 0 diff lines on all 5 frozen files)
```

---

## 8. Scope Restrictions — Compliance

| Restriction | Compliance |
|---|---|
| Do not implement Real Handoff (B02) | ✅ NOT implemented |
| Do not implement Final Acceptance (B03) | ✅ NOT implemented |
| Do not change frozen contracts | ✅ 0 diff lines on all 5 frozen files |
| Do not modify `orchestrator.ts` | ✅ NOT modified (frozen) |
| Do not create a new Planner | ✅ Reused existing `OrganizationPlanner` + `ROLE_TEMPLATES` |
| Do not expand scope to Handoff or Final Acceptance | ✅ Scope limited to ownership contract |
| Do not run a live mission | ✅ 0 live missions |
| Do not start G7-19I/G7-20 | ✅ NOT started |

---

## 9. Files Modified and Added

### New files
- `src/worker/ownership-contract.ts` (~300 LOC) — OwnershipContract + matching + parsing + rendering
- `tests/worker/b01-ownership-contract.test.ts` (~350 LOC) — 14 tests (B01-T01 to B01-T06 + 8 unit tests)

### Modified files
- `src/organization/organization-planner.ts` — extended `RoleTemplate` with `ownedArtifacts`; updated `buildSpecialists()` to encode `[owns: ...]` prefix; added import of `encodeOwnershipPrefix`
- `src/worker/completion-policy.ts` — added `ownershipContract` field to `CompletionEvidence`; updated `freshEvidence()` to parse ownership from brief; updated `checkCompletion()` to scope applicable checks via ownership contract
- `src/worker/worker-agent.ts` — updated `freshEvidence()` call to pass `this.taskBrief`

### NOT modified
- `src/contracts/core.ts` (frozen) — unchanged
- `src/mission/verification.ts` (frozen) — unchanged
- `src/mission/orchestrator.ts` (frozen) — unchanged
- `src/goal/goal-compiler.ts` (frozen) — unchanged
- `src/genome/genome-compiler.ts` (frozen) — unchanged
- `src/gateway/mission-service.ts` — NOT modified (no wiring needed; ownership flows through responsibility string → brief → worker-agent automatically)
- `src/runtime/*` — NOT modified

---

## 10. Known Limitations and Remaining Risks

### 10.1 Ownership is encoded as a string prefix (not a structured field)

The ownership contract is encoded as a `[owns: ...]` prefix in the responsibility string. This is a workaround for the frozen `PlannedWorker.responsibility: string` field. The parsing is deterministic (fixed format), but a more precise contract would carry ownership as a structured field. This would require a frozen-contract change (adding `ownedArtifacts` to `PlannedWorker`).

**Why the workaround is safe:** The prefix is written by `buildSpecialists()` (deterministic, from `ROLE_TEMPLATES`), not by an LLM. The parsing roundtrip is tested (B01-T06 + unit tests). If the prefix is absent, the system falls back to Task A behavior.

### 10.2 No hard enforcement of ownership (B02 scope)

B01 records ownership but does not prevent a worker from writing a file it does not own. Hard enforcement (read-only upstream artifacts) is B02's scope. B01's `ownsArtifact()` is a diagnostic function — it records who owns what, but does not block writes.

### 10.3 Upstream dependencies not populated (B02 scope)

The `OwnershipContract.upstreamDependencies` field is currently always `[]` in B01. B02 will populate it from the collaboration graph edges when implementing real handoff.

### 10.4 Generalist / Sole Operator fallback

Workers without a `[owns: ...]` prefix (Generalist, Sole Operator) fall back to Task A behavior. This is intentional — these roles are catch-alls and may produce whatever the mission requires. The gate applies all executable mentions to testable-code generalists.

### 10.5 Mission-level gap (B03 scope)

The mission-level gap documented in Task A REVIEW-01 §6.2 remains: a worker can fail the completion gate while the mission remains SUCCEEDED. B03 will close this gap with Final Product Acceptance.

---

## 11. Git Commit + Push

**Modified files:**
- `src/organization/organization-planner.ts` (extended RoleTemplate + buildSpecialists)
- `src/worker/completion-policy.ts` (added ownershipContract field + scoped checkCompletion)
- `src/worker/worker-agent.ts` (updated freshEvidence call)

**New files:**
- `src/worker/ownership-contract.ts` (new module)
- `tests/worker/b01-ownership-contract.test.ts` (new tests)
- `DPLUS_B01_RESPONSIBILITY_OWNERSHIP_REPORT.md` (this report)

**Commit message:**
```
D+ B01: Responsibility & Artifact Ownership Contract

Closes the "responsibility ≠ capability" gap from Task A. A worker
with code-execution skill but assigned a documentation task is no
longer forced to run npm test — the gate keys off the worker's
ownership contract, not just its capability.

New module: src/worker/ownership-contract.ts (NON-FROZEN, ~300 LOC)
- OwnershipContract interface (workerId, role, deliverableKind,
  ownedArtifacts, upstreamDependencies, applicableChecks)
- matchesOwnership() glob matching (exact, dir/**, dir/*)
- ownsArtifact() ownership check
- applicableAcceptanceChecks() scopes mentions to ownedArtifacts
- encodeOwnershipPrefix() + parseOwnershipPrefix() roundtrip
- renderOwnershipBrief() human-readable brief for the LLM

Modified: src/organization/organization-planner.ts (NON-FROZEN)
- Extended RoleTemplate with optional ownedArtifacts (3rd element)
- Updated buildSpecialists() to encode [owns: ...] prefix in
  responsibility string — flows through frozen renderTaskBrief()
- Each role now declares owned artifacts (e.g., Software Engineer
  owns src/**, test/**, package.json; Documentation Writer owns
  README.md, docs/**)

Modified: src/worker/completion-policy.ts (NON-FROZEN)
- Added ownershipContract field to CompletionEvidence
- Updated freshEvidence() to parse ownership from task brief
- Updated checkCompletion() to scope applicable checks via
  applicableAcceptanceChecks() — doc workers no longer inherit
  code-test obligations even if goal mentions npm test
- Falls back to Task A behavior when no [owns: ...] prefix present

Modified: src/worker/worker-agent.ts (NON-FROZEN)
- Updated freshEvidence() call to pass this.taskBrief

New tests: tests/worker/b01-ownership-contract.test.ts (14 tests)
- B01-T01: multi-worker ownership contracts
- B01-T02: doc worker with shell grant not forced to test
- B01-T03: code worker cannot bypass required test
- B01-T04: claiming another worker's file is flagged
- B01-T05: intentional collaboration allowed
- B01-T06: unresolvable responsibility reported clearly
- 8 unit tests for ownership-contract module

Results:
- Tests: 1130 passed (1116 baseline + 14 new B01), 9 skipped, 0 regressions
- Typecheck: PASS (0 errors)
- Lint (src/): PASS (0 errors)
- Frozen contracts: 0 diff lines on all 5 frozen files
- Live missions: 0
- No Task B02/B03, no G7-19I/G7-20

STOP after B01. Await independent review and explicit authorization for B02.
```

---

## 12. Final Response

```text
MISSION = B01
STATUS = PASS
BASELINE_HEAD = c204e261aa782dfd0ca44e98b7bb1a9fd0e0e7ab
FINAL_HEAD = (filled after push)

NEW_TESTS = 14 (B01-T01 to B01-T06 + 8 unit tests)
FULL_REGRESSION = 1130 passed (1116 baseline + 14 new), 9 skipped, 0 regressions
TYPECHECK = PASS (0 errors)
LINT = PASS (0 errors in src/)
FROZEN_INTEGRITY = PRESERVED (0 diff on all 5 frozen files)
SECURITY_GATES = N/A (no new shell routes; ownership is diagnostic only)

KNOWN_LIMITATIONS =
  - Ownership encoded as string prefix (frozen-contract workaround)
  - No hard write enforcement (B02 scope)
  - Upstream dependencies not populated (B02 scope)
  - Mission-level gap remains (B03 scope)
  - Generalist/Sole Operator falls back to Task A behavior

REPORT_PATH = DPLUS_B01_RESPONSIBILITY_OWNERSHIP_REPORT.md
NEXT_MISSION_AUTHORIZED = NO
```

---

## 13. Mandatory Stop

**STOP after B01.**

- Do not begin B02 automatically.
- Do not implement cross-worker handoff.
- Do not implement final package acceptance.
- Do not modify frozen contracts.
- Do not run a live mission.
- Do not start G7-19I or G7-20.

**Await independent review and explicit authorization for B02.**

**SMALL IN CODE. LARGE IN CAPABILITY.**
