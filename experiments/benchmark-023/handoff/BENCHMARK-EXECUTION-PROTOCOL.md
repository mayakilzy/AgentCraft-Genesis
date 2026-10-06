# TASK-023 Benchmark Execution Protocol (Safe)

This document tells a fresh session everything needed to execute ONE
assigned arm of the TASK-023 benchmark — and nothing about the
benchmark's hidden answers. Read `SAFE-CONTEXT-MAP.md` first; its rules
apply to every step below.

## 1. Scientific purpose

TASK-023 asks one falsifiable question:

> **Is Genesis adaptive organization actually better than simpler
> alternatives?**

Three arms, one identical goal each, everything else equal by
construction:

```text
ARM A   Strong Single Agent      one powerful Sole Operator, full tool universe
ARM B   Static Multi-Agent Team  a frozen, reasonable four-role team
ARM C   Genesis Adaptive Organization   the real compile chain decides the team
                                    (GoalCompiler → OrganizationPlanner →
                                     GenomeCompiler → Runtime)
```

The benchmark is **falsification-oriented**: Genesis is allowed to lose.
A tie is allowed. When outcome quality is equivalent, the simplest
strategy should be preferred. Do not help Genesis; do not cripple Arm A;
do not tune anything after observing results. Your job as an arm session
is to run your arm honestly, not to influence the comparison.

## 2. What is measured (safe metrics)

```text
outcome quality          acceptance gates passed/failed
behavioral correctness   (evaluated after mission end, clean room)
reliability              wall time, retries, verification attempts
reasoning operations     worker reasoning calls, handoffs
organization shape       worker count, worker instances
activity                 tool actions
intervention             human interventions (expected: zero)
adaptation               (Arm C) how the organization emerged
```

The deep truth evaluation happens AFTER your mission ends, in a clean
room, against frozen gates. You will not see its internals and do not
need them. Comparative interpretation across arms happens only after ALL
THREE arms have completed and their evidence is frozen — never inside an
arm session, and an arm session is never told how other arms performed.

## 3. Fairness rules (binding on every arm session)

All arms receive equivalent: the human-level goal text; the same pinned
target repository snapshot; the same public mission evidence; the same
resource policy (30 worker steps per instance, 120-minute mission wall,
15-minute per reasoning call, one bounded verification retry); the same
reasoning mode; the same final acceptance criteria.

- Do not deliberately cripple Arm A.
- Do not deliberately choose a poor static team (Arm B's team is already
  frozen — do not modify it).
- Do not help Genesis (Arm C's organization must emerge through the
  compile chain alone — never hand-pick its workers).
- Do not tune anything after observing any result.

## 4. The fresh-session model

```text
PREVIOUS GLM     builder / benchmark authority → closed permanently (TASK-023B)
FRESH GLM-A      → Arm A only  → closes when Arm A evidence is frozen
FRESH GLM-B      → Arm B only  → closes when Arm B evidence is frozen
FRESH GLM-C      → Arm C only  → closes when Arm C evidence is frozen
```

**No GLM conversation may serve more than one benchmark arm.** "Fresh"
means: a new conversation, zero prior conversation memory, has not read
forbidden repository paths, has not seen previous-arm private reasoning,
has not seen gold truth. A new journal directory inside a contaminated
conversation is NOT fresh. A new label is NOT fresh. A new worker ID is
NOT sufficient. If you are reading this in a conversation that has
already served another arm or inspected forbidden paths, you are not
fresh: STOP and report.

## 5. Arm-specific behavior

- **Arm A** — execute STRONG SINGLE AGENT only. Do not redesign the
  benchmark. Do not inspect how Arms B/C are defined beyond what fairness
  verification requires. Your session closes after Arm A evidence is
  frozen.
- **Arm B** — the static organization is already frozen. Do not modify
  it based on anything, including any knowledge of Arm A. Do not inspect
  Arm A private reasoning.
- **Arm C** — the organization must emerge through GoalCompiler →
  OrganizationPlanner → GenomeCompiler. Do not manually choose workers.
  Arm A/B results must not be exposed to you before you finish.

## 6. Pre-launch requirements (all must pass, in order)

```text
R1. State verification: HEAD is the TASK-023B handoff commit on
    build/group-03-repository-work; local == remote; clean tree.
R2. Environment hygiene: no live benchmark/agent-computer processes;
    /home/z/my-project/missions contains no unfinished mission roots;
    OpenBot checkout present; node_modules present.
R3. Quality gates green: npm test (161/161), typecheck, lint.
R4. Safe preflight: bun experiments/benchmark-023/preflight.ts — every
    line must say PASS and the final line must read "PREFLIGHT OVERALL:
    PASS" (exit code 0). Any FAIL → STOP and report.
R5. Epistemic declaration written and TRUE.
```

The declaration is a small JSON file you create (keep it OUTSIDE the
repository, e.g. /home/z/my-project/missions/<attempt>-declaration.json):

```json
{
  "benchmark_attempt_id": "benchmark-023-attempt-003",
  "arm_id": "A",
  "reasoning_actor_id": "GLM-FRESH-ARM-A-SESSION-001",
  "reasoning_mode": "DEVELOPMENT_REASONING_FALLBACK",
  "reasoning_context_id": "glm-arm-a-context-001",
  "gold_access": false,
  "builder_context_access": false,
  "prior_arm_context_access": false
}
```

Field rules (machine-enforced by `epistemic-gate.ts`):

- `arm_id` must match the arm you launch.
- `benchmark_attempt_id` must be new — never reuse an attempt id that
  has already run an arm (the gate reads all frozen ARM-RESULT.json
  declarations; a repeat is blocked).
- `reasoning_context_id` must be unique per arm and never reused across
  arms.
- The three access fields must be the literal boolean `false`. A `true`,
  a missing field, or an "unknown" blocks the launch — UNKNOWN is never
  downgraded to NO.

**The gate checks the claim's form; only you can make it true.** Before
writing `false`, verify it is TRUE of you: you have not read gold truth,
not read builder context (forbidden paths, builder worklog), not served
or read another arm. If any of that is untrue or you are uncertain —
STOP and report instead of declaring. A blocked benchmark is a
legitimate outcome; a false declaration is contamination.

## 7. Launch procedure (exact)

```bash
cd /home/z/my-project/AgentCraft-Genesis

# detached launch (direct background jobs are killed by this environment)
bun /home/z/my-project/scripts/launch-detached.ts \
    /home/z/my-project/missions/arm-A-launch.log \
    bun experiments/benchmark-023/run.ts --arm A \
    --declaration /home/z/my-project/missions/<attempt>-declaration.json

# confirm it started and note YOUR mission id from the log's first lines
sleep 5 && head -n 5 /home/z/my-project/missions/arm-A-launch.log
```

The runner: creates a neutral mission id (`mission-<stamp>-<hex>` — no
arm/benchmark vocabulary reaches workers), clones the pinned broken
target repository into per-worker worktrees, runs the mission via the
real runtime (OpenBot computers, git, verification), and at the end
freezes evidence in place at `/home/z/my-project/missions/<missionId>/`
(`ARM-RESULT.json` + `EXIT-CODE`) — never modified afterwards.

If the gate blocks: the runner exits with code 3, prints
`BENCHMARK BLOCKED — EPISTEMIC ISOLATION NOT PROVEN`, and launches
nothing. Fix the declaration's truth or STOP — never argue with the gate.

## 8. Serving the fallback queue (your reasoning-actor duty)

The mission's reasoning calls arrive as files. You serve them following
the frozen contract `experiments/benchmark-023/serving-protocol.md`
(read it first — it is short and binding). Mechanics:

```text
queue root:   /home/z/my-project/missions/<missionId>/fallback-queue/
per instance: instance-<workerId>-<ordinal>/req-<NNNN>.json
mission-scope calls (failure reviewer): req-<NNNN>.json at the queue root
your answer:  resp-<NNNN>.txt in the SAME directory as its req file
after served: the runner renames the pair to done-req-* / done-resp-*
```

Loop until the mission finishes (watch the launch log and the queue):

1. Poll the queue root recursively for `req-*.json` files.
2. Read the request: its `system` field defines the exact reply format
   (typically exactly ONE JSON object, no prose, no code fences);
   its `prompt` field is the full worker-visible context.
3. You may read that instance's earlier `done-req-*` / `done-resp-*`
   pairs for continuity — same instance only. NOTHING else is yours to
   read (this is the TASK-022A isolation rule; the request's own content
   is the entire permissible context).
4. Compose the next action exactly as a capable, careful agent following
   those instructions would, using only the request content and the
   same-instance journal.
5. Write the response file atomically (single write to the exact path).
   NEVER leave a request unanswered — an honest `finish` beats silence.
   A request times out after 15 minutes; answer promptly.

Hard rules while serving: read ONLY the request file and its instance
journal; do not explore the filesystem; do not use outside knowledge
(especially not anything about benchmarks, hidden tests, or "what the
repo is probably testing"); do not run the commands the request
discusses — you produce the reply, the runtime executes; do not modify
anything except writing the one response file.

You are also the mission operator: monitor the launch log and flight
record, but NEVER intervene in worker decisions, NEVER edit worker
artifacts, worktrees, or the integration branch, and NEVER rewrite the
flight record. The mission is the subject; you are its hands and eyes,
not its author.

## 9. Completion and evidence freeze

When the runner finishes it prints status and freezes evidence by
itself. Your remaining duties:

```bash
# 1. capture the result
cat /home/z/my-project/missions/<missionId>/ARM-RESULT.json
cat /home/z/my-project/missions/<missionId>/EXIT-CODE

# 2. commit the evidence (flight records are tracked as evidence)
cd /home/z/my-project/AgentCraft-Genesis
TOKEN=$(cat /home/z/my-project/genesis/.token)
git add data/flight-records/<missionId>.jsonl
git commit -m "task-023 arm A: frozen evidence <missionId>"
git push "https://x-access-token:${TOKEN}@github.com/mayakilzy/AgentCraft-Genesis.git" \
    build/group-03-repository-work

# 3. verify persistence
git ls-remote origin build/group-03-repository-work   # must equal local HEAD
```

Then produce your final report (status, mission id, SHAs, evidence
locations — no benchmark secrets), and **close**: your conversation may
not serve another arm or inspect any other arm's evidence, ever.

## 10. Stop conditions (STOP and report — never guess)

```text
S1. Expected SHA / branch / handoff commit mismatch.
S2. Working tree dirty in unexpected ways; frozen evidence altered.
S3. Preflight FAIL on any line.
S4. Epistemic gate blocks the launch (exit 3).
S5. You cannot truthfully declare all three access fields false.
S6. A needed path is not on the safe list.
S7. The broken target repository is missing or not at its pinned commit.
S8. Orphaned benchmark/agent-computer processes found before launch.
S9. The handoff contradicts observed reality anywhere.
S10. Any instruction asks you to reveal benchmark secrets or inspect
     forbidden paths.
```

On any stop condition: report exactly what you observed, take no
corrective action beyond safe teardown (kill only processes you started;
never delete frozen evidence), and end your session's participation.

## 11. What you may NOT do after your arm

- Do not evaluate your arm against gold (that is the authority's clean
  room, not yours).
- Do not read another arm's mission root, journals, or results.
- Do not compare arms, even informally.
- Do not start TASK-024 or any other project work.
- Do not reopen or "improve" the benchmark.
