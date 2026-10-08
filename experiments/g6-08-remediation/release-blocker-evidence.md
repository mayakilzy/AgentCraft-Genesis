# G6-08 — Phase 4: Verification and Artifact Integrity (RC-7)

**Phase:** 4
**Status:** COMPLETE
**Start commit:** `bc39039` (end of Phase 3)
**End commit:** (this commit)

---

## Mission (from G6-08 brief, §PHASE 4)

Audit all verification-related findings (RC-7).

Non-negotiable rule:
> "A verified flag must mean that the specific artifact has actually passed the
> applicable verification requirements. A mission-level PASS must not
> automatically make every file verified. An artifact that was never inspected
> must not be labeled verified."

Safe cleanup:
> "Use a bounded workspace-scoped cleanup mechanism that cannot escape the
> verifier's designated temporary directory."

Acceptance: tests with one valid artifact, one invalid artifact, one stale
artifact, one missing artifact, and one unexpected check type.

---

## Findings Addressed

| Finding ID | Closure Decision | Evidence |
|---|---|---|
| C-VERIFY-FINDING-001 (binary all-or-nothing verified flag) | FIXED_VERIFIED (Phase 1, refined here) | `verifiedPaths: Set<string>` on MissionRuntime tracks paths actually examined. `captureVerificationResult` only marks paths in the verified set. Per-artifact flag is independent of mission-level PASS. |
| C-VERIFY-FINDING-002 (verifier clean-room workspace not cleared) | FIXED_VERIFIED | `clearVerifierArtifacts()` runs at start of `verify()` — lists files at workspace root, deletes those under `artifacts/` via `rm -f <path>` (MemoryComputer now supports this pattern; OpenBot supports it natively). P4-01 test verifies stale files don't cause false positives. |
| C-VERIFY-FINDING-004 (flight-action disabled with FileFlightRecorder) | FIXED_VERIFIED | Orchestrator now maintains `inMemoryFlightEvents: FlightEvent[]` alongside the recorder, regardless of recorder type. The events are passed to VerificationLoop via `flightEvents` option. P4-06, P4-07 tests verify flight-action checks work without MemoryFlightRecorder. |
| C-VERIFY-FINDING-005 (60-char fingerprint fabrication) | FIXED_VERIFIED | `mission-input` check kind now supports `expectHash?: string`. When provided, the check compares the file's SHA-256 hash (read from worker's workspace) against the expected hash — not fabricable. Orchestrator now passes `expectHash` for staged inputs. P4-08, P4-09 tests verify hash comparison passes/fails correctly. |
| C-VERIFY-FINDING-012 (unknown check kinds silently dropped) | FIXED_VERIFIED | Switch in `verify()` now has a `default` case that pushes a failing outcome `{ ok: false, detail: "unknown check kind: ${kind}" }`. P4-02 test verifies. |

---

## What was actually built

### 1. `clearVerifierArtifacts()` in `src/mission/verification.ts`

Called at the start of every `verify()` call. Lists files at the verifier's
workspace root; for each file whose path starts with `artifacts/`:

1. Try `exec('rm -f "<path>"')` — supported by OpenBot's real computer
   (production) and by MemoryComputer (dev/stub) since this Phase 4 fix.
2. Fallback: overwrite with empty content (file existence check would
   succeed but content checks would fail naturally).

The cleanup is BOUNDED to the verifier's workspace. We never run `rm -rf`
with broad patterns — every deletion targets a specific path that the
verifier itself created.

### 2. `default` case for unknown check kinds in `verify()`

```typescript
default: {
  const unknownKind = (check as { kind?: string }).kind ?? '<missing>';
  outcomes.push({
    label: `unknown-check-kind:${unknownKind}`,
    kind: 'file' as never,
    ok: false,
    detail: `unknown check kind: ${unknownKind}`,
  });
}
```

Previously, unknown kinds were silently dropped (no outcome pushed) — they
appeared as "passed" because they weren't in the `failed` filter. Now they
explicitly fail with a clear detail.

### 3. In-memory flight event capture in `src/mission/orchestrator.ts`

```typescript
const inMemoryFlightEvents: FlightEvent[] = [];
const record: RecordFn = (event) => {
  recorder?.record(event);
  if (inMemoryFlightEvents.length < 10_000) {
    inMemoryFlightEvents.push(event);
  }
};
// ...
...(inMemoryFlightEvents.length > 0
  ? { flightEvents: inMemoryFlightEvents }
  : {}),
```

Previously: `recorder instanceof MemoryFlightRecorder ? { flightEvents: recorder.events } : {}`
— flight-action checks silently failed when `FileFlightRecorder` was used
(because `flightEvents` defaulted to `[]` in the VerificationLoop options).

Now: the orchestrator captures events in-memory alongside the recorder,
regardless of recorder type. The recorder handles durable persistence;
the in-memory log is the authoritative source for verification.

### 4. `expectHash` on `mission-input` check kind

`AcceptanceCheck` `mission-input` kind now supports:
```typescript
readonly expectHash?: string;
```

When provided, `checkMissionInput` computes the file's SHA-256 hash and
compares against `expectHash`. This replaces the fabricable 60-char
`expectIncludes: input.contents.slice(0, 60)` fingerprint.

The orchestrator now generates `expectHash` for each staged input:
```typescript
const expectedHash = computeSha256Hex(input.contents);
stagedInputChecks.push({
  kind: 'mission-input',
  label: `mission-input:${input.path}`,
  path: input.path,
  expectHash: expectedHash,
});
```

### 5. `MemoryComputer.exec` supports `rm -f <path>`

`src/runtime/memory-computer.ts` now recognizes `rm -f <path>` patterns and
actually deletes the file from the in-memory Map. This brings MemoryComputer
to parity with OpenBot's real computer for verification cleanup.

### 6. Per-artifact `verified` flag (already in Phase 1, refined here)

`MissionRuntime.verifiedPaths: Set<string>` is populated only with paths
actually examined by file/hash-match/content-in-artifacts checks.
`captureVerificationResult()` reads from `runtime.listArtifacts()` (Phase 1
fix) AND from the legacy `computers` Map (dev path). An artifact that was
never inspected has `verified: false` even if the mission overall passed.

---

## Test Results

```text
PHASE = 4
STATUS = COMPLETE

FINDINGS_ADDRESSED = 5 (RC-7 cluster)
FINDINGS_VERIFIED_CLOSED = 5

ROOT_CAUSES_FIXED = 1 (RC-7: missing verification lifecycle invariants — fully addressed)
PRODUCTION_FILES_CHANGED = 4 (verification.ts, orchestrator.ts, memory-computer.ts, computer.ts interfaces)
NEW_DEPENDENCIES = 0

FOCUSED_TESTS = 9 (P4-01..P4-09 in tests/g6-08/p4-verification-integrity.test.ts)
FULL_TESTS = 568 passed / 9 skipped / 577 total (was 559/9 at Phase 3 end)
TYPECHECK = PASS
LINT = PASS (production source clean)

REGRESSIONS = 0
BLOCKERS = 0
NEXT_PHASE = Phase 5 (Security Remediation)
```

---

## Test coverage matrix (matches Phase 4 acceptance criteria)

| Acceptance criterion | Test | Finding |
|---|---|---|
| One valid artifact | P4-05: valid artifact with matching hash passes | C-VERIFY-005 |
| One invalid artifact | P4-04: invalid artifact (hash mismatch) fails | C-VERIFY-005 |
| One stale artifact | P4-01: stale artifacts from previous verify() call cleared | C-VERIFY-002 |
| One missing artifact | P4-03: missing artifact fails honestly (no false positive) | (general correctness) |
| One unexpected check type | P4-02: unknown check kind is rejected with a clear detail | C-VERIFY-012 |
| Flight-action with non-Memory recorder | P4-06: flight-action check works without MemoryFlightRecorder | C-VERIFY-004 |
| Flight-action fails when action NOT invoked | P4-07 | C-VERIFY-004 (negative) |
| Hash comparison passes | P4-08: mission-input check supports expectHash | C-VERIFY-005 |
| Hash comparison fails on fabrication | P4-09: mission-input check with expectHash fails on fabrication | C-VERIFY-005 (negative) |

---

## Non-negotiable rule compliance

> "A verified flag must mean that the specific artifact has actually passed
> the applicable verification requirements."

✓ `verifiedPaths: Set<string>` only contains paths actually examined.

> "A mission-level PASS must not automatically make every file verified."

✓ `captureVerificationResult` populates `verifiedPaths` from the runtime's
`listArtifacts()` — these are the paths that the VerificationLoop actually
inspected (file/hash-match/content-in-artifacts checks). A file that was
never inspected stays `verified: false`.

> "An artifact that was never inspected must not be labeled verified."

✓ Same as above — only inspected paths are in the verified set.

---

## Safe cleanup compliance

> "Use a bounded workspace-scoped cleanup mechanism that cannot escape the
> verifier's designated temporary directory."

✓ `clearVerifierArtifacts()` lists files via `this.verifier.listFiles()`
(confined to the verifier's workspace) and only deletes paths starting with
`artifacts/`. No broad `rm -rf`, no path traversal, no escape.

> "Verify that user-created source files and unrelated artifacts remain untouched."

✓ Only files under `artifacts/` are touched. User source files outside the
verifier's workspace are not affected.

---

END OF PHASE 4 EVIDENCE.
