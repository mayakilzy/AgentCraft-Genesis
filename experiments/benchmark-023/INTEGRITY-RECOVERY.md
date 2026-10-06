# TASK-023A — Benchmark Integrity Recovery

Written 2026-10-06 under the supervisor's stop order, immediately after
the invalid attempt was frozen (see `evidence/invalid-attempt-001/`).
This document restores the experimental boundary that attempt 001
violated and determines — truthfully — whether TASK-023 may restart.

```text
TASK-023 ATTEMPT 1 = INVALID — BUILDER/FALLBACK KNOWLEDGE CONTAMINATION
BENCHMARK VALIDITY = FAIL (attempt 1)
GOLD ANSWER LEAKAGE = DETECTED BEFORE ARM EXECUTION (at design review,
                      not caught then; caught by the supervisor now)
ARM A RESULT = INVALID / NOT SCOREABLE (both execution attempts)
ARM B = NOT STARTED
ARM C = NOT STARTED
TASK-022A = PASS (UNAFFECTED — its per-worker-instance boundary held;
          the failure was a different, benchmark-level boundary)
```

## 1. The boundary that was violated

TASK-022A closed the worker-instance boundary:

```text
Worker Instance A  ↛  hidden fallback memory  ↛  Worker Instance B
```

TASK-023 attempt 001 broke a different boundary:

```text
BENCHMARK BUILDER  →  privileged gold knowledge  →  FALLBACK ACTOR
ARM A FALLBACK ACTOR  →  remembered discoveries  →  ARM B/C ACTOR (potential)
```

The `CONTAMINATION-REVIEW.md` frozen at `5eb6abc` claimed these were
closed structurally by per-request fresh stateless serving sessions.
That mechanism did not exist. When the dispatcher failed (attempt 1,
02:14Z), the operator session — the builder — served Arm A attempt 2
directly. A review that authorizes its own author to serve is not a
gate; it is a permission slip. The review is INVALIDATED (banner
prepended, body preserved unmodified).

## 2. The frozen role separation (supervisor's Step 4 — mandatory)

```text
BENCHMARK AUTHORITY
│
├── owns pristine implementation
├── owns gold truth
├── owns defect generator
├── owns evaluator
├── owns acceptance gates
└── NEVER serves worker reasoning


REASONING ACTOR
│
├── sees worker-visible request only
├── sees same-instance permitted history
├── sees explicit Genesis communications
├── does NOT see gold truth
├── does NOT see pristine solution
├── does NOT see defect generator
├── does NOT see evaluator internals
└── does NOT see previous-arm private reasoning
```

## 3. Current GLM role (supervisor's Step 5 — permanent for this benchmark)

```text
CURRENT GLM ROLE = BENCHMARK AUTHORITY / BUILDER
CURRENT GLM MAY SERVE REASONING = NO
```

This session (and any continuation of it) has seen the gold truth. It
may: orchestrate the harness, launch missions, monitor file/process
state, run clean-room gates, collect metrics, produce reports. It may
NOT decide worker actions or serve any arm's or reviewer's reasoning.

## 4. What may resume the benchmark (supervisor's Step 6)

TASK-023 may resume ONLY when a genuinely independent reasoning actor
exists:

- **Option A** — a functioning configured external LLM provider that has
  never seen the benchmark gold truth. (Probe evidence from TASK-022:
  the only configured provider answers 429 — currently unavailable.)
- **Option B** — a genuinely independent reasoning context: no access to
  this builder session, no knowledge of benchmark construction, receives
  only the frozen `serving-protocol.md` and the worker-visible request,
  cannot inspect benchmark-authority files.
- **Option C** — another isolated reasoning implementation meeting the
  same epistemic conditions.

Filesystem isolation alone (another journal directory, another account)
is NOT independence. The declaration gate below forces this claim to be
made explicitly per launch; it cannot make it true. As of this document:

```text
INDEPENDENT REASONING ACTOR AVAILABLE = NO
TASK-023 READY TO RESTART = NO
BLOCKER = INDEPENDENT CLEAN REASONING ACTOR REQUIRED
```

## 5. Cross-arm isolation (supervisor's Step 7 — enforced mechanically)

```text
Arm A reasoning context ≠ Arm B reasoning context ≠ Arm C reasoning context
```

- No reasoning session may serve more than one arm (a worker instance
  may retain its own permitted continuity INSIDE one arm).
- One arm per attempt: rerunning an arm requires a new
  `benchmark_attempt_id`, a new mission, a new reasoning context.
- Explicit Genesis communication inside an arm remains allowed.

## 6. The pre-launch gate (supervisor's Steps 9/10 — implemented)

`epistemic-gate.ts` + `run.ts` now require, before anything runs:

```text
bun experiments/benchmark-023/run.ts --arm A|B|C --declaration <file>
```

with the declaration:

```json
{
  "benchmark_attempt_id": "…",
  "arm_id": "A|B|C",
  "reasoning_actor_id": "…",
  "reasoning_mode": "DEVELOPMENT_REASONING_FALLBACK | EXTERNAL_PROVIDER",
  "reasoning_context_id": "…",
  "gold_access": false,
  "builder_context_access": false,
  "prior_arm_context_access": false
}
```

Machine-enforced rules (13 regression tests in
`tests/work/benchmark-epistemic-gate.test.ts`):

- the three access fields must be the literal boolean `false`;
  `true`, missing, or `"unknown"` → `BENCHMARK BLOCKED — EPISTEMIC
  ISOLATION NOT PROVEN`, exit 3, nothing launched (no mission root,
  no process, no journal);
- UNKNOWN is never downgraded to NO;
- the declared `reasoning_context_id` must not appear in any prior
  arm's frozen `ARM-RESULT.json` (cross-arm reuse impossible);
- an (attempt, arm) pair may run only once;
- unreadable prior evidence blocks the launch rather than passing as
  absence;
- the declaration is embedded verbatim in the arm's frozen
  `ARM-RESULT.json` (provenance, Step 9) and its `reasoning_actor_id`
  becomes the honest `fallback_actor` label — the harness no longer
  hardcodes any actor claim.

What the gate does NOT do: prove the declaration true. It makes the
epistemic claim explicit, checkable and permanent, so a false claim can
no longer hide inside a harness constant. The truth of the claim rests
on the independence conditions in §4.

## 7. Benchmark authority file protection (supervisor's Step 11)

The future reasoning actor must not have direct access to:

- the pristine implementation (`experiments/benchmark-023/workload/pristine/`);
- the sealed gold (`/home/z/my-project/target-repos/.worklog-gold/`);
- the defect generator (`workload/generate.ts` and its manifest);
- evaluator internals (`evaluate.ts`);
- benchmark-authority notes (this file, `BENCHMARK-DESIGN.md`,
  `CONTAMINATION-REVIEW.md`);
- invalid previous-arm reasoning journals
  (`/home/z/my-project/benchmark-evidence/invalid-attempt-001/`).

Workers see only the broken target repository and the public mission
material. The clean-room evaluator may see gold truth; workers may not.

## 8. Artifact classification (supervisor's Step 2 — each verified independently)

| Artifact | Class | Verification |
| --- | --- | --- |
| Workload spec `BENCHMARK-DESIGN.md` | **KEEP** | frozen at `5eb6abc`; zero post-freeze drift (`git diff 5eb6abc` clean on tracked files); gates G1–G10 unchanged |
| Pristine reference implementation | **KEEP** | gold suite 54/54, doc examples 13/13 re-run at recovery time; byte-identical to sealed gold (src/docs/README diff empty) |
| Deterministic broken-base generator `workload/generate.ts` | **KEEP** | base repo verified at pinned `176ac5eaf3c4…`, clean tree, exactly 1 commit, no pristine ancestor |
| Hidden gold suite (sealed) | **KEEP** | all 18 file SHA-256s match the sealed manifest (recomputed at recovery time) |
| Evaluator `evaluate.ts` | **KEEP** | negative control: broken base fails exactly G3/G4/G5/G6 (6/10); positive control: perfect repair passes 10/10 (re-run in preflight below) |
| Negative control | **KEEP** | re-verified in the recovery preflight |
| Positive control | **KEEP** | re-verified in the recovery preflight |
| Preflight `preflight.ts` + evidence | **KEEP** (with a documented limitation) | re-run PASS at recovery time; limitation recorded honestly: it verifies workload/evaluator integrity but cannot verify WHO serves — that hole is now covered by the pre-launch gate |
| Metric schema (`ARM-RESULT.json`) | **KEEP** | extended additively with the `declaration` provenance block |
| Three-arm definitions / static-team freeze (`mission.ts`) | **KEEP** | plans compile without capability gaps (preflight); team is mission-class-derived (repair+document+verify), not defect-derived |
| Single-agent definition | **KEEP** | compiles; exactly one Sole Operator (preflight) |
| Genesis arm definition (no planner override) | **KEEP** | Arm C org RECORDED by preflight, never directed |
| Clean-room evaluation logic | **KEEP** | arm-blind; controls above |
| `serving-protocol.md` | **KEEP** | remains the frozen serving contract for a future independent actor; a protocol text cannot create isolation by itself (lesson of attempt 001) |
| `run.ts` | **REVIEW → MODIFIED by TASK-023A** | pre-launch gate added; hardcoded false actor label removed; post-freeze harness change documented here; per design §Status any harness fix forces full benchmark restart — consistent with attempt 001's invalidation |
| `dev-fallback.ts` `fallbackActor` option | **KEEP** | mechanism sound; only its attempt-001 VALUE was false |
| `CONTAMINATION-REVIEW.md` | **INVALIDATE** | verdict was false in practice; banner prepended, body preserved as evidence |
| Arm A attempt 1 (dispatcher failure) | **INVALIDATE** (evidence preserved) | zero responses served; mission invalid because the benchmark itself was already invalid |
| Arm A attempt 2 (7 served requests) | **INVALIDATE** (evidence preserved) | builder session served under a false label — the contamination event |

No workload regeneration, no gate weakening, no evidence standard
change was performed. `WORKLOAD KNOWN TO BUILDER ≠ WORKLOAD INVALID` —
the workload remains valid for a future independent actor.

## 9. Frozen base integrity (supervisor's Steps 13/14)

```text
BENCHMARK FREEZE SHA = 5eb6abc5c43537311290d63feb2d4a234fe20caa
BENCHMARK FREEZE INTEGRITY = VERIFIED
```

- The freeze commit contains the complete pre-execution benchmark
  definition: design, contamination review, serving protocol, workload
  (pristine + generator + base pin + doc harness), mission/arm
  definitions, runner, evaluator, preflight + its evidence — 31 files.
- Zero tracked-file drift between `5eb6abc` and the working tree before
  TASK-023A began (only untracked flight-record files existed; both are
  now preserved under `evidence/invalid-attempt-001/`).
- No acceptance criterion or workload behavior was changed after
  observing Arm A reasoning: the only post-freeze code changes are
  TASK-023A's gate + label fix + this documentation, all enumerated in
  §6 and §8 and in the TASK-023A commit itself.
- Base repository re-verified at the pinned SHA (clean, single commit).
- Sealed gold re-verified (18/18 SHA-256; suite 54/54; docs 13/13).
- Negative + positive evaluator controls re-verified (recovery
  preflight run recorded in `evidence/PREFLIGHT.md`; the freeze-time
  preflight is preserved at `5eb6abc` and copied to
  `evidence/PREFLIGHT-FREEZE-5eb6abc.md`).

Known timing nuance (disclosed, not material): `BENCHMARK-DESIGN.md`
claims Arm B's team was "committed before the benchmark base repository
was generated"; the base manifest is stamped 01:39:49Z and the freeze
commit 01:43:01Z, so the commit landed ~3 minutes after generation.
The team's derivation from the mission class (not from the seeded
defects) is what matters for validity and is unaffected by the
sequencing of two artifacts written by the same builder within minutes.

## 10. Arm A restart policy (supervisor's Step 12 — permanent)

```text
mission-20261006T014358-e8c2f2  = permanently invalid
mission-20261006T021653-12073e  = permanently invalid
```

When TASK-023 resumes with a clean reasoning actor, Arm A starts from
scratch from the frozen pinned broken base under a new
`benchmark_attempt_id`, new `mission_id`, new worktree, new reasoning
context and new flight record. No artifact from either invalid attempt
may be supplied to the new Arm A. Both old mission roots, their
journals, serving logs and the operator log are preserved under
`/home/z/my-project/benchmark-evidence/invalid-attempt-001/` (SHA-256
manifest: `evidence/invalid-attempt-001/MANIFEST.md`, 331 files).

## 11. Determination

```text
TASK-023 READY TO RESTART = NO
BLOCKER = INDEPENDENT CLEAN REASONING ACTOR REQUIRED
```

This is the honest state. A task can PASS while the benchmark remains
BLOCKED: the remediation preserved the evidence, restored the boundary,
verified the frozen infrastructure, and installed the gate — but it did
not and must not conjure an independent reasoning actor to force
`READY = YES`.

**The benchmark authority may know the answer. The reasoning actor may
not.** A benchmark that Genesis loses honestly is useful; a benchmark
that Genesis wins through leaked knowledge is worthless.
