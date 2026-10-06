# Experiment 003 — Diagnostic Organization

- **EXECUTION MODE:** **DEVELOPMENT FALLBACK** — the external provider was unavailable (429, evidence in BLOCKED-PROVIDER.md); every reasoning call was served by the declared GLM Primary Builder fallback. Organization, tools, computers, git, integration and verification all ran for real. This run is development evidence, never provider evidence.
- **Mission:** `experiment-003-20261005T231628`
- **Status:** **SUCCESS**
- **Wall time:** 10m 51s (inflated by fallback actor latency — not work complexity)
- **Cognitive spend (separated, development fallback):** EXTERNAL PROVIDER CALLS = 0 (unavailable before launch; not probed, not retried). DEVELOPMENT FALLBACK CALLS = 25 (249,265 prompt chars + 25,921 completion chars; 0 timeout(s)). Role separation: workers 20 + reviewer 0 + handoffs 5. Token/latency/cost figures for the external provider are deliberately NOT reported — this run is not provider evidence.
- **Human interventions:** 0 — the mission loop ran unattended; the declared fallback actor answered reasoning calls ONLY through the file journal (request → response), with no access to the orchestrator, workspaces, git or verification.
- **Target:** `https://github.com/mayakilzy/genesis-gold-tasks` @ `c9106df8a6fc` — same pinned repository as Experiment 002; the flaky-orders diagnostic case. Disclosed ground truth (gold task): the seeded defect is the non-atomic read-check-write in `InventoryService.reserve`, observable as an intermittent oversell (~80% failing runs at the pinned commit).

## The goal (given, not a team)

> Diagnose the intermittent failure of the flaky-orders order system (the flaky-orders directory of the mission workspace). CI reports its suite failing on the same commit in about 80% of runs, with the failing assertion varying across runs; the reported symptom is an oversell — more orders accepted than available stock. Inspect the provided evidence bundle, reproduce the fault, and deliver the diagnosis as flaky-orders/DIAGNOSIS.md.

## The organization Genesis designed

Designed by the pipeline from the goal alone — GoalCompiler → OrganizationPlanner → GenomeCompiler. No roles were prescribed by the experiment; the goal names no workers.

Rationale: Scope "standard" in domain "diagnostic" with 3 capability needs. Planned 3 specialist role(s): Reproduction Engineer [code-execution], Report Writer [document-authoring], Diagnostic Analyst [data-analysis]. Mission Coordinator added because 3+ specialists require integration.

| Worker | Role | Capability needs |
| --- | --- | --- |
| `mission-coordinator-1` | Mission Coordinator | — |
| `reproduction-engineer-1` | Reproduction Engineer | code-execution |
| `report-writer-2` | Report Writer | document-authoring |
| `diagnostic-analyst-3` | Diagnostic Analyst | data-analysis |

## Organization comparison — Experiment 002 vs Experiment 003 (computed from flight records)

```
EXP002 WORKERS = mission-coordinator-1 (Mission Coordinator), software-engineer-1 (Software Engineer), documentation-writer-2 (Documentation Writer), verification-engineer-3 (Verification Engineer)
EXP003 WORKERS = mission-coordinator-1 (Mission Coordinator), reproduction-engineer-1 (Reproduction Engineer), report-writer-2 (Report Writer), diagnostic-analyst-3 (Diagnostic Analyst)
EXP002 CAPABILITY NEEDS = browser-verification, code-execution, document-authoring
EXP003 CAPABILITY NEEDS = code-execution, data-analysis, document-authoring
ORGANIZATION STRUCTURALLY DIFFERENT = YES
WHY = EXP002 (domain software-engineering) required [browser-verification, code-execution, document-authoring] and staffed Software Engineer, Documentation Writer, Verification Engineer. EXP003 (domain diagnostic) required [code-execution, data-analysis, document-authoring] and staffed Reproduction Engineer, Report Writer, Diagnostic Analyst. Capability needs differ: [data-analysis] appear only in EXP003; [browser-verification] only in EXP002; shared: [code-execution, document-authoring]. No specialist role is shared between the two organizations. Plan sizes: EXP002 4 workers, EXP003 4 workers — the comparison is about composition driven by the goal, not headcount.
```

## Genomes (cognitive and tool grants)

| Worker | Tier | Grants |
| --- | --- | --- |
| `mission-coordinator-1` | default | — |
| `reproduction-engineer-1` | cheap | openbot:shell-execution, openbot:workspace-files |
| `report-writer-2` | default | openbot:workspace-files |
| `diagnostic-analyst-3` | cheap | openbot:shell-execution |

## The repository work (from the flight record)

- **workspace-prepared**: cloned https://github.com/mayakilzy/genesis-gold-tasks @ c9106df8a6fcad5c45fddd7698a5ac635a4badae; 3 specialist worktree(s) on genesis/* branches (files: worktree:reproduction-engineer-1, worktree:report-writer-2, worktree:diagnostic-analyst-3)
- **worktree-committed**: 0 file(s) committed (files: .npm/)
- **worktree-committed**: 1 file(s) committed (files: flaky-orders/DIAGNOSIS.md)
- **integrated**: merged reproduction-engineer-1 → report-writer-2 → diagnostic-analyst-3 onto genesis/integration; overlapping edits on flaky-orders/repro.mjs merged cleanly (files: flaky-orders/repro.mjs)

## The workers

### reproduction-engineer-1

- **Status:** success (6 steps, 7 reasoning calls)
- **Summary:** Reproduced the flaky-orders oversell deterministically. Evidence inspected: metrics.md (12/15 runs FAIL ~80%, three different assertions failing across runs), incident-logs.txt (failing runs accept 9-11 orders against stock 8). Ran the unmodified suite 6 times myself: 5 FAIL / 1 PASS, matching the reported rate. Source reading shows InventoryService.reserve performs a read (lookup) then an awaited latency sleep then the write, with no serialization between concurrent reservations. Committed flaky-orders/repro.mjs: pins the simulated latencies (Math.random) so all 12 concurrent reservations read the same stock level before any write lands — prints 'RACE REPRODUCED: 12 orders accepted against stock 8 (oversell 4)' and exits 0; verified deterministic across 5 consecutive runs (identical output every time). The source was not modified. Key observation for the diagnosis: when the interleaving hits, EVERY in-flight reservation that read stock>=1 accepts, so accepted can reach the full batch size (12), final stock stays above 0, and rejected shrinks — explaining why any of the three assertions can be the one to fail first in a given run.

### report-writer-2

- **Status:** success (6 steps, 7 reasoning calls)
- **Summary:** Delivered flaky-orders/DIAGNOSIS.md — a structured, evidence-anchored diagnosis of the intermittent oversell. The report keeps OBSERVED facts separate from INFERRED conclusions: observations cite the evidence bundle directly (metrics.md: 12/15 runs failing ~80%, three different assertions; incident-logs.txt: 9/10/11 accepted against stock 8), the source as read (the unsynchronized read-check-write in InventoryService.reserve), and the colleague-verified deterministic reproduction (flaky-orders/repro.mjs, commit 1889359: 12 accepted against stock 8 under pinned latencies, plus the exact sequential control). Competing HYPOTHESIS candidates (non-atomic reserve; test-harness timing artifact; stock accounting error) are stated with the evidence that distinguishes them. Explicit UNKNOWN items cover what the evidence does not establish: staging behavior (no staging telemetry in the bundle), per-run interleavings, production datastore semantics, and real arrival patterns. RECOMMENDED CHECK items are concrete (run the committed repro on suspect environments, capture staging reserve-path telemetry, instrument in-flight overlaps, review compare-and-decrement semantics). Root-cause confidence: high for the mechanism within the supplied evidence; explicitly not established for staging/production. Note: I hold file tools only (no shell), so the file is written in my worktree; per the mission's repository protocol the orchestrator's integration step commits it.

### diagnostic-analyst-3

- **Status:** success (4 steps, 5 reasoning calls)
- **Summary:** Completed the diagnostic analysis and committed it as flaky-orders/ANALYSIS.md (branch genesis/diagnostic-analyst-3, commit ff76fe2). Own hands-on work beyond the evidence bundle: (a) a 10-run sample of the exact test scenario on the unmodified source — accepted ranged 8-11, rejected always 12-accepted, final stock 0 in this sample; (b) an instrumented interleaving (scripted Math.random draws + a read-logging subclass; zero source modifications) demonstrating that a long-delayed stale write lands AFTER a fresher write and restores a HIGHER stock value (6 back to 7) — proving the final stock equals the last write's stale read minus quantity, not any function of the acceptance count, which explains the final-stock>0 failure mode recorded in the incident logs; (c) verified the committed deterministic reproduction (merged from the Reproduction Engineer, 12 accepted against stock 8, identical every run) and the exact sequential control (3 of 5 against stock 3). Root cause: the unsynchronized read-check-write in InventoryService.reserve — concurrent same-level readers all accept, and out-of-order stale writes corrupt the stock field in both directions (oversell and stranded stock). Confidence high for the mechanism within the supplied evidence; staging/production impact explicitly unknown (no telemetry in the bundle).

### mission-coordinator-1

- **Status:** success (0 steps, 1 reasoning calls)
- **Summary:** Mission integrated. The flaky-orders intermittent oversell is diagnosed with high confidence (within the supplied evidence): the root cause is the unsynchronized read-check-write sequence in InventoryService.reserve — concurrent reservations that read the same stock level before any write lands all accept, and stale out-of-order writes corrupt the stock field in both directions (oversell, and stranded stock where the last write's stale read wins). Deliverables: flaky-orders/DIAGNOSIS.md (the structured report: OBSERVED / INFERRED / HYPOTHESIS / UNKNOWN / RECOMMENDED CHECK, with a stated confidence level and explicit unknowns — staging impact not established, no telemetry in the bundle), flaky-orders/repro.mjs (deterministic reproduction on the unmodified source: RACE REPRODUCED, 12 accepted against stock 8, exit 0, identical every run), and flaky-orders/ANALYSIS.md (the analyst's working analysis with hands-on probes: a 10-run distribution, a sequential control, and an instrumented interleaving proving a stale write can restore a higher stock value after a fresher one). All three assertions in the failing suite are explained as one race seen from three angles, matching the varying failing assertion across runs and the ~80% failure rate. The source under diagnosis was not modified anywhere. Nothing failed; the one limitation to carry forward is epistemic, not operational: staging/production behavior remains explicitly unknown pending telemetry.

## Verification (clean room: committed state only, diagnosis-quality gates)

Engineering gates are off by design: the repository’s own test suite is the symptom under diagnosis (it fails intermittently on the pinned commit). The gates decide on the diagnosis’s structure, its epistemic honesty (OBSERVED/INFERRED/UNKNOWN/HYPOTHESIS/RECOMMENDED CHECK, evidence-cited observations, no unhedged certainty about environments the evidence does not cover), its correctness against the disclosed ground truth, a deterministic reproduction, the objective presence of the race in the integrated state, and that the source under diagnosis was not modified. Deterministic wherever practical; the LLM reviewer engages only on failure.

- **Pass 1:** ALL PASSED — 8 passed, 0 failed

## The integrated result (what the gates actually ran against)

```diff
flaky-orders/ANALYSIS.md  | 73 ++++++++++++++++++++++++++++++++++++
 flaky-orders/DIAGNOSIS.md | 95 +++++++++++++++++++++++++++++++++++++++++++++++
 flaky-orders/repro.mjs    | 36 ++++++++++++++++++
 3 files changed, 204 insertions(+)
```

Integration branch commits beyond the pinned base:

```
08dacc0 Merge branch 'genesis/diagnostic-analyst-3' into genesis/integration
b826fbc Merge branch 'genesis/report-writer-2' into genesis/integration
a6ac42c work of report-writer-2 (verification attempt 1) (genesis/report-writer-2)
ff76fe2 diagnosis: analyst working analysis with hands-on probes
1889359 diagnosis: deterministic reproduction of the intermittent oversell (repro.mjs)
```

## Mission summary (as integrated)

Mission integrated. The flaky-orders intermittent oversell is diagnosed with high confidence (within the supplied evidence): the root cause is the unsynchronized read-check-write sequence in InventoryService.reserve — concurrent reservations that read the same stock level before any write lands all accept, and stale out-of-order writes corrupt the stock field in both directions (oversell, and stranded stock where the last write's stale read wins). Deliverables: flaky-orders/DIAGNOSIS.md (the structured report: OBSERVED / INFERRED / HYPOTHESIS / UNKNOWN / RECOMMENDED CHECK, with a stated confidence level and explicit unknowns — staging impact not established, no telemetry in the bundle), flaky-orders/repro.mjs (deterministic reproduction on the unmodified source: RACE REPRODUCED, 12 accepted against stock 8, exit 0, identical every run), and flaky-orders/ANALYSIS.md (the analyst's working analysis with hands-on probes: a 10-run distribution, a sequential control, and an instrumented interleaving proving a stale write can restore a higher stock value after a fresher one). All three assertions in the failing suite are explained as one race seen from three angles, matching the varying failing assertion across runs and the ~80% failure rate. The source under diagnosis was not modified anywhere. Nothing failed; the one limitation to carry forward is epistemic, not operational: staging/production behavior remains explicitly unknown pending telemetry.

---

## Addendum — 2026-10-06 (TASK-022A, post-review correction; nothing above this line is rewritten)

The independent review of this experiment (frozen scope: commit
`6621a28cf437942de910ed97fa2fc20a78730c95`, mission
`experiment-003-20261005T231628`) established that one process property did
NOT hold in this run:

**PER-WORKER-INSTANCE FALLBACK EPISTEMIC ISOLATION = FAIL.**

The single persistent Development Fallback reasoning actor was reused across
logically isolated worker instances inside this mission — one shared file
journal served every instance — so the actor answering one instance could
draw on knowledge supplied only to another. Contaminated responses:
`11, 12, 15, 21, 22, 23`; response `24` is classified QUESTIONABLE.

Historical isolation claim invalidated by independent review: strict
per-instance epistemic isolation did not hold in this run. The mission
outcome and the organization-emergence, real-execution, artifact-correctness,
clean-room-verification and reasoning/execution-separation evidence remain
valid. Fixed prospectively by TASK-022A (per-instance fallback contexts:
one journal directory per logical worker instance).

The final historical classification of Experiment 003 is therefore:

**PASS WITH PROCESS CONTAMINATION**

Everything above this addendum is the original report of 2026-10-05, unchanged.
The flight record, the 25 historical journal request/response pairs and all
frozen evidence are preserved unmodified; Experiment 003 was not rerun.
