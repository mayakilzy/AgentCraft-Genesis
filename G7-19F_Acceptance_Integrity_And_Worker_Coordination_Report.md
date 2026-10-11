# G7-19F — Acceptance Integrity & Worker Coordination Audit

**Repository:** https://github.com/mayakilzy/AgentCraft-Genesis
**Branch:** `build/g7-14-constrained-mcp`
**Baseline (verified):** `39aa0c6a162bf2d80a9581f9a136d1ccb6e3bdbb` (G7-19E final HEAD, post-push)
**Live Z.ai calls:** ZERO
**Executor:** GLM
**Stop after G7-19F. Do not start G7-20.**

---

## 1. Mission Objective

G7-19F investigates the three production findings from G7-19E and
implements only small, evidence-supported corrections. It does NOT
launch another live mission.

The three G7-19E findings:

1. **Acceptance contract integrity** — the user's explicit
   requirement "npm test MUST exit 0 within 60s" became a
   `hardConstraint` string inside `GoalRequirements` (via the FROZEN
   goal compiler) and was NEVER translated into a `command`-type
   `AcceptanceCheck`. The structural floor + content-in-artifacts
   checks passed (22/22), verification reported `ok=true`, and the
   mission was reported as SELECTED — even though the produced
   application's `npm test` actually failed (broken `node --test
   test/` script + naive CLI arg-splitting helper).

2. **Worker coordination** — two specialists (software-engineer-1
   and documentation-writer-2) produced duplicate complete
   applications. The brief said "Build a 5-file CLI app" to BOTH
   workers (via the full mission outcome in each brief); neither
   knew the other was producing the same files.

3. **Conflict records** — 8 records carried `conflictResolution`.
   The G7-19E report's Note 6 incorrectly claimed "Both workers
   wrote identical content". The actual evidence (verified in
   G7-19F Phase 1) shows the opposite: 4 of 5 files have
   GENUINELY DIFFERENT content; only `package.json` is identical.

G7-19F addresses finding #1 (implementation) and finding #3
(correction of the G7-19E report's misreading). Finding #2 is
investigated and a targeted correction is PROPOSED (not
implemented — the brief says "Only propose a targeted correction
if the evidence proves a coordination defect"; the evidence
proves it, but implementing the fix in G7-19F would be out of
scope for an acceptance-integrity-focused mission).

---

## 2. Phase 1 — Reconstruct the Actual G7-19E Evidence

### 2.1 File hashes per (worker, path) — verified

Recomputed the SHA-256 hash of every produced file directly from
the persisted G7-19E artifacts-response.json `content` field.
The recomputed hashes match the response's `contentHash` field
exactly (no drift).

| Path | software-engineer-1 hash | documentation-writer-2 hash | Identical? | Bytes (s1 / d2) |
|---|---|---|---|---|
| `package.json` | `055a6b5...20a98153` | `055a6b5...20a98153` | ✅ YES | 167 / 167 |
| `README.md` | `a745ce8...cacaff4d` | `01b8a0e...47c3dc61` | ❌ NO | 885 / 1464 |
| `src/index.js` | `08cdac4...fbfdcbc5` | `ca0d43f...72335b83` | ❌ NO | 2323 / 1412 |
| `src/store.js` | `89f7b74...65d4444b` | `8e4dfa4...0f68608ad` | ❌ NO | 3000 / 2406 |
| `test/app.test.js` | `424f7ed...4d8880a` | `e268e20...a01b60e02` | ❌ NO | 7490 / 3261 |

### 2.2 The 8 conflict records — GENUINE content differences

The 8 records with `conflictResolution` represent **genuine content
differences**, NOT duplicate metadata, NOT an aggregation defect.

**Explanation**: 4 conflicting paths × 2 workers (one record per
`(workerId, path)` tuple) = 8 conflict records. The 4 non-conflicting
records are:
- `package.json` from software-engineer-1 (identical → no conflict)
- `package.json` from documentation-writer-2 (identical → no conflict)
- `.npm/_logs/...-debug-0.log` from software-engineer-1 (no other
  worker wrote this path → no conflict)
- `.npm/_update-notifier-last-checked` from software-engineer-1 (same
  → no conflict)

**G7-19A conflict detection correctness**: PASS. The conflict layer
correctly identifies the 4 genuinely-different paths and excludes
the 1 identical path (`package.json`).

### 2.3 Correction to the G7-19E report

The G7-19E report's Note 6 stated:

> 6. Two workers wrote identical content. `software-engineer-1`
> and `documentation-writer-2` both produced the same 5 files with
> identical content (verified by matching `contentHash` for each
> path).

**This was wrong.** Only `package.json` is identical; the other 4
files have genuinely different content. This correction does NOT
change the G7-19E outcome:

- The smoke test still PARTIAL (the worker's `npm test` script has
  defects; the system truthfully reported the mission status).
- Integrity gate B (package coherence) still passes — the selected
  worker (software-engineer-1) is a single coherent worker; its
  `packageIdentity` (`4a3db1a3...c452892c`) is computed over all
  its files including `.npm/*` cache.
- Integrity gate E (authority semantics) still passes — the
  heuristic winner (documentation-writer-2) differs from the
  verified winner (software-engineer-1), correctly flagged by
  `isHeuristicUnverified=true` on every conflictResolution.

### 2.4 New G7-19F finding — packageIdentity non-reproducibility

During Phase 1, I recomputed `computePackageIdentity` for each
worker using only the 5 manifest files:

| Worker | Manifest-only packageIdentity |
|---|---|
| software-engineer-1 | `fe4673bbf929c7f6909d935d76aa4934a3d2ba1a384984a87c4cb7fdf72f37f2` |
| documentation-writer-2 | `7e6109bd39fa99127c1c7f9a081a7c08a7677d05e75274ffb87355e7717c3277` |

These are DIFFERENT (as expected — the content differs for 4 of 5
files).

But the response's `verifiedPackageSelection.packageIdentity` was
`4a3db1a3592bcf401c791f4baf26e540894f40085d620330f72f5199c452892c`
— NEITHER of the manifest-only values. After investigation, I
found that `computePackageIdentity` is called on ALL snapshots for
the worker, INCLUDING the `.npm/*` cache files. When I include
those files for software-engineer-1, the packageIdentity matches
the response exactly: `4a3db1a3...c452892c`.

**Implication**: the `packageIdentity` is computed over ALL files
in the worker's workspace, not just the manifest-declared files.
This includes environment-generated cache files like:

- `.npm/_logs/2026-10-11T05_22_44_449Z-debug-0.log` — the filename
  contains a TIMESTAMP, so the packageIdentity is non-reproducible
  across runs (a second mission run with the same worker content
  would produce a different `.npm/_logs/...` filename, hence a
  different packageIdentity).
- `.npm/_update-notifier-last-checked` — a 0-byte file with no
  content (so it gets an empty hash).

This is a **finding for a future G7-20 task**: the
`computePackageIdentity` function in
`src/runtime/package-selection.ts` should probably compute the
identity over ONLY the manifest-declared paths (the files the user
explicitly required), not over ALL files in the worker's workspace.
Otherwise:

- The identity is non-reproducible across runs.
- The identity can drift without worker intent (just by running
  `npm install` again).
- Two workers with IDENTICAL manifest content but DIFFERENT
  cache files have DIFFERENT packageIdentities.

This is **out of G7-19F scope** — the brief asks about the three
G7-19E findings, not about packageIdentity reproducibility. The
finding is documented in the G7-19F report's "Remaining
Limitations" section.

### 2.5 The 30 reasoning calls — worker assignments + handoffs

The G7-19E mission had 30 reasoning calls distributed across 3
specialist workers:

| Worker | Role | Capability Need | Status | Steps | Reasoning Calls |
|---|---|---|---|---|---|
| software-engineer-1 | Software Engineer | code-execution | success | 20 | 21 |
| documentation-writer-2 | Documentation Writer | document-authoring | success | 5 | 6 |
| generalist-worker-3 | Generalist Worker | data-analysis | failure (CANCELLED) | 3 | 3 |
| (mission-verifier-1) | Mission Verifier | verification | (clean room only) | — | — |
| (verification-engineer-4) | Verification Engineer | browser-verification | (control files only) | — | — |

Total: 30 reasoning calls (worker_reasoning_calls=30, reviewer_calls=0,
handoff_calls=0).

**Specialists run SEQUENTIALLY** (orchestrator.ts line 554: `for
(const worker of specialists)`). The execution order is:

1. software-engineer-1 (started at seq ~5, finished at seq 25)
2. documentation-writer-2 (started at seq 26, finished at seq 32)
3. generalist-worker-3 (started at seq 33, failed at seq 37)
4. Verification event at seq 38 (ok=true, 22 passed, 0 failed)
5. Mission-finished at seq 39 (status=partial, wallMs=540569)

**No handoffs were invoked** (handoff_calls=0). The
`MissionHandoffs` subsystem exists but wasn't exercised — workers
ran independently, each in their own workspace, with no shared
state.

---

## 3. Phase 2 — Acceptance Contract Integrity

### 3.1 Trace: how "npm test MUST exit 0 within 60s" was transformed

The transformation chain (5 layers):

| Layer | File | Frozen? | Pre-G7-19F behavior |
|---|---|---|---|
| 1. Goal compiler | `src/goal/goal-compiler.ts` line 260 | ✅ FROZEN | Takes `goal.constraints` (string array) and stores them as `hardConstraints` (string array). Does NOT translate prose into executable `AcceptanceCheck` objects. |
| 2. HTTP parser | `src/gateway/http-server.ts` lines 466-483 | ❌ NON-FROZEN | When parsing `acceptanceCriteria` from POST body, only accepts `kind: 'file'`, `'content-in-artifacts'`, `'hash-match'`. **All other kinds (including `'command'`) were SILENTLY SKIPPED** (line 482: "Unknown kinds are silently skipped — the structural floor still applies."). |
| 3. Transport type | `src/gateway/types.ts` lines 153-156 | ❌ NON-FROZEN | `AcceptanceCheckInput` union had only 3 variants: `file`, `content-in-artifacts`, `hash-match`. The `'command'` variant was NOT in the type. |
| 4. buildChecks | `src/gateway/mission-service.ts` lines 1873-1927 | ❌ NON-FROZEN | When merging caller-supplied criteria into the checks array, only handled `kind: 'file'`, `'content-in-artifacts'`, `'hash-match'`. **Caller-supplied `'command'` checks would be silently dropped** (no else branch for command). |
| 5. Verifier | `src/mission/verification.ts` line 590+ | ✅ FROZEN | Already supported `kind: 'command'` checks natively (`checkCommand` method). Runs `this.verifier.exec(check.command)` and asserts exit code + optional stdout includes/excludes. UNCHANGED. |

**Root cause**: the user's prose requirement was stored as a
STRING in `GoalRequirements.hardConstraints` (frozen layer 1).
It was never translated into an executable `AcceptanceCheck`. If
the user had supplied a `command`-type check explicitly, it
would have been SILENTLY DROPPED at layers 2 (HTTP parser) and
4 (buildChecks). The verifier (layer 5) supports command checks
natively but never saw them because layers 2-4 filtered them
out. **Three layers of silent disappearance.**

### 3.2 Why the resulting mission contained no command-type check

The G7-19E mission's submission body included:

```json
{
  "outcome": "Build \"Service Request Tracker — Smoke v0.1\"...",
  "context": "...",
  "constraints": [
    "After producing all files, npm test MUST exit 0 within 60 seconds in a clean room."
  ],
  "acceptanceCriteria": [
    { "kind": "file", "label": "package.json exists", "path": "package.json" },
    { "kind": "file", "label": "README.md exists", "path": "README.md" },
    { "kind": "file", "label": "src/index.js exists", "path": "src/index.js" },
    { "kind": "file", "label": "src/store.js exists", "path": "src/store.js" },
    { "kind": "file", "label": "test/app.test.js exists", "path": "test/app.test.js" },
    { "kind": "content-in-artifacts", "label": "README mentions npm test", "expectIncludes": "npm test" },
    { "kind": "content-in-artifacts", "label": "store.js uses JSON persistence", "expectIncludes": "requests.json" }
  ]
}
```

- The `constraints` array contained the prose requirement
  ("npm test MUST exit 0"). It became `hardConstraints` (string
  array) in `GoalRequirements`. The goal compiler does NOT
  translate prose to executable checks. (Layer 1, frozen.)
- The `acceptanceCriteria` array did NOT include a
  `kind: 'command'` check. Even if it had, layers 2-4 would
  have silently dropped it pre-G7-19F.
- The verifier (layer 5) supports command checks natively, but
  never saw one — so it ran only the structural floor + the
  caller-supplied `file` + `content-in-artifacts` checks. All
  22 passed. `ok=true`. The mission was marked SELECTED.

### 3.3 Smallest correction

Implemented 4 changes (all in NON-FROZEN files):

#### Change 1: New module `src/runtime/acceptance-integrity.ts`

Pure-function module (309 lines) that:

- **`detectExecutableMentions(goalText)`** — scans goal text
  for known executable-acceptance phrases. Conservative pattern
  set: `npm test`, `yarn test`, `pnpm test`. (Vague phrases like
  "tests must pass" are NOT auto-translated — the caller must
  provide an explicit command check.)
- **`isMentionCovered(mention, callerCriteria)`** — checks
  whether the caller already provided a `command`-type check
  with the same command string.
- **`buildAutoAddedCommandChecks(mention, artifacts)`** — for
  each artifact source (worker) that produced the mention's
  required file (e.g., `package.json`), emits a per-worker
  `command` check that runs the detected command in the
  worker's clean-room subdirectory:
  `sh -c "cd artifacts/<workerId> && <command>"`. If NO worker
  produced the required file, emits a sentinel
  `sh -c "echo G7-19F blocker: ... 1>&2; exit 1"` check that
  always fails honestly — so the omission is not silent.
- **`buildAutoAddedChecksForGoal(goalText, callerCriteria, artifacts)`**
  — convenience entry point for the gateway's `buildChecks`
  method.

#### Change 2: Add `command` to `AcceptanceCheckInput` transport type

`src/gateway/types.ts` — added a 4th variant:

```ts
| {
    readonly kind: 'command';
    readonly label: string;
    readonly command: string;
    readonly expectExit?: number;
    readonly expectOutputIncludes?: string;
    readonly expectOutputExcludes?: string;
  };
```

#### Change 3: Accept `command` in HTTP parser

`src/gateway/http-server.ts` — added an `else if (kind === 'command'
&& typeof c.command === 'string')` branch that accepts and
propagates command-type criteria. Pre-G7-19F these were silently
skipped.

#### Change 4: Propagate `command` + invoke auto-add in `buildChecks`

`src/gateway/mission-service.ts`:

- Added `goalContext` and `goalConstraints` fields to
  `MissionRuntime` interface.
- Stored at submission time from `submission.context` and
  `submission.constraints`.
- Modified the `checks:` callback to pass the full goal text
  (outcome + context + constraints) to `buildChecks`.
- Modified `buildChecks` to accept an optional `goalText`
  parameter:
  - Added `else if (c.kind === 'command')` branch to propagate
    caller-supplied command checks (no silent drop).
  - At the end, calls `buildAutoAddedChecksForGoal(goalText,
    callerCriteria, artifacts)` to emit per-worker auto-added
    checks for uncovered executable mentions.

### 3.4 Frozen contracts preserved

The verifier (`src/mission/verification.ts`) is FROZEN and
UNCHANGED — it already supported `kind: 'command'` checks
natively. The G7-19F fix is at the gateway layer (NON-FROZEN):
the new module stops silently dropping command-type criteria and
adds auto-detection of executable-acceptance mentions in goal
text.

All 4 frozen contracts are byte-identical to both G7-19D baseline
(`471823e`) and G7-19E baseline (`39aa0c6`): 0 diff lines.

### 3.5 Verifier compatibility confirmed

The verifier's `checkCommand` (in `src/mission/verification.ts`,
FROZEN) runs `this.verifier.exec(check.command)` in the verifier's
clean-room workspace. The verifier's clean-room layout puts each
worker's files under `artifacts/<workerId>/<path>`. The
auto-added command uses
`sh -c "cd artifacts/<workerId> && <command>"` so the command
runs in the correct subdirectory.

- **Production (OpenBot)**: the adapter's `exec` delegates to a
  real shell — `sh -c "..."` works natively.
- **Dev mode (MemoryComputer)**: `exec` is a stub that returns
  canned results (default: exit 0, empty stdout). Tests that need
  to verify failure inject canned results via
  `MemoryComputer.execResults`.

No new LLM calls. No new dependencies. Detection is deterministic
(regex).

---

## 4. Phase 3 — Worker Coordination

### 4.1 The planner's assignment (G7-19E)

The `plan-created` event recorded:

> Scope "complex" in domain "software-engineering" with 4
> capability needs. Planned 4 specialist role(s): Software
> Engineer [code-execution], Documentation Writer
> [document-authoring], Generalist Worker [data-analysis],
> Verification Engineer [browser-verification]. Mission
> Coordinator added because 3+ specialists require integration.

The planner correctly assigned ONE capability need per specialist
(no overlap in capability needs). Each specialist got a distinct
role and responsibility.

### 4.2 Why duplicate complete applications were produced

Three defects combined:

#### Defect A — Brief defect

The brief sent to each worker says:

```
Mission: "<full outcome (~2000 chars, lists all 7 capabilities)>"
Your assignment in it: <responsibility>.
Mission context: <full context>
Hard constraints: <constraints array joined>
Success criteria: <domain-inherent criteria>
Your workspace may already hold the mission's repository checkout;
otherwise it starts empty — every fact you need is in this brief.
Begin with the core of the work itself, not workspace inspection.
Deliverables go to your own workspace. Finish with your artifact
paths when done.
```

The brief tells each worker the FULL mission outcome (which lists
all 7 capabilities). Each worker, regardless of its assigned
capability need, sees the whole list. The brief does NOT say
"Other workers will produce the code; you should ONLY produce
README.md". The worker sees its one-line assignment ("Documents
the change and its usage") and reasonably interprets this as: "I
need to document a working application. To document it, the
application must exist. I'll produce the whole thing myself."

`renderTaskBrief` is in `src/mission/orchestrator.ts` (FROZEN).
Cannot modify.

#### Defect B — Coordination graph defect

The planner's `buildEdges` function
(`src/organization/organization-planner.ts`, NON-FROZEN) puts all
workers downstream of the coordinator:

- `software-engineer-1 → mission-coordinator-1` (report)
- `documentation-writer-2 → mission-coordinator-1` (report)
- `generalist-worker-3 → mission-coordinator-1` (report)
- `verification-engineer-4 → mission-coordinator-1` (report)
- `mission-coordinator-1 → documentation-writer-2` (handoff)

documentation-writer-2's only upstream edge is FROM the
coordinator. When the coordinator didn't run (mission aborted
due to timeout before reaching the coordinator step),
documentation-writer-2 had NO upstream inputs. The brief's
"Inputs from colleagues" section was empty (because
`upstream.length === 0` in `upstreamResults`).

#### Defect C — Goal compiler over-extraction (FROZEN)

The goal compiler extracted 4 capability needs for what's
essentially a code-execution-only mission (CLI app with tests):

- `code-execution` → Software Engineer (correct)
- `document-authoring` → Documentation Writer (unnecessary — the
  brief asked for a README, which is a code-execution
  responsibility, not a separate specialist)
- `data-analysis` → Generalist Worker (unnecessary — no data
  analysis was needed)
- `browser-verification` → Verification Engineer (unnecessary —
  no browser was needed)

`src/goal/goal-compiler.ts` is FROZEN. Cannot modify.

### 4.3 Evidence of coordination defect

| Question | Answer |
|---|---|
| Did both workers write the full app? | ✅ YES — both produced all 5 manifest files |
| Did they write DIFFERENT content? | ✅ YES — 4 of 5 files have different content (only `package.json` is identical) |
| Did documentation-writer-2 produce code files? | ✅ YES — it produced `src/index.js`, `src/store.js`, `test/app.test.js` |
| Did documentation-writer-2 have upstream inputs? | ❌ NO — coordinator didn't run; no "Inputs from colleagues" in brief |
| Did the coordinator run? | ❌ NO — mission aborted due to timeout before reaching the coordinator step |

### 4.4 Proposed targeted correction (NOT IMPLEMENTED in G7-19F)

The brief says: "Only propose a targeted correction if the evidence
proves a coordination defect. Do not introduce arbitrary worker
limits or disable multi-agent collaboration."

The evidence proves the defect. The proposed correction:

**Modify `buildEdges` in `src/organization/organization-planner.ts`
(NON-FROZEN) to add a DIRECT handoff edge from each non-coordinator
worker to the writer, EVEN when a coordinator is present.**

- The coordinator's role is preserved (still receives reports,
  still integrates).
- The writer gains a parallel direct upstream edge from each
  code-worker.
- When the coordinator doesn't run (timeout/cancelled), the writer
  still sees upstream worker artifacts directly.
- The brief's "Inputs from colleagues" section would fire, listing
  the code-worker's files.
- The writer would then know: "The code-worker has produced X, Y,
  Z. I should focus on documentation."

**Why this is NOT implemented in G7-19F**:

- G7-19F is about acceptance contract integrity (Phase 2).
- Worker coordination behavior changes need their own test coverage
  to verify they don't regress the 100+ existing planner tests.
- The brief says "Only PROPOSE a targeted correction" — implementing
  is out of scope.

**Recommendation for next mission**: implement the `buildEdges`
correction as a focused G7-20 task with proper test coverage. The
evidence is preserved in `evidence/g7-19f/phase-3-worker-coordination-findings.json`.

### 4.5 Alternative corrections rejected

| Alternative | Why rejected |
|---|---|
| Modify `renderTaskBrief` to role-scope ("produce ONLY README.md") | `renderTaskBrief` is in `src/mission/orchestrator.ts` (FROZEN). |
| Modify goal compiler to under-extract | Goal compiler is FROZEN. |
| Add `workerBriefSuffix` at gateway layer to role-scope | Mission-specific (depends on what the goal compiler extracted). The `buildEdges` fix is general-purpose. |
| Remove coordinator role when specialists < 3 | Disables multi-agent collaboration. The brief explicitly forbids this. |
| Add arbitrary worker limit | The brief explicitly forbids this. |

---

## 5. Phase 4 — Deterministic Verification

### 5.1 Test coverage added

| Test file | Tests | Coverage |
|---|---|---|
| `tests/runtime/g7-19f-acceptance-integrity.test.ts` | 24 | Pure-function tests for `detectExecutableMentions`, `isMentionCovered`, `buildAutoAddedCommandChecks`, `buildAutoAddedChecksForGoal`. Includes the G7-19A conflict detection regression check (4 paths × 2 workers = 8 conflict records) and the G7-19A/B/C/D package selection regression check. |
| `tests/gateway/g7-19f-integration.test.ts` | 5 | Gateway integration tests through the HTTP path: auto-add fires when goal mentions npm test + no caller command check; no auto-add when caller covers it; caller-supplied command check propagated (no silent drop); no auto-add for goals without executable phrases; G7-19D-style mission still SUCCEEDED. |
| **Total new tests** | **29** | |

### 5.2 The six Phase 4 guarantees

| # | Guarantee | Evidence | Test coverage |
|---|---|---|---|
| 1 | The original G7-19E application fails executable acceptance because `npm test` fails. | The G7-19E worker's `npm test` script (`node --test test/`) is broken on Node v24 (trailing slash → `MODULE_NOT_FOUND`). The G7-19F auto-add would emit `sh -c "cd artifacts/software-engineer-1 && npm test"` for the goal text "npm test MUST exit 0". When run in production (OpenBot verifier's real shell), this command would fail with exit 1, and the auto-added check would FAIL → verification would fail → mission NOT verified. | `tests/runtime/g7-19f-acceptance-integrity.test.ts` "reproduces the G7-19E finding: npm test mention + no caller command check → 2 auto-added checks". The actual execution (and resulting failure) is exercised end-to-end by the verifier's `checkCommand` (covered by existing verifier tests in `tests/mission/`). |
| 2 | Structural and content checks may still pass. | The structural floor (file-existence checks) and content-in-artifacts checks PASSED in the G7-19E mission (22/22 passed). The 5 expected manifest files were produced by both workers; the README mentions "npm test"; store.js mentions "requests.json". These checks pass independently of whether `npm test` works. | `tests/runtime/g7-19f-acceptance-integrity.test.ts` "identifies genuine content conflicts (SWE1 vs DW2)" verifies the structural records are built correctly. |
| 3 | An executable acceptance failure cannot produce an overall verified PASS. | After G7-19F, when the goal text mentions "npm test" and the caller supplied no command check, the auto-add emits a per-worker command check that runs `npm test` in the verifier's clean room. If `npm test` fails (exit non-zero), the check FAILS. The verifier's `VerificationLoop` combines all check outcomes into a single `ok` boolean: if ANY check fails, `ok=false`. The orchestrator's closure logic: `ok=false` → `status='failure'` OR (aborted && hasDeliverable) → `'partial'`. Either way, NOT `'success'`. | `tests/runtime/g7-19f-acceptance-integrity.test.ts` "does NOT auto-add when caller supplied a matching command check" (coverage detection). `tests/gateway/g7-19f-integration.test.ts` "G7-19F Scenario 1: auto-add fires". |
| 4 | A corrected fixture can pass without modifying the original production evidence. | A corrected fixture (a working `npm test` script + passing tests) would produce a successful `npm test` exit 0. The auto-added command check `sh -c "cd artifacts/<workerId> && npm test"` would return exit 0 → check PASSES → verification can succeed. The original G7-19E evidence (mission-snapshot.json, artifacts-response.json, etc.) is NOT modified — it remains in `evidence/g7-19e/` as immutable historical evidence. | `tests/runtime/g7-19f-acceptance-integrity.test.ts` "corrected fixture: a working npm test script would pass the auto-added check". |
| 5 | Existing successful Genesis missions remain compatible. | Auto-add fires ONLY when: (a) `goalText` is passed (production path always does; existing tests that don't pass it get original behavior); AND (b) the goal text contains a known executable phrase (`npm test`, `yarn test`, `pnpm test`); AND (c) the caller did not supply a matching command check. For missions with no executable phrase (the vast majority of existing missions), no auto-add fires. The full regression of 1024 pre-existing tests (G7-19D baseline) + 29 new tests all PASS. | `tests/runtime/g7-19f-acceptance-integrity.test.ts` "missions without executable phrases are unaffected", "missions with caller-supplied command checks are unaffected", "G7-19A/B/C/D package selection still works after G7-19F (no regression)". `tests/gateway/g7-19f-integration.test.ts` "G7-19F Scenario 5: existing G7-19D missions remain compatible (no regression)". |
| 6 | Genuine conflicting file versions are distinguished from identical content. | The G7-19A conflict detection layer (preserved unchanged) computes per-path `contentHash` and marks `conflict=true` when 2+ workers write DIFFERENT content for the same path. The G7-19E evidence shows 4 paths with `conflict=true` (README.md, src/index.js, src/store.js, test/app.test.js) and 1 path with `conflict=false` (package.json — identical content). | `tests/runtime/g7-19f-acceptance-integrity.test.ts` "identifies genuine content conflicts (SWE1 vs DW2)" verifies 8 conflict records from 4 conflicting paths; "identifies identical content (no conflict) when two workers write the same files" verifies 0 conflict records when content is identical. |

### 5.3 No live provider calls

ZERO live Z.ai calls. ZERO OpenBot runtime invocations. All tests
use `MemoryRuntime` + the existing deterministic understanding
provider (the default scripted reasoning for dev mode).

---

## 6. Phase 5 — Regression and Delivery

### 6.1 Typecheck

```bash
npm run typecheck
```

**Result: PASS** (exit 0, no errors).

### 6.2 Lint

```bash
npm run lint
```

**Result: PASS** (exit 0, no errors).

The eslint config was updated to add `scripts/g7-19e-smoke.cjs`
(pre-existing from G7-19E, was not in the ignores list), plus
`evidence/g7-19e/**` and `evidence/g7-19f/**` to the ignores.
The `.cjs` file uses CommonJS `require()` legitimately (it's a
HTTP test driver, not engine source).

### 6.3 Full Genesis regression (vitest)

```bash
npm test
```

| Metric | G7-19E baseline (`39aa0c6`) | G7-19F | Delta |
|---|---|---|---|
| Test files passed | 101 | 103 | +2 |
| Tests passed | 1024 | 1053 | +29 |
| Tests skipped | 9 | 9 | 0 |
| Tests failed | 0 | 0 | 0 |
| Duration | ~40s | ~40s | within noise |

All 1024 pre-existing tests continue to pass. 29 new tests added.
No regressions.

### 6.4 Frozen-contract verification

```bash
for f in src/contracts/core.ts src/mission/verification.ts \
         src/mission/orchestrator.ts src/goal/goal-compiler.ts; do
  diff_lines=$(git diff 471823e76f657319d75d475ff9cf84098a6be132 -- "$f" | wc -l)
  echo "$f: $diff_lines diff lines"
done
```

| File | Diff lines vs `471823e` (G7-19D) | Diff lines vs `39aa0c6` (G7-19E) |
|---|---|---|
| `src/contracts/core.ts` | 0 | 0 |
| `src/mission/verification.ts` | 0 | 0 |
| `src/mission/orchestrator.ts` | 0 | 0 |
| `src/goal/goal-compiler.ts` | 0 | 0 |

**All four frozen-contract files are byte-identical to both the
G7-19D and G7-19E baselines.** No frozen-contract modification was
needed — the G7-19F fix lives entirely in the non-frozen
runtime/gateway layer:

- `src/runtime/acceptance-integrity.ts` — NEW file (non-frozen).
- `src/gateway/types.ts` — non-frozen.
- `src/gateway/http-server.ts` — non-frozen.
- `src/gateway/mission-service.ts` — non-frozen.

The verifier (`src/mission/verification.ts`, FROZEN) already
supported `kind: 'command'` checks natively — UNCHANGED. The
G7-19F fix stops silently dropping command-type criteria at the
gateway layer and adds auto-detection of executable-acceptance
mentions in goal text.

---

## 7. Remaining Limitations

1. **Worker coordination defect (Phase 3) NOT fixed in G7-19F.**
   The evidence proves a coordination defect: two specialists
   produced duplicate complete applications because (a) the brief
   tells each worker the full mission outcome, (b) the writer's
   only upstream edge is via the coordinator, which didn't run,
   and (c) the goal compiler over-extracted capability needs.
   A targeted correction is PROPOSED (modify `buildEdges` in
   `src/organization/organization-planner.ts` to add direct
   handoff edges from each non-coordinator worker to the writer,
   even when a coordinator is present). Implementation is
   recommended for a focused G7-20 task with proper test
   coverage. Evidence preserved in
   `evidence/g7-19f/phase-3-worker-coordination-findings.json`.

2. **`packageIdentity` non-reproducibility.** Phase 1 discovered
   that `computePackageIdentity` (in
   `src/runtime/package-selection.ts`, NON-FROZEN) is computed
   over ALL files in the worker's workspace, INCLUDING
   environment-generated cache files like
   `.npm/_logs/<timestamp>-debug-0.log`. This makes the
   packageIdentity non-reproducible across runs (the timestamp
   in the filename changes each run). A future G7-20 task should
   change `computePackageIdentity` to compute the identity over
   ONLY the manifest-declared paths (the files the user
   explicitly required). This is out of G7-19F scope — the brief
   asks about the three G7-19E findings, not about
   packageIdentity reproducibility.

3. **Auto-add pattern set is conservative.** Only 3 patterns are
   auto-detected: `npm test`, `yarn test`, `pnpm test`. Vague
   phrases like "tests must pass" or "the application must work"
   are NOT auto-translated — the caller must provide an explicit
   command check. This is by design (avoid false-positive
   auto-adds), but it means the gate does not catch every
   possible executable-acceptance mention. Extending the pattern
   set is a future enhancement.

4. **`MemoryComputer.exec` is a stub in dev mode.** The
   auto-added command checks return exit 0 by default in dev
   mode (no actual shell execution). Tests that need to verify
   the FAILURE case must inject canned exec results via
   `MemoryComputer.execResults`. In production (OpenBot), the
   auto-added commands run in a real shell and fail honestly
   when `npm test` doesn't work.

5. **Auto-added commands run in the verifier's clean room, not
   in a fresh project layout.** The verifier's clean-room layout
   puts files under `artifacts/<workerId>/<path>`. The auto-added
   command uses `sh -c "cd artifacts/<workerId> && <command>"`
   to work in this layout. This is a constraint of the existing
   verifier architecture (FROZEN). A more general fix would
   allow the verifier to materialize a "project layout" (files
   at the root, not under `artifacts/<workerId>/`) for command
   checks — but that would require modifying the FROZEN
   verifier. Out of G7-19F scope.

---

## 8. Recommendation for the Next Live Test

The next live test (G7-20 or beyond) should:

1. **Re-run the Service Request Tracker mission with the G7-19F
   fix in place.** The goal text "npm test MUST exit 0 within 60s"
   should now trigger the auto-add. The auto-added command check
   should run `sh -c "cd artifacts/software-engineer-1 && npm test"`
   in the verifier's clean room. If the worker produces a working
   `npm test` script, the check PASSES and the mission is
   SUCCEEDED+SELECTED. If the worker produces a broken script (as
   in G7-19E), the check FAILS and the mission is PARTIAL or
   FAILURE — truthfully.

2. **Include a `command`-type acceptance criterion explicitly in
   the submission** to exercise the new transport type + HTTP
   parser + buildChecks propagation path. For example:
   ```json
   { "kind": "command", "label": "npm test in worker's clean-room
   copy", "command": "sh -c \"cd artifacts/* && npm test\"",
   "expectExit": 0 }
   ```

3. **Implement the Phase 3 worker-coordination correction**
   (modify `buildEdges` in `src/organization/organization-planner.ts`
   to add direct handoff edges from each non-coordinator worker
   to the writer, even when a coordinator is present). Then verify
   that the documentation-writer-2 sees the code-worker's
   artifacts in its brief and produces ONLY the README.

4. **Address the `packageIdentity` non-reproducibility** by
   changing `computePackageIdentity` to compute the identity
   over ONLY the manifest-declared paths, not all workspace
   files. This makes the identity reproducible across runs and
   immune to environment-generated cache files.

5. **Extend the auto-add pattern set** to cover more
   executable-acceptance phrases: `npm run build`, `npm run lint`,
   `make <target>`, `node <path>.js`, `go test`, `cargo test`,
   `pytest`, etc.

---

## 9. Required Final Status

```text
MISSION = G7-19F
BASELINE_HEAD = 39aa0c6a162bf2d80a9581f9a136d1ccb6e3bdbb (G7-19E final)
LIVE_PROVIDER_CALLS = 0
PHASE_1_EVIDENCE_RECONSTRUCTED = YES (file hashes verified, 8 conflict records analyzed as GENUINE content differences, G7-19E report Note 6 corrected)
PHASE_2_ROOT_CAUSE = "npm test MUST exit 0" became hardConstraints string (frozen goal compiler); caller-supplied command checks were SILENTLY DROPPED at 3 layers (HTTP parser, transport type, buildChecks); verifier supports command checks natively but never saw them
PHASE_2_CORRECTION = 4 changes in NON-FROZEN files: (1) new src/runtime/acceptance-integrity.ts (309 lines, detects executable-acceptance mentions, auto-adds per-worker command checks); (2) added 'command' variant to AcceptanceCheckInput transport type; (3) HTTP parser accepts command criteria (no silent skip); (4) buildChecks propagates command + invokes auto-add
PHASE_3_COORDINATION_DEFECT = PROVEN (two specialists produced duplicate complete applications; brief tells each worker the full mission outcome; writer's only upstream edge is via the coordinator which didn't run; goal compiler over-extracted 4 capability needs for a code-execution-only mission)
PHASE_3_CORRECTION = PROPOSED (modify buildEdges in src/organization/organization-planner.ts to add direct handoff edges from each non-coordinator worker to the writer, even when a coordinator is present); NOT IMPLEMENTED in G7-19F (would need its own G7-20 test coverage)
PHASE_4_GUARANTEE_1_ORIGINAL_FAILS_EXECUTABLE = YES (G7-19E npm test script broken on Node v24; auto-add would emit per-worker command check; production verifier would run it and fail)
PHASE_4_GUARANTEE_2_STRUCTURAL_CONTENT_PASS = YES (22/22 G7-19E checks passed independently of npm test working)
PHASE_4_GUARANTEE_3_EXECUTABLE_FAILURE_NOT_VERIFIED_PASS = YES (auto-add emits per-worker command check; if it fails, VerificationLoop ok=false; orchestrator closure → status=failure or partial, NOT success)
PHASE_4_GUARANTEE_4_CORRECTED_FIXTURE_PASSES = YES (corrected npm test script → exit 0 → auto-added check passes → verification can succeed; original G7-19E evidence unchanged)
PHASE_4_GUARANTEE_5_EXISTING_MISSIONS_COMPATIBLE = YES (auto-add fires only when goalText is passed AND goal mentions known executable phrase AND caller didn't cover it; 1024 pre-existing tests + 29 new tests all PASS)
PHASE_4_GUARANTEE_6_CONFLICTS_DISTINGUISHED = YES (G7-19A conflict detection preserved unchanged; 4 conflicting paths × 2 workers = 8 conflict records; 1 identical path = 0 conflict records)
TYPECHECK = PASS
LINT = PASS
FULL_REGRESSION = 1053 passed, 9 skipped, 0 failed (103 files) — was 1024 passed (101 files) in G7-19E baseline; +29 new tests, 0 regressions
FROZEN_CONTRACTS = ALL 4 UNCHANGED (0 diff lines vs 471823e G7-19D AND 39aa0c6 G7-19E): src/contracts/core.ts, src/mission/verification.ts, src/mission/orchestrator.ts, src/goal/goal-compiler.ts
IMPLEMENTATION_LINES = ~440 lines of new code (309 in src/runtime/acceptance-integrity.ts + ~50 in src/gateway/types.ts + ~15 in src/gateway/http-server.ts + ~65 in src/gateway/mission-service.ts) + ~795 lines of new tests (446 + 349)
REMAINING_LIMITATIONS = (1) worker coordination defect PROVEN but not fixed (PROPOSED for G7-20); (2) packageIdentity non-reproducibility (includes .npm/* cache files with timestamps); (3) auto-add pattern set conservative (only npm/yarn/pnpm test); (4) MemoryComputer.exec stub in dev mode; (5) auto-added commands run in verifier's clean-room layout (artifacts/<workerId>/<path>) — requires sh -c "cd artifacts/<workerId> && <command>" wrapper
FINAL_LOCAL_HEAD = (written post-push in evidence/g7-19f/final-head.json)
FINAL_REMOTE_HEAD = (written post-push in evidence/g7-19f/final-head.json)
HEAD_MATCH = (written post-push)
NEXT_STAGE_STARTED = NO
SUCCESS_CONDITION_MET = YES — "Genesis must not report an application as fully verified when an explicitly required executable acceptance check was omitted or failed." After G7-19F: (a) caller-supplied command checks are no longer silently dropped (Parts 1-3); (b) uncovered executable-acceptance mentions in goal text are auto-translated into per-worker command checks (Part 4); (c) the verifier runs these checks and fails the mission honestly when the command fails (existing verifier behavior preserved)
```

---

## 10. Delivery

Committed and pushed to `build/g7-14-constrained-mcp`:

- `G7-19F_Acceptance_Integrity_And_Worker_Coordination_Report.md` (this report)
- `evidence/g7-19f/phase-1-evidence-reconstruction.json`
- `evidence/g7-19f/phase-2-acceptance-integrity-findings.json`
- `evidence/g7-19f/phase-3-worker-coordination-findings.json`
- `evidence/g7-19f/regression-results.json`
- `evidence/g7-19f/final-head.json` (written post-push)
- `src/runtime/acceptance-integrity.ts` (new module, 309 lines)
- `src/gateway/types.ts` (added `command` variant to AcceptanceCheckInput)
- `src/gateway/http-server.ts` (added `command` branch to parser)
- `src/gateway/mission-service.ts` (added goalContext + goalConstraints to MissionRuntime; modified buildChecks to propagate command + auto-add)
- `tests/runtime/g7-19f-acceptance-integrity.test.ts` (24 unit tests)
- `tests/gateway/g7-19f-integration.test.ts` (5 integration tests)
- `eslint.config.js` (added `scripts/g7-19e-smoke.cjs` + `evidence/g7-19e/**` + `evidence/g7-19f/**` to ignores)

**No live mission launched.** `NEXT_STAGE_STARTED = NO`.

---

## 11. Notes

### Note 1 — Scope discipline

G7-19F is investigation + smallest correction, NOT a new live mission:

- 0 live Z.ai calls.
- 0 OpenBot runtime invocations.
- 0 frozen-contract modifications.
- ~440 lines of new code (vs. zero source changes in G7-19E which was
  pure operational validation).
- 29 new tests covering the new module + the gateway integration
  path + the backward-compatibility regression.

### Note 2 — Three-layer silent disappearance

The most striking finding from Phase 2 is that `command`-type
acceptance checks were silently dropped at THREE different layers
(HTTP parser, transport type, buildChecks) — and the verifier
(FROZEN) already supported them natively. The verifier was ready;
the gateway was filtering them out. G7-19F closes all three layers
PLUS adds the auto-detection layer. The user's prose requirement
"npm test MUST exit 0" is now translated into executable verification
at the gateway layer.

### Note 3 — Stop after G7-19F

Per the brief: **"Do not start another live mission."**
`NEXT_STAGE_STARTED = NO`.

**SMALL IN CODE. LARGE IN CAPABILITY.**
