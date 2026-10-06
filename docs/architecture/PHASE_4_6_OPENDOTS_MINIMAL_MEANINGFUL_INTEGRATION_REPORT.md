# PHASE 4.6 — OpenDots Minimal Meaningful Integration Report

**Phase:** 4.6
**Date:** 2026-10-07
**Start SHA:** `2fe345b6cc00b685f3af1b22b958a5417d70218d`
**Final SHA:** 8b879b3ef87520cf54b0b02af757bd9beb9d2757
**Branch:** `build/group-03-repository-work`

---

## 1. Authoritative Start State

Verified before any modification:
- **HEAD:** `2fe345b6cc00b685f3af1b22b958a5417d70218d` (local == remote)
- **Worktree:** clean
- **Baseline tests:** 206 passed | 9 skipped (215 total)
- **typecheck:** PASS, **lint:** PASS
- **Phase 4.5 classification:** PASS_WITH_EVIDENCE_LIMITATION

---

## 2. Consultation Verdict

**PLAN_ACCEPTED_WITH_MINOR_AMENDMENTS**

The Phase 4.6 plan was architecturally sound. Four minor amendments based on actual upstream inspection:

| Amendment | Why | Impact |
|-----------|-----|--------|
| HITL deferred | OpenDots page-review approvals require a CopilotKit Intelligence-bound conversation thread. Not needed for minimal collaborative integration. | Removed HITL from scope; `autonomy: 'supervised'` covers the genome-level concern. |
| Dot creation skipped | The adapter doesn't need to create OpenDots Dots. Genesis worker identity is the provenance source, not OpenDots Dot identity. | Simpler adapter; no `POST /api/dots` call. |
| Optimistic concurrency handled | OpenDots Pages use `expectedRevision` for conflict detection. The adapter must handle revision conflicts. | Added `writeWithRetry` with one retry on conflict. |
| `extraOperationalNeeds` compiler option | The planner remains provider-neutral; the caller declares collaborative intent via a compiler option. | No planner change; the probe injects `collaborative-workspace` for target specialists. |

---

## 3. Minor Amendments

(See above table.)

---

## 4. Current OpenDots Boundary Inspected

**Repository:** `https://github.com/CopilotKit/OpenDots` (commit `625452e`, `main`, 2026-10-07)

**API surface (verified from source):**
- `POST /api/spaces` — create Space
- `POST /api/spaces/:spaceId/pages` — create Page
- `GET /api/spaces/:spaceId/pages/:id` — read Page
- `PATCH /api/spaces/:spaceId/pages/:id` — update Page (with `expectedRevision` optimistic concurrency)
- `GET /api/spaces/:spaceId/pages` — list Pages

**Auth:** On localhost (127.0.0.1/::1/localhost), no token required. On external hosts, `Authorization: Bearer <OWNER_TOKEN>` (≥24 chars).

**No CopilotKit Intelligence dependency for Spaces/Pages CRUD.** The server boots standalone with `npm ci && npm run dev` (Node 24, built-in SQLite). Intelligence is only required for conversations/chat — NOT for the collaborative workspace integration boundary.

**Integration boundary chosen:** Direct HTTP CRUD on Spaces/Pages. NOT the CopilotKit runtime/AG-UI stream (which is locked down and requires Intelligence-bound threads).

---

## 5. Capability Selection

**CORE Phase 4.6 capabilities (implemented):**
1. `collaborative-workspace` operational need resolution
2. OpenDots HTTP adapter (Spaces/Pages CRUD)
3. `WorkspaceSurface` (readPage, appendContent, updatePage)
4. `CompositeRuntime` (multi-provider composition: OpenBot + OpenDots)
5. Shared Space + Page creation (one per adapter instance, shared across workers)
6. Two specialists collaborating on the same persistent Page
7. Optimistic concurrency handling (revision conflict retry)
8. Provider invocation evidence (Resolved vs Invoked vs Observed)

---

## 6. Explicit Deferrals

- HITL (page review approvals) — requires CopilotKit Intelligence
- Dot creation (`POST /api/dots`) — not needed; Genesis worker identity is the provenance source
- Page conversations — requires Intelligence
- Slack, voice, visual editor — UI concerns
- Cross-mission persistent specialist memory — Academy concern
- OpenDots computer execution — OpenBot owns this
- Scheduled/background work — OpenMuse owns this (Phase 4.7)
- Broad permissions/RBAC — genome `tools` grants cover this

---

## 7. Workspace Surface

```typescript
interface WorkspaceHandle {
  readonly provider: string;    // 'opendots'
  readonly spaceId: string;     // OpenDots space UUID
  readonly pageId: string;      // OpenDots page UUID
  readonly revision: number;    // current revision
}

interface WorkspaceSurface {
  readonly handle: WorkspaceHandle;
  readPage(): Promise<{ content: string; revision: number }>;
  appendContent(contributor: string, section: string): Promise<{ revision: number }>;
  updatePage(content: string): Promise<{ revision: number }>;
}
```

Minimal: read, append, update. No page creation (adapter creates space+page during `ensureWorkspace`), no deletion, no conversations. Genesis orchestration needs shared artifact read/write; everything else is owned by OpenDots.

---

## 8. OpenDots Adapter

**Files:**
- `src/runtime/opendots/client.ts` (~130 LOC) — thin HTTP client. No upstream imports. `fetch` calls to documented REST endpoints. Handles 409 revision conflicts.
- `src/runtime/opendots/adapter.ts` (~200 LOC) — `OpenDotsWorkspaceAdapter`. Creates shared Space + Page on first `ensureWorkspace`. Caches surfaces per worker. `writeWithRetry` handles revision conflicts with one retry.

**No upstream imports. No vendored code. No new dependencies.** HTTP only.

---

## 9. Worker Identity Mapping

Genesis worker identity (e.g. `web-researcher-1`) is the provenance source. The adapter does NOT create OpenDots Dots. When a worker appends content, the `contributor` parameter (the worker's role) is recorded in the page content as a section header. The `providerInvocations` evidence record links the Genesis worker ID to the OpenDots operation.

**No DotWorker class. No OpenDots-specific identity on WorkerGenome.** Provider-specific IDs (spaceId, pageId) live on `WorkspaceHandle` at the surface boundary.

---

## 10. Orchestrator Integration

**MissionOrchestrator change: NONE.** The orchestrator already calls `runtime.surfaces(handle)` (Phase 4.5). The `CompositeRuntime` satisfies the same `WorkerRuntime` interface. The orchestrator does not know about OpenDots — it reads `surfaces.workspace` when present.

The `CompositeRuntime` (`src/runtime/composite-runtime.ts`, ~160 LOC) composes a computer adapter (OpenBot/MemoryRuntime) and a workspace adapter (OpenDots). It dispatches to the right adapter(s) based on the genome's `operationalNeeds`. A worker that needs both `shell-execution` and `collaborative-workspace` gets both surfaces.

---

## 11. Experience/Provenance Model

**schemaVersion remains 2.** The `providerInvocations` field is additive — it's optional and absent on schemaVersion 1 and 2 experiences that don't record invocations.

```typescript
interface ProviderInvocation {
  readonly provider: string;           // 'opendots'
  readonly need: OperationalNeedKind;  // 'collaborative-workspace'
  readonly operation: string;          // 'append-content'
  readonly workerId: string;           // Genesis worker id
  readonly observed: boolean;          // true = real result confirmed
  readonly resultRef?: string;         // 'opendots:spaceId:pageId'
}
```

---

## 12. Resolved vs Invoked vs Observed Semantics

- **RESOLVED:** `WorkerContribution.resolvedNeeds` — a need was declared and a provider was selected (from the genome's `operationalNeeds` + `tools`).
- **INVOKED:** `Experience.providerInvocations` — the adapter actually performed an operation.
- **OBSERVED:** `providerInvocations[i].observed === true` + `resultRef` — a real result was confirmed.

This is the Phase 4.6 honesty gate: it is impossible for learning to mistake "provider was selected" for "provider was actually used successfully."

---

## 13. Failure Semantics

- **OpenDots unreachable:** `OpenDotsWorkspaceAdapter.ensureWorkspace` throws. `CompositeRuntime.ensureWorker` throws. The mission fails loudly. NO silent fallback to MemoryRuntime.
- **Workspace creation failure:** Adapter throws. Mission fails.
- **Artifact write failure:** Adapter throws after one retry. Mission fails.
- **Artifact retrieval failure:** Probe records `artifactRetrieved: false` and `observed: false`.

**Deterministic failure is preferable to false evidence.**

---

## 14. Tests

**New test file:** `tests/phase-4-6-opendots.test.ts` — 18 architectural tests:
- OpenDotsClient (5 tests): create Space/Page, read, update with optimistic concurrency, revision conflict, 404, unreachable
- OpenDotsWorkspaceAdapter (5 tests): create shared workspace, reuse across workers, two-worker collaboration, revision conflict retry, handle exposure
- CompositeRuntime (5 tests): both surfaces, computer-only, workspace-only, two-worker shared workspace, stopWorker release
- Failure semantics (2 tests): adapter fails loudly when unreachable, composite does NOT fallback
- Evidence distinction (1 test): ProviderInvocation shape

**Uses a stub OpenDots server (deterministic, no real upstream needed for unit tests).** The REAL OpenDots probe is separate.

---

## 15. Real OpenDots Reality Probe

**Probe:** `experiments/phase-4-6-probe/run.ts`

**Result: REAL_OPENDOTS_PROBE = PASS**

A real OpenDots server (commit `625452e`) was started at `http://127.0.0.1:4310`. The probe:
1. Verified OpenDots reachable (HTTP 200 from `/api/workspace`)
2. Compiled a collaborative goal with 2 specialists (Web Researcher + Report Writer), both injected with `collaborative-workspace`
3. Ran the mission through `CompositeRuntime` (MemoryRuntime + OpenDotsWorkspaceAdapter)
4. Both specialists appended distinct sections to the shared OpenDots Page
5. The Page was retrieved after the mission (revision 3, both sections present)
6. Provider invocation evidence recorded: 2 invocations, both `observed: true`, with `resultRef` pointing to the real OpenDots space/page IDs
7. Experience v2 derived with `providerInvocations` and `resolvedNeeds` per worker

**This is NOT a mock probe.** A real OpenDots server was invoked. The artifact persists in OpenDots's SQLite database and is retrievable.

---

## 16. Artifact Persistence Evidence

- Space ID: `fc224d5e-67d8-4a12-aaf0-139a6eba6251`
- Page ID: `d2a640b9-71ed-4327-b06f-d45805234dfc`
- Final revision: 3
- Final content contains both specialists' sections (Web Researcher + Report Writer)
- The Page is retrievable via `GET /api/spaces/:spaceId/pages/:pageId` after the mission completed

---

## 17. Regression Results

- **Test files:** 33 passed (was 32; +1 new)
- **Tests:** 224 passed | 9 skipped (233 total) (was 206 | 9 = 215; +18 new)
- **typecheck:** PASS
- **lint:** PASS
- **Zero regressions:** all 206 baseline tests still pass

---

## 18. LOC/File/Dependency Delta

| Metric | Baseline (4.5) | Final (4.6) | Delta |
|--------|----------------|-------------|-------|
| Production LOC (src/) | 8,003 | 8,707 | **+704** |
| Production files (src/) | 30 | 33 | **+3** |
| Test LOC | 8,075 | ~9,000 | +~925 |
| Test files | 35 | 36 | +1 |
| Runtime dependencies | 1 | 1 | **+0** |

---

## 19. Anti-Bloat Assessment

- **Soft alert (>1,200 LOC):** NOT TRIGGERED (704 < 1,200)
- **Hard review (>1,800 LOC or >10 files or any dependency):** NOT TRIGGERED (704 < 1,800, 3 < 10, 0 = 0)

Well within budget.

---

## 20. Evidence Limitations

**None for Phase 4.6.** Unlike Phase 4.5 (where the real OpenBot provider probe was NOT_RUN), Phase 4.6's real OpenDots probe PASSED. A real OpenDots server was invoked, a real shared artifact was created and retrieved, and provider invocation evidence was recorded with `observed: true`.

The Phase 4.5 limitation (real OpenBot provider probe NOT_RUN) remains — but that is a Phase 4.5 evidence limitation, not a Phase 4.6 limitation.

---

## 21. Phase Classification

**PASS**

All 28 success-gate conditions satisfied, including:
- Real OpenDots upstream probe PASSED (gate #22)
- Zero fake provider evidence (gate #23)
- Two specialists collaborated on a shared persistent artifact (gates #10-13)
- Provider resolution recorded separately from invocation (gates #14-16)
- Anti-bloat gate respected (gate #24)
- OpenMuse remains NOT_INTEGRATED (gate #25)
- TASK-030 remains NOT_STARTED (gate #26)

---

## 22. Exact Final SHA

8b879b3ef87520cf54b0b02af757bd9beb9d2757
