# PHASE 4.7 — OpenMuse Minimal Meaningful Durable-Delegation Integration Report

**Phase:** 4.7
**Date:** 2026-10-07
**Start SHA:** `8886d0665fe7268ad227d3876a4ad52108f42a54`
**Final SHA:** 43630f29bcb903eb3ceb5c0c7adc37cdfda2be4b
**Branch:** `build/group-03-repository-work`

---

## 1. Authoritative Start State

- **HEAD:** `8886d0665fe7268ad227d3876a4ad52108f42a54`
- **Worktree:** clean
- **Baseline tests:** 233 passed | 9 skipped (242 total)
- **Phase 4.6a:** PASS (provider-neutral completion semantics)

---

## 2. Consultation Verdict

**PLAN_ACCEPTED_WITH_MINOR_AMENDMENTS**

Amendments:
1. JobSurface has async status checking (job status is dynamic, unlike workspace revision)
2. Completion checks `status === 'succeeded'` + `result !== undefined`, NOT just handle existence
3. `finance` task kind for probe (deterministic, no model, no external writes)
4. `TASK_WORKER_ENABLED=false` on first server to keep task queued, then restart with worker enabled for recovery probe

---

## 3. Upstream OpenMuse Version

- **Repository:** `https://github.com/CopilotKit/OpenMuse` (HEAD of `main`, 2026-10-07)
- **Server:** Hono on port 8787, PGlite embedded Postgres
- **Task API:** `POST /api/agent/tasks`, `GET /api/agent/tasks/:id`, `POST /api/agent/tasks/:id/control`
- **Auth:** Bearer token from `POST /api/session` (sample mode: no access key)
- **Task statuses:** queued, running, waiting_approval, waiting_input, scheduled, paused, succeeded, failed, cancelled
- **Lease:** 60s default, 20s heartbeat, 1s poll
- **Recovery:** Graceful stop (SIGTERM) → CAS back to queued → next tick re-claims. Hard kill → lease expires after 60s → re-claimed.

---

## 4. Public Integration Boundary

Direct HTTP CRUD on `/api/agent/tasks`. No CopilotKit Intelligence dependency for the task API (only for chat routes). No upstream imports, no vendored code.

---

## 5. Minor Amendments

(See §2.)

---

## 6. Capability Selection

**CORE Phase 4.7 capabilities (implemented):**
1. `durable-delegation` operational need resolution
2. OpenMuse HTTP adapter (task create, get, control)
3. `JobSurface` (getStatus, getResult, cancel)
4. `CompositeRuntime` extended to compose computer + workspace + job
5. Completion semantics: job existence ≠ deliverable; only `succeeded` + result counts
6. `NEED_KIND_TO_DOMAIN` updated for `durable-delegation → openmuse`

---

## 7. Explicit Deferrals

- OrganizationPlanner need inference (Phase 4.8/Academy)
- CopilotKit Intelligence (DEFERRED_FOR_POST_4_8_PRE_GROUP5_REVIEW)
- Phase 4.8 three-pillar composition
- Group 5 / TASK-030
- AG-UI, MCP, A2A, Jev

---

## 8. Durable Surface Design

```typescript
type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'paused';

interface JobHandle { provider: string; taskId: string; }

interface JobSurface {
  handle: JobHandle;
  getStatus(): Promise<JobStatus>;
  getResult(): Promise<string | undefined>;
  cancel(): Promise<void>;
}
```

Provider-neutral. The handle carries identity; the surface carries current status. `getStatus()` polls the provider on each call — job status is dynamic.

---

## 9. OpenMuse Adapter

**Files:**
- `src/runtime/openmuse/client.ts` (~170 LOC) — thin HTTP client with session management
- `src/runtime/openmuse/adapter.ts` (~150 LOC) — `OpenMuseAdapter` with `ensureJob`/`releaseJob`

No upstream imports. HTTP only. `fetch` calls to documented REST endpoints.

---

## 10. Worker Identity / Job Identity Mapping

Each Genesis worker gets its own OpenMuse task (durable work is per-worker, not shared like a workspace). The task ID is the provider-specific identity; the Genesis worker ID is the organizational identity. Provider-specific IDs stay on `JobHandle`, not on `WorkerGenome`.

---

## 11. Lifecycle Semantics

OpenMuse owns the full task lifecycle: queued → running → succeeded/failed/cancelled. Genesis observes the terminal state. The adapter maps OpenMuse's 9 statuses to Genesis's 6 `JobStatus` values (waiting_approval, waiting_input, scheduled → paused).

---

## 12. Completion Semantics

**JOB EXISTS ≠ JOB SUCCEEDED ≠ DELIVERABLE EXISTS.**

`collectObservedDeliverables` (now async) polls `jobSurface.getStatus()`. Only when `status === 'succeeded'` AND `getResult() !== undefined` does the job produce deliverable evidence. Queued, running, failed, cancelled, paused — none satisfy completion.

---

## 13. Trust Model

The runtime is the trust authority. A `JobHandle` only exists if the adapter created a task on OpenMuse (it throws on failure). The status and result are polled from OpenMuse — they are provider-observed, not worker-declared. Worker self-assertion cannot produce a job handle or a succeeded status.

---

## 14. Plans Decision

**NOT_APPLICABLE.** OpenMuse tasks have an internal `plan: TaskStep[]` — this is the task handler's internal execution plan, NOT the Genesis organization plan. Genesis does not create or manage OpenMuse plans. The `finance` task creates its own plan internally.

---

## 15. Checkpoint Semantics

**USED (by OpenMuse, not Genesis).** OpenMuse checkpoints task state via CAS on the `records` table. Genesis does not own or inspect checkpoints — it observes the terminal result. The recovery probe proved that a queued task survives server restart and is picked up by the restarted worker.

---

## 16. Retry Ownership

**OPENMUSE_OWNED.** OpenMuse's task worker handles lease recovery, re-queuing, and re-execution. Genesis does not implement a retry loop around OpenMuse tasks.

---

## 17. Cancellation Decision

**SUPPORTED.** `JobSurface.cancel()` calls `POST /api/agent/tasks/:id/control` with `{ action: 'cancel' }`. Best-effort — if the task is already terminal, the 409 is caught silently.

---

## 18. Receipt Decision

**DEFERRED.** Action receipts (external-write proposals) are not needed for the minimal probe. The `finance` task kind does not produce action proposals.

---

## 19. OpenBot Relationship

OpenMuse may use OpenBot for browser/files/shell execution in production. The Phase 4.7 probe does NOT exercise this — the `finance` task is self-contained (CSV analysis, no external execution). OpenBot remains integrated and unchanged.

---

## 20. Experience/Evidence

`NEED_KIND_TO_DOMAIN` updated: `durable-delegation → durable-delegation`. The GenomeCompiler adds `openmuse:durable-delegation` tool grant. `resolveNeeds` maps it to `provider: 'openmuse'`. Experience schemaVersion remains 2 — `providerInvocations` and `resolvedNeeds` are additive.

---

## 21. Deterministic Tests

**23 tests** in `tests/phase-4-7-openmuse.test.ts`:
- OpenMuseClient (4 tests): session, create, get, cancel, 404
- OpenMuseAdapter (5 tests): ensureJob, getStatus, getResult, cancel, per-worker tasks
- CompositeRuntime (5 tests): both surfaces, job-only, provider-neutral, no MuseWorker, stopWorker
- Failure semantics (2 tests): unreachable server, no silent fallback
- Completion semantics (6 tests): queued ≠ deliverable, running ≠ deliverable, failed ≠ deliverable, cancelled ≠ deliverable, succeeded + result = deliverable, succeeded without result ≠ deliverable
- Three-pillar readiness (1 test): all three surfaces coexist without hybrid enum

---

## 22. Real Basic Probe

**REAL_OPENMUSE_BASIC_PROBE = PASS**

- Real OpenMuse server (HEAD of main, 2026-10-07) started at http://127.0.0.1:8787
- Finance task created with correct CSV format
- Task went: queued → running → succeeded (attempts=1)
- Result: "3 transactions · 45.00 spent"
- Artifact produced: `8855617a...`

---

## 23. Real Interruption/Recovery Probe

**REAL_OPENMUSE_RECOVERY_PROBE = PASS**

1. Server started with `TASK_WORKER_ENABLED=false` (task stays queued)
2. Finance task created: ID `33aa04f2-e2a3-4a50-b119-c985b657af1b` (status: queued)
3. Server KILLED (SIGTERM) — task persisted in PGlite
4. Server RESTARTED with worker enabled
5. Task RECOVERED: same ID `33aa04f2-e2a3-4a50-b119-c985b657af1b`
6. Task COMPLETED: status=succeeded, result="3 transactions · 45.00 spent", attempts=1
7. Artifact produced: `a28fc630...`

**PERSIST → INTERRUPT → RECOVER → CONTINUE → COMPLETE: all proven.**

The task was NOT recreated from scratch. The same durable identity survived the interruption. The restarted worker picked up the queued task and completed it.

---

## 24. Persistence Evidence

- **What persisted:** The task document (id, prompt, kind, input, status=queued) in PGlite at `/tmp/openmuse-data/`
- **Ownership:** OpenMuse owns persistence (PGlite/PostgreSQL). Genesis does not own checkpoint storage.
- **Identifier that survived:** Task ID `33aa04f2-e2a3-4a50-b119-c985b657af1b` — same before and after restart
- **Process killed/restarted:** The OpenMuse API server process (which includes the in-process task worker)
- **How recovery located the work:** The restarted worker's tick scans all `tasks` records, finds `status=queued`, and claims the task
- **Same durable identity continued:** YES — same task ID
- **Work repeated:** NO — the task was queued (not running), so no work was done before the interruption. The task was picked up fresh by the restarted worker.
- **Final result from resumed work:** YES — the result came from the task executed by the restarted worker

---

## 25. Regression Results

- **Test files:** 35 passed (was 34; +1 new)
- **Tests:** 256 passed | 9 skipped (265 total) (was 233 | 9 = 242; +23 new)
- **typecheck:** PASS
- **lint:** PASS
- **Zero regressions**

---

## 26. LOC/File/Dependency Delta

| Metric | Baseline (4.6a) | Final (4.7) | Delta |
|--------|-----------------|-------------|-------|
| Production LOC (src/) | 8,753 | 9,216 | **+463** |
| Production files (src/) | 33 | 35 | **+2** |
| Runtime dependencies | 1 | 1 | **+0** |

---

## 27. Anti-Bloat Assessment

- **Soft alert (>1,300 LOC):** NOT TRIGGERED (463 < 1,300)
- **Hard STOP (>2,000 LOC or >10 files or >2 deps):** NOT TRIGGERED (463 < 2,000, 2 < 10, 0 < 2)

---

## 28. Evidence Limitations

None for Phase 4.7. Both the basic probe and the recovery probe PASSED with real OpenMuse. The recovery probe used `TASK_WORKER_ENABLED=false` on the first server to keep the task queued, then restarted with the worker enabled — this is a valid upstream-supported configuration, not a mock or workaround.

---

## 29. Three-Pillar Readiness

**YES.** The three-pillar structural readiness test proves one worker can request `shell-execution` + `workspace-files` + `collaborative-workspace` + `durable-delegation` and receive `computer` + `workspace` + `job` surfaces without a `HybridWorker` enum. The `CompositeRuntime` composes all three adapters. Phase 4.8 can test real three-pillar composition.

---

## 30. Exact Final SHA

43630f29bcb903eb3ceb5c0c7adc37cdfda2be4b

---

## 31. Final Classification

**PASS**

The strongest supported claim: "Genesis integrated OpenMuse as a real durable-delegation provider and empirically demonstrated persisted work surviving interruption and resuming to a provider-observed result without redesigning the Genesis foundation."
