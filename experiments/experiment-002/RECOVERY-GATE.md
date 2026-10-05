# TASK-021 Recovery Gate — evidence record

- **Date:** 2026-10-05 22:25 UTC
- **Trigger:** Human review after Experiment 002 mission `210312` (provider-storm contaminated result + two genuine Genesis defects found and fixed).
- **Base checkpoint:** `8edd19d` (mission evidence + both fixes + regression tests).
- **Gate scope:** verify the fixes, sweep for the defective pattern, re-run verification, confirm repository integrity, classify the evidence. **No** new experiment runs, **no** TASK-022/023 execution.

## 1. Fix verification (both regression-tested and green)

| Fix | Regression test | Result |
| --- | --- | --- |
| A dead retry must never erase a prior successful/committed worker contribution | `tests/mission/completion-contract.test.ts` — "a dead retry does not erase committed round-1 work" | PASS |
| Server cleanup kills by owned listening port, never broad `pkill -f` matching | `tests/work/dev-runtime.test.ts` — "the probing shell survives its own kill prefix"; "a real listener on the port dies, and an unrelated process is untouched" | PASS |

## 2. Defective-pattern sweep (`pkill -f 'serve.mjs ...'`)

- Repository executable code: **zero copies remain**. The one confirmed copy (`experiments/benchmark-023/run.ts`, inherited from the pre-fix probe) is replaced with the tested `killPortServerCommand` helper in the working tree; that file stays **untracked** until TASK-021 closes (per instruction 8).
- Remaining matches are non-executable and intentionally preserved: the fix's own documentation comments, the historical failure text in this experiment's `REPORT.md`, and the committed flight records (`203154`, `210312` — 3 occurrences each, immutable mission evidence).
- Host-side diagnostic script `scripts/dryrun-exp2-checks.sh` (outside the repository, never executed by Genesis) carried the same pattern and was corrected in place.

## 3. Verification runs (this gate, current tree)

- Full suite: **135/135 pass**, 0 fail, 1001 expect() calls, 20 files.
- `tsc --noEmit`: **PASS**. `eslint .`: **PASS**.
- Live GitWorkspace (TASK-016): 12/12 — including "worker edits + commits stay isolated, and the source repository is preserved", "resetIntegration rolls the integration branch back to the mission base" (**integration rollback/reset functional**), and the clean-room untracked-junk property.
- Live IntegrationManager (TASK-020): 5/5 — including the LIVE composition (two real workers, real commits, real integration, clean-room gates).
- Live browser/runtime (TASK-018): 7/7 — including real Chromium navigating a real local server started inside the same computer.
- Isolated demo probe (fixed command, gold repository): **`probe: ok`, exit 0**; port freed afterwards; probe artifacts cleaned; gold clone status fully clean.

## 4. Repository integrity

- Gold repository (`mayakilzy/genesis-gold-tasks` local clone): HEAD `c9106df8a6fcad5c45fddd7698a5ac635a4badae` (the pinned ref), `git status` clean, only `main`, no `genesis/*` branches, never pushed from any mission (no push path exists in mission code).
- No `.npm` or `node_modules` paths tracked in AgentCraft-Genesis (`git ls-files` sweep: empty).
- Mission evidence preserved: 4 `.runs` mission roots on disk (`200040`, `202258`, `203154`, `210312`), gitignored by `experiments/*/.runs/`; all 6 flight records committed (192136, 200040, 202258, 203154, 210312 + experiment 001).
- Orphaned processes: **none** — no `bun src/index.ts` agent-computers, no experiment runners, no `serve.mjs` servers; ports 4173/4273 free.

## 5. Provider availability (single lightweight probe, per instruction 5)

- 22:23:26 UTC: **BLOCKED** — `429 Too many requests` in 34 ms (immediate rejection). The throttle window observed since ~21:05 exceeds one hour; the provider's total backoff patience is 410 s. Recorded as an **environmental/provider constraint**; no Genesis redesign performed or planned around it.

## 6. Evidence classification (mission 210312 and its predecessors)

**GENESIS DEFECT (found live, FIXED):**
1. Dead-retry erasure — the retry loop unconditionally replaced worker results, so a provider-killed retry erased a prior successful committed contribution (mission 210312 reported "no artifacts" while carrying commit `99718eb` and passing 6/7 gates on it). Fixed at `8edd19d` + regression test.
2. Demo-gate self-kill — `pkill -f 'serve.mjs 4273'` matched the probing shell's own command line; the gate exited -1 on every pass of every run (isolated reproduction: bash exit 143). Fixed via `killPortServerCommand` (kill by listening socket) + regression tests + live probe.
3. *(fixed earlier, at `fe7a72e`)* computer `stop()` left detached servers alive; repo preamble polluted goal classification; `.npm` cache poisoned the evidence boundary. Each carries its own regression test.

**GENESIS DEFECT (found in sweep, fixed in working tree):**
4. `benchmark-023/run.ts` had inherited the defective pattern — replaced with the tested helper; file remains untracked pending TASK-021 closure.

**EXTERNAL PROVIDER FAILURE:**
- Sustained ZAI throttle window (429 for >1 h continuous at probe time, total backoff patience 410 s): killed `documentation-writer-2`, `verification-engineer-3`, `mission-coordinator-1`, and the retried engineer at zero steps; one socket reset also observed. Not a Genesis defect; not chased with code.

**EXPERIMENT RESULT:**
- **Experiment 002 = PARTIAL** (honest post-fix classification). Real software-engineering work was performed and committed in a real external repository: both seeded defects fixed (`escape.ts`, `align.ts`), merged to `genesis/integration` (`99718eb`), clean-room verification passed **6/7 gates twice** (API behavior, README, install, build, test). The seventh gate was the self-killing demo probe (Genesis defect, now fixed). The documentation and coordinator legs were lost to the provider storm. The raw flight record preserves its original `failure` status (pre-fix behavior) — evidence is never rewritten.

## 7. Decision

- TASK-021 **code**: ready — runtime internally sound per this gate; the final clean unattended run awaits a clear provider window and human go-ahead.
- TASK-022: **not started**, per instruction.
- TASK-023: existing `benchmark-023/run.ts` stays untracked in the working tree; not executed, not expanded.
