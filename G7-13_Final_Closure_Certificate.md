# G7-13 — Final Closure Certificate

**Mission:** G7-13 — Durable Projects Repository
**Closure Date:** 2026-10-09
**Certificate Authority:** G7-13 Final Closure

---

## 1. Final Closure Decision

```
G7_13_FINAL_STATUS = PARTIAL
```

The mission is **functionally complete and ready for architect review**, with one documented environment limitation:

- ✅ All 18 mandatory acceptance scenarios PR-01..PR-18 PASS with actual evidence (no fabricated results).
- ⚠️ PR-19 + PR-20 (rendered-browser) are NOT_EXECUTED due to the AuthGate stall (same Next.js HMR WebSocket environment limitation documented in G7-12D). API-level coverage (AP-01..AP-06) confirms the full stack works end-to-end through the BFF, but per the spec this does NOT substitute for rendered-browser tests.
- ✅ All 4 checkpoints (A/B/C/D) passed their internal quality gates.
- ✅ All quality gates (engine tests, web typecheck, lint, frozen contracts) pass with no regressions.
- ✅ No frozen contract modifications.
- ✅ No new external dependencies.

Per spec: "Do not mark the mission PASS unless every mandatory acceptance gate is supported by actual evidence." Because PR-19 and PR-20 are NOT_EXECUTED (no actual rendered-browser evidence), the status is PARTIAL.

---

## 2. Verified Commits

| Stage | Branch | Commit SHA |
|---|---|---|
| G7-12 baseline | `build/g7-12-persistent-conversational-home` | `86de84756aa730cf8d01125770a078bea1d4801c` |
| G7-13A+B (Store + Gateway) | `build/g7-13-durable-projects-repository` | `f37bddd` |
| G7-13C (Web integration) | `build/g7-13-durable-projects-repository` | `83c4836` |
| G7-13D (Acceptance + reports) | `build/g7-13-durable-projects-repository` | `b779fb1185b40ec01f0e6e31e3621f5a49964e37` |

**Commit ancestry:** G7-12D (`86de847`) → G7-13A+B (`f37bddd`) → G7-13C (`83c4836`) → G7-13D (this commit). Linear, no divergence from the G7-12 baseline.

---

## 3. Test Results

| Suite | Result |
|---|---|
| Engine tests | 756 passed, 9 skipped, 0 failed (80 files) — was 695/9/0 at G7-12 (+61 new) |
| Engine typecheck | PASS |
| Engine lint | PASS (0 errors) |
| Web typecheck | PASS |
| Web lint | PASS (0 errors, 4 pre-existing warnings) |
| G7-13 store tests | 35 PASS |
| G7-13 gateway tests | 26 PASS |
| AP-01..AP-06 (API-level browser coverage) | 6/6 PASS |
| PR-01..PR-18 acceptance scenarios | 18/18 PASS (with actual evidence) |
| PR-19..PR-20 rendered-browser tests | NOT_EXECUTED (AuthGate stall — environment limitation, same as G7-12D) |

---

## 4. Persistence Status

| Property | Status |
|---|---|
| Project metadata atomic write | VERIFIED (PR-17: corrupt file preserved, never silently replaced) |
| Project Brief durability across restart | VERIFIED (PR-04) |
| Brief revision conflict rejection | VERIFIED (PR-05) |
| Conversation link durability | VERIFIED (PR-07) |
| Mission link durability + UNAVAILABLE state | VERIFIED (PR-11) |
| Artifact reference durability + MISSING/UNAVAILABLE states | VERIFIED (PR-13) |
| Idempotency (create + link + conflict detection) | VERIFIED (PR-14, PR-15, PR-16) |
| Cross-project conversation uniqueness | VERIFIED (PR-09) |

---

## 5. Security Status

| Property | Status |
|---|---|
| Authentication (Bearer) on every project endpoint | VERIFIED |
| ownerId never accepted from client | VERIFIED (PR: 400 OWNER_ID_NOT_ALLOWED) |
| Cross-caller isolation (404 not 403) | VERIFIED (PR-02, PR-03) |
| Mission ownership verification before linking | VERIFIED (PR-08, PR-10, PR-11) |
| Conversation ownership verification before linking | VERIFIED (PR-08) |
| Artifact path existence verification before linking | VERIFIED (PR-12) |
| Path traversal prevention (store + gateway) | VERIFIED |
| Brief provenance distinction (USER_APPROVED / SOURCE_VERIFIED / DRAFT) | VERIFIED (PR-06) |
| BFF verified-route allowlist extended | VERIFIED (no new bypass) |
| Secret redaction in error bodies | VERIFIED (inherited from G6-09C) |

---

## 6. Frozen-Contract Integrity

| Contract | Status |
|---|---|
| `src/contracts/core.ts` | UNCHANGED (0 diff lines vs `86de847`) |
| `src/mission/verification.ts` | UNCHANGED |
| `src/mission/orchestrator.ts` | UNCHANGED |
| `src/goal/goal-compiler.ts` | UNCHANGED |

Verified via `git diff origin/build/g7-12-persistent-conversational-home -- <frozen files>` returns empty output.

---

## 7. Files Changed

| Category | Count | Files |
|---|---|---|
| New engine source | 1 | `src/project/project-store.ts` |
| New gateway source | 1 | `src/gateway/project-routes.ts` |
| Modified gateway source | 2 | `src/gateway/http-server.ts`, `src/gateway/main.ts` |
| New tests | 2 | `tests/g7-13-project-store.test.ts`, `tests/gateway/g7-13-project-routes.test.ts` |
| New web source | 1 | `web/src/components/genesis/ProjectsSection.tsx` |
| Modified web source | 6 | `web/src/lib/genesis/types.ts`, `web/src/lib/genesis/client.ts`, `web/src/lib/genesis/store.ts`, `web/src/app/api/genesis/[...path]/route.ts`, `web/src/components/genesis/AppShell.tsx`, `web/src/components/genesis/GenesisApp.tsx`, `web/src/components/genesis/HomeSection.tsx` |
| New scripts | 1 | `scripts/g7-13d-browser-full.cjs` |
| New reports | 5 | `G7-13_Implementation_Report.md`, `G7-13_Persistence_And_Recovery_Evidence.md`, `G7-13_Security_And_Isolation_Evidence.md`, `G7-13_Browser_Acceptance_Report.md`, `G7-13_Final_Closure_Certificate.md` (this file) |
| Modified config | 1 | `eslint.config.js` (added the browser script to the test-tooling exclusion) |
| **Total** | 20 | |

---

## 8. New Dependencies

**NONE.**

G7-13 reuses:
- `node:crypto` (`randomUUID`, `createHash`) — already used by G7-12.
- `node:fs` (`existsSync`, `mkdirSync`, `readFileSync`, `writeFileSync`, `renameSync`, `readdirSync`, `unlinkSync`) — already used.
- `node:path` (`join`) — already used.
- `node:http` (`createServer`, `IncomingMessage`, `ServerResponse`) — already used by the gateway.
- Existing `FileConversationStore`, `MissionService`, `CallerIdentity`, `authenticate()` — reused unchanged.

---

## 9. Known Limitations

1. **Browser PR-19 + PR-20 NOT_EXECUTED** — AuthGate stall (environment limitation, same as G7-12D). API-level coverage (AP-01..AP-06) confirms the full stack works end-to-end but does NOT substitute for rendered-browser tests per spec.
2. **Mission state not restart-durable** — same as G7-12. Durable mission references remain; live state shows UNAVAILABLE honestly.
3. **G7-08C/D reconciliation outstanding** — same as G7-12.
4. **USD cost may stay UNKNOWN** — same as G7-12.
5. **Cookie configuration requires security hardening before public deployment** — same as G7-12D.
6. **Single-process file-based concurrency** — same as G7-12.
7. **Mission association duplicate-prevention across retries** — same as G7-12C/D.
8. **No conversation archive UI** — same as G7-12; the project metadata editor DOES expose project archive.

---

## 10. Deferred Items

- Rendered-browser tests for PR-19 + PR-20 (require resolving the Next.js HMR WebSocket environment limitation — same blocker as G7-12D).
- Cross-process file locking (would need a real multi-instance deployment to motivate).
- Conversation archive/restore UI (the store supports `status: "archived"` but the UI does not expose archive/restore actions for conversations).
- Project Brief collaborative editing (current model is single-operator optimistic revision; multi-user concurrent editing would require server-side conflict resolution UI).

---

## 11. Security Checks

| Check | Result |
|---|---|
| Caller isolation | VERIFIED (PR-02, PR-03, PR-08, PR-09) |
| Mission ownership verification | VERIFIED (PR-10, PR-11, "rejects linking a mission owned by another caller") |
| Artifact path verification | VERIFIED (PR-12, "rejects artifact path traversal attempts") |
| BFF cookie auth | VERIFIED (inherited from G7-12, no changes) |
| No credentials in frontend | VERIFIED (no secrets in web bundles; BFF attaches the API key server-side) |
| ownerId never accepted from client | VERIFIED (PR: 400 OWNER_ID_NOT_ALLOWED) |
| G7-08C/D reconciliation | OUTSTANDING (documented limitation, same as G7-12) |
| No new security bypass | VERIFIED (verified-route allowlist extended, no new bypass) |
| Secrets in source control | NONE |

---

## 12. Credential Persistence

| Check | Result |
|---|---|
| GitHub credential stored | YES (`/home/z/my-project/.secure/.git_token`, chmod 600) |
| Credential retention | UNTIL_EXPLICIT_USER_DELETION_REQUEST |
| Credential in tracked files | NO |
| Credential in remote URLs | NO (used `git credential helper store` with `GIT_CONFIG_GLOBAL` pointing to a non-tracked file) |
| Credential in reports | NO |

---

## 13. Final Qualification

**G7-13 is functionally complete and ready for architect review. PARTIAL.**

The Durable Projects Repository is qualified:
- Durable atomic JSON project persistence with crash-conscious writes.
- Revision-controlled Project Brief with optimistic concurrency.
- Three-state provenance (USER_APPROVED / SOURCE_VERIFIED / DRAFT) — drafts never silently promoted.
- 10 authenticated Gateway routes with caller ownership + ownership verification for relationship links.
- Truthful overview derivation — available / missing / unavailable states, never fabricated.
- Idempotency keys surviving Gateway restart for create + link operations.
- Cross-project conversation uniqueness invariant.
- Cross-caller isolation (404 not 403) consistent with G7-10/G7-12.
- BFF proxy extended with project routes; no security bypass introduced.
- ProjectsSection UI with list + detail + Brief editor + relationships grid + project settings.
- HomeSection integration with optional project context.
- 61 new tests covering PR-01..PR-18.
- 756 total tests pass (was 695 at G7-12); 9 skipped (same as G7-12); 0 failed.
- Frozen contracts unchanged.
- No new dependencies.

**Ready for architect review.** PR-19 + PR-20 rendered-browser tests remain NOT_EXECUTED pending environment infrastructure (same blocker as G7-12D).

---

## 14. Final Response Contract

```text
PROJECT = AgentCraft Genesis
MISSION = G7-13 — Durable Projects Repository

STATUS = PARTIAL

STARTING_COMMIT = 86de84756aa730cf8d01125770a078bea1d4801c
DEVELOPMENT_BRANCH = build/g7-13-durable-projects-repository
FINAL_LOCAL_HEAD = b779fb1185b40ec01f0e6e31e3621f5a49964e37
REMOTE_PUSH = NOT_AUTHORIZED

CHECKPOINT_A_STORE = PASS
CHECKPOINT_B_GATEWAY = PASS
CHECKPOINT_C_WEB = PASS
CHECKPOINT_D_ACCEPTANCE = PARTIAL (PR-19/PR-20 NOT_EXECUTED due to environment limitation)

PROJECT_PERSISTENCE = PASS
PROJECT_BRIEF = PASS
PROVENANCE_AND_APPROVAL = PASS
CONVERSATION_LINKING = PASS
MISSION_LINKING = PASS
ARTIFACT_LINKING = PASS
OWNER_ISOLATION = PASS
RESTART_RECOVERY = PASS
IDEMPOTENCY = PASS
BACKWARD_COMPATIBILITY = PASS

ENGINE_TESTS = 756 passed, 9 skipped, 0 failed (80 files)
WEB_TYPECHECK = PASS
ENGINE_TYPECHECK = PASS
LINT = PASS (0 errors engine + 0 errors web; 4 pre-existing web warnings)
BROWSER_ACCEPTANCE = NOT_EXECUTED (PR-19/PR-20 — environment limitation, same as G7-12D)
FROZEN_CONTRACTS = UNCHANGED (0 diff lines)

FILES_CHANGED = 20 (1 new engine source, 1 new gateway source, 2 modified gateway source, 2 new tests, 1 new web source, 6 modified web source, 1 new script, 5 new reports, 1 modified config)
NEW_DEPENDENCIES = NONE
KNOWN_LIMITATIONS =
  1. Browser PR-19 + PR-20 NOT_EXECUTED — AuthGate stall (env limitation, same as G7-12D).
  2. Mission state not restart-durable (same as G7-12).
  3. G7-08C/D reconciliation outstanding (same as G7-12).
  4. USD cost may stay UNKNOWN (same as G7-12).
  5. Cookie config requires security hardening before public deployment (same as G7-12D).
  6. Single-process file-based concurrency (same as G7-12).
  7. Mission association duplicate-prevention across retries needs stronger end-to-end guarantees (same as G7-12C/D).
  8. No conversation archive UI (same as G7-12; project archive UI IS exposed).
DEFERRED_ITEMS =
  - Rendered-browser tests for PR-19 + PR-20 (require resolving the Next.js HMR WebSocket environment limitation).
  - Cross-process file locking (would need a real multi-instance deployment to motivate).
  - Conversation archive/restore UI (store supports it; UI does not expose it).
  - Project Brief collaborative editing (single-operator optimistic revision only).
BLOCKERS = NONE (PARTIAL status is due to environment limitation, not a code defect)

READY_FOR_ARCHITECT_REVIEW = YES
```

---

## 15. Report Paths

1. `G7-13_Implementation_Report.md` — full implementation summary + files changed + architecture + acceptance matrix + known limitations + scope boundaries.
2. `G7-13_Persistence_And_Recovery_Evidence.md` — atomic write verification + restart recovery + idempotency + brief revision conflicts + cross-project uniqueness + truthful recovery behavior + test evidence index.
3. `G7-13_Security_And_Isolation_Evidence.md` — authentication + ownerId rejection + cross-caller isolation + ownership verification (mission/conversation/artifact) + path safety + BFF proxy hardening + provenance integrity + secrets-in-source-control + outstanding security debt.
4. `G7-13_Browser_Acceptance_Report.md` — test environment + rendered-browser NOT_EXECUTED + API-level coverage PASS + screenshots + comparison with G7-12D + results summary.
5. `G7-13_Final_Closure_Certificate.md` (this file) — final closure decision + verified commits + test results + persistence/security/frozen-contract status + files changed + new dependencies + known limitations + deferred items + final response contract.

---

## 16. Significant Architectural Choices

1. **Single atomic JSON file per project** (instead of G7-12's `.conv/.msgs` split): a project record has no append-only event stream. The single rewrite-by-id file keeps the project atomic, simplifies restart recovery, and explicitly follows the spec's guidance to "prefer a compact per-project durable record where this reduces consistency risks."

2. **Idempotency keys stored inside the project record** (not in a separate ledger): avoids the multi-file consistency risk that the spec explicitly calls out. The trade-off is O(projects) scan for create-idempotency lookup — acceptable for the expected scale (single-digit-to-dozens of projects per owner) and the project store has bounded file growth.

3. **Server-side ownership verification for ALL relationship links** (the critical "a mission ID alone is not proof of ownership" rule): the gateway calls `ConversationStore.getConversation()` / `MissionService.get()` / `MissionService.getArtifacts()` BEFORE calling the store's link methods. After restart, when the in-process `MissionService` registry is wiped, link attempts to unverifiable missions are REJECTED — the durable `verifiedAt` timestamp on existing links preserves the proof that ownership WAS verified at link time.

4. **Truthful overview derivation from authoritative sources** (never fabricated): the overview endpoint reads from `FileProjectStore` (durable metadata + Brief) + `FileConversationStore` (verifies ownership) + `MissionService.get()` (live state, throws on missing) + `MissionService.getArtifacts()` (re-verifies path against current list). Unavailable missions show `availability: "unavailable"`; missing artifacts show `availability: "missing"`.

5. **Three-state Brief provenance (USER_APPROVED / SOURCE_VERIFIED / DRAFT)** enforced at the store layer: USER_APPROVED and SOURCE_VERIFIED entries REQUIRE a `source` field (approver identity / durable reference respectively). Drafts can never silently become approved decisions. Approved decisions and completed milestones are read-only in the create path — they can only be added via `updateBrief` with explicit provenance.

6. **Cross-caller isolation uses 404 (not 403)** — same pattern as G7-10 missions + G7-12 conversations. The error code `PROJECT_NOT_FOUND` is returned for both "doesn't exist" and "owned by another caller" — no information leakage.

7. **BFF verified-route allowlist extended, no security bypass introduced**: 7 new project patterns + PUT method + PUT body reading. The same path-segment safety filter (`isSafeSegment`) and secret redaction (`redactSecrets`) apply to project routes.

8. **HomeSection optional project context**: when `activeProjectId` is set in the Zustand store, new conversations created in Home auto-link to the active project. The link call is non-blocking — if linking fails, the conversation is still created and usable; the user can retry linking from the Projects detail view. This avoids the silent-failure pattern that affected G7-12C's mission-association recovery.

9. **No frozen contract modifications**: the four frozen files (`core.ts`, `verification.ts`, `orchestrator.ts`, `goal-compiler.ts`) are untouched. G7-13 lives entirely in the gateway + project + web layers.

10. **No new external dependencies**: G7-13 reuses existing `node:crypto`, `node:fs`, `node:path`, `node:http`. No PostgreSQL, Redis, SQLite, vector DB, ORMs, queues, or external storage dependencies.

---

**End of Final Closure Certificate.**
