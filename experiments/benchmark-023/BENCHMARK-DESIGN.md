# TASK-023 — Benchmark Design (FROZEN before any arm runs)

Status: FROZEN — this document, the harness, the workload generator, the
pristine workload tree, the serving protocol and the evaluator are committed
and hash-recorded BEFORE Arm A executes. Nothing in this file may change
after the first arm starts. If a harness defect is discovered mid-benchmark
that requires a fix, the whole benchmark restarts from scratch (all arms),
or the benchmark reports BENCHMARK VALIDITY = FAIL.

Base for this work: `96bfe74f66a74712bb457c9aff78a55fa92bfe8a`
(TASK-022A, accepted; per-worker-instance fallback epistemic isolation).

---

## 1. The scientific question

> Does Genesis adaptive organization provide measurable value over simpler
> alternatives under equivalent conditions?

Three hypotheses:

- **H0** — a strong single worker achieves comparable quality at lower cost.
- **H1** — a static multi-agent team improves the result; dynamic
  organization adds little beyond it.
- **H2** — adaptive organization (GoalCompiler → OrganizationPlanner →
  GenomeCompiler → Runtime, no harness-supplied worker list) produces
  materially better outcome quality / reliability / adaptation /
  human-effort reduction without disproportionate resource cost.

This is a falsification experiment. Genesis is allowed to lose. A tie is
allowed. A simpler architecture winning is allowed. The benchmark is not
tuned in Genesis's favor; the goal text below was written as a plain,
natural mission statement first, and the deterministic compilation result
was only verified (not iterated) afterwards.

## 2. The arms

Exactly one variable differs across arms: **who designs the organization.**

| Arm | Strategy | Organization source |
| --- | --- | --- |
| A | Strong Single Agent | harness-fixed: ONE Sole Operator holding every capability need the goal compiles to (same tool universe the mission implies, same tier policy, same step ceiling) |
| B | Static Multi-Agent Team | harness-fixed BEFORE workload generation: Software Engineer [code-execution], Verification Engineer [code-execution], Documentation Writer [document-authoring], Mission Coordinator [] — a reasonable generic team for the "repair + document + verify a repository" mission class; never adapted |
| C | Genesis Adaptive Organization | the real chain: GoalCompiler → OrganizationPlanner → GenomeCompiler → Runtime; the harness supplies NO worker list, no roles, no override |

Arm B's team was frozen in this document (committed before the benchmark
base repository was generated), chosen from the mission CLASS only
(repair + documentation + verification), not from the specific seeded
defects. It is not deliberately weakened.

## 3. The workload (fresh, deterministic, offline)

**Target project: `worklog` v1.4.2** — a small, real, zero-dependency
Node.js time-tracking ledger (library + CLI), ~550 source LOC across
6 ESM modules, with README + SPEC.md + docs/api.md.

- Fresh to the fallback actor: never used in Experiment 001/002/003;
  not the tabloid or flaky-orders workload; no reused seeded defects.
- Real runnable project: `node --test` suite, CLI, JSONL store, CSV/JSON
  export; deterministic (no clocks in tested paths, no randomness, no
  network, zero npm dependencies — `npm install` is an offline no-op).
- Two-plus meaningful concerns: (1) five seeded implementation defects
  across four modules; (2) two corrupted documentation examples;
  (3) the release shipped with NO test suite — the mission requires
  delivering one. Specialization could plausibly help; a single strong
  worker can also complete everything.
- Not engineered to require multiple workers and not engineered to favor
  a single worker.

### Construction (deterministic transformation)

`workload/generate.ts` performs, deterministically and reproducibly:

1. Copy `workload/pristine/` (the correct project incl. its full gold test
   suite) to a sealed gold directory OUTSIDE any worker-visible path.
2. Validate the pristine tree: `node --check` all sources, gold suite
   100% pass, doc-example harness 100% pass on pristine docs.
3. Apply exactly five single-hunk implementation mutations and two
   documentation-example corruptions (precise string replacements; the
   generator fails loudly if any anchor is not found — see §4).
4. Validate the broken tree: sources still parse, CLI still runs,
   gold suite fails on >= 8 tests, doc harness fails on both corrupted
   documents.
5. Create the benchmark base repository at a NEUTRAL local path
   (`/home/z/my-project/target-repos/worklog`) as a FRESH git repo with a
   SINGLE commit of the broken tree ("worklog v1.4.2 release snapshot").
   The pristine state is NEVER committed to any worker-visible history:
   there is no defect-introducing diff to mine, no ancestor commit to
   checkout. The pinned base SHA is recorded in `workload/base-commit.txt`
   and in the sealed manifest.
6. Emit the sealed manifest (defect list, per-defect gold-test deltas,
   doc corruption list, SHAs of base tree and gold tree) into the sealed
   gold directory. The manifest is not shown to any arm; it is committed
   as evidence only after all arms and the evaluation are complete.

The three arms each receive their own private clone of the SAME pinned
base commit through the standard GitWorkspace machinery (clone
--no-hardlinks, per-specialist worktrees, integration branch, clean-room
verifier clone of committed state only).

### The five seeded implementation defects (sealed until evidence commit)

Each is a single small hunk, each flips at least one gold test, none
crashes the CLI:

- D1 `src/report.mjs` — summarize sorts ascending by minutes with
  reversed tie-break (spec: minutes DESC, project name ASC).
- D2 `src/format.mjs` — toCSV quotes only on commas, never doubles
  embedded quotes (spec: RFC4180 — quote on comma/quote/newline, double
  embedded quotes).
- D3 `src/store.mjs` — date validation accepts non-padded and
  calendar-invalid dates (spec: strict YYYY-MM-DD, real calendar date).
- D4 `src/parse.mjs` — `--day=VALUE` equals-form silently drops the value
  (spec: both `--day VALUE` and `--day=VALUE` set the filter).
- D5 `src/report.mjs` — formatDuration renders sub-hour totals as
  `0h 45m` (spec: `45m`; hours segment only when nonzero).

### The two documentation corruptions (sealed until evidence commit)

- DOC1 `README.md` — the summary example's expected output block shows
  projects in the wrong order and sub-hour durations in the wrong style.
- DOC2 `docs/api.md` — the toCSV example's expected output shows an
  unquoted, un-doubed field that the CSV specification requires to be
  quoted with doubled embedded quotes.

Both corruptions mirror the SYMPTOMS of D1/D5 and D2 respectively. A team
that "fixes" the docs to match broken code bakes the wrongness in and
fails the gold gates; a team that fixes the code but leaves the docs
stale fails the documentation gates. The concerns interlock.

## 4. Gold truth (evaluator-only, never in worker prompts)

Gold lives in the sealed directory, outside every worker-visible path:

- the pristine implementation tree;
- the pristine test suite (`tests/`, ~40 node:test cases);
- `tools/verify-docs.mjs` — the executable-documentation harness;
- the sealed defect manifest.

Nothing gold is inserted into any worker prompt, any task brief, or any
fallback request. The fallback serving sessions are fresh GLM sessions
that never saw the benchmark construction (see CONTAMINATION-REVIEW.md).
The builder session (which authored the workload and knows the defects)
never serves any reasoning operation for any arm.

## 5. Final clean-room acceptance gates (identical, arm-blind)

The evaluator (`evaluate.ts`) takes paths, not arm identities. Every gate
is classified before execution. It evaluates each arm's final integrated
state: a fresh clone of the arm's `genesis/integration` branch (committed
state only) plus hygiene checks against the arm's preserved worktree.

| # | Gate | Class |
| --- | --- | --- |
| G1 | every `src/*.mjs` parses (`node --check`) | BUILD |
| G2 | `node src/cli.mjs --help` exits 0 | BUILD |
| G3 | gold test suite passes 100% against the final repo (gold tests copied in; the specification made executable) | TEST / BEHAVIORAL |
| G4 | the arm's own `npm test` passes 100% on the final repo | TEST |
| G5 | test-suite quality: arm tests pass >= 90% against the PRISTINE implementation, and >= 2 arm tests FAIL against the broken BASE (defect-area coverage) | TEST / BEHAVIORAL |
| G6 | executable documentation: every `bash` example block in README.md and docs/api.md produces exactly its documented `text` output when run in a scratch copy of the final repo | DOCUMENTATION / BEHAVIORAL |
| G7 | documentation completeness: every function exported by `src/lib.mjs` appears in docs/api.md | DOCUMENTATION |
| G8 | repository hygiene: the arm's integration worktree is fully committed (`git status --porcelain` empty) | REPOSITORY HYGIENE |
| G9 | base integrity: every file tracked in the pinned base is still tracked in the final repo; no top-level additions outside `src/ docs/ tests/ .gitignore package.json package-lock.json README.md SPEC.md` | REPOSITORY HYGIENE |
| G10 | lineage: the pinned base commit is an ancestor of the final HEAD | INTEGRATION |

In-mission gates (what the mission's own verification loop shows workers;
identical across arms, derived from the repository itself): npm install,
npm test (the arm's own suite), all sources parse, `--help` exits 0, and
at least one test file exists under `tests/`. The deep truth gates
(G3, G5, G6) are evaluator-only — the mission can honestly report SUCCESS
by its own gates while the gold evaluation measures the real outcome.

## 6. Mission inputs (identical for all arms)

One human-level goal (no roles, no team, no benchmark framing, no
measurement vocabulary):

```text
outcome: The worklog time-tracking repository shipped from a rushed
release branch with several incorrect behaviors, stale documentation
examples, and no test suite. Restore it to a trustworthy state: fix the
behavioral bugs so the implementation matches its specification (SPEC.md
and the function contracts), correct the documentation so its examples
show the real behavior of the repaired code, and deliver a test suite
that protects the repaired behaviors. The repository must install, run
and pass its own tests.

context: The mission repository is a worklog project pinned at a fixed
release snapshot. The behavioral contract is SPEC.md plus the documented
function contracts; examples in README.md and docs/ must reflect what
the code actually does. Work in your own git worktree and commit your
work; the orchestrator owns final integration.

constraints: keep the public library API of src/lib.mjs unchanged; the
specification (SPEC.md) is the contract for correct behavior; leave the
repository clean and buildable.
```

Deterministic compilation expectation (verified in preflight, not tuned):
domain `software-engineering`; capability needs `code-execution` +
`document-authoring`; the real planner therefore staffs specialists from
the software-engineering role templates. Whatever organization Arm C's
chain produces IS the experiment's Arm C organization — recorded, not
directed.

## 7. Execution mode and budgets

- **Reasoning: DEVELOPMENT_REASONING_FALLBACK for ALL THREE ARMS.** No
  provider probe is performed (the class of unavailability is already
  evidenced historically; probing is explicitly forbidden for this task).
  Every reasoning operation is journaled and labeled:
  `reasoning_source = DEVELOPMENT_REASONING_FALLBACK`,
  `external_provider = unavailable`,
  `fallback_actor = GLM_FRESH_ISOLATED_SESSION` (declared deviation from
  the historical `GLM_PRIMARY_BUILDER` label — see CONTAMINATION-REVIEW.md
  §3: the builder session never serves; every response comes from a fresh
  stateless GLM session whose input universe is the frozen protocol + the
  request file + that instance's own journal; TASK-022A per-instance
  isolation is untouched and enforced by the same code).
- **Per-worker-instance step ceiling: 30** (precedent: Experiment 002
  calibration — 18 starved a specialist; 30 carried fix+verify+document).
- **Mission timeout: 120 minutes per arm** (fallback actor latency
  dominates wall time; disclosed; wall time is reported but interpreted
  with this caveat).
- **Per-call fallback timeout: 15 minutes.**
- **Bounded retry: one** verification retry round, identical machinery
  for all arms.
- Mission-level reasoning totals are bounded by construction (instance
  count × 30 steps + one retry round) and REPORTED; the interpretation
  penalizes disproportionate reasoning spend (see §10). No new budget
  mechanism is added (anti-bloat).
- Goal budget hint: `{ maxUsd: 6, tier: 'default' }` — identical across
  arms; inert under fallback but honestly declared.

## 8. Isolation architecture (summary — full analysis in CONTAMINATION-REVIEW.md)

- The persistent builder session (GLM Primary Builder) NEVER serves any
  fallback reasoning for any arm.
- Every `req-NNNN.json` is answered by a FRESH, STATELESS GLM session
  spawned per request. Its prompt is the frozen `serving-protocol.md`
  (hash-recorded before Arm A) plus three paths: request file, response
  file, instance journal directory. Nothing else. The protocol forbids
  reading anything outside those paths.
- Dispatch is performed by dedicated dispatcher sessions (also without
  builder knowledge) that pass paths only, never contents, and append one
  line per served request to the arm's `SERVING-LOG.txt` (evidence).
- Per-arm mission roots use NEUTRAL names (`/home/z/my-project/missions/
  mission-<stamp>-<hex>`); the source repository lives at a neutral path
  (`/home/z/my-project/target-repos/worklog`); no worker-visible path
  contains the words "benchmark", "experiment", "genesis" or an arm name.
- Between arms: the previous arm's processes are confirmed dead, the
  base repository is verified untouched (clean status, pinned SHA), and
  the next arm receives a fresh clone of the same pinned base.
- Residual risks (filesystem spelunking outside the workspace; shared
  model priors; wall-time noise) are documented and audited post-hoc
  (every worker command in the raw flight logs is scanned for
  out-of-workspace path references).

## 9. Execution order and evidence

Order: **A → B → C** (fixed). Per arm:

1. pre-launch integrity check (base SHA, no orphan processes);
2. detached launch of `run.ts --arm <X>`;
3. fresh-session serving until the arm's `EXIT-CODE` appears;
4. freeze: flight record, fallback journals (per-instance), mission
   workspace, SERVING-LOG, ARM-RESULT.json — none modified afterwards;
5. post-arm integrity check (base untouched, no orphans).

One benchmark-level manifest references the three arm records without
erasing arm-level evidence. Each arm runs ONCE. Whatever happens is
reported: single-run limitation disclosed, no reruns, no cherry-picking.
A crashed arm is recorded as that arm's failure and does not abort the
others.

## 10. Metrics and conservative interpretation

Raw metrics first (per arm): final mission status; evaluator gate
results G1–G10; gold test pass rate; arm test pass rate; wall time;
total reasoning operations (worker + handoff + reviewer); worker
reasoning calls; handoff calls; reviewer calls; planned worker count;
constructed worker instances; tool actions (worker-step events);
retries; verification attempts; human interventions (target 0 — defined
as any operator action that alters mission content or state outside the
declared harness/serving protocol; monitoring and dispatch bookkeeping
are logged separately as operator events).

Interpretation rules (conservative):

- identical quality → prefer the simpler/cheaper strategy;
- slight quality gain at dramatically higher cost → report the tradeoff,
  not a win;
- static team matches Genesis → `ADAPTIVE ORGANIZATION ADVANTAGE NOT
  DEMONSTRATED`;
- single agent wins → `CURRENT BENCHMARK FAVORS STRONG SINGLE AGENT`
  (valid and valuable);
- Genesis materially improves outcome/reliability at reasonable overhead
  → report exactly which dimensions improved; no generalization beyond
  this benchmark.

Under Development Fallback: `PROVIDER TOKEN COST = NOT VALIDATED UNDER
DEVELOPMENT FALLBACK`; `PROVIDER FINANCIAL COST = NOT VALIDATED UNDER
DEVELOPMENT FALLBACK`. No fabricated dollar costs. Fallback usage is
reported in calls and characters. Wall time is inflated by actor latency
and interpreted with that caveat.

## 11. Benchmark integrity checklist (verified before interpreting)

```text
[ ] Same goal (byte-identical mission inputs for all arms)
[ ] Same pinned repository base (SHA-verified per arm)
[ ] Same benchmark evidence (same docs/spec in the repo)
[ ] Same final acceptance gates (one frozen evaluator, arm-blind)
[ ] Same reasoning mode (DEVELOPMENT_REASONING_FALLBACK, no probes)
[ ] Cross-arm reasoning isolation (fresh sessions; audit of serving logs)
[ ] No hidden gold-answer leakage (gold outside worker-visible paths;
    post-hoc command audit for out-of-workspace references)
[ ] No manual artifact injection (execution/verification separation:
    builder holds no mission shell; all writes via the runtime)
[ ] Real execution for all arms (OpenBot computers, real git, real
    commands, clean-room verification)
[ ] Equivalent mission-level budget policy (§7)
[ ] No arm-specific post-hoc gate changes (design frozen at §5)
```

Any critical failure → `BENCHMARK VALIDITY = FAIL`; the arms are not
ranked.

## 12. Stop conditions

STOP instead of manufacturing a result if: cross-arm reasoning
isolation cannot be guaranteed; the fallback actor knows the hidden
solution; one arm receives materially different evidence; one arm uses a
different reasoning source; gates change after seeing results; the
benchmark requires architecture expansion; an external-provider outage
tempts a mixed-provider comparison; real execution cannot be preserved;
the benchmark target turns flaky or nondeterministic.

## 13. Anti-bloat scope

TASK-023 adds ONLY: this design document, the contamination review, the
frozen serving protocol, the workload (pristine tree + generator +
sealed gold), the three-arm runner, the arm-blind evaluator, the
preflight script, and one additive, default-preserving option
(`fallbackActor`) on the existing DevelopmentFallbackProvider. It reuses
MissionOrchestrator, Flight Recorder, GitWorkspace, Development Runtime,
Integration Manager, Verification Loop and the TASK-022A Development
Fallback unchanged. No benchmark platform, no experiment framework, no
metrics service, no dashboards, no provider scheduler, no new workflow
engine. `src/` is not modified.
