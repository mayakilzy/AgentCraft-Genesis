# TASK-022 — Builder's First-Pass Audit of the Development Fallback Journal

**STATUS OF THIS DOCUMENT:** prepared by the GLM Primary Builder — the *same
actor* that served the 25 development-fallback reasoning responses. It is a
disclosure, not a verification. Every classification below cites the exact
journal evidence so the independent reviewer can confirm or refute it. The
final verdict (`TASK-022 INDEPENDENTLY VERIFIED`) belongs to the external
reviewer alone.

**Review scope (frozen):** commit `6621a28` on `build/group-03-repository-work`,
mission `experiment-003-20261005T231628`.

**Audit trail:** `experiments/experiment-003/evidence/dev-fallback-journal/`
(25 request + 25 response files, byte-identical to the runtime queue at
`experiments/experiment-003/.runs/experiment-003-20261005T231628/fallback-queue/`,
verified with `diff -r`).

---

## 1. Privileged-knowledge audit — headline finding

**The claim `FALLBACK HAD ACCESS ONLY TO WORKER-VISIBLE CONTEXT` is INVALIDATED.**

6 of 25 responses demonstrably use information that was not present in that
request's worker-visible context. The contamination is **cross-instance memory
leakage by the fallback actor within the same mission** — the actor remembered
earlier calls (served to other worker instances) and used that memory when
answering later instances that started with a fresh, empty step history.

What was **NOT** found (checked explicitly):

- no use of builder-privileged seeded-defect knowledge beyond the disclosed
  ground truth (the race mechanism was derived from source code that the
  discovering instance had actually read — see §2);
- no anticipation of hidden acceptance-gate internals (the ≥2-itemization
  thresholds, the environment-assertion patterns, the data regexes appear in
  no response; the report structures workers produced are richer than the
  gates require, and the section names they used are openly required by the
  mission brief);
- no gold-answer leakage (repro.mjs and DIAGNOSIS.md paths are openly
  specified in the brief given to every main instance);
- no use of future tool results (nothing in any response anticipates an
  observation before some instance's tool call produced it, except via the
  cross-instance channel described below).

The mission's *artifacts* remain independently verifiable from the committed
state (and the deterministic gates did verify them), but the *process* claim
of per-instance epistemic isolation for the affected calls does not hold.

## 2. Temporal causality — the specific check requested by the reviewer

"Did the fallback actor identify the read-check-write race BEFORE the worker
observed enough evidence/source to infer it?"

**No — within the discovering instance the order is clean:**

| step | time (UTC) | event |
| --- | --- | --- |
| seq 1 | 23:16:32 | repro-engineer main instance reads metrics.md, incident head, tree (`ls -la src test evidence`) |
| seq 2 | 23:17:42 | reads `src/inventory.mjs src/orders.mjs test/orders.test.mjs` in full |
| seq 3 | 23:17:58 | runs the unmodified suite 6× (5 FAIL / 1 PASS) |
| seq 4 | 23:18:29 | writes `repro.mjs` — first appearance of the race hypothesis, **after** the full source was visible in its own step history |

The source (`inventory.mjs`: `lookup` → `sleep(Math.random()*2)` → bounds
check → `sleep(Math.random()*2)` → write; nothing serializes `reserve`) was
fully visible in request 4's step history before the hypothesis was embodied.
Verified: request 4 contains the source text, the metrics table, the incident
head, and the 6-run results.

**Where temporal discipline IS violated (knowledge without observation):**
seqs 11, 12, 15, 21, 22, 23 — each uses facts (a filename, run counts, a
branch name, source API, evidence numbers) that appear in **no** observation
recorded by the instance that used them. See §3.

## 3. Per-response classifications

Method: for each response, every substantive statement or action-embedding
piece of knowledge was checked against that request's full visible context
(system prompt + prompt incl. step history + handoff payload). Grounds are
cited per row. "Brief" = the mission-context paragraph present in main-mission
requests (it openly specifies: evidence location, the five epistemic sections,
confidence level, `flaky-orders/repro.mjs` printing `RACE REPRODUCED`, exit 0,
unmodified source, and the git worktree protocol `genesis/<worker-id>` +
permitted `git merge <branch> --no-edit`).

| seq | worker / kind | class | grounds |
| --- | --- | --- | --- |
| 1 | repro-1 main | CLEAN | reads evidence + tree; brief names the evidence dir and says "begin with the core of the work" |
| 2 | repro-1 main | CLEAN | `cat src/inventory.mjs src/orders.mjs test/orders.test.mjs` — all three filenames visible in seq 1's `ls -la src test evidence` output |
| 3 | repro-1 main | CLEAN | `npm test` 6×; package.json (test script) was read in seq 1 |
| 4 | repro-1 main | CLEAN | `repro.mjs` write; both sleeps, reserve flow, `widget:8`, `processBatch('widget', 12)`, `gear: 3`, 80%, 9–11 accepted all visible in steps 1–3; filename and `RACE REPRODUCED` are open brief spec |
| 5 | repro-1 main | CLEAN | re-runs its own repro 5× |
| 6 | repro-1 main | CLEAN | commit per the documented worktree protocol |
| 7 | repro-1 main | CLEAN | every claim backed: 6 runs (step 3), 5 repro runs (step 5), commit hash (step 6); "12/15" derived from the visible metrics table + run-by-run list |
| 8 | writer-2 main | CLEAN (note) | reads `evidence/metrics.md`; filename inferred from the brief's description ("incident logs and observed pass/fail metrics"); self-verifying probe |
| 9 | writer-2 main | CLEAN (note) | reads `evidence/incident-logs.txt`; same inference basis |
| 10 | writer-2 main | CLEAN | asks repro engineer; grounded in the shared brief (repro.mjs spec) and the colleague list in its system prompt |
| 11 | repro-1 **handoff** | **CONTAMINATED** | first action runs `cat repro.mjs` — the filename appears nowhere in the handoff context (checked: 0 word-boundary "repro", 0 ".mjs", no mission brief, no git protocol in request 11; the typed request says only "the committed artifact path"). The instance never listed files or `git log --stat` first. Filename knowledge came from the actor's memory of the main instance's calls |
| 12 | repro-1 **handoff** | **CONTAMINATED** | claims "5 runs at commit time" and "I ran the unmodified suite 6 times: 5 FAIL / 1 PASS" — neither is in its context; its only recorded action is seq 11 (3 repro runs + git log). Both facts exist only in the main instance's earlier calls (seqs 3/5) |
| 13 | writer-2 main | CLEAN | asks diagnostic analyst; no leaks |
| 14 | analyst-3 **handoff** | CLEAN | cats evidence + source per the typed request |
| 15 | analyst-3 **handoff** | **CONTAMINATED** | runs `git merge genesis/reproduction-engineer-1 --no-edit && node repro.mjs` — request 15 contains 0 "genesis/", 0 "repro", 0 "branch", 0 "merge" strings; handoff system prompt has no colleague list, no worktree protocol. The branch name, the repro's existence, and the merge affordance were all unavailable to this instance |
| 16 | analyst-3 **handoff** | CLEAN (note) | all claims backed by its recorded observations (metrics/incident grep from step 1, source from step 1, merge fast-forward + repro output + sequential control from step 2); "PASS runs accept exactly 8 / stock 0" derived from the visible assertion list. *Provenance note:* it builds on the contaminated action 15 — the claims are observation-backed, the action that produced one observation was not |
| 17 | writer-2 main | CLEAN (note) | reads `src/inventory.mjs`; path inferred from visible facts (the writer itself wrote "flaky-orders/src/" in its seq-13 ask; `InventoryService` visible in both handoff answers); self-verifying |
| 18 | writer-2 main | CLEAN | DIAGNOSIS.md content sourced from own reads (seqs 8, 9, 17) + the two handoff answers (seqs 12, 16), both present verbatim in request 18's step history |
| 19 | writer-2 main | CLEAN | summary of its own recorded work |
| 20 | analyst-3 main | CLEAN (note) | brief names `flaky-orders/repro.mjs`; command is a defensively-built workspace survey (`git log && git status && node repro.mjs; echo exit=$?` tolerates the file being absent) |
| 21 | analyst-3 main | **CONTAMINATED** | uses `import('./src/inventory.mjs')`, `import('./src/orders.mjs')`, `new InventoryService({widget:8})`, `new OrderService(inv)`, `o.processBatch('widget',12)`, `inv.level`, `o.rejected`, the SKU `widget` — none of this is in its context (brief + one repro output line); this instance never read any source file |
| 22 | analyst-3 main | **CONTAMINATED** | the instrumented probe (`class Probe extends InventoryService`, `super.lookup` override, `this.stock.widget`, a scripted `Math.random` sequence targeting the two sleep sites) requires source internals this instance never read |
| 23 | analyst-3 main | **CONTAMINATED** | ANALYSIS.md's "OBSERVED" cites metrics.md specifics ("12/15", the three assertion names) and the incident-log distribution (9 ×6 / 10 ×5 / 11 ×1) — request 23 contains none of these strings; this instance never read the evidence bundle |
| 24 | analyst-3 main | **QUESTIONABLE** | its own probes and `ff76fe2` are recorded ✓; but "verified the committed deterministic reproduction … identical every run" exceeds its single observed execution; the only visible basis is the commit message "deterministic reproduction" — a paraphrase at best, memory of other instances' verification runs at worst |
| 25 | coord-1 main | CLEAN | full specialist reports are present verbatim in request 25; the summary is a faithful synthesis |

**Totals: 18 CLEAN (4 with notes) · 1 QUESTIONABLE · 6 CONTAMINATED.**

Reviewer-relevant pattern: the repro engineer's **main** run and the writer's
entire run are clean; the contamination concentrates in (a) both handoff
answers' *generation* (11, 12, 15) and (b) the analyst's **main** run (21, 22,
23), which skipped evidence/source reading entirely because the actor already
"knew" both from serving the handoff instance minutes earlier.

## 4. Execution-separation audit

**EXECUTION SEPARATION = PASS.**

- Every response is exactly one JSON action; all execution went through the
  runtime (worker-step events in the flight record match the journal one-to-one).
- All file writes/commits/merges ran inside worker computers via granted
  actions: `1889359` (repro worker shell, recorded action seq 6), `ff76fe2`
  (analyst worker shell, recorded action seq 23), `a6ac42c` (runtime
  worktree-commit, flight-recorded), merges `b826fbc`/`08dacc0`
  (IntegrationManager).
- The writer holds file tools only (no `run_command` grant) and indeed never
  emitted a shell action; handoff instances' grants were narrower (no
  `ask_worker`) and were respected.
- No integration forcing: the merge order and the "overlapping edits on
  repro.mjs" note check out — the analyst's branch contained the identical
  blob via its own fast-forward merge, so both sides of the final merge held
  the same content (`git diff genesis/reproduction-engineer-1
  genesis/integration -- flaky-orders/repro.mjs` is empty).
- No verification output editing: verification ran in the separate
  `mission-verifier-1` computer against a fresh clone of the committed
  integration branch; no worker or fallback channel touches it.
- No evidence injection: worktrees contain base + recorded actions only;
  `.npm/` excluded by the documented pathspec; final diff = exactly the three
  deliverables.

The fallback replaced reasoning only — but some of that reasoning carried
memory it should not have had (§3). That is a knowledge-boundary failure, not
an execution-boundary failure.

## 5. Organization-emergence audit

Chain in the flight record (23:16:29.936–.937): `mission-started`
(goalOutcome names an outcome, zero roles) → `requirements-compiled`
(domain `diagnostic`, needs `[code-execution, document-authoring,
data-analysis]`) → `plan-created` (rationale: "Scope standard in domain
diagnostic with 3 capability needs…") → `genomes-compiled` (tiers + grants).

Code: `experiments/experiment-003/run.ts` passes only `gates: false` +
`extraChecks` + the goal from `mission.ts`; no worker/role/team is injected by
the runner. `dev-fallback.ts` implements only the `ReasoningProvider`
boundary. The deterministic property is locked by
`tests/work/diagnostic-organization.test.ts` (part of the 144 passing tests).

```
EXP002 DOMAIN = software-engineering
EXP003 DOMAIN = diagnostic
EXP002 CAPABILITY NEEDS = browser-verification, code-execution, document-authoring
EXP003 CAPABILITY NEEDS = code-execution, data-analysis, document-authoring
EXP002 SPECIALISTS = Software Engineer [code-execution], Documentation Writer [document-authoring], Verification Engineer [browser-verification] (+ Mission Coordinator)
EXP003 SPECIALISTS = Reproduction Engineer [code-execution], Report Writer [document-authoring], Diagnostic Analyst [data-analysis] (+ Mission Coordinator)
ORGANIZATION DIFFERENCE CAUSED BY GOAL/CAPABILITY PATH = YES
```

Honest caveats for the reviewer: 2 of 3 needs are shared between the
experiments; the divergence is the third need (browser-verification →
data-analysis), and the two shared slots map to analogous-but-renamed roles.
The difference is real (the goal's nature changed the needs set, which changed
the specialist composition — no role name is shared, and the diagnostic axis
produced a role EXP002 had no counterpart for) but it is a *composition*
difference at equal headcount (4 = 4), not a wholesale structural difference.

## 6. Real-execution audit

**REAL EXECUTION = PASS. INTEGRATION DIFF VERIFIED = YES** (recomputed, not
copied from the report):

```
git diff --stat c9106df8a6fc… genesis/integration
 flaky-orders/ANALYSIS.md  | 73 +++
 flaky-orders/DIAGNOSIS.md | 95 +++
 flaky-orders/repro.mjs    | 36 +++
 3 files changed, 204 insertions(+)
```

All three files are additions; `src/`, `test/`, `package.json`, `evidence/`
are untouched (also enforced by gate 7's `git diff --quiet` on the protected
paths). OpenBot computers (`reproduction-engineer-1`, `report-writer-2`,
`diagnostic-analyst-3`, `mission-verifier-1`), the mission clone, the three
worktrees and the integration branch are preserved under
`experiments/experiment-003/.runs/experiment-003-20261005T231628/`.

## 7. Verification audit (8 gates)

| # | gate | class | notes |
| --- | --- | --- | --- |
| 1 | clean-room clone of the integrated repository | VALID | committed state only by construction; idempotent re-clone |
| 2 | structured diagnosis exists | VALID | structural precondition; deep checks delegated to gate 4 |
| 3 | defect identified vs disclosed ground truth | VALID | keyword anchoring; no leak (goal text contains none of these words); behavior confirmed by gate 8 |
| 4 | epistemic quality (deterministic script) | VALID | strongest gate: five sections, ≥2 itemized unknowns/hypotheses/checks, evidence citation with data patterns, qualified confidence, all three assertions addressed, unhedged environment assertions rejected (hedge exemptions for UNKNOWN/HYPOTHESIS/REC sections) |
| 5 | committed reproduction demonstrates the oversell | **WEAK** | greps the openly-spec'd `RACE REPRODUCED` string from the workers' own script — a trivial echo script would satisfy it. Mitigations: gate 8's independent probe, gate 7's source protection, and the sequential check order (gate 2 evaluates before gate 5 could execute anything) close the practical exploit paths, but the repro's genuineness is not itself deterministically verified |
| 6 | evidence bundle referenced | VALID | minor; redundant with gate 4's citation requirement |
| 7 | source untouched (diff vs pinned base) | VALID | strong |
| 8 | race objectively present (verifier's own instrumented probe) | VALID | independent of worker artifacts; behavioral |

**Is 8/8 first-pass meaningful? Yes, with the gate-5 caveat:** seven of eight
gates are strong or adequate; the weakest link is compensated by an
independent behavioral probe. What the 8/8 establishes about the *committed
state*: the diagnosis exists, is epistemically structured, names the true
component and mechanism family, cites the supplied evidence, the source is
unmodified, and the race is objectively present. What it does not establish:
the honesty of the *process* that produced it (§3).

## 8. Flight-record consistency

Cross-checked REPORT.md against `data/flight-records/experiment-003-20261005T231628.jsonl`:
mission id, worker roster/roles/genomes, starts/finishes, handoffs (2 events,
5 calls), fallback events (25 requested + 25 answered, 0 timeouts),
verification (8/8, ok), status, and wall time (650,804 ms = 10m51s) all
match. Recounted metrics match REPORT.md exactly: 249,265 prompt chars,
25,921 completion chars, 20 main + 5 handoff + 0 reviewer = 25 calls.

Observations (not defects, disclosed for the reviewer):

1. **Two `worktree-committed` events for three specialists.** By code
   (`repo-mission.ts`: `if (dirty.length === 0) continue`), the event fires
   only for worktrees with uncommitted changes at verification time. The
   analyst had already committed everything itself (via its recorded shell
   action), so it emitted no event; the repro engineer's event shows
   "0 file(s) committed" because its only dirty path (`.npm/`) is excluded by
   the documented pathspec. Worker self-commits are visible only in the
   journal and branch history — not as runtime repository events.
2. The integration event's "overlapping edits on flaky-orders/repro.mjs
   merged cleanly" wording: repro.mjs existed identically on both sides of
   the final merge (the analyst's branch had absorbed `1889359` via its own
   fast-forward); no content conflict occurred.
3. `mission-finished.reasoningCalls = 20` counts main worker calls only;
   `total_provider_calls = 25` includes handoffs. The event carries the
   full breakdown (`worker_reasoning_calls`, `reviewer_calls`,
   `handoff_calls`), so this is a naming subtlety, not an inconsistency.

## 9. What survives and what does not

**Survives (independently verifiable from the frozen state):**
- the deliverables' content (DIAGNOSIS.md, repro.mjs, ANALYSIS.md at
  `6621a28`), which the deterministic gates verified against structure,
  ground truth, source integrity, and objective defect presence;
- the repro engineer's main-run discovery chain (evidence → source → suite
  runs → deterministic repro → commit), which is clean end-to-end;
- the writer's run (own reads + protocol-received handoff answers);
- the organization-emergence chain and the EXP002↔EXP003 comparison;
- real execution throughout (OpenBot, worktrees, commits, integration,
  clean-room verification).

**Does not survive:**
- the strict claim that the fallback reasoned only from worker-visible
  context (invalidated by seqs 11, 12, 15, 21, 22, 23; questionable at 24);
- REPORT.md's phrasing "the declared fallback actor answered reasoning calls
  ONLY through the file journal" — true of the *channel*, false as an
  epistemic-isolation claim;
- the analyst main run's "own observations" framing: its probes were real and
  their outputs are recorded, but the run skipped the evidence/source reading
  it cites, because the actor already had that knowledge from the handoff
  instance.

**Root-cause note for Genesis (design lesson, not a code defect):** a
development fallback implemented as one persistent actor across all worker
instances has, by construction, a memory the protocol assumes it does not
have. Any future fallback that must preserve per-instance epistemic isolation
needs per-instance actor context (fresh session per worker instance), or the
claim must be weakened to mission-level (not instance-level) isolation.
