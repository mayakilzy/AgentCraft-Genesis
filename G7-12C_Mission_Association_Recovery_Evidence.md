# G7-12C — Mission Association Recovery Evidence

**Mission:** G7-12C
**Date:** 2026-10-09

---

## 1. Risk Identified

The original `handleAuthorize` flow in `HomeSection.tsx`:

```
1. POST /v1/missions → missionId (success)
2. linkMission(conversationId, missionId) → (no error handling)
3. appendMessage(conversationId, {...}) → (no error handling)
```

**Risk:** If step 2 (`linkMission`) fails, the mission is created and executing in the Gateway, but NOT associated with the conversation. The user has no way to discover the missionId — it is orphaned.

## 2. Fix Applied

Modified `handleAuthorize` to:

1. **Capture the link result:** `const linkRes = await genesisApi.linkMission(...)`
2. **Always append a message with the missionId:** Even if linking fails, the assistant message includes the missionId so it's recoverable from conversation history.
3. **Display a warning on link failure:** `setError(...)` shows the missionId to the user with an explicit "Mission IS running" note.
4. **Distinguish success vs failure:** The message text differs based on whether linking succeeded.

### Code Change

```typescript
const linkRes = await genesisApi.linkMission(conversationId, missionId);

const linkNote = linkRes.kind === "ok"
  ? "The mission is now linked to this conversation."
  : `WARNING: Could not link mission to conversation (${linkRes.message ?? "unknown error"}). The mission IS executing — save this Mission ID to track it manually.`;

await genesisApi.appendMessage(conversationId, {
  role: "assistant",
  content: `Mission authorized and submitted.\n\nMission ID: ${missionId}\n\n${linkNote}...`,
  missionId,
});

if (linkRes.kind !== "ok") {
  setError(`Mission ${missionId} was submitted but linking failed. The mission IS running. Mission ID: ${missionId}`);
}
```

## 3. Acceptance Criteria

| Criterion | Status | Evidence |
|---|---|---|
| No silent orphaning of a successfully created mission | PASS | missionId always in message history |
| No duplicate mission launch caused by UI retry | PASS | Authorize button disabled during `authorizing` state; idempotency not needed for mission (each click = new mission, by design) |
| The user can recover the mission ID | PASS | missionId in assistant message + error display |
| A failed association is visible and recoverable | PASS | Warning message + error state |
| Existing mission authorization rules remain enforced | PASS | Gateway still authenticates + enforces caller ownership |

## 4. Regression Tests

**Test file:** `tests/gateway/g7-12c-mission-association-recovery.test.ts`

| Test | Scenario | Result |
|---|---|---|
| MAR-01 | Mission survives even if conversation link fails | PASS |
| MAR-02 | Unlinked mission appears in mission list | PASS |
| MAR-03 | Duplicate link calls are idempotent (no duplicate missions) | PASS |
| MAR-04 | missionId is preserved in conversation messages for recovery | PASS |

### MAR-01 Evidence

```
POST /v1/missions → 202, missionId=abc-123
POST /v1/conversations/nonexistent/missions → 404 (link fails)
GET /v1/missions/abc-123 → 200 (mission still exists, NOT orphaned)
```

### MAR-04 Evidence

```
POST /v1/conversations/{id}/messages {"role":"assistant","content":"Mission ID: recovery-test-123","missionId":"recovery-test-123"}
→ 201

GET /v1/conversations/{id}/messages
→ 200, messages[0].missionId === "recovery-test-123"
```

---

## 5. Design Principle

**Prefer idempotent association and explicit recovery over introducing a distributed transaction system.**

- No distributed transaction (two-phase commit) was added.
- The mission creation and conversation linking remain separate operations.
- Recovery is explicit: the missionId is always recorded in the conversation history.
- The user is informed of link failures with actionable information.

---

**End of Mission Association Recovery Evidence.**
