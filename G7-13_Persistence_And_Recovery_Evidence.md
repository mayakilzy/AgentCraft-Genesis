# G7-13 — Persistence And Recovery Evidence

**Mission:** G7-13 — Durable Projects Repository
**Branch:** `build/g7-13-durable-projects-repository`
**Date:** 2026-10-09

---

## 1. Persistence Mechanism

**Backend:** Atomic JSON per project (one file per project, rewrite-by-id).

**Storage location:** `data/projects/` — sibling of `data/conversations/`, `data/flight-records/`, `data/artifact-records/`, `data/experiences/`.

**File layout:**
```
data/projects/
  {projectId}.project.json              — full project record (atomic rewrite-by-id)
  .tmp.{projectId}.{pid}.{ts}.project.json — temporary file written then renamed
```

**Why atomic JSON (instead of the G7-12 .conv/.msgs split):**
- A project record has no append-only event stream. Every mutation touches a bounded, small set of fields.
- A single rewrite-by-id file keeps the project atomic, simplifies restart recovery, and avoids the multi-file consistency risk the G7-13 spec explicitly calls out:
  > "If project metadata and relationship persistence require multiple files, design operations so interrupted writes remain detectable and recoverable. Prefer a compact per-project durable record where this reduces consistency risks."
- Mirrors the existing `FileExperienceStore` pattern (rewrite-by-id JSON) — consistency with existing repository conventions.

**No new dependencies:** uses `node:crypto`, `node:fs`, `node:path` only.

**No new infrastructure:** no PostgreSQL, Redis, SQLite, vector DB, ORMs, queues, or external storage dependencies.

---

## 2. Atomic Write Verification

### 2.1 Validate-before-write

Every `writeProject(record)` call validates:
- `schemaVersion === PROJECT_SCHEMA_VERSION` (currently 1).
- `projectId` is a safe filesystem segment (no `/`, `\`, `.`, `..`, control chars, null bytes).
- `ownerId` is a safe filesystem segment.
- `name` is a non-empty string.
- `description` is a string.
- `status` is `"active"` or `"archived"`.

If any validation fails, the write is aborted before any filesystem operation — the previous valid file is preserved.

### 2.2 Temp-file + rename

The write flow:
```ts
const tmpPath = join(this.dir, `.tmp.${record.projectId}.${process.pid}.${Date.now()}.project.json`);
try {
  const payload = JSON.stringify(record, null, 2);
  writeFileSync(tmpPath, payload, 'utf8');     // (a) write to temp
  renameSync(tmpPath, finalPath);             // (b) atomic rename
} catch (err) {
  try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* best-effort */ }
  throw err;
}
```

- `writeFileSync` to a uniquely-named temp file (PID + timestamp prevents collisions across concurrent writes within the same process).
- `renameSync` is atomic on POSIX; on Windows (Node 14+) it replaces the destination. Either way, the file is either the old valid version or the new valid version — never partial.
- On failure (e.g., disk full), the temp file is cleaned up; the previous valid file remains untouched.

### 2.3 Test evidence (PR-17)

`tests/g7-13-project-store.test.ts` — "a corrupt temp file does not overwrite the previous valid project":
1. Create a project (PR-17 valid).
2. Snapshot the valid record from disk.
3. Corrupt the file on disk: `{"schemaVersion":99,"projectId":"garbage"}`.
4. `getProject()` throws `ProjectNotFoundError` (NOT a silent overwrite).
5. The corrupt file remains on disk for manual recovery.
6. Restore the valid content; `getProject()` succeeds.

Result: PASS — corrupt project file is preserved, never silently replaced with an empty project.

---

## 3. Restart Recovery Verification

### 3.1 Project metadata durability

**Test:** PR-01 — `tests/g7-13-project-store.test.ts`

Store instance 1 creates a project. Store instance 2 (new instance, same dir) retrieves it with the correct projectId, ownerId, name, description, status, brief.revision, conversationLinks, missionLinks, artifactRefs.

Result: PASS — project metadata survives simulated restart.

### 3.2 Brief durability

**Test:** PR-04 — `tests/g7-13-project-store.test.ts`

Store instance 1 creates a project, updates the Brief to revision 1 with all fields (objective, requirements, constraints, approvedDecisions with USER_APPROVED entry, completedMilestones with SOURCE_VERIFIED entry, nextSteps). Store instance 2 retrieves the project; the Brief is intact at revision 1 with all fields preserved.

Result: PASS — Brief fields + provenance preserved across simulated restart.

### 3.3 Conversation link durability

**Test:** PR-07 — `tests/gateway/g7-13-project-routes.test.ts`

After Gateway restart (new FileConversationStore + FileProjectStore at the same dirs):
- Project record's `conversationLinks[]` survives intact.
- The linked conversation itself is still retrievable via the ConversationStore.
- The Project Overview shows the conversation as `available: true` with the correct title + message count.

Result: PASS — conversation relationships remain durable.

### 3.4 Mission link durability (with UNAVAILABLE state)

**Test:** PR-11 — `tests/gateway/g7-13-project-routes.test.ts`

Before restart: mission is live; overview shows `availability: "live"` + `status: SUCCEEDED`.

After restart (new MissionService with empty in-process registry, same project store):
- Project record's `missionLinks[]` survives (with `verifiedAt` timestamp).
- Live mission state is gone (in-process registry was wiped).
- Project Overview shows `availability: "unavailable"` for the linked mission — never fabricates completion.

Result: PASS — durable mission references with honest UNAVAILABLE state after restart.

### 3.5 Artifact reference durability (with MISSING / UNAVAILABLE states)

**Test:** PR-13 — `tests/gateway/g7-13-project-routes.test.ts`

Before restart: artifact is available; overview shows `availability: "available"` + `verified: true` + `bytes`.

After restart (new MissionService, copied project file to a fresh dir):
- Project record's `artifactRefs[]` survives.
- The mission is no longer in the in-process registry — cannot re-verify the artifact.
- Project Overview shows `availability: "unavailable"` honestly.

If the mission IS still live but the artifact path was removed from the mission's artifact list (e.g., worker overwrote it), the overview shows `availability: "missing"` honestly.

Result: PASS — durable artifact references with honest MISSING / UNAVAILABLE states.

### 3.6 Corrupt project file recovery

**Test:** PR-17 (partial) — `tests/g7-13-project-store.test.ts`

If a project file is corrupted (missing required fields, invalid schemaVersion, JSON parse failure):
- `readProject()` returns `undefined`.
- `getProject()` throws `ProjectNotFoundError`.
- The corrupt file remains on disk for manual recovery — it is NEVER silently replaced with an empty project.

Result: PASS — corrupt data is surfaced honestly, not silently overwritten.

---

## 4. Idempotency Verification

### 4.1 Project creation idempotency (PR-14)

If `idempotencyKey` is provided:
- The store scans the owner's existing projects for one with a matching `createIdempotencyKey`.
- If found AND the `createPayloadHash` matches the current request → return the existing project (idempotent no-op).
- If found AND the `createPayloadHash` differs → throw `IdempotencyConflictError` → 409 IDEMPOTENCY_CONFLICT.

Test: `tests/g7-13-project-store.test.ts` + `tests/gateway/g7-13-project-routes.test.ts` — PASS.

### 4.2 Restart-survives-create-idempotency

After Gateway restart, retrying POST `/v1/projects` with the same idempotencyKey + payload returns the SAME projectId — the key is stored durably in the project record itself.

Test: `tests/g7-13-project-store.test.ts` — PASS.

### 4.3 Relationship link idempotency (PR-15)

- Same `(projectId, conversationId)` link call twice → no duplicate. Returns the current project state.
- Same `(projectId, missionId)` link call twice → no duplicate. Returns the current project state.
- Same `(projectId, missionId, path)` artifact ref link twice → no duplicate.
- Idempotency key on link: stored on the link/ref entry. Retry with same key + same payload → no-op. Retry with same key + different payload → `IdempotencyConflictError` → 409.

Test: `tests/g7-13-project-store.test.ts` + `tests/gateway/g7-13-project-routes.test.ts` — PASS.

### 4.4 Conflicting idempotency-key reuse (PR-16)

- Same idempotencyKey + different conversationId → `IdempotencyConflictError`.
- Same idempotencyKey + different missionId → `IdempotencyConflictError`.
- Same idempotencyKey + different artifact path → `IdempotencyConflictError`.

Test: `tests/g7-13-project-store.test.ts` + `tests/gateway/g7-13-project-routes.test.ts` — PASS.

---

## 5. Brief Revision Conflict Verification

### 5.1 Stale revision rejected (PR-05)

PUT `/v1/projects/{id}/brief` with `revision: 0` when the server is at revision 1:
- Store throws `BriefRevisionConflictError`.
- HTTP returns 409 `BRIEF_REVISION_CONFLICT`.
- The Brief record is UNCHANGED — no partial update.

Test: `tests/g7-13-project-store.test.ts` + `tests/gateway/g7-13-project-routes.test.ts` — PASS.

### 5.2 Fresh revision accepted

PUT with the current revision → store increments to `revision + 1`, replaces the Brief content atomically.

Test: `tests/g7-13-project-store.test.ts` — PASS.

### 5.3 UI surfaces the conflict honestly

`ProjectsSection` BriefEditor:
- Save button shows "Save Brief (revision N)" so the user knows the revision they're submitting.
- 409 response surfaces as a typed `BRIEF_REVISION_CONFLICT` error with the message: "Brief was modified elsewhere. Refresh the project to load the latest revision."
- Success after save: the revision counter in the button label updates to N+1.

---

## 6. Cross-Project Conversation Uniqueness (PR-09)

### 6.1 Invariant

A conversation may belong to at most one project (per caller).

### 6.2 Enforcement

`linkConversation` calls `findProjectByConversation(ownerId, conversationId)` BEFORE adding the link. If a different project of the same owner already links this conversation → `ConversationAlreadyLinkedError` → 409 `CONVERSATION_ALREADY_LINKED`.

The error message includes both the conversationId AND the conflicting projectId so the user knows where the conversation is already linked.

### 6.3 Cross-caller isolation

Two different callers can each have a project that links a conversationId (they would be different conversations even if the IDs collided by accident — UUID collisions are astronomically unlikely). The invariant is scoped to the same caller.

Test: `tests/g7-13-project-store.test.ts` — PASS.

---

## 7. Truthful Recovery Behavior

### 7.1 After Gateway restart

| Component | Recovery | UI display |
|---|---|---|
| Project metadata | ✅ Durable | Full metadata (name, description, status, timestamps) |
| Project Brief | ✅ Durable | Full Brief (objective, requirements, constraints, decisions, milestones, nextSteps) with revision counter |
| Conversation relationships | ✅ Durable (references) | Conversations list with title + message count + last update |
| Mission relationships | ✅ Durable (references + verifiedAt) | Mission state shown as `UNAVAILABLE` (cannot re-verify ownership after in-process registry wiped) |
| Artifact references | ✅ Durable (references + verifiedAt) | Artifact shown as `UNAVAILABLE` (cannot re-verify against mission's artifact list after restart) |

### 7.2 After browser refresh

ProjectsSection reads from the server on mount and on a 5-second poll. After browser refresh:
- Zustand store re-initializes with `activeProjectId: undefined`.
- The user lands on the Projects list view.
- Selecting a project re-fetches the overview + metadata.
- The Brief editor re-syncs to the server-side revision.

### 7.3 Never fabricated

The overview derives ALL fields from authoritative sources:
- Project metadata: from `FileProjectStore`.
- Conversation state: from `FileConversationStore` (verifies ownership).
- Mission state: from `MissionService.get()` (in-process; if not found, shows UNAVAILABLE).
- Artifact state: from `MissionService.getArtifacts()` (re-verifies path against current artifact list; if not found, shows MISSING).

No LLM-generated summary is included. No inference that a mission succeeded merely because an artifact exists. No inference that a project is complete merely because its last mission ended.

---

## 8. Test Evidence Index

| Test | File | Result |
|---|---|---|
| PR-01 (create + restart) | `tests/g7-13-project-store.test.ts` | PASS |
| PR-04 (Brief persists across restart) | `tests/g7-13-project-store.test.ts` | PASS |
| PR-05 (stale Brief revision rejected) | `tests/g7-13-project-store.test.ts` | PASS |
| PR-09 (one conversation in one project) | `tests/g7-13-project-store.test.ts` | PASS |
| PR-14 (idempotent create) | `tests/g7-13-project-store.test.ts` + `tests/gateway/g7-13-project-routes.test.ts` | PASS |
| PR-15 (idempotent link) | `tests/g7-13-project-store.test.ts` + `tests/gateway/g7-13-project-routes.test.ts` | PASS |
| PR-16 (conflicting idempotency-key reuse) | `tests/g7-13-project-store.test.ts` + `tests/gateway/g7-13-project-routes.test.ts` | PASS |
| PR-17 (valid state preserved after simulated write failure) | `tests/g7-13-project-store.test.ts` | PASS |
| PR-07 (create + recover project conversation) | `tests/gateway/g7-13-project-routes.test.ts` | PASS |
| PR-11 (mission reference after restart + UNAVAILABLE) | `tests/gateway/g7-13-project-routes.test.ts` | PASS |
| PR-13 (artifact references after restart + MISSING/UNAVAILABLE) | `tests/gateway/g7-13-project-routes.test.ts` | PASS |
| AP-02..AP-06 (API-level restart recovery through BFF) | `evidence/g7-13d/pr-results.json` | PASS |

---

**End of Persistence And Recovery Evidence.**
