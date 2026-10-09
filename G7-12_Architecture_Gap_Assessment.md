# G7-12 — Architecture Gap Assessment

**Mission:** G7-12 — Persistent Conversational Home
**Baseline:** `a7529ca478a7bbbcaf5ad757e1cd8273a54e9374` (G7-11C)
**Date:** 2026-10-09

---

## 1. Reusable Components Identified

### 1.1 Persistence Layer (JSONL pattern)

The existing codebase has three production JSONL stores that G7-12 will mirror:

| Store | File | Pattern |
|---|---|---|
| FileFlightRecorder | `src/mission/flight-recorder.ts:384` | `appendFileSync` per event, `mkdirSync` ensures dir |
| FileExperienceStore | `src/learning/experience-store.ts:71` | `writeFileSync` (rewrite-by-id), `readFileSync` |
| ArtifactRegistry | `src/mission/artifact-record.ts:147` | `appendFileSync` per record |

**Reuse decision:** G7-12 conversations use the same JSONL pattern. A `FileConversationStore` will persist to `data/conversations/` — a sibling of `data/flight-records/`. This requires NO new dependencies (uses `node:fs`) and NO new infrastructure (no PostgreSQL, Redis, or vector DB).

### 1.2 Gateway Layer

| Component | File | Reuse |
|---|---|---|
| HTTP Server | `src/gateway/http-server.ts` | Add conversation routes alongside `/v1/missions` |
| Authentication | `http-server.ts:261-304` | Reuse `authenticate()` + `constantTimeEquals` |
| Caller Identity | `src/gateway/types.ts:163` | Reuse `CallerIdentity.callerId` for ownership |
| MissionService | `src/gateway/mission-service.ts` | Reuse for mission creation + retrieval (no second service) |

### 1.3 UI Layer

| Component | File | Reuse |
|---|---|---|
| Zustand store | `web/src/lib/genesis/store.ts` | Add `home` section + conversation state |
| BFF proxy | `web/src/app/api/genesis/[...path]/route.ts` | Extend `VERIFIED_PATTERNS` with conversation routes |
| genesisApi client | `web/src/lib/genesis/client.ts` | Add conversation methods |
| GenesisApp switch | `web/src/components/genesis/GenesisApp.tsx` | Add Home section rendering |
| AppShell nav | `web/src/components/genesis/AppShell.tsx` | Add Home nav entry + Alt+1 shortcut |

### 1.4 Mission Integration

| Component | Reuse |
|---|---|
| `POST /v1/missions` | Submit mission from conversation (existing) |
| `GET /v1/missions/{id}` | Retrieve mission status (existing) |
| `GET /v1/missions/{id}/events` | Worker progress (existing) |
| `GET /v1/missions/{id}/artifacts` | Artifact references (existing, G7-11C fixed) |
| `GET /v1/missions/{id}/result` | Verification outcome (existing) |

---

## 2. Gap Assessment

### 2.1 Missing: Conversation Persistence (P0)

**Gap:** No conversation store exists. The UI has no Home section.
**Fix:** Add `src/conversation/conversation-store.ts` (FileConversationStore, JSONL). Add `src/gateway/conversation-routes.ts` (HTTP handlers). Wire into `http-server.ts`.

### 2.2 Missing: Conversation API (P0)

**Gap:** No `/v1/conversations` routes.
**Fix:** Add routes: `POST /v1/conversations`, `GET /v1/conversations`, `GET /v1/conversations/{id}`, `POST /v1/conversations/{id}/messages`, `GET /v1/conversations/{id}/messages`, `POST /v1/conversations/{id}/missions`. All require auth + caller ownership.

### 2.3 Missing: Home UI (P0)

**Gap:** No Home/Chat section in the UI.
**Fix:** Add `web/src/components/genesis/HomeSection.tsx` with three areas: conversation nav, main conversation, mission workspace. Add `home` to `Section` union + `SECTIONS` array.

### 2.4 Missing: Conversation→Mission Wiring (P0)

**Gap:** No mechanism to authorize mission execution from a conversation.
**Fix:** The Home UI's "Authorize & Execute" button calls `POST /v1/missions` (existing) with the conversation's goal text, then calls `POST /v1/conversations/{id}/missions` to link the missionId. The mission workspace polls existing mission endpoints.

### 2.5 Existing: Caller Isolation (no gap)

The `authenticate()` function returns a `CallerIdentity` with `callerId`. All conversation operations will filter by `callerId` — same pattern as `MissionService.requireMission()`.

### 2.6 Existing: BFF Proxy (extend, not replace)

The BFF `VERIFIED_PATTERNS` allowlist will be extended with conversation route patterns. Same cookie auth, same path-safety, same secret redaction.

---

## 3. Persistence Mechanism Choice

**Chosen:** Filesystem JSONL (append-only for messages, rewrite-by-id for conversation metadata).

**Rationale:**
- Matches the existing `data/` directory pattern (flight-records, artifact-records, experiences).
- No new dependencies (`node:fs` only).
- No new infrastructure (no PostgreSQL, Redis, vector DB).
- Durable across gateway restart (files persist on disk).
- Consistent with G7-11C's artifact lifecycle fix (filesystem read after process close).
- Bounded file growth: one JSONL file per conversation (`data/conversations/{conversationId}.jsonl`).

**Rejected alternatives:**
- In-memory registry: explicitly forbidden by the mission spec.
- PostgreSQL/Redis: violates "do not introduce infrastructure unless genuinely required."
- SQLite: adds a dependency; JSONL is sufficient for the current scale.

---

## 4. Data Model

### 4.1 Conversation Record (metadata, rewrite-by-id)

```typescript
interface ConversationRecord {
  conversationId: string;      // UUID
  callerId: string;            // ownership (from CallerIdentity)
  title: string;               // user-visible title
  createdAt: string;           // ISO timestamp
  updatedAt: string;           // ISO timestamp
  status: 'active' | 'archived';
  missionIds: string[];        // references to mission IDs (no state duplication)
}
```

### 4.2 Message Record (append-only)

```typescript
interface MessageRecord {
  messageId: string;           // UUID
  conversationId: string;      // parent conversation
  seq: number;                 // stable sequence (monotonic per conversation)
  role: 'user' | 'assistant';  // who sent the message
  content: string;             // message text
  createdAt: string;           // ISO timestamp
  missionId?: string;          // optional: mission launched from this message
  idempotencyKey?: string;     // optional: for retry safety
}
```

### 4.3 No State Duplication

- `missionIds` in ConversationRecord are **references** only — the authoritative mission state lives in MissionService (in-process) + flight records (durable JSONL).
- Artifact content is NEVER stored in the conversation store — artifacts are retrieved via `GET /v1/missions/{id}/artifacts` (existing, G7-11C fixed).
- If a mission is no longer retrievable (gateway restart lost in-process state), the UI shows "Mission state unavailable (gateway restarted)" — never fabricates completion.

---

## 5. Scope Boundaries

**In scope:**
- Conversation persistence (JSONL).
- Conversation API (7 routes).
- Home UI (3 areas).
- Conversation→Mission wiring (authorize + link).
- Acceptance tests CT-01..CT-11.

**Out of scope (per mission spec):**
- G7-13 durable project management.
- G7-14 plugins/MCP.
- New orchestration engine.
- Durable mission execution rewrite.
- Multi-user collaboration.
- Enterprise billing.

---

**End of Architecture Gap Assessment.**
