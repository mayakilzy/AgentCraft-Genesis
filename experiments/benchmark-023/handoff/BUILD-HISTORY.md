# Build History — Authoritative Status (Safe)

This is the accepted project history a fresh session needs. It records
classifications and lessons only — never benchmark solutions. Historical
classifications are frozen; do not rewrite them.

## 1. Authoritative task status

```text
GROUP 1   TASK-001 → TASK-009    STATUS = PASS
GROUP 2   TASK-010 → TASK-015    STATUS = PASS
GROUP 3   TASK-016 → TASK-020    STATUS = PASS

TASK-021  Experiment 002
          STATUS = PASS WITH PARTIAL EXPERIMENT EVIDENCE

TASK-022  Experiment 003
          STATUS = PASS WITH PROCESS CONTAMINATION
          Historical evidence preserved.

TASK-022A Development Fallback Instance Isolation Remediation
          STATUS = PASS — ACCEPTED

TASK-023 ATTEMPT 1
          STATUS = INVALID
          Reason = benchmark serving-harness failure / no scoreable result

TASK-023 ATTEMPT 2
          STATUS = INVALID
          Reason = builder/fallback knowledge contamination

TASK-023A Benchmark Integrity Recovery
          STATUS = PASS

TASK-023B Safe Blind-Session Handoff
          STATUS = PASS

TASK-023 ATTEMPT 3, ARM A (strong single agent)
          STATUS = VALIDLY EXECUTED — ACCEPTED
          Mission = mission-20261006T044842-d29f38 (success)
          Evidence frozen at 55aaebdbf760bed6779a7d8efa1a27fa49d43fd4
          Epistemic isolation declaration = PASS (gold_access=false,
          builder_context_access=false, prior_arm_context_access=false)

TASK-023C Common Execution Base Freeze
          STATUS = PASS
          (the exact Arm-A execution base 12a448c4… frozen as the ONE
          common base for Arms A/B/C; persisted as a git bundle under
          handoff/execution-base/ with manifest + restoration
          instructions; restoration-tested to reproduce the exact SHA;
          deterministic controls matched the freeze-time values exactly;
          Arm A promoted from PROVISIONALLY ACCEPTED to ACCEPTED)

TASK-023  STATUS = IN PROGRESS — ARM A ACCEPTED; ARM B READY FOR A
          FRESH ZERO-MEMORY SESSION (restore/verify the common base;
          never run the workload generator)

TASK-024  STATUS = NOT STARTED
```

## 2. Why fresh GLM conversations are being used

The GLM conversation that built GROUP 3 also designed and built the
TASK-023 benchmark: it authored the workload, the reference solution, the
hidden tests, the defect machinery, and the evaluator, and it observed
debugging behavior of all of them. That knowledge makes it permanently
unusable as benchmark reasoning:

```text
PREVIOUS GLM SESSION = BENCHMARK AUTHORITY / BUILDER
PREVIOUS GLM MAY SERVE BENCHMARK REASONING = NO
```

A benchmark authority may know the answer; the reasoning actor may not.
A benchmark the subject wins through leaked knowledge is worthless. The
previous session therefore closed after writing this handoff, and each
benchmark arm is now executed by a **completely fresh GLM conversation
with zero memory of this project** — that lack of memory is intentionally
the epistemic isolation mechanism. Project context (this package) is
safe; benchmark secrets are not included and must not be sought.

## 3. GROUP 1 — Foundation + Genesis Born Core (accepted)

Outcome: the compile chain exists and is pinned by tests —
`GoalCompiler`, `OrganizationPlanner`, `GenomeCompiler`, decision
routing, and the minimal frozen contracts. Deterministic-by-default with
injectable understanding/decision providers. Verified live against the
real MCP, AG-UI and A2A SDKs before building on them.

## 4. GROUP 2 — Genesis Born Runtime (accepted)

Outcome: real execution — the OpenBot adapter (per-worker
agent-computers), worker coordination, `MissionOrchestrator`,
`VerificationLoop`, `FileFlightRecorder`, and the external reasoning
provider adapter. **Experiment 001** ran live: Genesis compiled a goal,
created an organization, executed with real workers on OpenBot, verified,
retried once, and completed a real bounded mission (live npm registry
research, clean-room verification passing 4/4, zero human intervention).

## 5. GROUP 3 — Genesis Work (accepted through TASK-022A)

Outcome so far: `GitWorkspace` (real git worktrees per worker), the
Development Runtime, browser verification, the completion contract, the
Integration Manager, real software-engineering missions on real external
repositories, a diagnostic-organization experiment, the Development
Fallback instance-isolation remediation, and the TASK-023 benchmark
harness. Current task = TASK-023 (blocked, see §1).

### Experiment 002 — real software-engineering organization

Historical result: `PASS WITH PARTIAL EXPERIMENT EVIDENCE`. Genesis ran
a full SE mission on a real repository: real worktrees, real commits,
clean-room verification passing most gates repeatedly, zero human
intervention. Lessons that shaped the runtime: retry semantics must not
erase committed work (a failed retry may not wipe a prior success);
process lifecycle must be airtight (worker computer shutdown, port
cleanup, detached-process survival); external provider instability must
not control development velocity (the fallback rule, §6 of
`PROJECT-AND-ARCHITECTURE.md`).

### Experiment 003 — diagnostic organization

Historical result: `PASS WITH PROCESS CONTAMINATION`. The mission
succeeded end-to-end under declared development fallback (clean-room
verification 8/8 on first pass, emergent organization structurally
different from the SE experiment's). The independent review then found
the shared fallback journal let reasoning memory leak between logically
isolated worker instances. Lesson: fallback reasoning requires strict
per-instance epistemic isolation. The hidden diagnostic content of that
experiment is not needed and is not included here.

### TASK-022A — the fix

Per-worker-instance fallback isolation: one journal directory per logical
worker instance, same-instance continuity preserved, explicit Genesis
communication still allowed, cross-instance hidden memory impossible.
Accepted and pinned by regression tests.

## 6. TASK-023 — the three-arm benchmark (current task)

TASK-023 asks whether Genesis's adaptive organization is actually better
than simpler alternatives (full protocol in
`BENCHMARK-EXECUTION-PROTOCOL.md`). Its execution history so far:

```text
Attempt 1 = INVALID / UNSCORED  (serving-harness failure; no scoreable result)
Attempt 2 = INVALID / UNSCORED  (builder/fallback knowledge contamination)
```

**Do not reuse either attempt. Do not inspect their private reasoning.
Do not continue their mission IDs** (`mission-20261006T014358-e8c2f2`,
`mission-20261006T021653-12073e`). Start the assigned arm from a fresh
clean state. No solution details are included here, and none are needed:
what matters is that both attempts are unusable as evidence and are
preserved only as invalidation records under forbidden paths (see
`SAFE-CONTEXT-MAP.md`).

TASK-023A then froze the evidence, restored the authority/actor boundary,
installed the machine-checked pre-launch epistemic gate, and verified the
frozen benchmark infrastructure — PASS. Attempt 003 then executed Arm A
validly in a fresh session (mission above), and TASK-023C closed the
base-identity question: the fresh-host reconstruction had re-pinned the
base SHA (the original host-only base was lost to an environment reset;
the frozen generator and inputs — byte-identical to the freeze —
reproduced a content-equivalent base before Arm A), so TASK-023C froze
that exact base as the single common execution base for all three arms,
persisted it as a restoration-tested git bundle, and accepted Arm A.
Arms B and C must run on exactly that base (restore/verify per
`handoff/execution-base/RESTORE.md`; never regenerate). The deep
comparative evaluation across arms happens only after all three arms
are frozen, in the authority's clean room — never inside an arm
session.

## 7. Benchmark integrity state (safe to record)

```text
benchmark definition = frozen at 5eb6abc5c43537311290d63feb2d4a234fe20caa
safe handoff          = frozen at 321e8c673c28edbc6a52ade34a6f04c30997c157
common execution base = 12a448c4b9284b9063987d8cbaa7fcb2a7c1300a
                       (frozen by TASK-023C; the ONLY valid base for any
                       arm; persisted as a git bundle under
                       handoff/execution-base/ — never regenerate it)
workload             = KEEP
gold suite           = KEEP (sealed; contents forbidden)
evaluator            = KEEP (contents forbidden)
preflight            = KEEP
single-agent definition  (Arm A) = KEEP
static-team definition   (Arm B) = KEEP
Genesis-arm definition   (Arm C) = KEEP
benchmark base repo  = pinned, clean, single commit
```

These are three DIFFERENT concepts and must not be conflated: the
benchmark definition freeze (what the benchmark is), the safe handoff
freeze (what a fresh session may read), and the common execution base
(the exact broken target commit every arm executes on).

The workload is valid. Its validity for YOU depends only on your
blindness: the same repository is a fair benchmark for a fresh reasoning
actor precisely because the builder's knowledge of it disqualifies the
builder, not the workload.

## 8. Current quality state (re-verified at TASK-023C)

Re-verified on the TASK-023C tree before committing — not copied from
older reports:

```text
FULL TESTS = 161/161 PASS   (24 test files, vitest)
TYPECHECK  = PASS           (tsc --noEmit, strict)
LINT       = PASS           (eslint)
```

Environment note (host restoration artifact, not a content change):
the host may lose file permission bits across environment restores
(all files appear 100755). Normalize with `git config core.fileMode
false` per repository and never commit mode-only changes. The TASK-023C
re-verification also re-downloaded the Playwright Chromium build the
frozen live browser test requires — restoring the documented
reconstruction environment, not modifying any gate.

## 9. What comes after TASK-023

TASK-024 exists in the project roadmap and has NOT started. It must not
start until the human supervisor orders it after TASK-023 closes. If you
are an arm session, your job ends when your arm's evidence is frozen and
reported — the next steps belong to other sessions and the supervisor.
