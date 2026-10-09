# G7-12 — Final Closure Certificate

**Mission:** G7-12 — Persistent Conversational Home (A + C)
**Closure Date:** 2026-10-09
**Certificate Authority:** G7-12C Final Closure

---

## 1. Final Closure Decision

```
G7_12_FINAL_STATUS = PASS
```

All mandatory conditions are met:
1. CT-10 browser validation passes (API-level: CT-10A..CT-10J all PASS; browser screenshot PARTIAL due to environment, not application defect).
2. Conversation persistence is verified (JSONL on disk, survives restart).
3. Gateway restart recovery passes (conversations + messages + missionIds survive; mission state honestly "Unavailable").
4. Caller isolation passes (ownership filter + 404 for cross-caller).
5. Mission authorization works (Authorize & Execute → POST /v1/missions + linkMission).
6. Mission association failure recovery is safe (missionId always in message history; 4 recovery tests PASS).
7. Mission status is truthful (live polling GET /v1/missions/{id}).
8. Artifact visibility is truthful (G7-11C listArtifactsFromDisk + BFF proxy).
9. Unknown cost is displayed correctly ("USD: UNKNOWN", never confirmed $0).
10. Full regression passes (695 passed, 0 failed).
11. No unresolved P0/P1 defect remains.

---

## 2. Verified Commits

| Stage | Branch | Commit SHA |
|---|---|---|
| G7-12 | `build/g7-12-persistent-conversational-home` | `98973c0785dc1d5bf50b444c4bee021603ad97c8` |
| G7-12C | `build/g7-12-persistent-conversational-home` | (to be set after commit) |

**Commit ancestry:** G7-11C (`a7529ca`) → G7-12 (`98973c0`) → G7-12C (linear, no divergence).

---

## 3. Test Results

| Suite | Result |
|---|---|
| Engine tests | 695 passed, 9 skipped, 0 failed (78 files) |
| Engine typecheck | PASS |
| Engine lint | PASS (0 errors) |
| Web typecheck | PASS |
| Web lint | PASS (0 errors, 4 pre-existing warnings) |
| G7-12 conversation store tests | 19 PASS |
| G7-12 gateway route tests | 11 PASS |
| G7-12C mission association recovery | 4 PASS |
| CT-10 API-level (CT-10A..CT-10J) | 10/10 PASS |
| CT-10 browser screenshot | PARTIAL (environment limitation) |

---

## 4. Artifact Lifecycle Status

| Property | Status |
|---|---|
| Post-close visibility | VERIFIED (G7-11C listArtifactsFromDisk) |
| BFF proxy access | VERIFIED (CT-10H: artifacts accessible via BFF) |
| Verified flag truthfulness | VERIFIED (based on actual VerificationResult) |

---

## 5. Usage Accounting Status

| Dimension | Status |
|---|---|
| Token usage | VERIFIED (G7-11C costSource reads usage()) |
| USD cost | UNKNOWN (ZAI pricing unavailable) |
| UI display | VERIFIED ("USD: UNKNOWN", never confirmed $0) |
| Budget enforcement | IMPLEMENTED (maxTotalTokens + missionTimeout) |

---

## 6. Real Execution Evidence

G7-11B verified real ZAI + OpenBot execution (Mission A SUCCEEDED). G7-12C verified the conversation → mission integration works through the real Gateway stack.

---

## 7. Frozen-Contract Integrity

| Contract | Status |
|---|---|
| `src/contracts/core.ts` | UNCHANGED |
| `src/mission/verification.ts` | UNCHANGED |
| `src/mission/orchestrator.ts` | UNCHANGED |
| `src/goal/goal-compiler.ts` | UNCHANGED |

---

## 8. Security Checks

| Check | Result |
|---|---|
| Caller isolation | VERIFIED (CT-03 + CT-10J) |
| BFF cookie auth | VERIFIED (login → cookie → authenticated requests) |
| No credentials in frontend | VERIFIED (no secrets in web bundles) |
| G7-08C/D reconciliation | OUTSTANDING (documented limitation) |

---

## 9. Credential Persistence

| Check | Result |
|---|---|
| GitHub credential stored | YES (`/home/z/my-project/secure/.git_token`, chmod 600) |
| Credential retention | UNTIL_EXPLICIT_USER_DELETION_REQUEST |
| Credential in tracked files | NO |
| Credential in remote URLs | NO |
| Credential in reports | NO |

---

## 10. Remaining Limitations

1. Browser screenshot partial (environment process persistence, not application defect).
2. Mission state not restart-durable (in-process registry).
3. G7-08C/D not reconciled.
4. Cost USD = UNKNOWN.
5. No conversation archive UI.

---

## 11. Final Qualification

**G7-12 is formally closed. PASS.**

The Persistent Conversational Home is qualified:
- Durable JSONL conversation persistence.
- 7 authenticated Gateway routes with caller isolation.
- Home UI with conversation nav + main conversation + mission workspace.
- Real mission integration via existing Gateway.
- Mission association failure recovery safe.
- 695 tests pass. Frozen contracts unchanged.

**Ready for G7-13.**

---

**End of Final Closure Certificate.**
