# Experiment 002 — Software Engineering Organization

- **Mission:** `experiment-002-20261005T210312`
- **Status:** **FAILURE**
- **Wall time:** 43m 25s
- **Cognitive spend (separated per the GROUP 3 review requirement):** workers 16 + reviewer 0 + handoffs 0 = 22 total provider calls (67,449 prompt + 747 completion tokens; 36 rate-limit retries, 6 provider failures).
- **Human interventions:** 0 — the goal ran unattended.
- **Target:** `https://github.com/mayakilzy/genesis-gold-tasks` @ `c9106df8a6fc` — a real external repository, cloned read-only; pinned for reproducibility. Purpose-built as a Genesis gold task (disclosed): the two defects are real seeded behavior discrepancies, verified by a real failing test suite.

## The goal (given, not a team)

> In the tabloid markdown-table toolkit (the tabloid directory of the mission repository), fix the cell-escaping defect where literal pipes in cell content break column counts, and implement column alignment support (left, center and right separator syntax) so the provided failing tests pass. Verify the demo page shows an aligned table in a real browser, and document the changes in the README.

## The organization Genesis designed

Rationale: Scope "complex" in domain "software-engineering" with 3 capability needs. Planned 3 specialist role(s): Software Engineer [code-execution], Documentation Writer [document-authoring], Verification Engineer [browser-verification]. Mission Coordinator added because 3+ specialists require integration.

| Worker | Role | Capability needs |
| --- | --- | --- |
| `mission-coordinator-1` | Mission Coordinator | — |
| `software-engineer-1` | Software Engineer | code-execution |
| `documentation-writer-2` | Documentation Writer | document-authoring |
| `verification-engineer-3` | Verification Engineer | browser-verification |

A different organization from Experiment 001 (2 specialists, no coordinator): the browser acceptance requirement adds a Verification Engineer, and three specialists require a Mission Coordinator.

## Genomes (cognitive and tool grants)

| Worker | Tier | Grants |
| --- | --- | --- |
| `mission-coordinator-1` | default | — |
| `software-engineer-1` | cheap | openbot:shell-execution, openbot:workspace-files |
| `documentation-writer-2` | default | openbot:workspace-files |
| `verification-engineer-3` | cheap | openbot:browser-chromium, openbot:shell-execution, openbot:workspace-files |

## The repository work (from the flight record)

- **workspace-prepared**: cloned https://github.com/mayakilzy/genesis-gold-tasks @ c9106df8a6fcad5c45fddd7698a5ac635a4badae; 3 specialist worktree(s) on genesis/* branches (files: worktree:software-engineer-1, worktree:documentation-writer-2, worktree:verification-engineer-3)
- **worktree-committed**: 2 file(s) committed (files: abloid/src/align.ts, abloid/src/escape.ts, .npm/)
- **integrated**: merged software-engineer-1 → documentation-writer-2 → verification-engineer-3 onto genesis/integration
- **worktree-committed**: 0 file(s) committed (files: .npm/)
- **integrated**: merged software-engineer-1 → documentation-writer-2 → verification-engineer-3 onto genesis/integration

## The workers

### software-engineer-1

- **Status:** failure (0 steps, 0 reasoning calls)
- **Summary:** reasoning provider failed: API request failed with status 429: {"error":"Too many requests, please try again later"}

### documentation-writer-2

- **Status:** failure (0 steps, 0 reasoning calls)
- **Summary:** reasoning provider failed: API request failed with status 429: {"error":"Too many requests, please try again later"}

### verification-engineer-3

- **Status:** failure (0 steps, 0 reasoning calls)
- **Summary:** reasoning provider failed: API request failed with status 429: {"error":"Too many requests, please try again later"}

### mission-coordinator-1

- **Status:** failure (0 steps, 0 reasoning calls)
- **Summary:** reasoning provider failed: API request failed with status 429: {"error":"Too many requests, please try again later"}

## Verification (clean room: committed state only, repo-derived gates)

- **Pass 1:** FAILED — 6 passed, 1 failed
  - the demo page serves and renders (deterministic probe on the clean-room port): "pkill -f 'serve.mjs 4273' 2>/dev/null; sleep 0.3; cd repo/tabloid && (nohup node demo/serve.mjs 4273 > .demo.log 2>&1 &)" exited -1 (expected 0); stderr: 
- **Pass 2:** FAILED — 6 passed, 1 failed
  - the demo page serves and renders (deterministic probe on the clean-room port): "pkill -f 'serve.mjs 4273' 2>/dev/null; sleep 0.3; cd repo/tabloid && (nohup node demo/serve.mjs 4273 > .demo.log 2>&1 &)" exited -1 (expected 0); stderr: 

**Bounded retry (one, with recorded reason):**
- 1 of 7 acceptance check(s) failed: the demo page serves and renders (deterministic probe on the clean-room port) ("pkill -f 'serve.mjs 4273' 2>/dev/null; sleep 0.3; cd repo/tabloid && (nohup node demo/serve.mjs 4273 > .demo.log 2>&1 &)" exited -1 (expected 0); stderr: )

## The integrated result (what the gates actually ran against)

```diff
tabloid/src/align.ts  | 5 +++--
 tabloid/src/escape.ts | 7 ++-----
 2 files changed, 5 insertions(+), 7 deletions(-)
```

Integration branch commits beyond the pinned base:

```
99718eb work of software-engineer-1 (verification attempt 1) (genesis/software-engineer-1)
```

## Mission summary (as integrated)

verification failed and no artifacts were produced: 1 of 7 acceptance check(s) failed: the demo page serves and renders (deterministic probe on the clean-room port) ("pkill -f 'serve.mjs 4273' 2>/dev/null; sleep 0.3; cd repo/tabloid && (nohup node demo/serve.mjs 4273 > .demo.log 2>&1 &)" exited -1 (expected 0); stderr: )

## Post-run analysis (added after the mission, from the flight record)

**What actually happened.** `software-engineer-1` completed a full, successful round 1 (15 steps, 16 reasoning calls): both seeded defects were fixed (`escape.ts`, `align.ts`), committed to `genesis/software-engineer-1`, and merged to `genesis/integration` (commit `99718eb`). Verification then passed **6 of 7 gates in a clean room** — the API behavior gate, the README gate, and all repo-derived engineering gates (install, build, test) passed against the committed state. After that first verification, the ZAI endpoint entered a sustained rate-limit storm (429 for tens of minutes after ~108 provider calls in the preceding hour): `documentation-writer-2`, `verification-engineer-3`, `mission-coordinator-1`, and the retried `software-engineer-1` all died with zero steps, each after exhausting the provider's full 410-second backoff schedule. The mission clock aborted at 21:33:13; the second verification pass completed at 21:46:38.

**Defect exposed (1): a dead retry erased committed work.** The final status reads "failure … no artifacts were produced" while this same report shows the integrated diff and the integration-branch commit. Cause: the retry loop replaced each worker's result map entry unconditionally, so the engineer's 429 death overwrote its own round-1 success — the mission forgot deliverables that were literally merged and gate-checked. Fixed in `src/mission/orchestrator.ts`: a failed retry no longer replaces a prior success (the retry failure remains in the flight record as its own `worker-finished` event). Report rendering follows the same rule and notes the dead retry. Regression test: `tests/mission/completion-contract.test.ts` ("a dead retry does not erase committed round-1 work"). With this fix, this mission's status would have been **partial** — the honest outcome for real committed work that passed 6/7 gates twice.

**Defect exposed (2): the demo gate killed its own shell.** The only failing check — the demo-page probe — exited `-1` with empty stderr on every pass, in every run since 20:31. Root cause, reproduced in isolation: the probe's `pkill -f 'serve.mjs 4273'` prefix matches the probing shell's *own* command line (which contains that very string in its launch section), so the shell SIGTERMs itself (`bash -c` exits 143). The gate could never open, for any worker output. Fixed with `killPortServerCommand` (`src/work/dev-runtime.ts`): kill by listening socket (`lsof -t -i:<port> | xargs -r kill`), which a shell never holds. Regression tests: shell-survival and real-listener-dies (with an untouched bystander). Live smoke test against the gold repository: `probe: ok`, exit 0.

**Environmental finding (WATCH).** The endpoint's throttle window is measured in tens of minutes, far beyond the provider's 410-second total backoff patience; a mission hit mid-flight by the storm cannot recover within its 30-minute budget. Consequence: unattended missions must be launched into a clear window (probed first), and the provider's patience schedule is not the tool for window-scale throttling. Recorded as an operational constraint, not a code change.
