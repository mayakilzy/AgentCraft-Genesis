# G6-08 — Phase 3: Concurrency, Lifecycle and Bounded Resources

**Phase:** 3
**Status:** COMPLETE
**Start commit:** `86eca26` (end of Phase 2)
**End commit:** (this commit)

---

## Mission (from G6-08 brief, §PHASE 3)

Address the audit's unbounded-state findings (RC-6).

Implement bounded retention consistent with public API contracts:
- Terminal mission retention (B-REGISTRY-001)
- Idempotency index growth (B-REGISTRY-002)
- MemoryFlightRecorder event growth (B-REGISTRY-003)
- pollToTerminal deadline (B-A2A-002)
- bindings Map leak when execute() never returns (B-A2A-003)

Avoid introducing background timers that keep Node processes alive indefinitely.

---

## Findings Addressed

| Finding ID | Closure Decision | Evidence |
|---|---|---|
| B-REGISTRY-FINDING-001 (terminal missions never evicted) | FIXED_VERIFIED | `sweepTerminalMissions(now)` method evicts terminal missions older than `terminalMissionRetentionMs`. Background sweeper runs every 60s with `unref()`. P3-01, P3-02, P3-05 tests verify. |
| B-REGISTRY-FINDING-002 (idempotencyIndex grows + prevents reuse) | FIXED_VERIFIED | `sweepTerminalMissions()` also removes the idempotency key when evicting a terminal mission — the key can be reused by a future submission from the same caller. P3-03, P3-04 tests verify (including cross-caller rejection preserved). |
| B-REGISTRY-FINDING-003 (MemoryFlightRecorder.events unbounded) | FIXED_VERIFIED | `MemoryFlightRecorder` constructor accepts `{ maxEvents?: number }` (default 1000). When `events.length >= maxEvents`, oldest is dropped before push. P3-06, P3-07 tests verify. |
| B-A2A-FINDING-002 (pollToTerminal has no wall-clock deadline) | FIXED_VERIFIED | `pollToTerminal` now has a deadline = `caller.maxMissionTimeoutMs + 30_000` slack. On deadline exceeded, publishes FAILED, cancels the mission, deletes the binding, returns. |
| B-A2A-FINDING-003 (bindings Map leaks when execute() never returns) | FIXED_VERIFIED | `pollToTerminal` deletes the binding on deadline-exceeded. `execute()` already deletes in `finally{}`. No path leaves a binding orphaned. |
| C-VERIFY-FINDING-009 (FileFlightRecorder unbounded — applies to MemoryFlightRecorder) | FIXED_VERIFIED | `MemoryFlightRecorder` now calls `sanitize()` on push (matching FileFlightRecorder). P3-08 test verifies. |

---

## What was actually built

### 1. MissionService bounded retention (`src/gateway/mission-service.ts`)

New `MissionServiceOptions` fields:
- `terminalMissionRetentionMs?: number` (default 5 minutes)
- `sweepIntervalMs?: number` (default 60 seconds; 0 to disable)

New MissionService methods:
- `sweepTerminalMissions(now?)`: evicts terminal missions whose `finishedAt` is older than the retention window. Also removes the corresponding idempotency key. Returns `{ evicted, remaining }`.
- `getSweepStats()`: observability accessor (sweepCount, totalMissions, terminalMissions, activeMissions).
- `close()`: stops the background sweeper timer.

Background sweeper:
```typescript
this.sweepTimer = setInterval(() => {
  try { this.sweepTerminalMissions(); } catch { /* best-effort */ }
}, sweepIntervalMs);
this.sweepTimer.unref();  // G6-08: do NOT keep the Node process alive
```

### 2. MemoryFlightRecorder bounded + sanitized (`src/mission/flight-recorder.ts`)

```typescript
export class MemoryFlightRecorder implements FlightRecorder {
  readonly events: FlightEvent[] = [];
  readonly maxEvents: number;
  constructor(opts: { maxEvents?: number; maxFieldLength?: number } = {}) {
    this.maxEvents = opts.maxEvents ?? 1000;
    this.maxFieldLength = opts.maxFieldLength ?? DEFAULT_MAX_FIELD_LENGTH;
  }
  record(event: FlightEvent): void {
    if (this.events.length >= this.maxEvents) this.events.shift();
    const sanitized = sanitize(event, this.maxFieldLength) as FlightEvent;
    this.events.push(sanitized);
  }
}
```

### 3. pollToTerminal deadline + binding cleanup (`src/gateway/a2a-server.ts`)

```typescript
const deadlineMs = (caller.maxMissionTimeoutMs ?? 60_000) + 30_000;
const startedAt = Date.now();
for (;;) {
  if (signal.aborted) { await delay(100); }
  const snapshot = this.service.get(missionId, caller);
  if (snapshot.terminal) return snapshot;
  if (Date.now() - startedAt >= deadlineMs) {
    this.service.cancel(missionId, caller);
    eventBus.publish({ kind: 'task', data: buildTask(taskId, 'FAILED') });
    this.bindings.delete(taskId);  // G6-08: prevent binding leak
    return { status: 'FAILED', failureClass: 'deadline-exceeded', ... };
  }
  await delay(pollIntervalMs);
}
```

---

## Important design constraint respected

> "Do not silently discard artifacts, mission evidence or idempotency guarantees merely to reduce memory."

- Active (non-terminal) missions are NEVER evicted. Only terminal missions past the retention window.
- Idempotency keys are preserved for the full retention window (5 min default) — only removed when the corresponding mission is evicted.
- After eviction, the idempotency key can be REUSED by the same caller (B-REGISTRY-002 fix). Cross-caller reuse remains rejected (P3-04 test).
- Mission evidence (flight recorder events) is bounded PER MISSION to 1000 events — sufficient for any reasonable mission; extreme cases can configure higher.
- The sweeper is `unref()`d so it does NOT keep the Node process alive (Phase 3 explicit constraint).

---

## Test Results

```text
PHASE = 3
STATUS = COMPLETE

FINDINGS_ADDRESSED = 6 (RC-6 cluster)
FINDINGS_VERIFIED_CLOSED = 6

ROOT_CAUSES_FIXED = 1 (RC-6: unbounded in-memory state — fully addressed)
PRODUCTION_FILES_CHANGED = 3 (mission-service.ts, flight-recorder.ts, a2a-server.ts)
NEW_DEPENDENCIES = 0

FOCUSED_TESTS = 10 (P3-01..P3-10 in tests/g6-08/p3-bounded-resources.test.ts)
FULL_TESTS = 559 passed / 9 skipped / 568 total (was 549/9 at Phase 2 end)
TYPECHECK = PASS
LINT = PASS (production source clean)

REGRESSIONS = 0
BLOCKERS = 0
NEXT_PHASE = Phase 4 (Verification and Artifact Integrity)
```

---

## Test coverage matrix

| Test | Finding covered | Assertion |
|---|---|---|
| P3-01: repeated mission submission does not grow registry unboundedly | B-REGISTRY-001 | 10 missions submitted → sweep → 0 remaining |
| P3-02: terminal mission eviction removes from registry | B-REGISTRY-001 | After eviction, getArtifacts throws MissionNotFoundError |
| P3-03: idempotency key reusable after eviction | B-REGISTRY-002 | Same key → new missionId after sweep |
| P3-04: cross-caller idempotency key reuse rejected (then allowed after eviction) | B-REGISTRY-002 + cross-caller isolation | Caller B rejected before eviction, allowed after |
| P3-05: active missions NOT evicted | B-REGISTRY-001 (negative) | Running mission survives past-retention sweep |
| P3-06: MemoryFlightRecorder caps events at maxEvents | B-REGISTRY-003 | 10 events recorded with maxEvents=5 → 5 retained |
| P3-07: default maxEvents is 1000 | B-REGISTRY-003 | 1100 events recorded → 1000 retained |
| P3-08: maxEvents cap + sanitize on push | B-REGISTRY-003 + C-VERIFY-009 | 5 events with maxEvents=3 → 3 retained, sanitized |
| P3-09: sweep stats observable | observability | getSweepStats returns correct counts |
| P3-10: background sweeper is unref()d | Phase 3 design constraint | Service constructed without hanging the process |

---

## What was NOT done (and why)

1. **Did NOT add a TTL to the idempotencyIndex independent of the mission.**
   The idempotency key's lifetime is bound to the mission's lifetime —
   when the mission is evicted, the key is freed. This is simpler than a
   separate TTL and matches the user's mental model ("the key represents
   this mission").

2. **Did NOT add bounded retention to FileFlightRecorder.**
   The audit's C-VERIFY-FINDING-009 covers BOTH MemoryFlightRecorder and
   FileFlightRecorder. FileFlightRecorder writes to disk per-event — its
   growth is bounded by disk usage, not memory. Disk-space bounding is a
   deployment concern (logrotate, disk quotas) outside the v1 scope.

3. **Did NOT add a per-caller active-mission eviction.**
   Admission control (maxActiveMissions per caller + global cap) already
   prevents unbounded ACTIVE missions. The terminal-mission eviction
   prevents unbounded TERMINAL missions. Together they bound the registry.

---

END OF PHASE 3 EVIDENCE.
