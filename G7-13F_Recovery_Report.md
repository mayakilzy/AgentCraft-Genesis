# G7-13F Recovery — Integrity Hardening Report

**Mission:** G7-13F RECOVERY — Bounded reimplementation of the five architect-review findings after environment reset destroyed the original local commits.
**Branch:** `build/g7-13-durable-projects-repository`
**Baseline (verified):** `010bf3e584699053731090f143d56965863b97a7` (G7-13E — the published remote HEAD before this recovery)
**Date:** 2026-10-09

---

## 1. Recovery Summary

The previously local commits `77d007e` (G7-13F) and `1fb54dd` (backfill HEAD) were lost when the development environment was reset. A bounded recovery search was performed:

- Local reflog of the fresh clone — only the clone operation itself; no orphan commits.
- Remote refs (`git ls-remote origin`) — only `010bf3e` published; the lost commits were never pushed.
- Bundle/backup search across `/home/z/`, `/tmp/`, `/var/tmp/`, repo-info personal repo — no G7-13F artifacts.
- `git fsck --unreachable` on the fresh clone — no orphan git objects.

**Conclusion:** `LOST_COMMITS_RECOVERED = NO`. Per spec: "If the commits cannot be recovered, rebuild only G7-13F from the verified G7-13E checkpoint." The five findings were reimplemented from `010bf3e` (G7-13E) — verified baseline.

---

## 2. Finding Results

### Finding 1 — Brief provenance trust: PASS

**Implementation:** `src/gateway/project-routes.ts` — `filterBriefEntries` is now async + caller-bound:

- **USER_APPROVED**: server strips client-supplied `source` and `approvedAt`; fills in `source = "caller:<callerId>"` (bound to authenticated caller) + current ISO timestamp. Clients cannot impersonate another approving identity.
- **SOURCE_VERIFIED**: source MUST be `mission:<missionId>` AND verified via `MissionService.get(missionId, caller)`. Rejects (400) fake references, non-existent missions, and missions owned by other callers.
- **DRAFT**: strips client-supplied `source`/`approvedAt`. Drafts are proposals without provenance; never silently promoted to USER_APPROVED.
- The filter call is wrapped in the try/catch alongside `updateBrief`, so `ProjectValidationError` returns 400 (NOT 500 from the outer catch-all).

**Tests added (gateway-level, 7 new + 1 updated):**
- USER_APPROVED with `source: "operator:bob"` → server overrides to `caller:caller-a`.
- USER_APPROVED without source → server fills in `caller:caller-a`.
- SOURCE_VERIFIED with `source: "https://..."` → 400 (must be `mission:<id>`).
- SOURCE_VERIFIED with `source: "mission:fake-id"` → 400 (not found).
- SOURCE_VERIFIED with `source: "mission:<A's-mission>"` by caller B → 400 (not owned).
- SOURCE_VERIFIED with `source: "mission:<real-mission>"` by caller A → 200.
- DRAFT with `source: "should-be-stripped"` → server strips.
- Old "rejects USER_APPROVED entries without source" test updated to verify the new gateway binding behavior (was 400, now 200 with bound source).

### Finding 2 — Corrupt project recovery: PASS

**Implementation:** `src/project/project-store.ts` + `src/gateway/project-routes.ts`:

- New `ProjectCorruptError` class with `originalBytes` field (preserved for diagnostics, never returned to clients).
- `readProject` distinguishes: file not found → `undefined` (→ `ProjectNotFoundError`); file corrupt → throws `ProjectCorruptError` (malformed JSON, unsupported schemaVersion, missing required fields, malformed nested fields); valid → returns record.
- `getProject` catches `ProjectCorruptError`, logs to stderr for operator investigation (safe diagnostic path), rethrows.
- New `readProjectOrLog` helper for scanning functions (`listProjects`, `findProjectByCreateKey`, `findProjectByConversation`) — catches `ProjectCorruptError`, logs, returns `undefined` so iteration continues past corrupt files (no scan crash).
- `handleProjectStoreError` maps `ProjectCorruptError` → 404 `PROJECT_NOT_FOUND` (NOT 500) to avoid leaking existence across callers. Generic error message ("project not found") — no leak that file exists but is corrupt.

**Tests added:**
- Store-level (10 new + 2 PR-17 updated): malformed JSON, unsupported schemaVersion, missing `brief`, `conversationLinks` as string, `missionLinks` missing, distinguishes missing vs corrupt, cross-caller corrupt (no leak), `originalBytes` preserves content, `listProjects` skips corrupt, `findProjectByConversation` skips corrupt, `findProjectByCreateKey` skips corrupt.
- Gateway-level (4 new): GET corrupt → 404, brief GET → 404, overview GET → 404, list still works when one project is corrupt.

### Finding 3 — Concurrent idempotency and uniqueness: PASS

**Implementation:** `src/project/project-store.ts` header comment now explicitly documents the single-process model:
- All store methods are synchronous (writeFileSync, readdirSync, readFileSync, renameSync).
- Once a method starts, it runs to completion without yielding the event loop.
- Two concurrent requests with the same idempotency key produce exactly one project.
- This guarantee holds within a single Node.js process; does NOT extend to multi-process deployments (no cross-process locking, no advisory file locks, no shared mutex).

**Tests added (4 new, Promise.all on async wrappers around sync methods):**
- Two concurrent `createProject` with same idempotency key → one project, same ID.
- Two concurrent `linkConversation` to two different projects with same conversationId → one succeeds, one throws `ConversationAlreadyLinkedError`.
- Two concurrent `linkMission` with same idempotency key → one mission link, both return same project.
- Two concurrent `createProject` with DIFFERENT idempotency keys → two projects.

**No cross-process infrastructure introduced** (per spec constraint).

### Finding 4 — Browser restart recovery: PASS

**Implementation:** `scripts/g7-13f-browser-restart.cjs` — a real browser scenario:
1. Login via PIN form (matches the "Authenticate" button by accessible name).
2. Create a project via the UI.
3. Open Home section; verify active-project banner shows.
4. Create a conversation inside the project (auto-linked via HomeSection's project context).
5. Send a goal message + Authorize & Execute (mission submitted + linked to conversation).
6. Explicitly link the mission to the project via `linkMissionToProject` (valid user action).
7. STOP the Gateway: `pkill -f src/gateway/main.ts` to fully tear down the npx → tsx → node process tree (SIGKILL alone was insufficient — it only killed the npx parent, leaving the actual gateway running on the port).
8. Verify port released (polls `/health` until it fails — confirms previous Gateway actually stopped).
9. Start a NEW Gateway process with the same data dirs.
10. Reload the browser.
11. Verify: project survives, conversation survives, mission reference survives, mission live state shows UNAVAILABLE (NOT fabricated).

**Results:** 13/13 PASS — `F4-01`..`F4-10` (rendered-browser) + `AP-R-01`..`AP-R-03` (API-level, kept separate per spec).

| ID | Scenario | Result |
|---|---|---|
| F4-01 | gateway + web up (initial) | PASS |
| F4-02 | logged in; Projects nav visible | PASS |
| F4-03 | project created; detail view rendered | PASS |
| F4-04 | Home section shows active-project banner | PASS |
| F4-05 | conversation created + mission authorized | PASS |
| F4-05b | mission linked to project | PASS |
| F4-06 | gateway stopped (port released) | PASS |
| F4-07 | restarted gateway up | PASS |
| F4-08 | project survived Gateway restart | PASS |
| F4-09 | project detail view rendered after restart | PASS |
| F4-10 | mission state shown as UNAVAILABLE (not fabricated) after restart | PASS |
| AP-R-01 | (API-level) project survives in BFF list | PASS |
| AP-R-02 | (API-level) overview shows mission(s) all UNAVAILABLE | PASS |
| AP-R-03 | (API-level) overview shows conversation(s) all available | PASS |

### Finding 5 — Atomic replacement vs power-loss durability: PASS

**Implementation:** `src/project/project-store.ts` header comment now explicitly documents:

- **Atomic file replacement**: `writeFileSync(tmpPath)` + `renameSync(tmpPath, finalPath)` is atomic at the POSIX filesystem level. A concurrent reader sees either the previous valid file or the new valid file — never a partially-written file.
- **Temporary-file behavior**: temp file uses a unique name (`.tmp.<projectId>.<pid>.<timestamp>.project.json`) so concurrent writes within the same process do not collide. On write failure, the temp file is cleaned up; the previous valid file is preserved untouched.
- **Crash / power-loss durability**: NOT claimed. The write path does NOT call `fssync()`. If the OS crashes (power loss) before flushing its page cache to disk, recent writes may be lost. The temp-file + rename pattern protects against partial writes VISIBLE to concurrent readers, but does NOT protect against data loss when the OS page cache is unwritten to disk at power-loss time.
- **No new persistence infrastructure introduced** (per spec). Operators requiring power-loss durability must add `fsync()` in a follow-up — out of scope.

---

## 3. Files Changed (G7-13F Recovery)

| File | Change |
|---|---|
| `src/project/project-store.ts` | New `ProjectCorruptError` class with `originalBytes`; `readProject` throws on corruption; `readProjectOrLog` helper for scanning; `getProject` logs to stderr; `listProjects`/`findProjectByCreateKey`/`findProjectByConversation` use `readProjectOrLog`; header comment documents single-process model + atomic-vs-crash-durability distinction. |
| `src/gateway/project-routes.ts` | `filterBriefEntries` is async + caller-bound (USER_APPROVED → `caller:<callerId>`, SOURCE_VERIFIED → verified mission ref, DRAFT → strips source); imports + uses `ProjectCorruptError`; `handleProjectStoreError` maps it to 404. |
| `tests/g7-13-project-store.test.ts` | 15 new tests (F2: 11, F3: 4); 2 PR-17 tests updated to expect `ProjectCorruptError`. |
| `tests/gateway/g7-13-project-routes.test.ts` | 11 new tests (F1: 7, F2 gateway: 4); 1 old test updated. |
| `scripts/g7-13f-browser-restart.cjs` | New — real browser restart evidence script (F4). |
| `evidence/g7-13f/` | 10 screenshots + f4-results.json. |
| `eslint.config.js` | Added the new script to the test-tooling exclusion. |

**No frozen-contract modifications** (verified: 0 diff lines vs `010bf3e` and vs `86de847`).
**No new dependencies.**

---

## 4. Verification Results

| Check | G7-13E baseline | G7-13F Recovery |
|---|---|---|
| Engine tests | 756 passed / 9 skipped / 0 failed (80 files) | 782 passed / 9 skipped / 0 failed (80 files) — +26 new |
| Engine typecheck | PASS | PASS |
| Engine lint | PASS (0 errors) | PASS (0 errors) |
| Web typecheck | PASS | PASS |
| Web lint | PASS (0 errors, 4 pre-existing warnings) | PASS (0 errors, 4 pre-existing warnings — unchanged) |
| Frozen contracts | UNCHANGED | UNCHANGED (0 diff lines vs `010bf3e` and vs `86de847`) |
| Browser restart evidence (F4) | N/A | PASS (13/13 — F4-01..F4-10 + AP-R-01..AP-R-03) |
| New dependencies | NONE | NONE |
| Secrets in source control | NONE | NONE |

**Note on test count:** The previous G7-13F run (before env reset) reported 778 passed; this recovery reports 782 — slightly higher because the reimplementation added a few extra F2 tests (e.g., `missionLinks missing entirely`, `originalBytes preserves content`, `findProjectByCreateKey skips corrupt`, `list projects still works when one project is corrupt` gateway test). Per spec: "Do not weaken tests to reproduce the previous PASS count." No tests were weakened.

---

## 5. Stop-Condition Check

Per spec: "Stop immediately if the repository baseline differs from the authorized checkpoint or a serious integrity/security regression is detected."

| Check | Status |
|---|---|
| Repository baseline matches `010bf3e` | YES (verified before any work) |
| Security regression | NONE — F1 hardens Brief provenance (no impersonation, no fake mission refs) |
| Data corruption | NONE — F2 preserves corrupt files on disk, never silently replaces |
| Frozen-contract modification | NONE — 0 diff lines vs `010bf3e` and vs `86de847` |
| Unresolved critical test failure | NONE — all 782 engine tests + 13 browser tests PASS |

**No stop conditions triggered.**

---

## 6. Final Status

```text
MISSION = G7-13F RECOVERY

BASELINE_VERIFIED = YES (010bf3e584699053731090f143d56965863b97a7 — verified before any work)
LOST_COMMITS_RECOVERED = NO (bounded recovery search concluded commits were unrecoverable; reimplemented from G7-13E checkpoint)
F1_PROVENANCE = PASS (caller-bound USER_APPROVED + verified SOURCE_VERIFIED + DRAFT stripping; 8 gateway tests)
F2_CORRUPTION = PASS (ProjectCorruptError + originalBytes + readProjectOrLog + 404-no-leak; 15 store tests + 4 gateway tests)
F3_IDEMPOTENCY = PASS (single-process model documented + 4 Promise.all tests; no cross-process infrastructure)
F4_BROWSER_RESTART = PASS (13/13 — F4-01..F4-10 + AP-R-01..AP-R-03; pkill-based full process tree teardown; UNAVAILABLE not fabricated)
F5_DURABILITY_DOCUMENTATION = PASS (atomic-vs-crash-durability distinction documented; no fsync added; no new persistence infrastructure)

FULL_REGRESSION = 782 passed, 9 skipped, 0 failed (80 files) — was 756 at G7-13E (+26 new)
TYPECHECK = PASS (engine + web)
LINT = PASS (0 errors engine + 0 errors web; 4 pre-existing web warnings unchanged)
FROZEN_CONTRACTS = UNCHANGED (0 diff lines vs 010bf3e and vs 86de847)
BROWSER_ACCEPTANCE = PASS (F4-01..F4-10 rendered-browser + AP-R-01..AP-R-03 API-level kept separate)

FINAL_LOCAL_HEAD = f6a8e43dd63425e6ddef0596c362a2df0d3f8d23
FINAL_REMOTE_HEAD = (set after push)
HEAD_MATCH = (verified after push)
REMOTE_EVIDENCE = (verified after push)
STATUS = PASS
```

---

**End of G7-13F Recovery Report.**
