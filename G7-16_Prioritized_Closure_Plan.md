# G7-16 — Prioritized Closure Plan

**Mission:** G7-16 — Prioritized Closure Plan (read-only assessment output)
**Date:** 2026-10-10

---

## Closure Missions (ordered by severity + dependency)

### G7-16A — Operational Hardening (P1 closure)

**Priority:** P1 — essential for dependable practical use.
**Dependency:** None. Can start immediately.
**Scope:** Three small, independent slices.

#### Slice 1: Workspace retention sweep (P1-01)

| Field | Value |
|---|---|
| Problem | OpenBot workspaces accumulate in `OPENBOT_ROOT_DIR` indefinitely. No automated cleanup. |
| Evidence | `src/runtime/openbot/adapter.ts` — `resetWorker()` deletes workspace but is not called automatically. `close()` does not delete workspaces. |
| User impact | Disk fills up under sustained use. |
| Smallest correction | Add a configurable workspace TTL sweep to `MissionService` (reuse the `sweepTerminalMissions` pattern). Evict workspace directories older than N hours after mission completion. |
| Reuse | `sweepTerminalMissions()` in `mission-service.ts:525` — same timer + unref pattern. `rmSync(dir, { recursive: true })` from Node.js builtins. |
| Acceptance test | Create 5 missions → verify workspaces exist → advance clock → verify old workspaces deleted, recent ones retained. |
| Estimated effort | ~80 lines in `mission-service.ts` + `adapter.ts`. |

#### Slice 2: Structured logging (P1-02)

| Field | Value |
|---|---|
| Problem | Gateway uses `console.error` only. No log levels, no structured output. |
| Evidence | `src/gateway/main.ts` — all logging is `console.error(...)`. |
| User impact | Operators cannot filter logs or integrate with log aggregation. |
| Smallest correction | Add a minimal structured logger module (`src/gateway/logger.ts`). JSON output with `level`, `timestamp`, `missionId`, `message`. No new dependency — `JSON.stringify` + `process.stderr.write`. Replace `console.error` calls with `logger.info/warn/error`. |
| Reuse | `scrubSecrets()` pattern from `mission-service.ts` — apply to all log messages. |
| Acceptance test | Gateway logs include `level`, `timestamp` in JSON format; secrets are scrubbed. |
| Estimated effort | ~60 lines new module + ~50 lines of call-site updates. |

#### Slice 3: Lazy-load mission history (P1-03)

| Field | Value |
|---|---|
| Problem | `FileMissionHistoryStore.loadAll()` reads every `*.mission.json` at startup. O(missions) disk reads. |
| Evidence | `src/mission/mission-history-store.ts:loadAll()` — `readdirSync` + `readFileSync` per file. |
| User impact | Startup slows as mission count grows (thousands of missions = seconds of startup delay). |
| Smallest correction | Load a lightweight index (missionId + status + acceptedAt) at startup; defer full record read until `get()` is called. Reuse `readdirSync` for the index; `readFileSync` on demand. |
| Reuse | Existing `read()` method — just defer the call. |
| Acceptance test | 1000 mission files → startup < 2s. `get(missionId)` returns full record on demand. |
| Estimated effort | ~40 lines in `mission-history-store.ts`. |

---

### G7-16B — Pilot Readiness (P2 closure, subset)

**Priority:** P2 — valuable improvement for pilot deployment.
**Dependency:** G7-16A Slice 1 (workspace cleanup) should be done first.
**Scope:** Two slices.

#### Slice 1: Troubleshooting runbook (P2-04)

| Field | Value |
|---|---|
| Problem | No troubleshooting guide for common operational failures. |
| Smallest correction | `docs/release/engine-v1-troubleshooting.md` — common errors, symptoms, recovery steps. |
| Estimated effort | ~200 lines documentation. |

#### Slice 2: Artifact content durability (P2-01)

| Field | Value |
|---|---|
| Problem | Artifact content not available after gateway restart (workspace gone). |
| Smallest correction | Copy verified artifacts to a durable store on mission completion. Reuse `ArtifactRegistry` JSONL pattern. |
| Reuse | `src/mission/artifact-record.ts` — same JSONL append pattern. |
| Estimated effort | ~100 lines in `mission-service.ts`. |

---

### G7-16C — Scale Preparation (P2-P3, future)

**Priority:** P2-P3 — required for public deployment.
**Dependency:** G7-16A + G7-16B must be complete.
**Scope:** Multi-instance coordination, load testing, HTTPS/TLS, monitoring.

Not detailed here — out of scope for initial practical use.

---

## Summary

| Mission | Priority | Slices | Estimated lines | Dependencies |
|---|---|---|---|---|
| G7-16A | P1 | 3 | ~280 | None |
| G7-16B | P2 | 2 | ~300 | G7-16A Slice 1 |
| G7-16C | P2-P3 | TBD | TBD | G7-16A + G7-16B |

**Recommended sequence:** G7-16A → G7-16B → (evaluate pilot feedback) → G7-16C.

---

**End of G7-16 Prioritized Closure Plan. No production code was modified.**
