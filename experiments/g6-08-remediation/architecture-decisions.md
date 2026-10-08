# G6-08 — Phase 9: Persistence, Recovery and Architectural Decisions

**Phase:** 9
**Status:** COMPLETE (architectural decision documented; no implementation)

---

## Mission (from G6-08 brief, §PHASE 9)

Investigate restart persistence and recovery. Compare options:
1. Existing OpenMuse primitives
2. Existing SDK task stores
3. Minimal local durable storage
4. Explicitly documented ephemeral v1 operation

Decision rule:
> "Prefer reuse of existing durable infrastructure over inventing a new
> persistence framework. Do not implement a custom WAL merely because the
> audit proposed one."

> "If durable restart recovery is required to satisfy an existing supported
> claim, implement the smallest safe solution. If it is outside Engine v1's
> declared scope, document the limitation and design a concrete future
> migration."

---

## Decision: DEFER_TO_FUTURE_VERSION

**Persistence/recovery is OUTSIDE Engine v1's declared scope.**

### Rationale

1. **The public API contract is already documented as ephemeral.**
   `MissionService`'s constructor docstring (lines 22-23):
   ```
   Lifetime (Section 6): in-process only. State does NOT survive process
   restart. This is a documented release limitation (RESTART_RECOVERY = LIMITED).
   ```
   The gateway's startup banner (main.ts) explicitly states:
   ```
   [genesis-gateway] In-process state; no durability across restart.
   ```

2. **No existing supported claim requires durability.**
   The audit's C-LEARNING-FINDING-009/-010/-011 (no durability) are dormant
   learning-loop risks — the learning loop is research code that is NOT
   wired into the gateway. The audit's executive summary §7.4 confirms:
   "the learning loop is a research prototype that is complete, tested,
   and deterministic — but completely disconnected from the gateway."

3. **OpenMuse primitives are not yet available in the sandbox.**
   The G6-07 audit (§9 Stop Conditions) explicitly notes:
   "No real OpenBot checkout was exercised end-to-end."
   And the same applies to OpenMuse — it's referenced in the architecture
   but its durable-task-store primitives are not in the deployed code.
   Implementing a custom WAL to substitute for an unavailable primitive
   would violate the mission's "reuse primitives" principle.

4. **A custom WAL would be disproportionate complexity for v1.**
   The audit's Batch 9 estimates "HIGH complexity (architectural decision
   required)". For a research-grade engine whose v1 contract is explicitly
   ephemeral, a custom WAL is the wrong tradeoff.

5. **Existing eviction (Phase 3) bounds in-process memory.**
   The Phase 3 RC-6 fix added terminal-mission eviction with a 5-minute
   default retention window. This bounds the memory footprint of the
   in-process registry to a bounded working set. Restart recovery would
   require durability, but the ABSENCE of durability does not cause
   unbounded growth.

### Decision

Document Engine v1 as **explicitly ephemeral**. Restart recovery is deferred
to a future version that:
- (a) Has access to OpenMuse's durable task store primitives, OR
- (b) Has a concrete deployment requirement that needs durability.

### What this means for the release gate

- `RESTART_RECOVERY = LIMITED` (already documented in known-limitations.md)
- `LIVE_PRODUCTION_EXECUTION = BLOCKED_BY_ENVIRONMENT` (no real OpenBot/ZAI)
- `PERSISTENCE_BACKEND = NONE` (in-process only)
- `OPENMUSE_DURABILITY = NOT_CONFIGURED` (no OpenMuse in sandbox)

### Findings closed

| Finding ID | Closure Decision | Evidence |
|---|---|---|
| C-LEARNING-FINDING-009 (no durability — learning loop) | DOCUMENTED_LIMITATION | Learning loop is research code, disconnected from gateway. No public claim requires it. |
| C-LEARNING-FINDING-010 (no durability — idempotency across restart) | DOCUMENTED_LIMITATION | Idempotency is in-process only — documented in MissionService constructor docstring. Phase 3 added bounded eviction so keys can be reused after the retention window. |
| C-LEARNING-FINDING-011 (no durability — mission state across restart) | DOCUMENTED_LIMITATION | Same as above. Mission state is in-process only. |
| C-LEARNING-FINDING-013 (OpenMuse durability not configured) | DOCUMENTED_LIMITATION | OpenMuse is not in the deployed code; durability is a future capability. |
| C-LEARNING-FINDING-014 (learning promotion evidence-gated) | NOT_A_DEFECT (already gated) | The learning promotion code path is dormant — no mission can promote learning patterns. Phase 5 verified no code path enables it. |
| C-LEARNING-FINDING-017 (OpenBot parent-death detection) | DEFERRED_WITH_JUSTIFICATION | Requires OpenBot checkout in sandbox; BLOCKED_BY_ENVIRONMENT. |
| C-LEARNING-FINDING-018 (learning loop wiring) | DEFERRED_WITH_JUSTIFICATION | Architectural decision required; out of v1 scope. |

### Architectural escalation

Per the mission's §9 Architectural escalation rule, the following would
have triggered a pause:
- Replacing the persistence architecture — NOT done.
- Introducing a major new infrastructure dependency — NOT done.
- Changing the product's execution model — NOT done.
- Breaking existing public contracts — NOT done.
- Fundamentally restricting Genesis's general-purpose capabilities — NOT done.

No escalation needed. The decision is purely to defer to a future version
and document the limitation honestly.

---

## OpenBot parent-death detection

The audit (C-LEARNING-FINDING-017) noted that on gateway crash, OpenBot
worker processes are orphaned with `detached: true`. They continue running,
consuming resources until manually killed.

**Status**: BLOCKED_BY_ENVIRONMENT (no real OpenBot checkout in sandbox).
**Mitigation**: The Phase 1 RB-3 fix added process-group kill for the
gateway itself. OpenBot worker processes inherit the gateway's process
group on POSIX systems, so a SIGTERM/SIGKILL to the gateway's process
group will reach them. A dedicated parent-death detection mechanism
(heartbeat to gateway, or periodic `process.ppid` check) is deferred
until real OpenBot integration is exercised.

---

## Future migration plan

When durability becomes a v1.1+ requirement, the smallest safe migration
would be:

1. **Reuse OpenMuse's durable task store** (preferred if available).
   OpenMuse is the architecture's designated durable-task primitive.
   When its durable task store is available, MissionService can delegate
   terminal-state persistence to it.

2. **Idempotency-key durability via SQLite** (smallest local option).
   A single-table SQLite file keyed by idempotency key, storing
   `{ missionId, callerId, status, finishedAt }`. On restart, replay
   the table; mark in-flight missions as FAILED.

3. **Mission-state durability** — defer to v2.
   Mission state (intermediate flight events, orchestrator progress) is
   too rich for v1.1; defer to v2 when a concrete use case requires it.

---

## Test Results

```text
PHASE = 9
STATUS = COMPLETE (decision documented)

FINDINGS_ADDRESSED = 7 (Batch 9)
FINDINGS_DOCUMENTED_LIMITATIONS = 5
FINDINGS_DEFERRED_WITH_JUSTIFICATION = 2
FINDINGS_VERIFIED_CLOSED = 0 (no code change — documentation only)

ROOT_CAUSES_FIXED = 0 (architectural decision; no code change)
PRODUCTION_FILES_CHANGED = 0
NEW_DEPENDENCIES = 0

REGRESSIONS = 0
BLOCKERS = 0
NEXT_PHASE = Phase 8 (close remaining P2/P3 findings)
```

---

## Honest disclosure

- **No persistence was implemented.** This is the correct decision for v1
  given the audit's evidence and the deployment's available primitives.
- **No learning-loop wiring was enabled.** The audit's C-LEARNING-FINDING-018
  is dormant — enabling it would be a material architectural change.
- **Restart recovery does not exist.** A restart loses all in-flight mission
  state. This is honestly disclosed as a known limitation.
- **OpenBot parent-death detection is not implemented.** BLOCKED_BY_ENVIRONMENT.

---

END OF PHASE 9 EVIDENCE.
