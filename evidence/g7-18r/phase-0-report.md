# G7-18R Phase 0 — Repository and Evidence Integrity

## Branch + HEAD + clean tree + remote alignment

| Check | Result |
|---|---|
| Branch | `build/g7-14-constrained-mcp` ✓ |
| HEAD (local) | `ac35cceb157145c0873b672e375181c6ecb48fd4` ✓ |
| HEAD (remote) | `ac35cceb157145c0873b672e375181c6ecb48fd4` ✓ |
| Working tree | clean ✓ |
| Remote alignment | ALIGNED ✓ |

Baseline integrity = **PASS**.

## Investigation: G7-18 report records HEAD `721323e9` while final announced commit is `ac35cceb`

### Sequence of events

1. **Commit `721323e`** ("G7-18: Autonomous full-stack engineering challenge (PARTIAL)"): the G7-18 report was committed with placeholder values in its final-status block:
   ```
   FINAL_LOCAL_HEAD = (set after commit)
   FINAL_REMOTE_HEAD = (verified after push)
   ```
   At this moment, HEAD = `721323e`.

2. The operator edited the report file to fill in the final HEAD values. The operator wrote `721323e97fc4d0f9965c36d4fa9676314048c0c2` (the HEAD value *as it was before the metadata-fixup commit*).

3. **Commit `ac35cce`** ("G7-18: fill final HEAD hashes in report (HEAD_MATCH=YES)"): the act of committing this edit produced a NEW HEAD = `ac35cceb157145c0873b672e375181c6ecb48fd4`.

4. The report file now at HEAD `ac35cce` still contains `FINAL_LOCAL_HEAD = 721323e9...` — a stale value, because the commit that delivered the report (`ac35cce`) is itself the new HEAD.

### Root cause

A **chicken-and-egg metadata bug**: the report's `FINAL_LOCAL_HEAD` value can only be known *after* the commit that contains it, but the commit must contain the value. The operator solved this incorrectly by writing the *previous* HEAD (`721323e`) into the report, then committing — which created a new HEAD (`ac35cce`) that the report's content does not reflect.

### Correct approach (applied to G7-18R — see Phase 5)

Leave `FINAL_LOCAL_HEAD` and `FINAL_REMOTE_HEAD` as **placeholders** in the report content. After committing and pushing, perform a **follow-up amend** of the same commit using `git commit --amend` to substitute the real hashes, then force-push. This collapses the two-commit pattern into one canonical commit whose hash IS the value written into the report. (For G7-18R we go further: we write the report's final-status block in a separate post-push evidence file so the report content itself never carries a value that depends on its own commit hash.)

## Original 9 application files — located and hashes preserved

Source: `evidence/g7-18/clean-room-app/` (the unmodified artifacts produced by `documentation-writer-2` in G7-18 Phase 2, extracted during G7-18 Phase 3).

| File | Actual SHA-256 | Reported in G7-18 report | Match |
|---|---|---|---|
| server.js | `a32081adee07a848efaaa487a01afa232fdea0516a5e054c4c00c85c91c84c66` | `a32081adee07a848efaaa487a01afa232fdea0516a5e054c4c00c85c91c84c66` | ✓ |
| public/index.html | `71358747764ed20c2e3318596e86c7e3c294d3dd4cf3e6329042ad21f91021ab` | `71358747764ed20c2e3318596e86c7e3c294d3dd4cf3e6329042ad21f91021ab` | ✓ |
| public/styles.css | `a60fa2b388e093d585c3e288258df4e56366c7165a8e09196e54b974f0259df2` | `a60fa2b388e093d585c3e288258df4e56366c7165a8e09196e54b974f0259df2` | ✓ |
| public/app.js | `e2275551b472143b5a20dc72b80a4457cd94d56b35959a95be28c912c317a5b9` | `e2275551b472143b5a20dc72b80a4457cd94d56b35959a95be28c912c317a5b9` | ✓ |
| test/api.test.js | `dd3c66aa43aba4db1566ebda6fde97bc2c7a0b56ed94d53eec86f750f2b0b8b7` | `dd3c66aa43aba4db1566ebda6fde97bc2c7a0b56ed94d53eec86f750f2b0b8b7` | ✓ |
| test/db.test.js | `85b7fcbbb721747f98accbd375ded67e5eb9f0a211483ce261cf815dd6c4d4e1` | `85b7fcbbb721747f98accbd375ded67e5eb9f0a211483ce261cf815dd6c4d4e1` | ✓ |
| test/integration.test.js | `c6967d6c4a1f7be8865070efede6613588a5562f43be24ba2bc23dffa78c7f25` | `c6967d6c4a1f7be8865070efede6613588a5562f43be24ba2bc23dffa78c7f25` | ✓ |
| package.json | `587ba47b1082b8763b1722bf2b25b6767a8c9cdb8577f3cb32892ce19b9f3e31` | `587ba47b1082b8763b1722bf2b25b6767a8c9cdb8577f3cb32892ce19b9f3e31` | ✓ |
| README.md | `718db0f4b096089cba7813ffeb62f2ffb36e2c345b9dc22c3d94300ea537a279` | `718db0f4b096089cba7813ffeb62f2ffb366e2c345b9dc22c3d94300ea537a279` | ✗ **G7-18 REPORT TYPO** |

### Defect found in G7-18 report

The G7-18 report's recorded hash for **README.md** is **65 characters** instead of 64. The extra character is a `6` inserted at position 35:

- Actual file hash (64 chars, correct): `718db0f4b096089cba7813ffeb62f2ff b36e2c3 45b9dc22c3d94300ea537a279`
- G7-18 report recorded (65 chars, typo): `718db0f4b096089cba7813ffeb62f2ff b366e2c3 45b9dc22c3d94300ea537a279`

The substring `b36e2c` (actual) was transcribed as `b366e2c` (report) — an extra `6` was inserted between `b3` and `e`. The other 8 hashes in the G7-18 report are correct.

**The actual README.md file is unchanged.** The defect is purely a typo in the G7-18 report's recorded hash table. The file itself hashes to `718db0f4b096089cba7813ffeb62f2ffb36e2c345b9dc22c3d94300ea537a279` (64 chars, valid SHA-256).

## Secrets / credentials scan

The 9 original application files were scanned against four real-secret patterns:
- GitHub PAT (`ghp_[A-Za-z0-9]{30,}`)
- OpenAI-style key (`sk-[A-Za-z0-9]{30,}`)
- AWS access key (`AKIA[0-9A-Z]{16}`)
- Password literal (`password = "..."` with 8+ chars)

**Result: 0 secrets found.** The earlier G7-18 acceptance run had a false positive on the bare substring `sk-` (matched CSS class names like `task-item`, `task-title`); the refined pattern (which requires 30+ chars after `sk-`) finds nothing.

## Phase 0 summary

| Check | Result |
|---|---|
| Branch / HEAD / clean tree / remote alignment | **PASS** |
| HEAD discrepancy (`721323e9` vs `ac35cceb`) investigated | **YES** — chicken-and-egg metadata bug in G7-18 (placeholder filled with stale value, then committed, creating new HEAD) |
| 9 original application files located | **YES** — `evidence/g7-18/clean-room-app/` |
| Hashes preserved | **YES** — all 9 actual hashes recorded in `phase-0-artifact-hashes.json` |
| G7-18 report's recorded hashes match actual | **8/9 match** — README.md recorded hash has a typo (65 chars, extra `6` at position 35) |
| Secrets / credentials committed | **NONE FOUND** |

Baseline integrity = **PASS** (with one noted defect in the G7-18 report's recorded hash table for README.md — the file itself is correct, only the report's recorded hash string has a typo).
