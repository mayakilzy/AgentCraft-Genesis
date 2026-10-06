# TASK-023 — DIRTYFILES REMEDIATION & CONFIRMATION

> Engineering remediation of the `GitWorkspace.dirtyFiles()` telemetry
> defect identified in the TASK-023 final authority review. This is NOT
> a benchmark rerun, NOT a fourth arm, and NOT a TASK-023 corrigendum.
> Historical A/B/C arm evidence was NOT modified. The previous authority
> evaluation remains part of the audit trail.

```
START SHA   = 99e88485b56e38d4c75239a0a50d9f02fbd57709
FINAL SHA   = (filled at commit time)
REMOTE SHA  = (filled after push)
BRANCH      = build/group-03-repository-work
```

---

## 1. Original Bug

**File:** `src/work/git-workspace.ts`
**Method:** `dirtyFiles(name: string)` — lines 238–251
**Faulty line:**

```typescript
.map((line) => line.trim().slice(3).trim())
```

`git status --porcelain` emits lines in the format `XY<space><path>` — exactly 2 status characters + 1 space + the path. For a file that is **modified in the worktree but NOT staged** (X = space, Y = `M`), the line begins with a leading space: `" M README.md"`.

The chain of corruption:
1. `line` = `" M README.md"` (leading space is the X field)
2. `line.trim()` = `"M README.md"` — **the leading space is stripped, shifting everything left by 1**
3. `.slice(3)` = `"EADME.md"` — removes `"M R"` (status + separator + **first char of the path**)
4. `.trim()` = `"EADME.md"` — no-op

**Manifestation:** For modified-not-staged files, the first character of the path is eaten in the flight-record `worktree-committed` event's `changedFiles` field. This is exactly the signature observed in Arms B and C:

```
README.md   → EADME.md
docs/api.md → ocs/api.md
```

**Latent skip risk:** For a single-character filename (e.g. `a`), the bug reduces it to an empty string, which is then filtered out by `.filter((line) => line.length > 0)`. The file silently disappears from `dirtyFiles()` output. If this caused `dirtyFiles()` to return `[]` for a worker whose only change was a single-char file, the `if (dirty.length === 0) continue` check in `repo-mission.ts` would SKIP the worker's commit entirely — silent data loss. No such file exists in the TASK-023 benchmark, but the risk is real for repositories with single-character filenames.

---

## 2. Pre-Fix Failing Regression Evidence

**Test added:** `tests/work/git-workspace.test.ts` — "dirtyFiles returns correct paths for modified-not-staged files (TASK-023 regression)"

**Pre-fix run (must FAIL):**

```
FAIL  tests/work/git-workspace.test.ts > ... > dirtyFiles returns correct paths for modified-not-staged files (TASK-023 regression)
AssertionError: expected [ 'EADME.md', 'ocs/api.md', …(1) ] to include 'README.md'
```

**Authoritative pre-fix `dirtyFiles()` output** (captured via isolated debug script with the same fixture setup as the test):

```json
[
  "EADME.md",
  "ocs/api.md",
  "newfile.txt"
]
```

Observations:
- `README.md` → `EADME.md` (first char eaten) ✓ bug reproduced
- `docs/api.md` → `ocs/api.md` (first char eaten) ✓ bug reproduced
- `a` (single-char file) → **silently dropped** (reduced to `""`, filtered out) ✓ latent skip confirmed
- `newfile.txt` (untracked) → correct (untracked files have no leading space: `?? path`)

The defect is reproduced exactly as predicted. The regression test correctly fails on `expect(dirty).toContain('README.md')`.

---

## 3. Root Cause Confirmed

**Root cause:** The `dirtyFiles()` parser strips the leading whitespace from each `git status --porcelain` line BEFORE slicing off the 3-byte `XY<space>` prefix. For modified-not-staged files (X = space), this strips the X field's leading space, shifting `.slice(3)` one byte into the path itself.

**Why the leading `.trim()` is wrong:** `git status --porcelain` always emits exactly `XY<space><path>` — 3 bytes of prefix before the path. The leading space in the X field is STRUCTURAL (it means "not staged in the index"), not whitespace to be trimmed. Preserving it ensures `.slice(3)` lands exactly after the separator.

**Why this was not caught earlier:** The bug only manifests for files that are modified-but-not-staged. Workers with `openbot:shell-execution` grant typically `git add -A && git commit` their own work, so files are staged (`M  path` — no leading space) and the bug doesn't trigger. The bug only triggers for workers with `openbot:workspace-files` but NOT `openbot:shell-execution` — exactly the Documentation Writer role in Arms B and C.

---

## 4. Exact Patch

**One-line change in `src/work/git-workspace.ts`, line 249:**

```diff
-      .map((line) => line.trim().slice(3).trim())
+      .map((line) => line.slice(3).trim())
```

**Rationale:** Remove the first `.trim()`. The leading space is structural (the X field of `git status --porcelain`); preserving it ensures `.slice(3)` removes exactly the `XY<space>` prefix. The trailing `.trim()` handles trailing whitespace/CR.

**Production files changed:** 1 (`src/work/git-workspace.ts`)
**Test files changed:** 1 (`tests/work/git-workspace.test.ts` — added one regression test)

---

## 5. Post-Fix Regression Evidence

**Post-fix run (must PASS):**

```
✓ tests/work/git-workspace.test.ts (13 tests | 12 skipped) 77ms
Test Files  1 passed (1)
     Tests  1 passed | 12 skipped (13)
```

**Authoritative post-fix `dirtyFiles()` output:**

```json
[
  "README.md",
  "a",
  "docs/api.md",
  "newfile.txt"
]
```

All paths preserved exactly. The single-char file `a` is no longer dropped. The untracked control `newfile.txt` remains correct.

---

## 6. Full Quality Gates

Run on the tree after the patch:

```
FULL TEST SUITE = 162/162 PASS  (24 test files, vitest)
                  (was 161/161; +1 from the new regression test)
TYPECHECK       = PASS           (tsc --noEmit, strict)
LINT            = PASS           (eslint)
```

No tests weakened, no gates changed.

---

## 7. Micro Confirmation Experiment

**Purpose:** Determine whether the `dirtyFiles()` defect affected only telemetry or could affect actual committed/integrated files.

**Setup:** The smallest real Genesis path that exercises:

```
worker (write_file only, NO run_command)
  → workspace file write (modifies tracked files without staging)
  → dirtyFiles detection (in beforeVerification)
  → commitWorktree (git add -A + commit)
  → integration (git merge into genesis/integration)
```

**Worker capability profile (Documentation-Writer-style):**

```
workspace-files = ALLOWED
shell-execution  = NOT ALLOWED
```

The worker modifies existing tracked files `README.md` and `docs/api.md` with unmistakable confirmation content via `write_file` only. It does NOT run `git add` or `git commit` itself — exactly the condition that triggered the bug in Arms B and C.

**Method:** A stub reasoning provider returns pre-scripted `write_file` actions (deterministic, no LLM). The REAL `WorkerAgent` loop, `GitWorkspace`, `commitWorktree()`, and `IntegrationManager` code paths are exercised unchanged.

### 7.1 Pre-fix run (buggy `dirtyFiles()`)

```
dirtyFiles telemetry:              ["EADME.md", "ocs/api.md"]
worktree-committed event changedFiles: ["EADME.md", "ocs/api.md"]
actual commit files (git diff):    ["README.md", "docs/api.md"]
integration branch tree:           ["README.md", "docs/api.md", "src/lib.mjs"]

README.md preserved in integration: true
docs/api.md preserved in integration: true
EADME.md exists in integration:     false
ocs/api.md exists in integration:   false
README.md content correct:          true
docs/api.md content correct:        true
```

### 7.2 Post-fix run (corrected `dirtyFiles()`)

```
dirtyFiles telemetry:              ["README.md", "docs/api.md"]
worktree-committed event changedFiles: ["README.md", "docs/api.md"]
actual commit files (git diff):    ["README.md", "docs/api.md"]
integration branch tree:           ["README.md", "docs/api.md", "src/lib.mjs"]

README.md preserved in integration: true
docs/api.md preserved in integration: true
EADME.md exists in integration:     false
ocs/api.md exists in integration:   false
README.md content correct:          true
docs/api.md content correct:        true
```

### 7.3 Comparison

| Dimension | Pre-fix | Post-fix |
|-----------|---------|----------|
| `dirtyFiles()` telemetry | `["EADME.md", "ocs/api.md"]` (CORRUPTED) | `["README.md", "docs/api.md"]` (CORRECT) |
| `worktree-committed` event `changedFiles` | `["EADME.md", "ocs/api.md"]` (CORRUPTED) | `["README.md", "docs/api.md"]` (CORRECT) |
| Actual committed files (`git diff`) | `["README.md", "docs/api.md"]` (CORRECT) | `["README.md", "docs/api.md"]` (CORRECT) |
| Integration branch tree | `["README.md", "docs/api.md", "src/lib.mjs"]` (CORRECT) | `["README.md", "docs/api.md", "src/lib.mjs"]` (CORRECT) |
| `EADME.md` exists in integration | false | false |
| `ocs/api.md` exists in integration | false | false |
| `README.md` content correct | true | true |
| `docs/api.md` content correct | true | true |

**Key finding:** The actual committed and integrated files were CORRECT in BOTH the pre-fix and post-fix runs. The `dirtyFiles()` bug corrupted ONLY the telemetry (the `changedFiles` field in `worktree-committed` flight-record events). The actual repository state — committed files, integration branch tree, file contents — was never affected.

---

## 8. Defect Classification

```
DEFECT CLASSIFICATION = TELEMETRY-ONLY
```

The `dirtyFiles()` defect corrupted the flight-record `worktree-committed` event's `changedFiles` field for modified-not-staged files. It did NOT corrupt:

- actual committed files (uses `git add -A` + `git diff --cached --name-only` — real names)
- actual branch contents
- actual integration results
- actual verification outcomes
- actual file contents

The micro confirmation experiment proves this definitively: with the buggy `dirtyFiles()`, the telemetry showed `["EADME.md", "ocs/api.md"]` while the actual committed and integrated files were `["README.md", "docs/api.md"]`.

---

## 9. Blast Radius

**Affected (telemetry only):**

- The `changedFiles` field in `worktree-committed` flight-record events, for files modified-but-not-staged.
- Any consumer of that field (e.g., experiment reports in `experiments/experiment-002/run.ts` and `experiments/experiment-003/run.ts` that display `event.changedFiles` in human-readable summaries).

**NOT affected:**

- `commitWorktree()` — uses `git add -A` (real names), not `dirtyFiles()`.
- `changedFiles()` — a different method that uses `git diff --name-only` (no status prefix, no bug).
- `mergeIntoIntegration()` — uses `git merge` on real branch state.
- The actual files on any branch.
- The actual integration result.
- The actual verification outcome.

**Who triggers the bug:** Any worker whose genome grants `openbot:workspace-files` but NOT `openbot:shell-execution` — i.e., workers who use `write_file` (which modifies files without staging) and cannot `git add` themselves. In TASK-023, this is the Documentation Writer role in Arms B and C.

**Who does NOT trigger the bug:**

- Workers with `run_command` (they `git add -A && git commit` themselves → files are staged → `dirtyFiles` returns `[]` → bug never triggers).
- Arm A's sole operator (has both grants, commits his own work).

---

## 10. Implication for the Previous Authority Reconstruction

**The previous TASK-023 authority reconstruction used corrupted telemetry as if it were authoritative file-state evidence.**

The authority evaluation (`TASK-023-FINAL-AUTHORITY-EVALUATION.md`) reconstructed Arms B and C final targets from the flight-record `worktree-committed` events' `changedFiles` field. Because that field was corrupted by the `dirtyFiles()` bug, the reconstruction created literal `EADME.md` and `ocs/api.md` files in the reconstructed arm targets. This caused the reconstructed Arms B and C to fail G6 (documentation) and G9 (illegal additions) — failures that were **reconstruction artifacts**, not actual benchmark results.

**The micro confirmation experiment proves the actual Arms B and C** (if their mission worktrees had survived) **would have had correctly-named `README.md` and `docs/api.md` on their integration branches**, because `commitWorktree()` uses `git add -A` (real names), not `dirtyFiles()` (corrupted names).

**However:** This experiment does NOT prove that Arms B and C actually PASSED G6 and G9. The actual mission worktrees were host-only state lost to the environment reset. The Documentation Writers' workspace files were committed correctly (as the experiment proves), but whether the committed CONTENT was correct (i.e., whether the docs actually reflected the repaired code) cannot be verified from the persisted evidence. The G6/G9 verdict for Arms B and C must remain **INCONCLUSIVE — historical uncertainty**, not "PASS" and not "FAIL".

**Historical uncertainty must remain historical uncertainty.** A future TASK-023 corrigendum (separate from this remediation) should:

1. Acknowledge that the authority reconstruction's G6/G9 FAIL verdicts for Arms B and C were based on corrupted telemetry.
2. Reclassify those specific verdicts as INCONCLUSIVE (not PASS, not FAIL).
3. Note that the primary verdict "GENESIS LOSES" was confounded by this reconstruction error.
4. Preserve the original authority evaluation unmodified as part of the audit trail.

---

## 11. Historical Arm Evidence Not Modified

```
HISTORICAL ARM EVIDENCE MODIFIED = NO
BENCHMARK ARMS RERUN             = NO
TASK-024 STARTED                 = NO
```

- Arm A evidence (`data/flight-records/mission-20261006T044842-d29f38.jsonl`) — unmodified.
- Arm B evidence (`data/flight-records/mission-20261006T170652-0a8f97.jsonl`) — unmodified.
- Arm C evidence (`data/flight-records/mission-20261006T174940-045120.jsonl`) — unmodified.
- Authority evaluation (`TASK-023-FINAL-AUTHORITY-EVALUATION.md`) — unmodified (will be addressed by a separate corrigendum if warranted).
- Frozen evaluator, sealed gold, common execution base — unmodified.

The only files changed by this remediation are:

1. `src/work/git-workspace.ts` — one-line fix to `dirtyFiles()`.
2. `tests/work/git-workspace.test.ts` — one regression test added.
3. `experiments/benchmark-023/TASK-023-DIRTYFILES-REMEDIATION-AND-CONFIRMATION.md` — this document.

---

## 12. Evidence Artifacts

- Pre-fix regression test output: captured in this document (§2).
- Pre-fix `dirtyFiles()` output: captured in this document (§2).
- Post-fix regression test output: captured in this document (§5).
- Post-fix `dirtyFiles()` output: captured in this document (§5).
- Micro confirmation pre-fix summary: captured in this document (§7.1).
- Micro confirmation post-fix summary: captured in this document (§7.2).
- Micro confirmation script: `/home/z/my-project/scripts/micro-confirmation.ts` (host-only, not committed).

---

## 13. Stop Boundary

After this remediation is committed and pushed:

- STOP.
- Do NOT issue the TASK-023 corrigendum yet.
- Do NOT rerun the benchmark.
- Do NOT start another experiment.
- Do NOT start TASK-024.

---

*End of TASK-023 dirtyFiles remediation & confirmation document.*
