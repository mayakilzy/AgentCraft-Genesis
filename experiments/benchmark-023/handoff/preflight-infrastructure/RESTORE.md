# TASK-023D — Sealed Preflight Infrastructure Restoration

TASK-023D persisted the complete authority-side sealed root required by
`experiments/benchmark-023/preflight.ts` so that any future fresh host
can restore `.worklog-gold/` blindly without running the workload
generator, regenerating the common execution base, or inspecting
benchmark secrets.

This file tells an arm session how to restore the sealed preflight
infrastructure on a fresh host. It contains no benchmark secrets.

## The rule

```text
DO NOT RUN THE WORKLOAD GENERATOR.
DO NOT RECONSTRUCT .worklog-gold/ YOURSELF.
DO NOT INSPECT THE SEALED ARTIFACT'S CONTENTS.
RESTORE .worklog-gold/ ONLY FROM THIS TASK-023D ARTIFACT.
VERIFY ITS SHA-256 FIRST.
EXTRACT IT DIRECTLY TO THE SANCTIONED LOCATION.
RUN THE FROZEN PREFLIGHT TO VERIFY.
```

If the restored `manifest.json`'s `base_sha` does not equal
`12a448c4b9284b9063987d8cbaa7fcb2a7c1300a` after extraction: **STOP.**
Do not repair, do not regenerate, do not modify. Report the discrepancy.

## Required artifact (beside this file)

```text
experiments/benchmark-023/handoff/preflight-infrastructure/
    sealed-preflight-infrastructure.tar.gz    the sealed root (gzip+tar)
    MANIFEST.json                             safe integrity manifest
    RESTORE.md                                this file
```

## Where it restores

```text
HOST PATH = /home/z/my-project/target-repos/.worklog-gold/
```

This is a HOST path, not a repository-relative path. It is intentionally
outside the Genesis repository. The sealed gold root is forbidden to
arms (`handoff/SAFE-CONTEXT-MAP.md` §4).

## Blind restoration procedure

Run from the repository root
(`/home/z/my-project/AgentCraft-Genesis`):

```bash
# 1. Verify the artifact's integrity BEFORE extracting.
#    MUST print exactly:
#    2e56a6d167049f19fb7a9c5362a5f76925baeddc9aba16deec41ac3f7f6b3cd1  experiments/benchmark-023/handoff/preflight-infrastructure/sealed-preflight-infrastructure.tar.gz
sha256sum experiments/benchmark-023/handoff/preflight-infrastructure/sealed-preflight-infrastructure.tar.gz

# 2. If the SHA-256 above does not match: STOP. Do not extract.

# 3. Ensure the restore parent directory exists.
mkdir -p /home/z/my-project/target-repos

# 4. Extract the archive directly to the sanctioned location.
#    This recreates /home/z/my-project/target-repos/.worklog-gold/ with
#    all 19 files (manifest.json, src/, tests/, docs/, tools/, etc.).
tar -xzf \
    experiments/benchmark-023/handoff/preflight-infrastructure/sealed-preflight-infrastructure.tar.gz \
    -C /home/z/my-project/target-repos

# 5. Verify the restored manifest's base_sha field matches the canonical
#    common execution base SHA — Python reads ONE field only, does NOT
#    print defects, gold_file_sha256, validations, or any secret content.
python3 -c "import json; m=json.load(open('/home/z/my-project/target-repos/.worklog-gold/manifest.json')); assert m['base_sha']=='12a448c4b9284b9063987d8cbaa7fcb2a7c1300a', f\"base_sha mismatch: {m['base_sha']}\"; print('sealed manifest base_sha =', m['base_sha'])"

# 6. Run the frozen preflight — every control line must say PASS,
#    with the documented between-arms exception for the mission-root line
#    on a fresh host ('does not exist yet (clean)' is the fresh-host
#    equivalent of the pre-first-arm 'empty' PASS).
bun experiments/benchmark-023/preflight.ts
```

If any line other than the documented between-arms mission-root line
says FAIL: **STOP.** Do not argue with the gate, do not modify
preflight, do not inspect gold. Report the failure.

## What you may NOT do

```text
DO NOT extract the archive anywhere except the sanctioned location.
DO NOT cat, less, grep, find -exec, xxd, or otherwise READ any file
        inside .worklog-gold/ (including manifest.json beyond the
        single base_sha field check above).
DO NOT diff, compare, or search the contents of the archive or the
        restored root against anything.
DO NOT run the workload generator (experiments/benchmark-023/workload/
        generate.ts) — the sealed root is already persisted by this
        artifact; regenerating it would invalidate your arm.
DO NOT reconstruct .worklog-gold/ from workload/pristine/ or any other
        source. The persisted artifact is the ONLY sanctioned source.
DO NOT modify, extend, or repack the artifact. If you need to refresh
        it: STOP — that is an authority action, not an arm action.
```

## Why this artifact exists (safe summary)

The host filesystem is ephemeral. Each new GLM conversation may begin
on a fresh host where `/home/z/my-project/target-repos/.worklog-gold/`
does not exist. TASK-023D froze the sealed preflight infrastructure
once, into this single compact artifact, so future fresh hosts can
restore it blindly. The frozen preflight's deterministic controls
(negative control 6/10 with G3-G6 failures, positive control 10/10,
gold suite fails 23 on the base, sealed manifest matches pinned base,
etc.) were verified to reproduce PASS exactly on the artifact-restored
root by TASK-023D's clean restoration test.

## Concept distinction

```text
ARTIFACT                       PURPOSE                              RESTORES
----------------------------------------------------------------------------------------------
execution-base.bundle          one canonical execution base         /home/z/my-project/target-repos/worklog
  (TASK-023C)                 (the broken target repo)

sealed-preflight-infrastructure.tar.gz   one canonical sealed       /home/z/my-project/target-repos/.worklog-gold
  (TASK-023D)                            preflight root
                                         (manifest + tests + pristine
                                          + harness)
```

Both artifacts are required for a fresh host to run preflight. The
execution base comes from TASK-023C; the sealed preflight root comes
from TASK-023D. Neither is regenerated by arms.

## Fresh-host bootstrap sequence (arms)

```text
1. Clone Genesis from GitHub (build/group-03-repository-work).
2. Verify exact Genesis SHA against the frozen Arm-A evidence commit.
3. Install normal dependencies (npm ci / bun install).
4. Restore OpenBot v0.1.0 at /home/z/my-project/OpenBot if absent.
5. Restore the common execution base from the TASK-023C bundle
   (handoff/execution-base/RESTORE.md) — verify HEAD = 12a448c4… .
6. Restore the sealed preflight infrastructure from THIS TASK-023D
   artifact (verify SHA-256 first, then extract to the sanctioned
   location).
7. Verify the restored manifest's base_sha = 12a448c4… .
8. Run the quality gates (npm test, typecheck, lint).
9. Run the safe preflight (bun experiments/benchmark-023/preflight.ts).
10. Make a truthful epistemic declaration.
11. Execute your assigned arm ONLY.
```

## Note on fresh-host absence

A fresh host is NORMAL. GitHub persisted state is the durable
authority. The absence of `/home/z/my-project/target-repos/worklog`
or `/home/z/my-project/target-repos/.worklog-gold/` on a new
conversation is NOT an integrity failure — it is the expected
starting condition. Restore both from their persisted artifacts
(TASK-023C and TASK-023D respectively) before proceeding.

What IS an integrity failure: contradictory persisted state — e.g.
the persisted artifact's SHA-256 does not match what you compute,
or the restored manifest's `base_sha` does not equal the canonical
`12a448c4…`. Only the second is an integrity failure. STOP and report.
