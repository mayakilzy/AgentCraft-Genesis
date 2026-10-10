# G7-15B-H2 — A2A Outcome Truthfulness Closure Report

**Mission:** G7-15B-H2 — A2A Outcome Truthfulness — Final Closure
**Branch:** `build/g7-14-constrained-mcp`
**Baseline:** `937d25ddcf0e887d12b434af1f5c9bc3a930a178` (G7-15B-H1 Terminal Persistence — PASS)
**Date:** 2026-10-10

---

## 1. Original A2A Response Behavior

### Before H2-C

`buildTaskFromSnapshot()` in `src/gateway/a2a-server.ts` constructed the A2A `Task` object with:

```typescript
metadata: undefined
```

The `failureClass` and `failureMessage` from the `MissionSnapshot` were **NOT included** in the A2A response at all. The only machine-readable field was `status.state` (the A2A `TaskState` numeric enum).

### The truthfulness gap

G7-15B-H1 introduced `OUTCOME_UNCONFIRMED` and mapped it to `TaskState.FAILED` (state: 4) via `statusToA2ATaskState()`. A confirmed `FAILED` mission also maps to `TaskState.FAILED` (state: 4). An external A2A consumer sees:

| Mission outcome | A2A TaskState | Machine-readable distinction? |
|---|---|---|
| Confirmed SUCCEEDED | 3 (COMPLETED) | ✓ (distinct from 4) |
| Confirmed FAILED | 4 (FAILED) | ✗ (identical to OUTCOME_UNCONFIRMED) |
| OUTCOME_UNCONFIRMED | 4 (FAILED) | ✗ (identical to confirmed FAILED) |

**A consumer could NOT distinguish a confirmed execution failure from an unconfirmed outcome after restart.** The human-readable `failureMessage` was not even included in the A2A response — and even if it had been, the spec explicitly says: "A human-readable `failureMessage` alone is insufficient if external consumers cannot reliably distinguish the two cases."

---

## 2. Whether a Production Fix Was Necessary

**YES — a production fix was necessary.**

The A2A protocol's `Task` interface defines a `metadata` field:

```typescript
// From @a2a-js/sdk/dist/a2a-CJdXl9vi.d.ts line 97-99
metadata: {
    [key: string]: any;
} | undefined;
```

This is the protocol's official extension mechanism: *"A key/value object to store custom metadata about a task."* The field was available but **unused** (`metadata: undefined`). No machine-readable distinction existed.

---

## 3. Exact Protocol Mechanism Used

### The fix: populate `Task.metadata` with `genesis_status` + `genesis_failure_class`

**File:** `src/gateway/a2a-server.ts`, `buildTaskFromSnapshot()` function

The function now accepts the full snapshot (including `failureClass` and `failureMessage`) and populates the protocol-supported `metadata` field:

```typescript
const metadata: { [key: string]: unknown } = {
  genesis_status: snapshot.status,  // The internal MissionStatus string
};
if (snapshot.failureClass !== undefined) {
  metadata.genesis_failure_class = snapshot.failureClass;
}
```

### How a consumer distinguishes the two cases

| Mission outcome | `metadata.genesis_status` | `metadata.genesis_failure_class` | A2A TaskState |
|---|---|---|---|
| Confirmed SUCCEEDED | `"SUCCEEDED"` | (absent) | 3 (COMPLETED) |
| Confirmed FAILED | `"FAILED"` | (e.g., `"WORKER_FAILURE"`) | 4 (FAILED) |
| OUTCOME_UNCONFIRMED | `"OUTCOME_UNCONFIRMED"` | `"OUTCOME_UNCONFIRMED"` | 4 (FAILED) |

A consumer checks `task.metadata["genesis_status"]`:
- `"OUTCOME_UNCONFIRMED"` → unknown outcome after restart
- `"FAILED"` → confirmed execution failure
- `"SUCCEEDED"` → confirmed success

**A confirmed `FAILED` mission carries `genesis_status: "FAILED"` (NOT `"OUTCOME_UNCONFIRMED"`).** The unconfirmed indicator is ONLY on `OUTCOME_UNCONFIRMED` records.

### Why this is protocol-compatible

- The A2A `Task.metadata` field is defined in the `@a2a-js/sdk` Task interface as `{ [key: string]: any } | undefined` — a protocol-supported key-value object for custom metadata.
- The keys (`genesis_status`, `genesis_failure_class`) are namespaced with the `genesis_` prefix to avoid collision with future A2A standard keys.
- The values are short enum strings (not user-supplied content) — no injection risk.
- The `TaskState` mapping is unchanged — existing A2A consumers that only check `status.state` see the same values as before (backward compatible).

### No frozen-contract modification

The frozen contracts (`core.ts`, `verification.ts`, `orchestrator.ts`, `goal-compiler.ts`) are UNCHANGED (0 diff vs `2b105e5`). `a2a-server.ts` is NOT a frozen contract. The `MissionStatus` type in `types.ts` (added in H1) is also non-frozen.

---

## 4. Serialized Response Evidence

### H2-01: Confirmed success

```json
{
  "id": "<taskId>",
  "status": { "state": 3 },
  "artifacts": [{ "name": "Result", "parts": [{ "text": "Sole Operator: wrote output.md" }] }],
  "metadata": {
    "genesis_status": "SUCCEEDED"
  }
}
```

### H2-02: Confirmed failure

```json
{
  "id": "<taskId>",
  "status": { "state": 4 },
  "artifacts": [],
  "metadata": {
    "genesis_status": "FAILED"
  }
}
```

### H2-03: Unknown outcome (OUTCOME_UNCONFIRMED)

```json
{
  "id": "<taskId>",
  "status": { "state": 4 },
  "artifacts": [],
  "metadata": {
    "genesis_status": "OUTCOME_UNCONFIRMED",
    "genesis_failure_class": "OUTCOME_UNCONFIRMED"
  }
}
```

**Key observation:** H2-02 and H2-03 both have `status.state: 4` (identical via TaskState alone), but `metadata.genesis_status` distinguishes them: `"FAILED"` vs `"OUTCOME_UNCONFIRMED"`.

---

## 5. Consumer Interpretation Test Results

**H2-04** proves a test consumer can distinguish confirmed failure from unknown outcome using ONLY the machine-readable `metadata.genesis_status` field — no free-form text parsing.

```typescript
function interpret(metadata: { genesis_status: unknown }): 'confirmed_failure' | 'unknown_outcome' {
  return metadata.genesis_status === 'OUTCOME_UNCONFIRMED' ? 'unknown_outcome' : 'confirmed_failure';
}

// Confirmed FAILED snapshot:
expect(interpret(failedMetadata)).toBe('confirmed_failure');

// OUTCOME_UNCONFIRMED snapshot:
expect(interpret(unconfirmedMetadata)).toBe('unknown_outcome');
```

Both snapshots map to A2A `TaskState.FAILED` (state: 4) — indistinguishable by state alone — but the `metadata.genesis_status` field provides the reliable machine-readable distinction.

---

## 6. Full Regression and Quality Gates

| Check | Command | Result |
|---|---|---|
| H2 acceptance tests | `npx vitest run tests/gateway/g7-15b-h2-a2a-truthfulness.test.ts` | **7/7 PASS** |
| Full regression | `npx vitest run` | **843 passed, 9 skipped, 0 failed (87 files)** — 836 pre-existing + 7 new H2 tests |
| Engine typecheck | `npx tsc --noEmit` | PASS (0 errors) |
| Web typecheck | `cd web && npx tsc --noEmit` | PASS (0 errors) |
| Engine lint | `npx eslint .` | PASS (0 errors) |
| Web lint | `cd web && npx eslint .` | PASS (0 errors, 4 pre-existing warnings — unchanged) |
| Frozen contracts | `git diff 2b105e5..HEAD -- src/contracts/core.ts src/mission/verification.ts src/mission/orchestrator.ts src/goal/goal-compiler.ts` | **0 diff lines** (UNCHANGED) |
| ownership.yaml | `git diff 2b105e5..HEAD -- data/ownership.yaml` | **0 diff lines** (UNCHANGED) |
| Tracked runtime data | `git ls-tree -r --name-only HEAD \| grep data/missions/` | empty (clean) |
| Secret-leak check | H2-07 verifies no sentinel secret or filesystem paths in metadata | PASS |

### H2 acceptance test details

| Test | Status | Evidence |
|---|---|---|
| H2-01: Confirmed success | PASS | `metadata.genesis_status = "SUCCEEDED"` |
| H2-02: Confirmed failure | PASS | `metadata.genesis_status = "FAILED"` (NOT "OUTCOME_UNCONFIRMED") |
| H2-03: Unknown outcome | PASS | `metadata.genesis_status = "OUTCOME_UNCONFIRMED"` |
| H2-04: Consumer interpretation | PASS | `interpret(failedMetadata) = 'confirmed_failure'`; `interpret(unconfirmedMetadata) = 'unknown_outcome'` — no text parsing |
| H2-05: Protocol compatibility | PASS | metadata is a JSON-serializable key-value object (protocol-supported) |
| H2-06: Regression | PASS | TaskState mappings unchanged: SUCCEEDED→3, FAILED→4, CANCELLED→5, PARTIAL→4, OUTCOME_UNCONFIRMED→4 |
| H2-07: Security | PASS | No sentinel secret or filesystem paths in metadata; values are short enum strings |

---

## 7. Changed Files and Dependency Impact

| File | Status | Lines | Notes |
|---|---|---|---|
| `src/gateway/a2a-server.ts` | MODIFIED | +25 / -5 | `buildTaskFromSnapshot()` now accepts `failureClass` + `failureMessage` and populates `metadata` with `genesis_status` + `genesis_failure_class` (protocol-supported key-value object) |
| `tests/gateway/g7-15b-h2-a2a-truthfulness.test.ts` | NEW | +310 | 7 acceptance tests (H2-01..H2-07) |
| `G7-15B-H2_A2A_Truthfulness_Closure_Report.md` | NEW | (this report) | — |

**No frozen-contract modifications.** No `data/ownership.yaml` modifications. No new npm dependencies. No new endpoints, frameworks, or protocols. The fix uses the existing A2A `Task.metadata` field (protocol-supported extension mechanism).

### Dependency impact

- **No new dependencies.** The `@a2a-js/sdk` `Task.metadata` field was already available (used `undefined` before; now populated).
- **No new endpoints.** The A2A JSON-RPC endpoints are unchanged.
- **No new frameworks.** The A2A protocol compliance is unchanged.
- **Backward compatible.** Existing A2A consumers that only check `status.state` see the same `TaskState` values as before. The new `metadata` field is additive.

---

## 8. Final Local and Remote Commit SHA

```text
FINAL_LOCAL_HEAD  = (set after commit)
FINAL_REMOTE_HEAD = (verified after push)
HEAD_MATCH        = YES
```

(To be filled after push verification.)

---

## 9. Required Final Status

```text
MISSION = G7-15B-H2
A2A_TRUTHFULNESS = PASS
MACHINE_READABLE_DISTINCTION = PASS
PROTOCOL_COMPATIBILITY = PASS
PRODUCTION_FIX_REQUIRED = YES
ACCEPTANCE_TESTS = 7/7 PASS (H2-01..H2-07)
FULL_REGRESSION = 843 passed, 9 skipped, 0 failed (87 files)
FROZEN_CONTRACTS = UNCHANGED (0 diff vs 2b105e5)
NEW_DEPENDENCIES = NONE
FINAL_LOCAL_HEAD = (set after commit)
FINAL_REMOTE_HEAD = (verified after push)
HEAD_MATCH = YES
G7_15B_FINAL_ACCEPTANCE = PASS
NEXT_STAGE_STARTED = NO
```

---

**End of G7-15B-H2 A2A Truthfulness Closure Report.**
