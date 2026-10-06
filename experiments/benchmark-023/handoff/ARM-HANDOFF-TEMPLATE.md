# Arm Handoff Template (Safe, Reusable)

This file generates the per-arm handoff for each fresh GLM conversation.
It contains NO benchmark answers. Do NOT execute any arm from within the
builder/authority session or any session that has read forbidden paths.

## 1. Per-arm variables

```text
=====================================================================
ARM A — STRONG SINGLE AGENT
=====================================================================
ASSIGNMENT            Execute Arm A only (strong single agent)
EXPECTED SHA          <TASK-023B handoff commit on build/group-03-
                      repository-work — the operator fills this from the
                      TASK-023B final report / GitHub branch head>
SAFE ENTRY POINT      experiments/benchmark-023/handoff/README.md
LAUNCH COMMAND        bun /home/z/my-project/scripts/launch-detached.ts
                      /home/z/my-project/missions/arm-A-launch.log \
                      bun experiments/benchmark-023/run.ts --arm A \
                      --declaration <declaration.json>
ALLOWED PATHS         SAFE list in handoff/SAFE-CONTEXT-MAP.md, plus your
                      own mission root once it exists
FORBIDDEN PATHS       FORBIDDEN lists in handoff/SAFE-CONTEXT-MAP.md
                      (explicitly including every other arm's mission
                      root and all benchmark-authority material)
STOP CONDITIONS       handoff/BENCHMARK-EXECUTION-PROTOCOL.md §10
EVIDENCE/REPORT       ARM-RESULT.json + EXIT-CODE at your mission root;
                      flight record committed + pushed; final report with
                      SHAs; then the session closes permanently

=====================================================================
ARM B — STATIC MULTI-AGENT TEAM
=====================================================================
ASSIGNMENT            Execute Arm B only; the static organization is
                      FROZEN — modify nothing about it
EXPECTED SHA          <the then-current authoritative branch head, as
                      verified against the frozen Arm-A evidence commit>
SAFE ENTRY POINT      experiments/benchmark-023/handoff/README.md
LAUNCH COMMAND        same pattern with --arm B
ADDITIONAL FORBIDDEN  Arm A's mission root, journals, ARM-RESULT, and
                      any report of Arm A's performance
EVIDENCE/REPORT       same pattern; session closes permanently

=====================================================================
ARM C — GENESIS ADAPTIVE ORGANIZATION
=====================================================================
ASSIGNMENT            Execute Arm C only; the organization must EMERGE
                      through GoalCompiler → OrganizationPlanner →
                      GenomeCompiler — never hand-pick workers
EXPECTED SHA          <the then-current authoritative branch head, as
                      verified against the frozen Arm-A and Arm-B
                      evidence commits>
SAFE ENTRY POINT      experiments/benchmark-023/handoff/README.md
LAUNCH COMMAND        same pattern with --arm C
ADDITIONAL FORBIDDEN  Arm A and Arm B mission roots, journals, results,
                      and any knowledge of how they performed
EVIDENCE/REPORT       same pattern; session closes permanently
=====================================================================
```

Every arm session also inherits the universal constraints: one arm per
conversation ever; never inspect forbidden paths; never leak benchmark
secrets through summaries; comparative interpretation only after all
three arms are frozen, by a session that has not served any arm.

## 2. Bootstrap prompt — ARM A (ready to paste)

The operator pastes this into a brand-new GLM conversation. Replace
`<TASK-023B-SHA>` with the verified final SHA of the handoff commit
(the authority's TASK-023B report provides it; it is also the head of
`build/group-03-repository-work` on GitHub whose parent is
`496bb60ebdf807637461132993ad0f7053bd8fe3`).

```text
You are entering an existing AgentCraft Genesis project with ZERO prior
memory.

GitHub persisted state is authoritative.

Repository: https://github.com/mayakilzy/AgentCraft-Genesis.git
Local checkout: /home/z/my-project/AgentCraft-Genesis
Branch: build/group-03-repository-work
Exact SHA: <TASK-023B-SHA>

Verify the checkout resolves to exactly this SHA, that its top commit is
the TASK-023B handoff commit and its parent is
496bb60ebdf807637461132993ad0f7053bd8fe3. Clone or fetch if needed.

Read ONLY the safe handoff entry point:

  experiments/benchmark-023/handoff/README.md

Follow its reading order and restrictions exactly.

You are assigned TASK-023 — ARM A ONLY.

Do not inspect any forbidden path (the handoff's SAFE-CONTEXT-MAP.md
defines them; default-deny applies to everything unlisted).
Do not inspect previous invalid Arm reasoning.
Do not redesign the benchmark.
Do not execute Arm B or Arm C.
Do not start TASK-024.

If the handoff is incomplete, contradictory, unsafe, or the expected SHA
does not match, STOP and report the discrepancy instead of guessing.

Execute only after the handoff's pre-launch integrity requirements pass
(state verification, environment hygiene, quality gates, safe preflight,
and a truthful epistemic declaration).

At completion, freeze Arm A evidence, commit and push it, report the
resulting SHA/state, and STOP. Your conversation closes permanently
after Arm A.
```

## 3. Bootstrap prompt — ARM B (ready to paste, written by TASK-023C)

The operator pastes this into a brand-new GLM conversation after the
TASK-023C commit is pushed. Replace `<TASK-023C-SHA>` with the verified
final SHA of the TASK-023C commit (the authority's TASK-023C report
provides it; it is also the head of `build/group-03-repository-work` on
GitHub whose parent is `55aaebdbf760bed6779a7d8efa1a27fa49d43fd4`).

```text
You are entering an existing AgentCraft Genesis project with ZERO prior
memory.

GitHub persisted state is authoritative.

Repository: https://github.com/mayakilzy/AgentCraft-Genesis.git
Local checkout: /home/z/my-project/AgentCraft-Genesis
Branch: build/group-03-repository-work
Exact SHA: <TASK-023C-SHA>

Verify the checkout resolves to exactly this SHA, that its top commit is
the TASK-023C common-execution-base commit (message 'task-023c: freeze
common execution base') and its parent is
55aaebdbf760bed6779a7d8efa1a27fa49d43fd4. Clone or fetch if needed.

Read ONLY the safe handoff entry point:

  experiments/benchmark-023/handoff/README.md

Follow its reading order and restrictions exactly.

You are assigned TASK-023 — ARM B ONLY.

TASK_023_COMMON_EXECUTION_BASE_SHA =
12a448c4b9284b9063987d8cbaa7fcb2a7c1300a

Before launching, verify the broken target repository at
/home/z/my-project/target-repos/worklog is at EXACTLY that SHA; if it is
missing, restore it ONLY from the persisted execution-base artifact per
experiments/benchmark-023/handoff/execution-base/RESTORE.md.

DO NOT RUN THE WORKLOAD GENERATOR — the exact frozen base is persisted;
regenerating it would invalidate your arm. If the restored/verified SHA
does not match exactly: STOP and report.

Do not inspect any forbidden path (the handoff's SAFE-CONTEXT-MAP.md
defines them; default-deny applies to everything unlisted). This
includes Arm A's mission root, journals, ARM-RESULT and any report of
Arm A's performance.
Do not inspect previous invalid Arm reasoning.
Do not modify the frozen static-team organization of Arm B.
Do not redesign the benchmark.
Do not execute Arm A or Arm C.
Do not start TASK-024.

If the handoff is incomplete, contradictory, unsafe, or the expected SHA
does not match, STOP and report the discrepancy instead of guessing.

Execute only after the handoff's pre-launch integrity requirements pass
(state verification, environment hygiene, common execution base
verification, quality gates, safe preflight per the documented
between-arms expectation, and a truthful epistemic declaration).

At completion, freeze Arm B evidence, commit and push it, report the
resulting SHA/state, and STOP. Your conversation closes permanently
after Arm B.
```

## 4. Bootstrap prompt — ARM C (pattern)

Same pattern with three changes from the ARM B prompt: the assigned arm
letter (`--arm C`), the expected SHA (the then-current authoritative
head, verified against the frozen Arm-A and Arm-B evidence commits),
and the additional forbidden paths (Arm A and Arm B mission roots,
journals, results). Generate it only after Arm B's evidence is frozen
and pushed.
