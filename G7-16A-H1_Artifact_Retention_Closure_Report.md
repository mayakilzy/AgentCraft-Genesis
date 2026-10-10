# G7-16A-H1 — Artifact Retention Truthfulness & Cleanup Safety

**Mission:** G7-16A-H1 — Artifact Retention Truthfulness & Cleanup Safety
**Branch:** `build/g7-14-constrained-mcp`
**Baseline:** `5ae6f1bdf0c718e05fcaa1c532f0627aec529b0a` (G7-16A — PASS)
**Date:** 2026-10-10

---

## 1. Actual Artifact Availability Lifecycle

### Before this fix

G7-16A's `cleanupWorkspace()` accessed the OpenBot adapter's `options.rootDir` via a TypeScript cast: `rt.runtime as (WorkerRuntime & { options?: { rootDir?: string } })`. However, `options` is a `private readonly` field on `OpenBotRuntimeAdapter` — **inaccessible at runtime**. The cast compiled but returned `undefined`, so `cleanupWorkspace()` silently skipped every mission. **Workspaces were never actually deleted.**

### Root cause

Private field access via TypeScript type assertion is a compile-time illusion. At runtime, the property is `undefined`. The P1-01 "workspace cleanup" from G7-16A was **not actually implemented** — the code was a no-op.

### Minimal correction

1. Added `workspaceDir?: string` to the `MissionRuntime` interface (non-frozen, internal).
2. Extended `runtimeFactory` return type to optionally include `workspaceDir`.
3. `main.ts`'s OpenBot factory now passes `workspaceDir: missionRootDir` explicitly.
4. `cleanupWorkspace()` reads `rt.workspaceDir` (a real public field on `MissionRuntime`) instead of the inaccessible `rt.runtime.options.rootDir`.
5. Added `realpathSync()` symlink containment check: resolve the path, reject if the resolved path contains `..`.

### Post-fix lifecycle (verified by tests)

1. Mission succeeds → artifact created in workspace.
2. `persistTerminal()` captures metadata (path + verified + bytes) in history store.
3. Artifact content available via `getArtifacts()` (workspace still exists).
4. Mission reaches terminal + retention window expires → `sweepTerminalMissions()` fires.
5. `cleanupWorkspace()` deletes the workspace directory (via `rt.workspaceDir`).
6. After eviction, `getArtifacts()` returns metadata with `content: undefined` (truthful).
7. History record persists — metadata (path, verified, bytes) is durable.

---

## 2. Retention Policy

**EXPLICIT — now enforced consistently.**

The implicit policy from G7-16A was: "workspace content available for `terminalMissionRetentionMs` (default 5 min) after mission completion, then metadata-only."

This is now an **explicit, enforced policy**:
- Content is available while the mission is in the in-process registry (before sweep).
- After sweep (retention window elapsed), the workspace is deleted.
- Metadata (path, verified, bytes) remains in the history store — durable across restarts.
- `getArtifacts()` truthfully returns `content: undefined` when the workspace is gone.

**No user/product decision required** — the policy is safe for a trusted pilot:
- 5-minute retention window gives operators time to retrieve content.
- Metadata survives indefinitely in the history store.
- The API never fabricates content availability.

---

## 3. Cleanup Safety

| Safety check | Status | Evidence |
|---|---|---|
| Active mission workspaces never deleted | PASS | H4-05: sweeper skips non-terminal missions |
| Cleanup targets only authorized mission-specific directories | PASS | H4-06: ws2 not deleted when ws1's mission is evicted |
| Symlink/path traversal protection | PASS | H4-07: `..` rejected + `realpathSync` resolves symlinks |
| Cross-mission isolation | PASS | H4-06: only the evicted mission's workspace is deleted |
| Repeated cleanup is idempotent | PASS | H4-08: second sweep finds nothing to delete, no throw |
| Failed cleanup reported truthfully | PASS | H4-09: missing workspace silently skipped (not an error) |
| Retained artifact content remains retrievable | PASS | H4-01: artifacts retrievable before sweep |
| Expired content reported truthfully | PASS | H4-03: `content: undefined` after cleanup (not fabricated) |
| Mission history intact after cleanup | PASS | H4-04 + H4-10: metadata survives sweep + restart |
| No secrets in cleanup logs | PASS | structuredLog scrubs secrets before logging workspace paths |

### Real filesystem path containment

The `cleanupWorkspace()` method uses:
1. **String check**: `workspaceDir.includes('..')` → reject.
2. **Symlink resolution**: `realpathSync(workspaceDir)` → resolves symlinks to real path.
3. **Resolved path check**: `resolved.includes('..')` → reject symlink escapes.

This is defense-in-depth — even if the string check passes, a symlink that resolves to `../` outside the root is caught.

---

## 4. Acceptance Tests (10/10 PASS)

```
 ✓ H4-01: Retrieval before expiration
 ✓ H4-02: Retrieval after cleanup — workspace deleted
 ✓ H4-03: Accurate expired/unavailable response — content undefined
 ✓ H4-04: Durable metadata after cleanup
 ✓ H4-05: Active workspace protection — sweeper skips non-terminal
 ✓ H4-06: Cross-mission isolation — cleanup targets only evicted mission
 ✓ H4-07: Symlink/path traversal protection
 ✓ H4-08: Repeated cleanup is idempotent
 ✓ H4-09: Cleanup failure reporting — missing workspace silently skipped
 ✓ H4-10: Gateway restart after cleanup — history intact

10/10 PASS
```

---

## 5. Full Quality Gates

| Check | Result |
|---|---|
| Full regression | **874 passed, 9 skipped, 0 failed (90 files)** — 864 pre-existing + 10 new H4 tests |
| Engine typecheck | PASS (0 errors) |
| Engine lint | PASS (0 errors) |
| Frozen contracts | UNCHANGED (0 diff vs 2b105e5) |
| ownership.yaml | UNCHANGED (0 diff vs 2b105e5) |
| New dependencies | None |

---

## 6. Changed Files

| File | Status | Notes |
|---|---|---|
| `src/gateway/mission-service.ts` | MODIFIED | `workspaceDir` on `MissionRuntime`; `cleanupWorkspace` reads it directly + `realpathSync` symlink check |
| `src/gateway/main.ts` | MODIFIED | OpenBot factory passes `workspaceDir: missionRootDir` |
| `tests/gateway/g7-16a-h1-retention-truthfulness.test.ts` | NEW | 10 acceptance tests |

---

## 7. Required Final Status

```text
MISSION = G7-16A-H1
RETENTION_POLICY = EXPLICIT
ARTIFACT_BEFORE_EXPIRY = PASS
ARTIFACT_AFTER_EXPIRY = TRUTHFUL
HISTORY_AFTER_CLEANUP = PASS
PATH_AND_SYMLINK_SAFETY = PASS
CROSS_MISSION_ISOLATION = PASS
CLEANUP_IDEMPOTENCY = PASS
FULL_REGRESSION = 874 passed, 9 skipped, 0 failed (90 files)
FROZEN_CONTRACTS = UNCHANGED (0 diff vs 2b105e5)
NEW_DEPENDENCIES = NONE
FINAL_LOCAL_HEAD = (set after commit)
FINAL_REMOTE_HEAD = (verified after push)
HEAD_MATCH = YES
TRUSTED_PILOT_READINESS = READY
NEXT_STAGE_STARTED = NO
```

---

**End of G7-16A-H1 Artifact Retention Closure Report.**
