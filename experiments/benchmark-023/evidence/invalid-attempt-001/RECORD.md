# TASK-023 — Invalid Attempt 001 — Immutable Record

Written by TASK-023A (benchmark integrity recovery), 2026-10-06, under the
supervisor's stop order. This record classifies and preserves the
interrupted TASK-023 execution. It is evidence of a real benchmark-design
failure and must never be deleted or edited; corrections are appended in
new dated sections only.

```text
reason = BUILDER_FALLBACK_KNOWLEDGE_CONTAMINATION

TASK-023 ATTEMPT 1 = INVALID — BUILDER/FALLBACK KNOWLEDGE CONTAMINATION
BENCHMARK VALIDITY = FAIL
GOLD ANSWER LEAKAGE = DETECTED BEFORE ARM EXECUTION
ARM A RESULT = INVALID / NOT SCOREABLE
ARM B = NOT STARTED
ARM C = NOT STARTED
```

No arm is ranked. Neither Arm A attempt is benchmark evidence. The
interrupted Arm A is NOT a Genesis failure, NOT an Arm A failure, and NOT
a Development Fallback worker-instance isolation failure (TASK-022A
remains PASS, its boundary remains accepted). The benchmark was invalid
before execution began.

## 1. Root cause

The same GLM session, in sequence:

1. designed the benchmark workload;
2. wrote the pristine implementation;
3. debugged that implementation;
4. observed its correct behavior;
5. wrote the hidden gold tests;
6. corrected gold-test expectations;
7. created the deterministic broken-base transformation;
8. observed which gold tests each defect flips;
9. then served Arm A reasoning as `DEVELOPMENT_REASONING_FALLBACK`.

The fallback actor therefore already possessed privileged knowledge of
the hidden solution before Arm A began. This violates the benchmark's
own Step-2 hard gate ("the Development Fallback reasoning actor must
not know the hidden benchmark solution"). The correct Step-2 verdict was
`BENCHMARK DESIGN CONTAMINATED` and execution should have stopped there.
`CONTAMINATION-REVIEW.md` (frozen at `5eb6abc`) asserted that "the
persistent builder session serves NOTHING" and that every response would
come from a fresh stateless GLM session. In this environment no such
fresh-session mechanism exists: when the dispatcher approach failed
(attempt 1), serving fell back to the operator session itself — the
builder. The label `GLM_FRESH_ISOLATED_SESSION` was therefore false for
attempt 2, and the review's verdict is INVALIDATED (see the notice
prepended to that file).

This is a BENCHMARK-LEVEL epistemic boundary failure, distinct from the
TASK-022A worker-instance boundary:

```text
BENCHMARK BUILDER
      ↓ privileged gold knowledge
FALLBACK ACTOR                     (this failure)
```

## 2. Timeline (all times 2026-10-06 UTC)

| Time | Event |
| --- | --- |
| 01:43:01 | benchmark design frozen at commit `5eb6abc` (preflight recorded PASS) |
| 01:41 | serving smoke test performed (synthetic request; `.serving-smoke/`) |
| 01:43:58 | Arm A attempt 1 mission started: `mission-20261006T014358-e8c2f2` |
| 02:14:01 | attempt 1 worker started; fallback request seq 1 filed |
| 02:14:25 | attempt 1 SERVING-LOG: `FAILURE req-0001.json` — dispatcher-spawned server sessions never wrote responses; zero responses ever served in attempt 1 |
| ~02:16 | attempt 1 aborted, preserved as `aborted-serving-harness-attempt-*`; operator log records the switch to "direct per-request dispatch from the operator session" |
| 02:16:53 | Arm A attempt 2 mission started: `mission-20261006T021653-12073e` |
| 02:30:59–03:10:17 | 7 reasoning requests served (builder session as the actor) under the false `GLM_FRESH_ISOLATED_SESSION` label |
| ~03:24 | request 8 timed out after the 900 s journal limit; mission verification failed |
| 03:24:57 | integration branch merged (empty) |
| 03:24:59 | mission-level reviewer request filed (verification-retry diagnosis) |
| 03:39:59 | reviewer request timed out; retry instance `principal-engineer-1#2` filed its first reasoning request |
| 03:41:35 | TASK-023A authority terminated the runner (`kill -9` PID 25107, `bun experiments/benchmark-023/run.ts --arm A`) and four orphaned OpenBot agent-computer processes (PIDs 24405, 24772, 25126, 26738) per the supervisor's stop order |

No `ARM-RESULT.json` / `EXIT-CODE` exists for either attempt (attempt 2's
runner was killed before its evidence-freeze block ran). That absence is
itself recorded here as part of the evidence.

## 3. What is preserved, and where

Physical archive (moved, never modified; outside the Genesis repo to
avoid bloat): `/home/z/my-project/benchmark-evidence/invalid-attempt-001/`

- `attempt-1-mission-20261006T014358-e8c2f2/` — aborted mission root:
  SERVING-LOG (dispatcher failure), fallback queue (3 unanswered
  requests), verifier computer workspace, mission origin/worktrees.
- `attempt-2-mission-20261006T021653-12073e/` — interrupted mission
  root: SERVING-LOG (7 served + timeouts), fallback queues
  (`instance-principal-engineer-1-1`: 7 done pairs + pending req-0008;
  `instance-principal-engineer-1-2`: pending req-0001; mission-level
  pending req-0001), verifier computer workspace, mission
  origin/worktrees/integration.
- `serving-operator-context/` — the operator log narrating the
  dispatcher failure and the switch to operator-session dispatch, plus
  the neutral-path protocol copy used for serving.
- `serving-smoke/` — the prefreeze smoke-test journal (synthetic
  request/response).
- `arm-A-operator-log.log` — arm launch log (both attempts).

In-repo evidence (this directory,
`experiments/benchmark-023/evidence/invalid-attempt-001/`):

- `flight-record-attempt-1.jsonl` (16 events) — moved from
  `data/flight-records/mission-20261006T014358-e8c2f2.jsonl`.
- `flight-record-attempt-2.jsonl` (32 events) — moved from
  `data/flight-records/mission-20261006T021653-12073e.jsonl`.
- `MANIFEST.md` — SHA-256 of all 331 preserved files (632,271 bytes).

## 4. Restart policy for Arm A (supervisor's Step 12)

The interrupted attempts are permanently invalid. When TASK-023 resumes
with a genuinely independent reasoning actor, Arm A starts from scratch
from the frozen pinned broken base (`176ac5eaf3c4…`) with a new
`benchmark_attempt_id`, `mission_id`, worktree, reasoning context and
flight record. No artifact from either invalid attempt may be supplied
to the new Arm A.
