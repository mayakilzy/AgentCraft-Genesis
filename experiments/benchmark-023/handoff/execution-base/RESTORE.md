# TASK-023 Common Execution Base — Restoration Instructions

TASK-023C froze the ONE execution base shared by Arms A, B and C.
`MANIFEST.json` beside this file records its identities and integrity
data. This file tells an arm session how to make sure it runs on that
exact base. It contains no benchmark secrets.

## The rule

```text
DO NOT RUN THE WORKLOAD GENERATOR.
RESTORE / VERIFY THE FROZEN TASK-023 EXECUTION BASE FROM THE PERSISTED
EXECUTION-BASE ARTIFACT.
VERIFY ITS HEAD SHA EXACTLY.
IF SHA DOES NOT MATCH: STOP.
```

```text
TASK_023_COMMON_EXECUTION_BASE_SHA =
12a448c4b9284b9063987d8cbaa7fcb2a7c1300a
```

Any arm running on a different base is invalid.

## Case 1 — the base repository already exists on this host

```bash
git -C /home/z/my-project/target-repos/worklog rev-parse HEAD
# MUST print: 12a448c4b9284b9063987d8cbaa7fcb2a7c1300a
```

If it prints anything else: **STOP and report.** Do not repair, do not
regenerate, do not rebase.

## Case 2 — the base repository is missing (fresh host)

```bash
mkdir -p /home/z/my-project/target-repos
git clone \
  /home/z/my-project/AgentCraft-Genesis/experiments/benchmark-023/handoff/execution-base/task-023-execution-base.bundle \
  /home/z/my-project/target-repos/worklog
git -C /home/z/my-project/target-repos/worklog config core.fileMode false
git -C /home/z/my-project/target-repos/worklog rev-parse HEAD
# MUST print: 12a448c4b9284b9063987d8cbaa7fcb2a7c1300a
```

This clone is the ONLY sanctioned way to materialize the base. It was
restoration-tested by TASK-023C: the clone reproduces the exact commit
SHA, the exact tree, a clean working tree and the single-commit history
byte-for-byte, without ever invoking the workload generator.

## Host permission-bit note (applies to this environment)

If `git status` anywhere in this project shows ONLY changes of the form
`old mode 100644 / new mode 100755` (all content lines identical), that
is a host file-system artifact of environment restoration, not a content
change. Normalize the view — never commit mode-only changes:

```bash
git config core.fileMode false   # run inside the repository in question
```

## Artifact integrity (optional re-verification)

```bash
sha256sum /home/z/my-project/AgentCraft-Genesis/experiments/benchmark-023/handoff/execution-base/task-023-execution-base.bundle
# MUST print: 1154868edd525f371590ae930b3298671623a0a5907cb7382073766d1acbef56

git bundle verify \
  /home/z/my-project/AgentCraft-Genesis/experiments/benchmark-023/handoff/execution-base/task-023-execution-base.bundle
# must report the base ref and "records a complete history"
```

## Why this artifact exists (safe summary)

Arm A executed validly on the base commit above after a fresh-host
reconstruction re-pinned the base SHA (the original host-only base was
lost to an environment reset; the frozen generator and its frozen inputs
— byte-identical to the benchmark freeze — reproduced a content-
equivalent base, and every deterministic control matched the freeze-time
values exactly). TASK-023C froze that exact base so Arms B and C use the
identical base without regenerating it:

```text
                 EXACT SAME EXECUTION BASE (12a448c4…)
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
            Arm A      Arm B      Arm C
```
