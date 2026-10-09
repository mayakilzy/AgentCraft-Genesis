# G7-12D — Mission Retry Safety Evidence

**Mission:** G7-12D
**Date:** 2026-10-09

---

## 1. Verification

The `handleAuthorize` flow in `HomeSection.tsx` was reviewed in G7-12C and fixed. G7-12D re-verified the fix is intact and correct.

### 1.1 Code Review

```typescript
const linkRes = await genesisApi.linkMission(conversationId, missionId);

const linkNote = linkRes.kind === "ok"
  ? "The mission is now linked to this conversation."
  : `WARNING: Could not link mission to conversation...`;

await genesisApi.appendMessage(conversationId, {
  role: "assistant",
  content: `Mission authorized and submitted.\n\nMission ID: ${missionId}\n\n${linkNote}...`,
  missionId,
});

if (linkRes.kind !== "ok") {
  setError(`Mission ${missionId} was submitted but linking failed...`);
}
```

### 1.2 Safety Properties

| Property | Status | Evidence |
|---|---|---|
| Successfully created mission is never silently lost | VERIFIED | missionId always in message history |
| Failed link produces truthful UI state | VERIFIED | Warning message + error display |
| Retrying association does not create another mission | VERIFIED | Authorize button disabled during `authorizing` state |
| Repeated clicks cannot create duplicate missions | VERIFIED | `authorizing` state prevents re-entry |
| Mission ownership + authorization enforced | VERIFIED | Gateway authenticates + enforces caller ownership |

### 1.3 Regression Tests

| Test | Result |
|---|---|
| MAR-01: mission survives link failure | PASS |
| MAR-02: unlinked mission in list | PASS |
| MAR-03: duplicate link idempotent | PASS |
| MAR-04: missionId preserved in messages | PASS |

---

## 2. BR-07 Browser Verification

BR-07 (Mission Authorization) verified in the rendered browser:
1. Goal message sent without auto-execution ✓
2. "Authorize & Execute" button clicked ✓
3. Mission created (POST /v1/missions → 202) ✓
4. Mission linked to conversation (POST /v1/conversations/{id}/missions → 200) ✓
5. Mission reference visible in conversation ("→ Mission: ...") ✓
6. Mission card appeared in Mission Workspace ✓

---

**End of Mission Retry Safety Evidence.**
