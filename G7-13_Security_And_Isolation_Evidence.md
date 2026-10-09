# G7-13 — Security And Isolation Evidence

**Mission:** G7-13 — Durable Projects Repository
**Branch:** `build/g7-13-durable-projects-repository`
**Date:** 2026-10-09

---

## 1. Authentication

Every project endpoint requires Bearer token authentication — same pattern as G7-10/G7-12.

```ts
if (path.startsWith('/v1/projects') && projectStore !== undefined) {
  const caller = authenticate(req, config);
  if (caller === null) {
    sendError(res, 401, 'UNAUTHENTICATED', 'missing or invalid API key');
    return;
  }
  ...
}
```

`authenticate()` uses constant-time comparison across all configured API keys (same implementation reused from `http-server.ts`).

Test evidence: `tests/gateway/g7-13-project-routes.test.ts` — "returns 401 without authentication" PASS.

---

## 2. Owner ID never accepted from client

The `ownerId` field is derived from the authenticated `CallerIdentity.callerId` — clients cannot supply their own.

### 2.1 Create with explicit ownerId → 400

```ts
if (typeof obj.ownerId === 'string') {
  sendError(res, 400, 'OWNER_ID_NOT_ALLOWED', 'ownerId cannot be supplied by the client');
  return true;
}
```

Test: `tests/gateway/g7-13-project-routes.test.ts` — "rejects create with explicit ownerId" → 400 OWNER_ID_NOT_ALLOWED. PASS.

### 2.2 PATCH with explicit ownerId → 400

Same check on the PATCH path.

Test: same file — "rejects PATCH with explicit ownerId" → 400 OWNER_ID_NOT_ALLOWED. PASS.

---

## 3. Cross-Caller Isolation (PR-02, PR-03)

### 3.1 List endpoint filters by callerId

```ts
listProjects(callerId: string, options): { projects: ProjectSummary[]; nextCursor: string | null }
```

Scans all `.project.json` files in the directory; for each, skips records whose `ownerId !== callerId`. A caller cannot enumerate another caller's projects — they don't even appear in the list.

Test: `tests/gateway/g7-13-project-routes.test.ts` — "filters projects by caller ownership" PASS (caller A sees only A's projects; caller B sees only B's).

### 3.2 Get / PATCH / Brief / Overview return 404 for cross-caller

`getProject(projectId, ownerId)` throws `ProjectOwnershipError` if the record's `ownerId !== callerId`. The route handler maps both `ProjectNotFoundError` and `ProjectOwnershipError` to HTTP 404 with `PROJECT_NOT_FOUND` — never 403, to avoid leaking existence (same pattern as G7-10 missions + G7-12 conversations).

Test: `tests/gateway/g7-13-project-routes.test.ts` — "returns 404 when caller B tries to access caller A's project" — covers GET, PATCH, GET brief, GET overview. All return 404. PASS.

### 3.3 No ID-based information leakage

Error messages NEVER include the existence of another caller's project. The 404 `PROJECT_NOT_FOUND` message is identical whether the project doesn't exist or is owned by a different caller.

---

## 4. Mission Ownership Verification (critical rule)

> "A mission ID alone is not proof of ownership."

### 4.1 Server-side verification before linking

`POST /v1/projects/{id}/missions`:

```ts
try {
  deps.missionService.get(missionId, caller);   // throws MissionNotFoundError if not owned
  verifiedAt = new Date().toISOString();
} catch (e) {
  if (e instanceof MissionNotFoundError) {
    sendError(res, 404, 'MISSION_NOT_FOUND', `mission not found or not owned by caller: ${missionId}`);
    return true;
  }
  ...
}
```

`MissionService.get()` throws `MissionNotFoundError` for both "not found" AND "not owned" (intentional ambiguity — same pattern as `requireMission`).

Test: `tests/gateway/g7-13-project-routes.test.ts` — "rejects linking a mission owned by another caller" PASS (caller B tries to link caller A's mission → 404).

### 4.2 Mission unavailable after restart → link rejected

If the in-process `MissionService` registry was wiped (gateway restarted), `MissionService.get()` throws `MissionNotFoundError`. The link is REJECTED — we cannot verify ownership of a mission we cannot retrieve.

Test: `tests/gateway/g7-13-project-routes.test.ts` — PR-11 — "Try to link a NEW mission that doesn't exist in the restarted registry — must be rejected (can't verify ownership)." PASS (404 MISSION_NOT_FOUND on `fake-mission-id`).

Already-verified durable links remain (with `verifiedAt`); the overview shows `availability: "unavailable"` honestly.

---

## 5. Conversation Ownership Verification

`POST /v1/projects/{id}/conversations`:

```ts
try {
  deps.conversationStore.getConversation(conversationId, caller.callerId);
} catch (e) {
  if (e instanceof ConversationNotFoundError || e instanceof ConversationOwnershipError) {
    sendError(res, 404, 'CONVERSATION_NOT_FOUND', `conversation not found: ${conversationId}`);
    return true;
  }
  ...
}
```

`ConversationStore.getConversation()` throws `ConversationNotFoundError` if the conversation doesn't exist, or `ConversationOwnershipError` if it exists but is owned by a different caller. Both map to HTTP 404 — never 403, to avoid leaking existence (same pattern as G7-12).

Test: `tests/gateway/g7-13-project-routes.test.ts` — "PR-08 rejects linking a conversation owned by another caller" PASS (caller B tries to link caller A's conversation → 404).

---

## 6. Artifact Path Safety (PR-12)

### 6.1 Server verifies path existence

`POST /v1/projects/{id}/artifacts`:

```ts
const artifacts = await deps.missionService.getArtifacts(missionId, caller);
const found = artifacts.find((a) => a.path === path && (workerId === undefined || a.workerId === workerId));
if (found === undefined) {
  sendError(res, 404, 'ARTIFACT_NOT_FOUND', `artifact path "${path}" not found in mission ${missionId}'s artifact list`);
  return true;
}
```

The path must exist in the mission's CURRENT artifact list — never caller-supplied directly without verification.

Test: `tests/gateway/g7-13-project-routes.test.ts` — "PR-12 links only verified artifact references (rejects unknown paths)" PASS (404 ARTIFACT_NOT_FOUND on `does-not-exist.md`).

### 6.2 Defense-in-depth path safety

The gateway also rejects paths containing `..`, leading `/`, or null bytes BEFORE calling MissionService — gives a cleaner 400 (vs 404 ARTIFACT_NOT_FOUND that might mislead the caller into thinking the path just isn't in the mission's list).

The store ALSO rejects these paths as defense-in-depth. The path is treated as an opaque string reference, never used as a filesystem path.

Test: `tests/g7-13-project-store.test.ts` — "rejects artifact paths with traversal sequences / absolute paths / null bytes" PASS.

### 6.3 Filesystem traversal prevention

The store never uses the artifact path as a filesystem path. The path is stored as a string reference inside the JSON record; reads come back as opaque strings.

---

## 7. BFF Proxy Hardening

### 7.1 Verified route allowlist extended

`web/src/app/api/genesis/[...path]/route.ts` — `VERIFIED_PATTERNS`:

```ts
{ re: /^\/v1\/projects$/, methods: ["GET", "POST"] },
{ re: /^\/v1\/projects\/[^/]+$/, methods: ["GET", "PATCH"] },
{ re: /^\/v1\/projects\/[^/]+\/brief$/, methods: ["GET", "PUT"] },
{ re: /^\/v1\/projects\/[^/]+\/overview$/, methods: ["GET"] },
{ re: /^\/v1\/projects\/[^/]+\/conversations$/, methods: ["POST"] },
{ re: /^\/v1\/projects\/[^/]+\/missions$/, methods: ["POST"] },
{ re: /^\/v1\/projects\/[^/]+\/artifacts$/, methods: ["POST"] },
```

Any path not matching → 404 NOT_FOUND. No bypass through the BFF.

### 7.2 Path segment safety

`isSafeSegment(decoded)` rejects:
- Empty segments.
- `.` or `..`.
- Null bytes / control chars (0x00-0x1F, 0x7F).
- Encoded null bytes (`%00`).
- Leading slash.

### 7.3 Method allowlist extended

`ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT"])` — PUT added for Brief updates.

### 7.4 Body reading for PUT

The body-reading branch was extended from `["POST", "PATCH"]` to `["POST", "PATCH", "PUT"]`.

### 7.5 No new CORS relaxations

The same-origin UI doesn't need preflight; cross-origin callers are blocked by the browser's same-origin policy AND the SameSite cookie.

### 7.6 Secret redaction in error bodies

`redactSecrets()` scrubs:
- GitHub PATs (`ghp_…`)
- OpenAI-style keys (`sk-…`)
- Authorization headers (`Bearer …`)
- Environment-variable leaks (`GENESIS_API_KEYS=…`, `ZAI_API_KEY=…`, `ZAI_SDK_PATH=…`)

Defense-in-depth on top of the gateway's G6-09C scrubbing.

---

## 8. Project File Safety

### 8.1 Project IDs are filesystem-safe

`projectId` is a UUID generated by `randomUUID()`. The store validates it with `isSafeIdSegment()` before using it as a filename — rejects `/`, `\`, `..`, control chars, null bytes.

### 8.2 Temp file naming

`tmpPath` includes the PID and a timestamp to prevent collisions across concurrent writes within the same process: `.tmp.{projectId}.{process.pid}.{Date.now()}.project.json`.

### 8.3 Temp file cleanup on failure

```ts
catch (err) {
  try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* best-effort */ }
  throw err;
}
```

The temp file is removed on write failure; the previous valid file is preserved.

### 8.4 Corrupt records never silently replaced

If a project file is corrupt (JSON parse failure, missing required fields, unsupported `schemaVersion`), `readProject()` returns `undefined`. The caller surfaces `ProjectNotFoundError`. The corrupt file remains on disk for manual recovery.

---

## 9. Provenance and Approval Integrity (PR-06)

### 9.1 Three-state provenance

```ts
type BriefProvenance = "USER_APPROVED" | "SOURCE_VERIFIED" | "DRAFT";
```

- `USER_APPROVED` — requires a `source` field (the approver identity, e.g., `operator:maya`).
- `SOURCE_VERIFIED` — requires a `source` field (the durable reference, e.g., `mission:abc-123`).
- `DRAFT` — `source` is absent; the entry is a proposal, not an approved decision.

### 9.2 Validation enforces the distinction

`validateBriefEntries()` rejects:
- `USER_APPROVED` entries without a `source`.
- `SOURCE_VERIFIED` entries without a `source`.
- Duplicate entry IDs.
- Empty text.
- Text exceeding the 1000-char limit.

Test: `tests/g7-13-project-store.test.ts` — "PR-06 preserves the distinction between DRAFT, USER_APPROVED, SOURCE_VERIFIED" + "rejects USER_APPROVED entry without a source" + "rejects SOURCE_VERIFIED entry without a source" + "rejects duplicate entry ids" — ALL PASS.

### 9.3 Brief updates cannot promote DRAFT to USER_APPROVED silently

The Brief editor only accepts caller-supplied `approvedDecisions` and `completedMilestones` arrays. Each entry's provenance is verified by `validateBriefEntries`. A draft cannot become approved without an explicit `USER_APPROVED` provenance + source.

### 9.4 Approved decisions / completed milestones are read-only in the create path

`createProject` does NOT accept `approvedDecisions` or `completedMilestones` in the seed Brief — a project starts with no approved decisions or completed milestones. They can only be added later via `updateBrief` with explicit provenance + source.

---

## 10. Secrets in Source Control

- No secrets in any tracked file (verified via `git log -p` after the G7-13 commits).
- The GitHub credential used for cloning the repository is stored only in `/home/z/my-project/.secure/.git_token` (chmod 600, not tracked).
- No `.env` files committed (the project's `.gitignore` excludes them).
- No new environment variables introduced that require secret values for production.

---

## 11. No Security Bypass Introduced

- No new endpoint bypasses the `authenticate()` check.
- No new endpoint accepts `ownerId` from the client.
- No new endpoint returns 200/201 on a non-existent or non-owned resource.
- No new endpoint fabricates state when the authoritative source is unavailable.
- No new file in `src/` weakens the existing security posture.
- BFF proxy verified-route allowlist extended with project routes; no new bypass paths introduced.

---

## 12. Outstanding Security Debt (carried from G7-12, NOT introduced by G7-13)

1. **G7-08C/D reconciliation outstanding** — rate-limiting + AuthGate hardening still in Z.ai Preview only. Not in G7-13 scope.
2. **Cookie configuration requires security hardening before public deployment** — `SameSite=Lax` (changed from `Strict` in G7-12D for broader browser compatibility) and the `GENESIS_COOKIE_SECURE` override must be reviewed before public deployment.
3. **Single-factor PIN model** — suitable for controlled environments with operator-only network access; NOT for untrusted network exposure without additional layers (rate limiting, IP allow-list, mTLS, OAuth).
4. **All BFF sessions share the single GENESIS_API_KEY callerId** — no multi-user isolation. The `operatorId` field records WHICH operator authenticated via PIN (for audit logging only).
5. **Mission association duplicate-prevention across retries** — idempotent at the store level (same missionId twice = no-op), but cross-retry end-to-end guarantees would require durable mission-state — out of scope.

---

## 13. Test Evidence Index (security-focused)

| Test | File | Result |
|---|---|---|
| returns 401 without authentication | `tests/gateway/g7-13-project-routes.test.ts` | PASS |
| filters projects by caller ownership | `tests/gateway/g7-13-project-routes.test.ts` | PASS |
| returns 404 when caller B tries to access caller A's project (GET/PATCH/brief/overview) | `tests/gateway/g7-13-project-routes.test.ts` | PASS (×4) |
| rejects create with explicit ownerId | `tests/gateway/g7-13-project-routes.test.ts` | PASS |
| rejects PATCH with explicit ownerId | `tests/gateway/g7-13-project-routes.test.ts` | PASS |
| PR-08 rejects linking a conversation owned by another caller | `tests/gateway/g7-13-project-routes.test.ts` | PASS |
| rejects linking a mission owned by another caller | `tests/gateway/g7-13-project-routes.test.ts` | PASS |
| rejects mission link to a mission unavailable after restart | `tests/gateway/g7-13-project-routes.test.ts` | PASS |
| PR-12 links only verified artifact references (rejects unknown paths) | `tests/gateway/g7-13-project-routes.test.ts` | PASS |
| rejects artifact path traversal attempts | `tests/gateway/g7-13-project-routes.test.ts` | PASS |
| PR-09 rejects assigning one conversation to two projects | `tests/gateway/g7-13-project-routes.test.ts` | PASS |
| PR-16 rejects conflicting idempotency-key reuse (×3) | `tests/g7-13-project-store.test.ts` + `tests/gateway/g7-13-project-routes.test.ts` | PASS (×3) |
| PR-06 preserves DRAFT / USER_APPROVED / SOURCE_VERIFIED distinction | `tests/g7-13-project-store.test.ts` | PASS |
| rejects USER_APPROVED entry without source | `tests/g7-13-project-store.test.ts` | PASS |
| rejects SOURCE_VERIFIED entry without source | `tests/g7-13-project-store.test.ts` | PASS |
| rejects duplicate entry ids | `tests/g7-13-project-store.test.ts` | PASS |
| rejects artifact path traversal sequences (store-level) | `tests/g7-13-project-store.test.ts` | PASS |
| rejects artifact absolute paths (store-level) | `tests/g7-13-project-store.test.ts` | PASS |
| rejects artifact null-byte paths (store-level) | `tests/g7-13-project-store.test.ts` | PASS |
| rejects malformed conversationId (store-level) | `tests/g7-13-project-store.test.ts` | PASS |

---

**End of Security And Isolation Evidence.**
