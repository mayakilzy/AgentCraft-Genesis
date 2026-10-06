# Safe Context Map — SAFE vs FORBIDDEN Paths (Real, Verified)

Every path below was verified against the actual repository and host
layout at TASK-023B freeze time. Paths are real. Nothing is invented.

Repository root = `/home/z/my-project/AgentCraft-Genesis` (repo-relative
paths below are relative to this root). Host paths are absolute.

## 0. The default-deny rule

```text
EVERYTHING NOT EXPLICITLY LISTED AS SAFE IN THIS FILE IS FORBIDDEN.
```

If you need a path that is not on the safe list: STOP and report. Do not
explore "just to see". The safe list is complete for every legitimate
action this project requires of you.

## 1. SAFE — repository paths

```text
README.md
docs/architecture-baseline.md
docs/protocol-probe.md
package.json, package-lock.json, tsconfig.json, eslint.config.js,
vitest.config.ts, .gitignore

src/**                        the entire Genesis source tree
tests/**                      the entire test tree
data/ownership.yaml
data/upstream-capabilities.yaml
data/dependency-baseline.json

experiments/benchmark-023/handoff/**          this package
experiments/benchmark-023/run.ts              arm runner (launch mechanics)
experiments/benchmark-023/mission.ts          public goal + arm planner definitions
experiments/benchmark-023/preflight.ts        safe preflight (prints PASS/FAIL only)
experiments/benchmark-023/epistemic-gate.ts   pre-launch declaration gate
experiments/benchmark-023/serving-protocol.md the frozen fallback-actor contract
experiments/benchmark-023/workload/base-commit.txt   pinned target identity (a SHA)

experiments/experiment-001/**                 historical: source, report, artifacts
experiments/experiment-002/**                 historical: source, reports
experiments/experiment-003/run.ts
experiments/experiment-003/mission.ts
experiments/experiment-003/dev-fallback.ts    the fallback provider mechanism
experiments/experiment-003/REPORT.md
experiments/experiment-003/BLOCKED-PROVIDER.md
```

Notes on two of these:

- `mission.ts` contains the public mission goal (worker-visible by
  design) and the three arm planners. Reading your own arm's definition
  and the goal is safe and necessary for fairness. Do not read more of
  the other arms' definitions than fairness verification requires.
- `preflight.ts` inspects benchmark infrastructure and prints only
  PASS/FAIL lines. Running it is safe; it does not expose secrets.

## 2. SAFE — host paths

```text
/home/z/my-project/AgentCraft-Genesis/        the repository (subject to this map)
/home/z/my-project/OpenBot/                   upstream OpenBot checkout (runtime needs it)
/home/z/my-project/target-repos/worklog       the broken benchmark target repository
                                              (worker-visible mission material; you do
                                              NOT need to read it — the harness clones it)
/home/z/my-project/missions/<your-mission-id>/   YOUR OWN arm's mission root, once it
                                              exists (queue, evidence, ARM-RESULT.json)
/home/z/my-project/scripts/launch-detached.ts    the ONLY whitelisted file in scripts/
                                              (neutral detached-process launcher)
/home/z/my-project/genesis/.token             GitHub push credential — use it, never
                                              print it, never commit it
```

Other host directories exist (`repo-info/`, `genesis-gold/`, `download/`,
`scripts/` beyond the one file, and more). None of them are needed for
anything you may legitimately do. Default-deny applies to all of them.

## 3. FORBIDDEN — repository paths

```text
experiments/benchmark-023/workload/pristine/      pristine reference implementation
experiments/benchmark-023/workload/generate.ts    defect generator / transformation
experiments/benchmark-023/workload/verify-docs.mjs  gold documentation harness
experiments/benchmark-023/evaluate.ts             evaluator implementation / internals
experiments/benchmark-023/BENCHMARK-DESIGN.md     benchmark-builder design notes
experiments/benchmark-023/CONTAMINATION-REVIEW.md builder notes (invalidated review)
experiments/benchmark-023/INTEGRITY-RECOVERY.md   benchmark-authority notes
experiments/benchmark-023/evidence/               ALL evidence: preflight control
                                                   results, invalid-attempt flight records
data/flight-records/                              historical mission flight records
                                                   (previous private mission reasoning)
experiments/experiment-003/evidence/dev-fallback-journal/   previous mission private
                                                   fallback reasoning
```

## 4. FORBIDDEN — host paths

```text
/home/z/my-project/target-repos/.worklog-gold/       sealed gold truth
/home/z/my-project/benchmark-evidence/               invalid-attempt evidence (mission
                                                     roots, journals, serving logs)
/home/z/my-project/worklog.md                        builder worklog — builder
                                                     debugging notes and context
/home/z/my-project/scripts/    (everything EXCEPT launch-detached.ts)
                                                     builder/authority tooling
/home/z/my-project/download/                         review packs, journal audits
/home/z/my-project/missions/<any mission that is NOT yours>
                                                     other arms' private evidence
```

## 5. FORBIDDEN — regardless of path

The following information classes may never be inspected, wherever they
appear, including in git history:

```text
pristine reference implementation
sealed gold
hidden gold tests
defect generator / transformation
defect map
evaluator implementation / internals
gold expected outputs not public in the mission specification
invalid Arm A reasoning journals
previous Arm private reasoning
benchmark-builder debugging notes revealing defects
contaminated operator reasoning
```

**Git history counts.** Never run `git show`, `git log -p`, `git diff`,
or `git blame` in a way that would render the CONTENT of any forbidden
path at any historical commit (the frozen benchmark commits contain
those files). Git metadata (commit list, messages, SHAs) is safe; git
content of forbidden paths is not. Never resolve a curiosity about the
benchmark by reading its history.

## 6. SAFE information classes

You MAY work with: this handoff package; the public Genesis architecture
(`src/`, docs); the public mission goal; the broken target repository
assigned to your arm (via your mission's worktrees); worker-visible
evidence your mission produces; your own worker-instance journals;
explicit handoffs your mission delivers; normal tool results; runtime
errors generated during your own execution; your own arm's flight record
and frozen results.

## 7. Verified commands

From the repository root (`/home/z/my-project/AgentCraft-Genesis`),
node_modules already installed; if absent run `npm ci` first:

```bash
# quality gates (expected: 161/161 tests, typecheck clean, lint clean)
npm test
npm run typecheck
npm run lint

# TASK-023 safe preflight — run BEFORE any arm; every line must say PASS
# and the final line "PREFLIGHT OVERALL: PASS" (exit code 0)
bun experiments/benchmark-023/preflight.ts

# launch one permitted arm (see BENCHMARK-EXECUTION-PROTOCOL.md for the
# full procedure; the declaration file is mandatory)
bun experiments/benchmark-023/run.ts --arm A --declaration <declaration.json>
```

Because this environment kills direct background jobs when a tool call
ends, long-running launches must use the detached launcher:

```bash
bun /home/z/my-project/scripts/launch-detached.ts <logfile> \
    bun experiments/benchmark-023/run.ts --arm A --declaration <declaration.json>
```

Inspecting your arm's status while it runs (safe — it is your own
mission):

```bash
ls /home/z/my-project/missions/                          # mission roots
ls /home/z/my-project/missions/<id>/fallback-queue/      # instance journals
cat /home/z/my-project/missions/<id>/fallback-queue/instance-*/req-*.json
tail -f <logfile>
tail -n 5 data/flight-records/<missionId>.jsonl          # your arm's record
cat /home/z/my-project/missions/<id>/ARM-RESULT.json     # after completion
cat /home/z/my-project/missions/<id>/EXIT-CODE
```

Persisting evidence to GitHub (token file must never be printed or
committed):

```bash
TOKEN=$(cat /home/z/my-project/genesis/.token)
git add data/flight-records/<missionId>.jsonl <evidence files>
git commit -m "task-023 arm <X>: frozen evidence <missionId>"
git push "https://x-access-token:${TOKEN}@github.com/mayakilzy/AgentCraft-Genesis.git" \
    build/group-03-repository-work
git ls-remote origin build/group-03-repository-work   # must equal local HEAD
```

## 8. No-leakage discipline

Regardless of path, never WRITE or SAY: what the hidden defects are,
where they are, what the expected fix is, what the gold suite checks,
what the pristine implementation does, what the evaluator expects, what
a previous arm discovered, or any known-failing output. If a summary
would require such a statement, the summary stops and states that the
information is benchmark-secret. This applies to your final report too.
