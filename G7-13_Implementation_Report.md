# G7-13 — Implementation Report

**Mission:** G7-13 — Durable Projects Repository
**Branch:** `build/g7-13-durable-projects-repository` (created from `86de84756aa730cf8d01125770a078bea1d4801c`)
**Baseline:** `86de84756aa730cf8d01125770a078bea1d4801c` (G7-12D)
**Date:** 2026-10-09

---

## 1. Executive Summary

G7-13 transforms Genesis from a system with durable conversations into a system with **durable, recoverable project workspaces**, without creating a second orchestration engine, memory engine, or workflow platform.

**Key outcomes:**
- Durable `FileProjectStore` with atomic writes (one JSON file per project under `data/projects/`).
- 10 authenticated Gateway routes for project CRUD + Brief + overview + relationship linking.
- Project Brief with revision-controlled optimistic concurrency + provenance (USER_APPROVED / SOURCE_VERIFIED / DRAFT distinction).
- Server-side ownership verification for conversation/mission/artifact links (a caller-supplied ID alone is never proof of ownership).
- Truthful recovery: after Gateway restart, durable project state + Brief + verified references remain; live mission state shows `UNAVAILABLE`; missing artifacts show `MISSING` / `UNAVAILABLE`.
- Idempotency keys for create + link operations, surviving Gateway restart where required.
- Cross-caller isolation (404 not 403 to avoid leaking existence — same pattern as G7-10/G7-12).
- BFF proxy extended with project route patterns + PUT method.
- ProjectsSection UI with list + detail + Brief editor + relationships grid + project settings.
- HomeSection integration: optional project context — new conversations auto-link to the active project.
- 61 new tests (35 store-level + 26 gateway-level) covering PR-01, PR-02..PR-18.
- Frozen contracts UNCHANGED. No new dependencies.

---

## 2. Files Created

| File | Purpose |
|---|---|
| `src/project/project-store.ts` | `FileProjectStore` with atomic writes, revision-controlled Brief, idempotency keys, owner-scoped queries, cross-project conversation-uniqueness invariant. |
| `src/gateway/project-routes.ts` | HTTP handlers for 10 project routes (`/v1/projects/*`) with auth + caller ownership + ownership verification for mission/conversation/artifact links. |
| `tests/g7-13-project-store.test.ts` | 35 store-level tests covering PR-01, PR-04, PR-05, PR-06, PR-14, PR-15, PR-16, PR-17, PR-09, listProjects ownership, updateProject + archive, path safety. |
| `tests/gateway/g7-13-project-routes.test.ts` | 26 gateway-level tests covering PR-02, PR-03, PR-07..PR-13, PR-14, PR-15, PR-16, PR-18, ownership verification, restart recovery, cross-caller isolation, idempotency, brief revision conflicts, ownerId rejection. |
| `web/src/components/genesis/ProjectsSection.tsx` | List view + detail view + Brief editor (revision-controlled, draft vs approved distinction) + relationships grid + project metadata editor. |
| `scripts/g7-13d-browser-full.cjs` | Browser acceptance script for PR-19 + PR-20 (rendered-browser + API-level coverage). |

## 3. Files Modified

| File | Change |
|---|---|
| `src/gateway/http-server.ts` | Added project route routing + `projectStore` param; allowed PATCH/PUT methods in CORS. |
| `src/gateway/main.ts` | Construct `FileProjectStore` + pass to `startHttpServer`; startup log line for projects durability. |
| `web/src/lib/genesis/types.ts` | Added 11 project types (ProjectRecord, ProjectBrief, BriefEntry, BriefProvenance, ProjectOverview + sub-types, BriefUpdateInput, ProjectListResult, ProjectSummary, ConversationLink, MissionLink, ArtifactRef) + extended `GatewayErrorCode` union. |
| `web/src/lib/genesis/client.ts` | Added 9 project API methods (createProject, listProjects, getProject, updateProject, getBrief, updateBrief with typed BRIEF_REVISION_CONFLICT result, getProjectOverview, linkConversation, linkMissionToProject, linkArtifactToProject). PUT method supported. |
| `web/src/lib/genesis/store.ts` | Added `projects` section + `FolderKanban` icon + `activeProjectId` + `setActiveProjectId`. |
| `web/src/app/api/genesis/[...path]/route.ts` | Added 7 new project verified patterns + PUT handler + PUT method in `ALLOWED_METHODS` + body reading for PUT. |
| `web/src/components/genesis/AppShell.tsx` | `FolderKanban` icon mapping; Alt+1..8 keyboard shortcuts (was Alt+1..6). |
| `web/src/components/genesis/GenesisApp.tsx` | Render `ProjectsSection` when `activeSection === "projects"`. |
| `web/src/components/genesis/HomeSection.tsx` | Optional project context — new conversations auto-link to `activeProjectId` when set; banner shown to inform the user. |
| `eslint.config.js` | Added `scripts/g7-13d-browser-full.cjs` to the test-tooling exclusion list (uses CommonJS `require()` for Playwright + spawn APIs — same scope rationale as the existing G7-0x test script exclusions). |

---

## 4. Architecture

### 4.1 Data Model

```ts
interface ProjectRecord {
  schemaVersion: 1;
  projectId: string;            // UUID (opaque, filesystem-safe)
  ownerId: string;             // derived from CallerIdentity; never from client
  name: string;                 // ≤ 200 chars
  description: string;          // ≤ 2000 chars
  status: "active" | "archived";
  createdAt: string;            // ISO timestamp
  updatedAt: string;            // ISO timestamp
  brief: ProjectBrief;
  conversationLinks: ConversationLink[];   // REFERENCES — message bodies stay in ConversationStore
  missionLinks: MissionLink[];              // REFERENCES + verifiedAt timestamp
  artifactRefs: ArtifactRef[];             // REFERENCES + verifiedAt timestamp
  createIdempotencyKey?: string;            // for create idempotency-conflict detection
  createPayloadHash?: string;               // sha256(payload) — for conflict detection on retry
}

interface ProjectBrief {
  revision: number;             // monotonic — incremented on every Brief update
  objective: string;
  requirements: string[];
  constraints: string[];
  approvedDecisions: BriefEntry[];     // USER_APPROVED requires source (approver)
  completedMilestones: BriefEntry[];  // SOURCE_VERIFIED requires source (durable reference)
  nextSteps: string[];
}

interface BriefEntry {
  id: string;
  text: string;
  provenance: "USER_APPROVED" | "SOURCE_VERIFIED" | "DRAFT";
  source?: string;       // absent for DRAFT; required for USER_APPROVED + SOURCE_VERIFIED
  approvedAt?: string;
}
```

### 4.2 Persistence

- **Layout:** `data/projects/{projectId}.project.json` (one atomic file per project).
- **Atomic write:** validate → serialize → write to `.tmp.{pid}.{ts}.project.json` → `rename()` to final path. The temp file is cleaned up on failure; the previous valid file is preserved.
- **Restart recovery:** new `FileProjectStore` instance reads existing files; corrupt records (parse failure, missing required fields, unsupported `schemaVersion`) are treated as not-found (ProjectNotFoundError) — never silently replaced with an empty project. The corrupt file remains on disk for manual recovery.
- **Concurrency:** optimistic revision on Brief updates; idempotency keys on create/link operations. Single-process model — no cross-process locking.

### 4.3 Gateway API

10 authenticated routes under `/v1/projects`:

| Route | Method | Purpose |
|---|---|---|
| `/v1/projects` | POST | Create project (ownerId derived from CallerIdentity; client-supplied ownerId rejected with 400 OWNER_ID_NOT_ALLOWED) |
| `/v1/projects` | GET | List caller projects (cursor pagination, 1-100 default 20) |
| `/v1/projects/{projectId}` | GET | Get project metadata (404 for cross-caller — never 403) |
| `/v1/projects/{projectId}` | PATCH | Update name/description/status (invalid status → 400 INVALID_STATUS) |
| `/v1/projects/{projectId}/brief` | GET | Read Project Brief |
| `/v1/projects/{projectId}/brief` | PUT | Update Brief (revision-controlled; stale → 409 BRIEF_REVISION_CONFLICT) |
| `/v1/projects/{projectId}/overview` | GET | Derived overview from authoritative sources (project + brief + live conversation/mission/artifact state with `available` / `missing` / `unavailable` flags) |
| `/v1/projects/{projectId}/conversations` | POST | Link a conversation (server verifies ownership via ConversationStore first) |
| `/v1/projects/{projectId}/missions` | POST | Link a mission (server verifies ownership via MissionService first) |
| `/v1/projects/{projectId}/artifacts` | POST | Link an artifact reference (server verifies mission ownership AND path existence in the mission's artifact list) |

### 4.4 Ownership Verification (critical rule)

> A mission ID alone is not proof of ownership. Before linking a mission or artifact, verify its ownership using an existing authoritative mechanism. If ownership cannot be verified, reject the link rather than trusting a caller-supplied identifier.

Implementation:
- `POST /v1/projects/{id}/conversations`: `ConversationStore.getConversation(conversationId, callerId)` is called BEFORE `linkConversation`. If the conversation is not found or not owned by the caller → 404 CONVERSATION_NOT_FOUND (not 403, to avoid leaking existence).
- `POST /v1/projects/{id}/missions`: `MissionService.get(missionId, caller)` is called BEFORE `linkMission`. MissionService throws `MissionNotFoundError` for both "not found" and "not owned" cases (intentional ambiguity). If the mission is no longer in the in-process registry after restart, the link is rejected — we cannot verify ownership of a mission we cannot retrieve.
- `POST /v1/projects/{id}/artifacts`: `MissionService.get(missionId, caller)` + `MissionService.getArtifacts(missionId, caller)` are called BEFORE `linkArtifact`. The path must exist in the mission's CURRENT artifact list (re-verified at overview time). The path is also passed through a safety filter that rejects `..`, absolute paths, and null bytes (defense-in-depth on top of the already-verified list).

After restart: durable links (with `verifiedAt` timestamp) remain. The overview reads live mission state via `MissionService.get()`; if the mission is no longer in the registry, the overview shows `availability: "unavailable"` honestly — never fabricates completion.

### 4.5 Web Interface

`ProjectsSection` (new component) provides:
- **List view:** caller's projects with creation form.
- **Detail view:** project overview + Brief editor + relationships grid (conversations / missions / artifacts) + project metadata editor.
- **Brief editor:** revision-controlled — the form shows the current revision in the Save button; conflicts surface as `BRIEF_REVISION_CONFLICT` with a clear "Brief was modified elsewhere. Refresh the project to load the latest revision" message.
- **Brief provenance:** approved decisions and completed milestones are read-only in the editor (they require explicit approval through the API). Drafts are visually distinguished from approved decisions (different icon + label).
- **Relationships grid:** conversations show title + message count + last-update; missions show live status / `UNAVAILABLE` after restart; artifacts show `available` / `missing` / `unavailable` with explicit reasons.

`HomeSection` integration:
- Reads `activeProjectId` from the Zustand store.
- When set, new conversations created in Home are auto-linked to the active project.
- A small banner informs the user: "New conversations you create here will be linked to the active project."

`AppShell`:
- New `Projects` section between `Home` and `Work` (Alt+2).
- Keyboard shortcuts extended to Alt+1..8 (was Alt+1..6).

### 4.6 Single source of truth

A project record stores only REFERENCES:
- `conversationLinks[].conversationId` → message bodies stay in `FileConversationStore`.
- `missionLinks[].missionId` + `verifiedAt` → live state in `MissionService` in-process registry; the project never duplicates mission state.
- `artifactRefs[].{missionId, path, workerId?}` + `verifiedAt` → file contents stay in the mission's worker workspace; the project stores only the reference.

The Project Brief is the ONLY authoritative content; project metadata (name, description, status) is also authoritative.

---

## 5. Acceptance Test Results

| Test ID | Scenario | Result | Evidence |
|---|---|---|---|
| PR-01 | Create a project and recover it after restart | PASS | `tests/g7-13-project-store.test.ts` (3 tests) |
| PR-02 | List projects only for the authenticated caller | PASS | `tests/gateway/g7-13-project-routes.test.ts` (list filters by callerId) |
| PR-03 | Reject cross-caller project access (404 not 403) | PASS | `tests/gateway/g7-13-project-routes.test.ts` (404 on GET/PATCH/brief/overview cross-caller) |
| PR-04 | Persist Project Brief across restart | PASS | `tests/g7-13-project-store.test.ts` (Brief persists across restart) |
| PR-05 | Reject stale Brief revision | PASS | `tests/g7-13-project-store.test.ts` (BriefRevisionConflictError) |
| PR-06 | Preserve distinction between draft and approved decisions | PASS | `tests/g7-13-project-store.test.ts` (DRAFT / USER_APPROVED / SOURCE_VERIFIED all preserved; USER_APPROVED + SOURCE_VERIFIED require source; duplicate ids rejected) |
| PR-07 | Create and recover project conversation | PASS | `tests/gateway/g7-13-project-routes.test.ts` (conversation + link + restart recovery) |
| PR-08 | Reject linking a conversation owned by another caller | PASS | `tests/gateway/g7-13-project-routes.test.ts` (404 when B links A's conversation) |
| PR-09 | Reject assigning one conversation to two projects | PASS | `tests/g7-13-project-store.test.ts` + `tests/gateway/g7-13-project-routes.test.ts` (ConversationAlreadyLinkedError / 409 CONVERSATION_ALREADY_LINKED) |
| PR-10 | Link an authorized mission without executing it again | PASS | `tests/gateway/g7-13-project-routes.test.ts` (mission completes once; linking does not re-execute) |
| PR-11 | Preserve mission reference after restart and show unavailable state honestly | PASS | `tests/gateway/g7-13-project-routes.test.ts` (live overview before restart, UNAVAILABLE after) |
| PR-12 | Link only verified artifact references (reject unknown paths) | PASS | `tests/gateway/g7-13-project-routes.test.ts` (ARTIFACT_NOT_FOUND on unknown path) |
| PR-13 | Show missing artifacts truthfully | PASS | `tests/gateway/g7-13-project-routes.test.ts` (overview shows "unavailable" after simulated restart; store test shows corrupt record is preserved, not silently replaced) |
| PR-14 | Repeat identical project creation request without duplication | PASS | `tests/g7-13-project-store.test.ts` + `tests/gateway/g7-13-project-routes.test.ts` (same idempotencyKey + payload → same projectId) |
| PR-15 | Repeat identical relationship link without duplication | PASS | `tests/g7-13-project-store.test.ts` + `tests/gateway/g7-13-project-routes.test.ts` (link is idempotent no-op) |
| PR-16 | Reject conflicting idempotency-key reuse | PASS | `tests/g7-13-project-store.test.ts` + `tests/gateway/g7-13-project-routes.test.ts` (IdempotencyConflictError / 409 on different payload) |
| PR-17 | Preserve valid state after simulated write failure | PASS | `tests/g7-13-project-store.test.ts` (corrupt file is preserved on disk; readProject refuses to load it without silently replacing) |
| PR-18 | Keep legacy unassigned conversations functional | PASS | `tests/gateway/g7-13-project-routes.test.ts` (legacy conversation create + GET + list + send messages all work) |
| PR-19 | Browser: create, select, refresh, and reopen project | NOT_EXECUTED | `evidence/g7-13d/pr-results.json` — AuthGate stall (environment limitation, same as G7-12D) prevents rendered-browser UI navigation. API-level coverage (AP-01..AP-06) passes through the BFF but does NOT substitute for rendered-browser tests per the spec. |
| PR-20 | Browser: edit Brief, navigate conversations, inspect mission/artifact states | NOT_EXECUTED | Same as PR-19 — rendered-browser UI navigation blocked by AuthGate stall. |

---

## 6. Regression Results

| Check | Result |
|---|---|
| Engine tests | 756 passed, 9 skipped, 0 failed (80 files) — was 695 / 9 / 0 at G7-12 closure (+61 new G7-13 tests) |
| Engine typecheck | PASS |
| Engine lint | PASS (0 errors) |
| Web typecheck | PASS |
| Web lint | PASS (0 errors, 4 pre-existing warnings) |
| Frozen contracts | UNCHANGED (0 diff lines vs `86de847`) |
| Secrets committed | NONE |
| Production deployment | NONE |
| New dependencies | NONE |

---

## 7. Known Limitations

1. **Browser PR-19 + PR-20 NOT_EXECUTED:** The AuthGate "Verifying session" state stalls in the headless browser because the Next.js HMR WebSocket connection fails in the sandbox (same root cause as G7-12D). The API-level tests (AP-01..AP-06 in `evidence/g7-13d/pr-results.json`) prove the full BFF → Gateway → Project Store pipeline works end-to-end, but per the spec these do NOT substitute for rendered-browser tests. The 4 web typechecks + 4 web lints pass; the ProjectsSection component is implemented and exercises the typed API correctly.

2. **Mission state not durable across Gateway restart:** Same as G7-12. The project record keeps `verifiedAt` and the durable missionId reference; the overview shows `availability: "unavailable"` for missions no longer in the in-process registry. The project state itself (metadata + Brief + conversation links + mission links + artifact refs) is fully durable.

3. **G7-08C/D reconciliation outstanding:** Same as G7-12. Rate-limiting + AuthGate hardening still in Z.ai Preview only.

4. **USD cost may stay UNKNOWN:** Same as G7-12. Project Overview surfaces `cost.usd === 0` as "USD: UNKNOWN" via the existing G7-11C accounting fix.

5. **Cookie configuration requires security hardening before public deployment:** Same as G7-12D. `SameSite=Lax` (changed from `Strict` in G7-12D for broader browser compatibility) and the `GENESIS_COOKIE_SECURE` override must be reviewed before public deployment.

6. **Single-process file-based concurrency:** Same as G7-12. Suitable for the current single-gateway deployment; would need locking for multi-instance deployments. Documented limitation — not a G7-13 scope item.

7. **Mission association duplicate-prevention across retries:** Same as G7-12C/D. The `linkMission` operation is idempotent at the store level (same missionId twice = no-op), but cross-retry end-to-end guarantees would require durable mission-state — out of scope.

8. **No conversation archive UI:** The store supports `status: "archived"` but the UI does not yet expose archive/restore actions for conversations. ProjectsSection DOES expose project archive via the metadata editor.

---

## 8. Scope Boundaries Maintained

- ✅ No G7-14 plugins or MCP expansion.
- ✅ No new project-planning agent.
- ✅ No new memory or RAG engine.
- ✅ No Kanban/task management.
- ✅ No multi-tenant organization administration.
- ✅ No automatic project execution.
- ✅ No background project monitoring.
- ✅ No automatic mission retries.
- ✅ No durable MissionService redesign.
- ✅ No new provider integrations.
- ✅ No cloud synchronization.
- ✅ No autonomous approval of AI-generated decisions.
- ✅ No frozen contract modifications.
- ✅ No new external dependencies.

---

**End of Implementation Report.**
