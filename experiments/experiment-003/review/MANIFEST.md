# TASK-022 — INDEPENDENT REVIEW MANIFEST

Prepared by the GLM Primary Builder as evidence-preparation for the external
reviewer. This manifest makes no verification claim. The verdict
`TASK-022 INDEPENDENTLY VERIFIED` is the reviewer's to issue.

```
REVIEW SHA = 6621a28cf437942de910ed97fa2fc20a78730c95
REMOTE SHA = 6621a28cf437942de910ed97fa2fc20a78730c95
MISSION ID = experiment-003-20261005T231628
JOURNAL REQUESTS = 25
JOURNAL RESPONSES = 25
JOURNAL INVENTORY PATH = experiments/experiment-003/review/JOURNAL-INVENTORY.md
FLIGHT RECORD PATH = data/flight-records/experiment-003-20261005T231628.jsonl
EXPERIMENT REPORT PATH = experiments/experiment-003/REPORT.md
INTEGRATION EVIDENCE PATH = experiments/experiment-003/review/integration-snapshot/ (GitHub-resolvable copy + provenance; local original: experiments/experiment-003/.runs/experiment-003-20261005T231628/mission/origin, branch genesis/integration @ 08dacc0)
TEST STATUS = 144/144 passed (22 test files, bun run test)
TYPECHECK = PASS (tsc --noEmit)
LINT = PASS (eslint)
```

Branches on the GitHub remote (mayakilzy/AgentCraft-Genesis):

- `build/group-03-repository-work` → `6621a28` — the FROZEN review scope.
  Push verified: `git ls-remote` resolves the branch to the SHA above;
  GitHub API returns HTTP 200 for the commit.
- `review/task-022-review-pack` → derived review aids only (this directory):
  the deterministic journal inventory, the builder's first-pass audit, and
  the integration snapshot with provenance. Nothing in the frozen scope was
  modified.

## KNOWN QUESTIONS FOR REVIEWER

These are the findings the builder's own first-pass audit surfaced
(experiments/experiment-003/review/FIRST-PASS-AUDIT.md, cited evidence in
every row). They are disclosed, not resolved:

1. **The invalidated isolation claim.** 6 of 25 fallback responses (seqs 11,
   12, 15, 21, 22, 23) use information absent from that request's visible
   context — cross-instance memory leakage by the fallback actor within the
   mission (a filename; earlier run counts; a branch name; unread source
   API; unread evidence numbers). Seq 24 is borderline (QUESTIONABLE).
   `FALLBACK HAD ACCESS ONLY TO WORKER-VISIBLE CONTEXT = YES` therefore does
   NOT hold at the per-instance level. The reviewer should re-derive these
   classifications independently from the journal.
2. **Where it is concentrated.** The repro engineer's main run and the
   writer's whole run are clean; the leakage concentrates in both handoff
   answers' generation and in the analyst's main run, which skipped
   evidence/source reading because the actor already knew both from the
   handoff instance it had served minutes earlier.
3. **What was NOT found** (reviewer should attempt to falsify this): no
   builder-privileged ground-truth use beyond the disclosed seed; no hidden
   gate-string anticipation; no gold-answer leakage (repro.mjs / DIAGNOSIS.md
   paths are open brief spec); the race hypothesis postdates the source read
   within the discovering instance (req 4 contains the full source before
   repro.mjs was written).
4. **Gate 5 is the weakest gate** (greps the openly-spec'd `RACE REPRODUCED`
   string from the workers' own repro; a trivial echo would satisfy it).
   Compensated by gate 8's independent instrumented probe, gate 7's source
   protection, and the sequential check order. Is the compensation
   sufficient for `8/8 FIRST PASS` to be called meaningful? Reviewer's call.
5. **Organization comparison honesty.** EXP002 and EXP003 share 2 of 3
   capability needs; the divergence is the third need
   (browser-verification → data-analysis) plus full role renaming at equal
   headcount (4 = 4). `STRUCTURALLY DIFFERENT = YES` is defensible on
   composition grounds; the reviewer should decide whether the shared-needs
   overlap weakens the emergence claim.
6. **Two `worktree-committed` events for three specialists** — explained by
   the runtime skipping clean worktrees (the analyst self-committed via its
   recorded shell action). Not a defect; noted because worker self-commits
   are journal/branch-visible only, not runtime-event-visible.
7. **Mild filename-inference patterns** (seqs 8/9: evidence filenames from
   the brief's descriptions; seq 17: `src/inventory.mjs` from the visible
   class name + the writer's own earlier "flaky-orders/src/" phrasing;
   seq 20: probing the brief-named repro.mjs defensively). Classified CLEAN
   with notes as self-verifying inferences — the reviewer may weigh them
   differently.

## REPRODUCTION COMMANDS (for the reviewer)

```bash
git clone https://github.com/mayakilzy/AgentCraft-Genesis.git
cd AgentCraft-Genesis
git checkout build/group-03-repository-work   # = 6621a28, the frozen scope

# journal: 25 + 25 files
ls experiments/experiment-003/evidence/dev-fallback-journal/ | sort | uniq -c | awk '{print $2}' | cut -d- -f1-2 | sort | uniq -c
sha256sum experiments/experiment-003/evidence/dev-fallback-journal/done-* | diff - <(sha256sum as listed in review/JOURNAL-INVENTORY.md)

# flight record: 86 events, verification 8/8, metrics 20+5+0=25
grep -c '' data/flight-records/experiment-003-20261005T231628.jsonl
python3 - <<'EOF'
import json
for line in open('data/flight-records/experiment-003-20261005T231628.jsonl'):
    e = json.loads(line)
    if (e.get('type') or e.get('event')) in ('verification', 'mission-finished'):
        print({k: v for k, v in e.items() if k != 'missionId'})
EOF

# integration snapshot ↔ journal write actions ↔ REPORT diffstat
diff <(python3 -c "import json; print(json.loads(open('experiments/experiment-003/evidence/dev-fallback-journal/done-resp-0018.txt').read())['contents'], end='')") experiments/experiment-003/review/integration-snapshot/DIAGNOSIS.md && echo IDENTICAL
diff <(python3 -c "import json; print(json.loads(open('experiments/experiment-003/evidence/dev-fallback-journal/done-resp-0004.txt').read())['contents'], end='')") experiments/experiment-003/review/integration-snapshot/repro.mjs && echo IDENTICAL
# ANALYSIS.md was written via a heredoc in done-resp-0023.txt's run_command —
# extract between the ANALYSISEOF markers and compare the same way.

# full test suite on the frozen scope
bun install && bun run test && bun run typecheck && bun run lint
```
