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
          STATUS = PASS (this package; see the handoff commit)

TASK-023  STATUS = BLOCKED PENDING CLEAN INDEPENDENT REASONING ACTOR

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
frozen benchmark infrastructure — PASS. The benchmark remains BLOCKED
until a genuinely independent reasoning actor exists: a fresh GLM
conversation (you, if assigned an arm) is exactly that actor.

## 7. Benchmark integrity state (safe to record)

```text
benchmark definition = frozen at 5eb6abc5c43537311290d63feb2d4a234fe20caa
workload             = KEEP
gold suite           = KEEP (sealed; contents forbidden)
evaluator            = KEEP (contents forbidden)
preflight            = KEEP
single-agent definition  (Arm A) = KEEP
static-team definition   (Arm B) = KEEP
Genesis-arm definition   (Arm C) = KEEP
benchmark base repo  = pinned, clean, single commit
```

The workload is valid. Its validity for YOU depends only on your
blindness: the same repository is a fair benchmark for a fresh reasoning
actor precisely because the builder's knowledge of it disqualifies the
builder, not the workload.

## 8. Current quality state (verified at TASK-023B freeze)

Re-verified on the TASK-023B tree before committing this package — not
copied from older reports:

```text
FULL TESTS = 161/161 PASS   (24 test files, vitest)
TYPECHECK  = PASS           (tsc --noEmit, strict)
LINT       = PASS           (eslint)
```

## 9. What comes after TASK-023

TASK-024 exists in the project roadmap and has NOT started. It must not
start until the human supervisor orders it after TASK-023 closes. If you
are an arm session, your job ends when your arm's evidence is frozen and
reported — the next steps belong to other sessions and the supervisor.
