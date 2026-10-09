# G7-12 — Persistence And Recovery Report

**Mission:** G7-12 — Persistent Conversational Home
**Branch:** `build/g7-12-persistent-conversational-home`

---

## 1. Persistence Mechanism

**Backend:** Filesystem JSONL (append-only for messages, rewrite-by-id for conversation metadata).

**Storage location:** `data/conversations/` (sibling of `data/flight-records/`, `data/artifact-records/`).

**File layout:**
```
data/conversations/
  {conversationId}.conv.json   — conversation metadata (JSON, rewrite-by-id)
  {conversationId}.msgs.jsonl  — messages (JSONL, append-only, one line per message)
```

**Why JSONL:**
- Matches the existing production pattern (FileFlightRecorder, FileExperienceStore, ArtifactRegistry).
- No new dependencies (`node:fs` only).
- No new infrastructure (no PostgreSQL, Redis, vector DB).
- Durable across gateway restart.
- Bounded file growth: one file pair per conversation.

---

## 2. Durability Verification

### 2.1 Conversation Metadata Durability

**Test:** CT-01 (store restart) — `tests/g7-12-conversation-store.test.ts`

Store instance 1 creates a conversation with title "Durability Test". Store instance 2 (new instance, same directory) retrieves the conversation with the correct title and conversationId.

**Result:** PASS — metadata persists in `.conv.json` file.

### 2.2 Message Durability

**Test:** CT-01 (store restart) — messages survive restart.

Store instance 1 appends 2 messages (user + assistant). Store instance 2 retrieves both messages with correct role, content, and seq.

**Result:** PASS — messages persist in `.msgs.jsonl` file (append-only).

### 2.3 Mission Link Durability

**Test:** CT-08 (restart recovery) — `tests/g7-12-conversation-store.test.ts`

Store instance 1 links missionId "mission-survive-restart". Store instance 2 retrieves the conversation with `missionIds: ['mission-survive-restart']` intact.

**Result:** PASS — mission references persist. The conversation remembers WHICH missions were linked.

---

## 3. Restart Recovery Behavior

### 3.1 Conversations: Fully Durable

After gateway restart:
- ✅ Conversation metadata survives (JSON files on disk).
- ✅ Messages survive (JSONL files on disk).
- ✅ Mission references survive (missionIds array in metadata).
- ✅ Conversation identity remains stable (UUID-based).
- ✅ Message ordering remains stable (seq-based).

### 3.2 Mission Execution State: NOT Durable (Documented Limitation)

After gateway restart:
- ❌ In-process mission registry (MissionService.missions Map) is lost.
- ❌ Active missions are gone.
- ❌ Terminal missions (within 5-min retention) are gone.

**UI behavior:** When a linked mission is no longer retrievable (`GET /v1/missions/{id}` returns 404), the Mission Workspace shows:

> "Mission state unavailable (gateway restarted). In-process mission registry does not survive restart."

**Never fabricated:** The UI never claims a mission succeeded/completed based on stale conversation data. It shows "Unavailable" with an explicit explanation.

### 3.3 Flight Records + Artifacts: Durable (Separate System)

Flight records (`data/flight-records/*.jsonl`) and artifact records (`data/artifact-records/*.jsonl`) are durable and persist across restart. These are separate from the conversation store and can be retrieved via their own existing APIs — but the conversation UI does NOT conflate them with live mission state.

---

## 4. Recovery Test Evidence

### Test: CT-08 — Restart Recovery

```typescript
// Phase 1: create + link mission with store instance 1
const store1 = new FileConversationStore({ dir });
const conv = store1.createConversation(CALLER_A, { title: 'Restart Test' });
store1.appendMessage(conv.conversationId, CALLER_A, { role: 'user', content: 'before restart' });
store1.linkMission(conv.conversationId, CALLER_A, 'mission-survive-restart');

// Phase 2: restart — new store instance reading the same directory
const store2 = new FileConversationStore({ dir });
const retrieved = store2.getConversation(conv.conversationId, CALLER_A);
expect(retrieved.title).toBe('Restart Test');
expect(retrieved.missionIds).toEqual(['mission-survive-restart']);

const messages = store2.getMessages(conv.conversationId, CALLER_A);
expect(messages.messages.length).toBe(1);
expect(messages.messages[0].content).toBe('before restart');
```

**Result:** PASS — all data survives the simulated restart.

---

## 5. Browser Refresh Recovery

The Home UI polls `GET /v1/conversations` and `GET /v1/conversations/{id}/messages` on mount. After a browser refresh:
1. The Zustand store re-initializes with `activeConversationId: undefined`.
2. The HomeSection fetches the conversation list from the server.
3. The user selects a conversation (or it can be auto-selected from URL state in a future enhancement).
4. Messages are fetched from the server — they persist because they're on disk.

**Result:** Conversations survive browser refresh (server-side persistence, not localStorage).

---

## 6. Limitations

1. **No auto-restore of active conversation:** After refresh, the user must re-select the conversation from the list. (Future enhancement: persist `activeConversationId` in URL or sessionStorage.)

2. **Mission state not durable:** Documented above — in-process registry does not survive restart.

3. **No conversation export/import:** No mechanism to export conversations for backup. (Future enhancement.)

4. **File-based concurrency:** The JSONL store is single-process (no cross-process locking). Suitable for the current single-gateway deployment; would need locking for multi-instance deployments. (Documented limitation — not a G7-12 scope item.)

---

**End of Persistence And Recovery Report.**
