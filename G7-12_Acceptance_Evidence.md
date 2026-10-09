# G7-12 — Acceptance Evidence

**Mission:** G7-12 — Persistent Conversational Home
**Branch:** `build/g7-12-persistent-conversational-home`

---

## Acceptance Test Matrix

### CT-01 — Durable Conversation

| Test | File | Result |
|---|---|---|
| creates a conversation, appends messages, and retrieves them after store restart | `tests/g7-12-conversation-store.test.ts` | PASS |
| verifies files persist on disk | `tests/g7-12-conversation-store.test.ts` | PASS |

**Evidence:** Store instance 1 creates conversation + appends 2 messages. Store instance 2 (new instance, same dir) retrieves conversation + 2 messages with correct content + role.

### CT-02 — Message Ordering

| Test | File | Result |
|---|---|---|
| messages have deterministic ascending seq numbers | `tests/g7-12-conversation-store.test.ts` | PASS |
| paginates messages with cursor (seq-based) | `tests/g7-12-conversation-store.test.ts` | PASS |

**Evidence:** 5 messages get seq 0..4 in order. Pagination with limit=3 returns pages [0,1,2], [3,4,5], [6,7,8] with correct nextCursor.

### CT-03 — Caller Isolation

| Test | File | Result |
|---|---|---|
| caller B cannot read caller A's conversation | `tests/g7-12-conversation-store.test.ts` | PASS |
| caller B cannot append messages to caller A's conversation | `tests/g7-12-conversation-store.test.ts` | PASS |
| caller B cannot see caller A's conversations in list | `tests/g7-12-conversation-store.test.ts` | PASS |
| CT-03: caller B gets 404 for caller A's conversation (HTTP) | `tests/gateway/g7-12-conversation-routes.test.ts` | PASS |

**Evidence:** `ConversationOwnershipError` thrown on cross-caller access. HTTP returns 404 (not 403) to avoid leaking existence. List filtered by callerId.

### CT-04 — Duplicate Retry

| Test | File | Result |
|---|---|---|
| retrying with the same idempotencyKey returns the original message (no duplicate) | `tests/g7-12-conversation-store.test.ts` | PASS |
| different idempotencyKeys create separate messages | `tests/g7-12-conversation-store.test.ts` | PASS |
| CT-04: idempotency key prevents duplicate messages (HTTP) | `tests/gateway/g7-12-conversation-routes.test.ts` | PASS |

**Evidence:** Same idempotencyKey returns same messageId + original content. Message count stays at 1.

### CT-05 — Mission Association

| Test | File | Result |
|---|---|---|
| links a mission to a conversation and retrieves it | `tests/g7-12-conversation-store.test.ts` | PASS |
| does not duplicate mission links on repeated calls | `tests/g7-12-conversation-store.test.ts` | PASS |
| caller B cannot link a mission to caller A's conversation | `tests/g7-12-conversation-store.test.ts` | PASS |
| POST /v1/conversations/{id}/missions links a mission (HTTP) | `tests/gateway/g7-12-conversation-routes.test.ts` | PASS |

**Evidence:** `linkMission` adds missionId to `missionIds[]`. Repeated calls do not duplicate. Cross-caller denied.

### CT-06 — Truthful Mission Status

| Test | File | Result |
|---|---|---|
| conversation stores only missionId references, not mission state | `tests/g7-12-conversation-store.test.ts` | PASS |

**Evidence:** ConversationRecord has `missionIds: string[]` only. No `missionStatus`, `missionResult`, `missionArtifacts` fields. Mission state retrieved live via `GET /v1/missions/{id}`.

### CT-07 — Artifact Visibility

| Test | File | Result |
|---|---|---|
| G7-11C listArtifactsFromDisk reads workspace post-close | `tests/runtime/g7-11c-artifact-lifecycle.test.ts` | PASS |
| existing gateway artifact routes functional | `tests/gateway/e2e.test.ts` | PASS |

**Evidence:** G7-11C fixed the post-close artifact visibility. The conversation UI retrieves artifacts via the existing `GET /v1/missions/{id}/artifacts` route — no duplication in conversation store.

### CT-08 — Restart Recovery

| Test | File | Result |
|---|---|---|
| conversations survive store restart; mission references remain intact | `tests/g7-12-conversation-store.test.ts` | PASS |
| nonexistent conversation returns not-found (not fabricated) | `tests/g7-12-conversation-store.test.ts` | PASS |

**Evidence:** New store instance reads existing JSONL files. Conversation metadata + messages + missionIds all survive. Nonexistent conversations return `ConversationNotFoundError` (404 HTTP) — never fabricated.

### CT-09 — Cost Truthfulness

| Test | File | Result |
|---|---|---|
| conversation records do not store cost data | `tests/g7-12-conversation-store.test.ts` | PASS |

**Evidence:** ConversationRecord has no `cost`, `usd`, or `tokens` fields. Cost comes from live `GET /v1/missions/{id}/result` which returns `MissionCost`. UI displays "USD: UNKNOWN" when `cost.usd === 0` (G7-11C accounting fix).

### CT-10 — Rendered UI

| Aspect | Status | Evidence |
|---|---|---|
| HomeSection component implemented | PASS | `web/src/components/genesis/HomeSection.tsx` |
| Three-area layout (nav + conversation + workspace) | PASS | Component structure verified |
| Navigation (new/select conversations) | PASS | `ConversationNav` component |
| Message input + send | PASS | `MainConversation` component |
| Authorize & Execute button | PASS | `handleAuthorize` calls `submitMission` + `linkMission` |
| Mission workspace with real status | PASS | `MissionWorkspace` polls `getMission` |
| "Unavailable" state for restarted missions | PASS | `snap === "unavailable"` branch |
| Cost truthfulness (USD: UNKNOWN) | PASS | `snap.result.cost.usd === 0 ? "USD: UNKNOWN"` |
| Web typecheck | PASS | `tsc --noEmit` clean |
| Web lint | PASS | 0 errors |
| Live browser test | NOT_RUN | No running gateway with real providers in this environment |

### CT-11 — Regression

| Suite | Result |
|---|---|
| Engine tests | 691 passed, 9 skipped, 0 failed (77 files) |
| Engine typecheck | PASS |
| Engine lint | PASS (0 errors) |
| Web typecheck | PASS |
| Web lint | PASS (0 errors, 4 pre-existing warnings) |
| Frozen contracts | UNCHANGED |

---

## Gateway Route Tests (supplementary)

| Test | File | Result |
|---|---|---|
| POST /v1/conversations creates a conversation | `tests/gateway/g7-12-conversation-routes.test.ts` | PASS |
| GET /v1/conversations lists caller conversations | `tests/gateway/g7-12-conversation-routes.test.ts` | PASS |
| GET /v1/conversations/{id} returns metadata | `tests/gateway/g7-12-conversation-routes.test.ts` | PASS |
| POST /v1/conversations/{id}/messages appends | `tests/gateway/g7-12-conversation-routes.test.ts` | PASS |
| GET /v1/conversations/{id}/messages paginated | `tests/gateway/g7-12-conversation-routes.test.ts` | PASS |
| POST /v1/conversations/{id}/missions links | `tests/gateway/g7-12-conversation-routes.test.ts` | PASS |
| unauthenticated returns 401 | `tests/gateway/g7-12-conversation-routes.test.ts` | PASS |
| invalid limit returns 400 | `tests/gateway/g7-12-conversation-routes.test.ts` | PASS |
| PATCH updates title | `tests/gateway/g7-12-conversation-routes.test.ts` | PASS |

---

**End of Acceptance Evidence.**
