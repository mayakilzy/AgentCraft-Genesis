# G7-12 — Implementation Report

**Mission:** G7-12 — Persistent Conversational Home
**Branch:** `build/g7-12-persistent-conversational-home`
**Baseline:** `a7529ca478a7bbbcaf5ad757e1cd8273a54e9374` (G7-11C)
**Date:** 2026-10-09

---

## 1. Executive Summary

G7-12 adds a persistent, mission-aware conversational workspace to Genesis. Users can describe goals conversationally, authorize mission execution, follow real mission progress, and review results — all within a durable interface that survives browser refresh and gateway restart.

**Key outcomes:**
- Durable JSONL conversation persistence (no in-memory registry).
- 7 authenticated Gateway routes for conversation CRUD + messages + mission links.
- Home UI with three areas: conversation nav, main conversation, mission workspace.
- Real mission integration via existing Gateway (no second orchestration engine).
- 30 new tests (19 store + 11 gateway routes) — all PASS.
- Frozen contracts unchanged. No new dependencies.

---

## 2. Files Created

| File | Purpose |
|---|---|
| `src/conversation/conversation-store.ts` | FileConversationStore (JSONL persistence) |
| `src/gateway/conversation-routes.ts` | HTTP handlers for conversation routes |
| `web/src/components/genesis/HomeSection.tsx` | Conversational Home UI (3 areas) |
| `tests/g7-12-conversation-store.test.ts` | 19 store-level acceptance tests (CT-01..CT-09) |
| `tests/gateway/g7-12-conversation-routes.test.ts` | 11 gateway route tests |
| `G7-12_Architecture_Gap_Assessment.md` | Architecture audit + reuse decisions |
| `G7-12_Acceptance_Evidence.md` | Acceptance test evidence |
| `G7-12_Persistence_And_Recovery_Report.md` | Persistence + restart recovery report |

## 3. Files Modified

| File | Change |
|---|---|
| `src/gateway/http-server.ts` | Added conversation route routing + `conversationStore` param |
| `src/gateway/main.ts` | Construct `FileConversationStore` + pass to `startHttpServer` |
| `web/src/lib/genesis/types.ts` | Added conversation/message types |
| `web/src/lib/genesis/client.ts` | Added 6 conversation API methods |
| `web/src/app/api/genesis/[...path]/route.ts` | Added conversation VERIFIED_PATTERNS + PATCH handler |
| `web/src/lib/genesis/store.ts` | Added `home` section + `activeConversationId` |
| `web/src/components/genesis/GenesisApp.tsx` | Render HomeSection |

---

## 4. Architecture

### 4.1 Persistence

**Backend:** Filesystem JSONL (mirrors existing FileFlightRecorder / FileExperienceStore pattern).

**Storage layout:**
- `data/conversations/{conversationId}.conv.json` — conversation metadata (rewrite-by-id).
- `data/conversations/{conversationId}.msgs.jsonl` — messages (append-only).

**Durability:** Files persist across gateway restart. Conversations survive process restart. Mission execution state remains in-process (RESTART_RECOVERY = UNSUPPORTED); conversations store only missionId references.

### 4.2 Gateway API

7 authenticated routes, all enforcing caller ownership:

| Route | Method | Purpose |
|---|---|---|
| `/v1/conversations` | POST | Create conversation |
| `/v1/conversations` | GET | List caller conversations (cursor pagination) |
| `/v1/conversations/{id}` | GET | Get conversation metadata |
| `/v1/conversations/{id}` | PATCH | Update title |
| `/v1/conversations/{id}/messages` | POST | Append message (with idempotency) |
| `/v1/conversations/{id}/messages` | GET | Paginated messages |
| `/v1/conversations/{id}/missions` | POST | Link a mission to the conversation |

### 4.3 UI

Three-area layout:
- **A. Conversation Navigation:** New + recent conversations list.
- **B. Main Conversation:** Message history, goal input, "Authorize & Execute" button.
- **C. Mission Workspace:** Linked missions with real status, artifacts, cost.

The UI clearly distinguishes: conversation → proposed goal → authorized execution → running mission → verified success/failed mission. Never fabricates worker activity.

### 4.4 Mission Integration

The "Authorize & Execute" button:
1. Collects user messages as the goal text.
2. Calls `POST /v1/missions` (existing Gateway) to submit the mission.
3. Calls `POST /v1/conversations/{id}/missions` to link the missionId.
4. Appends an assistant message documenting the authorization.
5. The Mission Workspace polls `GET /v1/missions/{id}` for real status.

No second planner, worker manager, or orchestration loop.

---

## 5. Acceptance Test Results

| Test ID | Scenario | Result | Evidence |
|---|---|---|---|
| CT-01 | Durable conversation (create, append, restart store, retrieve) | PASS | `tests/g7-12-conversation-store.test.ts` (2 tests) |
| CT-02 | Message ordering (deterministic seq + pagination) | PASS | `tests/g7-12-conversation-store.test.ts` (2 tests) |
| CT-03 | Caller isolation (cross-caller denied) | PASS | `tests/g7-12-conversation-store.test.ts` (3 tests) + gateway test |
| CT-04 | Duplicate retry (idempotency key) | PASS | `tests/g7-12-conversation-store.test.ts` (2 tests) + gateway test |
| CT-05 | Mission association (link + retrieve) | PASS | `tests/g7-12-conversation-store.test.ts` (3 tests) |
| CT-06 | Truthful mission status (no state duplication) | PASS | `tests/g7-12-conversation-store.test.ts` (1 test) |
| CT-07 | Artifact visibility (via existing Gateway, G7-11C) | PASS | G7-11C `listArtifactsFromDisk` + existing gateway tests |
| CT-08 | Restart recovery (conversations survive; missions may not) | PASS | `tests/g7-12-conversation-store.test.ts` (2 tests) |
| CT-09 | Cost truthfulness (UNKNOWN USD never as confirmed zero) | PASS | `tests/g7-12-conversation-store.test.ts` (1 test) + UI shows "USD: UNKNOWN" |
| CT-10 | Rendered UI validation | PARTIAL | UI implemented + typecheck + lint pass; live browser test not executed (no running gateway in this environment) |
| CT-11 | Regression | PASS | 691 passed, 9 skipped, 0 failed (77 files) |

---

## 6. Regression Results

| Check | Result |
|---|---|
| Engine tests | 691 passed, 9 skipped, 0 failed (77 files) |
| Engine typecheck | PASS |
| Engine lint | PASS (0 errors) |
| Web typecheck | PASS |
| Web lint | PASS (0 errors, 4 pre-existing warnings) |
| Frozen contracts | UNCHANGED (0 diff lines) |
| Secrets committed | NONE |
| Production deployment | NONE |

---

## 7. Known Limitations

1. **CT-10 Rendered UI:** Live browser validation not executed in this environment (no running gateway with real providers). UI is implemented, typechecks, and lints clean. The conversation store + gateway routes are fully tested.

2. **Mission state not restart-durable:** Conversations survive restart, but linked mission execution state (in MissionService in-process registry) does NOT. If a mission is no longer retrievable, the UI shows "Mission state unavailable (gateway restarted)" — never fabricates completion.

3. **G7-08C/D not reconciled:** Rate-limiting + AuthGate hardening still in Z.ai Preview only.

4. **Cost USD = UNKNOWN:** ZAI pricing unavailable; UI displays "USD: UNKNOWN" when `cost.usd === 0`, never as confirmed free.

5. **No conversation archiving UI:** The store supports `status: 'archived'` but the UI does not yet expose archive/restore actions.

---

## 8. Scope Boundaries Maintained

- ✅ No G7-13 durable project management.
- ✅ No G7-14 plugins or MCP expansion.
- ✅ No new agent operating system.
- ✅ No new orchestration engine.
- ✅ No enterprise billing.
- ✅ No full long-term memory platform.
- ✅ No multi-user collaboration.
- ✅ No new artifact registry.
- ✅ No complete durable mission execution rewrite.
- ✅ No frozen contract modifications.

---

**End of Implementation Report.**
